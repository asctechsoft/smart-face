import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * BR-09 / ADR-05 — bảo đảm mọi request nghiệp vụ đều có `companyId` trong ngữ cảnh.
 *
 * companyId LUÔN lấy từ JWT, KHÔNG BAO GIỜ từ body/query của client.
 * Header `X-Company-Id` chỉ được chấp nhận với SYSTEM_ADMIN (xem `A1`: mọi truy
 * cập xuyên tenant của Admin đều bị AuditInterceptor ghi lại).
 *
 * Guard này chỉ chặn "không có tenant". Việc lọc dữ liệu theo companyId là trách
 * nhiệm của Repository — đó mới là lớp thực sự chống rò rỉ chéo tenant.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const [isPublic, skipTenant] = [IS_PUBLIC_KEY, SKIP_TENANT_KEY].map((key) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]),
    );
    if (isPublic || skipTenant) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ctx = request.ctx;
    if (!ctx) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    // A1: Admin hệ thống được xem xuyên tenant bằng cách chỉ định X-Company-Id.
    if (ctx.isSystemAdmin) {
      const impersonated = request.headers['x-company-id'] as string | undefined;
      if (impersonated) {
        ctx.companyId = impersonated;
      }
      return true;
    }

    if (!ctx.companyId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }

    return true;
  }
}
