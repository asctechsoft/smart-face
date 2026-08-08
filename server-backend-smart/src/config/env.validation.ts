import { Logger } from '@nestjs/common';

const logger = new Logger('EnvValidation');

/** Biến bắt buộc phải có ở MỌI môi trường. */
const REQUIRED = ['DATABASE_URL'];

/** Biến bắt buộc bổ sung khi NODE_ENV=production. */
const REQUIRED_IN_PRODUCTION = [
  'REDIS_HOST',
  'AI_SERVER_URL',
  'AI_SERVER_INTERNAL_KEY',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
];

/**
 * Kiểm tra biến môi trường lúc khởi động — fail fast thay vì chết giữa chừng.
 * Nhấn mạnh các cấu hình bảo mật dễ bị quên khi lên production.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const env = (config.NODE_ENV as string) ?? 'development';
  const isProduction = env === 'production';

  const missing = REQUIRED.filter((key) => !config[key]);
  if (isProduction) {
    missing.push(...REQUIRED_IN_PRODUCTION.filter((key) => !config[key]));
  }

  if (missing.length > 0) {
    throw new Error(
      `Thiếu biến môi trường bắt buộc: ${missing.join(', ')}. Xem .env.example để biết chi tiết.`,
    );
  }

  if (isProduction) {
    // NFR-SEC-03: production không được dùng HS256 với secret dùng chung.
    const algorithm = (config.JWT_ALGORITHM as string) ?? 'RS256';
    const hasKeyPair = Boolean(config.JWT_PRIVATE_KEY) && Boolean(config.JWT_PUBLIC_KEY);
    if (algorithm === 'HS256' || !hasKeyPair) {
      throw new Error(
        'NFR-SEC-03: production phải dùng RS256/ES256 với JWT_PRIVATE_KEY + JWT_PUBLIC_KEY, không dùng HS256.',
      );
    }

    if (config.OTP_DEBUG_RETURN && String(config.OTP_DEBUG_RETURN).toLowerCase() === 'true') {
      throw new Error('OTP_DEBUG_RETURN phải TẮT ở production — nếu bật sẽ lộ mã OTP qua API.');
    }

    // AF-12 — chữ ký HMAC là lớp DUY NHẤT chặn được kẻ đã đánh cắp access token.
    //
    // Token bị lộ thì kẻ tấn công gửi lại nguyên xi là qua được mọi chốt khác:
    // JWT hợp lệ, X-Device-Id đọc được từ chính token. Chỉ chữ ký mới cản, vì
    // nó cần `deviceSecret` — thứ nằm trong secure enclave và KHÔNG đi kèm token.
    //
    // Trước đây chỗ này chỉ `logger.warn`. Cảnh báo lúc khởi động trôi qua trong
    // hàng nghìn dòng log và không ai đọc; hệ thống vẫn chạy với lớp phòng thủ
    // quan trọng nhất đang tắt. Chết lúc khởi động thì không ai bỏ qua được.
    // AF-02b — `trust proxy` quyết định `request.ip` là địa chỉ nào, và chốt
    // "chỉ chấm công từ mạng văn phòng" phụ thuộc hoàn toàn vào nó.
    //
    // Không khai ở production nghĩa là một trong hai:
    //   - Thật sự không có proxy nào → phải khai `0` một cách CÓ Ý THỨC.
    //   - Có proxy nhưng quên khai → `request.ip` là IP của proxy, và chốt IP
    //     hoặc chặn sạch mọi người, hoặc cho qua tất cả tuỳ IP proxy có nằm
    //     trong dải văn phòng hay không.
    //
    // Bắt khai tường minh để trường hợp thứ hai không xảy ra do quên.
    if (config.TRUSTED_PROXY_HOPS === undefined || config.TRUSTED_PROXY_HOPS === '') {
      throw new Error(
        'AF-02b: TRUSTED_PROXY_HOPS bắt buộc phải khai ở production. Đây là số proxy ' +
          '(Nginx/Kong/ALB/Cloudflare) đứng TRƯỚC Backend. Chạy thẳng không proxy thì khai 0. ' +
          'Khai thiếu thì cả công ty không chấm công được; khai thừa thì ai cũng giả mạo được IP văn phòng.',
      );
    }

    const hops = Number(config.TRUSTED_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
      throw new Error(
        `AF-02b: TRUSTED_PROXY_HOPS phải là số nguyên 0–5, đang là "${config.TRUSTED_PROXY_HOPS}".`,
      );
    }

    if (String(config.ATTENDANCE_SIGNATURE_REQUIRED ?? '').toLowerCase() !== 'true') {
      throw new Error(
        'AF-12: ATTENDANCE_SIGNATURE_REQUIRED phải BẬT ở production. Đang tắt nghĩa là ' +
          'ai lấy được access token đều chấm công thay người khác được. ' +
          'Chỉ tắt được ở môi trường phát triển, khi App chưa triển khai ký HMAC.',
      );
    }
  } else {
    const hasKeyPair = Boolean(config.JWT_PRIVATE_KEY) && Boolean(config.JWT_PUBLIC_KEY);
    if (!hasKeyPair) {
      logger.warn(
        'Chưa cấu hình cặp khoá JWT — đang dùng HS256 với JWT_SECRET. Chỉ chấp nhận ở môi trường local/dev.',
      );
    }
  }

  return config;
}
