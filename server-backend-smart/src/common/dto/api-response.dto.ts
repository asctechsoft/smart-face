import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** docs/08-hop-dong-api.md mục 1.3 */
export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 156 })
  total!: number;

  @ApiProperty({ example: 8 })
  totalPages!: number;
}

/**
 * Thân lỗi chuẩn — App và Web đều dựa vào hình dạng này.
 *
 * Thiết kế để client KHÔNG BAO GIỜ phải so khớp chuỗi thông báo. So chuỗi thì
 * sửa một dấu phẩy trong `message` là logic client hỏng, còn `code` thì ổn định.
 */
export class ApiErrorBodyDto {
  // NGUỒN SỰ THẬT cho client. Xem toàn bộ danh sách ở error-catalog.ts, hoặc gọi
  // `GET /v1/meta/error-codes` để lấy động.
  @ApiProperty({ example: 'FACE_LIVENESS_FAILED' })
  code!: string;

  @ApiProperty({ example: 'Không xác nhận được người thật. Vui lòng thử lại.' })
  message!: string;

  // Kèm sẵn bản tiếng Anh để App đa ngôn ngữ không phải tự dịch lại toàn bộ
  // bảng mã lỗi, và hai bên không bị lệch nghĩa.
  @ApiProperty({ example: 'Liveness check failed. Please try again.' })
  messageEn!: string;

  // `message` nói CHUYỆN GÌ xảy ra, `hint` nói NÊN LÀM GÌ tiếp theo.
  @ApiPropertyOptional({ example: 'Đảm bảo đủ ánh sáng và không dùng ảnh/video' })
  hint?: string;

  // Cho client biết thử lại có ích không. `false` (vd: sai định dạng dữ liệu) mà
  // vẫn thử lại thì chỉ tạo tải vô ích và làm người dùng bực thêm.
  @ApiProperty({ example: true })
  retryable!: boolean;

  // Số liệu để hiển thị/chẩn đoán. ⚠ Không đặt thông tin nhạy cảm vào đây —
  // toàn bộ trường này đi thẳng ra client.
  @ApiPropertyOptional({ example: { livenessScore: 0.42, threshold: 0.7 } })
  details?: Record<string, unknown>;

  // ULID để nối phản hồi lỗi với dòng log phía server. Người dùng chụp màn hình
  // gửi mã này là tra được đúng request, không phải mò theo mốc thời gian.
  @ApiProperty({ example: '01J8XK2M9P4R7T' })
  traceId!: string;
}

export class ApiErrorDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;
}

/**
 * Bọc dữ liệu trả về — `TransformInterceptor` tự động sinh.
 *
 * Controller cứ trả dữ liệu trần, interceptor bọc thành `{ success, data, meta }`.
 * Đừng tự bọc trong controller: sẽ thành `data.data` lồng hai lớp.
 *
 * `success` là kiểu literal `true` (không phải `boolean`) để TypeScript phía
 * client thu hẹp kiểu được: kiểm tra `if (res.success)` là biết chắc có `data`.
 */
export class ApiOkDto<T> {
  @ApiProperty({ example: true })
  success!: true;

  data!: T;

  @ApiPropertyOptional({ type: PaginationMetaDto })
  meta?: PaginationMetaDto;
}

/**
 * Service trả về kiểu này khi muốn kèm `meta` phân trang.
 *
 * `TransformInterceptor` nhận diện kiểu này và tách `items` ra `data`, `meta` ra
 * `meta`. Nhờ vậy service không cần biết gì về hình dạng phản hồi HTTP — cùng
 * một service dùng lại được cho job chạy nền, nơi không có HTTP nào cả.
 */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMetaDto,
  ) {}
}
