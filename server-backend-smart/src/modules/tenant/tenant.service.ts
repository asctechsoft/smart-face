import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyStatus, Prisma } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto';
import { TenantQueryDto } from '../admin/dto/admin-query.dto';
import { AppException } from 'src/common/errors';
import { buildMeta, normalizeFullName } from 'src/common/utils';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { TenantRepository } from './tenant.repository';
import type { RequestContext } from 'src/common/types/request-context';

export interface CreateTenantInput {
  name: string;
  /** Mã công ty BẤT BIẾN, dùng sinh employee code */
  code: string;
  /**
   * Tên miền nhân viên gõ ở màn hình đăng nhập.
   *
   * Bỏ trống thì lấy theo `code`. Tách riêng vì `code` bất biến (nằm trong mọi
   * mã nhân viên đã sinh) còn tên miền là thứ đối mặt người dùng, công ty có
   * thể muốn đổi khi đổi thương hiệu.
   */
  domain?: string;
  taxCode?: string;
  timezone?: string;
  planId?: string;
  adminEmail?: string;
  adminFullName?: string;
}

/**
 * Quản lý tenant (FR-ADM-TEN) và mã mời (FR-WEB-INV).
 *
 * Vòng đời tenant: TRIAL → ACTIVE → SUSPENDED ⇄ ACTIVE → TERMINATED (docs/05 mục 1.1).
 * SUSPENDED: nhân viên không đăng nhập/chấm công được, nhưng DỮ LIỆU GIỮ NGUYÊN.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly tenants: TenantRepository,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  // ===========================================================================
  //  Tenant (Web Admin)
  // ===========================================================================

  async listTenants(query: TenantQueryDto) {
    const { items, total } = await this.tenants.searchCompanies({
      status: query.status,
      q: query.q,
      skip: query.skip,
      take: query.take,
    });

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  async getTenant(companyId: string) {
    const company = await this.tenants.findCompany(companyId);
    if (!company) {
      throw new AppException('TEN_NOT_FOUND');
    }
    return company;
  }

  /**
   * FR-ADM-TEN-02 — tạo tenant mới.
   *
   * Mã công ty là BẤT BIẾN suốt vòng đời (docs/01 mục 8) vì nó nằm trong mọi
   * employee code đã sinh ra.
   */
  async createTenant(ctx: RequestContext, input: CreateTenantInput) {
    const code = normalizeFullName(input.code).replace(/\s/g, '');
    if (!code) {
      throw new AppException('SYS_VALIDATION_ERROR', { reason: 'Mã công ty không hợp lệ.' });
    }

    const existing = await this.tenants.findCompanyByCode(code);
    if (existing) {
      throw new AppException('TEN_CODE_TAKEN', { code });
    }

    const domain = (input.domain ?? code).trim().toLowerCase();
    const domainTaken = await this.tenants.findCompanyByDomain(domain);
    if (domainTaken) {
      throw new AppException('TEN_DOMAIN_TAKEN', { domain });
    }

    // Tên miền quy ước của quản trị viên nền tảng không được cấp cho công ty —
    // trùng thì công ty đó vĩnh viễn không đăng nhập được.
    const systemDomain = this.config.get<string>('app.systemAdminDomain', 'system');
    if (domain === systemDomain) {
      throw new AppException('TEN_DOMAIN_TAKEN', {
        domain,
        reason: 'Tên miền này dành riêng cho quản trị viên nền tảng.',
      });
    }

    const company = await this.tenants.createCompany({
      code,
      domain,
      name: input.name,
      taxCode: input.taxCode ?? null,
      timezone: input.timezone ?? 'Asia/Ho_Chi_Minh',
      planId: input.planId ?? null,
      status: CompanyStatus.TRIAL,
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await this.audit.record(ctx, {
      companyId: company.id,
      action: 'TENANT_CREATE',
      targetType: 'COMPANY',
      targetId: company.id,
      after: { code, domain, name: input.name },
    });

    return company;
  }

  /**
   * FR-ADM-TEN-06 — tạm ngưng công ty.
   * Dữ liệu GIỮ NGUYÊN, khôi phục được ngay khi thanh toán (docs/05 mục 1.1).
   */
  async suspendTenant(ctx: RequestContext, companyId: string, reason: string) {
    const company = await this.getTenant(companyId);

    await this.tenants.updateStatus(companyId, {
      status: CompanyStatus.SUSPENDED,
      suspendedAt: new Date(),
      suspendReason: reason,
    });

    // Thu hồi phiên của toàn bộ nhân viên công ty — chặn chấm công ngay lập tức.
    const userIds = await this.tenants.findLinkedUserIds(companyId);
    for (const userId of userIds) {
      await this.tokens.revokeAllForUser(userId, 'COMPANY_SUSPENDED');
    }

    await this.audit.record(ctx, {
      companyId,
      action: 'TENANT_SUSPEND',
      targetType: 'COMPANY',
      targetId: companyId,
      reason,
      before: { status: company.status },
      after: { status: CompanyStatus.SUSPENDED, revokedSessions: userIds.length },
    });

    return { status: CompanyStatus.SUSPENDED, revokedSessions: userIds.length };
  }

  async activateTenant(ctx: RequestContext, companyId: string, reason: string) {
    const company = await this.getTenant(companyId);

    await this.tenants.updateStatus(companyId, {
      status: CompanyStatus.ACTIVE,
      suspendedAt: null,
      suspendReason: null,
    });

    await this.audit.record(ctx, {
      companyId,
      action: 'TENANT_ACTIVATE',
      targetType: 'COMPANY',
      targetId: companyId,
      reason,
      before: { status: company.status },
      after: { status: CompanyStatus.ACTIVE },
    });

    return { status: CompanyStatus.ACTIVE };
  }

  /** FR-ADM-TEN-07 — thống kê sử dụng theo tenant. */
  async getUsage(companyId: string, from: Date, to: Date) {
    const { employeeCount, branchCount, attendanceCount, faceProfileCount } =
      await this.tenants.countUsage(companyId, from, to);

    const company = await this.tenants.findCompany(companyId);

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      employeeCount,
      branchCount,
      recognitionCount: attendanceCount,
      faceProfileCount,
      plan: company?.plan
        ? {
            name: company.plan.name,
            maxEmployees: company.plan.maxEmployees,
            maxBranches: company.plan.maxBranches,
            maxRecognitionsPerMonth: company.plan.maxRecognitionsPerMonth,
          }
        : null,
      quotaWarnings: this.buildQuotaWarnings(company?.plan, {
        employeeCount,
        branchCount,
        recognitionCount: attendanceCount,
      }),
    };
  }

  private buildQuotaWarnings(
    plan:
      | {
          maxEmployees: number | null;
          maxBranches: number | null;
          maxRecognitionsPerMonth: number | null;
        }
      | null
      | undefined,
    usage: { employeeCount: number; branchCount: number; recognitionCount: number },
  ): string[] {
    if (!plan) return [];
    const warnings: string[] = [];
    const nearLimit = (current: number, max: number | null) => max !== null && current >= max * 0.8;

    if (nearLimit(usage.employeeCount, plan.maxEmployees)) {
      warnings.push(
        `Số nhân viên ${usage.employeeCount}/${plan.maxEmployees} — sắp đạt giới hạn gói.`,
      );
    }
    if (nearLimit(usage.branchCount, plan.maxBranches)) {
      warnings.push(
        `Số chi nhánh ${usage.branchCount}/${plan.maxBranches} — sắp đạt giới hạn gói.`,
      );
    }
    if (nearLimit(usage.recognitionCount, plan.maxRecognitionsPerMonth)) {
      warnings.push(
        `Lượt nhận diện ${usage.recognitionCount}/${plan.maxRecognitionsPerMonth} — sắp đạt giới hạn gói.`,
      );
    }
    return warnings;
  }

  // ===========================================================================
  //  Gói dịch vụ
  // ===========================================================================

  async listPlans() {
    return this.tenants.listPlans();
  }

  async upsertPlan(data: {
    name: string;
    maxEmployees?: number | null;
    maxBranches?: number | null;
    maxRecognitionsPerMonth?: number | null;
    storageGb?: number | null;
    photoRetentionDays?: number;
    features?: Prisma.InputJsonValue;
    pricePerMonth?: number | null;
  }) {
    return this.tenants.upsertPlan(data);
  }

  async assignPlan(ctx: RequestContext, companyId: string, planId: string, reason: string) {
    const company = await this.getTenant(companyId);
    const plan = await this.tenants.findPlan(planId);
    if (!plan) {
      throw new AppException('SYS_NOT_FOUND', { reason: 'Gói dịch vụ không tồn tại.' });
    }

    await this.tenants.assignPlan(companyId, planId);

    await this.audit.record(ctx, {
      companyId,
      action: 'TENANT_PLAN_CHANGE',
      targetType: 'COMPANY',
      targetId: companyId,
      reason,
      before: { planId: company.planId },
      after: { planId },
    });

    return { planId, planName: plan.name };
  }
}
