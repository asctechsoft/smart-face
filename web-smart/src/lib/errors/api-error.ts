import type { ApiErrorBody } from '@/lib/api/types';

/**
 * Lỗi nghiệp vụ do Backend trả về, đã bóc khỏi vỏ HTTP.
 *
 * Toàn bộ tầng UI bắt lỗi bằng `code`, KHÔNG bao giờ so khớp `message`. Backend
 * sửa một dấu phẩy trong thông báo là logic client hỏng, còn `code` thì ổn định
 * (docs/08 mục 1.3).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly messageEn: string;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly traceId: string;
  readonly httpStatus: number;

  constructor(body: ApiErrorBody, httpStatus: number) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.messageEn = body.messageEn;
    this.hint = body.hint;
    this.retryable = body.retryable;
    this.details = body.details;
    this.traceId = body.traceId;
    this.httpStatus = httpStatus;
  }

  is(...codes: string[]): boolean {
    return codes.includes(this.code);
  }
}

/** Mất mạng, timeout, CORS — không có thân lỗi nào để đọc. */
export class NetworkError extends Error {
  readonly code = 'NET_UNREACHABLE';

  constructor(message = 'Không kết nối được tới máy chủ. Kiểm tra đường truyền rồi thử lại.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Thông điệp hiển thị cho người dùng cuối.
 *
 * docs/16 mục 14.2 điều 9: KHÔNG hiện mã lỗi kỹ thuật. `traceId` là ngoại lệ —
 * hiện dưới dạng chú thích nhỏ để người dùng chụp màn hình gửi bộ phận hỗ trợ.
 */
export function toDisplayMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.hint ? `${error.message} ${error.hint}` : error.message;
  }
  if (error instanceof NetworkError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

/**
 * Một vài mã lỗi cần diễn giải lại cho ngữ cảnh Web Quản lý.
 *
 * Thông báo gốc của Backend viết chung cho cả App lẫn Web; ở đây nói rõ hành
 * động tiếp theo mà người dùng Web thực sự làm được.
 */
const WEB_OVERRIDES: Record<string, string> = {
  AUTH_DOMAIN_MISMATCH:
    'Tên miền công ty không khớp với tài khoản này. Kiểm tra lại tên miền được cấp.',
  AUTH_ACCOUNT_NOT_PROVISIONED:
    'Tài khoản chưa được cấp quyền vào hệ thống. Liên hệ bộ phận nhân sự của công ty.',
  AUTH_FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  ATT_PERIOD_LOCKED:
    'Kỳ lương chứa ngày này đã chốt nên không sửa được. Mở lại kỳ trước khi hiệu chỉnh.',
  PAY_PERIOD_CLOSED: 'Kỳ lương đã chốt. Mở lại kỳ (kèm lý do) rồi thao tác tiếp.',
  SYS_RATE_LIMITED: 'Bạn thao tác quá nhanh. Chờ một lát rồi thử lại.',
};

export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError && WEB_OVERRIDES[error.code]) {
    return WEB_OVERRIDES[error.code] as string;
  }
  return toDisplayMessage(error);
}
