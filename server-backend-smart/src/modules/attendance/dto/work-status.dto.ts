import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { WORK_STATES } from '../work-status.rules';

/**
 * Tham số đọc lưới theo dõi công việc của MỘT ngày.
 *
 * Không có `from`/`to`: màn này trả lời "hôm nay ai đang làm gì", và một khoảng
 * nhiều ngày không có câu trả lời cho câu hỏi đó — muốn xem cả kỳ thì đó chính
 * là bảng chấm công.
 */
export class WorkStatusQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-18',
    description: 'Ngày cần xem. Bỏ trống = hôm nay theo múi giờ công ty.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Lọc theo phòng ban. MANAGER bị ScopeGuard thu hẹp thêm.' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã nhân viên' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: WORK_STATES,
    description:
      'Chỉ lấy CBNV đang ở trạng thái này. Phần TỔNG vẫn tính trên toàn bộ phạm vi, không theo bộ lọc này — nếu không thì bấm vào một ô thống kê sẽ làm chính ô đó đổi số.',
  })
  @IsOptional()
  @IsIn(WORK_STATES)
  state?: (typeof WORK_STATES)[number];

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

/**
 * Nhắc CBNV chưa chấm công.
 *
 * `employeeIds` tường minh chứ không phải "gửi cho tất cả ai đang LATE_NOT_ARRIVED":
 * danh sách đó đổi theo từng giây, và người bấm nút phải chịu trách nhiệm về
 * đúng những cái tên họ nhìn thấy lúc bấm — không phải về một truy vấn chạy lại
 * ở server nửa giây sau đó với kết quả khác.
 */
export class RemindWorkStatusDto {
  @ApiProperty({ type: [String], description: 'CBNV nhận nhắc nhở. Tối đa 200 người mỗi lượt.' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  employeeIds!: string[];

  @ApiPropertyOptional({
    example: '2026-08-18',
    description: 'Ngày làm việc được nhắc. Bỏ trống = hôm nay.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Lời nhắn thêm. Bỏ trống = dùng nội dung mặc định.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  message?: string;
}

/** Xuất trạng thái làm việc của một ngày ra Excel. */
export class ExportWorkStatusDto {
  @ApiPropertyOptional({ example: '2026-08-18', description: 'Bỏ trống = hôm nay' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Phòng ban cần xuất. Bỏ trống = toàn bộ phạm vi người yêu cầu được phép xem.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentIds?: string[];
}
