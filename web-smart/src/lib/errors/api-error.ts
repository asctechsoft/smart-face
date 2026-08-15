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

/**
 * Không có thân lỗi nào để đọc — hoặc chưa từng có phản hồi, hoặc phản hồi không
 * đúng định dạng.
 *
 * **Vì sao phải tách `TIMEOUT` khỏi `UNREACHABLE`.** Cả hai đều rơi vào cùng một
 * nhánh của axios (`!error.response`) nên rất dễ gộp làm một, nhưng hệ quả với
 * người dùng ngược nhau:
 *
 *   `UNREACHABLE` — chưa gửi được đi. Chắc chắn KHÔNG có gì xảy ra ở máy chủ.
 *   `TIMEOUT`     — đã gửi đi, chỉ là câu trả lời về không kịp. Máy chủ RẤT CÓ
 *                   THỂ đã làm xong việc đó rồi.
 *
 * Gộp lại thì người dùng bị bảo "kiểm tra đường truyền" trong khi thao tác của
 * họ đã thành công — đây đúng là chuyện xảy ra ở màn đăng nhập: Backend tạo
 * phiên xong, Web hết giờ chờ trước khi phản hồi về, và báo mất kết nối.
 */
export type NetworkFailureKind = 'UNREACHABLE' | 'TIMEOUT' | 'BAD_RESPONSE';

const NETWORK_MESSAGES: Record<NetworkFailureKind, string> = {
  UNREACHABLE: 'Không kết nối được tới máy chủ',
  TIMEOUT: 'Máy chủ không trả lời kịp',
  BAD_RESPONSE: 'Máy chủ trả về phản hồi không đọc được',
};

export class NetworkError extends Error {
  readonly code = 'NET_UNREACHABLE';
  readonly kind: NetworkFailureKind;

  constructor(kind: NetworkFailureKind = 'UNREACHABLE') {
    super(NETWORK_MESSAGES[kind]);
    this.name = 'NetworkError';
    this.kind = kind;
  }
}

/**
 * Lỗi đã dịch sang ngôn ngữ người dùng.
 *
 * Ba trường, mỗi trường trả lời một câu hỏi:
 *
 *   `title`    — chuyện gì vừa xảy ra (ngắn, không dấu chấm cuối)
 *   `body`     — giờ phải làm gì
 *   `canRetry` — bấm lại có ích không
 *
 * `canRetry` quan trọng hơn vẻ ngoài của nó: một nút "Thử lại" trên lỗi 403 hay
 * 404 là lời mời người dùng làm một việc chắc chắn thất bại, và họ sẽ bấm — vài
 * lần — trước khi đi tìm người hỗ trợ. Backend đã gửi sẵn cờ `retryable` cho
 * đúng mục đích này, việc của client chỉ là đọc nó.
 */
export interface UserFacingError {
  title: string;
  body?: string;
  canRetry: boolean;
  /** Hiện dưới dạng chú thích nhỏ để người dùng chụp màn hình gửi hỗ trợ. */
  traceId?: string;
}

/**
 * Diễn giải lại theo NGỮ CẢNH WEB QUẢN LÝ.
 *
 * Thông điệp gốc trong `error-catalog.ts` viết chung cho cả App di động lẫn Web.
 * Cùng một mã lỗi nhưng hành động tiếp theo của hai bên khác nhau: nhân viên
 * trên App thì "liên hệ HR", còn HR ngồi trên Web thì chính họ là người xử lý.
 *
 * Chỉ liệt kê mã mà Web THẬT SỰ gặp. Mã không có ở đây rơi về nhánh phân loại
 * theo HTTP status bên dưới — vẫn ra câu đọc được, không bao giờ ra chuỗi rỗng.
 */
