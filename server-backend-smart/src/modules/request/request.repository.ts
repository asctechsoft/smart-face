import { Injectable } from '@nestjs/common';
import {
  ApprovalStep,
  Employee,
  LeaveBalance,
  LeaveRequest,
  MakeupWorkRecord,
  PayrollPeriodStatus,
  Prisma,
  RequestAttachment,
  RequestStatus,
  RequestType,
} from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type RequestTypeWithFlow = Prisma.RequestTypeGetPayload<{
  include: { approvalFlow: { include: { steps: true } } };
}>;

export type RequestListItem = Prisma.LeaveRequestGetPayload<{
  include: {
    requestType: { select: { code: true; name: true; unit: true; deductFrom: true } };
    employee: { select: { id: true; fullName: true; employeeCode: true; departmentId: true } };
    approvalSteps: true;
    _count: { select: { attachments: true } };
  };
}>;

export type PendingApprovalItem = Prisma.LeaveRequestGetPayload<{
  include: {
    requestType: { select: { code: true; name: true; unit: true } };
    employee: { select: { id: true; fullName: true; employeeCode: true; departmentId: true } };
    approvalSteps: true;
  };
}>;

export type RequestDetail = Prisma.LeaveRequestGetPayload<{
  include: {
    requestType: true;
    employee: { select: { id: true; fullName: true; employeeCode: true; departmentId: true } };
    approvalSteps: true;
    attachments: true;
  };
}>;

export type RequestForDecision = Prisma.LeaveRequestGetPayload<{
  include: { requestType: true; approvalSteps: true; employee: true };
}>;

export type FlowStepTemplate = {
  order: number;
  approverRole: string;
  condition: Prisma.JsonValue | null;
};

export interface CreateRequestData {
  employeeId: string;
  requestTypeId: string;
  status: RequestStatus;
  startAt: Date;
  endAt: Date;
  quantity: number;
  isHalfDay: boolean;
  reason: string;
  expectedReturnAt: Date | null;
  submittedAt: Date | null;
}

export interface UpdateDraftData {
  startAt: Date;
  endAt: Date;
  isHalfDay: boolean;
  reason: string;
  quantity: number;
}

export interface RequestSearchFilter {
  employeeId?: string;
  status?: RequestStatus;
  requestTypeCode?: string;
  from?: Date;
  to?: Date;
  /** Danh sách nhân viên được phép xem — null nghĩa là không giới hạn. */
  employeeIdScope: string[] | null;
  skip: number;
  take: number;
}

export interface ApprovalStepSeed {
  order: number;
  approverRole: string;
  approverId: string | null;
}

/**
 * Truy cập dữ liệu đơn từ: `leave_request`, `approval_step`, `approval_flow`,
 * `request_type`, `request_attachment`, `leave_balance`, `makeup_work_record`.
 *
 * ## Vì sao gom nhiều bảng vào một repository
 *
 * Bảy bảng này là MỘT aggregate nghiệp vụ: không có thao tác nào chạm `approval_step`
 * mà không đi từ một `leave_request`, và số dư phép chỉ đổi khi đơn đổi trạng
 * thái. Tách ra bảy repository buộc mọi transaction phải nối tay qua nhiều đối
 * tượng mà không tách được cái gì có ý nghĩa.
 *
 * Các phương thức ghi đều nhận `tx` để `RequestService` gộp chúng vào một
 * transaction qua `TransactionManager` — quan trọng nhất ở luồng từ chối đơn,
 * nơi ba lệnh ghi phải cùng thành công hoặc cùng thất bại.
 */
