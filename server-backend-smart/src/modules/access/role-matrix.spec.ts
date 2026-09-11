import {
  SYSTEM_ROLE_CODES,
  SYSTEM_ROLE_DEFINITIONS,
  type PermissionCode,
  type SystemRoleCode,
} from './permission.constants';
import { ScopeLevel } from '@prisma/client';

/**
 * Ma trận phân quyền, khoá lại bằng test (`docs/05` §1 · `docs/08` §1.1 & §7).
 *
 * ## Vì sao cần bộ test này
 *
 * Ma trận là một danh sách hằng số, và danh sách hằng số thì trôi. Bản trước
 * viết `COMPANY_ADMIN_PERMISSIONS = [...HR_PAYROLL_PERMISSIONS, ...]`, nên Giám
 * đốc âm thầm nhận luôn `period.submit_lock` — bảng trong tài liệu ghi ✗, code
 * ghi ✓, và không có gì phát hiện ra. Hệ quả không phải một ô sai trong bảng mà
 * là **ranh giới #1 của docs/08 §1.1 bị vô hiệu**: một người tự gửi đề nghị chốt
 * kỳ rồi tự duyệt nó.
 *
 * Bộ test này canh những ô mà sai là mất một chốt kiểm soát, không canh toàn bộ
 * bảng — canh hết thì nó chỉ là bản chép lại của chính file hằng số.
 */
