import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ulid } from 'ulid';

/**
 * Logging có cấu trúc (NFR-OBS-01): mọi request có `traceId`, log dạng JSON.
 * NFR-OBS-08: KHÔNG log ảnh, embedding, token, OTP.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<boolean>('app.isProduction');
        return {
          pinoHttp: {
            level: isProduction ? 'info' : 'debug',
            /**
             * Nhận traceId từ client nếu có, không thì sinh ULID mới.
             *
             * Nhận lại của client cho phép nối log XUYÊN hệ thống: App gặp lỗi,
             * người dùng gửi mã đó, tra ra đúng request ở Backend. ULID chứ
             * không phải UUID vì ULID sắp xếp được theo thời gian — grep ra một
             * dải mã là chúng nằm đúng thứ tự thời gian.
             *
             * Trả ngược qua header `X-Trace-Id` (đã khai ở `exposedHeaders` của
             * CORS trong main.ts) để client đọc được cả khi request thành công.
             */
            genReqId: (req, res) => {
              const existing = (req.headers['x-trace-id'] as string) || ulid();
              res.setHeader('X-Trace-Id', existing);
              return existing;
            },
            // Production ghi JSON thuần cho hệ thống thu thập log phân tích được.
            // Dev dùng pino-pretty cho người đọc. ⚠ pino-pretty CHẬM đáng kể,
            // đừng bật ở production.
            transport: isProduction
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
            /**
             * NFR-OBS-08 — che dữ liệu nhạy cảm trong log.
             *
             * ⚠ Danh sách này là DANH SÁCH CHO PHÉP NGƯỢC: chỉ che đúng những
             * đường dẫn khai ở đây, còn lại ghi hết. Thêm một trường nhạy cảm
             * vào DTO mà quên bổ sung vào đây là nó chảy thẳng vào log.
             *
             * Ba nhóm đang che:
             *   - Bí mật xác thực: `authorization`, `cookie`, `x-signature`
             *   - Dữ liệu sinh trắc: `image`, `imageBase64`, `publicKey`
             *   - Mã dùng một lần: `otp`, `signedChallenge`, `attestationToken`
             *
             * Ảnh và embedding còn có lý do thực dụng: một tấm ảnh base64 ghi ra
             * log là vài megabyte cho MỘT dòng.
             */
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-signature"]',
                'req.body.otp',
                'req.body.image',
                'req.body.imageBase64',
                'req.body.publicKey',
                'req.body.signedChallenge',
                'req.body.attestationToken',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            // Bỏ qua probe của K8s. Chúng gọi vài giây một lần, suốt ngày đêm —
            // để nguyên thì log thật bị chìm giữa hàng chục nghìn dòng vô nghĩa,
            // và chi phí lưu trữ log tăng theo.
            autoLogging: {
              ignore: (req) => req.url === '/health' || req.url === '/metrics',
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
