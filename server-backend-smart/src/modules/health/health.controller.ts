import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, SkipTenant } from 'src/common/decorators';
import { listErrorDefinitions } from 'src/common/errors';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedisService } from 'src/infra/redis/redis.service';

/**
 * Ba endpoint hạ tầng, đều `@Public()` — không cần token.
 *
 * - `/health`            — readiness probe của K8s, phải gọi được trước khi có ai đăng nhập.
 * - `/v1/time`           — App lấy giờ chuẩn để đối chiếu (BR-01, AF-18).
 * - `/v1/meta/error-codes` — bảng mã lỗi, client tải về lúc khởi động.
 *
 * `/health` nằm NGOÀI tiền tố `/v1` (khai ở `exclude` trong main.ts) để probe của
 * K8s không phải đổi đường dẫn mỗi khi nâng phiên bản API.
 */
@ApiTags('Hệ thống')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @Public()
  @SkipTenant()
  @ApiOperation({
    summary: 'Health check (NFR-OBS-05)',
    description: 'Kiểm tra cả dependency, không chỉ trả 200 rỗng. Dùng cho readiness probe của K8s.',
  })
  async health() {
    // `Promise.all` để hai lần kiểm tra chạy song song — probe của K8s có timeout
    // ngắn, cộng dồn tuần tự dễ vượt ngưỡng và pod bị giết oan.
    //
    // `.catch(() => false)` là cố ý: health check KHÔNG được phép tự nó ném lỗi.
    // Ném ra thì endpoint trả 500 và K8s chỉ biết "hỏng gì đó"; nuốt lỗi rồi trả
    // 200 kèm `database: false` thì người trực biết chính xác thành phần nào chết.
    const [database, redis] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false),
      this.redis.ping(),
    ]);

    return {
      status: database && redis ? 'healthy' : 'degraded',
      dependencies: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('time')
  @Public()
  @SkipTenant()
  @ApiOperation({
    summary: 'Giờ server',
    description:
      'BR-01/AF-17: App lấy giờ hiển thị từ đây, KHÔNG dùng DateTime.now() của máy cho mọi thứ liên quan tới chấm công.',
  })
  time() {
    return { serverTime: new Date().toISOString(), epochSeconds: Math.floor(Date.now() / 1000) };
  }

  @Get('meta/error-codes')
  @Public()
  @SkipTenant()
  @ApiOperation({
    summary: 'Bảng mã lỗi tập trung',
    description:
      'NGUỒN DUY NHẤT cho App và Web. Client import bảng này rồi ánh xạ sang i18n của mình — không hard-code chuỗi tiếng Việt rải rác trong Flutter/React (docs/03 mục 3.3).',
  })
  errorCodes() {
    return listErrorDefinitions();
  }
}
