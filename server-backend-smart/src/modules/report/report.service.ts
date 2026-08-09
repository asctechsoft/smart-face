import { Injectable } from '@nestjs/common';
import { formatWorkDate, parseWorkDate, toWorkDate } from 'src/common/utils';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { PolicyService } from '../policy/policy.service';
import { ReportRepository } from './report.repository';

// 2 phút — điểm cân bằng giữa tải database và cảm giác "số liệu tươi".
// Dài hơn thì quản lý thấy số cũ và mất tin tưởng vào dashboard; ngắn hơn thì
// gần như mọi lần tải đều tính lại, cache không còn tác dụng.
const DASHBOARD_CACHE_TTL_SECONDS = 120;

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
