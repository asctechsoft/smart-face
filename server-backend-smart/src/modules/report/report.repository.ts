import { Injectable } from '@nestjs/common';
import {
  AttendanceDaily,
  DailyStatus,
  FraudFlag,
  LeaveBalance,
  Prisma,
  RequestStatus,
} from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface EmployeeLabel {
  id: string;
  fullName: string;
  employeeCode: string;
  departmentId: string | null;
}

export type TodaySnapshotRow = Pick<
  AttendanceDaily,
  'status' | 'lateMinutes' | 'firstCheckInAt' | 'lastCheckOutAt'
>;

export interface DashboardCounters {
  todayDailies: TodaySnapshotRow[];
  pendingRequests: number;
  otMinutesThisMonth: number;
  unreviewedFraudFlags: number;
}

export interface TrendRow {
  workDate: Date;
  status: DailyStatus;
  count: number;
}

export interface ViolationRow {
  employeeId: string;
  violationCount: number;
  lateMinutesTotal: number;
  earlyLeaveMinutesTotal: number;
}

export interface OvertimeRow {
  employeeId: string;
  otMinutes: number;
}

/** Các trạng thái ngày công bị tính là vi phạm chuyên cần (FR-WEB-REP-02). */
const VIOLATION_STATUSES: DailyStatus[] = [
  DailyStatus.LATE,
  DailyStatus.EARLY_LEAVE,
  DailyStatus.LATE_AND_EARLY,
  DailyStatus.INSUFFICIENT,
  DailyStatus.MISSING_RECORD,
];

/**
 * Truy vấn tổng hợp cho dashboard và báo cáo.
 *
 * ## Một quy tắc hiệu năng, không phải sở thích
 *
 * Mọi thống kê ở đây đọc `attendance_daily` (đã tính sẵn), KHÔNG đọc
 * `attendance_log` — bảng lớn nhất hệ thống và tăng theo từng lượt quẹt (docs/04
 * mục 9.1, NFR-PERF-06). Một báo cáo tháng quét bảng thô của công ty 500 người
 * là hàng trăm nghìn dòng cho mỗi lần mở dashboard.
 *
 * Repository này chỉ ĐỌC. Không có phương thức ghi nào, và không nên có.
 */
