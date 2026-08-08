import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PushService } from './push.service';
import { RealtimeGateway } from './realtime.gateway';
import { SmsService } from './sms.service';

/**
 * Thông báo — ba kênh gửi, dùng chung một chỗ tạo bản ghi.
 *
 * - `NotificationService` — ghi thông báo vào DB (nguồn sự thật, App đọc lại được).
 * - `SmsService`          — OTP và cảnh báo bảo mật.
 * - `PushService`         — FCM, đẩy tới App khi đang đóng.
 * - `RealtimeGateway`     — WebSocket, đẩy tới Web Quản lý đang mở.
 *
 * `@Global()` vì gần như mọi module nghiệp vụ đều cần báo cho ai đó: duyệt đơn,
 * phát hiện gian lận, chốt bảng lương. Không đặt Global thì 10+ module phải khai
 * lại `imports: [NotificationModule]`, quên một chỗ là lỗi lúc chạy chứ không
 * phải lúc biên dịch.
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, SmsService, PushService, RealtimeGateway],
  exports: [NotificationService, SmsService, PushService, RealtimeGateway],
})
export class NotificationModule {}
