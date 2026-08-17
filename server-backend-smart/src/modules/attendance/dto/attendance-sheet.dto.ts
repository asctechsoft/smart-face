import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Tham số LẬP bảng chấm công — FR-WEB-ATT-08.
 *
 * Chỉ có kỳ và phòng ban: THÀNH VIÊN không khai ở đây mà lấy từ bảng phân ca
 * của đúng tháng đó và đúng những phòng ban đó. Bảng chấm công phải phủ đúng
 * tập người mà lịch ca đã phủ, nếu không thì cuối tháng có người có ca mà không
 * có ai rà công cho họ.
 *
 * Không có bảng phân ca nào khớp thì lấy toàn bộ CBNV đang làm việc của các
 * phòng ban đã chọn — công vẫn phát sinh theo ca mặc định của công ty, nên bỏ
 * trắng những người đó là bỏ sót công thật.
 */
export class CreateAttendanceSheetDto {
  @ApiProperty({
    type: [String],
    description: 'Phòng ban áp dụng — lấy cả CBNV của các phòng ban cấp dưới',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  departmentIds!: string[];

  /**
   * Kỳ của bảng. Nhận ngày bất kỳ trong tháng, service chuẩn hoá về ngày 01 —
   * client gửi `2026-08-15` hay `2026-08-01` đều ra cùng một kỳ.
   */
  @ApiProperty({ example: '2026-08-01', description: 'Tháng lập bảng chấm công' })
  @IsDateString()
  periodMonth!: string;

  @ApiPropertyOptional({
    example: 'Bảng chấm công Tháng 08/2026',
    description: 'Bỏ trống = tự sinh theo kỳ',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;
}

export class AttendanceSheetQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'Lọc theo tháng của bảng' })
  @IsOptional()
  @IsDateString()
  month?: string;

  @ApiPropertyOptional({ description: 'Bảng có áp dụng cho phòng ban này' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

/** Thêm / bớt CBNV khỏi bảng đã lập. */
export class AttendanceSheetMemberDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  employeeIds!: string[];
}

/**
 * Tham số đọc lưới người × ngày của một bảng chấm công.
 *
 * Phân trang theo NGƯỜI, không theo bản ghi công: bảng đọc theo dòng, cắt trang
 * giữa chừng một người sẽ tách công của họ thành hai dòng rời ở hai trang.
 */
export class AttendanceSheetBoardQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Bỏ trống = ngày đầu kỳ của bảng',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Bỏ trống = ngày cuối kỳ của bảng' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Lọc theo phòng ban. MANAGER bị ScopeGuard thu hẹp thêm.' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã nhân viên' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
