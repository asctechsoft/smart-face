import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { AppException } from '../errors';
import type { AuthenticatedRequest } from '../types/request-context';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Tên nhóm giới hạn — hiện trong key Redis */
  bucket: string;
  /** Số request tối đa */
  limit: number;
  /** Cửa sổ tính, tính bằng giây */
  windowSeconds: number;
  /** Tính theo cái gì (docs/08 mục 10) */
  by?: 'account' | 'device' | 'ip' | 'account+device';
}

/**
 * AF-13 — rate limit tầng ứng dụng (bổ sung cho rate limit ở API Gateway).
 *
 * ```ts
 * @RateLimit({ bucket: 'attendance', limit: 10, windowSeconds: 3600, by: 'account+device' })
 * ```
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.get<boolean>('rateLimit.enabled', true)) return true;

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const subject = this.resolveSubject(request, options.by ?? 'account');

    const key = RedisKeys.rateLimit(options.bucket, subject);
    const count = await this.redis.incrementWithTtl(key, options.windowSeconds);

    if (count > options.limit) {
      const retryAfter = await this.redis.ttl(key);
      const response = context.switchToHttp().getResponse<{ setHeader(k: string, v: string): void }>();
      response.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      response.setHeader('X-RateLimit-Remaining', '0');
      throw new AppException('SYS_RATE_LIMITED', {
        limit: options.limit,
        windowSeconds: options.windowSeconds,
        retryAfterSeconds: Math.max(retryAfter, 1),
      });
    }

    const response = context.switchToHttp().getResponse<{ setHeader(k: string, v: string): void }>();
    response.setHeader('X-RateLimit-Remaining', String(Math.max(options.limit - count, 0)));

    return true;
  }

  private resolveSubject(request: AuthenticatedRequest, by: NonNullable<RateLimitOptions['by']>) {
    const ip = request.ip ?? 'unknown-ip';
    const userId = request.ctx?.userId ?? 'anonymous';
    const deviceId = request.ctx?.deviceId ?? (request.headers['x-device-id'] as string) ?? 'no-device';

    switch (by) {
      case 'ip':
        return ip;
      case 'device':
        return deviceId;
      case 'account+device':
        return `${userId}:${deviceId}`;
      case 'account':
      default:
        return userId === 'anonymous' ? `anon:${ip}` : userId;
    }
  }
}
