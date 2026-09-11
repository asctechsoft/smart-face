import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from 'src/modules/access/permission.constants';

export const PERMISSION_KEY = 'requiredPermissions';

/**
 * Quyền cần có để gọi endpoint (`BR-13`, kiểm #2 trong sáu kiểm bắt buộc).
 *
 * ```ts
 * @RequirePermission('period.approve_lock')
 * ```
 *
 * Nhiều quyền là quan hệ **HOẶC** — có một trong số đó là qua. Cần quan hệ VÀ
 * thì đặt hai decorator riêng ở hai tầng (class + handler) hoặc kiểm trong service.
 *
 * Dùng SONG SONG với `@Roles()` trong giai đoạn chuyển đổi: `RolesGuard` chạy
 * trước và vẫn giữ nguyên hành vi cũ, `PermissionGuard` siết thêm một lớp. Khi
 * mọi controller đã khai `@RequirePermission`, gỡ `@Roles()` đi.
 */
export const RequirePermission = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

export const STEP_UP_KEY = 'requireStepUp';

/**
 * Bắt xác thực lại danh tính trước khi chạy (`BR-18`).
 *
 * Chuỗi thử thách gắn với ĐÚNG hành động ghi ở đây: xác thực để mở lại kỳ công
 * không dùng lại được để gán Owner. Client gọi `POST /v1/auth/step-up` với đúng
 * `action` này, xác thực, rồi gửi lại request kèm header `X-Step-Up-Token`.
 */
export const RequireStepUp = (action: string) => SetMetadata(STEP_UP_KEY, action);

export const NO_SELF_APPROVAL_KEY = 'noSelfApproval';

export interface NoSelfApprovalOptions {
  /** Nơi lấy id đối tượng bị tác động: tham số route hoặc trường trong body. */
  subjectFrom: { param?: string; body?: string };
  /** So sánh với `employeeId` hay `userId` của người gọi. */
  compare?: 'employeeId' | 'userId';
}

/**
 * Chặn tự duyệt / tự tác động lên chính mình (`BR-14`).
 *
 * Trước v2.1 quy tắc này chỉ tồn tại trong `RequestService`; các đường khác —
 * duyệt chốt kỳ, xử lý cờ gian lận, hiệu chỉnh công, gán vai trò, gán Owner —
 * đều không kiểm. Decorator này để quy tắc được áp ở một chỗ thay vì chép lại
 * ở mỗi service và quên mất một cái.
 */
export const NoSelfApproval = (options: NoSelfApprovalOptions) =>
  SetMetadata(NO_SELF_APPROVAL_KEY, options);
