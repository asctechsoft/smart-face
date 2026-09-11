import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Entry point cho pod WORKER thuần (không phục vụ HTTP).
 *
 * docs/02 mục 12.2 — tách workload:
 *   node pool CPU: backend-core (HPA theo CPU/RPS) + worker (HPA theo độ dài queue)
 *
 * Chạy: `WORKER_ENABLED=true node dist/worker`
 * Pod API tương ứng đặt `WORKER_ENABLED=false` để chỉ đẩy job, không xử lý.
 */
async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('Worker');

  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  // BẮT BUỘC khi dùng `bufferLogs`. `NestApplication` (pod API) tự xả bộ đệm log
  // lúc `listen()`, còn application context thì CHỈ xả khi gọi `useLogger()` — mà
  // ở đây không ai gọi. Thiếu dòng này thì worker không in ra một dòng log nào
  // suốt vòng đời, kể cả lỗi của job tính công ban đêm.
  app.flushLogs();
  app.enableShutdownHooks();

  logger.log('SmartFace Worker đã khởi động — đang lắng nghe hàng đợi BullMQ');

  const shutdown = async (signal: string) => {
    logger.log(`Nhận tín hiệu ${signal} — đang dừng worker...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrapWorker();
