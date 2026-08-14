import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { parseWorkDate } from 'src/common/utils';
import { JobsRepository } from '../jobs.repository';
import { PayrollEngineService } from 'src/modules/payroll/payroll-engine.service';
import { PayrollService } from 'src/modules/payroll/payroll.service';
import { JOBS, QUEUES } from '../queue.constants';

/**
 * Queue `payroll` — tính công.
 *
 * ⚠ YÊU CẦU BẮT BUỘC (docs/02 mục 10, NFR-REL-06): job phải IDEMPOTENT.
 * Chạy lại nhiều lần cho cùng (employee, date) phải ra kết quả GIỐNG HỆT,
 * vì đơn nghỉ duyệt muộn và sửa cấu hình ca đều kích hoạt tính lại.
 */
@Processor(QUEUES.PAYROLL, { concurrency: 4 })
export class PayrollProcessor extends WorkerHost {
  private readonly logger = new Logger(PayrollProcessor.name);

  constructor(
    private readonly engine: PayrollEngineService,
    private readonly payroll: PayrollService,
    private readonly jobs: JobsRepository,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOBS.RECALCULATE_DAILY:
        return this.recalculateDaily(job);
      case JOBS.RECALCULATE_RANGE:
        return this.recalculateRange(job);
      case JOBS.RECALCULATE_PERIOD:
        return this.recalculatePeriod(job);
      case JOBS.NIGHTLY_RECALCULATE:
        return this.nightlyRecalculate(job);
      default:
        this.logger.warn(`Job không xác định trong queue payroll: ${job.name}`);
        return null;
    }
  }

  private async recalculateDaily(job: Job) {
    const { companyId, employeeId, workDate } = job.data as {
      companyId: string;
      employeeId: string;
      workDate: string;
    };
    const date = parseWorkDate(workDate);

    // BR-07: kỳ đã chốt thì BỎ QUA và ghi cảnh báo, không ghi đè số liệu đã chốt.
    const locked = await this.jobs.findClosedPeriodCovering(companyId, date);
    if (locked) {
      this.logger.warn(
        `Bỏ qua tính công ${employeeId} ngày ${workDate}: thuộc kỳ đã chốt "${locked.name}" (BR-07)`,
      );
      return { skipped: true, reason: 'PERIOD_CLOSED' };
    }

    const result = await this.engine.calculateAndPersist(companyId, employeeId, date);
    return { status: result.status, workedMinutes: result.workedMinutes };
  }

  private async recalculateRange(job: Job) {
    const { companyId, from, to, employeeIds } = job.data as {
      companyId: string;
      from: string;
      to: string;
      employeeIds?: string[];
    };
    return this.payroll.runRecalculateRange(
      companyId,
      parseWorkDate(from),
      parseWorkDate(to),
      employeeIds,
    );
  }

  private async recalculatePeriod(job: Job) {
    const { companyId, from, to, jobId } = job.data as {
      companyId: string;
      from: string;
      to: string;
      /** Bản ghi `export_job` để client hỏi tiến độ. Job cũ trong Redis không có. */
      jobId?: string;
    };
    const startedAt = Date.now();

    const result = jobId
      ? await this.payroll.runTrackedRecalculate(
          companyId,
          jobId,
          parseWorkDate(from),
          parseWorkDate(to),
        )
      : await this.payroll.runRecalculateRange(companyId, parseWorkDate(from), parseWorkDate(to));

    // NFR-PERF-07: 500 nhân viên × 31 ngày phải xong dưới 5 phút.
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 5 * 60 * 1000) {
      this.logger.warn(
        `Tính công kỳ ${from}..${to} mất ${Math.round(elapsedMs / 1000)}s — vượt ngưỡng NFR-PERF-07 (300s)`,
      );
    }

    return { ...result, elapsedMs };
  }

  /** Cron hằng đêm: tính lại các ngày có bản ghi chấm công mới trong 24h qua. */
  private async nightlyRecalculate(job: Job) {
    const { companyId } = job.data as { companyId?: string };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const companyIds = companyId
      ? [companyId]
      : await this.jobs.acrossTenantsFindOperatingCompanyIds();

    let calculated = 0;
    for (const id of companyIds) {
      const targets = await this.payroll.findDatesNeedingRecalculation(id, since);
      for (const target of targets) {
        await this.engine
          .calculateAndPersist(id, target.employeeId, target.workDate)
          .then(() => {
            calculated += 1;
          })
          .catch((error: Error) =>
            this.logger.error(
              `Tính công thất bại (${target.employeeId} @ ${target.workDate.toISOString()}): ${error.message}`,
            ),
          );
      }
    }

    return { calculated, companyCount: companyIds.length };
  }
}
