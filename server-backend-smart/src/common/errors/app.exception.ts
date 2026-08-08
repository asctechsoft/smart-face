import { HttpException } from '@nestjs/common';
import { ERROR_CATALOG, ErrorCode, ErrorDefinition } from './error-catalog';

export type ErrorDetails = Record<string, unknown>;

/**
 * Exception nghiệp vụ duy nhất của hệ thống.
 *
 * KHÔNG ném `BadRequestException`/`ForbiddenException`… trực tiếp trong service —
 * mọi lỗi phải đi qua đây để đảm bảo error contract thống nhất
 * (docs/02-kien-truc-he-thong.md mục 9).
 *
 * ```ts
 * throw new AppException('ATT_ALREADY_CHECKED_IN');
 * throw new AppException('FACE_LIVENESS_FAILED', { livenessScore: 0.42, threshold: 0.7 });
 * ```
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly definition: ErrorDefinition;
  readonly details?: ErrorDetails;

  constructor(code: ErrorCode, details?: ErrorDetails) {
    const definition = ERROR_CATALOG[code];
    super({ code, ...definition, details }, definition.status);
    this.code = code;
    this.definition = definition;
    this.details = details;
  }
}
