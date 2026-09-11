/**
 * Từ vựng quyền và phạm vi dữ liệu — `docs/08` §2.
 *
 * ## Đây CHỈ là trải nghiệm, KHÔNG phải bảo mật
 *
 * Ẩn một nút không chặn được ai gọi thẳng API. Backend kiểm lại toàn bộ bằng
 * `PermissionGuard` + `ScopeGuard`; những gì ở đây chỉ để người dùng không nhìn
 * thấy các nút mà bấm vào sẽ nhận `RBAC_PERMISSION_DENIED`.
 *
 * ## Vì sao không còn ma trận tĩnh
 *
 * Bản trước giữ một bảng `Record<Permission, SystemRole[]>` ngay trong web:
 * 29 quyền × 5 vai trò, chép tay từ tài liệu. Ba vấn đề, cả ba đều đã xảy ra:
 *
 *  1. **Nó lệch với Backend.** Bảng cũ cấp `shift.assign` và `request.configure`
 *     cho Kế toán/HR, trong khi `docs/05` §1 nói rõ hai quyền đó thuộc về Giám
 *     đốc. Người dùng thấy nút, bấm, và nhận 403 — cách tệ nhất để biết mình
 *     không có quyền.
 *  2. **Nó không diễn đạt được phạm vi.** Mô hình v2.1 là Role × Permission ×
 *     **Scope**: cùng quyền `attendance.view`, một người thấy cả công ty, một
 *     người chỉ thấy phòng mình. Bảng vai trò không nói được điều đó.
 *  3. **Nó không diễn đạt được thời hạn.** Quyền có `validFrom`/`validTo` (uỷ
 *     quyền khi đi vắng) thì một bảng tĩnh không bao giờ biết.
 *
 * Bây giờ danh sách quyền do `GET /v1/access/me` trả về. Web không suy diễn gì
 * từ vai trò nữa — nó hỏi.
 */

/** Sáu mức phạm vi dữ liệu, từ hẹp tới rộng (`docs/08` §2). */
export const SCOPE_LEVELS = [
  'SELF',
  'TEAM',
  'DEPARTMENT',
  'BRANCH',
  'COMPANY',
  'PLATFORM',
] as const;

export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/** Thứ hạng để so "rộng hơn hay hẹp hơn". Không dùng thứ tự mảng để tránh lệ thuộc vị trí. */
export const SCOPE_RANK: Record<ScopeLevel, number> = {
  SELF: 0,
  TEAM: 1,
  DEPARTMENT: 2,
  BRANCH: 3,
  COMPANY: 4,
  PLATFORM: 5,
};

/**
 * Một quyền kèm phạm vi, đúng như Backend trả về.
 *
 * `scopeIds` là id chi nhánh hay phòng ban tuỳ theo `scope`, và RỖNG khi phạm vi
 * từ `COMPANY` trở lên — không phải "không có phạm vi nào" mà là "không cần
 * liệt kê vì đã bao trọn".
 */
export interface PermissionGrant {
  code: string;
  scope: ScopeLevel | null;
  scopeIds: string[];
}

export interface EffectiveAccess {
  roles: string[];
  legacyRoles: string[];
  permissions: PermissionGrant[];
  /** Lượt gán sắp hết hạn gần nhất — cảnh báo trước khi quyền tự mất. */
  nextExpiryAt: string | null;
}

/**
 * Từ vựng quyền, chép từ `permission.constants.ts` của Backend.
 *
 * Chỉ để TypeScript bắt lỗi gõ sai tên quyền — `Can do="attendnace.view"` là
 * lỗi im lặng nếu kiểu là `string`. Danh sách này KHÔNG quyết định ai có quyền
 * gì; nếu nó thiếu một mã mà Backend có, quyền đó vẫn hoạt động, chỉ là mất
 * gợi ý của trình soạn thảo.
 */
