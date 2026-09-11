import { describe, expect, it } from 'vitest';
import {
  EXECUTIVE_NAV,
  OPERATIONS_NAV,
  PLATFORM_NAV,
  SETTINGS_TABS,
  canSeeNavItem,
  selectNavGroups,
} from './nav-items';
import { hasPermission, type EffectiveAccess, type Permission } from '@/lib/rbac/permissions';

/**
 * Hiển thị theo vai trò — khoá lại bằng test.
 *
 * ## Vì sao test ở đây thay vì tin vào mắt
 *
 * Menu là thứ người ta sửa nhiều nhất và ít kiểm nhất. Một dòng thêm nhầm vào
 * `OPERATIONS_NAV` là Kế toán nhìn thấy lối vào màn cấu hình chính sách — không
 * bấm được (Backend chặn), nhưng người dùng không biết điều đó và sẽ bấm, rồi
 * gọi hỗ trợ.
 *
 * Bộ test này dựng quyền theo ĐÚNG ma trận của `permission.constants.ts` phía
 * Backend, nên nó cũng là chỗ phát hiện khi hai bên lệch nhau.
 */

// Chép từ `server-backend-smart/src/modules/access/permission.constants.ts`.
// Cố ý chép thay vì chia sẻ: hai codebase triển khai riêng, và một bài test
// chỉ có giá trị khi nó so hai bản độc lập chứ không so một bản với chính nó.
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  EMPLOYEE: ['request.view', 'attendance.view'],
  MANAGER: [
    'request.view',
    'attendance.view',
    'employee.view',
    'request.approve',
    'report.view',
    'timesheet.view',
    'attendance.sheet_manage',
    'attendance.export',
    'notification.send',
  ],
  HR_PAYROLL: [
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
    'biometric.reset',
    'device.revoke',
  ],
  COMPANY_ADMIN: [
    'employee.view',
    'employee.create',
    'employee.update',
    'attendance.view',
    'attendance.adjust',
    'attendance.export',
    'attendance.review_suspicious',
    'attendance.sheet_manage',
    'timesheet.view',
    'timesheet.calculate',
    'timesheet.adjust',
    'period.approve_lock',
    'period.approve_reopen',
    'request.view',
    'request.approve',
    'request.configure_flow',
    'shift_template.view',
    'shift_template.update',
    'shift.assign',
    'org.view',
    'org.update',
    'policy.view',
    'policy.update',
    'report.view',
    'report.export',
    'notification.send',
    'audit.view',
    'role.view',
    'role.assign',
    'setup.run',
  ],
  PLATFORM_ADMIN: [
    'tenant.view',
    'tenant.manage',
    'tenant.billing',
    'package.manage',
    'platform.ai',
    'platform.incident',
    'platform.support_access',
    'platform.config',
    'audit.view',
  ],
};

const accessFor = (role: keyof typeof ROLE_PERMISSIONS): EffectiveAccess => ({
  roles: [role],
  legacyRoles: [],
  permissions: (ROLE_PERMISSIONS[role] ?? []).map((code) => ({
    code,
    scope: role === 'MANAGER' ? 'DEPARTMENT' : role === 'PLATFORM_ADMIN' ? 'PLATFORM' : 'COMPANY',
    scopeIds: role === 'MANAGER' ? ['dept_1'] : [],
  })),
  nextExpiryAt: null,
});

/** Đúng cách `ManagerLayout` dựng menu: chọn bộ, rồi lọc từng mục. */
function visibleNav(role: keyof typeof ROLE_PERMISSIONS): string[] {
  const access = accessFor(role);
  const has = (permission: Permission) => hasPermission(access, permission);
  return selectNavGroups(has)
    .flatMap((group) => group.items)
    .filter((item) => canSeeNavItem(item, has))
    .map((item) => item.to);
}

/** Tab nào của trang "Thiết lập" hiện ra với vai trò này. */
function visibleSettings(role: keyof typeof ROLE_PERMISSIONS): string[] {
  const access = accessFor(role);
  return SETTINGS_TABS.filter((item) =>
    canSeeNavItem(item, (permission) => hasPermission(access, permission)),
  ).map((item) => item.to);
}

