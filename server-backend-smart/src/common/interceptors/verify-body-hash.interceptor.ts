import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { AppException } from '../errors';
import { computeMultipartBodyHash, safeCompare } from '../utils/crypto.util';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * AF-12 — mắt xích thứ hai của chữ ký cho request `multipart/form-data`.
 *
 * `SignatureGuard` chỉ chứng minh được: client có `deviceSecret` và đã cam kết
 * body của mình băm ra giá trị H (khai trong `X-Body-Sha256`). Nó KHÔNG kiểm
 * được body thật có đúng băm ra H hay không — lúc guard chạy, multer chưa parse.
 *
 * Interceptor này chạy NGAY SAU `FileInterceptor` và khép vòng lại:
 *
 * ```
 * SignatureGuard  → client có deviceSecret, cam kết hash H
 * Interceptor này → body thật đúng là băm ra H
 * ⇒ nội dung ảnh và các trường form đều xác thực
 * ```
 *
 * Thiếu nó thì client tự khai một hash bừa rồi ký lên chính cái hash bừa đó,
 * chữ ký vẫn hợp lệ mà chẳng ràng buộc nội dung gì.
 *
 * ## Cách gắn — THỨ TỰ QUAN TRỌNG
 *
 * ```ts
 * @UseInterceptors(
 *   FileInterceptor('image', { limits: { fileSize: MAX } }),
 *   VerifyBodyHashInterceptor,     // ← PHẢI đứng sau
 * )
 * ```
 *
 * NestJS gọi interceptor theo đúng thứ tự khai báo; `FileInterceptor` chờ multer
 * xong rồi mới gọi mắt xích kế tiếp. Đặt ngược lại thì `request.file` còn rỗng
 * và mọi request đều bị từ chối.
 */
@Injectable()
export class VerifyBodyHashInterceptor implements NestInterceptor {
  private readonly logger = new Logger(VerifyBodyHashInterceptor.name);

  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const declared = request.headers['x-body-sha256'] as string | undefined;
    const enforced = this.config.get<boolean>('attendance.signatureRequired', false);

    if (!declared) {
      if (enforced) {
        throw new AppException('AUTH_SIGNATURE_INVALID', {
          reason: 'Thiếu X-Body-Sha256 — chữ ký không ràng buộc được nội dung ảnh.',
        });
      }
      return next.handle();
    }

    // `request.body` sau khi multer parse chỉ còn các trường văn bản; file nằm
    // riêng ở `request.file`. Băm cả hai để kẻ chặn được request không tráo được
    // ảnh lẫn không sửa được toạ độ GPS.
    const file = (request as AuthenticatedRequest & { file?: { buffer?: Buffer } }).file;
    const actual = computeMultipartBodyHash(
      file?.buffer,
      (request.body ?? {}) as Record<string, unknown>,
    );

    if (!safeCompare(actual, declared)) {
      // KHÔNG log giá trị hash của ảnh (NFR-OBS-08) — nó là dấu vân của một tấm
      // ảnh khuôn mặt cụ thể, đủ để đối chiếu người này với người kia.
      this.logger.warn(
        `X-Body-Sha256 không khớp nội dung thật tại ${request.method} ${request.originalUrl}`,
      );
      throw new AppException('AUTH_SIGNATURE_INVALID', {
        reason: 'Nội dung request không khớp giá trị đã ký. Ảnh hoặc dữ liệu đã bị thay đổi.',
      });
    }

    return next.handle();
  }
}
