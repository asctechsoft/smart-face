import { validateEnv } from './env.validation';

/**
 * Chốt chặn cấu hình lúc khởi động.
 *
 * Mọi mục ở đây đều là thứ "chạy vẫn được nhưng mất một lớp phòng thủ" — đúng
 * loại lỗi không ai phát hiện ra cho tới khi có sự cố. Chết lúc khởi động thì
 * không ai bỏ qua được; cảnh báo trong log thì trôi mất trong hàng nghìn dòng.
 */
describe('validateEnv — chốt chặn cấu hình production', () => {
  /** Cấu hình production hợp lệ, rồi phá hỏng đúng MỘT thứ ở mỗi test. */
  function productionEnv(overrides: Record<string, unknown> = {}) {
    return {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_HOST: 'redis',
      AI_SERVER_URL: 'http://ai-server:8000',
      AI_SERVER_INTERNAL_KEY: 'x'.repeat(40),
      S3_BUCKET: 'smartface',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      JWT_ALGORITHM: 'RS256',
      JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
      JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----',
      FIREBASE_PROJECT_ID: 'smartface-prod',
      FIREBASE_CLIENT_EMAIL: 'sa@smartface-prod.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
      ATTENDANCE_SIGNATURE_REQUIRED: 'true',
      TRUSTED_PROXY_HOPS: '1',
      ...overrides,
    };
  }

  it('cấu hình production hợp lệ thì đi qua', () => {
    // Chốt ngược: bảo đảm các test dưới fail vì đúng lý do, không phải vì cấu
    // hình nền đã sai sẵn.
    expect(() => validateEnv(productionEnv())).not.toThrow();
  });

  // ===========================================================================
  //  AF-12 — chữ ký HMAC
  // ===========================================================================

  it('CHẶN khởi động khi ATTENDANCE_SIGNATURE_REQUIRED tắt ở production', () => {
    // Đây là lớp DUY NHẤT chặn được kẻ đã đánh cắp access token: token bị lộ thì
    // kẻ tấn công gửi lại nguyên xi là qua mọi chốt khác, chỉ chữ ký mới cản vì
    // nó cần deviceSecret nằm trong secure enclave.
    expect(() => validateEnv(productionEnv({ ATTENDANCE_SIGNATURE_REQUIRED: 'false' }))).toThrow(
      /AF-12/,
    );
  });

  it('CHẶN khi thiếu hẳn ATTENDANCE_SIGNATURE_REQUIRED', () => {
    const env = productionEnv();
    delete (env as Record<string, unknown>).ATTENDANCE_SIGNATURE_REQUIRED;

    expect(() => validateEnv(env)).toThrow(/AF-12/);
  });

  it('CHO PHÉP tắt chữ ký ở môi trường phát triển', () => {
    // App chưa triển khai ký HMAC thì đội Backend vẫn phải chạy được.
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/db',
        ATTENDANCE_SIGNATURE_REQUIRED: 'false',
      }),
    ).not.toThrow();
  });

  // ===========================================================================
  //  AF-02b — trust proxy
  // ===========================================================================

  describe('TRUSTED_PROXY_HOPS', () => {
    it('CHẶN khởi động khi không khai ở production', () => {
      // Không khai nghĩa là một trong hai: thật sự không có proxy (phải khai 0
      // một cách CÓ Ý THỨC), hoặc có proxy nhưng quên khai — và khi đó
      // `request.ip` là IP của Nginx, chốt IP văn phòng hoặc chặn sạch mọi
      // người hoặc cho qua tất cả.
      const env = productionEnv();
      delete (env as Record<string, unknown>).TRUSTED_PROXY_HOPS;

      expect(() => validateEnv(env)).toThrow(/TRUSTED_PROXY_HOPS/);
    });

    it('CHẶN khi khai chuỗi rỗng', () => {
      expect(() => validateEnv(productionEnv({ TRUSTED_PROXY_HOPS: '' }))).toThrow(
        /TRUSTED_PROXY_HOPS/,
      );
    });

    it('CHO PHÉP khai 0 một cách tường minh — chạy thẳng không proxy', () => {
      expect(() => validateEnv(productionEnv({ TRUSTED_PROXY_HOPS: '0' }))).not.toThrow();
    });

    it.each(['-1', '99', 'abc', '1.5'])('CHẶN giá trị không hợp lệ: %s', (value) => {
      expect(() => validateEnv(productionEnv({ TRUSTED_PROXY_HOPS: value }))).toThrow(
        /TRUSTED_PROXY_HOPS/,
      );
    });

    it('KHÔNG bắt buộc ở môi trường phát triển', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          DATABASE_URL: 'postgresql://localhost:5432/db',
        }),
      ).not.toThrow();
    });
  });

  // ===========================================================================
  //  NFR-SEC-03 — thuật toán ký JWT
  // ===========================================================================

  it('CHẶN HS256 ở production', () => {
    expect(() => validateEnv(productionEnv({ JWT_ALGORITHM: 'HS256' }))).toThrow(/NFR-SEC-03/);
  });

  it('CHẶN khi thiếu cặp khoá dù khai RS256', () => {
    const env = productionEnv();
    delete (env as Record<string, unknown>).JWT_PRIVATE_KEY;

    expect(() => validateEnv(env)).toThrow(/NFR-SEC-03/);
  });

  // ===========================================================================
  //  Các chốt còn lại
  // ===========================================================================

  it('CHẶN khi bật trả OTP ra API ở production', () => {
    expect(() => validateEnv(productionEnv({ OTP_DEBUG_RETURN: 'true' }))).toThrow(/OTP/);
  });

  it('CHẶN khi trỏ vào Firebase Auth Emulator ở production', () => {
    // Emulator KHÔNG kiểm chữ ký ID token: nó nhận token do bất kỳ ai tự dựng.
    // Trỏ vào đó ở production nghĩa là ai cũng đăng nhập được dưới danh nghĩa
    // bất kỳ tài khoản nào.
    expect(() =>
      validateEnv(productionEnv({ FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' })),
    ).toThrow(/EMULATOR/);
  });

  it.each([
    'REDIS_HOST',
    'AI_SERVER_URL',
    'AI_SERVER_INTERNAL_KEY',
    'S3_BUCKET',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ])('CHẶN khi thiếu %s ở production', (key) => {
    const env = productionEnv();
    delete (env as Record<string, unknown>)[key];

    expect(() => validateEnv(env)).toThrow(new RegExp(key));
  });

  it('CHẶN khi thiếu DATABASE_URL ở mọi môi trường', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
  });
});
