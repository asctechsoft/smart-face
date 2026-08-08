import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { JOBS, QUEUES } from './queue.constants';

/**
 * Lịch chạy job nền (docs/02 mục 10).
 *
 * Dùng repeatable job của BullMQ thay vì @Cron của Nest — nhờ vậy nhiều pod
 * worker chạy song song vẫn chỉ kích hoạt MỘT lần cho mỗi mốc thời gian.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUES.PAYROLL) private readonly payrollQueue: Queue,
    @InjectQueue(QUEUES.FRAUD_SCAN) private readonly fraudScanQueue: Queue,
    @InjectQueue(QUEUES.AI_BATCH) private readonly aiBatchQueue: Queue,
    @InjectQueue(QUEUES.RETENTION) private readonly retentionQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Pod API thuần (`WORKER_ENABLED=false`) không đăng ký lịch. Chỉ pod worker
    // mới làm việc này — tách vai trò để scale hai loại pod độc lập với nhau.
    if (!this.config.get<boolean>('worker.enabled', true)) {
      this.logger.log('WORKER_ENABLED=false — bỏ qua đăng ký job định kỳ');
      return;
    }

    try {
      await this.registerRepeatables();
      this.logger.log('Đã đăng ký các job định kỳ');
    } catch (error) {
      // Nuốt lỗi để ứng dụng vẫn khởi động được khi Redis chưa sẵn sàng: pod API
      // phục vụ chấm công vẫn quan trọng hơn việc có lịch chạy nền.
      // ⚠ Đánh đổi: lịch sẽ KHÔNG được đăng ký lại tự động. Thấy dòng log này thì
      // phải khởi động lại pod worker sau khi Redis hồi phục.
      this.logger.error(`Không đăng ký được job định kỳ: ${(error as Error).message}`);
    }
  }

  /**
   * Đăng ký các job lặp lại.
   *
   * `jobId` cố định (`cron:...`) là chốt chống nhân bản: chạy lại hàm này ở mỗi
   * lần khởi động pod, hoặc chạy đồng thời trên 5 pod worker, đều chỉ tạo ra
   * đúng MỘT lịch. Bỏ `jobId` thì mỗi lần deploy lại thêm một lịch nữa, và sau
   * vài tháng job tính lại bảng công chạy hàng chục lần mỗi đêm.
   *
   * `removeOnComplete: true` để lịch sử job hoàn thành không phình bộ nhớ Redis —
   * các job này chạy đều đặn suốt vòng đời hệ thống.
   */
  private async registerRepeatables(): Promise<void> {
    // Tính lại bảng công hằng đêm 02:00 — tránh khung giờ cao điểm.
    await this.payrollQueue.add(
      JOBS.NIGHTLY_RECALCULATE,
      {},
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'cron:nightly-recalculate',
        removeOnComplete: true,
      },
    );

    // AF-03 — quét impossible travel mỗi 15 phút.
    await this.fraudScanQueue.add(
      JOBS.SCAN_IMPOSSIBLE_TRAVEL,
      {},
      {
        repeat: { pattern: '*/15 * * * *' },
        jobId: 'cron:scan-impossible-travel',
        removeOnComplete: true,
      },
    );

    // AF-19 — quét thời lượng ca bất thường, chạy sau khi bảng công đã tính xong.
    await this.fraudScanQueue.add(
      JOBS.SCAN_SHORT_ATTENDANCE,
      {},
      {
        repeat: { pattern: '30 3 * * *' },
        jobId: 'cron:scan-short-attendance',
        removeOnComplete: true,
      },
    );

    await this.fraudScanQueue.add(
      JOBS.SCAN_MISSING_CHECKOUT,
      {},
      {
        repeat: { pattern: '45 3 * * *' },
        jobId: 'cron:scan-missing-checkout',
        removeOnComplete: true,
      },
    );

    // AF-08 — random audit đối chiếu ảnh chấm công vs hồ sơ.
    await this.aiBatchQueue.add(
      JOBS.RANDOM_AUDIT,
      {},
      {
        repeat: { pattern: '0 4 * * *' },
        jobId: 'cron:random-audit',
        removeOnComplete: true,
      },
    );

    // NFR-LEGAL-04 / NFR-SCALE-07 — dọn ảnh và tệp quá hạn lưu.
    //
    // Chạy 05:00, SAU random audit (04:00). Thứ tự này bắt buộc: random audit
    // đối chiếu ảnh chấm công với hồ sơ, chạy dọn trước thì nó mất chính những
    // tấm ảnh cần đối chiếu.
    await this.retentionQueue.add(
      JOBS.PURGE_ATTENDANCE_PHOTOS,
      {},
      {
        repeat: { pattern: '0 5 * * *' },
        jobId: 'cron:purge-attendance-photos',
        removeOnComplete: true,
      },
    );

    await this.retentionQueue.add(
      JOBS.PURGE_REVOKED_FACE_PROFILES,
      {},
      {
        repeat: { pattern: '15 5 * * *' },
        jobId: 'cron:purge-revoked-face-profiles',
        removeOnComplete: true,
      },
    );

    await this.retentionQueue.add(
      JOBS.PURGE_EXPIRED_EXPORTS,
      {},
      {
        repeat: { pattern: '30 5 * * *' },
        jobId: 'cron:purge-expired-exports',
        removeOnComplete: true,
      },
    );
  }
}
