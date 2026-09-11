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

/**
 * Bo loc cua man hinh Tong quan — ba dropdown tren dau trang.
 *
 * KHAC `departmentScope`: scope la GIOI HAN QUYEN (Truong phong chi thay phong
 * minh, khong bo duoc), con day la lua chon cua nguoi dung trong pham vi quyen
 * do. Hai thu phai giao nhau chu khong ghi de nhau — de mot ai do chon phong
 * ban ngoai scope thi ket qua phai la rong, khong phai la "thay het".
 */
export interface ReconcileFilters {
  /** Ky cong can xem. Null = ky dang mo (hoac ky gan nhat neu khong con ky mo). */
  periodId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
}

export interface DailyRange {
  companyId: string;
  employeeIds: string[];
  from: Date;
  /** Da chan o "hom nay" — xem `ReportService.reconciliation`. */
  to: Date;
}

const PERIOD_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  currentVersion: true,
} as const;

/**
 * Ngay cong chi co MOT dau cham — thieu vao hoac thieu ra.
 *
 * KHONG suy ra tu `MISSING_RECORD` duoc: engine tinh cong gan trang thai theo
 * chinh sach cong ty, va co cong ty coi thieu check-out la `ABSENT`, co cong ty
 * coi la `INSUFFICIENT`. Kiem thang hai cot thoi gian thi con so khong doi theo
 * cach cau hinh.
 */
const MISSING_PUNCH_OR: Prisma.AttendanceDailyWhereInput[] = [
  { firstCheckInAt: { not: null }, lastCheckOutAt: null },
  { firstCheckInAt: null, lastCheckOutAt: { not: null } },
];

/**
 * Ngay cong CAN DOI SOAT — dinh nghia duy nhat, dung cho ca dem lan liet ke.
 *
 * Bon nhanh, moi nhanh la mot viec khac nhau cua Ke toan:
 *   1. `MISSING_RECORD` / `ABSENT` — khong co du lieu, phai hoi lai nhan vien
 *   2. `INSUFFICIENT` — co du lieu nhung thieu gio, phai quyet tru hay bu
 *   3. co gian lan — phai xem lai bang chung truoc khi tinh cong
 *   4. chi mot dau cham — ban ghi hong, phai bo sung
 */
const NEEDS_REVIEW_OR: Prisma.AttendanceDailyWhereInput[] = [
  {
    status: {
      in: [DailyStatus.MISSING_RECORD, DailyStatus.ABSENT, DailyStatus.INSUFFICIENT],
    },
  },
  { hasFraudFlag: true },
  ...MISSING_PUNCH_OR,
];

/** Don chua nga ngu — van nam trong viec phai lam cua Ke toan. */
const OPEN_REQUEST_STATUSES: RequestStatus[] = [
  RequestStatus.SUBMITTED,
  RequestStatus.PENDING,
  RequestStatus.PENDING_LEVEL_1,
  RequestStatus.PENDING_NEXT_LEVEL,
  RequestStatus.NEED_MORE_INFO,
];

/** Ma loai don theo seed — cong ty tu tao loai khac thi roi ra ngoai, dung y. */
const MAKEUP_CODES = ['MAKEUP', 'ATTENDANCE_ADJUST'];
const OT_CODES = ['OT_REGISTER'];

function baseWhere(range: DailyRange): Prisma.AttendanceDailyWhereInput {
  return {
    companyId: range.companyId,
    employeeId: { in: range.employeeIds },
    workDate: { gte: range.from, lte: range.to },
  };
}

