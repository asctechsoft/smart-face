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
    options: { requireLiveness: boolean; livenessAction?: LivenessAction; correlationId?: string },
  ) {
    return this.call<AiEnrollResponse>(
      '/v1/enroll',
      {
        image_base64: image.toString('base64'),
        require_liveness: options.requireLiveness,
        liveness_action: options.livenessAction ?? null,
      },
      options.correlationId,
    );
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
    options: { requireLiveness: boolean; livenessAction?: LivenessAction; correlationId?: string },
  ) {
    return this.call<AiVerifyResponse>(
      '/v1/verify',
      {
        image_base64: image.toString('base64'),
        embeddings,
        require_liveness: options.requireLiveness,
        liveness_action: options.livenessAction ?? null,
      },
      options.correlationId,
    );
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
    options: {
      topK?: number;
      requireLiveness?: boolean;
      livenessAction?: LivenessAction;
      correlationId?: string;
    } = {},
  ) {
    const target =
      'candidates' in scope
        ? { candidates: scope.candidates }
        : { scope_ids: scope.scopeIds, namespace: scope.namespace };

    return this.call<AiIdentifyResponse>(
      '/v1/identify',
      {
        image_base64: image.toString('base64'),
        ...target,
        top_k: options.topK ?? 5,
        require_liveness: options.requireLiveness ?? false,
        liveness_action: options.livenessAction ?? null,
      },
      options.correlationId,
    );
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

  private async call<T>(
    path: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<T> {
    this.assertCircuitAllowsCall();

    try {
      const { data } = await this.http.post<T>(path, payload, {
        // NFR-AUD-02 — nối được dòng log của AI Server với bản ghi chấm công đã
        // sinh ra nó. Không có header này thì cách duy nhất để ghép hai bên là
        // đoán theo mốc thời gian, và mốc thời gian trùng nhau hàng loạt vào
        // giờ cao điểm.
        headers: correlationId ? { 'X-Correlation-Id': correlationId } : undefined,
      });
      this.onSuccess();
      return data;
    } catch (error) {
      if (isAxiosError(error)) {
        const status = error.response?.status;

        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          this.onFailure();
          this.logger.warn(`AI Server timeout tại ${path}`);
          throw new AppException('SYS_AI_TIMEOUT');
        }

        // 4xx là LỖI CỦA LỜI GỌI, không phải AI Server hỏng.
        //
        // Trước đây mọi mã lỗi đều gọi `onFailure()`, nên một lỗi lập trình lặp
        // lại — chẳng hạn quên trường `namespace`, trả 422 — cũng mở được circuit
        // breaker và làm dừng chấm công của toàn bộ công ty. Thứ đáng lẽ là một
        // dòng lỗi trong log lại thành sự cố diện rộng.
        //
        // 401 vẫn tính là hỏng: sai `X-Internal-Key` nghĩa là cấu hình sai, và
        // mọi lượt gọi sau đều sẽ hỏng y hệt — mở circuit là đúng.
        const isCallerError =
          status !== undefined && status >= 400 && status < 500 && status !== 401;
        if (!isCallerError) {
          this.onFailure();
        }

        const code = this.extractErrorCode(error.response?.data);
        this.logger.error(
          `AI Server lỗi tại ${path}: ${status ?? ''} ${code ?? ''} ${error.message}`,
        );

        if (isCallerError) {
          throw new AppException('SYS_AI_BAD_REQUEST', { aiErrorCode: code, status });
        }
      } else {
        this.onFailure();
        this.logger.error(`AI Server lỗi không xác định tại ${path}: ${(error as Error).message}`);
      }
      throw new AppException('SYS_AI_UNAVAILABLE');
    }
  }

  /** Đọc `detail.code` trong envelope lỗi mới của AI Server; cũ thì trả null. */
  private extractErrorCode(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const detail = (data as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object' && 'code' in detail) {
      const code = (detail as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
    return null;
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
