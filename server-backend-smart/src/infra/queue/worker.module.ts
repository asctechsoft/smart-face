import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/modules/notification/notification.module';
import { PayrollModule } from 'src/modules/payroll/payroll.module';
import { FraudModule } from 'src/modules/fraud/fraud.module';
import { AiBatchProcessor } from './processors/ai-batch.processor';
import { ExportProcessor } from './processors/export.processor';
import { FraudScanProcessor } from './processors/fraud-scan.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { PayrollProcessor } from './processors/payroll.processor';
import { RetentionProcessor } from './processors/retention.processor';
import { SmsProcessor } from './processors/sms.processor';
import { JobsRepository } from './jobs.repository';
import { SchedulerService } from './scheduler.service';

/**
 * Đăng ký toàn bộ BullMQ processor + lịch job định kỳ.
 *
 * Đặt `WORKER_ENABLED=false` cho pod API thuần để chúng chỉ ĐẨY job, không XỬ LÝ —
 * nhờ vậy scale API (CPU/RPS) và worker (độ dài queue) độc lập được (docs/02 mục 12.2).
 */
@Module({
  imports: [PayrollModule, FraudModule, NotificationModule],
  providers: [
    JobsRepository,
    SmsProcessor,
    NotificationProcessor,
    PayrollProcessor,
    ExportProcessor,
    FraudScanProcessor,
    AiBatchProcessor,
    RetentionProcessor,
    SchedulerService,
  ],
})
export class WorkerModule {}
