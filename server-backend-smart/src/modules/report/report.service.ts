import { Injectable } from '@nestjs/common';
import { DailyStatus, PayrollPeriodStatus } from '@prisma/client';
import { formatWorkDate, parseWorkDate, toWorkDate } from 'src/common/utils';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { ReportRepository, type ReconcileFilters } from './report.repository';

// 2 phút — điểm cân bằng giữa tải database và cảm giác "số liệu tươi".
// Dài hơn thì quản lý thấy số cũ và mất tin tưởng vào dashboard; ngắn hơn thì
// gần như mọi lần tải đều tính lại, cache không còn tác dụng.
const DASHBOARD_CACHE_TTL_SECONDS = 120;

/** So dong toi da trong bang "Nhan vien can doi soat" tren Tong quan. */
const NEEDS_REVIEW_PAGE_SIZE = 50;

/** Ly do mot ngay cong bi doi soat — khop `NEEDS_REVIEW_OR` ben repository. */
export type ReconcileIssue =
  'MISSING_CHECK_IN' | 'MISSING_CHECK_OUT' | 'FRAUD_FLAG' | 'INSUFFICIENT' | 'NO_RECORD';

/**
 * Xep mot ngay cong vao dung mot ly do.
 *
 * Thu tu quan trong: mot ngay co the vuong nhieu dieu cung luc, va Ke toan chi
 * lam duoc mot viec cho no. Thieu dau cham xep truoc vi no la viec ro rang nhat
 * — bo sung gio; co gian lan xep truoc "thieu gio" vi phai xem bang chung roi
 * moi biet so gio co dung khong.
 */
export function classifyIssue(row: {
  status: DailyStatus;
  hasFraudFlag: boolean;
  firstCheckInAt: Date | null;
  lastCheckOutAt: Date | null;
}): ReconcileIssue {
  if (row.firstCheckInAt !== null && row.lastCheckOutAt === null) return 'MISSING_CHECK_OUT';
  if (row.firstCheckInAt === null && row.lastCheckOutAt !== null) return 'MISSING_CHECK_IN';
  if (row.hasFraudFlag) return 'FRAUD_FLAG';
  if (row.status === DailyStatus.INSUFFICIENT) return 'INSUFFICIENT';
  return 'NO_RECORD';
}

/**
 * Duong tien do tong hop cong — cong don theo ngay.
 *
 * `expected` la so ban ghi LE RA phai on dinh tinh den ngay do: so nhan vien
 * nhan so ngay da qua. Ngay nghi va ngay le van tinh, vi engine van sinh ban ghi
 * cho chung va chung on dinh ngay tu dau — bo ra thi duong muc tieu tut xuong
 * moi cuoi tuan va bieu do trong nhu he thong dang lam sai.
 */
export function buildProgress(
  settledByDay: Array<{ workDate: Date; settled: number }>,
  from: Date,
  to: Date,
  totalEmployees: number,
): Array<{ workDate: string; settled: number; expected: number }> {
  const byDay = new Map(settledByDay.map((row) => [formatWorkDate(row.workDate), row.settled]));

  const points: Array<{ workDate: string; settled: number; expected: number }> = [];
  let runningSettled = 0;
  let index = 0;

  for (
    const cursor = new Date(from);
    cursor.getTime() <= to.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const key = formatWorkDate(cursor);
    runningSettled += byDay.get(key) ?? 0;
    index += 1;
    points.push({ workDate: key, settled: runningSettled, expected: totalEmployees * index });
  }

  return points;
}

