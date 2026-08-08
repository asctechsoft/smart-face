import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { configuration } from './configuration';
import { validateEnv } from './env.validation';

/**
 * Cấu hình tập trung — mọi biến môi trường đi qua đúng một cửa này.
 *
 * NFR-MAINT-05: không nơi nào khác được đọc thẳng `process.env`, vì như vậy sẽ
 * không ai biết hệ thống thực sự cần những biến nào, và biến gõ sai tên chỉ lộ
 * ra lúc chạy vào đúng nhánh code đó.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Cache giá trị đã đọc. Config không đổi trong vòng đời tiến trình, mà
      // `ConfigService.get()` được gọi ở đường nóng (mỗi request qua guard).
      cache: true,
      // Gom biến thô thành cây cấu hình có kiểu — xem configuration.ts.
      load: [configuration],
      // Fail fast: thiếu biến bắt buộc thì CHẾT LÚC KHỞI ĐỘNG, không phải chết
      // giữa chừng lúc 9 giờ sáng khi cả công ty đang chấm công.
      validate: validateEnv,
      // Thứ tự có ý nghĩa: `.env.local` thắng `.env`. Nhờ vậy mỗi lập trình viên
      // ghi đè vài biến cho máy mình mà không đụng vào `.env` chung của nhóm.
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}

export { ConfigService };
