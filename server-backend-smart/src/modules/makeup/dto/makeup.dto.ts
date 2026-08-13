import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto';

/** Trạng thái một khoản nợ công — khớp chuỗi lưu ở `MakeupWorkRecord.status`. */
export const MAKEUP_STATUSES = ['OPEN', 'PARTIAL', 'COMPLETED', 'EXPIRED'] as const;

export class MakeupQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MAKEUP_STATUSES })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'MANAGER bị ScopeGuard thu hẹp thêm theo phạm vi được giao.',
  })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: '2026-08-01', description: 'Lọc theo NGÀY PHÁT SINH NỢ' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/**
 * Ghi nhận một khoản nợ công — docs/04 mục 5.1.
 *
 * Nợ công thường do engine tính công sinh ra (đi muộn + về sớm luỹ kế), nhưng
 * vẫn cần đường tạo tay: thoả thuận riêng giữa quản lý và nhân viên, hoặc dữ
 * liệu chuyển từ hệ thống cũ sang lúc mới triển khai.
 */
export class CreateMakeupDebtDto {
  @ApiProperty()
  @IsString()
  employeeId!: string;

  @ApiProperty({ example: '2026-08-05', description: 'Ngày phát sinh nợ công' })
  @IsDateString()
  debtWorkDate!: string;

  @ApiProperty({ example: 200, description: 'Số phút còn thiếu so với ca' })
  @IsInt()
  @Min(1)
  debtMinutes!: number;

  /**
   * Bỏ trống thì service tự tính từ `makeup.dueDays` của công ty.
   *
   * Hạn làm bù không phải thủ tục: quá hạn mà vẫn cho bù nghĩa là nhân viên gom
   * nợ nửa năm rồi bù một lần vào tháng cuối, và bảng công của sáu tháng trước
   * đó đều sai so với thực tế đã chốt.
   */
  @ApiPropertyOptional({ example: '2026-09-04' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ description: 'BR-08: ghi vào audit log', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

/**
 * Ghi nhận một lần làm bù.
 *
 * `makeupWorkDate` là NGÀY LÀM BÙ THẬT, không phải ngày bấm nút: engine tính
 * công cộng số phút này vào đúng ngày đó (`sumMakeupMinutes`). Ghi sai ngày là
 * cộng giờ công vào một ngày nhân viên không đi làm.
 */
export class RecordMakeupDto {
  @ApiProperty({ example: '2026-08-12' })
  @IsDateString()
  makeupWorkDate!: string;

  @ApiProperty({ example: 120, description: 'Số phút làm bù trong ngày đó' })
  @IsInt()
  @Min(1)
  minutes!: number;

  @ApiPropertyOptional({ description: 'Đơn làm bù tương ứng, nếu có' })
  @IsOptional()
  @IsString()
  requestId?: string;
}

export class ExtendMakeupDto {
  @ApiProperty({ example: '2026-09-30', description: 'Hạn làm bù mới' })
  @IsDateString()
  dueDate!: string;

  @ApiProperty({ description: 'BR-08: gia hạn là ngoại lệ, phải giải thích được', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class CancelMakeupDto {
  @ApiProperty({ description: 'BR-08: bắt buộc, tối thiểu 10 ký tự', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}
