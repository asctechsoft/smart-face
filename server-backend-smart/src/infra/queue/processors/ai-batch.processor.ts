import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobsRepository } from '../jobs.repository';
import { FraudService } from 'src/modules/fraud/fraud.service';
import { FraudCodes } from 'src/modules/fraud/fraud.types';
import { PolicyKeys } from 'src/modules/policy/policy.constants';
import { PolicyService } from 'src/modules/policy/policy.service';
import { QUEUES } from '../queue.constants';

/**
 * AF-08 — Random audit chạy hằng đêm.
 *
 * Chọn ngẫu nhiên X% lượt chấm công trong ngày, so điểm tương đồng với TRUNG BÌNH
 * LỊCH SỬ của chính nhân viên đó. Điểm thấp bất thường → gắn cờ.
 *
 * Mục đích: phát hiện trường hợp lọt qua ngưỡng nhưng thực chất không phải người
 * đó, hoặc phát hiện model bị suy giảm chất lượng theo thời gian.
 */
@Processor(QUEUES.AI_BATCH)
export class AiBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(AiBatchProcessor.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly policy: PolicyService,
    private readonly fraud: FraudService,
  ) {
    super();
  }

  async process(_job: Job): Promise<unknown> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // So với TRUNG BÌNH LỊCH SỬ CỦA CHÍNH NGƯỜI ĐÓ, không so với một ngưỡng cố
    // định chung. Lý do: điểm tương đồng của mỗi người có mức nền khác nhau —
    // người đeo kính, người có râu, người da sẫm màu trong điều kiện thiếu sáng
    // đều có điểm nền thấp hơn mà vẫn hoàn toàn là chính họ. Ngưỡng chung sẽ
    // liên tục báo nhầm đúng những người đó. Điều đáng ngờ là điểm TỤT SO VỚI
    // CHÍNH MÌNH, không phải điểm thấp hơn người khác.
    const companyIds = await this.jobs.acrossTenantsFindOperatingCompanyIds();

    let sampled = 0;
    let flagged = 0;

    for (const companyId of companyIds) {
      const percent = await this.policy.getNumber(companyId, PolicyKeys.FRAUD_RANDOM_AUDIT_PERCENT);
      if (percent <= 0) continue;

      const logs = await this.jobs.findAuditCandidates(companyId, since);
      if (logs.length === 0) continue;

      const sampleSize = Math.max(1, Math.ceil((logs.length * percent) / 100));
      const sample = this.pickRandom(logs, sampleSize);
      sampled += sample.length;

      for (const log of sample) {
        // Trung bình lịch sử 30 ngày của CHÍNH nhân viên đó.
        const history = await this.jobs.averageMatchScore(
          companyId,
          log.employeeId,
          new Date(log.recordedAt.getTime() - 30 * 24 * 60 * 60 * 1000),
          log.recordedAt,
        );

        // Cần đủ mẫu mới so được.
        if (history.sampleCount < 5 || history.average === null) continue;

        const average = history.average;
        const current = log.matchScore as number;

        // Thấp hơn 20% so với trung bình lịch sử → đáng ngờ.
        if (current >= average * 0.8) continue;

        const hasProfile = await this.jobs.countActiveFaceProfiles(companyId, log.employeeId);
        if (hasProfile === 0) continue;

        await this.fraud.persistFlags({
          companyId,
          employeeId: log.employeeId,
          attendanceLogId: log.id,
          signals: [
            {
              code: FraudCodes.LOW_SIMILARITY_AUDIT,
              severity: 'MEDIUM',
              score: 25,
              message: `Điểm tương đồng ${current.toFixed(3)} thấp bất thường so với trung bình lịch sử ${average.toFixed(3)}.`,
              details: {
                matchScore: current,
                historicalAverage: average,
                sampleCount: history.sampleCount,
              },
            },
          ],
        });
        flagged += 1;
      }
    }

    this.logger.log(`Random audit: lấy mẫu ${sampled} lượt, gắn cờ ${flagged}`);
    return { sampled, flagged, companyCount: companyIds.length };
  }

  private pickRandom<T>(items: T[], count: number): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy.slice(0, count);
  }
}
