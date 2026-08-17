import { Injectable } from '@nestjs/common';
import {
  AttendanceDaily,
  AttendanceDecision,
  AttendanceType,
  DailyStatus,
  ExportJob,
  Employee,
  EmployeeStatus,
  PayrollPeriod,
  PayrollPeriodStatus,
  PayrollSummary,
  Prisma,
  RequestStatus,
} from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type PayrollPeriodWithCount = Prisma.PayrollPeriodGetPayload<{
  include: { _count: { select: { summaries: true } } };
}>;

export type EmployeeLabel = Pick<Employee, 'id' | 'fullName' | 'employeeCode' | 'departmentId'>;

export type PunchRow = { id: string; type: AttendanceType; recordedAt: Date };

export interface ApprovedRequestRow {
  id: string;
  code: string;
  deductFrom: string;
  unit: string;
  /** Nghỉ theo đơn này có được tính công không — xem `RequestType.isPaidLeave`. */
  isPaidLeave: boolean;
  isHalfDay: boolean;
  quantity: number;
}

/** Kết quả tính công một ngày, đã sẵn sàng ghi xuống `attendance_daily`. */
export interface DailyResultRow {
  shiftId: string | null;
  firstCheckInAt: Date | null;
  lastCheckOutAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otMinutes: number;
  otMultiplier: number | null;
  makeupMinutes: number;
  standardDays: number;
  status: DailyStatus;
  appliedRequestIds: string[];
  hasFraudFlag: boolean;
  calculatedAt: Date;
  calcEngineVersion: string;
  breakdown: Prisma.InputJsonValue;
}

/** Đúng các cột của `payroll_summary` — không kèm dữ liệu hiển thị. */
export interface PayrollSummaryRow {
  employeeId: string;
  standardDays: number;
  workedMinutes: number;
  otMinutesNormal: number;
  otMinutesWeekend: number;
  otMinutesHoliday: number;
  lateCount: number;
  lateMinutesTotal: number;
  earlyLeaveCount: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  makeupMinutes: number;
  penaltyAmount: number | null;
  violationCount: number;
  breakdown: Prisma.InputJsonValue;
  calculatedAt: Date;
}

/**
 * Truy cập dữ liệu tính công & kỳ lương: `payroll_period`, `payroll_summary`,
 * cùng các nguồn đầu vào (`attendance_daily`, `attendance_log`,
 * `attendance_adjustment`, `leave_request`, `makeup_work_record`, `holiday`).
 *
 * ## Hai chốt phải giữ đúng ở tầng này
 *
 * **`attendance_daily` là KẾT QUẢ TÍNH, không phải bản ghi gốc.** Vì vậy nó
 * `upsert` được và xoá được — chạy lại engine là dựng lại. Ngược lại,
 * `attendance_log` ở đây chỉ có phương thức ĐỌC (BR-06).
 *
 * **Engine phải idempotent (NFR-REL-06).** `upsertDaily` khoá theo
 * `(employeeId, workDate)` nên chạy lại nhiều lần cho cùng một ngày ghi đè chứ
 * không nhân bản dòng.
 */