describe('Ma trận phân quyền theo vai trò', () => {
  const permissionsOf = (code: SystemRoleCode): PermissionCode[] => {
    const definition = SYSTEM_ROLE_DEFINITIONS.find((role) => role.code === code);
    if (!definition) throw new Error(`Chưa khai vai trò ${code}`);
    return definition.permissions;
  };

  const has = (role: SystemRoleCode, permission: PermissionCode) =>
    permissionsOf(role).includes(permission);

  // =========================================================================
  //  Ranh giới #1 — Kế toán gửi chốt, Giám đốc duyệt chốt
  // =========================================================================

  describe('Phân tách nhiệm vụ trên kỳ công (docs/08 §1.1 ranh giới #1)', () => {
    it('Kế toán GỬI đề nghị chốt nhưng KHÔNG duyệt', () => {
      expect(has(SYSTEM_ROLE_CODES.HR_PAYROLL, 'period.submit_lock')).toBe(true);
      expect(has(SYSTEM_ROLE_CODES.HR_PAYROLL, 'period.approve_lock')).toBe(false);
      expect(has(SYSTEM_ROLE_CODES.HR_PAYROLL, 'period.approve_reopen')).toBe(false);
    });

    it('Giám đốc DUYỆT chốt nhưng KHÔNG gửi đề nghị', () => {
      expect(has(SYSTEM_ROLE_CODES.COMPANY_ADMIN, 'period.approve_lock')).toBe(true);
      expect(has(SYSTEM_ROLE_CODES.COMPANY_ADMIN, 'period.approve_reopen')).toBe(true);
      // Đây là ô đã từng sai. Có cả hai thì hai chữ ký chỉ còn là hình thức.
      expect(has(SYSTEM_ROLE_CODES.COMPANY_ADMIN, 'period.submit_lock')).toBe(false);
      expect(has(SYSTEM_ROLE_CODES.COMPANY_ADMIN, 'period.request_reopen')).toBe(false);
    });

    it('Owner cũng không được gộp hai vai — kể cả đỉnh quyền lực của tenant', () => {
      expect(has(SYSTEM_ROLE_CODES.OWNER, 'period.approve_lock')).toBe(true);
      expect(has(SYSTEM_ROLE_CODES.OWNER, 'period.submit_lock')).toBe(false);
    });

    it('không vai trò nào vừa gửi vừa duyệt', () => {
      const offenders = SYSTEM_ROLE_DEFINITIONS.filter(
        (role) =>
          role.permissions.includes('period.submit_lock') &&
          role.permissions.includes('period.approve_lock'),
      ).map((role) => role.code);

      expect(offenders).toEqual([]);
    });
  });

  // =========================================================================
  //  Ranh giới #2 — Owner ≠ Platform Admin
  // =========================================================================

  describe('Platform Admin không có quyền nghiệp vụ tenant (ranh giới #2)', () => {
    const TENANT_BUSINESS: PermissionCode[] = [
      'employee.view',
      'employee.update',
      'attendance.view',
      'attendance.adjust',
      'timesheet.view',
      'timesheet.calculate',
      'period.approve_lock',
      'request.approve',
      'policy.update',
      'shift.assign',
      'role.assign',
      'owner.assign',
    ];

    it.each(TENANT_BUSINESS)('KHÔNG có %s', (permission) => {
      expect(has(SYSTEM_ROLE_CODES.PLATFORM_ADMIN, permission)).toBe(false);
    });

    it('muốn chạm dữ liệu khách hàng thì phải qua phiên hỗ trợ', () => {
      expect(has(SYSTEM_ROLE_CODES.PLATFORM_ADMIN, 'platform.support_access')).toBe(true);
    });

    it('ngược lại, vai trò trong tenant không chạm được tầng nền tảng', () => {
      for (const role of [
        SYSTEM_ROLE_CODES.OWNER,
        SYSTEM_ROLE_CODES.COMPANY_ADMIN,
        SYSTEM_ROLE_CODES.HR_PAYROLL,
      ]) {
        expect(has(role, 'tenant.manage')).toBe(false);
        expect(has(role, 'platform.config')).toBe(false);
        expect(has(role, 'platform.support_access')).toBe(false);
      }
    });
  });

  // =========================================================================
  //  Những ô docs/05 §1 đánh dấu ✗ cho Kế toán
  // =========================================================================

  describe('Kế toán — những quyền cố ý VẮNG MẶT (docs/05 §1)', () => {
    const FORBIDDEN: PermissionCode[] = [
      'policy.update', // "Cấu hình chính sách công ty ✗"
      'shift_template.update', // "Định nghĩa mẫu ca ✗"
      'shift.assign', // "Xếp ca / phân ca — Không mặc định"
      'request.configure_flow', // "Cấu hình luồng duyệt ✗"
      'role.assign', // "Phân quyền tenant ✗"
      'owner.assign', // "Cấp/thu hồi Owner ✗"
      'org.update',
    ];

    it.each(FORBIDDEN)('KHÔNG có %s', (permission) => {
      expect(has(SYSTEM_ROLE_CODES.HR_PAYROLL, permission)).toBe(false);
    });

    it('nhưng CÓ những quyền vận hành hằng ngày', () => {
      for (const permission of [
        'attendance.adjust',
        'attendance.review_suspicious',
        'timesheet.calculate',
        'employee.import',
        'biometric.reset',
      ] as PermissionCode[]) {
        expect(has(SYSTEM_ROLE_CODES.HR_PAYROLL, permission)).toBe(true);
      }
    });
  });

  // =========================================================================
  //  Quản lý — giới hạn hai chiều
  // =========================================================================

  describe('Quản lý — vai trò hẹp, phạm vi hẹp', () => {
    it('phạm vi mặc định là DEPARTMENT, không phải COMPANY', () => {
      const manager = SYSTEM_ROLE_DEFINITIONS.find(
        (role) => role.code === SYSTEM_ROLE_CODES.MANAGER,
      );
      expect(manager?.defaultScope).toBe(ScopeLevel.DEPARTMENT);
    });

    it('duyệt đơn được, nhưng không sửa công và không quyết cờ nghi vấn', () => {
      expect(has(SYSTEM_ROLE_CODES.MANAGER, 'request.approve')).toBe(true);
      // Quyết định huỷ/giữ công của cấp dưới trực tiếp là xung đột lợi ích —
      // cùng lập luận đã ghi ở `FraudController.review`.
      expect(has(SYSTEM_ROLE_CODES.MANAGER, 'attendance.adjust')).toBe(false);
      expect(has(SYSTEM_ROLE_CODES.MANAGER, 'attendance.review_suspicious')).toBe(false);
    });

    it('xuất Excel và gửi thông báo được — bị cắt bằng SCOPE chứ không bằng vai trò', () => {
      expect(has(SYSTEM_ROLE_CODES.MANAGER, 'attendance.export')).toBe(true);
      expect(has(SYSTEM_ROLE_CODES.MANAGER, 'notification.send')).toBe(true);
    });

    it('phân ca chỉ có khi được uỷ quyền tường minh, không mặc định', () => {
      expect(has(SYSTEM_ROLE_CODES.MANAGER, 'shift.assign')).toBe(false);
    });
  });

  // =========================================================================
  //  Nhân viên
  // =========================================================================

  describe('Nhân viên — chỉ dữ liệu của chính mình', () => {
    it('phạm vi mặc định là SELF', () => {
      const employee = SYSTEM_ROLE_DEFINITIONS.find(
        (role) => role.code === SYSTEM_ROLE_CODES.EMPLOYEE,
      );
      expect(employee?.defaultScope).toBe(ScopeLevel.SELF);
    });

    it('không có quyền nào tác động lên người khác', () => {
      const permissions = permissionsOf(SYSTEM_ROLE_CODES.EMPLOYEE);
      const writeOnOthers = permissions.filter((code) =>
        /\.(create|update|delete|approve|assign|adjust|terminate|import|manage)$/.test(code),
      );
      expect(writeOnOthers).toEqual([]);
    });
  });

  // =========================================================================
  //  Owner
  // =========================================================================

  it('chỉ Owner mới chỉ định được Owner khác (BR-15)', () => {
    const holders = SYSTEM_ROLE_DEFINITIONS.filter((role) =>
      role.permissions.includes('owner.assign'),
    ).map((role) => role.code);

    expect(holders).toEqual([SYSTEM_ROLE_CODES.OWNER]);
  });

  it('mọi vai trò đều khai phạm vi mặc định — không để undefined', () => {
    for (const role of SYSTEM_ROLE_DEFINITIONS) {
      expect(Object.values(ScopeLevel)).toContain(role.defaultScope);
    }
  });
});
