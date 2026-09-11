import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { PermissionGuard } from './permission.guard';
import { StepUpGuard } from './step-up.guard';
import type { AuthenticatedRequest } from '../types/request-context';

const makeContext = (request: Partial<AuthenticatedRequest>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

const baseCtx = {
  userId: 'usr_1',
  employeeId: 'emp_1',
  companyId: 'cmp_1',
  roles: [],
  deviceId: null,
  isSystemAdmin: false,
  scopeDepartmentIds: [],
  mustChangePassword: false,
  jti: 'jti',
  traceId: 'trace',
  correlationId: 'corr',
};

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    throw new Error('Đáng lẽ phải bị chặn.');
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
};

describe('PermissionGuard', () => {
  const reflectorWith = (values: Record<string, unknown>) =>
    ({
      getAllAndOverride: (key: string) => values[key],
    }) as unknown as Reflector;

  const accessWith = (permissions: string[]) => ({
    resolveEffectiveAccess: jest
      .fn()
      .mockResolvedValue({ permissions: new Set(permissions), roleCodes: ['X'] }),
  });

  it('endpoint không khai @RequirePermission thì cho qua — hai mô hình quyền chạy song song', async () => {
    const access = accessWith([]);
    const guard = new PermissionGuard(reflectorWith({}), access as never);

    await expect(guard.canActivate(makeContext({ ctx: baseCtx as never }))).resolves.toBe(true);
    expect(access.resolveEffectiveAccess).not.toHaveBeenCalled();
  });

  it('Kế toán gọi endpoint duyệt chốt kỳ bị chặn (docs/08 §1.1 ranh giới #1)', async () => {
    const guard = new PermissionGuard(
      reflectorWith({ requiredPermissions: ['period.approve_lock'] }),
      accessWith(['period.submit_lock', 'timesheet.calculate']) as never,
    );

    expect(await codeOf(guard.canActivate(makeContext({ ctx: baseCtx as never })))).toBe(
      'RBAC_PERMISSION_DENIED',
    );
  });

  it('có một trong các quyền yêu cầu là qua — nhiều quyền là quan hệ HOẶC', async () => {
    const guard = new PermissionGuard(
      reflectorWith({ requiredPermissions: ['owner.assign', 'role.view'] }),
      accessWith(['role.view']) as never,
    );

    await expect(guard.canActivate(makeContext({ ctx: baseCtx as never }))).resolves.toBe(true);
  });

  it('gắn kết quả giải quyền vào request để service khỏi giải lần hai', async () => {
    const request: Partial<AuthenticatedRequest> = { ctx: baseCtx as never };
    const guard = new PermissionGuard(
      reflectorWith({ requiredPermissions: ['role.view'] }),
      accessWith(['role.view']) as never,
    );

    await guard.canActivate(makeContext(request));

    expect(request.access).toMatchObject({ roleCodes: ['X'] });
  });

  describe('BR-14 — không ai duyệt yêu cầu của chính mình', () => {
    it('chặn khi id trong route là chính mình', async () => {
      const guard = new PermissionGuard(
        reflectorWith({ noSelfApproval: { subjectFrom: { param: 'employeeId' } } }),
        accessWith([]) as never,
      );

      const request = { ctx: baseCtx as never, params: { employeeId: 'emp_1' } };
      expect(await codeOf(guard.canActivate(makeContext(request)))).toBe('SELF_APPROVAL_FORBIDDEN');
    });

    it('cho qua khi id là người khác', async () => {
      const guard = new PermissionGuard(
        reflectorWith({ noSelfApproval: { subjectFrom: { param: 'employeeId' } } }),
        accessWith([]) as never,
      );

      const request = { ctx: baseCtx as never, params: { employeeId: 'emp_9' } };
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    });

    it('lấy được id từ body chứ không chỉ từ route', async () => {
      const guard = new PermissionGuard(
        reflectorWith({ noSelfApproval: { subjectFrom: { body: 'employeeId' } } }),
        accessWith([]) as never,
      );

      const request = { ctx: baseCtx as never, body: { employeeId: 'emp_1' } };
      expect(await codeOf(guard.canActivate(makeContext(request)))).toBe('SELF_APPROVAL_FORBIDDEN');
    });
  });
});

describe('StepUpGuard', () => {
  const reflectorWith = (action?: string) =>
    ({ getAllAndOverride: () => action }) as unknown as Reflector;

  it('endpoint không khai @RequireStepUp thì cho qua', async () => {
    const stepUp = { consume: jest.fn() };
    const guard = new StepUpGuard(reflectorWith(undefined), stepUp as never);

    await expect(guard.canActivate(makeContext({ ctx: baseCtx as never }))).resolves.toBe(true);
    expect(stepUp.consume).not.toHaveBeenCalled();
  });

  it('thiếu header X-Step-Up-Token thì trả STEPUP_REQUIRED, KHÔNG chạy nghiệp vụ', async () => {
    const guard = new StepUpGuard(reflectorWith('period.reopen'), { consume: jest.fn() } as never);

    const request = { ctx: baseCtx as never, headers: {} };
    expect(await codeOf(guard.canActivate(makeContext(request)))).toBe('STEPUP_REQUIRED');
  });

  it('tiêu thụ token đúng hành động và gắn id vào request cho audit (NFR-AUD-02)', async () => {
    const stepUp = { consume: jest.fn().mockResolvedValue('chl_1') };
    const guard = new StepUpGuard(reflectorWith('period.reopen'), stepUp as never);

    const request: Partial<AuthenticatedRequest> = {
      ctx: baseCtx as never,
      headers: { 'x-step-up-token': 'tok_1' } as never,
    };
    await guard.canActivate(makeContext(request));

    expect(stepUp.consume).toHaveBeenCalledWith('usr_1', 'tok_1', 'period.reopen');
    expect(request.stepUpChallengeId).toBe('chl_1');
  });
});
