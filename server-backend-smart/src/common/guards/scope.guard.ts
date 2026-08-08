import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { AppException } from '../errors';
import { SCOPE_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * ScopeGuard — vai trò MANAGER bị giới hạn HAI CHIỀU: vừa theo vai trò,
 * vừa theo phạm vi phòng ban được phân công (docs/04 mục 1).
 *
 * Guard này chỉ kiểm tra "MANAGER có phạm vi hợp lệ hay không" và chặn khi
 * manager cố lọc sang phòng ban ngoài phạm vi. Việc CHÈN scope vào query là
 * trách nhiệm của service — dùng `resolveDepartmentScope()` bên dưới.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scoped = this.reflector.getAllAndOverride<boolean>(SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scoped) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ctx = request.ctx;
    if (!ctx) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    const isManagerOnly =
      ctx.roles.includes(SystemRole.MANAGER) &&
      !ctx.isSystemAdmin &&
      !ctx.roles.includes(SystemRole.COMPANY_ADMIN) &&
      !ctx.roles.includes(SystemRole.HR_PAYROLL);

    if (!isManagerOnly) return true;

    if (ctx.scopeDepartmentIds.length === 0) {
      throw new AppException('AUTH_FORBIDDEN', {
        reason: 'MANAGER chưa được gán phòng ban quản lý nào.',
      });
    }

    // Manager lọc theo departmentId cụ thể → phải nằm trong phạm vi của mình.
    const requested = this.extractRequestedDepartmentIds(request);
    const outOfScope = requested.filter((id) => !ctx.scopeDepartmentIds.includes(id));
    if (outOfScope.length > 0) {
      throw new AppException('AUTH_FORBIDDEN', { outOfScopeDepartmentIds: outOfScope });
    }

    return true;
  }

  private extractRequestedDepartmentIds(request: AuthenticatedRequest): string[] {
    const query = request.query as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;

    const collected: string[] = [];
    for (const source of [query.departmentId, body.departmentId]) {
      if (typeof source === 'string' && source) collected.push(source);
    }
    for (const source of [query.departmentIds, body.departmentIds]) {
      if (Array.isArray(source)) {
        collected.push(...source.filter((id): id is string => typeof id === 'string'));
      } else if (typeof source === 'string' && source) {
        collected.push(...source.split(',').filter(Boolean));
      }
    }
    return collected;
  }
}

/**
 * Phạm vi phòng ban áp dụng cho truy vấn.
 *
 * @returns `null` nghĩa là KHÔNG giới hạn (Admin/HR xem toàn công ty),
 *          mảng id nghĩa là chỉ được đọc các phòng ban này.
 */
export function resolveDepartmentScope(ctx: {
  roles: SystemRole[];
  isSystemAdmin: boolean;
  scopeDepartmentIds: string[];
}): string[] | null {
  if (ctx.isSystemAdmin) return null;
  if (
    ctx.roles.includes(SystemRole.COMPANY_ADMIN) ||
    ctx.roles.includes(SystemRole.HR_PAYROLL) ||
    ctx.roles.includes(SystemRole.SYSTEM_ADMIN)
  ) {
    return null;
  }
  if (ctx.roles.includes(SystemRole.MANAGER)) {
    return ctx.scopeDepartmentIds;
  }
  return [];
}
