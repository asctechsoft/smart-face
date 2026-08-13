/**
 * Cấu hình tập trung, đọc từ biến môi trường (NFR-MAINT-05).
 * Không hard-code URL / secret / ngưỡng ở bất kỳ đâu khác.
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * REDIS_ENABLED — ngoại lệ DUY NHẤT được đọc `process.env` ngoài `configuration()`.
 *
 * Lý do: cờ này quyết định QueueModule/WorkerModule có đăng ký BullMQ hay không,
 * mà danh sách provider của một module được dựng lúc nạp file, tức là TRƯỚC khi
 * Nest tạo DI container và `ConfigService` tồn tại. Không có cách nào hỏi
 * `ConfigService` ở thời điểm đó.
 *
 * ⚠ Ràng buộc thứ tự import: hàm này chỉ đọc được giá trị trong `.env` sau khi
 * `AppConfigModule` đã nạp (chính nó gọi `ConfigModule.forRoot` → dotenv). Vì vậy
 * `app.module.ts` và `worker.ts` PHẢI import `AppConfigModule` trước
 * `QueueModule`/`WorkerModule`. Đảo thứ tự thì cờ luôn nhận giá trị mặc định
 * `true` và ứng dụng lại đi tìm Redis — hỏng âm thầm, không lỗi biên dịch.
 *
 * Mọi nơi khác trong code phải đọc qua `config.get('redis.enabled')`.
 */
export function isRedisEnabled(): boolean {
  return bool(process.env.REDIS_ENABLED, true);
}

/**
 * WORKER_ENABLED — cùng lý do và cùng ràng buộc thứ tự import như
 * {@link isRedisEnabled}: nó quyết định `WorkerModule` có đăng ký processor hay
 * không, mà việc đó xảy ra lúc nạp file.
 */
export function isWorkerEnabled(): boolean {
  return bool(process.env.WORKER_ENABLED, true);
}