describe('Chọn bộ điều hướng theo quyền', () => {
  it('Quản trị nền tảng nhận bộ nền tảng', () => {
    const access = accessFor('PLATFORM_ADMIN');
    expect(selectNavGroups((p) => hasPermission(access, p))).toBe(PLATFORM_NAV);
  });

  it('Giám đốc nhận bộ điều hành', () => {
    const access = accessFor('COMPANY_ADMIN');
    expect(selectNavGroups((p) => hasPermission(access, p))).toBe(EXECUTIVE_NAV);
  });

  it('Kế toán và Quản lý nhận bộ vận hành', () => {
    for (const role of ['HR_PAYROLL', 'MANAGER'] as const) {
      const access = accessFor(role);
      expect(selectNavGroups((p) => hasPermission(access, p))).toBe(OPERATIONS_NAV);
    }
  });

  it('người không có quyền nào vẫn nhận một bộ, không phải undefined', () => {
    expect(selectNavGroups(() => false)).toBe(OPERATIONS_NAV);
  });
});

describe('Kế toán thấy gì', () => {
  const nav = visibleNav('HR_PAYROLL');

  it('có bảng công, đơn từ, kỳ công, báo cáo', () => {
    expect(nav).toContain('/attendance');
    expect(nav).toContain('/requests');
    expect(nav).toContain('/exec/periods');
    expect(nav).toContain('/reports');
  });

  /*
   * `/shifts` bây giờ là màn "Ca làm & Phân ca", gộp DANH MỤC ca với LỊCH phân
   * ca. Kế toán có `shift_template.view` nên thấy mục này và mở được tab danh
   * mục — đúng như khi danh mục ca còn là một tab của trang Thiết lập.
   *
   * Điều docs/05 §1 cấm là XẾP ca (`shift.assign`), và chốt chặn đó vẫn nguyên:
   * họ không có quyền, nên tab "Lịch phân ca" không dựng ra (`ShiftsPage`) và
   * route `/shifts/:id` từ chối họ.
   */
  it('thấy mục Ca làm & Phân ca nhưng KHÔNG có quyền xếp ca', () => {
    expect(nav).toContain('/shifts');
    expect(hasPermission(accessFor('HR_PAYROLL'), 'shift.assign')).toBe(false);
    expect(hasPermission(accessFor('HR_PAYROLL'), 'shift_template.view')).toBe(true);
  });

  it('có Thiết lập (chính sách chỉ đọc) ngay trên sidenav', () => {
    expect(nav).toContain('/policy');
  });

  it('trong Thiết lập chỉ thấy tab Nhật ký, KHÔNG thấy Phân quyền', () => {
    const settings = visibleSettings('HR_PAYROLL');
    expect(settings).toEqual(['/policy?tab=audit']);
    // "Phân quyền tenant ✗" và "Cấu hình luồng duyệt ✗" trong docs/05 §1.
    expect(settings).not.toContain('/policy?tab=access');
    expect(settings).not.toContain('/policy?tab=request-types');
  });
});

describe('Giám đốc thấy gì', () => {
  const nav = visibleNav('COMPANY_ADMIN');

  /*
   * Giám đốc thấy ĐỦ CẢ CHÍN mục — bộ điều hành và bộ vận hành nay cùng một
   * danh sách, chỉ khác quyền gác từng mục. Khoá con số 9 lại để việc thêm một
   * mục vào một bộ mà quên bộ kia sẽ trượt ở đây.
   */
  it('thấy đủ chín mục của thanh điều hướng', () => {
    expect(nav).toEqual([
      '/dashboard',
      '/employees',
      '/work-status',
      '/shifts',
      '/attendance',
      '/requests',
      '/exec/periods',
      '/reports',
      '/policy',
    ]);
  });

  it('KHÔNG còn mục "Cần duyệt" riêng — vào duyệt từ mục Yêu cầu', () => {
    expect(nav).not.toContain('/exec/approvals');
  });

  it('trong Thiết lập có đủ phần cấu hình mà Kế toán không có', () => {
    const settings = visibleSettings('COMPANY_ADMIN');
    expect(settings).toContain('/policy?tab=access');
    expect(settings).toContain('/policy?tab=request-types');
    expect(settings).toContain('/policy?tab=audit');
  });
});

