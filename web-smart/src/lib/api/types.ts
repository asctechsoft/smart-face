/**
 * Hình dạng phản hồi của Backend — docs/08-hop-dong-api.md mục 1.3.
 *
 * Thành công: `{ success: true, data, meta? }`
 * Lỗi:        `{ success: false, error: { code, message, ... } }`
 */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  messageEn: string;
  hint?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  traceId: string;
}

export interface ApiOk<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiFail {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiOk<T> | ApiFail;

/** Kết quả có phân trang, đã tách sẵn cho tầng UI. */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Tham số phân trang dùng chung — khớp `PaginationQueryDto` của Backend. */
export interface PageQuery {
  page?: number;
  pageSize?: number;
  /** Tiền tố `-` là giảm dần. VD: `-recordedAt` */
  sort?: string;
  q?: string;
}

export interface DateRangeQuery {
  from?: string;
  to?: string;
}
