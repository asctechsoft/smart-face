import { ScopeLevel, SystemRole } from '@prisma/client';

/**
 * Danh mục quyền theo module (docs/08 §2 · docs/05 §15.1).
 *
 * Đây là NGUỒN SỰ THẬT cho bảng `permission`: seed đọc từ đây, `@RequirePermission()`
 * chỉ nhận mã có trong đây, và Web lấy danh sách này để dựng màn phân quyền.
 *
 * ## Vì sao là hằng số trong code chứ không phải dữ liệu thuần trong DB
 *
 * Mã quyền được viết thẳng vào decorator trên controller. Nếu danh mục chỉ sống
 * trong DB thì gõ sai một chữ (`period.approve_lok`) sẽ không ai phát hiện cho
 * đến lúc chạy — và triệu chứng là "không ai có quyền này", tức là một endpoint
 * âm thầm không dùng được. Giữ ở đây thì TypeScript bắt lỗi lúc build.
 *
 * Vai trò tuỳ biến của tenant (`FR-GDW-ROLE-01`) vẫn là dữ liệu trong DB — chỉ
 * TẬP HỢP quyền có thể gán là cố định.
 */

export const PERMISSION_CATALOG = {
  // --- Nhân sự -------------------------------------------------------------
  'employee.view': 'Xem hồ sơ nhân viên',
  'employee.create': 'Tạo hồ sơ nhân viên',
  'employee.update': 'Sửa hồ sơ nhân viên',
  'employee.terminate': 'Cho nghỉ việc / tạm ngưng tài khoản',
  'employee.import': 'Nhập nhân viên hàng loạt',

  // --- Chấm công -----------------------------------------------------------
  'attendance.view': 'Xem dữ liệu chấm công',
  'attendance.adjust': 'Hiệu chỉnh công thủ công',
  'attendance.export': 'Xuất dữ liệu chấm công',
  'attendance.review_suspicious': 'Xử lý lượt chấm công nghi vấn',
  /**
   * Lập và tổ chức BẢNG chấm công — khác hẳn `attendance.adjust`.
   *
   * Lập bảng, thêm/bớt người trong bảng chỉ đổi PHẠM VI rà soát, không đổi một
   * con số công nào. Trưởng phòng phải làm được việc này cho phòng mình, trong
   * khi sửa công vẫn là việc của Kế toán/HR. Gộp hai thứ vào `attendance.adjust`
   * sẽ khoá Trưởng phòng khỏi chính bảng của phòng họ; gộp vào `attendance.view`
   * thì ai xem được cũng lập được bảng.
   */
  'attendance.sheet_manage': 'Lập và tổ chức bảng chấm công',

  // --- Bảng công & kỳ công -------------------------------------------------
  'timesheet.view': 'Xem bảng công tổng hợp',
  'timesheet.calculate': 'Chạy tính công',
  'timesheet.adjust': 'Điều chỉnh bảng công',
  /**
   * Kế toán GỬI đề nghị chốt. Tách khỏi `period.approve_lock` là ranh giới #1
   * của docs/08 §1.1: người tính số không được duyệt số của chính mình.
   */
  'period.submit_lock': 'Gửi đề nghị chốt kỳ công',
  'period.approve_lock': 'Duyệt chốt kỳ công',
  'period.request_reopen': 'Đề nghị mở lại kỳ đã chốt',
  'period.approve_reopen': 'Duyệt mở lại kỳ đã chốt',

  // --- Đơn từ --------------------------------------------------------------
  'request.view': 'Xem đơn từ',
  'request.create_on_behalf': 'Tạo đơn thay người khác',
  'request.approve': 'Duyệt đơn',
  'request.configure_flow': 'Cấu hình luồng duyệt',
  'request.configure_type': 'Cấu hình loại đơn',

  // --- Ca & phân ca --------------------------------------------------------
  'shift_template.view': 'Xem danh mục ca làm việc',
  'shift_template.update': 'Sửa danh mục ca làm việc',
  'shift.assign': 'Phân ca cho nhân viên',

  // --- Chính sách & tổ chức ------------------------------------------------
  'policy.view': 'Xem chính sách công ty',
  'policy.update': 'Sửa chính sách công ty',
  'org.view': 'Xem cơ cấu tổ chức',
  'org.update': 'Sửa chi nhánh / phòng ban / chức vụ',
  'geofence.update': 'Cấu hình văn phòng và geofence',

  // --- Sinh trắc học & thiết bị --------------------------------------------
  'biometric.reset': 'Xoá và cấp lại sinh trắc học',
  'device.revoke': 'Gỡ liên kết thiết bị',

  // --- Báo cáo & thông báo -------------------------------------------------
  'report.view': 'Xem báo cáo',
  'report.export': 'Xuất báo cáo',
  'notification.send': 'Gửi thông báo cho nhân viên',

  // --- Phân quyền & Owner --------------------------------------------------
  'role.view': 'Xem vai trò và phân quyền',
  'role.assign': 'Gán vai trò cho người khác',
  'role.manage': 'Tạo và sửa vai trò tuỳ biến',
  'delegation.manage': 'Uỷ quyền duyệt tạm thời',
  'owner.assign': 'Chỉ định và gỡ Owner công ty',

  // --- Audit ---------------------------------------------------------------
  'audit.view': 'Xem nhật ký kiểm toán',
  'audit.export': 'Xuất nhật ký kiểm toán',

  // --- Thiết lập khởi tạo --------------------------------------------------
  'setup.run': 'Chạy wizard thiết lập ban đầu',

  // --- Nền tảng (PLATFORM) -------------------------------------------------
  'tenant.view': 'Xem danh sách tenant',
  'tenant.manage': 'Tạo / tạm ngưng / chấm dứt tenant',
  'tenant.billing': 'Gán gói dịch vụ và cấu hình giới hạn',
  'package.manage': 'Định nghĩa gói dịch vụ và feature flag',
  'platform.ai': 'Quản lý AI Server và phiên bản mô hình',
  'platform.incident': 'Quản lý sự cố',
  'platform.support_access': 'Mở phiên hỗ trợ truy cập dữ liệu tenant',
  'platform.config': 'Cấu hình toàn hệ thống',
} as const;