describe('Quản lý thấy gì', () => {
  const nav = visibleNav('MANAGER');

  it('thấy dữ liệu chấm công và đơn — bị cắt bằng SCOPE chứ không bằng menu', () => {
    expect(nav).toContain('/attendance');
    expect(nav).toContain('/requests');
  });

  it('KHÔNG thấy Ca làm & Phân ca (chưa được uỷ quyền, cũng không đọc danh mục ca)', () => {
    expect(nav).not.toContain('/shifts');
  });

  it('có Nhân sự trên sidenav nhưng KHÔNG có tab thiết lập nào', () => {
    expect(nav).toContain('/employees');
    expect(nav).not.toContain('/policy');
    expect(visibleSettings('MANAGER')).toEqual([]);
  });
});

describe('Quản trị nền tảng thấy gì', () => {
  const nav = visibleNav('PLATFORM_ADMIN');

  it('chỉ thấy màn hình tầng nền tảng', () => {
    expect(nav).toContain('/system');
    expect(nav).toContain('/system/tenants');
    expect(nav).toContain('/system/packages');
    expect(nav).toContain('/system/support');
    expect(nav).toContain('/system/health');
    expect(nav).toContain('/system/logs');
  });

  it('mọi mục đều nằm dưới /system — không mục nào rơi ra ngoài tầng nền tảng', () => {
    // Đây là ranh giới #2 của docs/08 §1.1 phát biểu bằng một câu kiểm được:
    // thêm nhầm một mục nghiệp vụ vào PLATFORM_NAV sẽ trượt ở đây, kể cả khi
    // đường dẫn đó chưa có trong danh sách cấm phía dưới.
    for (const to of nav) {
      expect(to.startsWith('/system')).toBe(true);
    }
  });

  it('KHÔNG thấy màn hình nghiệp vụ của tenant (docs/08 §1.1 ranh giới #2)', () => {
    for (const forbidden of [
      '/attendance',
      '/requests',
      '/employees',
      '/exec/periods',
      '/exec/approvals',
      '/dashboard',
    ]) {
      expect(nav).not.toContain(forbidden);
    }
  });

  /*
   * Quản trị nền tảng CÓ `audit.view` (họ tra được nhật ký xuyên tenant), nên
   * lọc `SETTINGS_TABS` bằng quyền sẽ cho ra tab Nhật ký. Chốt chặn thật không
   * nằm ở đó mà ở sidenav: bộ nền tảng không có mục nào trỏ tới `/policy`, và
   * nhật ký của họ vào bằng `/system/logs` — bản xuyên tenant.
   */
  it('không có lối vào trang Thiết lập của một công ty', () => {
    expect(nav).not.toContain('/policy');
    expect(nav).toContain('/system/logs');
  });
});

describe('Nhân viên thấy gì', () => {
  it('web quản lý gần như trống — đây là công cụ quản trị, không phải app nhân viên', () => {
    const nav = visibleNav('EMPLOYEE');
    expect(nav).toEqual(['/work-status', '/attendance', '/requests']);
    expect(visibleSettings('EMPLOYEE')).toEqual([]);
  });
});

describe('Ràng buộc cấu trúc của các bộ nav', () => {
  const allItems = [...OPERATIONS_NAV, ...EXECUTIVE_NAV, ...PLATFORM_NAV].flatMap(
    (group) => group.items,
  );

  it('mọi mục đều khai quyền — không có mục nào ai cũng thấy', () => {
    for (const item of [...allItems, ...SETTINGS_TABS]) {
      // Mảng rỗng cũng là "không khai quyền": nó khiến `canSeeNavItem` trả
      // `false` với mọi người, tức một mục chết chứ không phải một mục mở.
      expect(item.permission).toBeTruthy();
      if (Array.isArray(item.permission)) expect(item.permission.length).toBeGreaterThan(0);
    }
  });

  it('khoá `key` không trùng trong cùng một bộ', () => {
    for (const nav of [OPERATIONS_NAV, EXECUTIVE_NAV, PLATFORM_NAV]) {
      const keys = nav.flatMap((group) => group.items).map((item) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('không mục nào trỏ tới đường dẫn rỗng hoặc tương đối', () => {
    for (const item of [...allItems, ...SETTINGS_TABS]) {
      expect(item.to.startsWith('/')).toBe(true);
    }
  });
});