/** Mot moc tren "Lich trinh chot luong sap toi". */
export interface PayrollMilestone {
  /**
   * Nhan hien thi nam o Frontend chu khong o day — cung cho voi `ISSUE_LABEL`
   * va `PERIOD_NEXT`. Backend tra ma va ngay; doi chu tren man hinh khong phai
   * la mot lan deploy lai API.
   */
  key: 'CLOSE' | 'REVIEW' | 'CALCULATE' | 'PAYOUT';
  fromDate: string;
  toDate: string;
  state: 'DONE' | 'CURRENT' | 'UPCOMING';
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Bon moc cua lich chot luong, suy ra tu NGAY CUOI KY va ba khoa chinh sach
 * `payroll.schedule.*`.
 *
 * ## Vi sao suy ra chu khong luu san
 *
 * `PayrollPeriod` khong co cot nao cho bon moc nay, va them bon cot ngay vao do
 * nghia la moi ky moi tao deu phai khai tay bon ngay — thu ma trong thuc te
 * cong ty nao cung dat theo dung mot cong thuc so voi ngay cuoi ky. Khai bao so
 * NGAY (chinh sach) roi tinh ra ngay thang dung mot lan, khong the lech nhau
 * giua cac ky.
 *
 * ## Trang thai moc dau tien khong tinh theo ngay
 *
 * "Chot cong" xong hay chua la viec cua may trang thai ky (`docs/13` §5.4), chu
 * khong phai cua tam lich. Qua ngay 31 ma ke toan chua gui duyet thi moc do van
 * dang la viec phai lam — to xanh no chi vi ngay da qua la noi voi nguoi dung
 * mot dieu khong dung.
 */
export function buildPayrollSchedule(
  endDate: Date,
  today: Date,
  periodStatus: PayrollPeriodStatus,
  config: { reviewDays: number; calcDays: number; payoutOffsetDays: number },
): PayrollMilestone[] {
  const reviewDays = Math.max(0, Math.round(config.reviewDays));
  const calcDays = Math.max(0, Math.round(config.calcDays));

  const reviewFrom = addDays(endDate, 1);
  const reviewTo = addDays(endDate, Math.max(1, reviewDays));
  const calcFrom = addDays(reviewTo, 1);
  const calcTo = addDays(reviewTo, Math.max(1, calcDays));
  const payout = addDays(endDate, Math.max(1, Math.round(config.payoutOffsetDays)));

  const stamp = today.getTime();
  const byDate = (from: Date, to: Date): PayrollMilestone['state'] => {
    if (stamp > to.getTime()) return 'DONE';
    if (stamp >= from.getTime()) return 'CURRENT';
    return 'UPCOMING';
  };

  const closeState: PayrollMilestone['state'] =
    periodStatus === PayrollPeriodStatus.LOCKED
      ? 'DONE'
      : stamp >= endDate.getTime()
        ? 'CURRENT'
        : 'UPCOMING';

  return [
    {
      key: 'CLOSE',
      fromDate: formatWorkDate(endDate),
      toDate: formatWorkDate(endDate),
      state: closeState,
    },
    {
      key: 'REVIEW',
      fromDate: formatWorkDate(reviewFrom),
      toDate: formatWorkDate(reviewTo),
      state: byDate(reviewFrom, reviewTo),
    },
    {
      key: 'CALCULATE',
      fromDate: formatWorkDate(calcFrom),
      toDate: formatWorkDate(calcTo),
      state: byDate(calcFrom, calcTo),
    },
    {
      key: 'PAYOUT',
      fromDate: formatWorkDate(payout),
      toDate: formatWorkDate(payout),
      state: byDate(payout, payout),
    },
  ];
}

function emptyReconciliation(
  period: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: PayrollPeriodStatus;
    currentVersion: number;
  } | null,
  today: Date,
  totalEmployees: number,
) {
  return {
    period: period
      ? {
          id: period.id,
          name: period.name,
          startDate: formatWorkDate(period.startDate),
          endDate: formatWorkDate(period.endDate),
          status: period.status,
          currentVersion: period.currentVersion,
        }
      : null,
    asOf: formatWorkDate(today),
    totals: { totalEmployees, settled: totalEmployees, needsReview: 0, missingPunch: 0 },
    progress: [] as Array<{ workDate: string; settled: number; expected: number }>,
    queue: { missingCheckOut: 0, makeupPending: 0, otPending: 0, leaveApproved: 0 },
    needsReviewList: [] as Array<Record<string, unknown>>,
    otLeave: { otMinutes: 0, workedMinutes: 0, standardDays: 0, leaveDays: 0 },
    payrollSchedule: [] as PayrollMilestone[],
  };
}