export type PermissionCode = keyof typeof PERMISSION_CATALOG;

export const ALL_PERMISSION_CODES = Object.keys(PERMISSION_CATALOG) as PermissionCode[];

/** Module suy ra từ tiền tố của mã — không khai báo hai lần để khỏi lệch nhau. */
export function permissionModule(code: PermissionCode): string {
  return code.split('.')[0];
}

/**
 * Vai trò hệ thống, seed sẵn cho mọi tenant.
 *
 * `OWNER` là vai trò MỚI theo v2.1 (`BR-15`) — trước đây `COMPANY_ADMIN` gánh cả
 * hai nghĩa "quản trị công ty" và "chủ sở hữu", nên không cách nào diễn đạt được
 * quy tắc "không được gỡ Owner cuối cùng".
 */
export const SYSTEM_ROLE_CODES = {
  OWNER: 'OWNER',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  HR_PAYROLL: 'HR_PAYROLL',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;

export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[keyof typeof SYSTEM_ROLE_CODES];

export interface SystemRoleDefinition {
  code: SystemRoleCode;
  name: string;
  description: string;
  defaultScope: ScopeLevel;
  permissions: PermissionCode[];
}

const EMPLOYEE_PERMISSIONS: PermissionCode[] = ['request.view', 'attendance.view'];

/**
 * Quản lý — docs/05 §1, cột "Quản lý".
 *
 * Bị giới hạn HAI CHIỀU: vai trò nói LÀM GÌ, `defaultScope = DEPARTMENT` nói làm
 * TRÊN AI. Mọi quyền dưới đây đều bị `ScopeGuard` thu hẹp về phòng ban được giao.
 *
 * Cố ý VẮNG MẶT: `attendance.adjust` (sửa công là việc của Kế toán),
 * `attendance.review_suspicious` (quyết định huỷ/giữ công của cấp dưới trực tiếp
 * là xung đột lợi ích), `shift.assign` (chỉ có nếu được uỷ quyền tường minh).
 */
const MANAGER_PERMISSIONS: PermissionCode[] = [
  ...EMPLOYEE_PERMISSIONS,
  'employee.view',
  'request.approve',
  'report.view',
  'timesheet.view',
  // Lập bảng rà soát cho phòng mình — không phải sửa công. Xem docblock của quyền.
  'attendance.sheet_manage',
  // docs/05 §1: "Xuất Excel bảng công — Theo scope" và "Gửi thông báo công ty —
  // Theo scope". Cả hai bị cắt về phòng ban ở tầng scope, không phải bị cấm.
  'attendance.export',
  'notification.send',
];

/**
 * Kế toán — bám đúng docs/05 §15.1.
 *
 * Chú ý những thứ **cố ý vắng mặt**: `policy.update`, `shift_template.update`,
 * `shift.assign`, `request.configure_flow`, `role.assign`, `owner.assign`,
 * `period.approve_lock`, `period.approve_reopen`, `tenant.billing`.
 * Bản cũ ở `web-smart` cấp nhầm `shift.assign` và `request.configure` cho Kế toán.
 */
const HR_PAYROLL_PERMISSIONS: PermissionCode[] = [
  'employee.view',
  'employee.create',
  'employee.update',
  'employee.terminate',
  'employee.import',
  'attendance.view',
  'attendance.adjust',
  'attendance.export',
  'attendance.review_suspicious',
  'attendance.sheet_manage',
  'timesheet.view',
  'timesheet.calculate',
  'timesheet.adjust',
  'period.submit_lock',
  'period.request_reopen',
  'request.view',
  'request.create_on_behalf',
  'shift_template.view',
  'org.view',
  'policy.view',
  'report.view',
  'report.export',
  'notification.send',
  'audit.view',
  // docs/05 §1: "Reset sinh trắc học ✓" cho Kế toán. Thu hồi thiết bị đi cùng —
  // §14 liệt kê nó trong nhóm thao tác nguy hiểm của chính vai trò này.
  'biometric.reset',
  'device.revoke',
];

/**
 * Giám đốc / Owner — docs/05 §1, cột "Giám đốc / Owner".
 *
 * ## Vì sao KHÔNG kế thừa trọn gói quyền của Kế toán
 *
 * Hai quyền bị loại bỏ có chủ đích: `period.submit_lock` và
 * `period.request_reopen`. Cho Giám đốc cả hai là phá ranh giới #1 của
 * docs/08 §1.1 — *"Kế toán gửi chốt, Giám đốc duyệt chốt: người tính số không
 * được là người phê duyệt số của chính mình"*. Có cả hai thì một người tự gửi
 * rồi tự duyệt, và cơ chế hai chữ ký chỉ còn là hình thức.
 *
 * Trước đây đoạn này viết `...HR_PAYROLL_PERMISSIONS` thẳng, nên Giám đốc nhận
 * luôn `period.submit_lock` mà không ai để ý — bảng ma trận trong tài liệu ghi ✗
 * còn code thì ghi ✓.
 */
const PERIOD_SUBMITTER_ONLY: PermissionCode[] = ['period.submit_lock', 'period.request_reopen'];

const COMPANY_ADMIN_PERMISSIONS: PermissionCode[] = [
  ...HR_PAYROLL_PERMISSIONS.filter((code) => !PERIOD_SUBMITTER_ONLY.includes(code)),
  'period.approve_lock',
  'period.approve_reopen',
  'request.approve',
  'request.configure_flow',
  'request.configure_type',
  'shift_template.update',
  'shift.assign',
  'policy.update',
  'org.update',
  'geofence.update',
  'biometric.reset',
  'device.revoke',
  'role.view',
  'role.assign',
  'role.manage',
  'delegation.manage',
  'audit.export',
  'setup.run',
];

/** Owner = toàn quyền trong tenant, cộng quyền chỉ định Owner khác (BR-15). */
const OWNER_PERMISSIONS: PermissionCode[] = [...COMPANY_ADMIN_PERMISSIONS, 'owner.assign'];

/**
 * Platform Admin — KHÔNG có quyền nghiệp vụ trong tenant (ranh giới #2 của
 * docs/08 §1.1). Muốn chạm dữ liệu khách hàng thì phải mở `SupportAccessSession`.
 */
const PLATFORM_ADMIN_PERMISSIONS: PermissionCode[] = [
  'tenant.view',
  'tenant.manage',
  'tenant.billing',
  'package.manage',
  'platform.ai',
  'platform.incident',
  'platform.support_access',
  'platform.config',
  'audit.view',
];

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  {
    code: SYSTEM_ROLE_CODES.OWNER,
    name: 'Chủ sở hữu công ty',
    description: 'Đỉnh quyền lực của một tenant. Không thể gỡ Owner cuối cùng (BR-15).',
    defaultScope: ScopeLevel.COMPANY,
    permissions: OWNER_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.COMPANY_ADMIN,
    name: 'Giám đốc / Quản trị công ty',
    description: 'Cấu hình tổ chức, chính sách, phân quyền và duyệt chốt kỳ công.',
    defaultScope: ScopeLevel.COMPANY,
    permissions: COMPANY_ADMIN_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.HR_PAYROLL,
    name: 'Kế toán / HR',
    description: 'Nhân sự, dữ liệu chấm công, tính công và GỬI đề nghị chốt kỳ.',
    defaultScope: ScopeLevel.COMPANY,
    permissions: HR_PAYROLL_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.MANAGER,
    name: 'Quản lý',
    description: 'Theo dõi và duyệt đơn trong phạm vi phòng ban được giao.',
    defaultScope: ScopeLevel.DEPARTMENT,
    permissions: MANAGER_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.EMPLOYEE,
    name: 'Nhân viên',
    description: 'Chỉ dữ liệu của chính mình.',
    defaultScope: ScopeLevel.SELF,
    permissions: EMPLOYEE_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.PLATFORM_ADMIN,
    name: 'Quản trị nền tảng',
    description:
      'Tầng SaaS: tenant, gói dịch vụ, AI Server, sự cố. Không có quyền nghiệp vụ tenant.',
    defaultScope: ScopeLevel.PLATFORM,
    permissions: PLATFORM_ADMIN_PERMISSIONS,
  },
];

