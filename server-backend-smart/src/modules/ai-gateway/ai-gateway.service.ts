import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { randomInt } from 'node:crypto';
import { AppException, ErrorCode } from 'src/common/errors';
import {
  AI_ERROR_MAP,
  AiEnrollResponse,
  AiHealthResponse,
  AiIdentifyCandidate,
  AiIdentifyResponse,
  AiVerifyResponse,
  LIVENESS_ACTIONS,
  LivenessAction,
} from './ai-gateway.types';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Client giao tiếp AI Server (ADR-01).
 *
 * - AI Server KHÔNG expose ra internet, xác thực bằng `X-Internal-Key`.
 * - Circuit breaker theo docs/09 mục 4.1: lỗi liên tiếp → OPEN 30s → HALF_OPEN.
 * - Khi OPEN, trả ngay `SYS_AI_UNAVAILABLE` để App gợi ý dùng vân tay (NFR-REL-10),
 *   không để request treo chờ timeout.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly http: AxiosInstance;

  private circuitState: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>('ai.baseUrl'),
      timeout: this.config.get<number>('ai.timeoutMs', 2000),
      headers: { 'X-Internal-Key': this.config.get<string>('ai.internalKey', '') },
      maxBodyLength: 20 * 1024 * 1024,
      maxContentLength: 20 * 1024 * 1024,
    });
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  /** Trích embedding từ ảnh đăng ký, kèm kiểm tra chất lượng + liveness. */
  async enroll(
    image: Buffer,
    options: { requireLiveness: boolean; livenessAction?: LivenessAction },
  ) {
    return this.call<AiEnrollResponse>('/v1/enroll', {
      image_base64: image.toString('base64'),
      require_liveness: options.requireLiveness,
      liveness_action: options.livenessAction ?? null,
    });
  }

  /**
   * So khớp 1:1 — dùng cho chấm công qua App (đã đăng nhập nên biết là ai).
   *
   * `embeddings` là các embedding đã đăng ký của ĐÚNG nhân viên đó.
   * AI Server trả `best_score`, Backend tự so ngưỡng — AI Server KHÔNG biết ngưỡng.
   */
  async verify(
    image: Buffer,
    embeddings: number[][],
    options: { requireLiveness: boolean; livenessAction?: LivenessAction },
  ) {
    return this.call<AiVerifyResponse>('/v1/verify', {
      image_base64: image.toString('base64'),
      embeddings,
      require_liveness: options.requireLiveness,
      liveness_action: options.livenessAction ?? null,
    });
  }

  /**
   * So khớp 1:N — dùng cho kiosk (giai đoạn sau) và kiểm tra trùng danh tính (BR-10).
   *
   * ⚠ Với 1:N, ngoài ngưỡng điểm còn PHẢI kiểm tra `margin` đủ lớn.
   *
   * Hai cách chỉ định tập ứng viên, chọn đúng một:
   *
   * - `candidates` — gửi thẳng embedding lên. Dùng được ngay, không cần đồng bộ
   *   gì. Phù hợp khi tập nhỏ (kiểm tra trùng danh tính trong một công ty).
   * - `scopeIds` + `namespace` — dùng chỉ mục nạp sẵn trong RAM của AI Server qua
   *   `/v1/index/*`. Dành cho kiosk khi tập lớn, không muốn đẩy hàng nghìn vector
   *   qua mạng mỗi lượt.
   *
   * ⚠ `namespace` BẮT BUỘC khi dùng `scopeIds`, và phải là `companyId` (ADR-05).
   * Thiếu nó, AI Server từ chối ngay ở tầng validate (422) chứ không âm thầm tìm
   * xuyên công ty — nhân viên công ty A bị nhận diện thành người của công ty B là
   * dạng rò rỉ dữ liệu chéo khách hàng nghiêm trọng nhất.
   */
  async identify(
    image: Buffer,
    scope: { candidates: AiIdentifyCandidate[] } | { scopeIds: string[]; namespace: string },
    options: { topK?: number; requireLiveness?: boolean; livenessAction?: LivenessAction } = {},
  ) {
    const target =
      'candidates' in scope
        ? { candidates: scope.candidates }
        : { scope_ids: scope.scopeIds, namespace: scope.namespace };

    return this.call<AiIdentifyResponse>('/v1/identify', {
      image_base64: image.toString('base64'),
      ...target,
      top_k: options.topK ?? 5,
      require_liveness: options.requireLiveness ?? false,
      liveness_action: options.livenessAction ?? null,
    });
  }

  async health(): Promise<AiHealthResponse | null> {
    try {
      const { data } = await this.http.get<AiHealthResponse>('/health', { timeout: 3000 });
      return data;
    } catch {
      return null;
    }
  }

  /** FR-ADM-AI-03 — chỉ số Prometheus của AI Server cho dashboard giám sát. */
  async metrics(): Promise<string | null> {
    try {
      const { data } = await this.http.get<string>('/metrics', { timeout: 3000 });
      return data;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Tiện ích cho tầng nghiệp vụ
  // ---------------------------------------------------------------------------

  /**
   * AF-05 — hành động liveness do SERVER chọn ngẫu nhiên mỗi lần.
   *
   * ⚠ App KHÔNG được tự chọn: nếu App tự quyết, kẻ tấn công patch app để luôn
   * chọn hành động đã quay sẵn video.
   */
  randomLivenessAction(): LivenessAction {
    return LIVENESS_ACTIONS[randomInt(LIVENESS_ACTIONS.length)];
  }

  /**
   * Ánh xạ error_code của AI Server sang AppException của Backend.
   *
   * Nhận cả `null` vì Pydantic serialize trường trống thành `null`, không bỏ trường.
   */
  toAppException(
    errorCode: string | null | undefined,
    details?: Record<string, unknown>,
  ): AppException {
    const mapped = (errorCode && AI_ERROR_MAP[errorCode]) || 'FACE_NOT_FOUND';
    return new AppException(mapped as ErrorCode, details);
  }

  get circuitBreakerState(): CircuitState {
    return this.circuitState;
  }

  // ---------------------------------------------------------------------------
  // Circuit breaker
  // ---------------------------------------------------------------------------

  private async call<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    this.assertCircuitAllowsCall();

    try {
      const { data } = await this.http.post<T>(path, payload);
      this.onSuccess();
      return data;
    } catch (error) {
      this.onFailure();

      if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          this.logger.warn(`AI Server timeout tại ${path}`);
          throw new AppException('SYS_AI_TIMEOUT');
        }
        this.logger.error(
          `AI Server lỗi tại ${path}: ${error.response?.status ?? ''} ${error.message}`,
        );
      } else {
        this.logger.error(`AI Server lỗi không xác định tại ${path}: ${(error as Error).message}`);
      }
      throw new AppException('SYS_AI_UNAVAILABLE');
    }
  }

  private assertCircuitAllowsCall(): void {
    if (this.circuitState === 'CLOSED') return;

    const openMs = this.config.get<number>('ai.circuitOpenMs', 30_000);
    if (this.circuitState === 'OPEN') {
      if (Date.now() - this.openedAt < openMs) {
        throw new AppException('SYS_AI_UNAVAILABLE', { circuitState: 'OPEN' });
      }
      // Hết thời gian chờ → thử một request thăm dò.
      this.circuitState = 'HALF_OPEN';
      this.logger.log('Circuit breaker AI Server: OPEN → HALF_OPEN');
    }
  }

  private onSuccess(): void {
    if (this.circuitState !== 'CLOSED') {
      this.logger.log(`Circuit breaker AI Server: ${this.circuitState} → CLOSED`);
    }
    this.circuitState = 'CLOSED';
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    const threshold = this.config.get<number>('ai.circuitFailureThreshold', 5);

    if (this.circuitState === 'HALF_OPEN' || this.consecutiveFailures >= threshold) {
      this.circuitState = 'OPEN';
      this.openedAt = Date.now();
      this.logger.error(
        `Circuit breaker AI Server chuyển sang OPEN sau ${this.consecutiveFailures} lỗi liên tiếp`,
      );
    }
  }
}
