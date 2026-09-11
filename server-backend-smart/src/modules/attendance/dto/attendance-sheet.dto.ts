import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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

  /**
   * Chỉ một người.
   *
   * Khác `q` ở chỗ nó CHÍNH XÁC. `q` khớp theo `contains` nên mã "NV001" còn
   * kéo về cả "NV0011" — dùng nó để mở màn chi tiết của một người là mở ra một
   * bảng có hai người trong đó.
   */
  @ApiPropertyOptional({ description: 'Chỉ lấy đúng một nhân viên' })
  @IsOptional()
  @IsString()
  employeeId?: string;

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

/**
 * Tham số đọc BẢNG TỔNG HỢP công của một THÁNG — mỗi dòng một người.
 *
 * Trục là tháng, không phải từng bảng chấm công: một tháng chia thành nhiều
 * bảng theo nhóm phòng ban, nhưng người rà công hỏi "tháng 5 còn ai chưa xong",
 * không hỏi "bảng tháng 5 của Kho vận còn ai chưa xong".
 *
 * KHÔNG có `from`/`to`: tổng hợp là con số của cả tháng. Cho cắt khoảng ngày ở
 * đây nghĩa là in ra một bảng ghi "Công thực tế 12,5" trong khi tháng chưa hết
 * — con số đó đúng về mặt số học nhưng sẽ bị đọc là số liệu chốt lương, và
 * không có gì trên bảng nói rằng nó chỉ là một lát cắt.
 */
export class AttendanceMonthSummaryQueryDto {
  /**
   * Tháng cần xem. Bỏ trống = tháng hiện tại.
   *
   * Nhận ngày bất kỳ trong tháng và tự chuẩn hoá về ngày 01 — kỳ của bảng luôn
   * neo ở đó, nên "2026-08-17" phải tìm ra bảng của tháng 8 chứ không ra rỗng.
   */
  @ApiPropertyOptional({ description: 'YYYY-MM-DD, tự chuẩn hoá về ngày 01. Bỏ trống = tháng này' })
  @IsOptional()
  @IsDateString()
  month?: string;

  @ApiPropertyOptional({ description: 'Lọc theo chi nhánh làm việc của CBNV' })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo phòng ban. MANAGER bị ScopeGuard thu hẹp thêm.' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  /**
   * Chỉ một người.
   *
   * Khác `q` ở chỗ nó CHÍNH XÁC. `q` khớp theo `contains` nên mã "NV001" còn
   * kéo về cả "NV0011" — dùng nó để mở màn chi tiết của một người là mở ra một
   * bảng có hai người trong đó.
   */
  @ApiPropertyOptional({ description: 'Chỉ lấy đúng một nhân viên' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã nhân viên' })
  @IsOptional()
  @IsString()
  q?: string;

  /**
   * Chỉ những người còn ít nhất một ngày phải rà.
   *
   * Là bộ lọc DÒNG, không đụng tới hàng thẻ chỉ số: cảnh báo "24 nhân viên cần
   * đối soát" và danh sách 24 người đó phải đếm cùng một tập, nên con số trên
   * thẻ vẫn nói về cả kỳ kể cả khi bảng bên dưới đang lọc.
   */
  @ApiPropertyOptional({ description: 'Chỉ hiện người còn ngày cần đối soát' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  needsReviewOnly?: boolean;

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