const WEB_OVERRIDES: Record<string, Omit<UserFacingError, 'canRetry'> & { canRetry?: boolean }> = {
  // --- Quyền & phiên ---------------------------------------------------------
  AUTH_DOMAIN_MISMATCH: {
    title: 'Tên miền công ty không khớp với tài khoản',
    body: 'Kiểm tra lại tên miền được cấp, hoặc hỏi bộ phận nhân sự.',
  },
  AUTH_ACCOUNT_NOT_PROVISIONED: {
    title: 'Tài khoản chưa được cấp quyền vào hệ thống',
    body: 'Liên hệ bộ phận nhân sự của công ty để được cấp hồ sơ.',
  },
  AUTH_FORBIDDEN: {
    title: 'Bạn không có quyền làm việc này',
    body: 'Liên hệ Admin công ty nếu bạn cho rằng đây là nhầm lẫn.',
  },

  // --- Kỳ lương đã khoá ------------------------------------------------------
  ATT_PERIOD_LOCKED: {
    title: 'Ngày này thuộc kỳ lương đã chốt',
    body: 'Mở lại kỳ ở màn Kỳ lương (có ghi lý do) rồi hiệu chỉnh.',
  },
  PAY_PERIOD_CLOSED: {
    title: 'Kỳ lương đã chốt nên không sửa được',
    body: 'Mở lại kỳ kèm lý do, xử lý xong thì chốt lại.',
  },
  REQ_PERIOD_LOCKED: {
    title: 'Đơn nằm trong kỳ lương đã chốt',
    body: 'Mở lại kỳ trước, rồi duyệt đơn để bảng công được tính lại.',
  },

  // --- Đơn từ ----------------------------------------------------------------
  REQ_CANNOT_APPROVE_OWN: {
    title: 'Không duyệt được đơn của chính mình',
    body: 'Chuyển đơn này cho người duyệt khác trong luồng.',
  },
  REQ_NOT_YOUR_TURN: {
    title: 'Chưa tới lượt bạn duyệt',
    body: 'Đơn còn đang chờ cấp trước xử lý.',
  },
  REQ_FLOW_INVALID: {
    title: 'Luồng duyệt chưa hợp lệ',
    body: 'Cần ít nhất một cấp bắt buộc, thứ tự các cấp liên tục từ 1 và không trùng nhau.',
  },
  REQ_TYPE_CODE_TAKEN: {
    title: 'Mã loại đơn đã tồn tại',
    body: 'Đổi mã khác, hoặc sửa loại đơn đang có thay vì tạo mới.',
  },

  // --- Công làm bù -----------------------------------------------------------
  MKUP_EXCEEDS_DEBT: {
    title: 'Số phút làm bù vượt quá số còn nợ',
    body: 'Phần dôi ra là tăng ca — ghi ở đơn tăng ca để hưởng đúng hệ số lương.',
  },
  MKUP_OVERDUE: {
    title: 'Khoản nợ này đã quá hạn làm bù',
    body: 'Gia hạn khoản nợ trước, rồi mới ghi nhận được giờ bù.',
  },
  MKUP_ALREADY_CLOSED: {
    title: 'Khoản nợ đã đóng',
    body: 'Khoản đã bù đủ hoặc đã ghi nhận giờ thì không sửa được nữa.',
  },

  // --- Nhân sự & chính sách --------------------------------------------------
  EMP_CODE_LOCKED: {
    title: 'Mã nhân viên đã bị khoá',
    body: 'Mã khoá sau lần chấm công đầu tiên vì nó đã nằm trong các bản ghi đã ghi.',
  },
  EMP_DELETE_NOT_ALLOWED: {
    title: 'Không xoá được hồ sơ đã kích hoạt',
    body: 'Dùng Tạm ngưng hoặc Chấm dứt hợp đồng để giữ lại bản ghi chấm công.',
  },
  POL_LEAVE_BELOW_STATUTORY: {
    title: 'Số ngày phép thấp hơn mức luật định',
    body: 'Bộ luật Lao động 2019 quy định tối thiểu 12 ngày/năm với điều kiện làm việc bình thường.',
  },
  POL_VIOLATES_LABOR_LAW: {
    title: 'Cấu hình vi phạm quy định lao động',
    body: 'Hệ số OT tối thiểu: ngày thường 150%, ngày nghỉ tuần 200%, ngày lễ 300%.',
  },

  // --- Hệ thống --------------------------------------------------------------
  SYS_RATE_LIMITED: {
    title: 'Bạn thao tác quá nhanh',
    body: 'Chờ khoảng một phút rồi thử lại.',
    canRetry: true,
  },
  /**
   * 404 TRƠN, không kèm mã cụ thể nào — nghĩa là đường dẫn không tồn tại trên
   * máy chủ, chứ không phải "bản ghi bạn tìm đã bị xoá".
   *
   * Câu gốc "Không tìm thấy tài nguyên yêu cầu" là câu của lập trình viên: người
   * dùng không có khái niệm "tài nguyên", và không có gì để họ làm với nó. Thực
   * tế nó xuất hiện khi máy chủ chạy bản cũ chưa có chức năng vừa triển khai.
   */
  SYS_NOT_FOUND: {
    title: 'Chức năng này chưa sẵn sàng',
    body: 'Máy chủ chưa mở chức năng vừa yêu cầu. Liên hệ quản trị hệ thống của công ty.',
  },
  SYS_MAINTENANCE: {
    title: 'Hệ thống đang bảo trì',
    body: 'Thử lại sau ít phút.',
    canRetry: true,
  },
};

