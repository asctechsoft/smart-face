import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import type { AuthenticatedRequest } from './common/types/request-context';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // AF-12: SignatureGuard cần body THÔ để tính HMAC — verify phải chạy trước khi parse.
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('app.apiPrefix', 'v1');
  const port = config.get<number>('app.port', 3000);
  const isProduction = config.get<boolean>('app.isProduction', false);

  // ---------------------------------------------------------------------------
  //  AF-02b — `trust proxy`: quyết định `request.ip` là địa chỉ nào
  // ---------------------------------------------------------------------------
  //
  // Đây là cấu hình dễ làm sai nhất trong toàn bộ hệ thống, và làm sai theo cả
  // hai hướng đều hỏng:
  //
  //   Để mặc định (không tin proxy nào)
  //     → `request.ip` là IP của Nginx/Kong, không phải của nhân viên.
  //     → Danh sách IP văn phòng KHÔNG BAO GIỜ khớp, cả công ty không chấm công được.
  //
  //   Đặt `true` (tin mọi thứ trong X-Forwarded-For)
  //     → Ai cũng tự khai `X-Forwarded-For: <IP văn phòng>` là qua.
  //     → Chốt IP mất sạch tác dụng mà nhìn log vẫn thấy "đúng IP văn phòng".
  //       Tệ hơn không có chốt, vì nó tạo cảm giác an toàn giả.
  //
  // Cách đúng: khai CHÍNH XÁC số proxy đứng trước Backend. Express sẽ bỏ qua
  // đúng ngần ấy mục tính từ phải sang trong X-Forwarded-For — phần kẻ tấn công
  // tự thêm nằm ở bên trái nên không với tới được.
  //
  // `env.validation.ts` chặn khởi động ở production nếu chưa khai.
  const trustedProxyHops = config.get<number>('security.trustedProxyHops', 0);
  app.set('trust proxy', trustedProxyHops);
  logger.log(
    trustedProxyHops === 0
      ? 'trust proxy = 0 — dùng thẳng địa chỉ socket. Đúng khi KHÔNG có proxy đứng trước.'
      : `trust proxy = ${trustedProxyHops} proxy. request.ip lấy từ X-Forwarded-For, bỏ qua ${trustedProxyHops} mục cuối.`,
  );

  app.setGlobalPrefix(apiPrefix, {
    // Health/metrics nằm ngoài prefix để probe của K8s gọi thẳng.
    exclude: ['health', 'metrics'],
  });

  // NFR-SEC-02: security headers.
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Giữ bản sao body thô cho SignatureGuard.
  app.use(
    json({
      limit: '10mb',
      verify: (req, _res, buffer) => {
        (req as AuthenticatedRequest).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  const corsOrigins = config.get<string[]>('app.corsOrigins', []);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
    exposedHeaders: ['X-Trace-Id', 'Retry-After', 'X-RateLimit-Remaining'],
  });

  app.enableShutdownHooks();

  // NFR-MAINT-04: tài liệu API tự sinh từ decorator, luôn khớp thực tế.
  if (config.get<boolean>('app.swaggerEnabled', true)) {
    const documentConfig = new DocumentBuilder()
      .setTitle('SmartFace Backend Core API')
      .setDescription(
        [
          'API nghiệp vụ cho **App Nhân viên**, **Web Quản lý** và **Web Admin**.',
          '',
          '### Nguyên tắc bất di bất dịch',
          '- `BR-01` Thời gian chấm công chính thức LUÔN là giờ Server.',
          '- `BR-02` Backend KHÔNG tin cờ xác thực do client tự khai (`faceVerified`, `biometricOk`…).',
          '- `BR-06` Bản ghi chấm công thô là BẤT BIẾN. Hiệu chỉnh tạo bản ghi riêng.',
          '- `BR-09` Mọi truy vấn nghiệp vụ đều lọc theo `company_id` của phiên đăng nhập.',
          '- `BR-12` Chính sách công ty cấu hình được, không hard-code.',
          '',
          '### Định dạng phản hồi',
          'Thành công: `{ "success": true, "data": {...}, "meta": {...} }`',
          '',
          'Lỗi: `{ "success": false, "error": { code, message, messageEn, hint, retryable, details, traceId } }`',
          '',
          'Bảng mã lỗi đầy đủ: `GET /v1/meta/error-codes`',
        ].join('\n'),
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addGlobalParameters(
        {
          name: 'X-Device-Id',
          in: 'header',
          required: false,
          description: 'ID thiết bị — phải khớp `deviceId` trong token (AF-16). Bắt buộc với App.',
          schema: { type: 'string' },
        },
        {
          name: 'X-Platform',
          in: 'header',
          required: false,
          description: '`ios` | `android` | `web`',
          schema: { type: 'string' },
        },
      )
      .addTag('Xác thực')
      .addTag('App · Chấm công')
      .addTag('App · Sinh trắc học')
      .addTag('App · Cá nhân')
      .addTag('App · Thống kê')
      .addTag('Đơn từ')
      .addTag('Thông báo')
      .addTag('Công ty')
      .addTag('Web Quản lý · Chấm công')
      .addTag('Web Quản lý · Nhân sự')
      .addTag('Web Quản lý · Chính sách')
      .addTag('Web Quản lý · Tính công & Lương')
      .addTag('Web Quản lý · Chống gian lận')
      .addTag('Web Quản lý · Dashboard & Báo cáo')
      .addTag('Web Quản lý · Mã mời')
      .addTag('Web Quản lý · Audit log')
      .addTag('Web Admin · Hệ thống')
      .addTag('Hệ thống')
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
    logger.log(`Swagger: http://localhost:${port}/${apiPrefix}/docs`);
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`SmartFace Backend chạy tại http://localhost:${port}/${apiPrefix}`);
  logger.log(`Worker ${config.get<boolean>('worker.enabled') ? 'BẬT' : 'TẮT'} trong process này`);
}

void bootstrap();
