import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoredisStore, MemoryStore, RedisStore } from './redis.store';

/**
 * Redis — OTP, nonce chống replay, rate limit, cache dashboard.
 * NFR-SCALE-03: Backend stateless, mọi state phiên nằm ở đây.
 *
 * `REDIS_ENABLED=false` thay tầng lưu trữ bằng `MemoryStore` để chạy được trên
 * máy chưa dựng Redis. Mọi phương thức dưới đây giữ nguyên hành vi, nên KHÔNG
 * service nào cần biết cờ đó tồn tại — đọc `redis.store.ts` để thấy chính xác
 * những gì mất đi khi tắt.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly store: RedisStore;

  constructor(private readonly config: ConfigService) {
    this.store = this.config.get<boolean>('redis.enabled', true)
      ? new IoredisStore({
          host: this.config.get<string>('redis.host', 'localhost'),
          port: this.config.get<number>('redis.port', 6379),
          password: this.config.get<string>('redis.password'),
          db: this.config.get<number>('redis.db', 0),
        })
      : new MemoryStore();
  }

  /** `'redis'` hoặc `'in-memory'` — dùng cho health check và log khởi động. */
  get mode(): RedisStore['mode'] {
    return this.store.mode;
  }

  async onModuleInit(): Promise<void> {
    if (this.store.mode === 'in-memory') {
      await this.store.connect();
      this.logger.warn(
        'REDIS_ENABLED=false — dùng bộ nhớ trong tiến trình thay Redis. ' +
          'Rate limit và nonce chống replay chỉ còn hiệu lực trong MỘT tiến trình, ' +
          'mất sạch khi khởi động lại. Chỉ dùng ở môi trường phát triển.',
      );
      return;
    }

    try {
      await this.store.connect();
      this.logger.log('Đã kết nối Redis');
    } catch (error) {
      this.logger.error(`Không kết nối được Redis: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }

  // ---------------------------------------------------------------------------
  // Khoá dùng một lần (nonce) — AF-12
  // ---------------------------------------------------------------------------

  /**
   * Chiếm nonce. Trả `true` nếu đây là lần đầu, `false` nếu đã dùng (replay).
   * Dùng SET NX EX — nguyên tử, an toàn khi nhiều pod chạy song song.
   */
  async consumeOnce(key: string, ttlSeconds: number): Promise<boolean> {
    return this.store.setNx(key, '1', ttlSeconds);
  }

  // ---------------------------------------------------------------------------
  // Đếm có TTL — rate limit (AF-13), số lần nhập sai OTP
  // ---------------------------------------------------------------------------

  /** Tăng bộ đếm và đặt TTL ở lần tăng đầu tiên. Trả về giá trị sau khi tăng. */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.store.incr(key);
    if (count === 1) {
      await this.store.expire(key, ttlSeconds);
    }
    return count;
  }

  async ttl(key: string): Promise<number> {
    return this.store.ttl(key);
  }

  // ---------------------------------------------------------------------------
  // JSON tiện dụng — OTP payload, phiên đăng ký khuôn mặt, cache dashboard
  // ---------------------------------------------------------------------------

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.store.set(key, JSON.stringify(value), ttlSeconds);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.store.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async del(...keys: string[]): Promise<void> {
    await this.store.del(keys);
  }

  /**
   * Cache-aside cho dashboard (docs/04 mục 2.2 — bắt buộc cache, TTL 1–5 phút).
   * Lỗi Redis KHÔNG được làm hỏng request nghiệp vụ → fallback gọi thẳng factory.
   */
  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.getJson<T>(key);
      if (cached !== null) return cached;
    } catch (error) {
      this.logger.warn(`Đọc cache thất bại (${key}): ${(error as Error).message}`);
    }

    const value = await factory();

    try {
      await this.setJson(key, value, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Ghi cache thất bại (${key}): ${(error as Error).message}`);
    }
    return value;
  }

  /** Xoá cache theo tiền tố. */
  async invalidatePrefix(prefix: string): Promise<void> {
    const keys = await this.store.keysWithPrefix(prefix);
    await this.store.del(keys);
  }

  async ping(): Promise<boolean> {
    try {
      return await this.store.ping();
    } catch {
      return false;
    }
  }
}
