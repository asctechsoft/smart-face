import { Injectable } from '@nestjs/common';
import { ScopeLevel } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { AccessRepository } from '../access/access.repository';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { PayrollService } from '../payroll/payroll.service';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * Vế điều hành: các thao tác chỉ Giám đốc/Owner làm được.
 *
 * Service này cố tình MỎNG — nó không tự tính toán gì. Logic kỳ công nằm ở
 * `PayrollService`, logic phân quyền nằm ở `AccessService`. Nếu để nó tự thi
 * hành state machine thì hệ thống có hai bản state machine cạnh nhau và chúng
 * sẽ lệch nhau, đúng kiểu lỗi mà việc tách `/exec` sinh ra để tránh.
 */
@Injectable()
export class ExecService {
  constructor(
    private readonly payroll: PayrollService,
    private readonly access: AccessService,
    private readonly accessRepo: AccessRepository,
    private readonly audit: AuditService,
  ) {}

  approveLock(ctx: TenantContext, periodId: string, reason: string) {
    return this.payroll.approveLock(ctx, periodId, reason);
  }

  rejectLock(ctx: TenantContext, periodId: string, reason: string) {
    return this.payroll.rejectLock(ctx, periodId, reason);
  }

  approveReopen(ctx: TenantContext, periodId: string, reason: string) {
    return this.payroll.approveReopen(ctx, periodId, reason);
  }

  listOwners(companyId: string) {
    return this.access.listOwners(companyId);
  }

  async grantOwner(ctx: TenantContext, employeeId: string, reason: string) {
    const owner = await this.access.grantOwner(ctx.companyId, employeeId, ctx.userId);
    await this.audit.record(ctx, {
      action: 'OWNER_GRANT',
      targetType: 'COMPANY_OWNER',
      targetId: employeeId,
      reason,
      after: { employeeId, grantedBy: ctx.userId },
    });
    return owner;
  }

  async revokeOwner(ctx: TenantContext, employeeId: string, reason: string) {
    const result = await this.access.revokeOwner(ctx.companyId, employeeId, ctx.userId, reason);
    await this.audit.record(ctx, {
      action: 'OWNER_REVOKE',
      targetType: 'COMPANY_OWNER',
      targetId: employeeId,
      reason,
      before: { employeeId, active: true },
      after: { employeeId, active: false },
    });
    return result;
  }

  async createDelegation(
    ctx: TenantContext,
    input: {
      delegateId: string;
      requestTypeId?: string;
      scopeLevel: ScopeLevel;
      scopeIds?: string[];
      validFrom: string;
      validTo: string;
      reason?: string;
    },
  ) {
    if (!ctx.employeeId) {
      throw new AppException('RBAC_PERMISSION_DENIED', {
        reason: 'Tài khoản không gắn với hồ sơ nhân viên nào nên không uỷ quyền được.',
      });
    }
    if (input.delegateId === ctx.employeeId) {
      throw new AppException('SELF_APPROVAL_FORBIDDEN', {
        reason: 'Uỷ quyền cho chính mình không có tác dụng gì.',
      });
    }

    const validFrom = new Date(input.validFrom);
    const validTo = new Date(input.validTo);
    if (validTo <= validFrom) {
      throw new AppException('DELEGATION_INVALID_RANGE', {
        reason: 'Ngày kết thúc uỷ quyền phải sau ngày bắt đầu.',
      });
    }

    const delegation = await this.accessRepo.createDelegation(ctx.companyId, {
      delegatorId: ctx.employeeId,
      delegateId: input.delegateId,
      requestTypeId: input.requestTypeId ?? null,
      scopeLevel: input.scopeLevel,
      scopeIds: input.scopeIds ?? [],
      validFrom,
      validTo,
      reason: input.reason,
      createdBy: ctx.userId,
    });

    await this.access.invalidate(ctx.companyId, input.delegateId);
    return delegation;
  }

  listMyDelegations(ctx: TenantContext) {
    if (!ctx.employeeId) return [];
    return this.accessRepo.findActiveDelegationsFor(ctx.companyId, ctx.employeeId);
  }
}
