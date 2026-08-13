/**
 * @deprecated Dùng `Badge` từ `@/components/ui`.
 *
 * File này giữ lại để các màn hình đã viết trước khi có thư viện component vẫn
 * chạy. `StatusBadge` là đúng `Badge` với tên khác — không phải bản sao, nên
 * không có nguy cơ hai component lệch nhau.
 *
 * Xoá file này khi mọi màn hình đã chuyển sang `Badge`.
 */
export {
  Badge as StatusBadge,
  dailyStatusTone,
  employeeStatusTone,
  periodStatusTone,
  requestStatusTone,
  severityTone,
} from './ui/Badge';

export type { BadgeTone } from './ui/Badge';