export const configuration = () => ({
  app: {
    name: process.env.APP_NAME ?? 'SmartFace',
    env: process.env.NODE_ENV ?? 'development',
    port: int(process.env.PORT, 3000),
    apiPrefix: process.env.API_PREFIX ?? 'v1',
    corsOrigins: list(process.env.CORS_ORIGINS),
    swaggerEnabled: bool(process.env.SWAGGER_ENABLED, true),
    isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
    /**
     * Tên miền quy ước cho quản trị viên nền tảng.
     *
     * Họ không thuộc công ty nào nên không có tên miền thật để gõ ở màn hình
     * đăng nhập. Đặt được qua biến môi trường để không trùng với tên miền của
     * một khách hàng thật — trùng thì khách hàng đó không đăng nhập được.
     */
    systemAdminDomain: process.env.SYSTEM_ADMIN_DOMAIN ?? 'system',
  },

  security: {
    /**
     * AF-02b — số proxy đứng TRƯỚC Backend (Nginx, Kong, ALB, Cloudflare…).
     *
     * Quyết định `request.ip` là địa chỉ nào, và chốt "chỉ chấm công từ mạng
     * văn phòng" phụ thuộc hoàn toàn vào con số này.
     *
     * | Triển khai | Giá trị |
     * |---|---|
     * | Chạy thẳng, không proxy | `0` |
     * | Sau một Nginx | `1` |
     * | Sau Cloudflare → Nginx | `2` |
     *
     * ⚠ Khai THIẾU → `request.ip` là IP của proxy, cả công ty bị chặn.
     * ⚠ Khai THỪA → lấy nhầm mục do client tự thêm vào X-Forwarded-For,
     *   ai cũng giả mạo được IP văn phòng.
     *
     * Đếm sai theo hướng nào cũng hỏng, nên phải đếm đúng số tầng thật sự có
     * trong sơ đồ triển khai — không đoán.
     */
    trustedProxyHops: int(process.env.TRUSTED_PROXY_HOPS, 0),
  },

  database: {
    url: process.env.DATABASE_URL ?? '',
  },

  redis: {
    /**
     * `false` → chạy toàn bộ Backend KHÔNG cần Redis: cache/nonce/rate limit
     * chuyển sang bộ nhớ trong tiến trình, BullMQ không được đăng ký, job nền
     * bị bỏ qua thay vì xếp hàng.
     *
     * CHỈ dành cho máy lập trình viên chưa dựng được Redis. Xem `MemoryStore`
     * để biết chính xác những gì mất đi, và `env.validation.ts` — production
     * đặt `false` sẽ chết ngay lúc khởi động.
     */
    enabled: isRedisEnabled(),
    host: process.env.REDIS_HOST ?? 'localhost',
    port: int(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: int(process.env.REDIS_DB, 0),
  },

  jwt: {
    /** NFR-SEC-03: ưu tiên RS256/ES256; HS256 chỉ dùng cho local. */
    algorithm: (process.env.JWT_ALGORITHM ?? 'RS256') as 'RS256' | 'ES256' | 'HS256',
    privateKey: (process.env.JWT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    publicKey: (process.env.JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
    secret: process.env.JWT_SECRET ?? 'dev-only-change-me',
    accessTtl: int(process.env.JWT_ACCESS_TTL, 900),
    refreshTtl: int(process.env.JWT_REFRESH_TTL, 2_592_000),
    issuer: process.env.JWT_ISSUER ?? 'smartface',
  },

  /**
   * Firebase Authentication — nhà cung cấp danh tính (lớp 1).
   *
   * Firebase giữ email + mật khẩu và tự chống dò mật khẩu; Backend KHÔNG còn
   * lưu `passwordHash`. Xem `FirebaseService` để biết ranh giới trách nhiệm.
   *
   * Khoá riêng đọc từ tệp JSON của service account. Trong env nó nằm trên MỘT
   * dòng với `\n` viết theo kiểu escape, nên phải khôi phục lại xuống dòng thật
   * — giống cách `jwt.privateKey` ở trên đang làm.
   */
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    /**
     * Trỏ SDK về Auth Emulator để dev/test không tạo tài khoản thật.
     * Ví dụ: `localhost:9099`. Bỏ trống = gọi Firebase thật.
     */
    emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '',
    /**
     * Số giây tối đa kể từ lần người dùng thực sự nhập lại mật khẩu, để một
     * Firebase ID token còn được coi là "vừa xác thực".
     *
     * Dùng cho các thao tác nhạy cảm (đổi mật khẩu, tắt 2FA, reauth). Token
     * thường sống 1 giờ; nếu chấp nhận cả token cũ thì "xác thực lại" chỉ còn
     * là hình thức — kẻ cầm máy đang mở sẵn phiên vẫn qua được.
     */
    freshAuthWindowSeconds: int(process.env.FIREBASE_FRESH_AUTH_WINDOW_SECONDS, 300),
  },

  otp: {
    length: int(process.env.OTP_LENGTH, 6),
    ttlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    lockSeconds: int(process.env.OTP_LOCK_SECONDS, 900),
    resendAfterSeconds: int(process.env.OTP_RESEND_AFTER_SECONDS, 60),
    maxSendPerHour: int(process.env.OTP_MAX_SEND_PER_HOUR, 5),
    /** CHỈ dev: trả OTP trong response để test không cần SMS thật. */
    debugReturn: bool(process.env.OTP_DEBUG_RETURN, false),
  },

  attendance: {
    nonceTtlSeconds: int(process.env.ATTENDANCE_NONCE_TTL_SECONDS, 60),
    /** AF-12: bật ở production khi App đã triển khai ký HMAC. */
    signatureRequired: bool(process.env.ATTENDANCE_SIGNATURE_REQUIRED, false),
    clockSkewToleranceSeconds: int(process.env.CLOCK_SKEW_TOLERANCE_SECONDS, 120),
    requestTimestampToleranceSeconds: int(process.env.REQUEST_TIMESTAMP_TOLERANCE_SECONDS, 120),
  },

  ai: {
    baseUrl: process.env.AI_SERVER_URL ?? 'http://localhost:8000',
    internalKey: process.env.AI_SERVER_INTERNAL_KEY ?? '',
    timeoutMs: int(process.env.AI_SERVER_TIMEOUT_MS, 2000),
    circuitFailureThreshold: int(process.env.AI_CIRCUIT_FAILURE_THRESHOLD, 5),
    circuitOpenMs: int(process.env.AI_CIRCUIT_OPEN_MS, 30_000),
  },

  storage: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'ap-southeast-1',
    bucket: process.env.S3_BUCKET ?? 'smartface',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    /** NFR-SEC-12: presigned URL TTL ≤ 5 phút. */
    presignTtlSeconds: Math.min(int(process.env.S3_PRESIGN_TTL_SECONDS, 300), 300),
  },

  sms: {
    provider: process.env.SMS_PROVIDER ?? 'console',
    apiUrl: process.env.SMS_API_URL ?? '',
    apiKey: process.env.SMS_API_KEY ?? '',
    secretKey: process.env.SMS_SECRET_KEY ?? '',
    brandName: process.env.SMS_BRAND_NAME ?? 'SmartFace',
  },

  fcm: {
    serverKey: process.env.FCM_SERVER_KEY ?? '',
  },

  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  },

  worker: {
    enabled: bool(process.env.WORKER_ENABLED, true),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