function needsReviewWhere(range: DailyRange): Prisma.AttendanceDailyWhereInput {
  return { ...baseWhere(range), OR: NEEDS_REVIEW_OR };
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
    filters: ReconcileFilters = {},
  ): Promise<string[]> {
    /*
     * Hai dieu kien cung nham vao `departmentId` nen phai di qua `AND`, KHONG
     * duoc spread canh nhau trong cung mot object: `{...{departmentId:{in:scope}},
     * ...{departmentId: chon}}` la mot phep GHI DE — dieu kien sau xoa mat gioi
     * han quyen, va mot Truong phong chon phong ban khac se doc duoc so lieu cua
     * phong do. `AND` giao hai dieu kien nhu y dinh: chon ngoai pham vi thi ra
     * rong, dung nhu no phai the.
     */
    const rows = await this.db().employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        AND: [
          ...(departmentScope ? [{ departmentId: { in: departmentScope } }] : []),
          ...(filters.departmentId ? [{ departmentId: filters.departmentId }] : []),
        ],
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
  //  Dashboard doi soat ky cong (FR-WEB-DASH-07)
  // ===========================================================================

  /**
   * Ky cong dang ap dung cho ngay `today`.
   *
   * Roi ve ky gan nhat khi hom nay khong nam trong ky nao — dau thang, truoc
   * khi Ke toan tao ky moi, man hinh van phai noi duoc dieu gi do ve ky vua
   * xong thay vi trong tron.
   */
  async findCurrentPeriod(companyId: string, today: Date) {
    const current = await this.db().payrollPeriod.findFirst({
      where: { companyId, startDate: { lte: today }, endDate: { gte: today } },
      select: PERIOD_SELECT,
    });
    if (current) return current;

    return this.db().payrollPeriod.findFirst({
      where: { companyId },
      orderBy: { endDate: 'desc' },
      select: PERIOD_SELECT,
    });
  }

  /** Ky cong nguoi dung chon o dropdown. Tra null neu id khong thuoc cong ty. */
  async findPeriodById(companyId: string, periodId: string) {
    return this.db().payrollPeriod.findFirst({
      where: { id: periodId, companyId },
      select: PERIOD_SELECT,
    });
  }

  /** Nhan ca lam viec cho bang "can doi soat" — "HCVP (08:00 - 17:30)". */
  async findShiftLabels(companyId: string, shiftIds: string[]) {
    if (shiftIds.length === 0) return [];
    return this.db().shift.findMany({
      where: { id: { in: shiftIds }, companyId },
      select: { id: true, code: true, name: true, startTime: true, endTime: true },
    });
  }

  /**
   * Dem ban ghi cong CAN DOI SOAT, gom theo nhan vien.
   *
   * `groupBy` chu khong `findMany`: mot cong ty 5.000 nguoi trong ky 31 ngay la
   * 155.000 dong, keo het ve roi dem trong JavaScript la cach lam sap trang
   * Tong quan — dung man hinh duoc mo nhieu nhat.
   */
  async groupNeedsReviewByEmployee(
    range: DailyRange,
  ): Promise<Array<{ employeeId: string; days: number }>> {
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['employeeId'],
      where: needsReviewWhere(range),
      _count: { _all: true },
    });
    return rows.map((row) => ({ employeeId: row.employeeId, days: row._count._all }));
  }

  /** So ngay chi co mot dau cham — thieu vao HOAC thieu ra. */
  async countMissingPunch(range: DailyRange): Promise<number> {
    return this.db().attendanceDaily.count({
      where: { ...baseWhere(range), OR: MISSING_PUNCH_OR },
    });
  }

  /** So ban ghi da on dinh theo tung ngay — nguyen lieu cho duong tien do. */
  async groupSettledByDay(range: DailyRange): Promise<Array<{ workDate: Date; settled: number }>> {
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['workDate'],
      where: { ...baseWhere(range), NOT: { OR: NEEDS_REVIEW_OR } },
      _count: { _all: true },
      orderBy: { workDate: 'asc' },
    });
    return rows.map((row) => ({ workDate: row.workDate, settled: row._count._all }));
  }

  /** Danh sach nhan vien can doi soat — ngay co van de GAN NHAT cua moi nguoi. */
  async findNeedsReviewRows(range: DailyRange, take: number) {
    return this.db().attendanceDaily.findMany({
      where: needsReviewWhere(range),
      orderBy: { workDate: 'desc' },
      take,
      select: {
        employeeId: true,
        workDate: true,
        status: true,
        hasFraudFlag: true,
        firstCheckInAt: true,
        lastCheckOutAt: true,
        shiftId: true,
        employee: {
          select: {
            fullName: true,
            employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
    });
  }

  /**
   * Bon nhom viec trong hang doi "Can xu ly hom nay".
   *
   * Ba nhom sau dem theo LOAI DON chu khong theo trang thai don, vi viec cua Ke
   * toan khac nhau han giua chung: don bo sung cong thi phai sua bang cong, don
   * OT thi phai doi chieu gio thuc te, don phep da duyet thi chi can ap vao.
   */
  async loadReconcileQueue(range: DailyRange) {
    const scoped = { companyId: range.companyId, employeeId: { in: range.employeeIds } };

    const [missingCheckOut, makeupPending, otPending, leaveApproved] = await Promise.all([
      this.db().attendanceDaily.count({
        where: { ...baseWhere(range), firstCheckInAt: { not: null }, lastCheckOutAt: null },
      }),
      this.db().leaveRequest.count({
        where: {
          ...scoped,
          status: { in: OPEN_REQUEST_STATUSES },
          requestType: { code: { in: MAKEUP_CODES } },
        },
      }),
      this.db().leaveRequest.count({
        where: {
          ...scoped,
          status: { in: OPEN_REQUEST_STATUSES },
          requestType: { code: { in: OT_CODES } },
        },
      }),
      this.db().leaveRequest.count({
        where: {
          ...scoped,
          status: RequestStatus.APPROVED,
          startAt: { lte: range.to },
          endAt: { gte: range.from },
          requestType: { isPaidLeave: true },
        },
      }),
    ]);

    return { missingCheckOut, makeupPending, otPending, leaveApproved };
  }

  /** Tong OT da duyet, phep da dung va so cong chuan trong ky. */
  async loadOtLeaveTotals(range: DailyRange) {
    const [daily, leave] = await Promise.all([
      this.db().attendanceDaily.aggregate({
        where: baseWhere(range),
        _sum: { otMinutes: true, workedMinutes: true, standardDays: true },
      }),
      this.db().leaveRequest.aggregate({
        where: {
          companyId: range.companyId,
          employeeId: { in: range.employeeIds },
          status: RequestStatus.APPROVED,
          startAt: { lte: range.to },
          endAt: { gte: range.from },
          requestType: { deductFrom: 'ANNUAL_LEAVE' },
        },
        _sum: { quantity: true },
      }),
    ]);

    return {
      otMinutes: daily._sum.otMinutes ?? 0,
      workedMinutes: daily._sum.workedMinutes ?? 0,
      standardDays: Number(daily._sum.standardDays ?? 0),
      leaveDays: Number(leave._sum.quantity ?? 0),
    };
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