/**
 * Nhánh dự phòng theo HTTP status.
 *
 * Chạy khi mã lỗi không có trong `WEB_OVERRIDES`. Giữ nguyên câu của Backend làm
 * tiêu đề — với lỗi nghiệp vụ (409/422) thì câu đó đã đúng và cụ thể hơn bất kỳ
 * câu chung nào ta viết được ở đây.
 */
function fromStatus(error: ApiError): UserFacingError {
  const base = { traceId: error.traceId };

  if (error.httpStatus >= 500) {
    return {
      ...base,
      title: 'Máy chủ đang gặp sự cố',
      body: 'Thử lại sau ít phút. Nếu vẫn lỗi, gửi mã truy vết bên dưới cho bộ phận hỗ trợ.',
      canRetry: true,
    };
  }

  if (error.httpStatus === 403) {
    return {
      ...base,
      title: 'Bạn không có quyền làm việc này',
      body: 'Liên hệ Admin công ty nếu bạn cho rằng đây là nhầm lẫn.',
      canRetry: false,
    };
  }

  // Lỗi nghiệp vụ: câu Backend là tiêu đề, `hint` xuống dòng làm hướng dẫn.
  // KHÔNG nối hai câu thành một dòng dài — toast và hộp lỗi đều có chỗ cho thân.
  return {
    ...base,
    title: error.message,
    body: error.hint,
    // Tin cờ của Backend: nó biết lỗi nào lặp lại thì hết, lỗi nào thì không.
    canRetry: error.retryable,
  };
}

/** Dịch bất kỳ thứ gì bắt được sang câu người dùng đọc được. */
export function toUserError(error: unknown): UserFacingError {
  if (error instanceof ApiError) {
    const override = WEB_OVERRIDES[error.code];
    if (override) {
      return {
        ...override,
        traceId: error.traceId,
        canRetry: override.canRetry ?? false,
      };
    }
    return fromStatus(error);
  }

  if (error instanceof NetworkError) {
    if (error.kind === 'TIMEOUT') {
      return {
        title: 'Máy chủ phản hồi quá chậm',
        // KHÔNG mời thử lại ngay: yêu cầu có thể đã chạy xong ở máy chủ, làm lại
        // lần nữa là tạo bản ghi thứ hai.
        body: 'Yêu cầu vừa rồi có thể đã được xử lý xong. Tải lại trang để xem kết quả trước khi làm lại.',
        canRetry: true,
      };
    }

    return {
      title: 'Không kết nối được máy chủ',
      body: 'Kiểm tra đường truyền rồi thử lại.',
      canRetry: true,
    };
  }

  // Lỗi lập trình lọt tới đây (TypeError, lỗi trong callback...). Người dùng
  // không sửa được gì, nên chỉ nói ngắn gọn và mời thử lại.
  return {
    title: 'Đã có lỗi xảy ra',
    body: 'Thử lại thao tác vừa rồi. Nếu vẫn lỗi, tải lại trang.',
    canRetry: true,
  };
}

/**
 * Gộp thành một dòng — chỉ dùng ở chỗ KHÔNG có chỗ cho hai dòng, như `<Alert>`
 * một dòng của form đăng nhập.
 *
 * Mọi nơi khác dùng `toUserError()` để giữ tiêu đề và hướng dẫn tách bạch.
 */
export function toUserMessage(error: unknown): string {
  const { title, body } = toUserError(error);
  return body ? `${title}. ${body}` : title;
}