/**
 * Dashboard & báo cáo (FR-WEB-DASH, FR-WEB-REP).
 *
 * Hai nguyên tắc hiệu năng bắt buộc:
 *   - Query trên `AttendanceDaily` (đã tính sẵn), KHÔNG trên `AttendanceLog`
 *     (bảng lớn nhất hệ thống) — docs/04 mục 9.1. Ràng buộc này được thực thi ở
 *     `ReportRepository`, nơi không có phương thức nào đọc bảng thô.
 *   - Dashboard là màn hình mở nhiều nhất → BẮT BUỘC cache Redis (docs/04 mục 2.2).
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly reports: ReportRepository,
    private readonly redis: RedisService,
    private readonly policy: PolicyService,
  ) {}

  // ===========================================================================
  //  Dashboard
  // ===========================================================================

  /**
   * Số liệu tổng quan cho màn hình dashboard.
   *
   * ⚠ Khoá cache PHẢI chứa cả `departmentScope`. Mỗi người xem thấy một con số
   * khác nhau tuỳ phạm vi phòng ban họ quản lý; dùng chung khoá theo `companyId`
   * thì trưởng phòng A mở trước sẽ "hâm nóng" cache, và trưởng phòng B mở sau
   * nhận đúng số liệu của phòng A — rò rỉ dữ liệu qua đường cache.
   */
  async dashboard(companyId: string, departmentScope: string[] | null) {
    // `.sort()` là bắt buộc: cùng một tập phòng ban nhưng khác thứ tự phải cho ra
    // cùng một khoá, nếu không cache gần như không bao giờ trúng.
    const scopeKey = departmentScope ? departmentScope.sort().join(',') : 'all';

    return this.redis.remember(
      RedisKeys.dashboard(companyId, `overview:${scopeKey}`),
      DASHBOARD_CACHE_TTL_SECONDS,
      async () => {
        // Lấy "hôm nay" theo múi giờ CÔNG TY, không theo giờ máy chủ. Server đặt
        // ở UTC thì lúc 8 giờ sáng Việt Nam vẫn còn là ngày hôm trước theo UTC —
        // dashboard sẽ hiện số liệu của ngày hôm qua suốt buổi sáng.
        const timezone = await this.policy.getTimezone(companyId);
        const today = toWorkDate(new Date(), timezone);
        const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

        const employeeIds = await this.reports.findActiveEmployeeIds(companyId, departmentScope);

        const counters = await this.reports.loadDashboardCounters(
          companyId,
          employeeIds,
          today,
          monthStart,
        );

        const checkedIn = counters.todayDailies.filter((row) => row.firstCheckInAt !== null).length;
        const stillWorking = counters.todayDailies.filter(
          (row) => row.firstCheckInAt !== null && row.lastCheckOutAt === null,
        ).length;
        const lateCount = counters.todayDailies.filter((row) => row.lateMinutes > 0).length;

        return {
          workDate: formatWorkDate(today),
          totalEmployees: employeeIds.length,
          checkedInToday: checkedIn,
          currentlyWorking: stillWorking,
          lateToday: lateCount,
          pendingRequests: counters.pendingRequests,
          otMinutesThisMonth: counters.otMinutesThisMonth,
          unreviewedFraudFlags: counters.unreviewedFraudFlags,
        };
      },
    );
  }

  /**
   * Dashboard doi soat ky cong (FR-WEB-DASH-07) — man hinh Tong quan cua Ke toan.
   *
   * ## No tra loi cau hoi khac `dashboard()`
   *
   * `dashboard()` tra loi "hom nay ai dang o cong ty": so lieu theo NGAY, doc
   * xong roi bo. Ham nay tra loi "ky nay con bao nhieu viec phai doi soat truoc
   * han chot": so lieu theo KY, va no la danh sach viec phai lam. Hai cau hoi
   * khac nhau nen la hai endpoint khac nhau — gop lai thi moi lan mo trang phai
   * quet ca ky du nguoi dung chi muon xem so hom nay.
   *
   * ## Vi sao chan du lieu o "hom nay"
   *
   * Ky cong keo den cuoi thang, nhung ngay mai chua xay ra. Khong chan thi moi
   * ngay tuong lai trong ky deu la mot ban ghi `ABSENT` va con so "can doi soat"
   * phinh len theo so ngay con lai — dau thang se bao dong do toan bo cong ty.
   */
  async reconciliation(
    companyId: string,
    departmentScope: string[] | null,
    filters: ReconcileFilters = {},
  ) {
    const scopeKey = departmentScope ? departmentScope.sort().join(',') : 'all';
    // Bo loc phai nam trong khoa cache. Thieu no thi nguoi dau tien mo trang se
    // "dong bang" ket qua cua ho cho moi lua chon con lai trong hai phut.
    const filterKey = [
      filters.periodId ?? 'current',
      filters.branchId ?? 'all',
      filters.departmentId ?? 'all',
    ].join('|');

    return this.redis.remember(
      RedisKeys.dashboard(companyId, `reconcile:${scopeKey}:${filterKey}`),
      DASHBOARD_CACHE_TTL_SECONDS,
      async () => {
        const timezone = await this.policy.getTimezone(companyId);
        const today = toWorkDate(new Date(), timezone);

        const [period, employeeIds] = await Promise.all([
          filters.periodId
            ? this.reports.findPeriodById(companyId, filters.periodId)
            : this.reports.findCurrentPeriod(companyId, today),
          this.reports.findActiveEmployeeIds(companyId, departmentScope, filters),
        ]);

        const schedule = period
          ? buildPayrollSchedule(period.endDate, today, period.status, {
              reviewDays: await this.policy.getNumber(
                companyId,
                PolicyKeys.PAYROLL_SCHEDULE_REVIEW_DAYS,
              ),
              calcDays: await this.policy.getNumber(
                companyId,
                PolicyKeys.PAYROLL_SCHEDULE_CALC_DAYS,
              ),
              payoutOffsetDays: await this.policy.getNumber(
                companyId,
                PolicyKeys.PAYROLL_SCHEDULE_PAYOUT_OFFSET_DAYS,
              ),
            })
          : [];

        // Khong co ky nao va khong co ai — tra khung rong thay vi 404. Man hinh
        // Tong quan phai mo duoc tu ngay dau tien, truoc khi Ke toan tao ky.
        if (!period || employeeIds.length === 0) {
          return {
            ...emptyReconciliation(period, today, employeeIds.length),
            payrollSchedule: schedule,
          };
        }

        const from = period.startDate;
        // Ky da qua (nguoi dung chon ky cu o dropdown) thi lay tron ky; ky dang
        // chay thi chan o hom nay — khong ai doi soat duoc ngay chua den.
        const to = period.endDate < today ? period.endDate : today;
        const range = { companyId, employeeIds, from, to };

        const [needsReviewByEmployee, missingPunch, settledByDay, rows, queue, otLeave] =
          await Promise.all([
            this.reports.groupNeedsReviewByEmployee(range),
            this.reports.countMissingPunch(range),
            this.reports.groupSettledByDay(range),
            this.reports.findNeedsReviewRows(range, NEEDS_REVIEW_PAGE_SIZE),
            this.reports.loadReconcileQueue(range),
            this.reports.loadOtLeaveTotals(range),
          ]);

        // Mot luot tra ca cho CA bang, khong phai moi dong mot luot: bang co toi
        // 50 dong nhung so ca khac nhau trong do thuong duoi nam.
        const shiftIds = [
          ...new Set(rows.map((row) => row.shiftId).filter((id): id is string => Boolean(id))),
        ];
        const shifts = new Map(
          (await this.reports.findShiftLabels(companyId, shiftIds)).map((shift) => [
            shift.id,
            shift,
          ]),
        );

        const needsReview = needsReviewByEmployee.length;

        return {
          period: {
            id: period.id,
            name: period.name,
            startDate: formatWorkDate(period.startDate),
            endDate: formatWorkDate(period.endDate),
            status: period.status,
            currentVersion: period.currentVersion,
          },
          asOf: formatWorkDate(to),
          totals: {
            totalEmployees: employeeIds.length,
            // "Da tong hop" la phan bu cua "can doi soat", KHONG phai mot phep
            // dem rieng — hai con so cong lai luon bang tong nhan vien, va do la
            // dieu nguoi dung mac nhien tin khi nhin hang the.
            settled: employeeIds.length - needsReview,
            needsReview,
            missingPunch,
          },
          progress: buildProgress(settledByDay, from, to, employeeIds.length),
          queue,
          needsReviewList: rows.map((row) => {
            const shift = row.shiftId ? shifts.get(row.shiftId) : undefined;
            return {
              employeeId: row.employeeId,
              employeeCode: row.employee.employeeCode,
              fullName: row.employee.fullName,
              department: row.employee.department?.name ?? null,
              workDate: formatWorkDate(row.workDate),
              shiftId: row.shiftId,
              shiftCode: shift?.code ?? null,
              shiftName: shift?.name ?? null,
              shiftStartTime: shift?.startTime ?? null,
              shiftEndTime: shift?.endTime ?? null,
              issue: classifyIssue(row),
            };
          }),
          otLeave,
          payrollSchedule: schedule,
        };
      },
    );
  }

  /** FR-WEB-DASH-05 — cảnh báo bất thường hôm nay. */
  async todayAlerts(companyId: string, departmentScope: string[] | null) {
    const timezone = await this.policy.getTimezone(companyId);
    const today = toWorkDate(new Date(), timezone);

    const employeeIds = await this.reports.findEmployeeIdsInScope(companyId, departmentScope);
    const flags = await this.reports.findUnreviewedFlagsForDay(companyId, today, employeeIds);

    const employees = await this.reports.findEmployeeLabels(
      companyId,
      flags.map((flag) => flag.employeeId),
    );
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    const byCode = flags.reduce<Record<string, number>>((acc, flag) => {
      acc[flag.code] = (acc[flag.code] ?? 0) + 1;
      return acc;
    }, {});

    return {
      total: flags.length,
      byCode,
      items: flags.map((flag) => ({
        id: flag.id,
        code: flag.code,
        severity: flag.severity,
        score: flag.score,
        createdAt: flag.createdAt,
        employee: employeeMap.get(flag.employeeId) ?? null,
      })),
    };
  }

  // ===========================================================================
  //  Báo cáo (FR-WEB-REP)
  // ===========================================================================

  /** FR-WEB-REP-01 — xu hướng chuyên cần theo ngày. */
  async attendanceTrend(
    companyId: string,
    from: string,
    to: string,
    departmentScope: string[] | null,
  ) {
    const employeeIds = await this.reports.findEmployeeIdsInScope(companyId, departmentScope);

    const rows = await this.reports.groupDailyStatusByDate(
      companyId,
      parseWorkDate(from),
      parseWorkDate(to),
      employeeIds,
    );

    const byDate = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const key = formatWorkDate(row.workDate);
      const bucket = byDate.get(key) ?? {};
      bucket[row.status] = row.count;
      byDate.set(key, bucket);
    }

    return [...byDate.entries()]
      .map(([workDate, counts]) => ({ workDate, ...counts }))
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
  }

  /** FR-WEB-REP-02 — nhân viên vi phạm nhiều lần. */
  async violations(
    companyId: string,
    from: string,
    to: string,
    departmentScope: string[] | null,
    minOccurrences = 3,
  ) {
    const employeeIds = await this.reports.findEmployeeIdsInScope(companyId, departmentScope);

    const rows = await this.reports.groupViolationsByEmployee(
      companyId,
      parseWorkDate(from),
      parseWorkDate(to),
      employeeIds,
    );

    const filtered = rows.filter((row) => row.violationCount >= minOccurrences);
    const employees = await this.reports.findEmployeeLabels(
      companyId,
      filtered.map((row) => row.employeeId),
    );
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    return filtered
      .map((row) => ({
        employee: employeeMap.get(row.employeeId) ?? null,
        violationCount: row.violationCount,
        lateMinutesTotal: row.lateMinutesTotal,
        earlyLeaveMinutesTotal: row.earlyLeaveMinutesTotal,
      }))
      .sort((a, b) => b.violationCount - a.violationCount);
  }

  /** FR-WEB-REP-03 — sử dụng phép năm. */
  async leaveUsage(companyId: string, year: number, departmentScope: string[] | null) {
    const employeeIds = await this.reports.findEmployeeIdsInScope(companyId, departmentScope);

    const balances = await this.reports.findLeaveBalances(companyId, year, employeeIds);

    const employees = await this.reports.findEmployeeLabels(
      companyId,
      balances.map((row) => row.employeeId),
    );
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    return balances.map((balance) => {
      const entitled = Number(balance.entitledDays) + Number(balance.carriedOverDays);
      const used = Number(balance.usedDays);
      return {
        employee: employeeMap.get(balance.employeeId) ?? null,
        entitledDays: entitled,
        usedDays: used,
        pendingDays: Number(balance.pendingDays),
        remainingDays: Math.max(0, entitled - used - Number(balance.pendingDays)),
        usageRate: entitled > 0 ? Math.round((used / entitled) * 100) : 0,
      };
    });
  }

  /** FR-WEB-REP-05 — tổng hợp OT theo phòng ban. */
  async overtimeReport(
    companyId: string,
    from: string,
    to: string,
    departmentScope: string[] | null,
  ) {
    const employees = await this.reports.findEmployeesForOvertime(companyId, departmentScope);
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    const rows = await this.reports.groupOvertimeByEmployee(
      companyId,
      parseWorkDate(from),
      parseWorkDate(to),
      employees.map((employee) => employee.id),
    );

    const departments = await this.reports.findDepartmentNames(companyId);
    const departmentMap = new Map(
      departments.map((department) => [department.id, department.name]),
    );

    const byDepartment = new Map<
      string,
      { name: string; otMinutes: number; employeeCount: number }
    >();
    const byEmployee = rows.map((row) => {
      const employee = employeeMap.get(row.employeeId);
      const departmentId = employee?.departmentId ?? 'unassigned';

      const bucket = byDepartment.get(departmentId) ?? {
        name: departmentMap.get(departmentId) ?? 'Chưa phân phòng ban',
        otMinutes: 0,
        employeeCount: 0,
      };
      bucket.otMinutes += row.otMinutes;
      bucket.employeeCount += 1;
      byDepartment.set(departmentId, bucket);

      return { employee: employee ?? null, otMinutes: row.otMinutes };
    });

    return {
      byEmployee: byEmployee.sort((a, b) => b.otMinutes - a.otMinutes),
      byDepartment: [...byDepartment.entries()].map(([departmentId, value]) => ({
        departmentId,
        ...value,
      })),
      totalOtMinutes: byEmployee.reduce((sum, row) => sum + row.otMinutes, 0),
    };
  }

  /** FR-APP-STAT-02 — thống kê chuyên cần cá nhân. */
  async myStats(companyId: string, employeeId: string, from: string, to: string) {
    const [dailies, requests] = await Promise.all([
      this.reports.findDailiesForEmployee(
        companyId,
        employeeId,
        parseWorkDate(from),
        parseWorkDate(to),
      ),
      this.reports.countRequestsByStatus(
        companyId,
        employeeId,
        new Date(from),
        new Date(`${to}T23:59:59.999Z`),
      ),
    ]);

    return {
      period: { from, to },
      workedMinutes: dailies.reduce((sum, row) => sum + row.workedMinutes, 0),
      otMinutes: dailies.reduce((sum, row) => sum + row.otMinutes, 0),
      makeupMinutes: dailies.reduce((sum, row) => sum + row.makeupMinutes, 0),
      standardDays: dailies.reduce((sum, row) => sum + Number(row.standardDays), 0),
      lateCount: dailies.filter((row) => row.lateMinutes > 0).length,
      lateMinutesTotal: dailies.reduce((sum, row) => sum + row.lateMinutes, 0),
      earlyLeaveCount: dailies.filter((row) => row.earlyLeaveMinutes > 0).length,
      statusCounts: dailies.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
      requestCounts: requests.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {}),
    };
  }
}
