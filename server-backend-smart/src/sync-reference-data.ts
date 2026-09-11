import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { syncReferenceData } from './modules/provisioning/reference-data';

/**
 * Entry point đồng bộ dữ liệu nền (quyền, vai trò hệ thống, gói dịch vụ, model AI).
 *
 * Chạy: `node dist/sync-reference-data`
 *
 * `docker-compose.prod.yml` gọi lệnh này mỗi lần container `api` khởi động,
 * ngay sau `prisma migrate deploy`. Vì vậy người vận hành không phải nhớ chạy
 * tay, và bản deploy có thêm quyền mới luôn có quyền đó trong DB trước khi API
 * nhận request đầu tiên.
 *
 * Dùng PrismaClient trần thay vì dựng AppModule: lệnh này chỉ cần DATABASE_URL,
 * không nên chết theo Redis, Firebase hay AI Server chưa sẵn sàng.
 */
async function main(): Promise<void> {
  const logger = new Logger('ReferenceData');
  const prisma = new PrismaClient();

  try {
    const result = await syncReferenceData(prisma);
    logger.log(
      `Đã đồng bộ ${result.permissions} quyền · ${result.roles} vai trò hệ thống · ` +
        (result.plansWritten > 0 ? `tạo ${result.plansWritten} gói dịch vụ` : 'gói dịch vụ đã có') +
        ' · ' +
        (result.aiModelCreated ? 'tạo bản ghi model AI mặc định' : 'model AI đã có'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  new Logger('ReferenceData').error(
    'Đồng bộ dữ liệu nền thất bại',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
