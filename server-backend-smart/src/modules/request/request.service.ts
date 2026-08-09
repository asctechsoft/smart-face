import { Injectable, Logger } from '@nestjs/common';
import {
  Employee,
  LeaveRequest,
  Prisma,
  RequestStatus,
  RequestType,
  SystemRole,
} from '@prisma/client';
import { PaginatedResult } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import { buildMeta, eachWorkDate, toWorkDate } from 'src/common/utils';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { StorageService } from 'src/infra/storage/storage.service';
import { AttendanceService } from '../attendance/attendance.service';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../notification/realtime.gateway';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { FlowStepTemplate, RequestRepository } from './request.repository';
import type {
  ApproveRequestDto,
  BulkApproveDto,
  CreateRequestDto,
  RequestQueryDto,
  UpdateRequestDto,
} from './dto/request.dto';
import type { RequestContext, TenantContext } from 'src/common/types/request-context';

/**
 * Đơn từ — docs/03 mục 6, docs/04 mục 4.
 *
 * Workflow duyệt nhiều cấp: RequestType → ApprovalFlow → ApprovalFlowStep.
 * Khi gửi đơn, hệ thống sinh các `ApprovalStep` tương ứng ở trạng thái PENDING
 * và giải quyết người duyệt cụ thể ngay tại thời điểm đó.
 */
@Injectable()
export class RequestService {
  private readonly logger = new Logger(RequestService.name);

  constructor(
    private readonly requests: RequestRepository,
    private readonly transactions: TransactionManager,
    private readonly policy: PolicyService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
    private readonly attendance: AttendanceService,
  ) {}

  // ===========================================================================
  //  Danh mục & thông tin tham chiếu
  // ===========================================================================

  async listRequestTypes(companyId: string) {
    return this.requests.listActiveRequestTypes(companyId);
  }

  /**
   * FR-APP-REQ-02 — thông tin tham chiếu hiển thị TRƯỚC khi gửi đơn:
   * phép còn lại, giờ nợ/dư.
   */
  async getReference(companyId: string, employeeId: string) {
    const year = new Date().getUTCFullYear();

    const [balance, makeupRecords, pendingRequests] = await Promise.all([
      this.requests.findLeaveBalance(companyId, employeeId, year),
      this.requests.findOpenMakeupRecords(companyId, employeeId),
      this.requests.countPendingRequests(companyId, employeeId),
    ]);

    const entitled = Number(balance?.entitledDays ?? 0) + Number(balance?.carriedOverDays ?? 0);
    const used = Number(balance?.usedDays ?? 0);
    const pending = Number(balance?.pendingDays ?? 0);

    return {
      year,
      annualLeave: {
        entitledDays: entitled,
        usedDays: used,
        pendingDays: pending,
        remainingDays: Math.max(0, entitled - used - pending),
      },
      makeup: {
        debtMinutes: makeupRecords.reduce((sum, record) => sum + record.remainingMinutes, 0),
        openRecords: makeupRecords.length,
      },
      pendingRequestCount: pendingRequests,
    };
  }

  // ===========================================================================
  //  Tạo & sửa đơn
  // ===========================================================================

