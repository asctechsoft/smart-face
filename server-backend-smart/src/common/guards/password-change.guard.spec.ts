import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PasswordChangeGuard } from './password-change.guard';

/**
 * HR cấp tài khoản kèm mật khẩu tạm, đọc cho nhân viên qua điện thoại hoặc ghi
 * ra giấy. Mật khẩu đó đi qua nhiều tay và tồn tại ở nhiều nơi — nó chỉ nên đủ
 * để đổi sang mật khẩu thật, không mở được bất cứ thứ gì khác.
 *
 * Trả `nextStep: "CHANGE_PASSWORD"` rồi tin App sẽ chuyển màn hình là để ngỏ:
 * ai gọi thẳng API bằng token vừa nhận vẫn dùng được toàn hệ thống với mật khẩu
 * tạm. Guard này cưỡng chế ở phía server.
 */
describe('PasswordChangeGuard', () => {
  let guard: PasswordChangeGuard;
  const reflector = { getAllAndOverride: jest.fn() };

  function contextWith(mustChangePassword: boolean): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ ctx: { userId: 'usr_1', mustChangePassword } }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  /** Giả lập metadata: chỉ khoá được liệt kê mới trả true. */
  function metadata(...enabled: string[]) {
    reflector.getAllAndOverride.mockImplementation((key: string) => enabled.includes(key));
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    metadata();

    const moduleRef = await Test.createTestingModule({
      providers: [PasswordChangeGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = moduleRef.get(PasswordChangeGuard);
  });

  it('CHẶN khi tài khoản chưa đổi mật khẩu tạm', () => {
    expect(() => guard.canActivate(contextWith(true))).toThrow(
      expect.objectContaining({ code: 'AUTH_MUST_CHANGE_PASSWORD' }),
    );
  });

  it('CHO QUA khi đã đổi mật khẩu', () => {
    expect(guard.canActivate(contextWith(false))).toBe(true);
  });

  it('CHO QUA endpoint được đánh dấu @AllowPendingPassword — đây là lối ra', () => {
    metadata(ALLOW_PENDING_PASSWORD_KEY);
    expect(guard.canActivate(contextWith(true))).toBe(true);
  });

  it('CHO QUA endpoint @Public — chưa đăng nhập thì chưa có gì để kiểm', () => {
    metadata(IS_PUBLIC_KEY);
    expect(guard.canActivate(contextWith(true))).toBe(true);
  });

  it('CHO QUA khi request chưa có ngữ cảnh', () => {
    // Guard chạy sau JwtAuthGuard nên trường hợp này chỉ xảy ra với endpoint
    // public; không được ném lỗi làm hỏng chúng.
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('mặc định là CHẶN — endpoint mới không tự động được miễn', () => {
    // Đây là tính chất quan trọng nhất: thêm endpoint mới mà quên nghĩ tới
    // trạng thái này thì nó bị chặn, chứ không phải lọt.
    metadata();
    expect(() => guard.canActivate(contextWith(true))).toThrow();
  });
});
