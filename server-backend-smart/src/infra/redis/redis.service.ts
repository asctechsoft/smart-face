import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis — OTP, nonce chống replay, rate limit, cache dashboard.
 * NFR-SCALE-03: Backend stateless, mọi state phiên nằm ở đây.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('redis.host'),
      port: this.config.get<number>('redis.port'),
      password: this.config.get<string>('redis.password'),
      db: this.config.get<number>('redis.db'),
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Đã kết nối Redis');
    } catch (error) {
      this.logger.error(`Không kết nối được Redis: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Khoá dùng một lần (nonce) — AF-12
  // ---------------------------------------------------------------------------

  /**
   * Chiếm nonce. Trả `true` nếu đây là lần đầu, `false` nếu đã dùng (replay).
   * Dùng SET NX EX — nguyên tử, an toàn khi nhiều pod chạy song song.
   */
  async consumeOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  // ---------------------------------------------------------------------------
  // Đếm có TTL — rate limit (AF-13), số lần nhập sai OTP
  // ---------------------------------------------------------------------------

  /** Tăng bộ đếm và đặt TTL ở lần tăng đầu tiên. Trả về giá trị sau khi tăng. */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // ---------------------------------------------------------------------------
  // JSON tiện dụng — OTP payload, phiên đăng ký khuôn mặt, cache dashboard
  // ---------------------------------------------------------------------------

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, payload);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
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

  /** Xoá cache theo tiền tố — dùng SCAN, không dùng KEYS (chặn event loop của Redis). */
  async invalidatePrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
