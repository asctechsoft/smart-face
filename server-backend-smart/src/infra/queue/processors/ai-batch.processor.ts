import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AttendanceDecision, FaceProfileStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from 'src/infra/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly fraud: FraudService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // So với TRUNG BÌNH LỊCH SỬ CỦA CHÍNH NGƯỜI ĐÓ, không so với một ngưỡng cố
    // định chung. Lý do: điểm tương đồng của mỗi người có mức nền khác nhau —
    // người đeo kính, người có râu, người da sẫm màu trong điều kiện thiếu sáng
    // đều có điểm nền thấp hơn mà vẫn hoàn toàn là chính họ. Ngưỡng chung sẽ
    // liên tục báo nhầm đúng những người đó. Điều đáng ngờ là điểm TỤT SO VỚI
    // CHÍNH MÌNH, không phải điểm thấp hơn người khác.
    const companies = await this.prisma.company.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] }, deletedAt: null },
      select: { id: true },
    });

    let sampled = 0;
    let flagged = 0;

    for (const company of companies) {
      const percent = await this.policy.getNumber(
        company.id,
        PolicyKeys.FRAUD_RANDOM_AUDIT_PERCENT,
      );
      if (percent <= 0) continue;

      const logs = await this.prisma.attendanceLog.findMany({
        where: {
          companyId: company.id,
          recordedAt: { gte: since },
          matchScore: { not: null },
          decision: { not: AttendanceDecision.REJECTED },
        },
        select: { id: true, employeeId: true, matchScore: true, recordedAt: true },
      });
      if (logs.length === 0) continue;

      const sampleSize = Math.max(1, Math.ceil((logs.length * percent) / 100));
      const sample = this.pickRandom(logs, sampleSize);
      sampled += sample.length;

      for (const log of sample) {
        // Trung bình lịch sử 30 ngày của CHÍNH nhân viên đó.
        const history = await this.prisma.attendanceLog.aggregate({
          where: {
            companyId: company.id,
            employeeId: log.employeeId,
            matchScore: { not: null },
            recordedAt: {
              gte: new Date(log.recordedAt.getTime() - 30 * 24 * 60 * 60 * 1000),
              lt: log.recordedAt,
            },
          },
          _avg: { matchScore: true },
          _count: { _all: true },
        });

        // Cần đủ mẫu mới so được.
        if (history._count._all < 5 || history._avg.matchScore === null) continue;

        const average = history._avg.matchScore;
        const current = log.matchScore as number;

        // Thấp hơn 20% so với trung bình lịch sử → đáng ngờ.
        if (current >= average * 0.8) continue;

        const hasProfile = await this.prisma.faceProfile.count({
          where: { employeeId: log.employeeId, status: FaceProfileStatus.ACTIVE },
        });
        if (hasProfile === 0) continue;

        await this.fraud.persistFlags({
          companyId: company.id,
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
                sampleCount: history._count._all,
              },
            },
          ],
        });
        flagged += 1;
      }
    }

    this.logger.log(`Random audit: lấy mẫu ${sampled} lượt, gắn cờ ${flagged}`);
    return { sampled, flagged, companyCount: companies.length };
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
