/**
 * Hợp đồng với AI Server — docs/08-hop-dong-api.md mục 8.
 *
 * ⚠ NGUYÊN TẮC P3: AI Server chỉ trả SỐ LIỆU, KHÔNG ra quyết định nghiệp vụ.
 * Backend so số liệu này với ngưỡng cấu hình theo từng công ty rồi tự quyết định.
 * Nếu thấy AI Server trả về `accepted: true` — đó là lỗi thiết kế cần sửa ngay.
 *
 * ⚠ Vì sao nhiều trường là `| null` chứ không chỉ `?`. AI Server viết bằng
 * Pydantic: trường không có giá trị được serialize thành `null` trong JSON, KHÔNG
 * phải bị bỏ khỏi payload. `error_code?: string` nói rằng trường có thể vắng mặt —
 * sai với thực tế là nó luôn có mặt và mang giá trị `null`. Khai đúng để TypeScript
 * bắt được những chỗ quên xử lý `null`.
 */

export interface AiImageQuality {
  blur: number;
  brightness: number;
  /** Góc quay trái/phải, độ. `null` khi model không trả được tư thế đầu. */
  yaw?: number | null;
  /** Góc ngẩng/cúi, độ. `null` khi model không trả được tư thế đầu. */
  pitch?: number | null;
  face_px: number;
}

export interface AiLiveness {
  score: number;
  /**
   * Đã thực hiện đúng hành động mà server yêu cầu chưa (AF-05). BA trạng thái:
   *
   * - `true`  — đã đo được và người dùng làm ĐÚNG
   * - `false` — đã đo được và người dùng làm SAI
   * - `null`  — KHÔNG đo được. Phải coi như CHƯA xác minh, tuyệt đối không quy đổi
   *   thành `true`; đó là cách tự tay mở lỗ hổng chấm công hộ ở đúng chỗ đáng lẽ
   *   phải đóng nó lại.
   */
  action_verified?: boolean | null;
}

export interface AiEnrollResponse {
  face_found: boolean;
  error_code?: string | null;
  quality?: AiImageQuality | null;
  liveness?: AiLiveness | null;
  /** Vector 512 chiều đã L2-normalize */
  embedding?: number[] | null;
  model_version?: string | null;
  processing_ms: number;
}

export interface AiVerifyResponse {
  face_found: boolean;
  error_code?: string | null;
  quality?: AiImageQuality | null;
  liveness?: AiLiveness | null;
  match?: {
    best_score: number;
    scores: number[];
  } | null;
  model_version?: string | null;
  processing_ms: number;
}

/**
 * Một ứng viên trong bài toán 1:N, gửi kèm luôn embedding.
 *
 * Mỗi nhân viên có NHIỀU embedding (đăng ký nhiều góc mặt). Điểm của ứng viên là
 * điểm cao nhất trong các embedding của họ.
 */
export interface AiIdentifyCandidate {
  employee_id: string;
  embeddings: number[][];
}

export interface AiIdentifyResponse {
  face_found: boolean;
  error_code?: string | null;
  quality?: AiImageQuality | null;
  liveness?: AiLiveness | null;
  matches?: Array<{ employee_id: string; score: number }> | null;
  /**
   * Khoảng cách top1 − top2. QUAN TRỌNG với 1:N — điểm cao nhưng margin nhỏ
   * nghĩa là hai người giống nhau, KHÔNG được tin.
   *
   * `null` khi chỉ tìm thấy đúng một ứng viên — không có top2 để trừ.
   */
  margin?: number | null;
  model_version?: string | null;
  processing_ms: number;
}

export interface AiHealthResponse {
  /**
   * `starting` khác `degraded`: lúc mới bật, model nặng vài trăm MB chưa nạp xong.
   * `degraded` nghĩa là ĐANG CHẠY nhưng thiếu tuyến phòng thủ — cần cảnh báo.
   */
  status: 'healthy' | 'degraded' | 'starting';
  /** `stub` = engine giả, số liệu nhận diện không có ý nghĩa. */
  engine: string;
  model?: { name: string; version: string; loaded_at: string } | null;
  /**
   * Tên model chống giả mạo đang nạp. `none` hoặc `heuristic-fallback` nghĩa là
   * hệ thống đang chạy mà KHÔNG có tuyến phòng thủ chống chấm công hộ.
   *
   * Cùng với `engine`, đây là hai trường trả lời "vì sao `degraded`" — thiếu chúng
   * thì dashboard Web Admin chỉ thấy trạng thái xấu mà không biết nguyên nhân.
   */
  liveness_model: string;
  gpu?: { available: boolean; utilization: number; memory_used_mb: number } | null;
  uptime_seconds?: number;
}

/**
 * Hành động liveness do SERVER chọn ngẫu nhiên mỗi lần (AF-05).
 *
 * ⚠ `BLINK` đã bị loại khỏi danh sách này, dù AI Server vẫn nhận nó như một giá trị
 * hợp lệ. Lý do: hợp đồng hiện tại gửi lên MỘT ẢNH TĨNH, mà chớp mắt về bản chất là
 * chuyển động. Từ một khung hình, `verify_action_single_frame` chỉ trả lời được
 * "hai mắt có đang nhắm không" — nên người dùng chụp với mắt mở (tức là gần như mọi
 * người) sẽ nhận `action_verified: false` và bị từ chối oan.
 *
 * Bốn hành động còn lại xác minh được từ một khung hình: `TURN_LEFT`/`TURN_RIGHT`
 * và `NOD` đo trực tiếp từ tư thế đầu, `SMILE` đo từ tỷ lệ miệng.
 *
 * Cho `BLINK` quay lại khi App gửi được chuỗi khung hình — `verify_action_sequence`
 * phía AI Server đã viết sẵn và có test, chỉ còn chờ hợp đồng API mở rộng.
 */
export const LIVENESS_ACTIONS = ['TURN_LEFT', 'TURN_RIGHT', 'SMILE', 'NOD'] as const;
export type LivenessAction = (typeof LIVENESS_ACTIONS)[number];

/** Ánh xạ error_code của AI Server sang mã lỗi nghiệp vụ của Backend. */
export const AI_ERROR_MAP: Record<string, string> = {
  FACE_NOT_FOUND: 'FACE_NOT_FOUND',
  MULTIPLE_FACES: 'FACE_MULTIPLE',
  FACE_MULTIPLE: 'FACE_MULTIPLE',
  IMG_TOO_DARK: 'FACE_LOW_LIGHT',
  IMG_BACKLIT: 'FACE_BACKLIT',
  IMG_BLURRY: 'FACE_BLURRY',
  FACE_TOO_SMALL: 'FACE_TOO_SMALL',
  BAD_ANGLE: 'FACE_BAD_ANGLE',
  MASK_DETECTED: 'FACE_MASK_DETECTED',
  FACE_OCCLUDED: 'FACE_OCCLUDED',
  LIVENESS_FAILED: 'FACE_LIVENESS_FAILED',
};
