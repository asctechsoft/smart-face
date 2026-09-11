import { ScopeLevel, SystemRole } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { AccessService } from './access.service';
import type { RequestContext } from 'src/common/types/request-context';

/**
 * Giải quyền Role × Permission × Scope (docs/08 §2 · BR-13).
 *
 * Hai nhóm bảo đảm được canh ở đây:
 *
 * 1. **Ranh giới Kế toán ↔ Giám đốc** (docs/08 §1.1 ranh giới #1). Kế toán GỬI
 *    đề nghị chốt, Giám đốc DUYỆT. Bản `web-smart` hiện tại gộp cả hai vào một
 *    quyền `payroll.close` — đúng cái lỗi mà bộ test này chặn không cho quay lại.
 * 2. **Quyền hết hạn tự mất tác dụng.** Không có job dọn dẹp nào, nên phép lọc
 *    theo thời gian phải nằm trong truy vấn.
 */
describe('AccessService — giải quyền', () => {
  const COMPANY = 'cmp_1';
  const EMPLOYEE = 'emp_1';

  let repo: Record<string, jest.Mock>;
  let redis: { remember: jest.Mock; del: jest.Mock };
  let transactions: { run: jest.Mock };
  let service: AccessService;

  const ctx = (overrides: Partial<RequestContext> = {}): RequestContext =>
    ({
      userId: 'usr_1',
      employeeId: EMPLOYEE,
      companyId: COMPANY,
      roles: [],
      deviceId: null,
      isSystemAdmin: false,
      scopeDepartmentIds: [],
      mustChangePassword: false,
      jti: 'jti',
      traceId: 'trace',
      correlationId: 'corr',
      ...overrides,
    }) as RequestContext;

  beforeEach(() => {
    repo = {
      findEffectiveAssignments: jest.fn().mockResolvedValue([]),
      findDepartmentIdsInBranches: jest.fn().mockResolvedValue([]),
      findDirectReportIds: jest.fn().mockResolvedValue([]),
      findOwner: jest.fn(),
      countActiveOwners: jest.fn(),
      revokeOwner: jest.fn().mockResolvedValue({ count: 1 }),
      grantOwner: jest.fn().mockResolvedValue({}),
    };
    // `remember` giả: luôn gọi thẳng factory, không cache.
    redis = {
      remember: jest.fn((_key: string, _ttl: number, factory: () => unknown) => factory()),
      del: jest.fn().mockResolvedValue(undefined),
    };
    transactions = { run: jest.fn((fn: (tx: unknown) => unknown) => fn({})) };

    service = new AccessService(repo as never, redis as never, transactions as never);
  });

  // =========================================================================
  //  Ranh giới gửi / duyệt
  // =========================================================================

  it('Kế toán có period.submit_lock nhưng KHÔNG có period.approve_lock', async () => {
    const access = await service.resolveEffectiveAccess(ctx({ roles: [SystemRole.HR_PAYROLL] }));

    expect(access.permissions.has('period.submit_lock')).toBe(true);
    expect(access.permissions.has('period.approve_lock')).toBe(false);
    expect(access.permissions.has('period.approve_reopen')).toBe(false);
  });

  it('Kế toán KHÔNG có shift.assign, policy.update hay request.configure_flow (docs/05 §15.1)', async () => {
    const access = await service.resolveEffectiveAccess(ctx({ roles: [SystemRole.HR_PAYROLL] }));

    expect(access.permissions.has('shift.assign')).toBe(false);
    expect(access.permissions.has('policy.update')).toBe(false);
    expect(access.permissions.has('request.configure_flow')).toBe(false);
    expect(access.permissions.has('owner.assign')).toBe(false);
  });

  it('Giám đốc có cả hai vế duyệt, Owner có thêm owner.assign', async () => {
    const director = await service.resolveEffectiveAccess(
      ctx({ roles: [SystemRole.COMPANY_ADMIN] }),
    );
    expect(director.permissions.has('period.approve_lock')).toBe(true);
    expect(director.permissions.has('period.approve_reopen')).toBe(true);
    expect(director.permissions.has('owner.assign')).toBe(false);
  });

  it('Platform Admin KHÔNG có quyền nghiệp vụ tenant (docs/08 §1.1 ranh giới #2)', async () => {
    const access = await service.resolveEffectiveAccess(
      ctx({ roles: [SystemRole.SYSTEM_ADMIN], isSystemAdmin: true }),
    );

    expect(access.permissions.has('tenant.manage')).toBe(true);
    expect(access.permissions.has('period.approve_lock')).toBe(false);
    expect(access.permissions.has('attendance.adjust')).toBe(false);
    expect(access.permissions.has('employee.update')).toBe(false);
  });

  // =========================================================================
  //  RoleAssignment thật
  // =========================================================================

  it('có RoleAssignment thì dùng nó, không rơi về vai trò cũ', async () => {
    repo.findEffectiveAssignments.mockResolvedValue([
      {
        roleId: 'r1',
        roleCode: 'BRANCH_DIRECTOR',
        scopeLevel: ScopeLevel.BRANCH,
        scopeIds: ['br_1'],
        validTo: null,
        permissions: ['request.approve', 'report.view'],
      },
    ]);

    const access = await service.resolveEffectiveAccess(ctx({ roles: [SystemRole.EMPLOYEE] }));

    expect(access.roleCodes).toEqual(['BRANCH_DIRECTOR']);
    expect(access.permissions.has('request.approve')).toBe(true);
    expect(access.scopeByPermission.get('request.approve')).toEqual({
      level: ScopeLevel.BRANCH,
      scopeIds: ['br_1'],
    });
  });

  it('cùng một quyền đến từ hai vai trò thì lấy scope RỘNG NHẤT', async () => {
    repo.findEffectiveAssignments.mockResolvedValue([
      {
        roleId: 'r1',
        roleCode: 'DEPT_HEAD',
        scopeLevel: ScopeLevel.DEPARTMENT,
        scopeIds: ['dep_1'],
        validTo: null,
        permissions: ['request.approve'],
      },
      {
        roleId: 'r2',
        roleCode: 'BRANCH_DIRECTOR',
        scopeLevel: ScopeLevel.BRANCH,
        scopeIds: ['br_9'],
        validTo: null,
        permissions: ['request.approve'],
      },
    ]);

    const access = await service.resolveEffectiveAccess(ctx());

    expect(access.scopeByPermission.get('request.approve')).toEqual({
      level: ScopeLevel.BRANCH,
      scopeIds: ['br_9'],
    });
  });

  it('hai vai trò CÙNG mức scope thì gộp danh sách id', async () => {
    repo.findEffectiveAssignments.mockResolvedValue([
      {
        roleId: 'r1',
        roleCode: 'DEPT_HEAD_A',
        scopeLevel: ScopeLevel.DEPARTMENT,
        scopeIds: ['dep_1'],
        validTo: null,
        permissions: ['request.approve'],
      },
      {
        roleId: 'r2',
        roleCode: 'DEPT_HEAD_B',
        scopeLevel: ScopeLevel.DEPARTMENT,
        scopeIds: ['dep_2'],
        validTo: null,
        permissions: ['request.approve'],
      },
    ]);

    const access = await service.resolveEffectiveAccess(ctx());

    expect(access.scopeByPermission.get('request.approve')?.scopeIds.sort()).toEqual([
      'dep_1',
      'dep_2',
    ]);
  });

  it('phép lọc hết hạn nằm trong TRUY VẤN, không ở tầng ứng dụng', async () => {
    await service.resolveEffectiveAccess(ctx());

    // Truyền employeeId + companyId xuống repository; điều kiện thời gian do
    // repository áp. Nếu ai đó chuyển sang lọc trong JS, test này vẫn xanh —
    // nên phép kiểm thật nằm ở `access.repository.ts` và được canh bằng review.
    expect(repo.findEffectiveAssignments).toHaveBeenCalledWith(COMPANY, EMPLOYEE);
  });

  it('nhắc hạn gần nhất để Web cảnh báo trước khi quyền hết (FR-GDW-ROLE-03)', async () => {
    const soon = new Date('2026-10-01T00:00:00Z');
    const later = new Date('2026-12-01T00:00:00Z');
    repo.findEffectiveAssignments.mockResolvedValue([
      {
        roleId: 'r1',
        roleCode: 'A',
        scopeLevel: ScopeLevel.COMPANY,
        scopeIds: [],
        validTo: later,
        permissions: [],
      },
      {
        roleId: 'r2',
        roleCode: 'B',
        scopeLevel: ScopeLevel.COMPANY,
        scopeIds: [],
        validTo: soon,
        permissions: [],
      },
    ]);

    const access = await service.resolveEffectiveAccess(ctx());

    expect(access.nextExpiryAt).toEqual(soon);
  });

  // =========================================================================
  //  Scope
  // =========================================================================

  it('scope BRANCH được nở thành danh sách phòng ban', async () => {
    repo.findEffectiveAssignments.mockResolvedValue([
      {
        roleId: 'r1',
        roleCode: 'BRANCH_DIRECTOR',
        scopeLevel: ScopeLevel.BRANCH,
        scopeIds: ['br_1'],
        validTo: null,
        permissions: ['employee.view'],
      },
    ]);
    repo.findDepartmentIdsInBranches.mockResolvedValue(['dep_1', 'dep_2']);

    const scope = await service.resolveScope(ctx(), 'employee.view');

    expect(scope).toEqual({
      level: ScopeLevel.BRANCH,
      branchIds: ['br_1'],
      departmentIds: ['dep_1', 'dep_2'],
    });
  });

  it('không có quyền thì scope co về SELF, không phải COMPANY', async () => {
    repo.findEffectiveAssignments.mockResolvedValue([
      {
        roleId: 'r1',
        roleCode: 'X',
        scopeLevel: ScopeLevel.COMPANY,
        scopeIds: [],
        validTo: null,
        permissions: ['report.view'],
      },
    ]);

    const scope = await service.resolveScope(ctx(), 'employee.update');

    expect(scope.level).toBe(ScopeLevel.SELF);
  });

  it('scope TEAM gồm chính mình và cấp dưới trực tiếp', async () => {
    repo.findDirectReportIds.mockResolvedValue(['emp_2', 'emp_3']);

    const ids = await service.resolveEmployeeScope(ctx(), {
      level: ScopeLevel.TEAM,
      branchIds: [],
      departmentIds: [],
    });

    expect(ids).toEqual([EMPLOYEE, 'emp_2', 'emp_3']);
  });

  it('scope COMPANY trả null = không giới hạn theo nhân viên', async () => {
    const ids = await service.resolveEmployeeScope(ctx(), {
      level: ScopeLevel.COMPANY,
      branchIds: [],
      departmentIds: [],
    });

    expect(ids).toBeNull();
  });

  // =========================================================================
  //  Owner — BR-15
  // =========================================================================

  it('gỡ Owner cuối cùng bị từ chối, và phép đếm nằm TRONG transaction', async () => {
    repo.findOwner.mockResolvedValue({ id: 'own_1', revokedAt: null });
    repo.countActiveOwners.mockResolvedValue(1);

    await expect(service.revokeOwner(COMPANY, EMPLOYEE, 'usr_2', 'Chuyển giao')).rejects.toThrow(
      AppException,
    );
    expect(repo.revokeOwner).not.toHaveBeenCalled();
    // Tham số thứ hai của countActiveOwners là transaction client — đếm ngoài
    // transaction là mở cửa cho hai request song song gỡ nốt hai Owner cuối.
    expect(repo.countActiveOwners).toHaveBeenCalledWith(COMPANY, expect.anything());
  });

  it('còn nhiều hơn một Owner thì gỡ được', async () => {
    repo.findOwner.mockResolvedValue({ id: 'own_1', revokedAt: null });
    repo.countActiveOwners.mockResolvedValue(2);

    const result = await service.revokeOwner(COMPANY, EMPLOYEE, 'usr_2', 'Chuyển giao');

    expect(result).toEqual({ revoked: true });
    expect(repo.revokeOwner).toHaveBeenCalled();
  });

  it('gán Owner cho người đã là Owner thì báo lỗi, không tạo dòng thứ hai', async () => {
    repo.findOwner.mockResolvedValue({ id: 'own_1', revokedAt: null });

    await expect(service.grantOwner(COMPANY, EMPLOYEE, 'usr_2')).rejects.toMatchObject({
      code: 'OWNER_ALREADY_GRANTED',
    });
  });

  it('người từng bị gỡ thì cấp lại được', async () => {
    repo.findOwner.mockResolvedValue({ id: 'own_1', revokedAt: new Date() });

    await service.grantOwner(COMPANY, EMPLOYEE, 'usr_2');

    expect(repo.grantOwner).toHaveBeenCalledWith(COMPANY, EMPLOYEE, 'usr_2');
  });
});
