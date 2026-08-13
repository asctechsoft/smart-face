import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Global, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { isRedisEnabled } from 'src/config/configuration';
import { createDisabledQueue } from './disabled-queue';
import { DEFAULT_JOB_OPTIONS, QUEUES } from './queue.constants';

/**
 * BullMQ — hàng đợi job chạy nền trên Redis.
 *
 * Việc gì đưa vào đây: tính lương cả công ty, xuất Excel hàng nghìn dòng, quét
 * gian lận ban đêm, gửi SMS/push. Đặc điểm chung là chậm và KHÔNG được để người
 * dùng ngồi chờ, hoặc cần thử lại khi dịch vụ ngoài chập chờn.
 *
 * ⚠ Module này bắt buộc phải có Redis. Redis chết thì BullMQ thử kết nối lại vô
 * hạn và ứng dụng KHÔNG hoàn tất khởi động — biên dịch xong nhưng không bao giờ
 * listen được cổng. Gặp triệu chứng "app chạy mà không vào được" thì kiểm tra
 * Redis trước tiên.
 *
 * `REDIS_ENABLED=false` đổi hẳn nhánh: không đăng ký BullMQ, thay bằng queue giả
 * (`disabled-queue.ts`) để DI vẫn dựng được. Đây là lối thoát cho máy lập trình
 * viên chưa dựng nổi Redis, KHÔNG phải một chế độ triển khai.
 */

// Sinh danh sách queue từ hằng số thay vì liệt kê tay: thêm queue mới chỉ cần
// khai một chỗ ở queue.constants.ts, không thể quên đăng ký ở đây.
const queueNames = Object.values(QUEUES);
const registeredQueues = queueNames.map((name) => ({ name }));

// Đọc MỘT lần. Gọi rải rác ở `imports`/`providers`/`exports` thì ba chỗ về lý
// thuyết có thể thấy ba giá trị khác nhau, và hậu quả là một module nửa thật nửa
// giả — thứ gần như không thể lần ra khi đọc log.
const redisEnabled = isRedisEnabled();

// Cùng token với `@InjectQueue(name)`, nên phía tiêm không phân biệt được thật giả.
const disabledQueueTokens = queueNames.map((name) => getQueueToken(name));
const disabledQueueProviders: Provider[] = queueNames.map((name) => ({
  provide: getQueueToken(name),
  useFactory: () => createDisabledQueue(name),
}));

const bullImports = redisEnabled
  ? [
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            host: config.get<string>('redis.host'),
            port: config.get<number>('redis.port'),
            password: config.get<string>('redis.password'),
            db: config.get<number>('redis.db'),
          },
          // Chính sách thử lại / dọn job cũ dùng chung cho MỌI queue — xem
          // queue.constants.ts. Để mỗi queue tự khai sẽ dẫn tới chỗ thử lại 3 lần,
          // chỗ không thử lại, và không ai nhận ra cho tới khi mất job.
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }),
      }),
      // Đăng ký producer cho mọi queue. Consumer (processor) khai riêng ở
      // WorkerModule để pod API thuần có thể ĐẨY job mà không CHẠY job.
      BullModule.registerQueue(...registeredQueues),
    ]
  : [];

@Global()
@Module({
  imports: bullImports,
  providers: redisEnabled ? [] : disabledQueueProviders,
  // Khi bật Redis thì `BullModule` đã export sẵn token của các queue; khi tắt thì
  // phải tự export token giả, nếu không module khác inject sẽ không thấy.
  exports: redisEnabled ? [BullModule] : disabledQueueTokens,
})
export class QueueModule {}