export type Permission =
  // Nhân sự
  | 'employee.view'
  | 'employee.create'
  | 'employee.update'
  | 'employee.terminate'
  | 'employee.import'
  // Chấm công
  | 'attendance.view'
  | 'attendance.adjust'
  | 'attendance.export'
  | 'attendance.review_suspicious'
  | 'attendance.sheet_manage'
  // Bảng công & kỳ công
  | 'timesheet.view'
  | 'timesheet.calculate'
  | 'timesheet.adjust'
  | 'period.submit_lock'
  | 'period.approve_lock'
  | 'period.request_reopen'
  | 'period.approve_reopen'
  // Đơn từ
  | 'request.view'
  | 'request.create_on_behalf'
  | 'request.approve'
  | 'request.configure_flow'
  | 'request.configure_type'
  // Ca & phân ca
  | 'shift_template.view'
  | 'shift_template.update'
  | 'shift.assign'
  // Chính sách & tổ chức
  | 'policy.view'
  | 'policy.update'
  | 'org.view'
  | 'org.update'
  | 'geofence.update'
  // Sinh trắc học & thiết bị
  | 'biometric.reset'
  | 'device.revoke'
  // Báo cáo & thông báo
  | 'report.view'
  | 'report.export'
  | 'notification.send'
  // Phân quyền & Owner
  | 'role.view'
  | 'role.assign'
  | 'role.manage'
  | 'delegation.manage'
  | 'owner.assign'
  // Audit
  | 'audit.view'
  | 'audit.export'
  // Thiết lập khởi tạo
  | 'setup.run'
  // Nền tảng
  | 'tenant.view'
  | 'tenant.manage'
  | 'tenant.billing'
  | 'package.manage'
  | 'platform.ai'
  | 'platform.incident'
  | 'platform.support_access'
  | 'platform.config';

/** Một quyền cụ thể trong danh sách hiệu lực, hoặc `undefined`. */
export function findGrant(
  access: EffectiveAccess | null,
  permission: Permission,
): PermissionGrant | undefined {
  return access?.permissions.find((grant) => grant.code === permission);
}

export function hasPermission(access: EffectiveAccess | null, permission: Permission): boolean {
  return findGrant(access, permission) !== undefined;
}

/**
 * Có quyền VÀ phạm vi đủ rộng.
 *
 * Dùng khi nút thao tác lên một đối tượng cụ thể: người quản lý một phòng ban
 * có `employee.update` nhưng chỉ trên nhân viên phòng mình. Truyền `scopeId`
 * (departmentId hoặc branchId của đối tượng) để không hiện nút trên những dòng
 * họ không đụng được.
 *
 * Backend vẫn kiểm lại — hàm này chỉ để nút không xuất hiện chỗ vô ích.
 */
export function hasScopedPermission(
  access: EffectiveAccess | null,
  permission: Permission,
  scopeId?: string | null,
): boolean {
  const grant = findGrant(access, permission);
  if (!grant) return false;
  if (!grant.scope) return true;

  // Từ COMPANY trở lên là bao trọn, không cần đối chiếu id.
  if (SCOPE_RANK[grant.scope] >= SCOPE_RANK.COMPANY) return true;

  // SELF/TEAM không lọc bằng id phòng ban được — Backend giải theo employeeId.
  // Cho qua ở đây và để Backend quyết, thay vì đoán sai rồi giấu mất nút.
  if (SCOPE_RANK[grant.scope] <= SCOPE_RANK.TEAM) return true;

  if (!scopeId) return grant.scopeIds.length > 0;
  return grant.scopeIds.includes(scopeId);
}

/** Phạm vi rộng nhất trong toàn bộ quyền — dùng để chọn bộ điều hướng. */
export function widestScope(access: EffectiveAccess | null): ScopeLevel | null {
  if (!access || access.permissions.length === 0) return null;
  return access.permissions.reduce<ScopeLevel | null>((widest, grant) => {
    if (!grant.scope) return widest;
    if (!widest || SCOPE_RANK[grant.scope] > SCOPE_RANK[widest]) return grant.scope;
    return widest;
  }, null);
}