@Injectable()
export class RequestRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Danh mục
  // ===========================================================================

  async listActiveRequestTypes(companyId: string): Promise<RequestTypeWithFlow[]> {
    return this.db().requestType.findMany({
      where: { companyId, isActive: true },
      include: { approvalFlow: { include: { steps: { orderBy: { order: 'asc' } } } } },
      orderBy: { code: 'asc' },
    });
  }

  async findRequestTypeByCode(companyId: string, code: string): Promise<RequestType | null> {
    return this.db().requestType.findFirst({ where: { companyId, code, isActive: true } });
  }

  async findRequestTypeById(companyId: string, id: string): Promise<RequestType | null> {
    return this.db().requestType.findFirst({ where: { id, companyId } });
  }

  // ===========================================================================
  //  Thông tin tham chiếu (FR-APP-REQ-02)
  // ===========================================================================

  async findLeaveBalance(
    companyId: string,
    employeeId: string,
    year: number,
  ): Promise<LeaveBalance | null> {
    return this.db().leaveBalance.findFirst({ where: { companyId, employeeId, year } });
  }

  async findOpenMakeupRecords(companyId: string, employeeId: string): Promise<MakeupWorkRecord[]> {
    return this.db().makeupWorkRecord.findMany({
      where: { companyId, employeeId, status: { in: ['OPEN', 'PARTIAL'] } },
    });
  }

  async countPendingRequests(companyId: string, employeeId: string): Promise<number> {
    return this.db().leaveRequest.count({
      where: { companyId, employeeId, status: RequestStatus.PENDING },
    });
  }

  // ===========================================================================
  //  Đơn
  // ===========================================================================

  async create(
    companyId: string,
    data: CreateRequestData,
    tx?: Prisma.TransactionClient,
  ): Promise<LeaveRequest> {
    return this.db(tx).leaveRequest.create({ data: { companyId, ...data } });
  }

  async findById(companyId: string, requestId: string): Promise<LeaveRequest | null> {
    return this.db().leaveRequest.findFirst({ where: { id: requestId, companyId } });
  }

  async findDetail(companyId: string, requestId: string): Promise<RequestDetail | null> {
    return this.db().leaveRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        requestType: true,
        employee: { select: { id: true, fullName: true, employeeCode: true, departmentId: true } },
        approvalSteps: { orderBy: { order: 'asc' } },
        attachments: true,
      },
    });
  }

  async findForDecision(companyId: string, requestId: string): Promise<RequestForDecision | null> {
    return this.db().leaveRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        requestType: true,
        approvalSteps: { orderBy: { order: 'asc' } },
        employee: true,
      },
    });
  }

  async updateDraft(
    companyId: string,
    requestId: string,
    data: UpdateDraftData,
    tx?: Prisma.TransactionClient,
  ): Promise<LeaveRequest | null> {
    const updated = await this.db(tx).leaveRequest.updateMany({
      where: { id: requestId, companyId, status: RequestStatus.DRAFT },
      data,
    });
    if (updated.count === 0) return null;
    return this.findById(companyId, requestId);
  }

  async updateStatus(
    companyId: string,
    requestId: string,
    data: {
      status: RequestStatus;
      submittedAt?: Date;
      decidedAt?: Date;
      cancelledAt?: Date;
      cancelledBy?: string;
      rejectReason?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<LeaveRequest | null> {
    const updated = await this.db(tx).leaveRequest.updateMany({
      where: { id: requestId, companyId },
      data,
    });
    if (updated.count === 0) return null;
    return this.findById(companyId, requestId);
  }

  /** BR-REQ-02 — đơn chồng lấn thời gian đang chờ duyệt hoặc đã duyệt. */
  async findOverlapping(
    companyId: string,
    employeeId: string,
    startAt: Date,
    endAt: Date,
    excludeRequestId?: string,
  ): Promise<Pick<LeaveRequest, 'id' | 'startAt' | 'endAt'> | null> {
    return this.db().leaveRequest.findFirst({
      where: {
        companyId,
        employeeId,
        status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] },
        startAt: { lte: endAt },
        endAt: { gte: startAt },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
      select: { id: true, startAt: true, endAt: true },
    });
  }

  /** BR-REQ-04 / BR-07 — kỳ lương đã chốt phủ lên khoảng thời gian của đơn. */
  async findClosedPeriodOverlapping(
    companyId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<{ name: string } | null> {
    return this.db().payrollPeriod.findFirst({
      where: {
        companyId,
        status: PayrollPeriodStatus.CLOSED,
        startDate: { lte: endAt },
        endDate: { gte: startAt },
      },
      select: { name: true },
    });
  }

  // ===========================================================================
  //  Truy vấn danh sách
  // ===========================================================================

  async search(
    companyId: string,
    filter: RequestSearchFilter,
  ): Promise<{ items: RequestListItem[]; total: number }> {
    const where: Prisma.LeaveRequestWhereInput = { companyId };

    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.status) where.status = filter.status;
    if (filter.requestTypeCode) where.requestType = { code: filter.requestTypeCode };
    if (filter.from || filter.to) {
      where.AND = [
        ...(filter.to ? [{ startAt: { lte: filter.to } }] : []),
        ...(filter.from ? [{ endAt: { gte: filter.from } }] : []),
      ];
    }
    // Phạm vi của ScopeGuard ghi đè `employeeId` do client gửi — thu hẹp, không mở rộng.
    if (filter.employeeIdScope) where.employeeId = { in: filter.employeeIdScope };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        include: {
          requestType: { select: { code: true, name: true, unit: true, deductFrom: true } },
          employee: {
            select: { id: true, fullName: true, employeeCode: true, departmentId: true },
          },
          approvalSteps: { orderBy: { order: 'asc' } },
          _count: { select: { attachments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return { items, total };
  }

  /** "Đơn tôi cần duyệt" — dựa trên `ApprovalStep` đang PENDING. */
  async searchPendingApproval(
    companyId: string,
    approver: { employeeId: string | null; approverRoles: string[] },
    page: { skip: number; take: number },
  ): Promise<{ items: PendingApprovalItem[]; total: number }> {
    const where: Prisma.LeaveRequestWhereInput = {
      companyId,
      status: RequestStatus.PENDING,
      // Không bao giờ hiện đơn của chính mình (BR-APV-03).
      ...(approver.employeeId ? { employeeId: { not: approver.employeeId } } : {}),
      approvalSteps: {
        some: {
          status: 'PENDING',
          OR: [
            ...(approver.employeeId ? [{ approverId: approver.employeeId }] : []),
            { approverId: null, approverRole: { in: approver.approverRoles } },
          ],
        },
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        include: {
          requestType: { select: { code: true, name: true, unit: true } },
          employee: {
            select: { id: true, fullName: true, employeeCode: true, departmentId: true },
          },
          approvalSteps: { orderBy: { order: 'asc' } },
        },
        orderBy: { submittedAt: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return { items, total };
  }

  // ===========================================================================
  //  Bước duyệt
  // ===========================================================================

  async findFlowSteps(companyId: string, requestTypeId: string): Promise<FlowStepTemplate[]> {
    const flow = await this.db().approvalFlow.findFirst({
      where: { companyId, requestTypeId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    return flow?.steps ?? [];
  }

  /** Sinh lại toàn bộ bước duyệt của một đơn — xoá bản cũ rồi tạo bản mới. */
  async replaceApprovalSteps(
    companyId: string,
    requestId: string,
    steps: ApprovalStepSeed[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.db(tx);
    await client.approvalStep.deleteMany({ where: { companyId, requestId } });
    await client.approvalStep.createMany({
      data: steps.map((step) => ({ companyId, requestId, ...step, status: 'PENDING' })),
    });
  }

  async recordStepDecision(
    companyId: string,
    stepId: string,
    data: { status: string; decidedAt: Date; comment?: string; approverId: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).approvalStep.updateMany({ where: { id: stepId, companyId }, data });
  }

  /** BR-APV-02 — một cấp từ chối/huỷ đơn thì các cấp sau không phải xử lý nữa. */
  async skipPendingSteps(
    companyId: string,
    requestId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).approvalStep.updateMany({
      where: { companyId, requestId, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return result.count;
  }

  async countPendingSteps(companyId: string, requestId: string): Promise<number> {
    return this.db().approvalStep.count({ where: { companyId, requestId, status: 'PENDING' } });
  }

  /** Bước PENDING sớm nhất + ngữ cảnh để soạn thông báo cho người duyệt. */
  async findNextPendingStepContext(companyId: string, requestId: string) {
    return this.db().leaveRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        requestType: { select: { name: true } },
        employee: { select: { fullName: true } },
        approvalSteps: { where: { status: 'PENDING' }, orderBy: { order: 'asc' }, take: 1 },
      },
    });
  }

  // ===========================================================================
  //  Đính kèm
  // ===========================================================================

  async countAttachments(companyId: string, requestId: string): Promise<number> {
    return this.db().requestAttachment.count({ where: { companyId, requestId } });
  }

  async createAttachment(
    companyId: string,
    data: {
      requestId: string;
      fileKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<RequestAttachment> {
    return this.db(tx).requestAttachment.create({ data: { companyId, ...data } });
  }

  // ===========================================================================
  //  Số dư phép
  // ===========================================================================

  /** Đơn PENDING giữ chỗ vào `pendingDays`, chưa trừ `usedDays`. */
  async reservePendingDays(
    companyId: string,
    employeeId: string,
    year: number,
    quantity: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).leaveBalance.upsert({
      where: { employeeId_year: { employeeId, year } },
      create: { companyId, employeeId, year, entitledDays: 0, pendingDays: quantity },
      update: { pendingDays: { increment: quantity } },
    });
  }

  /** BR-REQ-01 — trừ phép TẠI THỜI ĐIỂM DUYỆT, không phải lúc gửi. */
  async commitUsedDays(
    companyId: string,
    employeeId: string,
    year: number,
    quantity: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).leaveBalance.upsert({
      where: { employeeId_year: { employeeId, year } },
      create: { companyId, employeeId, year, entitledDays: 0, usedDays: quantity },
      update: {
        usedDays: { increment: quantity },
        pendingDays: { decrement: quantity },
      },
    });
  }

  /**
   * Hoàn lại phần đã giữ chỗ (hoặc đã trừ) khi đơn bị huỷ/từ chối.
   *
   * Nuốt lỗi có chủ đích: chưa có dòng số dư nào thì cũng không có gì để hoàn,
   * và làm hỏng việc huỷ đơn chỉ vì thế là sai hướng.
   */
  async releaseDays(
    employeeId: string,
    year: number,
    quantity: number,
    wasApproved: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx)
      .leaveBalance.update({
        where: { employeeId_year: { employeeId, year } },
        data: wasApproved
          ? { usedDays: { decrement: quantity } }
          : { pendingDays: { decrement: quantity } },
      })
      .catch(() => undefined);
  }

  // ===========================================================================
  //  Tra cứu nhân sự phục vụ workflow
  // ===========================================================================

  async findEmployee(companyId: string, employeeId: string): Promise<Employee | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
  }

  async findEmployeeIdsInScope(
    companyId: string,
    departmentId: string | undefined,
    departmentScope: string[] | null,
  ): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: {
        companyId,
        ...(departmentId ? { departmentId } : {}),
        ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findEmployeeNames(
    companyId: string,
    employeeIds: string[],
  ): Promise<Array<{ id: string; fullName: string }>> {
    return this.db().employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: { id: true, fullName: true },
    });
  }

  async findDepartmentManagerId(companyId: string, departmentId: string): Promise<string | null> {
    const department = await this.db().department.findFirst({
      where: { id: departmentId, companyId },
      select: { managerId: true },
    });
    return department?.managerId ?? null;
  }
}

export type { ApprovalStep };
