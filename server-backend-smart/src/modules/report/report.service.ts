import { Injectable } from '@nestjs/common';
import { AttendanceDecision, DailyStatus, Prisma, RequestStatus } from '@prisma/client';
import { formatWorkDate, parseWorkDate, toWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { PolicyService } from '../policy/policy.service';

// 2 phút — điểm cân bằng giữa tải database và cảm giác "số liệu tươi".
// Dài hơn thì quản lý thấy số cũ và mất tin tưởng vào dashboard; ngắn hơn thì
// gần như mọi lần tải đều tính lại, cache không còn tác dụng.
const DASHBOARD_CACHE_TTL_SECONDS = 120;

/**
 * Dashboard & báo cáo (FR-WEB-DASH, FR-WEB-REP).
 *
 * Hai nguyên tắc hiệu năng bắt buộc:
 *   - Query trên `AttendanceDaily` (đã tính sẵn), KHÔNG trên `AttendanceLog`
 *     (bảng lớn nhất hệ thống) — docs/04 mục 9.1.
 *   - Dashboard là màn hình mở nhiều nhất → BẮT BUỘC cache Redis (docs/04 mục 2.2).
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
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

        const employeeWhere: Prisma.EmployeeWhereInput = {
          companyId,
          deletedAt: null,
          status: 'ACTIVE',
          ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
        };

        const employees = await this.prisma.employee.findMany({
          where: employeeWhere,
          select: { id: true },
        });
        const employeeIds = employees.map((employee) => employee.id);

        const [todayDailies, pendingRequests, otAggregate, unreviewedFlags] = await Promise.all([
          this.prisma.attendanceDaily.findMany({
            where: { companyId, workDate: today, employeeId: { in: employeeIds } },
            select: { status: true, lateMinutes: true, firstCheckInAt: true, lastCheckOutAt: true },
          }),
          this.prisma.leaveRequest.count({
            where: {
              companyId,
              status: RequestStatus.PENDING,
              ...(employeeIds.length ? { employeeId: { in: employeeIds } } : {}),
            },
          }),
          this.prisma.attendanceDaily.aggregate({
            where: {
              companyId,
              workDate: { gte: monthStart, lte: today },
              employeeId: { in: employeeIds },
            },
            _sum: { otMinutes: true },
          }),
          this.prisma.fraudFlag.count({
            where: {
              companyId,
              reviewedAt: null,
              ...(employeeIds.length ? { employeeId: { in: employeeIds } } : {}),
            },
          }),
        ]);

        const checkedIn = todayDailies.filter((row) => row.firstCheckInAt !== null).length;
        const stillWorking = todayDailies.filter(
          (row) => row.firstCheckInAt !== null && row.lastCheckOutAt === null,
        ).length;
        const lateCount = todayDailies.filter((row) => row.lateMinutes > 0).length;

        return {
          workDate: formatWorkDate(today),
          totalEmployees: employeeIds.length,
          checkedInToday: checkedIn,
          currentlyWorking: stillWorking,
          lateToday: lateCount,
          pendingRequests,
          otMinutesThisMonth: otAggregate._sum.otMinutes ?? 0,
          unreviewedFraudFlags: unreviewedFlags,
        };
      },
    );
  }

  /** FR-WEB-DASH-05 — cảnh báo bất thường hôm nay. */
  async todayAlerts(companyId: string, departmentScope: string[] | null) {
    const timezone = await this.policy.getTimezone(companyId);
    const today = toWorkDate(new Date(), timezone);

    const employeeFilter = departmentScope
      ? await this.prisma.employee
          .findMany({
            where: { companyId, departmentId: { in: departmentScope } },
            select: { id: true },
          })
          .then((rows) => rows.map((row) => row.id))
      : null;

    const flags = await this.prisma.fraudFlag.findMany({
      where: {
        companyId,
        reviewedAt: null,
        attendanceLog: { workDate: today },
        ...(employeeFilter ? { employeeId: { in: employeeFilter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: flags.map((flag) => flag.employeeId) } },
      select: { id: true, fullName: true, employeeCode: true },
    });
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
    const employeeIds = await this.resolveEmployeeIds(companyId, departmentScope);

    const rows = await this.prisma.attendanceDaily.groupBy({
      by: ['workDate', 'status'],
      where: {
        companyId,
        workDate: { gte: parseWorkDate(from), lte: parseWorkDate(to) },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      _count: { _all: true },
    });

    const byDate = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const key = formatWorkDate(row.workDate);
      const bucket = byDate.get(key) ?? {};
      bucket[row.status] = row._count._all;
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
    const employeeIds = await this.resolveEmployeeIds(companyId, departmentScope);

    const rows = await this.prisma.attendanceDaily.groupBy({
      by: ['employeeId'],
      where: {
        companyId,
        workDate: { gte: parseWorkDate(from), lte: parseWorkDate(to) },
        status: {
          in: [
            DailyStatus.LATE,
            DailyStatus.EARLY_LEAVE,
            DailyStatus.LATE_AND_EARLY,
            DailyStatus.INSUFFICIENT,
            DailyStatus.MISSING_RECORD,
          ],
        },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      _count: { _all: true },
      _sum: { lateMinutes: true, earlyLeaveMinutes: true },
    });

    const filtered = rows.filter((row) => row._count._all >= minOccurrences);
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: filtered.map((row) => row.employeeId) } },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    return filtered
      .map((row) => ({
        employee: employeeMap.get(row.employeeId) ?? null,
        violationCount: row._count._all,
        lateMinutesTotal: row._sum.lateMinutes ?? 0,
        earlyLeaveMinutesTotal: row._sum.earlyLeaveMinutes ?? 0,
      }))
      .sort((a, b) => b.violationCount - a.violationCount);
  }

  /** FR-WEB-REP-03 — sử dụng phép năm. */
  async leaveUsage(companyId: string, year: number, departmentScope: string[] | null) {
    const employeeIds = await this.resolveEmployeeIds(companyId, departmentScope);

    const balances = await this.prisma.leaveBalance.findMany({
      where: { companyId, year, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    });

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: balances.map((row) => row.employeeId) } },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
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
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
      },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    const rows = await this.prisma.attendanceDaily.groupBy({
      by: ['employeeId'],
      where: {
        companyId,
        workDate: { gte: parseWorkDate(from), lte: parseWorkDate(to) },
        employeeId: { in: employees.map((employee) => employee.id) },
        otMinutes: { gt: 0 },
      },
      _sum: { otMinutes: true },
    });

    const departments = await this.prisma.department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    const departmentMap = new Map(departments.map((department) => [department.id, department.name]));

    const byDepartment = new Map<string, { name: string; otMinutes: number; employeeCount: number }>();
    const byEmployee = rows.map((row) => {
      const employee = employeeMap.get(row.employeeId);
      const otMinutes = row._sum.otMinutes ?? 0;
      const departmentId = employee?.departmentId ?? 'unassigned';

      const bucket = byDepartment.get(departmentId) ?? {
        name: departmentMap.get(departmentId) ?? 'Chưa phân phòng ban',
        otMinutes: 0,
        employeeCount: 0,
      };
      bucket.otMinutes += otMinutes;
      bucket.employeeCount += 1;
      byDepartment.set(departmentId, bucket);

      return { employee: employee ?? null, otMinutes };
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
      this.prisma.attendanceDaily.findMany({
        where: {
          companyId,
          employeeId,
          workDate: { gte: parseWorkDate(from), lte: parseWorkDate(to) },
        },
      }),
      this.prisma.leaveRequest.groupBy({
        by: ['status'],
        where: {
          companyId,
          employeeId,
          startAt: { gte: new Date(from) },
          endAt: { lte: new Date(`${to}T23:59:59.999Z`) },
        },
        _count: { _all: true },
      }),
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
        acc[row.status] = row._count._all;
        return acc;
      }, {}),
    };
  }

  private async resolveEmployeeIds(
    companyId: string,
    departmentScope: string[] | null,
  ): Promise<string[] | null> {
    if (!departmentScope) return null;
    const employees = await this.prisma.employee.findMany({
      where: { companyId, departmentId: { in: departmentScope } },
      select: { id: true },
    });
    return employees.map((employee) => employee.id);
  }
}
