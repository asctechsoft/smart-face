import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * AF-16 — ràng buộc thiết bị.
 *
 * Lỗi từng có: điều kiện là `payload.deviceId && headerDeviceId && ...`, nên
 * chỉ cần KHÔNG GỬI header `X-Device-Id` là bỏ qua được toàn bộ kiểm tra. Ràng
 * buộc mà client tự chọn có áp dụng hay không thì không phải là ràng buộc.
 *
 * Quy tắc đúng:
 *   token CÓ deviceId  (App)  → header BẮT BUỘC và phải khớp
 *   token KHÔNG có     (Web)  → bỏ qua, hai web quản lý không chấm công
 */
describe('JwtAuthGuard — ràng buộc thiết bị (AF-16)', () => {
  let guard: JwtAuthGuard;

  const jwt = { verifyAsync: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  const config = { get: jest.fn().mockReturnValue('smartface') };

  const APP_TOKEN = {
    sub: 'usr_1',
    employeeId: 'emp_1',
    companyId: 'cmp_1',
    roles: ['EMPLOYEE'],
    deviceId: 'dev_abc',
    jti: 'jti_1',
  };

  const WEB_TOKEN = {
    sub: 'usr_2',
    employeeId: 'emp_2',
    companyId: 'cmp_1',
    roles: ['HR_PAYROLL'],
    jti: 'jti_2',
  };

  function contextWith(headers: Record<string, string>): ExecutionContext {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer token-gia-lap', ...headers },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);

    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwt },
        { provide: Reflector, useValue: reflector },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    guard = moduleRef.get(JwtAuthGuard);
  });

  // ===========================================================================
  //  Token của App — header bắt buộc
  // ===========================================================================

  describe('token của App (có deviceId)', () => {
    beforeEach(() => {
      jwt.verifyAsync.mockResolvedValue(APP_TOKEN);
    });

    it('CHẶN khi thiếu hẳn header X-Device-Id', async () => {
      // Đây chính là đường bỏ qua trước đây: không gửi header thì không bị kiểm.
      await expect(guard.canActivate(contextWith({}))).rejects.toMatchObject({
        code: 'AUTH_DEVICE_MISMATCH',
      });
    });

    it('CHẶN khi header rỗng', async () => {
      await expect(
        guard.canActivate(contextWith({ 'x-device-id': '' })),
      ).rejects.toMatchObject({ code: 'AUTH_DEVICE_MISMATCH' });
    });

    it('CHẶN khi header khác deviceId trong token', async () => {
      await expect(
        guard.canActivate(contextWith({ 'x-device-id': 'dev_cua_ke_tan_cong' })),
      ).rejects.toMatchObject({ code: 'AUTH_DEVICE_MISMATCH' });
    });

    it('CHO QUA khi header khớp', async () => {
      await expect(
        guard.canActivate(contextWith({ 'x-device-id': 'dev_abc' })),
      ).resolves.toBe(true);
    });

    it('đưa deviceId vào RequestContext cho các tầng sau dùng', async () => {
      const context = contextWith({ 'x-device-id': 'dev_abc' });
      await guard.canActivate(context);

      // Rate limit theo thiết bị và chấm điểm gian lận đều đọc trường này.
      const request = context.switchToHttp().getRequest();
      expect(request.ctx.deviceId).toBe('dev_abc');
    });
  });

  // ===========================================================================
  //  Token của Web — không có deviceId
  // ===========================================================================

  describe('token của Web quản lý (không có deviceId)', () => {
    beforeEach(() => {
      jwt.verifyAsync.mockResolvedValue(WEB_TOKEN);
    });

    it('CHO QUA khi không gửi header', async () => {
      // Hai web quản lý không có chức năng chấm công nên không ràng buộc thiết bị.
      await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    });

    it('CHO QUA kể cả khi gửi header lạ — token không gắn thiết bị nào', async () => {
      await expect(
        guard.canActivate(contextWith({ 'x-device-id': 'dev_bat_ky' })),
      ).resolves.toBe(true);
    });

    it('deviceId trong RequestContext là null', async () => {
      const context = contextWith({});
      await guard.canActivate(context);

      expect(context.switchToHttp().getRequest().ctx.deviceId).toBeNull();
    });
  });

  // ===========================================================================
  //  Các nhánh còn lại
  // ===========================================================================

  it('endpoint @Public bỏ qua toàn bộ kiểm tra', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('thiếu Authorization → AUTH_TOKEN_INVALID', async () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('token hết hạn → AUTH_TOKEN_EXPIRED, phân biệt với token sai', async () => {
    // App cần phân biệt: hết hạn thì gọi refresh, sai thì bắt đăng nhập lại.
    jwt.verifyAsync.mockRejectedValue(new TokenExpiredError('jwt expired', new Date()));

    await expect(
      guard.canActivate(contextWith({ 'x-device-id': 'dev_abc' })),
    ).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });

  it('token sai chữ ký → AUTH_TOKEN_INVALID', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(
      guard.canActivate(contextWith({ 'x-device-id': 'dev_abc' })),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('kiểm thiết bị chạy SAU khi xác thực token', async () => {
    // Thứ tự quan trọng: token hỏng mà báo AUTH_DEVICE_MISMATCH thì kẻ tấn công
    // dò được deviceId hợp lệ bằng cách thử token bừa.
    jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(guard.canActivate(contextWith({}))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });
});
