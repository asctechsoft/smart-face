import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  AttendanceType,
  DailyStatus,
  EmployeeStatus,
  PayrollPeriodStatus,
  Prisma,
  RequestStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { AppException } from 'src/common/errors';
import { eachWorkDate, formatWorkDate, parseWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import { FraudService } from '../fraud/fraud.service';
import { PolicyKeys, PenaltyRule } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { PayrollEngineService } from './payroll-engine.service';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * Kỳ lương & bảng công tổng hợp (FR-WEB-PAY).
 *
 * BR-07: kỳ đã chốt bị KHOÁ hoàn toàn — không chấm công, không sửa công,
 * không duyệt đơn ảnh hưởng kỳ. Mở lại là thao tác đặc quyền, bắt buộc lý do + audit.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: PayrollEngineService,
    private readonly policy: PolicyService,
    private readonly fraud: FraudService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.PAYROLL) private readonly payrollQueue: Queue,
    @InjectQueue(QUEUES.EXPORT) private readonly exportQueue: Queue,
  ) {}

  // ===========================================================================
  //  Kỳ lương
  // ===========================================================================

  async listPeriods(companyId: string) {
    return this.prisma.payrollPeriod.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { summaries: true } } },
    });
  }

  async createPeriod(companyId: string, name: string, startDate: string, endDate: string) {
    const start = parseWorkDate(startDate);
    const end = parseWorkDate(endDate);

    const overlapping = await this.prisma.payrollPeriod.findFirst({
      where: { companyId, startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlapping) {
      throw new AppException('PAY_PERIOD_OVERLAP', { existingPeriod: overlapping.name });
    }

    return this.prisma.payrollPeriod.create({
      data: { companyId, name, startDate: start, endDate: end },
    });
  }

  async getPeriod(companyId: string, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: periodId, companyId },
    });
    if (!period) {
      throw new AppException('PAY_PERIOD_NOT_FOUND');
    }
    return period;
  }

  /**
   * Tính lại toàn bộ bảng công của kỳ — chạy nền qua queue.
   * NFR-PERF-07: 500 nhân viên × 31 ngày phải xong dưới 5 phút.
   */
  async recalculatePeriod(companyId: string, periodId: string) {
    const period = await this.getPeriod(companyId, periodId);
    if (period.status === PayrollPeriodStatus.CLOSED) {
      throw new AppException('PAY_PERIOD_CLOSED');
    }

    await this.payrollQueue.add(JOBS.RECALCULATE_PERIOD, {
      companyId,
      periodId,
      from: formatWorkDate(period.startDate),
      to: formatWorkDate(period.endDate),
    });

    return { queued: true, periodId };
  }

  /**
   * Báo cáo TIỀN CHỐT (docs/04 mục 7.2 bước 3).
   *
   * ⚠ Bước này KHÔNG được bỏ qua. Chốt kỳ khi còn đơn chờ duyệt là nguyên nhân
   * khiếu nại lương phổ biến nhất.
   */
  async preCloseReport(companyId: string, periodId: string) {
    const period = await this.getPeriod(companyId, periodId);

    const [missingRecords, pendingRequests, unreviewedFraudFlags, dailies] = await Promise.all([
      this.prisma.attendanceDaily.count({
        where: {
          companyId,
          workDate: { gte: period.startDate, lte: period.endDate },
          status: DailyStatus.MISSING_RECORD,
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          companyId,
          status: RequestStatus.PENDING,
          startAt: { lte: new Date(period.endDate.getTime() + 86_400_000) },
          endAt: { gte: period.startDate },
        },
      }),
      this.fraud.countUnreviewedInRange(companyId, period.startDate, period.endDate),
      this.prisma.attendanceDaily.groupBy({
        by: ['employeeId'],
        where: { companyId, workDate: { gte: period.startDate, lte: period.endDate } },
        _sum: { standardDays: true },
      }),
    ]);

    // Phát hiện số công bất thường so với trung vị của công ty.
    const totals = dailies
      .map((row) => Number(row._sum.standardDays ?? 0))
      .sort((a, b) => a - b);
    const median = totals.length > 0 ? totals[Math.floor(totals.length / 2)] : 0;

    const anomalousIds = dailies
      .filter((row) => {
        const value = Number(row._sum.standardDays ?? 0);
        return median > 0 && (value < median * 0.5 || value > median * 1.5);
      })
      .map((row) => row.employeeId);

    const anomalousEmployees = await this.prisma.employee.findMany({
      where: { id: { in: anomalousIds }, companyId },
      select: { id: true, fullName: true, employeeCode: true },
    });
    const employeeMap = new Map(anomalousEmployees.map((employee) => [employee.id, employee]));

    const anomalies = dailies
      .filter((row) => anomalousIds.includes(row.employeeId))
      .map((row) => {
        const employee = employeeMap.get(row.employeeId);
        const value = Number(row._sum.standardDays ?? 0);
        return {
          employeeId: row.employeeId,
          employeeCode: employee?.employeeCode ?? null,
          fullName: employee?.fullName ?? null,
          standardDays: value,
          issue: `Số công bất thường: ${value} (trung vị công ty ${median})`,
        };
      });

    const blockers = { missingRecords, pendingRequests, unreviewedFraudFlags };

    return {
      period: {
        id: period.id,
        name: period.name,
        startDate: formatWorkDate(period.startDate),
        endDate: formatWorkDate(period.endDate),
        status: period.status,
      },
      blockers,
      anomalies,
      canClose: missingRecords === 0 && pendingRequests === 0 && unreviewedFraudFlags === 0,
    };
  }

  /**
   * Chốt kỳ — snapshot bảng công vào `PayrollSummary` rồi KHOÁ kỳ (BR-07).
   *
   * @param force cho phép chốt dù còn blocker, nhưng BẮT BUỘC ghi lý do vào audit.
   */
  async closePeriod(ctx: TenantContext, periodId: string, reason: string, force = false) {
    const period = await this.getPeriod(ctx.companyId, periodId);
    if (period.status === PayrollPeriodStatus.CLOSED) {
      throw new AppException('PAY_PERIOD_CLOSED');
    }

    const report = await this.preCloseReport(ctx.companyId, periodId);
    if (!report.canClose && !force) {
      throw new AppException('PAY_PERIOD_HAS_BLOCKERS', { blockers: report.blockers });
    }

    const summaries = await this.buildSummaries(ctx.companyId, period.startDate, period.endDate);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollSummary.deleteMany({ where: { periodId } });
      if (summaries.length > 0) {
        await tx.payrollSummary.createMany({
          data: summaries.map((summary) => ({ ...summary, companyId: ctx.companyId, periodId })),
        });
      }
      await tx.payrollPeriod.update({
        where: { id: periodId },
        data: {
          status: PayrollPeriodStatus.CLOSED,
          closedAt: new Date(),
          closedBy: ctx.userId,
        },
      });
    });

    await this.audit.record(ctx, {
      action: 'PAYROLL_CLOSE',
      targetType: 'PAYROLL_PERIOD',
      targetId: periodId,
      reason,
      after: {
        employeeCount: summaries.length,
        forced: force,
        blockers: report.blockers,
      },
    });

    return { closed: true, employeeCount: summaries.length, forced: force };
  }

  /** Mở lại kỳ đã chốt — thao tác ĐẶC QUYỀN, bắt buộc lý do + audit (BR-07). */
  async reopenPeriod(ctx: TenantContext, periodId: string, reason: string) {
    const period = await this.getPeriod(ctx.companyId, periodId);
    if (period.status !== PayrollPeriodStatus.CLOSED) {
      throw new AppException('PAY_PERIOD_NOT_FOUND', {
        reason: 'Kỳ này chưa được chốt nên không cần mở lại.',
      });
    }

    await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status: PayrollPeriodStatus.REVIEWING,
        reopenedAt: new Date(),
        reopenedBy: ctx.userId,
        reopenReason: reason,
      },
    });

    await this.audit.record(ctx, {
      action: 'PAYROLL_REOPEN',
      targetType: 'PAYROLL_PERIOD',
      targetId: periodId,
      reason,
      before: { status: PayrollPeriodStatus.CLOSED, closedAt: period.closedAt },
      after: { status: PayrollPeriodStatus.REVIEWING },
    });

    return { reopened: true };
  }

  // ===========================================================================
  //  Bảng công tổng hợp
  // ===========================================================================

  /** FR-WEB-PAY-01 — bảng công chi tiết theo nhân viên trong kỳ. */
  async getPeriodSummary(companyId: string, periodId: string) {
    const period = await this.getPeriod(companyId, periodId);

    // Kỳ đã chốt → đọc snapshot bất biến; kỳ đang mở → tính trực tiếp.
    if (period.status === PayrollPeriodStatus.CLOSED) {
      const summaries = await this.prisma.payrollSummary.findMany({
        where: { companyId, periodId },
      });
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: summaries.map((row) => row.employeeId) } },
        select: { id: true, fullName: true, employeeCode: true, departmentId: true },
      });
      const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

      return {
        period,
        fromSnapshot: true,
        items: summaries.map((summary) => ({
          ...summary,
          employee: employeeMap.get(summary.employeeId) ?? null,
        })),
      };
    }

    const items = await this.buildSummaries(companyId, period.startDate, period.endDate);
    return { period, fromSnapshot: false, items };
  }

  /**
   * Tổng hợp từ `AttendanceDaily` — KHÔNG quét `AttendanceLog` (docs/04 mục 9.1).
   * Phạt tính theo `payroll.penalty.rules` cấu hình được (BR-12, FR-WEB-PAY-02).
   */
  private async buildSummaries(companyId: string, startDate: Date, endDate: Date) {
    const [dailies, penaltyRules, employees, holidays] = await Promise.all([
      this.prisma.attendanceDaily.findMany({
        where: { companyId, workDate: { gte: startDate, lte: endDate } },
      }),
      this.policy.get<PenaltyRule[]>(companyId, PolicyKeys.PAYROLL_PENALTY_RULES),
      this.prisma.employee.findMany({
        where: { companyId, deletedAt: null, status: { not: EmployeeStatus.TERMINATED } },
        select: { id: true, fullName: true, employeeCode: true, departmentId: true },
      }),
      this.prisma.holiday.findMany({
        where: { companyId, date: { gte: startDate, lte: endDate } },
        select: { date: true },
      }),
    ]);

    const holidayKeys = new Set(holidays.map((holiday) => formatWorkDate(holiday.date)));
    const grouped = new Map<string, typeof dailies>();
    for (const daily of dailies) {
      grouped.set(daily.employeeId, [...(grouped.get(daily.employeeId) ?? []), daily]);
    }

    return employees.map((employee) => {
      const rows = grouped.get(employee.id) ?? [];

      let otNormal = 0;
      let otWeekend = 0;
      let otHoliday = 0;

      for (const row of rows) {
        if (row.otMinutes === 0) continue;
        const key = formatWorkDate(row.workDate);
        const weekday = row.workDate.getUTCDay();
        if (holidayKeys.has(key)) otHoliday += row.otMinutes;
        else if (weekday === 0 || weekday === 6) otWeekend += row.otMinutes;
        else otNormal += row.otMinutes;
      }

      const lateRows = rows.filter((row) => row.lateMinutes > 0);
      const lateMinutesTotal = lateRows.reduce((sum, row) => sum + row.lateMinutes, 0);

      return {
        employeeId: employee.id,
        employee,
        standardDays: rows.reduce((sum, row) => sum + Number(row.standardDays), 0),
        workedMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0),
        otMinutesNormal: otNormal,
        otMinutesWeekend: otWeekend,
        otMinutesHoliday: otHoliday,
        lateCount: lateRows.length,
        lateMinutesTotal,
        earlyLeaveCount: rows.filter((row) => row.earlyLeaveMinutes > 0).length,
        leaveDays: rows.filter((row) => row.status === DailyStatus.ON_LEAVE).length,
        unpaidLeaveDays: 0,
        makeupMinutes: rows.reduce((sum, row) => sum + row.makeupMinutes, 0),
        penaltyAmount: this.computePenalty(penaltyRules, lateRows.length, lateMinutesTotal),
        violationCount:
          lateRows.length + rows.filter((row) => row.earlyLeaveMinutes > 0).length,
        breakdown: {
          dayCount: rows.length,
          statusCounts: rows.reduce<Record<string, number>>((acc, row) => {
            acc[row.status] = (acc[row.status] ?? 0) + 1;
            return acc;
          }, {}),
        } as Prisma.InputJsonValue,
        calculatedAt: new Date(),
      };
    });
  }

  /** Công thức phạt do công ty cấu hình, KHÔNG hard-code (BR-12). */
  private computePenalty(
    rules: PenaltyRule[],
    lateCount: number,
    lateMinutesTotal: number,
  ): number | null {
    if (!Array.isArray(rules) || rules.length === 0) return null;

    const applicable = [...rules]
      .filter((rule) => lateCount >= rule.fromOccurrence)
      .sort((a, b) => b.fromOccurrence - a.fromOccurrence)[0];

    if (!applicable) return null;

    return (
      (applicable.fixedAmount ?? 0) + (applicable.amountPerMinute ?? 0) * lateMinutesTotal
    );
  }

  // ===========================================================================
  //  Xuất
  // ===========================================================================

  async requestExport(ctx: TenantContext, periodId: string, format: 'XLSX' | 'CSV' = 'XLSX') {
    await this.getPeriod(ctx.companyId, periodId);

    const job = await this.prisma.exportJob.create({
      data: {
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        kind: 'PAYROLL',
        status: 'QUEUED',
        params: { periodId, format } as Prisma.InputJsonValue,
      },
    });

    await this.exportQueue.add(JOBS.EXPORT_PAYROLL, { exportJobId: job.id });
    return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}` };
  }

  // ===========================================================================
  //  Tính lại theo lô
  // ===========================================================================

  /** FR-ADM-OPS-04 — chạy lại tính công cho một khoảng thời gian. */
  async requestRecalculateRange(
    companyId: string,
    from: string,
    to: string,
    employeeIds?: string[],
  ) {
    await this.payrollQueue.add(JOBS.RECALCULATE_RANGE, { companyId, from, to, employeeIds });
    const dayCount = eachWorkDate(parseWorkDate(from), parseWorkDate(to)).length;
    return { queued: true, dayCount };
  }

  /**
   * Chạy tính lại đồng bộ cho một khoảng — dùng bởi worker.
   * BR-07: bỏ qua ngày thuộc kỳ đã chốt và ghi cảnh báo.
   */
  async runRecalculateRange(
    companyId: string,
    from: Date,
    to: Date,
    employeeIds?: string[],
  ): Promise<{ calculated: number; skippedLockedDays: number }> {
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { not: EmployeeStatus.PENDING_ACTIVATION },
        ...(employeeIds?.length ? { id: { in: employeeIds } } : {}),
      },
      select: { id: true },
    });

    const closedPeriods = await this.prisma.payrollPeriod.findMany({
      where: {
        companyId,
        status: PayrollPeriodStatus.CLOSED,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { startDate: true, endDate: true, name: true },
    });

    const isLocked = (date: Date) =>
      closedPeriods.some((period) => date >= period.startDate && date <= period.endDate);

    let calculated = 0;
    let skippedLockedDays = 0;

    for (const workDate of eachWorkDate(from, to)) {
      if (isLocked(workDate)) {
        skippedLockedDays += employees.length;
        continue;
      }
      for (const employee of employees) {
        await this.engine.calculateAndPersist(companyId, employee.id, workDate);
        calculated += 1;
      }
    }

    if (skippedLockedDays > 0) {
      this.logger.warn(
        `Bỏ qua ${skippedLockedDays} lượt tính công vì thuộc kỳ lương đã chốt (BR-07)`,
      );
    }

    return { calculated, skippedLockedDays };
  }

  /** Ngày có bản ghi chấm công nhưng chưa có bảng công — dùng cho job quét đêm. */
  async findDatesNeedingRecalculation(companyId: string, since: Date): Promise<
    Array<{ employeeId: string; workDate: Date }>
  > {
    const logs = await this.prisma.attendanceLog.findMany({
      where: { companyId, createdAt: { gte: since }, type: { in: [AttendanceType.CHECK_IN, AttendanceType.CHECK_OUT] } },
      select: { employeeId: true, workDate: true },
      distinct: ['employeeId', 'workDate'],
    });
    return logs;
  }
}
