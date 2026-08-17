import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Vai trò duyệt hợp lệ — phải khớp `roleMatchesApprover` trong `request.service.ts`.
 *
 * Danh sách này KHÔNG mở rộng tự do được: `roleMatchesApprover` trả `false` cho
 * mọi giá trị lạ, nghĩa là cấu hình một vai trò không có ở đây sẽ tạo ra bước
 * duyệt mà KHÔNG AI xử lý được, và đơn treo vĩnh viễn. Chặn ngay ở DTO để lỗi
 * lộ ra lúc cấu hình chứ không phải lúc nhân viên gửi đơn.
 */
export const APPROVER_ROLES = [
  'DIRECT_MANAGER',
  'DEPARTMENT_HEAD',
  'HR_PAYROLL',
  'COMPANY_ADMIN',
] as const;

/** Trừ vào quỹ nào khi đơn được duyệt — khớp `RequestType.deductFrom`. */
export const DEDUCT_FROM = [
  'NONE',
  'ANNUAL_LEAVE',
  'UNPAID',
  'OT_CREDIT',
  'MAKEUP_CREDIT',
] as const;

export const REQUEST_UNITS = ['DAY', 'HALF_DAY', 'HOUR'] as const;

export class UpsertRequestTypeDto {
  /**
   * Mã dùng trong code và báo cáo, KHÔNG đổi được sau khi có đơn phát sinh.
   * Viết hoa gạch dưới để phân biệt rõ với `name` là nhãn hiển thị đổi tuỳ ý.
   */
  @ApiProperty({ example: 'ANNUAL_LEAVE' })
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Mã loại đơn viết hoa không dấu, dùng gạch dưới. VD: ANNUAL_LEAVE',
  })
  code!: string;

  @ApiProperty({ example: 'Xin nghỉ phép' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ enum: DEDUCT_FROM, default: 'NONE' })
  @IsOptional()
  @IsIn(DEDUCT_FROM)
  deductFrom?: string;

  /**
   * Trả lời câu hỏi KHÁC với `deductFrom`, nên là trường riêng.
   *
   * `deductFrom` nói trừ vào QUỸ nào; cờ này nói ngày nghỉ đó có vào BẢNG CÔNG
   * không. Suy cái này từ cái kia là sai cả hai chiều: `NONE` đang gộp "Công
   * tác" (đủ công) với "Xin ra ngoài" (không phải một ngày công).
   */
  @ApiPropertyOptional({
    description: 'Nghỉ theo đơn này có được tính công không (VD: phép năm, công tác)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPaidLeave?: boolean;

  @ApiPropertyOptional({ enum: REQUEST_UNITS, default: 'DAY' })
  @IsOptional()
  @IsIn(REQUEST_UNITS)
  unit?: string;

  @ApiPropertyOptional({ description: 'Bắt buộc có file minh chứng (VD: đơn nghỉ ốm)' })
  @IsOptional()
  @IsBoolean()
  requiresAttachment?: boolean;

  // OT không duyệt trước thì mọi giờ ở lại muộn đều thành chi phí ngoài dự toán.
  @ApiPropertyOptional({ description: 'Phải duyệt TRƯỚC khi phát sinh mới được tính' })
  @IsOptional()
  @IsBoolean()
  requiresPreApproval?: boolean;

  @ApiPropertyOptional({
    example: 5,
    description: 'Trần số ngày mỗi đơn. Bỏ trống = không giới hạn.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDaysPerRequest?: number;

  @ApiPropertyOptional({ default: true, description: 'Tắt = nhân viên không tạo đơn loại này nữa' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Một cấp duyệt — docs/04 mục 4.1.
 *
 * ```
 * Loại đơn: Xin nghỉ phép
 *   ├─ Cấp 1: Quản lý trực tiếp   [bắt buộc]
 *   └─ Cấp 2: HR                  [bắt buộc nếu > 3 ngày]  ← minDays = 3
 * ```
 */
export class ApprovalFlowStepDto {
  @ApiProperty({ example: 1, description: 'Thứ tự duyệt, đếm từ 1 và liên tục' })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty({ enum: APPROVER_ROLES, example: 'DIRECT_MANAGER' })
  @IsIn(APPROVER_ROLES)
  approverRole!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /**
   * Ngưỡng kích hoạt bước. Bỏ trống = luôn áp dụng.
   *
   * Khai riêng hai số thay vì nhận JSON tự do: `condition` được `stepApplies`
   * đọc bằng `minDays`/`maxDays`, khoá viết sai chính tả sẽ bị bỏ qua im lặng và
   * bước duyệt áp dụng cho MỌI đơn — sai theo hướng khó phát hiện nhất.
   */
  @ApiPropertyOptional({ example: 3, description: 'Chỉ áp dụng khi đơn từ N ngày trở lên' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minDays?: number;

  @ApiPropertyOptional({ description: 'Chỉ áp dụng khi đơn không quá N ngày' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxDays?: number;
}

export class ReplaceApprovalFlowDto {
  @ApiProperty({ type: [ApprovalFlowStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalFlowStepDto)
  steps!: ApprovalFlowStepDto[];
}
