import { z } from 'zod';

/**
 * Cấu hình môi trường.
 *
 * ⚠ Bài học đã trả giá: bản đầu của file này `throw` ngay ở tầng module khi
 * thiếu biến. Hệ quả là **trang trắng tinh** — module `env.ts` nằm trong chuỗi
 * import của `App.tsx`, nên nó nổ TRƯỚC khi React kịp mount, và `ErrorBoundary`
 * không bắt được (boundary chỉ bắt lỗi khi render, không bắt lỗi lúc nạp module).
 * Người dùng thấy màn hình trắng, thông báo lỗi duy nhất nằm trong console.
 *
 * Vì vậy nguyên tắc ở đây: **không bao giờ throw ở tầng module.** Thiếu cấu
 * hình thì ghi nhận lại, để tầng giao diện hiển thị một màn hình chẩn đoán đọc
 * được, và để những phần không cần cấu hình đó vẫn chạy bình thường.
 */
const schema = z.object({
  VITE_API_BASE_URL: z.string().default('/v1'),

  // Firebase Authentication giữ danh tính (docs/13). Backend chỉ nhận ID token,
  // KHÔNG bao giờ nhận mật khẩu.
  //
  // Khai `optional()` không có nghĩa là không cần: đăng nhập chắc chắn hỏng nếu
  // thiếu. Nhưng phần lớn ứng dụng — trang trưng bày component, màn hình lỗi,
  // chính màn hình báo thiếu cấu hình — không đụng tới Firebase. Bắt chúng chết
  // theo là biến một lỗi cấu hình thành một sản phẩm không khởi động được.
  VITE_FIREBASE_API_KEY: z.string().optional(),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  VITE_FIREBASE_PROJECT_ID: z.string().optional(),
  VITE_FIREBASE_APP_ID: z.string().optional(),

  /** Múi giờ hiển thị mặc định trước khi biết `company.timezone`. */
  VITE_DEFAULT_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),

  /** Bản đồ ở màn chi tiết chấm công. Bỏ trống → hiện link ra Google Maps. */
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional(),

  VITE_WS_URL: z.string().optional(),
});

/**
 * Lược đồ được thiết kế để **không bao giờ parse hỏng**: mọi trường đều có giá
 * trị mặc định hoặc là tuỳ chọn, và `import.meta.env` chỉ chứa chuỗi. Nhờ vậy
 * `env` luôn là một object dùng được, không cần nhánh dự phòng nào — và cũng
 * không còn chỗ nào để lỡ tay `throw`.
 *
 * Việc kiểm "thiếu hay đủ" chuyển xuống dưới, nơi ta biết biến nào bắt buộc cho
 * chức năng nào.
 */
export const env = schema.parse(import.meta.env);

/** Các biến Firebase bắt buộc để đăng nhập chạy được. */
const REQUIRED_FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
] as const;

// `?.trim()` vì `.env` để `VITE_FIREBASE_API_KEY=` (khai mà bỏ trống) cho ra
// chuỗi rỗng, không phải `undefined` — và chuỗi rỗng cũng vô dụng như thiếu hẳn.
export const missingFirebaseKeys: string[] = REQUIRED_FIREBASE_KEYS.filter(
  (key) => !env[key]?.trim(),
);

/** `false` = màn hình đăng nhập sẽ không hoạt động; mọi thứ khác vẫn chạy. */
export const isFirebaseConfigured = missingFirebaseKeys.length === 0;

export const isDev = import.meta.env.DEV;

// Ghi cảnh báo một lần khi nạp — người thi công nhìn console là biết ngay, mà
// không ai bị chặn khỏi ứng dụng.
if (!isFirebaseConfigured) {
  console.warn(
    `[SmartFace] Thiếu cấu hình Firebase: ${missingFirebaseKeys.join(', ')}.\n` +
      'Đăng nhập sẽ không hoạt động. Sao chép .env.example thành .env rồi điền giá trị.',
  );
}
