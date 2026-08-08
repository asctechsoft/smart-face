import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse } from '@nestjs/swagger';
import { ERROR_CATALOG, ErrorCode } from '../errors';
import { ApiErrorDto } from '../dto/api-response.dto';

/**
 * Khai báo các mã lỗi có thể xảy ra của endpoint vào OpenAPI
 * (checklist docs/08 mục 11: "Có decorator OpenAPI đầy đủ").
 *
 * ```ts
 * @ApiErrors('ATT_ALREADY_CHECKED_IN', 'FRAUD_MOCK_LOCATION')
 * ```
 */
export function ApiErrors(...codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_CATALOG[code].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }

  const decorators = [...byStatus.entries()].map(([status, group]) =>
    ApiResponse({
      status,
      description: group.map((code) => `\`${code}\` — ${ERROR_CATALOG[code].message}`).join('\n\n'),
      type: ApiErrorDto,
    }),
  );

  return applyDecorators(ApiExtraModels(ApiErrorDto), ...decorators);
}
