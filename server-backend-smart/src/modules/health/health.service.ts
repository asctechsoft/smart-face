import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/infra/redis/redis.service';
import { HealthRepository } from './health.repository';

export interface HealthReport {
  status: 'healthy' | 'degraded';
  dependencies: { database: boolean; redis: boolean };
  /**
   * `in-memory` nghĩa là đang chạy với `REDIS_ENABLED=false`.
   *
   * Bắt buộc phải lộ ra: nếu chỉ trả `redis: true` thì người trực đọc health
   * tưởng có Redis thật, trong khi rate limit và nonce chống replay chỉ còn
   * hiệu lực trong một tiến trình.
   */
  redisMode: 'redis' | 'in-memory';
  timestamp: string;
}

/** NFR-OBS-05 — kiểm tra cả dependency, không chỉ trả 200 rỗng. */
@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthRepository,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthReport> {
    // `Promise.all` để hai lần kiểm tra chạy song song — probe của K8s có timeout
    // ngắn, cộng dồn tuần tự dễ vượt ngưỡng và pod bị giết oan.
    //
    // `.catch(() => false)` là cố ý: health check KHÔNG được phép tự nó ném lỗi.
    // Ném ra thì endpoint trả 500 và K8s chỉ biết "hỏng gì đó"; nuốt lỗi rồi trả
    // 200 kèm `database: false` thì người trực biết chính xác thành phần nào chết.
    const [database, redis] = await Promise.all([
      this.health
        .ping()
        .then(() => true)
        .catch(() => false),
      this.redis.ping().catch(() => false),
    ]);

    return {
      status: database && redis ? 'healthy' : 'degraded',
      dependencies: { database, redis },
      redisMode: this.redis.mode,
      timestamp: new Date().toISOString(),
    };
  }
}
