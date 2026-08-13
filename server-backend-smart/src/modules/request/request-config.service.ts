import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import type { TenantContext } from 'src/common/types/request-context';
import { AuditService } from '../audit/audit.service';
import {
  ApprovalFlowStepDto,
  ReplaceApprovalFlowDto,
  UpsertRequestTypeDto,
} from './dto/request-config.dto';
import { RequestRepository } from './request.repository';

/**
 * Cấu hình loại đơn và luồng duyệt — `FR-WEB-REQ-05`, docs/04 mục 4.1.
 *
 * Tách khỏi `RequestService` vì hai vòng đời khác hẳn nhau: service kia xử lý
 * TỪNG ĐƠN (tạo, gửi, duyệt) hàng trăm lần mỗi ngày, còn ở đây là cấu hình
 * "luật chơi" mà cả công ty đổi vài lần một năm. Trộn chung thì một class phải
 * mang cả hai bộ phụ thuộc, và ranh giới quyền cũng khác — duyệt đơn thì quản lý
 * làm được, đổi luồng duyệt thì không.
 */
@Injectable()
export class RequestConfigService {
  constructor(
    private readonly requests: RequestRepository,
    private readonly transactions: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  /** Kèm số đơn đã phát sinh: người cấu hình cần biết tắt loại này ảnh hưởng bao nhiêu. */
  async list(companyId: string) {
    const types = await this.requests.listAllRequestTypes(companyId);

    return Promise.all(
      types.map(async (type) => ({
        ...type,
        requestCount: await this.requests.countRequestsOfType(companyId, type.id),
        steps: this.presentSteps(type.approvalFlow?.steps ?? []),
      })),
    );
  }

  async create(ctx: TenantContext, dto: UpsertRequestTypeDto) {
    const taken = await this.requests.findRequestTypeByCodeAnyStatus(ctx.companyId, dto.code);
    if (taken) {
      throw new AppException('REQ_TYPE_CODE_TAKEN', { code: dto.code });
    }

    const created = await this.requests.createRequestType(ctx.companyId, {
      code: dto.code,
      name: dto.name,
      deductFrom: dto.deductFrom ?? 'NONE',
      unit: dto.unit ?? 'DAY',
      requiresAttachment: dto.requiresAttachment ?? false,
      requiresPreApproval: dto.requiresPreApproval ?? false,
      maxDaysPerRequest: dto.maxDaysPerRequest ?? null,
      isActive: dto.isActive ?? true,
    });

    await this.audit.record(ctx, {
      action: 'REQUEST_TYPE_CREATE',
      targetType: 'REQUEST_TYPE',
      targetId: created.id,
      after: { ...created },
    });

    return created;
  }

  /**
   * Sửa loại đơn.
   *
   * `code` bị KHOÁ sau khi có đơn phát sinh: mã nằm trong báo cáo và trong dữ
   * liệu đã xuất ra Excel của các kỳ trước. Đổi mã là làm những bản báo cáo đó
   * không đối chiếu lại được với hệ thống.
   */
  async update(ctx: TenantContext, id: string, dto: UpsertRequestTypeDto) {
    const existing = await this.requests.findRequestTypeById(ctx.companyId, id);
    if (!existing) {
      throw new AppException('REQ_TYPE_NOT_FOUND');
    }

    const usageCount = await this.requests.countRequestsOfType(ctx.companyId, id);
    if (dto.code !== existing.code) {
      if (usageCount > 0) {
        throw new AppException('REQ_TYPE_CODE_TAKEN', {
          reason: `Loại đơn đã có ${usageCount} đơn phát sinh nên không đổi được mã. Đổi tên hiển thị thay vì đổi mã.`,
        });
      }
      const taken = await this.requests.findRequestTypeByCodeAnyStatus(ctx.companyId, dto.code, id);
      if (taken) {
        throw new AppException('REQ_TYPE_CODE_TAKEN', { code: dto.code });
      }
    }

    const updated = await this.requests.updateRequestType(ctx.companyId, id, {
      code: dto.code,
      name: dto.name,
      deductFrom: dto.deductFrom ?? existing.deductFrom,
      unit: dto.unit ?? existing.unit,
      requiresAttachment: dto.requiresAttachment ?? existing.requiresAttachment,
      requiresPreApproval: dto.requiresPreApproval ?? existing.requiresPreApproval,
      maxDaysPerRequest: dto.maxDaysPerRequest ?? null,
      isActive: dto.isActive ?? existing.isActive,
    });

    await this.audit.record(ctx, {
      action: 'REQUEST_TYPE_UPDATE',
      targetType: 'REQUEST_TYPE',
      targetId: id,
      before: { ...existing },
      after: updated ? { ...updated } : undefined,
    });

    return updated;
  }

  /**
   * Thay toàn bộ luồng duyệt của một loại đơn — docs/04 mục 4.1.
   *
   * Đơn ĐANG CHỜ DUYỆT không bị ảnh hưởng: chúng đã có `ApprovalStep` riêng sinh
   * lúc gửi. Đó là chủ ý — đổi luồng giữa chừng mà áp ngược lên đơn đang chạy sẽ
   * làm đơn đã qua cấp 1 bỗng phải quay lại cấp 1 khác, hoặc tệ hơn là được duyệt
   * xong trong khi cấp mới thêm vào chưa ai xem.
   */
  async replaceFlow(ctx: TenantContext, requestTypeId: string, dto: ReplaceApprovalFlowDto) {
    const type = await this.requests.findRequestTypeWithFlow(ctx.companyId, requestTypeId);
    if (!type) {
      throw new AppException('REQ_TYPE_NOT_FOUND');
    }

    this.assertValidFlow(dto.steps);

    await this.transactions.run((tx) =>
      this.requests.replaceApprovalFlow(
        ctx.companyId,
        requestTypeId,
        dto.steps.map((step) => ({
          order: step.order,
          approverRole: step.approverRole,
          isRequired: step.isRequired ?? true,
          condition: this.toCondition(step),
        })),
        tx,
      ),
    );

    await this.audit.record(ctx, {
      action: 'APPROVAL_FLOW_UPDATE',
      targetType: 'REQUEST_TYPE',
      targetId: requestTypeId,
      before: { steps: this.presentSteps(type.approvalFlow?.steps ?? []) },
      after: { steps: dto.steps as unknown as Prisma.InputJsonValue },
    });

    const refreshed = await this.requests.findRequestTypeWithFlow(ctx.companyId, requestTypeId);
    return {
      ...refreshed,
      steps: this.presentSteps(refreshed?.approvalFlow?.steps ?? []),
    };
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  /**
   * Ba ràng buộc, mỗi cái chặn một cách hỏng luồng khác nhau:
   *
   *   - Thứ tự trùng nhau  → không xác định được cấp nào duyệt trước.
   *   - Thứ tự nhảy cóc    → `decide` tìm bước kế tiếp theo `order` liền kề,
   *                          khoảng trống làm đơn dừng lại giữa chừng.
   *   - Không có cấp nào bắt buộc → đơn gửi lên là tự động đủ điều kiện duyệt,
   *                          tức là bỏ hẳn chốt phê duyệt mà giao diện vẫn hiện
   *                          ra như đang có luồng.
   *
   * Luồng RỖNG hoàn toàn thì hợp lệ: `generateApprovalSteps` rơi về mặc định
   * một cấp quản lý trực tiếp.
   */
  private assertValidFlow(steps: ApprovalFlowStepDto[]): void {
    if (steps.length === 0) return;

    const orders = steps.map((step) => step.order).sort((a, b) => a - b);
    const hasDuplicate = new Set(orders).size !== orders.length;
    const isContiguous = orders.every((order, index) => order === index + 1);
    const hasRequired = steps.some((step) => step.isRequired ?? true);

    if (hasDuplicate || !isContiguous || !hasRequired) {
      throw new AppException('REQ_FLOW_INVALID', {
        orders,
        hasDuplicate,
        isContiguous,
        hasRequired,
      });
    }

    for (const step of steps) {
      if (step.minDays != null && step.maxDays != null && step.minDays > step.maxDays) {
        throw new AppException('REQ_FLOW_INVALID', {
          reason: `Cấp ${step.order}: ngưỡng tối thiểu ${step.minDays} lớn hơn tối đa ${step.maxDays} nên không đơn nào khớp.`,
        });
      }
    }
  }

  /** `undefined` chứ không phải `{}` khi không có ngưỡng — `stepApplies` đọc `{}` cũng ra "luôn áp dụng", nhưng lưu rỗng làm giao diện hiểu nhầm là có cấu hình. */
  private toCondition(step: ApprovalFlowStepDto): Prisma.InputJsonValue | undefined {
    if (step.minDays == null && step.maxDays == null) return undefined;
    return {
      ...(step.minDays != null ? { minDays: step.minDays } : {}),
      ...(step.maxDays != null ? { maxDays: step.maxDays } : {}),
    };
  }

  /** Trải `condition` thành `minDays`/`maxDays` để giao diện không phải bóc JSON. */
  private presentSteps(
    steps: Array<{
      order: number;
      approverRole: string;
      isRequired: boolean;
      condition: Prisma.JsonValue | null;
    }>,
  ) {
    return steps.map((step) => {
      const rule =
        step.condition && typeof step.condition === 'object' && !Array.isArray(step.condition)
          ? (step.condition as { minDays?: number; maxDays?: number })
          : {};

      return {
        order: step.order,
        approverRole: step.approverRole,
        isRequired: step.isRequired,
        minDays: rule.minDays ?? null,
        maxDays: rule.maxDays ?? null,
      };
    });
  }
}
