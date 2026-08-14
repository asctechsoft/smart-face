import { SystemRole } from '@/config/constants';

/**
 * Ma trận phân quyền — docs/04-nghiep-vu-web-quan-ly.md mục 1.
 *
 * ⚠ Đây CHỈ là trải nghiệm người dùng, KHÔNG phải bảo mật (docs/04 mục 12.2).
 * Ẩn một nút không chặn được ai gọi thẳng API. Backend kiểm tra lại toàn bộ
 * bằng `RolesGuard` + `ScopeGuard`; bảng này chỉ để người dùng không nhìn thấy
 * những nút bấm vào sẽ nhận 403.
 *
 * `MANAGER` bị giới hạn HAI CHIỀU: theo vai trò (bảng này) và theo phòng ban
 * được phân công (Backend tự chèn vào query). Phần phạm vi phòng ban không thể
 * và không nên mô phỏng ở client.
 */
export type Permission =
  | 'dashboard.view'
  | 'attendance.view'
  | 'attendance.adjust'
  | 'attendance.export'
  | 'request.view'
  | 'request.approve'
  | 'request.create_on_behalf'
  | 'policy.view'
  | 'policy.edit'
  | 'payroll.view'
  | 'payroll.calculate'
  | 'payroll.close'
  | 'employee.view'
  | 'employee.edit'
  | 'employee.import'
  | 'shift.assign'
  | 'makeup.view'
  | 'makeup.manage'
  | 'request.configure'
  | 'role.manage'
  | 'report.view'
  | 'fraud.view'
  | 'fraud.review'
  | 'notification.send'
  | 'audit.view'
  | 'invite.manage'
  | 'device.revoke'
  | 'biometric.reset';

const { COMPANY_ADMIN, MANAGER, HR_PAYROLL, SYSTEM_ADMIN } = SystemRole;

/** Vai trò nào được phép làm gì. Đọc thẳng từ bảng ở docs/04 mục 1. */
const MATRIX: Record<Permission, SystemRole[]> = {
  'dashboard.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  'attendance.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  // Quản lý KHÔNG được sửa công — chỉ Kế toán/HR và Admin công ty.
  'attendance.adjust': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'attendance.export': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],

  'request.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  'request.approve': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  // MANAGER có mặt ở đây nhưng `ScopeGuard` phía Backend giới hạn họ trong phòng
  // ban mình quản lý — vai trò nói được LÀM GÌ, phạm vi nói được làm TRÊN AI.
  'request.create_on_behalf': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],

  'policy.view': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'policy.edit': [SYSTEM_ADMIN, COMPANY_ADMIN],

  'payroll.view': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'payroll.calculate': [SYSTEM_ADMIN, HR_PAYROLL],
  'payroll.close': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],

  'employee.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  'employee.edit': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'employee.import': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'shift.assign': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],

  // Công làm bù đi thẳng vào bảng công: Quản lý XEM được (cần biết ai trong
  // phòng còn nợ giờ để xếp lịch bù) nhưng không ghi được — cùng ranh giới với
  // `attendance.adjust`.
  'makeup.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  'makeup.manage': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],

  // Duyệt đơn là việc của Quản lý, còn quyết định "đơn trên 3 ngày có cần HR
  // duyệt không" là chính sách công ty — Quản lý không có mặt ở đây.
  'request.configure': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],

  // "Phân quyền nội bộ" ở bảng docs/04 mục 1: chỉ Admin. Kế toán/HR sửa được hồ
  // sơ nhưng không tự trao quyền cho mình.
  'role.manage': [SYSTEM_ADMIN, COMPANY_ADMIN],

  'report.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],

  'fraud.view': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  // Quyết định huỷ/giữ công nghi vấn ảnh hưởng bảng lương → không giao cho Quản lý.
  'fraud.review': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],

  'notification.send': [SYSTEM_ADMIN, COMPANY_ADMIN, MANAGER, HR_PAYROLL],
  'audit.view': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'invite.manage': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'device.revoke': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
  'biometric.reset': [SYSTEM_ADMIN, COMPANY_ADMIN, HR_PAYROLL],
};

export function hasPermission(roles: readonly SystemRole[], permission: Permission): boolean {
  const allowed = MATRIX[permission];
  return roles.some((role) => allowed.includes(role));
}

export function rolesFor(permission: Permission): SystemRole[] {
  return MATRIX[permission];
}