@Injectable()
export class PayrollRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Kỳ lương
  // ===========================================================================

  async listPeriods(companyId: string): Promise<PayrollPeriodWithCount[]> {
    return this.db().payrollPeriod.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { summaries: true } } },
    });
  }

  async findPeriod(companyId: string, periodId: string): Promise<PayrollPeriod | null> {
    return this.db().payrollPeriod.findFirst({ where: { id: periodId, companyId } });
  }

  async findOverlappingPeriod(
    companyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PayrollPeriod | null> {
    return this.db().payrollPeriod.findFirst({
      where: { companyId, startDate: { lte: endDate }, endDate: { gte: startDate } },
    });
  }

  async createPeriod(
    companyId: string,
    data: { name: string; startDate: Date; endDate: Date },
  ): Promise<PayrollPeriod> {
    return this.db().payrollPeriod.create({ data: { companyId, ...data } });
  }

  async updatePeriodStatus(
    companyId: string,
    periodId: string,
    data: {
      status: PayrollPeriodStatus;
      closedAt?: Date;
      closedBy?: string;
      reopenedAt?: Date;
      reopenedBy?: string;
      reopenReason?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).payrollPeriod.updateMany({
      where: { id: periodId, companyId },
      data,
    });
    return result.count;
  }

  /** Kỳ đã chốt giao với khoảng — dùng để bỏ qua ngày bị khoá khi tính lại (BR-07). */
  async findClosedPeriodsInRange(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ startDate: Date; endDate: Date; name: string }>> {
    return this.db().payrollPeriod.findMany({
      where: {
        companyId,
        status: PayrollPeriodStatus.CLOSED,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { startDate: true, endDate: true, name: true },
    });
  }

  // ===========================================================================
  //  Ảnh chụp bảng lương
  // ===========================================================================

  async findSummaries(companyId: string, periodId: string): Promise<PayrollSummary[]> {
    return this.db().payrollSummary.findMany({ where: { companyId, periodId } });
  }

  /**
   * Thay toàn bộ ảnh chụp của kỳ.
   *
   * Xoá rồi tạo lại thay vì upsert từng dòng: chốt kỳ là ghi lại TRẠNG THÁI CUỐI,
   * nên nhân viên đã nghỉ việc giữa kỳ phải biến mất khỏi ảnh chụp chứ không nằm
   * lại với số liệu cũ.
   */
  async replaceSummaries(
    companyId: string,
    periodId: string,
    rows: PayrollSummaryRow[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.db(tx);
    await client.payrollSummary.deleteMany({ where: { companyId, periodId } });
    if (rows.length > 0) {
      await client.payrollSummary.createMany({
        data: rows.map((row) => ({ companyId, periodId, ...row })),
      });
    }
  }

  // ===========================================================================
  //  Đầu vào engine tính công
  // ===========================================================================

  /** Các lượt được tính công. PENDING_REVIEW chưa duyệt thì KHÔNG tính. */
  async findCountablePunches(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<PunchRow[]> {
    return this.db().attendanceLog.findMany({
      where: {
        companyId,
        employeeId,
        workDate,
        decision: { in: [AttendanceDecision.ACCEPTED, AttendanceDecision.FLAGGED] },
        type: { in: [AttendanceType.CHECK_IN, AttendanceType.CHECK_OUT] },
      },
      orderBy: { recordedAt: 'asc' },
      select: { id: true, type: true, recordedAt: true },
    });
  }

  async countFraudFlagsForDay(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<number> {
    return this.db().fraudFlag.count({
      where: { companyId, employeeId, attendanceLog: { workDate } },
    });
  }

  async sumMakeupMinutes(companyId: string, employeeId: string, workDate: Date): Promise<number> {
    const result = await this.db().makeupWorkRecord.aggregate({
      where: { companyId, employeeId, makeupWorkDate: workDate },
      _sum: { makeupMinutes: true },
    });
    return result._sum.makeupMinutes ?? 0;
  }

  /** BR-ADJ-01 / AF-23 — id các lượt đã bị huỷ bằng bản ghi điều chỉnh. */
  async findVoidedLogIds(companyId: string, employeeId: string, workDate: Date): Promise<string[]> {
    const rows = await this.db().attendanceAdjustment.findMany({
      where: { companyId, employeeId, workDate, adjustType: 'VOID' },
      select: { attendanceLogId: true },
    });
    return rows.map((row) => row.attendanceLogId).filter((id): id is string => id !== null);
  }

  /** Bản ghi MODIFY_TIME theo thứ tự tạo — bản sau ghi đè bản trước. */
  async findTimeModifications(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<Array<{ attendanceLogId: string | null; afterValue: Prisma.JsonValue }>> {
    return this.db().attendanceAdjustment.findMany({
      where: { companyId, employeeId, workDate, adjustType: 'MODIFY_TIME' },
      orderBy: { createdAt: 'asc' },
      select: { attendanceLogId: true, afterValue: true },
    });
  }

  async findApprovedRequestsInRange(
    companyId: string,
    employeeId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<ApprovedRequestRow[]> {
    const requests = await this.db().leaveRequest.findMany({
      where: {
        companyId,
        employeeId,
        status: RequestStatus.APPROVED,
        startAt: { lt: dayEnd },
        endAt: { gte: dayStart },
      },
      include: {
        requestType: {
          select: { code: true, deductFrom: true, unit: true, isPaidLeave: true },
        },
      },
    });

    return requests.map((request) => ({
      id: request.id,
      code: request.requestType.code,
      deductFrom: request.requestType.deductFrom,
      unit: request.requestType.unit,
      isPaidLeave: request.requestType.isPaidLeave,
      isHalfDay: request.isHalfDay,
      quantity: Number(request.quantity),
    }));
  }

  // ===========================================================================
  //  Kết quả tính công
  // ===========================================================================

  /** NFR-REL-06 — khoá theo (employeeId, workDate) nên chạy lại là ghi đè. */
  async upsertDaily(
    companyId: string,
    employeeId: string,
    workDate: Date,
    result: DailyResultRow,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).attendanceDaily.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: { companyId, employeeId, workDate, ...result },
      update: result,
    });
  }

  async findDailiesInRange(companyId: string, from: Date, to: Date): Promise<AttendanceDaily[]> {
    return this.db().attendanceDaily.findMany({
      where: { companyId, workDate: { gte: from, lte: to } },
    });
  }

  async countMissingRecordDays(companyId: string, from: Date, to: Date): Promise<number> {
    return this.db().attendanceDaily.count({
      where: { companyId, workDate: { gte: from, lte: to }, status: DailyStatus.MISSING_RECORD },
    });
  }

  async countPendingRequestsInRange(companyId: string, from: Date, to: Date): Promise<number> {
    return this.db().leaveRequest.count({
      where: {
        companyId,
        status: RequestStatus.PENDING,
        startAt: { lte: to },
        endAt: { gte: from },
      },
    });
  }

  /** Tổng số công theo nhân viên — nền của phép dò số công bất thường. */
  async sumStandardDaysByEmployee(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ employeeId: string; standardDays: number }>> {
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['employeeId'],
      where: { companyId, workDate: { gte: from, lte: to } },
      _sum: { standardDays: true },
    });
    return rows.map((row) => ({
      employeeId: row.employeeId,
      standardDays: Number(row._sum.standardDays ?? 0),
    }));
  }

  /** Nhân viên vừa chấm công gần đây — đầu vào job tính lại hằng đêm. */
  async findRecentlyPunchedEmployees(
    companyId: string,
    since: Date,
  ): Promise<Array<{ employeeId: string; workDate: Date }>> {
    return this.db().attendanceLog.findMany({
      where: {
        companyId,
        createdAt: { gte: since },
        type: { in: [AttendanceType.CHECK_IN, AttendanceType.CHECK_OUT] },
      },
      select: { employeeId: true, workDate: true },
    });
  }

  // ===========================================================================
  //  Nhân sự & ngày lễ
  // ===========================================================================

  async findEmployeeLabels(companyId: string, employeeIds: string[]): Promise<EmployeeLabel[]> {
    return this.db().employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
  }

  /** Nhân viên được đưa vào bảng lương — người đã nghỉ việc không còn tính công. */
  async findPayableEmployees(companyId: string): Promise<EmployeeLabel[]> {
    return this.db().employee.findMany({
      where: { companyId, deletedAt: null, status: { not: EmployeeStatus.TERMINATED } },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
  }

  /**
   * Nhân viên đưa vào lượt tính lại công.
   *
   * ⚠ KHÔNG lọc theo `status`, và đó là chốt đã trả giá một lần rồi.
   *
   * Trước đây hàm này loại `PENDING_ACTIVATION` với lý do "hồ sơ chưa kích hoạt
   * thì chưa có công". Lý do đó sai: `PENDING_ACTIVATION` là hồ sơ HR đã tạo
   * nhưng người đó chưa đăng nhập App lần nào — họ vẫn đi làm, vẫn có ca, vẫn
   * gửi được đơn nghỉ (xem `EMPLOYABLE_STATUSES` phía Web). Với một công ty vừa
   * triển khai thì TOÀN BỘ nhân sự nằm ở trạng thái này, nên lượt tính lại quét
   * qua danh sách RỖNG, không ghi dòng nào, mà vẫn báo hoàn tất 100%.
   *
   * `TERMINATED` cũng phải có mặt: người nghỉ việc giữa tháng vẫn có công của
   * những ngày đã đi làm, và đó chính là kỳ cần chốt lương lần cuối cho họ.
   *
   * Lọc duy nhất còn lại là `deletedAt` — hồ sơ đã xoá thì không còn gì để tính.
   */
  async findCalculableEmployeeIds(companyId: string, employeeIds?: string[]): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(employeeIds?.length ? { id: { in: employeeIds } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findHolidayDates(companyId: string, from: Date, to: Date): Promise<Date[]> {
    const rows = await this.db().holiday.findMany({
      where: { companyId, date: { gte: from, lte: to } },
      select: { date: true },
    });
    return rows.map((row) => row.date);
  }

  // ===========================================================================
  //  Job chạy nền
  // ===========================================================================

  /**
   * Bảng `export_job` theo dõi MỌI job dài, không riêng job xuất file — `kind`
   * phân biệt (`PAYROLL`, `ATTENDANCE`, `PAYROLL_RECALCULATE`...). Client hỏi
   * tiến độ qua `GET /v1/jobs/:id` cho tất cả.
   *
   * Trạng thái nằm ở DATABASE chứ không chỉ trong BullMQ: nó phải sống sót qua
   * lần Redis restart, và `GET /v1/jobs/:id` không được phụ thuộc vào Redis.
   */
  async createExportJob(
    companyId: string,
    data: { createdBy: string; kind: string; params: Prisma.InputJsonValue },
  ): Promise<ExportJob> {
    return this.db().exportJob.create({ data: { companyId, status: 'QUEUED', ...data } });
  }

  async markJobProcessing(jobId: string, progress = 5): Promise<void> {
    await this.db().exportJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', progress },
    });
  }

  async setJobProgress(jobId: string, progress: number): Promise<void> {
    await this.db().exportJob.update({ where: { id: jobId }, data: { progress } });
  }

  async markJobDone(jobId: string): Promise<void> {
    await this.db().exportJob.update({
      where: { id: jobId },
      data: { status: 'DONE', progress: 100, completedAt: new Date() },
    });
  }

  async markJobFailed(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.db().exportJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorCode, errorMessage, completedAt: new Date() },
    });
  }
}
