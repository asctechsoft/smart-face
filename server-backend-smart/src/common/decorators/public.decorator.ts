import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Bỏ qua JwtAuthGuard cho endpoint này (login, health, webhook…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SKIP_TENANT_KEY = 'skipTenant';

/**
 * Bỏ qua TenantGuard — dùng cho API `/system/*` của quản trị viên nền tảng và
 * vài endpoint tài khoản chạy trước khi ngữ cảnh công ty sẵn sàng.
 */
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);

export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';

/**
 * Cho phép gọi khi tài khoản CHƯA đổi mật khẩu tạm.
 *
 * Mặc định `PasswordChangeGuard` chặn tất cả. Chỉ đánh dấu những endpoint thật
 * sự cần thiết để thoát khỏi trạng thái đó: đổi mật khẩu, xem phiên hiện tại,
 * đăng xuất. Đánh dấu thừa một endpoint là mở lại đúng lỗ hổng mà guard này
 * sinh ra để bịt.
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

export const SIGNATURE_REQUIRED_KEY = 'signatureRequired';

/** AF-12: bắt buộc HMAC + nonce + timestamp cho endpoint nhạy cảm. */
export const RequireSignature = () => SetMetadata(SIGNATURE_REQUIRED_KEY, true);
