import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppException } from '../errors';
import type { AuthenticatedRequest, RequestContext, TenantContext } from '../types/request-context';

/** Ngữ cảnh người gọi. Chỉ dùng trên endpoint đã qua JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.ctx) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }
    return request.ctx;
  },
);

/**
 * Ngữ cảnh đã đảm bảo có `companyId` (BR-09).
 *
 * Repository BẮT BUỘC nhận companyId từ đây, không bao giờ lấy từ body/query
 * của client — đó là đường rò rỉ dữ liệu chéo tenant.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.ctx) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }
    if (!request.ctx.companyId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    return request.ctx as TenantContext;
  },
);
