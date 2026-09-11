import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { REQUIRE_VERSION_KEY, type RequireVersionOptions } from '../decorators/version.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * Bóc `If-Match` thành `request.expectedVersion` (`BR-13` kiểm #5).
 *
 * Guard chỉ PHÂN TÍCH và xác nhận header hợp lệ. Việc so sánh với `rowVersion`
 * thật nằm trong repository, vì so ở đây là đọc bản ghi hai lần và vẫn còn cửa
 * sổ đua giữa lúc đọc và lúc ghi — kiểm phiên bản chỉ đáng tin khi nó là điều
 * kiện của chính câu lệnh `UPDATE`.
 *
 * Chấp nhận cả `If-Match: 7` và `If-Match: "7"` (dạng ETag có ngoặc kép) vì một
 * số client HTTP tự thêm ngoặc kép khi lặp lại giá trị `ETag` nhận được.
 */
@Injectable()
export class VersionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RequireVersionOptions>(REQUIRE_VERSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.headers['if-match'];
    const header = (Array.isArray(raw) ? raw[0] : raw)?.trim();

    if (!header || header === '*') {
      // `*` trong HTTP nghĩa là "miễn bản ghi tồn tại" — đúng nghĩa là ghi mù,
      // nên xử lý y như không gửi header.
      if (options.required) {
        throw new AppException('VERSION_CONFLICT', {
          reason: 'Thao tác này bắt buộc gửi header If-Match với phiên bản bản ghi.',
        });
      }
      return true;
    }

    const parsed = Number(header.replace(/^W\//, '').replace(/^"|"$/g, ''));
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Header If-Match phải là số nguyên không âm — chính là `rowVersion` đã đọc được.',
        received: header,
      });
    }

    request.expectedVersion = parsed;
    return true;
  }
}
