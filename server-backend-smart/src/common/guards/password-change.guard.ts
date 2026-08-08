import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * Chặn mọi API nghiệp vụ khi tài khoản chưa đổi mật khẩu tạm.
 *
 * HR cấp tài khoản kèm mật khẩu tạm và đọc cho nhân viên qua điện thoại hoặc
 * ghi ra giấy. Mật khẩu đó đi qua nhiều tay và tồn tại ở nhiều nơi — nó chỉ nên
 * đủ để đổi sang mật khẩu thật, không nên mở được bất cứ thứ gì khác.
 *
 * ⚠ Cưỡng chế ở SERVER chứ không phải chỉ điều hướng ở App. Trả `nextStep:
 * "CHANGE_PASSWORD"` rồi tin App sẽ chuyển màn hình là để ngỏ: ai gọi thẳng API
 * bằng token vừa nhận vẫn dùng được toàn hệ thống với mật khẩu tạm.
 *
 * Endpoint nào cần chạy được trong trạng thái này thì đánh dấu
 * `@AllowPendingPassword()` — hiện chỉ có: đổi mật khẩu, xem phiên hiện tại,
 * đăng xuất.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.ctx?.mustChangePassword) {
      throw new AppException('AUTH_MUST_CHANGE_PASSWORD');
    }

    return true;
  }
}