  async create(ctx: TenantContext, dto: CreateRequestDto) {
    const employee = await this.requireEmployee(ctx);
    const requestType = await this.requireRequestType(ctx.companyId, dto.requestTypeCode);

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt < startAt) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Ngày kết thúc phải sau ngày bắt đầu.',
      });
    }

    // BR-REQ-04: đơn rơi vào kỳ lương đã chốt thì chặn.
    await this.assertPeriodOpen(ctx.companyId, startAt, endAt);

    // BR-REQ-02: không cho tạo đơn chồng lấn thời gian.
    await this.assertNoOverlap(ctx.companyId, employee.id, startAt, endAt);

    const quantity = this.computeQuantity(requestType, startAt, endAt, dto.isHalfDay ?? false);

    if (requestType.maxDaysPerRequest && quantity > requestType.maxDaysPerRequest) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: `Loại đơn này tối đa ${requestType.maxDaysPerRequest} ngày mỗi lần.`,
      });
    }

    // BR-REQ-01 + FR-APP-REQ-10: kiểm tra số dư phép.
    if (requestType.deductFrom === 'ANNUAL_LEAVE') {
      await this.assertLeaveBalance(ctx.companyId, employee.id, quantity);
    }

    const submitNow = dto.submitNow ?? true;

    // BR-REQ-05: loại đơn bắt buộc minh chứng thì không cho gửi thẳng.
    if (submitNow && requestType.requiresAttachment) {
      throw new AppException('REQ_ATTACHMENT_REQUIRED', {
        reason: 'Hãy lưu nháp, đính kèm minh chứng rồi bấm Gửi đơn.',
      });
    }

    const request = await this.requests.create(ctx.companyId, {
      employeeId: employee.id,
      requestTypeId: requestType.id,
      status: submitNow ? RequestStatus.PENDING : RequestStatus.DRAFT,
      startAt,
      endAt,
      quantity,
      isHalfDay: dto.isHalfDay ?? false,
      reason: dto.reason,
      expectedReturnAt: dto.expectedReturnAt ? new Date(dto.expectedReturnAt) : null,
      submittedAt: submitNow ? new Date() : null,
    });

    if (submitNow) {
      await this.generateApprovalSteps(ctx.companyId, request, requestType, employee);
      await this.reservePendingLeave(ctx.companyId, employee.id, requestType, quantity);
      await this.notifyApprovers(ctx.companyId, request.id);
    }

    return this.getDetail(ctx.companyId, request.id);
  }

  async update(ctx: TenantContext, requestId: string, dto: UpdateRequestDto) {
    const request = await this.requireOwnRequest(ctx, requestId);
    if (request.status !== RequestStatus.DRAFT) {
      throw new AppException('REQ_INVALID_STATUS', {
        reason: 'Chỉ sửa được đơn ở trạng thái nháp.',
      });
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : request.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : request.endAt;
    const requestType = await this.requireRequestTypeById(ctx.companyId, request.requestTypeId);

    const updated = await this.requests.updateDraft(ctx.companyId, requestId, {
      startAt,
      endAt,
      isHalfDay: dto.isHalfDay ?? request.isHalfDay,
      reason: dto.reason ?? request.reason,
      quantity: this.computeQuantity(
        requestType,
        startAt,
        endAt,
        dto.isHalfDay ?? request.isHalfDay,
      ),
    });
    if (!updated) {
      throw new AppException('REQ_INVALID_STATUS', {
        reason: 'Chỉ sửa được đơn ở trạng thái nháp.',
      });
    }
    return updated;
  }

  async submit(ctx: TenantContext, requestId: string) {
    const request = await this.requireOwnRequest(ctx, requestId);
    if (request.status !== RequestStatus.DRAFT) {
      throw new AppException('REQ_INVALID_STATUS');
    }

    const requestType = await this.requireRequestTypeById(ctx.companyId, request.requestTypeId);
    const employee = await this.requireEmployee(ctx);

    // BR-REQ-05
    if (requestType.requiresAttachment) {
      const attachmentCount = await this.requests.countAttachments(ctx.companyId, requestId);
      if (attachmentCount === 0) {
        throw new AppException('REQ_ATTACHMENT_REQUIRED');
      }
    }

    await this.assertPeriodOpen(ctx.companyId, request.startAt, request.endAt);
    await this.assertNoOverlap(
      ctx.companyId,
      employee.id,
      request.startAt,
      request.endAt,
      requestId,
    );

    if (requestType.deductFrom === 'ANNUAL_LEAVE') {
      await this.assertLeaveBalance(ctx.companyId, employee.id, Number(request.quantity));
    }

    const updated = await this.requests.updateStatus(ctx.companyId, requestId, {
      status: RequestStatus.PENDING,
      submittedAt: new Date(),
    });
    if (!updated) {
      throw new AppException('REQ_NOT_FOUND');
    }

    await this.generateApprovalSteps(ctx.companyId, updated, requestType, employee);
    await this.reservePendingLeave(
      ctx.companyId,
      employee.id,
      requestType,
      Number(request.quantity),
    );
    await this.notifyApprovers(ctx.companyId, requestId);

    return this.getDetail(ctx.companyId, requestId);
  }

  async cancel(ctx: TenantContext, requestId: string, reason?: string) {
    const request = await this.requireOwnRequest(ctx, requestId);

    if (request.status === RequestStatus.CANCELLED || request.status === RequestStatus.REJECTED) {
      throw new AppException('REQ_INVALID_STATUS');
    }

    // FR-APP-REQ-06: huỷ đơn ĐÃ DUYỆT chỉ khi chính sách cho phép và chưa tới ngày áp dụng.
    if (request.status === RequestStatus.APPROVED) {
      const allowed = await this.policy.getBoolean(
        ctx.companyId,
        PolicyKeys.REQUEST_ALLOW_CANCEL_AFTER_APPROVAL,
      );
      if (!allowed) {
        throw new AppException('REQ_INVALID_STATUS', {
          reason: 'Chính sách công ty không cho huỷ đơn đã duyệt.',
        });
      }
      if (request.startAt <= new Date()) {
        throw new AppException('REQ_INVALID_STATUS', {
          reason: 'Đơn đã tới ngày áp dụng, không huỷ được.',
        });
      }
    }

    const requestType = await this.requireRequestTypeById(ctx.companyId, request.requestTypeId);

    await this.transactions.run(async (tx) => {
      await this.requests.updateStatus(
        ctx.companyId,
        requestId,
        {
          status: RequestStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: ctx.userId,
          rejectReason: reason,
        },
        tx,
      );
      await this.requests.skipPendingSteps(ctx.companyId, requestId, tx);
    });

    await this.releaseLeaveReservation(
      ctx.companyId,
      request.employeeId,
      requestType,
      Number(request.quantity),
      request.status === RequestStatus.APPROVED,
    );

    // Đơn đã duyệt bị huỷ → phải tính lại công của khoảng đó.
    if (request.status === RequestStatus.APPROVED) {
      await this.triggerRecalculation(ctx.companyId, request);
    }

    return { cancelled: true };
  }

  // ===========================================================================
  //  Duyệt đơn
  // ===========================================================================

  async approve(ctx: TenantContext, requestId: string, dto: ApproveRequestDto) {
    const result = await this.decide(ctx, requestId, 'APPROVED', dto.comment);
    return result;
  }

  async reject(ctx: TenantContext, requestId: string, reason: string) {
    if (!reason?.trim()) {
      throw new AppException('REQ_REJECT_REASON_REQUIRED');
    }
    return this.decide(ctx, requestId, 'REJECTED', reason);
  }

  /**
   * BR-APV-05 — duyệt hàng loạt vẫn kiểm tra từng đơn.
   * Đơn nào vi phạm ràng buộc thì báo lỗi riêng, KHÔNG fail cả lô.
   */
  async bulkApprove(ctx: TenantContext, dto: BulkApproveDto) {
    const approved: string[] = [];
    const failed: Array<{ id: string; code: string; message: string }> = [];

    for (const requestId of dto.requestIds) {
      try {
        await this.decide(ctx, requestId, 'APPROVED', dto.comment);
        approved.push(requestId);
      } catch (error) {
        if (error instanceof AppException) {
          failed.push({
            id: requestId,
            code: error.code,
            message: error.definition.message,
          });
        } else {
          failed.push({
            id: requestId,
            code: 'SYS_INTERNAL_ERROR',
            message: (error as Error).message,
          });
        }
      }
    }

    return { approved, failed };
  }

  private async decide(
    ctx: TenantContext,
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    const request = await this.requests.findForDecision(ctx.companyId, requestId);
    if (!request) {
      throw new AppException('REQ_NOT_FOUND');
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new AppException('REQ_ALREADY_DECIDED', { status: request.status });
    }

    // BR-APV-03: không được duyệt đơn của chính mình.
    if (request.employeeId === ctx.employeeId) {
      throw new AppException('REQ_CANNOT_APPROVE_OWN');
    }

    // BR-REQ-04: đơn nằm trong kỳ đã chốt thì không duyệt được.
    await this.assertPeriodOpen(ctx.companyId, request.startAt, request.endAt);

    const currentStep = request.approvalSteps.find((step) => step.status === 'PENDING');
    if (!currentStep) {
      throw new AppException('REQ_ALREADY_DECIDED');
    }

    // Người duyệt phải đúng người được phân công, hoặc có vai trò tương ứng.
    const canApprove =
      ctx.isSystemAdmin ||
      currentStep.approverId === ctx.employeeId ||
      this.roleMatchesApprover(ctx.roles, currentStep.approverRole);
    if (!canApprove) {
      throw new AppException('REQ_NOT_YOUR_TURN', {
        requiredRole: currentStep.approverRole,
        assignedApproverId: currentStep.approverId,
      });
    }

    if (decision === 'REJECTED') {
      // BR-APV-02: một cấp từ chối → đơn TỪ CHỐI ngay, các cấp sau không xử lý.
      await this.transactions.run(async (tx) => {
        await this.requests.recordStepDecision(
          ctx.companyId,
          currentStep.id,
          {
            status: 'REJECTED',
            decidedAt: new Date(),
            comment,
            approverId: ctx.employeeId ?? currentStep.approverId,
          },
          tx,
        );
        await this.requests.skipPendingSteps(ctx.companyId, requestId, tx);
        await this.requests.updateStatus(
          ctx.companyId,
          requestId,
          {
            status: RequestStatus.REJECTED,
            decidedAt: new Date(),
            rejectReason: comment,
          },
          tx,
        );
      });

      await this.releaseLeaveReservation(
        ctx.companyId,
        request.employeeId,
        request.requestType,
        Number(request.quantity),
        false,
      );

      await this.notifyDecision(ctx.companyId, request, 'REJECTED', comment);
      return this.getDetail(ctx.companyId, requestId);
    }

    // --- Duyệt ----------------------------------------------------------------
    await this.requests.recordStepDecision(ctx.companyId, currentStep.id, {
      status: 'APPROVED',
      decidedAt: new Date(),
      comment,
      approverId: ctx.employeeId ?? currentStep.approverId,
    });

    const remaining = await this.requests.countPendingSteps(ctx.companyId, requestId);

    // BR-APV-01: chỉ APPROVED khi TẤT CẢ cấp bắt buộc đã duyệt.
    if (remaining > 0) {
      await this.notifyApprovers(ctx.companyId, requestId);
      return this.getDetail(ctx.companyId, requestId);
    }

    await this.requests.updateStatus(ctx.companyId, requestId, {
      status: RequestStatus.APPROVED,
      decidedAt: new Date(),
    });

    // BR-REQ-01: trừ phép TẠI THỜI ĐIỂM ĐƯỢC DUYỆT, không phải lúc gửi.
    await this.commitLeaveDeduction(
      ctx.companyId,
      request.employeeId,
      request.requestType,
      Number(request.quantity),
    );

    // BR-APV-06 + BR-REQ-03: tính lại công cho khoảng thời gian của đơn,
    // kể cả khi đơn được duyệt NGƯỢC VỀ QUÁ KHỨ.
    await this.triggerRecalculation(ctx.companyId, request);

    await this.notifyDecision(ctx.companyId, request, 'APPROVED', comment);
    return this.getDetail(ctx.companyId, requestId);
  }

  // ===========================================================================
  //  Truy vấn
  // ===========================================================================

  async list(ctx: TenantContext, query: RequestQueryDto, departmentScope: string[] | null) {
    // ScopeGuard: MANAGER chỉ thấy đơn của phòng ban mình quản lý.
    const employeeIdScope =
      departmentScope || query.departmentId
        ? await this.requests.findEmployeeIdsInScope(
            ctx.companyId,
            query.departmentId,
            departmentScope,
          )
        : null;

    const { items, total } = await this.requests.search(ctx.companyId, {
      employeeId:
        query.mineOnly && ctx.employeeId ? ctx.employeeId : (query.employeeId ?? undefined),
      status: query.status,
      requestTypeCode: query.requestTypeCode,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      employeeIdScope,
      skip: query.skip,
      take: query.take,
    });

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  /** "Đơn tôi cần duyệt" — dựa trên ApprovalStep đang PENDING. */
  async listPendingApproval(ctx: TenantContext, query: RequestQueryDto) {
    const { items, total } = await this.requests.searchPendingApproval(
      ctx.companyId,
      {
        employeeId: ctx.employeeId ?? null,
        approverRoles: this.approverRolesFor(ctx.roles),
      },
      { skip: query.skip, take: query.take },
    );

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  async getDetail(companyId: string, requestId: string) {
    const request = await this.requests.findDetail(companyId, requestId);
    if (!request) {
      throw new AppException('REQ_NOT_FOUND');
    }

    const approverIds = request.approvalSteps
      .map((step) => step.approverId)
      .filter((id): id is string => Boolean(id));
    const approvers = await this.requests.findEmployeeNames(companyId, approverIds);
    const approverMap = new Map(approvers.map((approver) => [approver.id, approver.fullName]));

    return {
      ...request,
      approvalSteps: request.approvalSteps.map((step) => ({
        ...step,
        approverName: step.approverId ? (approverMap.get(step.approverId) ?? null) : null,
      })),
      attachments: await Promise.all(
        request.attachments.map(async (attachment) => ({
          ...attachment,
          url: await this.storage.getPresignedUrl(attachment.fileKey),
        })),
      ),
    };
  }

  // ===========================================================================
  //  Đính kèm
  // ===========================================================================

  async addAttachment(
    ctx: TenantContext,
    requestId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const request = await this.requireOwnRequest(ctx, requestId);

    const [maxCount, maxMb] = await Promise.all([
      this.policy.getNumber(ctx.companyId, PolicyKeys.REQUEST_MAX_ATTACHMENTS),
      this.policy.getNumber(ctx.companyId, PolicyKeys.REQUEST_MAX_ATTACHMENT_MB),
    ]);

    // BR-REQ-06: giới hạn dung lượng và định dạng.
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new AppException('REQ_ATTACHMENT_INVALID', { mimeType: file.mimetype, allowedTypes });
    }
    if (file.size > maxMb * 1024 * 1024) {
      throw new AppException('REQ_ATTACHMENT_INVALID', { sizeBytes: file.size, maxMb });
    }

    const count = await this.requests.countAttachments(ctx.companyId, requestId);
    if (count >= maxCount) {
      throw new AppException('REQ_ATTACHMENT_INVALID', {
        reason: `Tối đa ${maxCount} file mỗi đơn.`,
      });
    }

    const key = this.storage.buildRequestAttachmentKey(
      ctx.companyId,
      request.id,
      file.originalname,
    );
    await this.storage.upload(key, file.buffer, file.mimetype);

    return this.requests.createAttachment(ctx.companyId, {
      requestId,
      fileKey: key,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
  }

  // ===========================================================================
  //  Workflow duyệt
  // ===========================================================================

  /**
   * Sinh các bước duyệt tại thời điểm GỬI ĐƠN và giải quyết người duyệt cụ thể.
   *
   * Điều kiện kích hoạt bước (`condition`) hỗ trợ `{ "minDays": 3 }` —
   * ví dụ "Cấp 2: HR, bắt buộc nếu > 3 ngày" (docs/04 mục 4.1).
   */
  private async generateApprovalSteps(
    companyId: string,
    request: LeaveRequest,
    requestType: RequestType,
    employee: Employee,
  ): Promise<void> {
    const flowSteps = await this.requests.findFlowSteps(companyId, requestType.id);

    // Không cấu hình luồng → mặc định 1 cấp: quản lý trực tiếp.
    const steps: FlowStepTemplate[] = flowSteps.length
      ? flowSteps
      : [{ order: 1, approverRole: 'DIRECT_MANAGER', condition: null }];

    const quantity = Number(request.quantity);
    const applicable = steps.filter((step) => this.stepApplies(step.condition, quantity));

    const seeds = await Promise.all(
      applicable.map(async (step) => ({
        order: step.order,
        approverRole: step.approverRole,
        approverId: await this.resolveApprover(companyId, step.approverRole, employee),
      })),
    );

    await this.transactions.run(async (tx) => {
      await this.requests.replaceApprovalSteps(companyId, request.id, seeds, tx);
    });
  }

  /**
   * Bước duyệt này có áp dụng cho đơn có độ dài `quantity` ngày không?
   *
   * Cho phép luồng duyệt theo NGƯỠNG: nghỉ 1 ngày chỉ cần trưởng phòng, nghỉ từ
   * 3 ngày trở lên mới thêm bước HR. Điều kiện lưu dạng JSON trong
   * `ApprovalFlowStep.condition` để công ty tự cấu hình mà không cần sửa code.
   *
   * Không có điều kiện → ÁP DỤNG (trả `true`). Mặc định này an toàn theo hướng
   * đúng: thừa một bước duyệt thì chỉ chậm hơn, còn thiếu bước duyệt là đơn được
   * thông qua mà đáng lẽ phải có người xem.
   *
   * Ba lần kiểm tra kiểu ở dòng đầu là vì `Prisma.JsonValue` có thể là số, chuỗi,
   * mảng hoặc null — dữ liệu cũ hoặc cấu hình sai đều không được làm sập luồng.
   */
  private stepApplies(condition: Prisma.JsonValue | null, quantity: number): boolean {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return true;
    const rule = condition as { minDays?: number; maxDays?: number };
    if (rule.minDays != null && quantity < rule.minDays) return false;
    if (rule.maxDays != null && quantity > rule.maxDays) return false;
    return true;
  }

  /**
   * Giải quyết người duyệt cụ thể cho một vai trò tại thời điểm gửi đơn.
   *
   * Trả `null` KHÔNG phải là lỗi mà là "để ngỏ": ai mang vai trò tương ứng cũng
   * duyệt được. Dùng cho HR_PAYROLL và COMPANY_ADMIN — chỉ định đích danh một
   * người thì người đó nghỉ phép là mọi đơn treo lại chờ họ về.
   *
   * `DIRECT_MANAGER` thì ngược lại, phải chỉ đích danh trưởng phòng, vì "quản lý
   * trực tiếp" của mỗi nhân viên là một người khác nhau.
   */
  private async resolveApprover(
    companyId: string,
    approverRole: string,
    employee: Employee,
  ): Promise<string | null> {
    if (approverRole === 'DIRECT_MANAGER' || approverRole === 'DEPARTMENT_HEAD') {
      if (!employee.departmentId) return null;
      const managerId = await this.requests.findDepartmentManagerId(
        companyId,
        employee.departmentId,
      );
      // Trưởng phòng không tự duyệt đơn của chính mình (BR-APV-03).
      if (managerId && managerId !== employee.id) {
        return managerId;
      }
      return null;
    }

    // HR_PAYROLL / COMPANY_ADMIN: để null, ai có vai trò đó đều duyệt được.
    return null;
  }

  /**
   * Người có các vai trò `roles` có đủ tư cách duyệt bước `approverRole` không?
   *
   * COMPANY_ADMIN khớp với MỌI bước — họ là phương án dự phòng khi trưởng phòng
   * hoặc HR vắng mặt, để đơn không treo vô thời hạn.
   *
   * `default: return false` là chốt an toàn quan trọng: thêm một loại bước duyệt
   * mới vào cấu hình mà quên khai ở đây thì KHÔNG AI duyệt được — lỗi lộ ra ngay.
   * Nếu mặc định là `true` thì bước mới sẽ được mọi người duyệt, âm thầm bỏ qua
   * chốt phê duyệt mà không ai biết.
   */
  private roleMatchesApprover(roles: SystemRole[], approverRole: string): boolean {
    switch (approverRole) {
      case 'DIRECT_MANAGER':
      case 'DEPARTMENT_HEAD':
        return roles.includes(SystemRole.MANAGER) || roles.includes(SystemRole.COMPANY_ADMIN);
      case 'HR_PAYROLL':
        return roles.includes(SystemRole.HR_PAYROLL) || roles.includes(SystemRole.COMPANY_ADMIN);
      case 'COMPANY_ADMIN':
        return roles.includes(SystemRole.COMPANY_ADMIN);
      default:
        return false;
    }
  }

  /**
   * Chiều ngược của `roleMatchesApprover`: từ vai trò của người dùng suy ra các
   * loại bước duyệt họ có thể xử lý.
   *
   * Cần cả hai chiều vì phục vụ hai việc khác nhau: hàm kia KIỂM TRA quyền trên
   * một đơn cụ thể, hàm này dựng mệnh đề WHERE cho màn hình "đơn tôi cần duyệt".
   * Hỏi database "bước nào người này duyệt được" thì phải có sẵn danh sách.
   *
   * `new Set` khử trùng lặp vì người vừa là MANAGER vừa là COMPANY_ADMIN sẽ có
   * `DIRECT_MANAGER` hai lần — lọt vào mệnh đề `IN` là dư thừa vô ích.
   *
   * ⚠ Sửa hàm này thì phải sửa `roleMatchesApprover` tương ứng. Hai hàm lệch
   * nhau sẽ tạo ra lỗi khó chịu: đơn hiện trong danh sách cần duyệt nhưng bấm
   * duyệt lại báo không có quyền.
   */
  private approverRolesFor(roles: SystemRole[]): string[] {
    const result: string[] = [];
    if (roles.includes(SystemRole.MANAGER)) result.push('DIRECT_MANAGER', 'DEPARTMENT_HEAD');
    if (roles.includes(SystemRole.HR_PAYROLL)) result.push('HR_PAYROLL');
    if (roles.includes(SystemRole.COMPANY_ADMIN)) {
      result.push('DIRECT_MANAGER', 'DEPARTMENT_HEAD', 'HR_PAYROLL', 'COMPANY_ADMIN');
    }
    return [...new Set(result)];
  }

  // ===========================================================================
  //  Số dư phép
  // ===========================================================================

  private async assertLeaveBalance(
    companyId: string,
    employeeId: string,
    quantity: number,
  ): Promise<void> {
    const blockWhenInsufficient = await this.policy.getBoolean(
      companyId,
      PolicyKeys.REQUEST_BLOCK_WHEN_INSUFFICIENT_LEAVE,
    );

    const reference = await this.getReference(companyId, employeeId);
    if (quantity > reference.annualLeave.remainingDays) {
      if (blockWhenInsufficient) {
        throw new AppException('REQ_INSUFFICIENT_LEAVE', {
          requested: quantity,
          remaining: reference.annualLeave.remainingDays,
        });
      }
      this.logger.warn(
        `Nhân viên ${employeeId} tạo đơn ${quantity} ngày nhưng chỉ còn ${reference.annualLeave.remainingDays} — chính sách cho phép vượt.`,
      );
    }
  }

  /** Đơn PENDING giữ chỗ vào `pendingDays`, chưa trừ `usedDays`. */
  private async reservePendingLeave(
    companyId: string,
    employeeId: string,
    requestType: RequestType,
    quantity: number,
  ): Promise<void> {
    if (requestType.deductFrom !== 'ANNUAL_LEAVE') return;
    const year = new Date().getUTCFullYear();

    await this.requests.reservePendingDays(companyId, employeeId, year, quantity);
  }

  /** BR-REQ-01 — trừ phép TẠI THỜI ĐIỂM DUYỆT. */
  private async commitLeaveDeduction(
    companyId: string,
    employeeId: string,
    requestType: RequestType,
    quantity: number,
  ): Promise<void> {
    if (requestType.deductFrom !== 'ANNUAL_LEAVE') return;
    const year = new Date().getUTCFullYear();

    await this.requests.commitUsedDays(companyId, employeeId, year, quantity);
  }

  private async releaseLeaveReservation(
    companyId: string,
    employeeId: string,
    requestType: RequestType,
    quantity: number,
    wasApproved: boolean,
  ): Promise<void> {
    if (requestType.deductFrom !== 'ANNUAL_LEAVE') return;
    const year = new Date().getUTCFullYear();

    await this.requests.releaseDays(employeeId, year, quantity, wasApproved);
  }

  // ===========================================================================
  //  Helper
  // ===========================================================================

  /** BR-REQ-02 — chặn đơn chồng lấn với đơn đang chờ duyệt hoặc đã duyệt. */
  private async assertNoOverlap(
    companyId: string,
    employeeId: string,
    startAt: Date,
    endAt: Date,
    excludeRequestId?: string,
  ): Promise<void> {
    const overlapping = await this.requests.findOverlapping(
      companyId,
      employeeId,
      startAt,
      endAt,
      excludeRequestId,
    );

    if (overlapping) {
      throw new AppException('REQ_OVERLAP', {
        conflictingRequestId: overlapping.id,
        conflictRange: {
          startAt: overlapping.startAt.toISOString(),
          endAt: overlapping.endAt.toISOString(),
        },
      });
    }
  }

  /** BR-REQ-04 / BR-07 */
  private async assertPeriodOpen(companyId: string, startAt: Date, endAt: Date): Promise<void> {
    const closed = await this.requests.findClosedPeriodOverlapping(companyId, startAt, endAt);
    if (closed) {
      throw new AppException('REQ_PERIOD_LOCKED', { period: closed.name });
    }
  }

  private computeQuantity(
    requestType: RequestType,
    startAt: Date,
    endAt: Date,
    isHalfDay: boolean,
  ): number {
    if (requestType.unit === 'HOUR') {
      return Math.round(((endAt.getTime() - startAt.getTime()) / 3_600_000) * 100) / 100;
    }
    if (isHalfDay) return 0.5;

    const days = eachWorkDate(toWorkDate(startAt, 'UTC'), toWorkDate(endAt, 'UTC')).length;
    return Math.max(days, 1);
  }

  /** BR-APV-06 / BR-REQ-03 — tính lại công cho toàn bộ khoảng của đơn. */
  private async triggerRecalculation(
    companyId: string,
    request: { employeeId: string; startAt: Date; endAt: Date },
  ): Promise<void> {
    const timezone = await this.policy.getTimezone(companyId);
    const dates = eachWorkDate(
      toWorkDate(request.startAt, timezone),
      toWorkDate(request.endAt, timezone),
    );

    for (const workDate of dates) {
      await this.attendance.enqueueRecalculate(companyId, request.employeeId, workDate);
    }
  }

  private async notifyApprovers(companyId: string, requestId: string): Promise<void> {
    const request = await this.requests.findNextPendingStepContext(companyId, requestId);
    if (!request) return;

    const step = request.approvalSteps[0];
    if (!step) return;

    if (step.approverId) {
      await this.notifications.notify({
        companyId,
        employeeId: step.approverId,
        type: 'REQUEST_PENDING',
        title: 'Có đơn mới cần duyệt',
        body: `${request.employee.fullName} gửi đơn ${request.requestType.name}.`,
        data: { requestId },
      });
    } else {
      // Bước duyệt theo vai trò → phát realtime cho toàn bộ người có vai trò đó.
      this.realtime.emitToCompanyRoles(
        companyId,
        [SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN],
        'request.pending',
        { requestId, requestType: request.requestType.name },
      );
    }
  }

  private async notifyDecision(
    companyId: string,
    request: { id: string; employeeId: string; requestType: { name: string } },
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ): Promise<void> {
    await this.notifications.notify({
      companyId,
      employeeId: request.employeeId,
      type: decision === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
      title:
        decision === 'APPROVED'
          ? `Đơn ${request.requestType.name} đã được duyệt`
          : `Đơn ${request.requestType.name} bị từ chối`,
      body: comment ?? (decision === 'APPROVED' ? 'Đơn của bạn đã được chấp thuận.' : ''),
      data: { requestId: request.id },
    });

    this.realtime.emitToEmployee(request.employeeId, 'request.decided', {
      requestId: request.id,
      decision,
      comment,
    });
  }

  private async requireEmployee(ctx: RequestContext): Promise<Employee> {
    if (!ctx.employeeId || !ctx.companyId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    const employee = await this.requests.findEmployee(ctx.companyId, ctx.employeeId);
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }
    return employee;
  }

  private async requireRequestType(companyId: string, code: string): Promise<RequestType> {
    const requestType = await this.requests.findRequestTypeByCode(companyId, code);
    if (!requestType) {
      throw new AppException('REQ_TYPE_NOT_FOUND', { code });
    }
    return requestType;
  }

  /**
   * Loại đơn của một đơn đã tồn tại.
   *
   * Tách khỏi `requireRequestType` vì tra theo id chứ không theo mã, và vẫn phải
   * kèm `companyId` — id lấy từ bản ghi đơn nhưng ràng buộc tenant không được
   * dựa vào việc "id này chắc chắn đúng công ty" (BR-09).
   */
  private async requireRequestTypeById(companyId: string, id: string): Promise<RequestType> {
    const requestType = await this.requests.findRequestTypeById(companyId, id);
    if (!requestType) {
      throw new AppException('REQ_TYPE_NOT_FOUND');
    }
    return requestType;
  }

  private async requireOwnRequest(ctx: TenantContext, requestId: string): Promise<LeaveRequest> {
    const request = await this.requests.findById(ctx.companyId, requestId);
    if (!request) {
      throw new AppException('REQ_NOT_FOUND');
    }
    if (request.employeeId !== ctx.employeeId && !ctx.isSystemAdmin) {
      throw new AppException('AUTH_FORBIDDEN');
    }
    return request;
  }
}
