import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from 'src/modules/access/access.service';
import type { PermissionCode } from 'src/modules/access/permission.constants';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  NO_SELF_APPROVAL_KEY,
  PERMISSION_KEY,
  type NoSelfApprovalOptions,
} from '../decorators/permission.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * Kiểm quyền và chặn tự duyệt — kiểm #2 và #6 trong sáu kiểm bắt buộc của
 * `BR-13` (docs/08 §2.2).
 *
 * Chạy NGAY SAU `RolesGuard` trong chuỗi guard toàn cục. Hai guard cùng tồn tại
 * có chủ đích trong giai đoạn chuyển đổi:
 *
 * - `RolesGuard` kiểm `SystemRole` như cũ — 20 controller vẫn đang khai `@Roles()`.
 * - `PermissionGuard` kiểm quyền chi tiết cho các endpoint đã khai
 *   `@RequirePermission()`; endpoint chưa khai thì guard này cho qua.
 *
 * Nhờ vậy chuyển đổi làm được từng endpoint một, thay vì phải sửa hết trong một
 * lần rồi cầu cho không sót chỗ nào.
 *
 * ⚠ Guard này KHÔNG lọc dữ liệu theo scope. Nó chỉ chặn khi người gọi hoàn toàn
 * không có quyền. Việc chèn điều kiện scope vào truy vấn là của service, qua
 * `AccessService.resolveScope()` — vì chỉ service mới biết trường nào trong
 * truy vấn của nó mang nghĩa "phòng ban".
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ctx = request.ctx;
    if (!ctx) throw new AppException('AUTH_TOKEN_INVALID');

    const required = this.reflector.getAllAndOverride<PermissionCode[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const selfCheck = this.reflector.getAllAndOverride<NoSelfApprovalOptions>(
      NO_SELF_APPROVAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if ((!required || required.length === 0) && !selfCheck) return true;

    if (required && required.length > 0) {
      const effective = await this.access.resolveEffectiveAccess(ctx);
      const granted = required.some((permission) => effective.permissions.has(permission));
      if (!granted) {
        throw new AppException('RBAC_PERMISSION_DENIED', {
          requiredPermissions: required,
          roles: effective.roleCodes,
        });
      }
      // Service đọc lại từ đây thay vì giải quyền lần hai trong cùng một request.
      request.access = effective;
    }

    if (selfCheck) {
      this.assertNotSelf(request, selfCheck);
    }

    return true;
  }

  /**
   * `BR-14` — không ai duyệt yêu cầu của chính mình.
   *
   * Áp cho cả Owner. Ngoại lệ (tenant bật self-approval có policy) chưa được
   * thi công; khi làm, nó phải đi kèm cờ đánh dấu rõ trên bản ghi và một dòng
   * audit riêng, không phải chỉ bỏ qua phép kiểm này.
   */
  private assertNotSelf(request: AuthenticatedRequest, options: NoSelfApprovalOptions): void {
    const ctx = request.ctx!;
    const compare = options.compare ?? 'employeeId';
    const actor = compare === 'userId' ? ctx.userId : ctx.employeeId;
    if (!actor) return;

    const params = (request.params ?? {}) as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;

    const subject =
      (options.subjectFrom.param ? params[options.subjectFrom.param] : undefined) ??
      (options.subjectFrom.body ? body[options.subjectFrom.body] : undefined);

    if (typeof subject === 'string' && subject === actor) {
      throw new AppException('SELF_APPROVAL_FORBIDDEN', { subject });
    }
  }
}
