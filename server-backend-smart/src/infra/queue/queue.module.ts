import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
 */

// Sinh danh sách queue từ hằng số thay vì liệt kê tay: thêm queue mới chỉ cần
// khai một chỗ ở queue.constants.ts, không thể quên đăng ký ở đây.
const registeredQueues = Object.values(QUEUES).map((name) => ({ name }));

@Global()
@Module({
  imports: [
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
  ],
  exports: [BullModule],
})
export class QueueModule {}
