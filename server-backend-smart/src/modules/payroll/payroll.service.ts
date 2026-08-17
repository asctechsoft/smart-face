import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DailyStatus, PayrollPeriodStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppException } from 'src/common/errors';
import { eachWorkDate, formatWorkDate, parseWorkDate } from 'src/common/utils';
import { isRedisEnabled } from 'src/config/configuration';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import { FraudService } from '../fraud/fraud.service';
import { PolicyKeys, PenaltyRule } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { PayrollEngineService } from './payroll-engine.service';
import { PayrollRepository } from './payroll.repository';
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
    private readonly payrolls: PayrollRepository,
    private readonly transactions: TransactionManager,
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
    return this.payrolls.listPeriods(companyId);
  }

  async createPeriod(companyId: string, name: string, startDate: string, endDate: string) {
    const start = parseWorkDate(startDate);
    const end = parseWorkDate(endDate);

    const overlapping = await this.payrolls.findOverlappingPeriod(companyId, start, end);
    if (overlapping) {
      throw new AppException('PAY_PERIOD_OVERLAP', { existingPeriod: overlapping.name });
    }

    return this.payrolls.createPeriod(companyId, { name, startDate: start, endDate: end });
  }

  async getPeriod(companyId: string, periodId: string) {
    const period = await this.payrolls.findPeriod(companyId, periodId);
    if (!period) {
      throw new AppException('PAY_PERIOD_NOT_FOUND');
    }
    return period;
  }

  /**
   * Tính lại toàn bộ bảng công của kỳ — chạy nền.
   * NFR-PERF-07: 500 nhân viên × 31 ngày phải xong dưới 5 phút.
   *
   * ## Vì sao phải trả `jobId`
   *
   * Trước đây endpoint chỉ trả `{ queued: true }`. Giao diện không có gì để hỏi
   * tiến độ nên chỉ báo được đúng một câu "đã đưa vào hàng đợi" rồi im lặng mãi
   * mãi — kế toán không biết bảng công đã tính xong chưa, và cách duy nhất để
   * kiểm tra là tự tải lại trang vài lần. Giờ job có bản ghi trong `export_job`
   * như job xuất Excel, hỏi qua `GET /v1/jobs/:id`.
   *
   * ## Vì sao có nhánh chạy nội tuyến
   *
   * `REDIS_ENABLED=false` thì `payrollQueue` là queue giả: nó VỨT BỎ job và chỉ
   * ghi một dòng warn (xem `disabled-queue.ts`). Endpoint vẫn trả 202 nên người
   * dùng được báo "đã xếp hàng" cho một việc sẽ không bao giờ chạy. Thà chạy
   * ngay trong tiến trình API — chậm hơn, không thử lại được, nhưng KẾT QUẢ CÓ
   * THẬT và tiến độ vẫn theo dõi được qua đúng đường cũ.
   */
  async recalculatePeriod(ctx: TenantContext, periodId: string) {
    const period = await this.getPeriod(ctx.companyId, periodId);
    if (period.status === PayrollPeriodStatus.CLOSED) {
      throw new AppException('PAY_PERIOD_CLOSED');
    }

    const from = formatWorkDate(period.startDate);
    const to = formatWorkDate(period.endDate);

    const job = await this.payrolls.createExportJob(ctx.companyId, {
      createdBy: ctx.userId,
      kind: 'PAYROLL_RECALCULATE',
      params: { periodId, from, to } as Prisma.InputJsonValue,
    });

    if (isRedisEnabled()) {
      await this.payrollQueue.add(JOBS.RECALCULATE_PERIOD, {
        companyId: ctx.companyId,
        periodId,
        jobId: job.id,
        from,
        to,
      });
    } else {
      // Cố ý không `await`: request phải trả 202 ngay, client theo dõi qua job.
      // `.catch` bắt trọn vì promise không ai giữ — để lọt sẽ thành
      // unhandledRejection và giết tiến trình Node.
      void this.runTrackedRecalculate(
        ctx.companyId,
        job.id,
        period.startDate,
        period.endDate,
      ).catch((error: Error) =>
        this.logger.error(`Tính lại kỳ ${periodId} (nội tuyến) thất bại: ${error.message}`),
      );
    }

    return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}`, queued: true, periodId };
  }

  /**
   * Chạy tính lại và cập nhật bản ghi job — DÙNG CHUNG cho worker BullMQ và cho
   * nhánh nội tuyến ở trên.
   *
   * Ném lại lỗi sau khi đã ghi FAILED: BullMQ cần thấy exception mới thử lại
   * theo `DEFAULT_JOB_OPTIONS`. Phía nội tuyến tự nuốt bằng `.catch`.
   */
  async runTrackedRecalculate(
    companyId: string,
    jobId: string,
    from: Date,
    to: Date,
    /**
     * Giới hạn vào một tập nhân viên. Bỏ trống = toàn công ty.
     *
     * Bảng chấm công dùng tham số này để chỉ tính lại đúng thành viên của bảng:
     * tính lại cả công ty khi người dùng chỉ muốn làm mới một phòng là đẩy tải
     * gấp hàng chục lần lên đúng bảng lớn nhất hệ thống.
     */
    employeeIds?: string[],
  ) {
    await this.payrolls.markJobProcessing(jobId);

    try {
      const result = await this.runRecalculateRange(companyId, from, to, employeeIds, (percent) =>
        this.payrolls.setJobProgress(jobId, percent),
      );
      await this.payrolls.markJobDone(jobId);
      return result;
    } catch (error) {
      await this.payrolls.markJobFailed(jobId, 'PAY_RECALC_FAILED', (error as Error).message);
      throw error;
    }
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
      this.payrolls.countMissingRecordDays(companyId, period.startDate, period.endDate),
      this.payrolls.countPendingRequestsInRange(
        companyId,
        period.startDate,
        new Date(period.endDate.getTime() + 86_400_000),
      ),
      this.fraud.countUnreviewedInRange(companyId, period.startDate, period.endDate),
      this.payrolls.sumStandardDaysByEmployee(companyId, period.startDate, period.endDate),
    ]);

    // Phát hiện số công bất thường so với trung vị của công ty.
    const totals = dailies.map((row) => row.standardDays).sort((a, b) => a - b);
    const median = totals.length > 0 ? totals[Math.floor(totals.length / 2)] : 0;

    const anomalousIds = dailies
      .filter(
        (row) => median > 0 && (row.standardDays < median * 0.5 || row.standardDays > median * 1.5),
      )
      .map((row) => row.employeeId);

    const anomalousEmployees = await this.payrolls.findEmployeeLabels(companyId, anomalousIds);
    const employeeMap = new Map(anomalousEmployees.map((employee) => [employee.id, employee]));

    const anomalies = dailies
      .filter((row) => anomalousIds.includes(row.employeeId))
      .map((row) => {
        const employee = employeeMap.get(row.employeeId);
        const value = row.standardDays;
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

    await this.transactions.run(async (tx) => {
      // `buildSummaries` kèm sẵn `employee` để màn hình xem trước hiển thị được.
      // Ảnh chụp trong DB chỉ nhận đúng các cột của bảng — để lọt trường thừa vào
      // `createMany` là Prisma ném lỗi ngay lúc chốt kỳ.
      await this.payrolls.replaceSummaries(
        ctx.companyId,
        periodId,
        summaries.map(({ employee: _employee, ...row }) => row),
        tx,
      );
      await this.payrolls.updatePeriodStatus(
        ctx.companyId,
        periodId,
        {
          status: PayrollPeriodStatus.CLOSED,
          closedAt: new Date(),
          closedBy: ctx.userId,
        },
        tx,
      );
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

    await this.payrolls.updatePeriodStatus(ctx.companyId, periodId, {
      status: PayrollPeriodStatus.REVIEWING,
      reopenedAt: new Date(),
      reopenedBy: ctx.userId,
      reopenReason: reason,
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
      const summaries = await this.payrolls.findSummaries(companyId, periodId);
      const employees = await this.payrolls.findEmployeeLabels(
        companyId,
        summaries.map((row) => row.employeeId),
      );
      const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

      return {
        period,
        fromSnapshot: true,
        items: summaries.map((summary) =>
          this.toSummaryRow(summary, employeeMap.get(summary.employeeId) ?? null),
        ),
      };
    }

    const rows = await this.buildSummaries(companyId, period.startDate, period.endDate);
    return {
      period,
      fromSnapshot: false,
      items: rows.map((row) => this.toSummaryRow(row, row.employee)),
    };
  }

  /**
   * Một dòng bảng công — hình dạng GIỐNG NHAU cho kỳ đang mở và kỳ đã chốt.
   *
   * Hai nhánh của `getPeriodSummary` đọc từ hai nguồn khác nhau và trước đây trả
   * ra hai hình dạng khác nhau: nhánh snapshot đọc thẳng từ Prisma nên
   * `standardDays`, `leaveDays`, `penaltyAmount` là `Decimal` — tuần tự hoá thành
   * CHUỖI trong JSON — còn nhánh tính trực tiếp trả `number`. Client phải đoán
   * kiểu theo trạng thái kỳ, và `formatNumber("18.50")` thì ra `NaN`.
   *
   * Hai trường được suy thêm ở đây thay vì để client tự tính:
   *
   *   `otMinutes`  — tổng ba loại OT. Bảng chỉ có một cột OT; ba cột riêng vẫn
   *                  giữ nguyên cho ai cần tách hệ số (docs/04 mục 7.3).
   *   `absentDays` — đếm từ `breakdown.statusCounts`. Không có cột riêng trong
   *                  `payroll_summary`, nhưng `breakdown` được chốt cùng snapshot
   *                  nên số này đúng cho cả kỳ đã chốt.
   */
  private toSummaryRow<E>(
    row: {
      employeeId: string;
      standardDays: Prisma.Decimal | number;
      workedMinutes: number;
      otMinutesNormal: number;
      otMinutesWeekend: number;
      otMinutesHoliday: number;
      lateCount: number;
      lateMinutesTotal: number;
      earlyLeaveCount: number;
      leaveDays: Prisma.Decimal | number;
      unpaidLeaveDays: Prisma.Decimal | number;
      makeupMinutes: number;
      penaltyAmount: Prisma.Decimal | number | null;
      violationCount: number;
      breakdown: unknown;
    },
    employee: E,
  ) {
    const statusCounts =
      (row.breakdown as { statusCounts?: Record<string, number> } | null)?.statusCounts ?? {};

    return {
      employeeId: row.employeeId,
      employee,
      standardDays: Number(row.standardDays),
      workedMinutes: row.workedMinutes,
      otMinutes: row.otMinutesNormal + row.otMinutesWeekend + row.otMinutesHoliday,
      otMinutesNormal: row.otMinutesNormal,
      otMinutesWeekend: row.otMinutesWeekend,
      otMinutesHoliday: row.otMinutesHoliday,
      lateCount: row.lateCount,
      lateMinutesTotal: row.lateMinutesTotal,
      earlyLeaveCount: row.earlyLeaveCount,
      leaveDays: Number(row.leaveDays),
      unpaidLeaveDays: Number(row.unpaidLeaveDays),
      absentDays: statusCounts[DailyStatus.ABSENT] ?? 0,
      missingRecordDays: statusCounts[DailyStatus.MISSING_RECORD] ?? 0,
      makeupMinutes: row.makeupMinutes,
      penaltyAmount: row.penaltyAmount === null ? null : Number(row.penaltyAmount),
      violationCount: row.violationCount,
    };
  }

  /**
   * Tổng hợp từ `AttendanceDaily` — KHÔNG quét `AttendanceLog` (docs/04 mục 9.1).
   * Phạt tính theo `payroll.penalty.rules` cấu hình được (BR-12, FR-WEB-PAY-02).
   */
  private async buildSummaries(companyId: string, startDate: Date, endDate: Date) {
    const [dailies, penaltyRules, employees, holidays] = await Promise.all([
      this.payrolls.findDailiesInRange(companyId, startDate, endDate),
      this.policy.get<PenaltyRule[]>(companyId, PolicyKeys.PAYROLL_PENALTY_RULES),
      this.payrolls.findPayableEmployees(companyId),
      this.payrolls.findHolidayDates(companyId, startDate, endDate),
    ]);

    const holidayKeys = new Set(holidays.map((date) => formatWorkDate(date)));
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
        violationCount: lateRows.length + rows.filter((row) => row.earlyLeaveMinutes > 0).length,
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

    return (applicable.fixedAmount ?? 0) + (applicable.amountPerMinute ?? 0) * lateMinutesTotal;
  }

  // ===========================================================================
  //  Xuất
  // ===========================================================================

  async requestExport(ctx: TenantContext, periodId: string, format: 'XLSX' | 'CSV' = 'XLSX') {
    await this.getPeriod(ctx.companyId, periodId);

    const job = await this.payrolls.createExportJob(ctx.companyId, {
      createdBy: ctx.userId,
      kind: 'PAYROLL',
      params: { periodId, format } as Prisma.InputJsonValue,
    });

    // Khác với tính lại kỳ, xuất Excel KHÔNG chạy nội tuyến được: file phải nằm
    // trên object storage rồi trả về bằng link có thời hạn, mà cả worker lẫn
    // storage đều tắt trong cấu hình không-Redis. Nên đánh hỏng ngay từ đây —
    // để job nằm im ở trạng thái QUEUED thì giao diện quay vòng đến hết ngày.
    if (!isRedisEnabled()) {
      await this.payrolls.markJobFailed(
        job.id,
        'SYS_WORKER_UNAVAILABLE',
        'Máy chủ đang chạy không có dịch vụ nền (REDIS_ENABLED=false) nên không dựng được file Excel.',
      );
      return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}`, queued: false };
    }

    await this.exportQueue.add(JOBS.EXPORT_PAYROLL, { exportJobId: job.id });
    return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}`, queued: true };
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
    onProgress?: (percent: number) => Promise<void>,
  ): Promise<{ calculated: number; skippedLockedDays: number; employeeCount: number }> {
    const employees = await this.payrolls.findCalculableEmployeeIds(companyId, employeeIds);

    /**
     * Không có ai để tính là một SỰ KIỆN, không phải một lượt chạy thành công.
     *
     * Đây chính là cách một lỗi thật đã lọt qua: bộ lọc trạng thái loại hết nhân
     * viên, vòng lặp không chạy lần nào, job báo `DONE` 100% — và người dùng bấm
     * nút, nhận thông báo thành công, rồi tự hỏi vì sao bảng công không đổi.
     * Một dòng cảnh báo ở đây là thứ rẻ nhất biến câu hỏi đó thành câu trả lời.
     */
    if (employees.length === 0) {
      this.logger.warn(
        `Tính lại ${formatWorkDate(from)}..${formatWorkDate(to)} không có nhân viên nào trong phạm vi` +
          `${employeeIds?.length ? ` (đã lọc theo ${employeeIds.length} id)` : ''} — không ghi bản ghi công nào.`,
      );
    }

    const closedPeriods = await this.payrolls.findClosedPeriodsInRange(companyId, from, to);

    const isLocked = (date: Date) =>
      closedPeriods.some((period) => date >= period.startDate && date <= period.endDate);

    let calculated = 0;
    let skippedLockedDays = 0;

    const workDates = eachWorkDate(from, to);
    // Chỉ ghi tiến độ khi con số nhảy đủ xa. Cập nhật sau MỖI ngày là thêm 31
    // lượt UPDATE cho một việc chỉ để vẽ thanh tiến trình — trong khi mắt người
    // không phân biệt nổi 61% với 64%.
    let reportedPercent = 0;

    for (const [index, workDate] of workDates.entries()) {
      if (isLocked(workDate)) {
        skippedLockedDays += employees.length;
      } else {
        for (const employeeId of employees) {
          await this.engine.calculateAndPersist(companyId, employeeId, workDate);
          calculated += 1;
        }
      }

      if (onProgress) {
        const percent = Math.round(((index + 1) / workDates.length) * 100);
        if (percent - reportedPercent >= 5 || index === workDates.length - 1) {
          reportedPercent = percent;
          await onProgress(percent);
        }
      }
    }

    if (skippedLockedDays > 0) {
      this.logger.warn(
        `Bỏ qua ${skippedLockedDays} lượt tính công vì thuộc kỳ lương đã chốt (BR-07)`,
      );
    }

    return { calculated, skippedLockedDays, employeeCount: employees.length };
  }

  /** Ngày có bản ghi chấm công nhưng chưa có bảng công — dùng cho job quét đêm. */
  async findDatesNeedingRecalculation(
    companyId: string,
    since: Date,
  ): Promise<Array<{ employeeId: string; workDate: Date }>> {
    return this.payrolls.findRecentlyPunchedEmployees(companyId, since);
  }
}
