import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { STEP_UP_KEY } from '../decorators/permission.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/** Header client gửi kèm token step-up đã xác thực. */
export const STEP_UP_HEADER = 'x-step-up-token';

/**
 * Guard chỉ cần đúng một hàm của `StepUpService`, nên nhận qua token DI thay vì
 * import thẳng lớp đó.
 *
 * Lý do rất cụ thể: `StepUpService` → `AuthService` → `firebase-admin` →
 * `jwks-rsa`, và `jwks-rsa` phát hành ESM mà Jest ở cấu hình này không parse
 * được. Import thẳng lớp làm mọi bài test chạm tới guard đều chết ở khâu nạp
 * module, dù bài test đó không liên quan gì tới Firebase.
 */
export const STEP_UP_CONSUMER = Symbol('STEP_UP_CONSUMER');

export interface StepUpConsumer {
  consume(userId: string, token: string, action: string): Promise<string>;
}

/**
 * Bắt buộc xác thực lại danh tính trước các thao tác nhạy cảm (`BR-18`).
 *
 * Đứng SAU `PermissionGuard`: không có quyền thì bị chặn trước, khỏi tốn một
 * lượt xác thực để rồi vẫn bị từ chối.
 *
 * Guard tiêu thụ token ngay tại đây thay vì để service tự gọi. Lý do: `@RequireStepUp`
 * là thứ người đọc controller nhìn thấy và tin là đã được bảo vệ. Nếu việc kiểm
 * nằm trong service thì decorator chỉ còn là chú thích, và thêm một endpoint mà
 * quên gọi hàm kiểm là mất bảo vệ mà không có gì báo.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(STEP_UP_CONSUMER) private readonly stepUp: StepUpConsumer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<string>(STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ctx = request.ctx;
    if (!ctx) throw new AppException('AUTH_TOKEN_INVALID');

    const raw = request.headers[STEP_UP_HEADER];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      throw new AppException('STEPUP_REQUIRED', { action });
    }

    // Gắn vào request để AuditInterceptor ghi được `stepUpChallengeId` (NFR-AUD-02).
    request.stepUpChallengeId = await this.stepUp.consume(ctx.userId, token, action);
    return true;
  }
}
