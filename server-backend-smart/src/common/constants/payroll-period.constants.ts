import { PayrollPeriodStatus } from '@prisma/client';

/**
 * Trạng thái kỳ công mà dữ liệu trong kỳ KHÔNG được sửa nữa (BR-07).
 *
 * Gồm hai trạng thái, không phải một:
 *
 * - `LOCKED` — kỳ đã được Giám đốc duyệt chốt. Hiển nhiên bất biến.
 * - `PENDING_APPROVAL` — Kế toán đã gửi đề nghị chốt và Giám đốc đang xem xét.
 *   Nếu cho sửa ở trạng thái này thì Giám đốc duyệt một bộ số, còn bộ số thực
 *   sự được chốt lại là bộ khác — đúng loại lỗi mà cả state machine sinh ra để
 *   ngăn.
 *
 * `REOPENED` KHÔNG nằm trong danh sách: mở lại kỳ chính là để sửa. `CALCULATING`
 * cũng không — nó chặn recalculate đồng thời, không chặn nghiệp vụ.
 *
 * Hằng số này tồn tại vì cùng một phép kiểm đang nằm rải ở sáu repository
 * (chấm công, bảng chấm công, chính sách, đơn từ, payroll, job). Trước đây mỗi
 * chỗ tự viết `status: 'CLOSED'`; thêm một trạng thái vào enum là sáu chỗ lệch
 * nhau âm thầm.
 *
 * @see docs/13 §5.4 · docs/05 §13.1
 */
export const PERIOD_LOCKED_STATUSES: readonly PayrollPeriodStatus[] = [
  PayrollPeriodStatus.PENDING_APPROVAL,
  PayrollPeriodStatus.LOCKED,
] as const;

/**
 * Dạng dùng trực tiếp trong `where` của Prisma.
 *
 * Là hàm chứ không phải hằng số vì Prisma khai báo `in` là mảng **mutable**;
 * chia sẻ một mảng dùng chung giữa mọi truy vấn là mời gọi lỗi sửa-từ-xa. Mỗi
 * lần gọi trả về một mảng riêng.
 */
export function periodLockedFilter(): { in: PayrollPeriodStatus[] } {
  return { in: [...PERIOD_LOCKED_STATUSES] };
}
