import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PayrollPeriodStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { parseWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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
    const locked = await this.prisma.payrollPeriod.findFirst({
      where: {
        companyId,
        status: PayrollPeriodStatus.CLOSED,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { name: true },
    });
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
    const { companyId, from, to } = job.data as { companyId: string; from: string; to: string };
    const startedAt = Date.now();

    const result = await this.payroll.runRecalculateRange(
      companyId,
      parseWorkDate(from),
      parseWorkDate(to),
    );

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

    const companies = companyId
      ? [{ id: companyId }]
      : await this.prisma.company.findMany({
          where: { status: { in: ['TRIAL', 'ACTIVE'] }, deletedAt: null },
          select: { id: true },
        });

    let calculated = 0;
    for (const company of companies) {
      const targets = await this.payroll.findDatesNeedingRecalculation(company.id, since);
      for (const target of targets) {
        await this.engine
          .calculateAndPersist(company.id, target.employeeId, target.workDate)
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

    return { calculated, companyCount: companies.length };
  }
}
