import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto';

/**
 * Bộ lọc dashboard cảnh báo gian lận (AF-21).
 *
 * ⚠ Field không khai ở đây sẽ bị ValidationPipe (`whitelist: true`) loại bỏ —
 * bộ lọc sẽ âm thầm mất tác dụng thay vì báo lỗi.
 */
export class FraudFlagQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  severity?: string;

  @ApiPropertyOptional({ example: 'MOCK_LOCATION' })
  @IsOptional()
  @IsString()
  code?: string;

  /**
   * Kiểu `string` chứ không phải `boolean`, cố ý.
   *
   * Boolean trong query string có ba trạng thái chứ không phải hai: `'true'`,
   * `'false'`, và KHÔNG GỬI. Ép sang boolean thì "không gửi" và "gửi false"
   * nhập làm một, mất khả năng phân biệt giữa "lấy tất cả" và "chỉ lấy cờ đã xử
   * lý". Giữ nguyên chuỗi rồi để service tự hiểu `undefined` là không lọc.
   */
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: '`false` = chỉ lấy cờ CHƯA xử lý (truy vấn nóng nhất của dashboard)',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  reviewed?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  to?: string;
}

/**
 * Quyết định của con người trên một cờ nghi vấn.
 *
 * Hệ thống chỉ ĐÁNH DẤU nghi vấn, không bao giờ tự huỷ công. Mọi tín hiệu gian
 * lận đều có tỷ lệ báo nhầm: GPS trong nhà xưởng lệch vài trăm mét, điểm khuôn
 * mặt tụt vì đeo khẩu trang, thiết bị "root" thật ra là máy dev. Tự động cắt
 * công dựa trên tín hiệu như vậy sẽ trừ lương oan người làm thật.
 */
export class ReviewFlagDto {
  @ApiProperty({
    enum: ['KEEP', 'VOID', 'ESCALATE'],
    description:
      'KEEP = giữ công, VOID = huỷ công (tạo bản ghi điều chỉnh + tính lại), ESCALATE = chuyển Admin hệ thống',
  })
  @IsIn(['KEEP', 'VOID', 'ESCALATE'])
  decision!: 'KEEP' | 'VOID' | 'ESCALATE';

  @ApiProperty({
    minLength: 10,
    description:
      'Bắt buộc. Nếu huỷ công, lý do này ĐƯỢC HIỂN THỊ CHO NHÂN VIÊN — huỷ công âm thầm là nguồn tranh chấp lao động.',
  })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}
