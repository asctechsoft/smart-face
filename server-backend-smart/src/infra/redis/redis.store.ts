import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Tầng lưu trữ khoá–giá trị mà `RedisService` đứng trên.
 *
 * Có hai bản cài đặt: `IoredisStore` nói chuyện với Redis thật, `MemoryStore`
 * giữ dữ liệu trong tiến trình. `RedisService` không biết mình đang dùng bản
 * nào — nhờ vậy cờ `REDIS_ENABLED` không rò rỉ thành hàng loạt câu `if` rải
 * khắp các phương thức nghiệp vụ.
 *
 * Interface cố tình mô tả Ý ĐỊNH (`setNx`, `keysWithPrefix`) chứ không phải lệnh
 * Redis thô. Nếu để lộ `scan(cursor, 'MATCH', ...)` thì `MemoryStore` phải giả
 * lập cả con trỏ SCAN — công vô ích cho một `Map`.
 */
export interface RedisStore {
  /** Nhãn để log và health check nói đúng sự thật đang chạy bằng gì. */
  readonly mode: 'redis' | 'in-memory';

  /** SET NX EX — trả `true` nếu khoá chưa tồn tại và lần này chiếm được. */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;

  /** Không truyền `ttlSeconds` thì khoá sống vĩnh viễn (giống SET của Redis). */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  get(key: string): Promise<string | null>;

  /** Khoá chưa có thì coi như 0 rồi tăng. KHÔNG đụng tới TTL đang có. */
  incr(key: string): Promise<number>;

  expire(key: string, ttlSeconds: number): Promise<void>;

  /** Theo đúng quy ước Redis: `-2` khoá không tồn tại, `-1` tồn tại nhưng không hạn. */
  ttl(key: string): Promise<number>;

  del(keys: string[]): Promise<void>;

  keysWithPrefix(prefix: string): Promise<string[]>;

  ping(): Promise<boolean>;

  connect(): Promise<void>;

  close(): Promise<void>;
}

// =============================================================================
//  Bản thật — Redis qua ioredis
// =============================================================================

export interface IoredisStoreOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export class IoredisStore implements RedisStore {
  readonly mode = 'redis' as const;

  private readonly logger = new Logger(IoredisStore.name);
  private readonly client: Redis;

  constructor(options: IoredisStoreOptions) {
    this.client = new Redis({
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    // ioredis in thẳng ra stderr dòng "Unhandled error event" cho MỖI lần thử
    // kết nối hỏng khi không có listener nào. Redis chết là log ngập vài chục
    // dòng mỗi giây, che mất mọi thứ khác. Gắn listener để tự quyết định mức ồn.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Lỗi kết nối Redis: ${error.message}`);
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async del(keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  /** Dùng SCAN chứ không dùng KEYS — KEYS chặn event loop của Redis. */
  async keysWithPrefix(prefix: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      found.push(...keys);
    } while (cursor !== '0');
    return found;
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }
}

// =============================================================================
//  Bản thay thế — bộ nhớ trong tiến trình (REDIS_ENABLED=false)
// =============================================================================

interface MemoryEntry {
  value: string;
  /** `null` = không hết hạn. */
  expiresAt: number | null;
}

/**
 * Bản thay thế Redis bằng một `Map` — CHỈ dùng cho máy lập trình viên.
 *
 * ## Những gì mất đi, cần biết trước khi bật
 *
 * | Chức năng | Với Redis | Với bộ nhớ trong |
 * |---|---|---|
 * | Rate limit (AF-13) | chung cho mọi pod | riêng từng tiến trình, restart là mất |
 * | Nonce chống replay (AF-12) | dùng lại là chặn được | chỉ chặn trong cùng tiến trình |
 * | Khoá gửi lại OTP | chung | riêng |
 * | Cache dashboard | chung | riêng, mỗi pod tự tính lại |
 *
 * Chạy nhiều pod với chế độ này thì chốt chống lạm dụng gần như không còn:
 * kẻ tấn công chỉ cần rải request cho trúng pod khác là bộ đếm về 0. Đó là lý do
 * `env.validation.ts` cho chết ngay khi production đặt `REDIS_ENABLED=false`.
 */
export class MemoryStore implements RedisStore {
  readonly mode = 'in-memory' as const;

  private readonly entries = new Map<string, MemoryEntry>();
  private sweeper?: NodeJS.Timeout;

  async connect(): Promise<void> {
    // Quét định kỳ để khoá đã hết hạn không tích lại mãi. Đọc/ghi đã tự bỏ qua
    // khoá quá hạn rồi, nhưng khoá KHÔNG ai chạm tới nữa (bộ đếm rate limit của
    // một IP ghé một lần) thì nằm lại vĩnh viễn — tiến trình chạy vài ngày là phình.
    //
    // `.unref()` là bắt buộc: thiếu nó, timer giữ event loop sống và tiến trình
    // Node/Jest không bao giờ thoát.
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
    return Promise.resolve();
  }

  async close(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.entries.clear();
    return Promise.resolve();
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.read(key) !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
    return Promise.resolve();
  }

  async get(key: string): Promise<string | null> {
    return Promise.resolve(this.read(key));
  }

  async incr(key: string): Promise<number> {
    const current = this.read(key);
    const next = Number.parseInt(current ?? '0', 10) + 1;
    // Giữ nguyên hạn cũ — giống INCR của Redis, và `incrementWithTtl` dựa vào
    // đúng điểm này: nó chỉ đặt TTL ở lần tăng đầu tiên.
    const existing = this.entries.get(key);
    this.entries.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null });
    return Promise.resolve(next);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.entries.get(key);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return Promise.resolve();
  }

  async ttl(key: string): Promise<number> {
    if (this.read(key) === null) return Promise.resolve(-2);
    const { expiresAt } = this.entries.get(key) as MemoryEntry;
    if (expiresAt === null) return Promise.resolve(-1);
    return Promise.resolve(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
  }

  async del(keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
    return Promise.resolve();
  }

  async keysWithPrefix(prefix: string): Promise<string[]> {
    const found: string[] = [];
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix) && this.read(key) !== null) found.push(key);
    }
    return Promise.resolve(found);
  }

  async ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Đọc kèm dọn khoá quá hạn — mọi phương thức khác phải đi qua đây. */
  private read(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
