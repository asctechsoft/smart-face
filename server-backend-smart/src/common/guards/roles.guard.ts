import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * RBAC (NFR-SEC-04) — ma trận phân quyền ở docs/04 mục 1.
 *
 * Không khai `@Roles()` = mọi vai trò đã đăng nhập đều truy cập được
 * (dùng cho API cá nhân của nhân viên).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const ctx = context.switchToHttp().getRequest<AuthenticatedRequest>().ctx;
    if (!ctx) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    // SYSTEM_ADMIN luôn qua được RolesGuard; giới hạn thật nằm ở audit + quy trình (A2).
    if (ctx.isSystemAdmin || ctx.roles.includes(SystemRole.SYSTEM_ADMIN)) {
      return true;
    }

    if (!required.some((role) => ctx.roles.includes(role))) {
      throw new AppException('AUTH_FORBIDDEN', { requiredRoles: required, actualRoles: ctx.roles });
    }

    return true;
  }
}
