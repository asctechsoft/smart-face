import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { ulid } from 'ulid';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest, JwtPayload } from '../types/request-context';

/**
 * Xác thực access token và dựng RequestContext.
 *
 * AF-16: token gắn với thiết bị — `X-Device-Id` phải khớp `deviceId` trong token.
 * Guard này chạy TRƯỚC TenantGuard, RolesGuard, ScopeGuard.
 *
 * ---
 *
 * ⚠ GIỚI HẠN — đọc trước khi tin vào chốt này.
 *
 * Phần payload của JWT chỉ được **ký**, không được **mã hoá**. Ai cầm được token
 * đều giải base64 ra đọc `deviceId` rồi tự đặt header cho khớp. Vì vậy kiểm tra
 * ở đây KHÔNG chống được kẻ đã đánh cắp token.
 *
 * Nó chỉ làm đúng một việc: buộc client phải khai báo thiết bị, để `deviceId`
 * trong `RequestContext` luôn có thật và các tầng sau (rate limit theo thiết bị,
 * chấm điểm gian lận thiết bị lạ, audit) không bị qua mặt bằng cách bỏ trống.
 *
 * Ràng buộc thiết bị THẬT nằm ở `SignatureGuard`: App ký request bằng
 * `deviceSecret` — thứ chỉ cấp một lần lúc đăng nhập và nằm trong secure enclave,
 * không có trong token. Endpoint nào cần ràng buộc thiết bị thật thì phải gắn
 * `@RequireSignature()`, không được trông vào riêng guard này.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.traceId ??= (request.headers['x-trace-id'] as string) || ulid();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const token = this.extractToken(request);
    if (!token) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        issuer: this.config.get<string>('jwt.issuer'),
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AppException('AUTH_TOKEN_EXPIRED');
      }
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    // AF-16 — thiết bị trong header phải khớp thiết bị trong token.
    //
    // Token CÓ deviceId  = token của App  → header BẮT BUỘC và phải khớp.
    // Token KHÔNG có     = token của Web  → bỏ qua.
    //
    // Hai web quản lý không có chức năng chấm công nên không cần ràng buộc
    // thiết bị; chỉ App mới chấm công được.
    //
    // ⚠ Trước đây điều kiện là `payload.deviceId && headerDeviceId && ...`,
    // nghĩa là chỉ cần KHÔNG GỬI header là bỏ qua được toàn bộ kiểm tra. Ràng
    // buộc thiết bị mà client tự chọn có áp dụng hay không thì không phải là
    // ràng buộc.
    if (payload.deviceId) {
      const headerDeviceId = request.headers['x-device-id'] as string | undefined;
      if (!headerDeviceId) {
        throw new AppException('AUTH_DEVICE_MISMATCH', {
          reason: 'Thiếu header X-Device-Id. Token của App bắt buộc phải kèm header này.',
        });
      }
      if (headerDeviceId !== payload.deviceId) {
        throw new AppException('AUTH_DEVICE_MISMATCH');
      }
    }

    request.ctx = {
      userId: payload.sub,
      employeeId: payload.employeeId ?? null,
      companyId: payload.companyId ?? null,
      roles: payload.roles ?? [],
      deviceId: payload.deviceId ?? null,
      isSystemAdmin: payload.isSystemAdmin ?? false,
      scopeDepartmentIds: payload.scopeDepartmentIds ?? [],
      mustChangePassword: payload.mustChangePassword ?? false,
      jti: payload.jti,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      traceId: request.traceId,
    };

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
