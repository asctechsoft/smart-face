import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, SkipTenant } from 'src/common/decorators';
import { listErrorDefinitions } from 'src/common/errors';
import { HealthService } from './health.service';

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
  constructor(private readonly health: HealthService) {}

  @Get('health')
  @Public()
  @SkipTenant()
  @ApiOperation({
    summary: 'Health check (NFR-OBS-05)',
    description:
      'Kiểm tra cả dependency, không chỉ trả 200 rỗng. Dùng cho readiness probe của K8s.',
  })
  checkHealth() {
    return this.health.check();
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
