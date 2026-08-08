import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { PaginatedResult } from '../dto/api-response.dto';

/**
 * Bọc mọi response thành công theo docs/08 mục 1.3:
 *
 * ```json
 * { "success": true, "data": {...}, "meta": { page, pageSize, total, totalPages } }
 * ```
 *
 * Service trả `PaginatedResult` thì `meta` được tách ra tự động.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        // Endpoint tự dựng response (stream, redirect) thì trả nguyên trạng.
        if (payload instanceof Buffer) return payload;

        if (payload instanceof PaginatedResult) {
          return { success: true, data: payload.items, meta: payload.meta };
        }

        return { success: true, data: payload ?? null };
      }),
    );
  }
}
