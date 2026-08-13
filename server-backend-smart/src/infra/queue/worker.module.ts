import { Logger, Module, Provider } from '@nestjs/common';
import { isRedisEnabled, isWorkerEnabled } from 'src/config/configuration';
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
 *
 * ## Vì sao phải chặn ngay từ danh sách provider
 *
 * `@Processor()` của `@nestjs/bullmq` tạo một `Worker` BullMQ ngay khi class được
 * đăng ký làm provider, và `Worker` bắt đầu tiêu thụ job lập tức. Không có công
 * tắc lúc chạy nào tắt được nó. Vì vậy hai cờ dưới đây phải quyết định NGAY ở
 * bước dựng module, không phải bằng một câu `if` bên trong processor.
 *
 * - `REDIS_ENABLED=false` → không có Redis, `Worker` sẽ thử kết nối vô hạn.
 * - `WORKER_ENABLED=false` → pod này cố ý không nhận việc.
 */
const workerActive = isRedisEnabled() && isWorkerEnabled();

const workerProviders: Provider[] = workerActive
  ? [
      JobsRepository,
      SmsProcessor,
      NotificationProcessor,
      PayrollProcessor,
      ExportProcessor,
      FraudScanProcessor,
      AiBatchProcessor,
      RetentionProcessor,
      SchedulerService,
    ]
  : [];

if (!workerActive) {
  const reason = !isRedisEnabled() ? 'REDIS_ENABLED=false' : 'WORKER_ENABLED=false';
  new Logger('WorkerModule').log(`${reason} — tiến trình này KHÔNG xử lý job nền.`);
}

@Module({
  // Khi không chạy worker thì cũng không cần kéo theo module nghiệp vụ nào: chúng
  // chỉ có mặt ở đây để processor tiêm service.
  imports: workerActive ? [PayrollModule, FraudModule, NotificationModule] : [],
  providers: workerProviders,
})
export class WorkerModule {}
