import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * docs/08-hop-dong-api.md mục 1.5 — phân trang, lọc, sắp xếp.
 *
 * Kế thừa DTO này cho mọi endpoint trả danh sách, đừng tự khai lại `page`/
 * `pageSize`: chỉ cần một chỗ quên chặn trần là client gọi `pageSize=1000000`
 * và kéo sập database.
 */
export class PaginationQueryDto {
  // `@Type(() => Number)` là BẮT BUỘC: query string luôn tới dưới dạng chuỗi,
  // không ép kiểu thì `@IsInt()` luôn trượt và mọi request đều bị 400.
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Tối đa 100. Vượt quá sẽ bị ép về 100.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  // Hai lớp chặn trần cùng lúc, cố ý:
  //   `@Max(100)`    — từ chối thẳng, báo lỗi rõ ràng cho người gọi API.
  //   `@Transform`   — ép về 100 thay vì để lọt.
  // Thừa một lớp, nhưng chi phí của việc để lọt là một truy vấn quét toàn bảng.
  // `Number(value) || 20` cũng xử lý luôn `pageSize=abc` và `pageSize=0`.
  @Transform(({ value }) => Math.min(Number(value) || 20, 100))
  pageSize = 20;

  @ApiPropertyOptional({
    description: 'Tiền tố `-` là giảm dần. Nhiều trường ngăn bằng dấu phẩy. VD: `-recordedAt`',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Từ khoá tìm kiếm tự do' })
  @IsOptional()
  @IsString()
  q?: string;

  /**
   * Đổi số trang (người dùng đếm từ 1) sang offset của Prisma (đếm từ 0).
   *
   * Đặt getter ngay trong DTO để phép trừ `- 1` chỉ tồn tại ở MỘT chỗ. Rải ra
   * từng service thì sớm muộn sẽ có nơi quên, gây lỗi lệch một trang — loại lỗi
   * âm thầm, dữ liệu vẫn trả về nên không ai phát hiện ngay.
   */
  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  /** Đặt tên theo Prisma để service truyền thẳng `{ skip, take }`. */
  get take(): number {
    return this.pageSize;
  }
}

/**
 * Bộ lọc khoảng ngày dùng chung cho chấm công / đơn từ / báo cáo.
 *
 * Để kiểu `string` chứ không phải `Date` một cách có chủ đích: `new Date('2026-08-01')`
 * trong JS hiểu là 00:00 giờ UTC, lệch 7 tiếng so với Việt Nam. Service phải tự
 * chuyển sang múi giờ của công ty (`Company.timezone`) rồi mới truy vấn — công ty
 * ở múi giờ khác thì ranh giới "ngày" khác nhau.
 */
export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'Ngày bắt đầu (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Ngày kết thúc (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  to?: string;
}
