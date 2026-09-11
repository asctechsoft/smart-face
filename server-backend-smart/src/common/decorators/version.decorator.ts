import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/request-context';

export const REQUIRE_VERSION_KEY = 'requireVersion';

export interface RequireVersionOptions {
  /**
   * `true` = thiếu `If-Match` thì từ chối.
   *
   * Mặc định `false` cho các endpoint đã có client cũ đang gọi: bật cứng ngay
   * sẽ làm hỏng mọi client chưa gửi header. Bật `true` cho endpoint mới và cho
   * endpoint đã chuyển đổi xong.
   */
  required?: boolean;
}

/**
 * Kiểm tra phiên bản bản ghi trước khi ghi đè (`BR-13` kiểm #5).
 *
 * Client đọc bản ghi, thấy `rowVersion: 7`, rồi gửi lại `If-Match: 7` khi sửa.
 * Nếu trong lúc đó có người khác đã ghi, `rowVersion` đã thành 8 và lượt ghi này
 * bị từ chối với `VERSION_CONFLICT` thay vì âm thầm xoá mất thay đổi của họ.
 *
 * Vì sao dùng `If-Match` chứ không phải một trường trong body: đây đúng là ngữ
 * nghĩa HTTP sẵn có cho ghi có điều kiện, và đặt ở header thì mọi endpoint dùng
 * chung một chỗ đọc thay vì mỗi DTO tự khai một trường tên khác nhau.
 */
export const RequireVersion = (options: RequireVersionOptions = {}) =>
  SetMetadata(REQUIRE_VERSION_KEY, options);

/**
 * Phiên bản client kỳ vọng, đã được `VersionGuard` bóc ra từ `If-Match`.
 *
 * `undefined` nghĩa là client không gửi — service tự quyết định ghi mù hay từ
 * chối, tuỳ `required` trong `@RequireVersion`.
 */
export const IfMatch = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.expectedVersion;
});