@Injectable()
export class ReportRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Phạm vi nhân viên
  // ===========================================================================

  /**
   * Nhân viên trong phạm vi phòng ban được phân công.
   *
   * Trả `null` khi `departmentScope` là null — nghĩa là KHÔNG giới hạn, chứ không
   * phải "không có ai". Hai thứ này khác nhau: trả mảng rỗng sẽ khiến Admin/HR
   * thấy dashboard trắng trơn.
   */
  async findEmployeeIdsInScope(
    companyId: string,
    departmentScope: string[] | null,
  ): Promise<string[] | null> {
    if (!departmentScope) return null;
    const rows = await this.db().employee.findMany({
      where: { companyId, departmentId: { in: departmentScope } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findActiveEmployeeIds(
    companyId: string,
    departmentScope: string[] | null,
  ): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findEmployeeLabels(companyId: string, employeeIds: string[]): Promise<EmployeeLabel[]> {
    return this.db().employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
  }

  async findEmployeesForOvertime(
    companyId: string,
    departmentScope: string[] | null,
  ): Promise<EmployeeLabel[]> {
    return this.db().employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
      },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
  }

  async findDepartmentNames(companyId: string): Promise<Array<{ id: string; name: string }>> {
    return this.db().department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  // ===========================================================================
  //  Dashboard
  // ===========================================================================

  async loadDashboardCounters(
    companyId: string,
    employeeIds: string[],
    today: Date,
    monthStart: Date,
  ): Promise<DashboardCounters> {
    // Mảng rỗng nghĩa là phạm vi không có ai — bỏ luôn điều kiện `employeeId` thì
    // con số nhảy thành của cả công ty, đúng loại rò rỉ mà ScopeGuard sinh ra để chặn.
    const scoped = { employeeId: { in: employeeIds } };

    const [todayDailies, pendingRequests, otAggregate, unreviewedFraudFlags] = await Promise.all([
      this.db().attendanceDaily.findMany({
        where: { companyId, workDate: today, ...scoped },
        select: { status: true, lateMinutes: true, firstCheckInAt: true, lastCheckOutAt: true },
      }),
      this.db().leaveRequest.count({
        where: { companyId, status: RequestStatus.PENDING, ...scoped },
      }),
      this.db().attendanceDaily.aggregate({
        where: { companyId, workDate: { gte: monthStart, lte: today }, ...scoped },
        _sum: { otMinutes: true },
      }),
      this.db().fraudFlag.count({ where: { companyId, reviewedAt: null, ...scoped } }),
    ]);

    return {
      todayDailies,
      pendingRequests,
      otMinutesThisMonth: otAggregate._sum.otMinutes ?? 0,
      unreviewedFraudFlags,
    };
  }

  /** FR-WEB-DASH-05 — cờ chưa xử lý phát sinh trong ngày hôm nay. */
  async findUnreviewedFlagsForDay(
    companyId: string,
    workDate: Date,
    employeeIds: string[] | null,
    take = 20,
  ): Promise<FraudFlag[]> {
    return this.db().fraudFlag.findMany({
      where: {
        companyId,
        reviewedAt: null,
        attendanceLog: { workDate },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // ===========================================================================
  //  Báo cáo
  // ===========================================================================

  /** FR-WEB-REP-01 — số ngày theo từng trạng thái, theo ngày. */
  async groupDailyStatusByDate(
    companyId: string,
    from: Date,
    to: Date,
    employeeIds: string[] | null,
  ): Promise<TrendRow[]> {
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['workDate', 'status'],
      where: {
        companyId,
        workDate: { gte: from, lte: to },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      _count: { _all: true },
    });

    return rows.map((row) => ({
      workDate: row.workDate,
      status: row.status,
      count: row._count._all,
    }));
  }

  /** FR-WEB-REP-02 — số lần vi phạm chuyên cần theo nhân viên. */
  async groupViolationsByEmployee(
    companyId: string,
    from: Date,
    to: Date,
    employeeIds: string[] | null,
  ): Promise<ViolationRow[]> {
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['employeeId'],
      where: {
        companyId,
        workDate: { gte: from, lte: to },
        status: { in: VIOLATION_STATUSES },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      _count: { _all: true },
      _sum: { lateMinutes: true, earlyLeaveMinutes: true },
    });

    return rows.map((row) => ({
      employeeId: row.employeeId,
      violationCount: row._count._all,
      lateMinutesTotal: row._sum.lateMinutes ?? 0,
      earlyLeaveMinutesTotal: row._sum.earlyLeaveMinutes ?? 0,
    }));
  }

  /** FR-WEB-REP-03 — số dư phép của năm. */
  async findLeaveBalances(
    companyId: string,
    year: number,
    employeeIds: string[] | null,
  ): Promise<LeaveBalance[]> {
    return this.db().leaveBalance.findMany({
      where: { companyId, year, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    });
  }

  /** FR-WEB-REP-05 — tổng phút OT theo nhân viên. */
  async groupOvertimeByEmployee(
    companyId: string,
    from: Date,
    to: Date,
    employeeIds: string[],
  ): Promise<OvertimeRow[]> {
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['employeeId'],
      where: {
        companyId,
        workDate: { gte: from, lte: to },
        employeeId: { in: employeeIds },
        otMinutes: { gt: 0 },
      },
      _sum: { otMinutes: true },
    });

    return rows.map((row) => ({
      employeeId: row.employeeId,
      otMinutes: row._sum.otMinutes ?? 0,
    }));
  }

  // ===========================================================================
  //  Thống kê cá nhân (FR-APP-STAT-02)
  // ===========================================================================

  async findDailiesForEmployee(
    companyId: string,
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<AttendanceDaily[]> {
    return this.db().attendanceDaily.findMany({
      where: { companyId, employeeId, workDate: { gte: from, lte: to } },
    });
  }

  async countRequestsByStatus(
    companyId: string,
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ status: RequestStatus; count: number }>> {
    const rows = await this.db().leaveRequest.groupBy({
      by: ['status'],
      where: {
        companyId,
        employeeId,
        startAt: { gte: from },
        endAt: { lte: to },
      },
      _count: { _all: true },
    });

    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }
}

export type { Prisma };
