import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RedisService } from 'src/infra/redis/redis.service';
import { AuthRepository } from 'src/modules/auth/auth.repository';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { AppException } from '../errors';
import { SIGNATURE_REQUIRED_KEY } from '../decorators/public.decorator';
import { computeRequestSignature, safeCompare, sha256, sha256Buffer } from '../utils/crypto.util';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * AF-12 — ký số request + timestamp + nonce dùng một lần.
 *
 * Thứ tự kiểm tra (docs/06-anti-fraud.md mục 4.2):
 *   1. |serverTime - timestamp| ≤ 120s   → ngoài ngưỡng: 400 FRAUD_CLOCK_SKEW
 *   2. nonce chưa từng dùng (SET NX EX)  → đã tồn tại: 409 FRAUD_REPLAY_DETECTED
 *   3. Chữ ký khớp deviceSecret          → sai: 401 AUTH_SIGNATURE_INVALID
 *
 * Bật/tắt bằng `ATTENDANCE_SIGNATURE_REQUIRED`. Khi tắt (giai đoạn App chưa
 * triển khai ký), guard chỉ kiểm tra nonce nếu client có gửi — vẫn giữ được
 * lớp chống replay cơ bản.
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  private readonly logger = new Logger(SignatureGuard.name);
  private skipWarned = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly devices: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(SIGNATURE_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const enforced = this.config.get<boolean>('attendance.signatureRequired', false);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const signature = request.headers['x-signature'] as string | undefined;
    const nonce = request.headers['x-nonce'] as string | undefined;
    const timestamp = request.headers['x-timestamp'] as string | undefined;

    // Giữ nguyên dạng `!a || !b || !c` để TypeScript thu hẹp được kiểu sau khối
    // này — viết thành đếm số phần tử thì cả ba biến vẫn là `string | undefined`.
    if (!signature || !nonce || !timestamp) {
      if (enforced) {
        throw new AppException('AUTH_SIGNATURE_INVALID', { reason: 'Thiếu header ký request' });
      }

      // Gửi MỘT PHẦN bộ header ký luôn là lỗi, kể cả khi chưa bật cưỡng chế.
      // Client thật thì gửi đủ cả ba hoặc không gửi gì; gửi lưng chừng là bug
      // của client hoặc là đang dò xem server có kiểm tra thật hay không.
      if (signature || nonce || timestamp) {
        throw new AppException('AUTH_SIGNATURE_INVALID', {
          reason: 'Phải gửi đủ cả X-Signature, X-Nonce và X-Timestamp, hoặc không gửi header nào.',
        });
      }

      this.warnOnce();
      return true;
    }

    // --- 1. Lệch giờ ---------------------------------------------------------
    const tolerance = this.config.get<number>('attendance.requestTimestampToleranceSeconds', 120);
    const clientSeconds = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(clientSeconds)) {
      throw new AppException('FRAUD_CLOCK_SKEW', { reason: 'X-Timestamp không hợp lệ' });
    }
    const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - clientSeconds);
    if (skewSeconds > tolerance) {
      throw new AppException('FRAUD_CLOCK_SKEW', { skewSeconds, toleranceSeconds: tolerance });
    }

    // --- 2. Nonce dùng một lần ----------------------------------------------
    const fresh = await this.redis.consumeOnce(RedisKeys.signatureNonce(nonce), 300);
    if (!fresh) {
      throw new AppException('FRAUD_REPLAY_DETECTED', { nonce });
    }

    // --- 3. Chữ ký -----------------------------------------------------------
    const ctx = request.ctx;
    if (!ctx?.deviceId) {
      throw new AppException('AUTH_SIGNATURE_INVALID', { reason: 'Token không gắn thiết bị' });
    }

    const device = await this.devices.findDeviceSignatureKey(ctx.userId, ctx.deviceId);
    if (!device || !device.isActive || device.revokedAt) {
      throw new AppException('FRAUD_UNKNOWN_DEVICE');
    }

    const bodyHash = this.resolveBodyHash(request, enforced);
    // deviceSecretHash là sha256(deviceSecret) — App ký bằng deviceSecret gốc,
    // nên server phải suy ra cùng khoá. Ở đây khoá HMAC dùng chính hash đã lưu:
    // App được cấp `deviceSecret`, server lưu `sha256(deviceSecret)`, và App ký
    // bằng `sha256(deviceSecret)` — xem AuthService.issueDeviceSecret().
    const expected = computeRequestSignature({
      method: request.method,
      path: request.originalUrl.split('?')[0],
      bodyHash,
      nonce,
      timestamp,
      deviceSecret: device.deviceSecretHash,
    });

    if (!safeCompare(expected, signature)) {
      throw new AppException('AUTH_SIGNATURE_INVALID');
    }

    return true;
  }

  /**
   * Lấy `bodyHash` để dựng lại chữ ký.
   *
   * Hai đường, tuỳ theo server có giữ được body thô hay không:
   *
   * - **JSON** — `main.ts` giữ bản sao thô qua `json({verify})`. Băm trực tiếp,
   *   không tin gì từ client. Đây là đường đáng tin nhất, luôn ưu tiên.
   *
   * - **multipart** — multer đọc thẳng từ luồng, không còn byte gốc. Client khai
   *   báo hash qua `X-Body-Sha256`, và `VerifyBodyHashInterceptor` chạy sau khi
   *   parse xong sẽ đối chiếu hash đó với nội dung thật.
   *
   * Chuỗi tin cậy của nhánh multipart cần CẢ HAI mắt xích:
   *
   *   chữ ký      → chứng minh client có `deviceSecret` và đã cam kết hash H
   *   interceptor → chứng minh body thật đúng là băm ra H
   *   ⇒ body xác thực
   *
   * Thiếu interceptor thì client tự khai hash bừa rồi ký lên chính cái hash bừa
   * đó — chữ ký vẫn hợp lệ mà chẳng ràng buộc gì. Đừng bao giờ tách rời hai mắt
   * xích này.
   */
  private resolveBodyHash(request: AuthenticatedRequest, enforced: boolean): string {
    if (request.rawBody) {
      return sha256Buffer(request.rawBody);
    }

    const declared = request.headers['x-body-sha256'] as string | undefined;
    if (declared) {
      return declared;
    }

    if (enforced) {
      throw new AppException('AUTH_SIGNATURE_INVALID', {
        reason: 'Request multipart phải kèm X-Body-Sha256 để chữ ký ràng buộc được nội dung ảnh.',
      });
    }

    // Chưa cưỡng chế: giữ hành vi cũ để App chưa cập nhật vẫn chạy được ở dev.
    return sha256('');
  }

  /**
   * Cảnh báo một lần cho mỗi lần chạy tiến trình, không phải mỗi request.
   *
   * Cảnh báo mỗi request sẽ ngập log và bị lọc bỏ — đúng lúc nó cần được đọc
   * thì không ai thấy nữa. `validateEnv` đã chặn cứng ở production, dòng này chỉ
   * để người phát triển biết mình đang chạy không có lớp chữ ký.
   */
  private warnOnce(): void {
    if (this.skipWarned) return;
    this.skipWarned = true;
    this.logger.warn(
      'AF-12 ĐANG TẮT — bỏ qua kiểm tra chữ ký request vì ATTENDANCE_SIGNATURE_REQUIRED=false. ' +
        'Chỉ chấp nhận ở môi trường phát triển.',
    );
  }
}
