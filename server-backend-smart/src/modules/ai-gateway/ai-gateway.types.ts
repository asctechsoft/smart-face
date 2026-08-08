/**
 * Hợp đồng với AI Server — docs/08-hop-dong-api.md mục 8.
 *
 * ⚠ NGUYÊN TẮC P3: AI Server chỉ trả SỐ LIỆU, KHÔNG ra quyết định nghiệp vụ.
 * Backend so số liệu này với ngưỡng cấu hình theo từng công ty rồi tự quyết định.
 * Nếu thấy AI Server trả về `accepted: true` — đó là lỗi thiết kế cần sửa ngay.
 */

export interface AiImageQuality {
  blur: number;
  brightness: number;
  yaw?: number;
  pitch?: number;
  face_px: number;
}

export interface AiLiveness {
  score: number;
  /** Đã thực hiện đúng hành động mà server yêu cầu chưa (AF-05) */
  action_verified?: boolean;
}

export interface AiEnrollResponse {
  face_found: boolean;
  error_code?: string;
  quality?: AiImageQuality;
  liveness?: AiLiveness;
  /** Vector 512 chiều đã L2-normalize */
  embedding?: number[];
  model_version?: string;
  processing_ms: number;
}

export interface AiVerifyResponse {
  face_found: boolean;
  error_code?: string;
  quality?: AiImageQuality;
  liveness?: AiLiveness;
  match?: {
    best_score: number;
    scores: number[];
  };
  model_version?: string;
  processing_ms: number;
}

export interface AiIdentifyResponse {
  face_found: boolean;
  error_code?: string;
  liveness?: AiLiveness;
  matches?: Array<{ employee_id: string; score: number }>;
  /**
   * Khoảng cách top1 − top2. QUAN TRỌNG với 1:N — điểm cao nhưng margin nhỏ
   * nghĩa là hai người giống nhau, KHÔNG được tin.
   */
  margin?: number;
  processing_ms: number;
}

export interface AiHealthResponse {
  status: string;
  model?: { name: string; version: string; loaded_at: string };
  gpu?: { available: boolean; utilization: number; memory_used_mb: number };
  uptime_seconds?: number;
}

/** Hành động liveness do SERVER chọn ngẫu nhiên mỗi lần (AF-05). */
export const LIVENESS_ACTIONS = ['BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'SMILE', 'NOD'] as const;
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
