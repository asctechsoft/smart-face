import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators/public.decorator';
import { SupportAccessChecker, TenantGuard } from './tenant.guard';
import type { RequestContext } from '../types/request-context';

/**
 * Cửa xuyên tenant (`BR-08`).
 *
 * Bài test canh đúng một điều: gửi `X-Company-Id` KHÔNG còn tự nó đủ để đọc dữ
 * liệu công ty khác. Trước v2.1 nó đủ, và đó là cách một tài khoản nền tảng bị
 * chiếm có thể quét sạch mọi tenant mà không để lại lý do nào trong audit.
 */
describe('TenantGuard — truy cập xuyên tenant cần phiên hỗ trợ', () => {
  const buildCtx = (over: Partial<RequestContext> = {}): RequestContext => ({
    userId: 'usr_admin',
    employeeId: null,
    companyId: null,
    roles: [],
    deviceId: null,
    isSystemAdmin: true,
    scopeDepartmentIds: [],
    mustChangePassword: false,
    jti: 'jti_1',
    traceId: 'trace_1',
    correlationId: 'corr_1',
    ...over,
  });

  const buildContext = (request: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const reflectorWith = (flags: Record<string, boolean> = {}): Reflector =>
    ({ getAllAndOverride: (key: string) => flags[key] ?? false }) as unknown as Reflector;

  const checker = (session: { id: string; readOnly: boolean } | null): SupportAccessChecker => ({
    resolveActiveSession: jest.fn().mockResolvedValue(session),
  });

  it('chặn khi admin nền tảng chỉ định công ty mà chưa mở phiên', async () => {
    const guard = new TenantGuard(reflectorWith(), checker(null));
    const request = { ctx: buildCtx(), headers: { 'x-company-id': 'cmp_khach' }, method: 'GET' };

    await expect(guard.canActivate(buildContext(request))).rejects.toMatchObject({
      code: 'SUPPORT_SESSION_REQUIRED',
    });
    expect(request.ctx.companyId).toBeNull();
  });

  it('cho qua và gắn supportSessionId khi có phiên đang mở', async () => {
    const guard = new TenantGuard(reflectorWith(), checker({ id: 'sup_1', readOnly: true }));
    const request = { ctx: buildCtx(), headers: { 'x-company-id': 'cmp_khach' }, method: 'GET' };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.ctx.companyId).toBe('cmp_khach');
    // Mấu chốt: id này đi vào MỌI bản ghi audit của request (AuditService.record).
    expect(request.ctx.supportSessionId).toBe('sup_1');
  });

  it('phiên chỉ-đọc không thực hiện được thao tác ghi', async () => {
    const guard = new TenantGuard(reflectorWith(), checker({ id: 'sup_1', readOnly: true }));
    const request = { ctx: buildCtx(), headers: { 'x-company-id': 'cmp_khach' }, method: 'POST' };

    await expect(guard.canActivate(buildContext(request))).rejects.toBeInstanceOf(AppException);
  });

  it('phiên khai readOnly=false thì ghi được', async () => {
    const guard = new TenantGuard(reflectorWith(), checker({ id: 'sup_2', readOnly: false }));
    const request = { ctx: buildCtx(), headers: { 'x-company-id': 'cmp_khach' }, method: 'PATCH' };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
  });

  it('admin nền tảng không chỉ định công ty nào thì không cần phiên', async () => {
    const support = checker(null);
    const guard = new TenantGuard(reflectorWith(), support);
    const request = { ctx: buildCtx(), headers: {}, method: 'GET' };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(support.resolveActiveSession).not.toHaveBeenCalled();
  });

  it('người dùng thường KHÔNG mượn được header này', async () => {
    const guard = new TenantGuard(reflectorWith(), checker({ id: 'sup_1', readOnly: false }));
    const request = {
      ctx: buildCtx({ isSystemAdmin: false, companyId: 'cmp_cua_toi' }),
      headers: { 'x-company-id': 'cmp_nguoi_khac' },
      method: 'GET',
    };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    // companyId giữ nguyên từ JWT — header bị bỏ qua hoàn toàn.
    expect(request.ctx.companyId).toBe('cmp_cua_toi');
  });

  it('người dùng thường chưa thuộc công ty nào thì bị chặn', async () => {
    const guard = new TenantGuard(reflectorWith(), checker(null));
    const request = { ctx: buildCtx({ isSystemAdmin: false }), headers: {}, method: 'GET' };

    await expect(guard.canActivate(buildContext(request))).rejects.toMatchObject({
      code: 'AUTH_COMPANY_REQUIRED',
    });
  });

  it('@Public và @SkipTenant vẫn đi thẳng qua', async () => {
    const support = checker(null);
    for (const key of [IS_PUBLIC_KEY, SKIP_TENANT_KEY]) {
      const guard = new TenantGuard(reflectorWith({ [key]: true }), support);
      await expect(guard.canActivate(buildContext({ headers: {} }))).resolves.toBe(true);
    }
    expect(support.resolveActiveSession).not.toHaveBeenCalled();
  });
});