/**
 * Ánh xạ enum `SystemRole` cũ → mã vai trò mới.
 *
 * Tồn tại để `PermissionGuard` còn chạy được với các token đã phát hành và với
 * những tài khoản chưa được gán `RoleAssignment`. Bỏ được khi mọi tenant đã
 * chuyển xong — xem `AccessService.resolveEffectiveAccess`.
 */
export const LEGACY_ROLE_MAP: Record<SystemRole, SystemRoleCode> = {
  [SystemRole.SYSTEM_ADMIN]: SYSTEM_ROLE_CODES.PLATFORM_ADMIN,
  [SystemRole.COMPANY_ADMIN]: SYSTEM_ROLE_CODES.COMPANY_ADMIN,
  [SystemRole.HR_PAYROLL]: SYSTEM_ROLE_CODES.HR_PAYROLL,
  [SystemRole.MANAGER]: SYSTEM_ROLE_CODES.MANAGER,
  [SystemRole.EMPLOYEE]: SYSTEM_ROLE_CODES.EMPLOYEE,
};

/** Thang scope từ hẹp đến rộng — dùng để so sánh "scope nào bao trùm scope nào". */
export const SCOPE_RANK: Record<ScopeLevel, number> = {
  [ScopeLevel.SELF]: 0,
  [ScopeLevel.TEAM]: 1,
  [ScopeLevel.DEPARTMENT]: 2,
  [ScopeLevel.BRANCH]: 3,
  [ScopeLevel.COMPANY]: 4,
  [ScopeLevel.PLATFORM]: 5,
};
