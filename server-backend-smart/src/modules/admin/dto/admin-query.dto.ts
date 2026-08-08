import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CompanyStatus } from '@prisma/client';
import { PaginationQueryDto } from 'src/common/dto';

/**
 * Bộ lọc cho Web Admin (`/v1/system/*`) — quản trị NỀN TẢNG, không phải một công ty.
 *
 * ⚠ Khác mọi DTO query khác trong dự án: các endpoint dùng những DTO này cố ý
 * VƯỢT QUA ranh giới tenant. Chúng chỉ dành cho SYSTEM_ADMIN và phải được
 * `@SkipTenant()` một cách tường minh. Đừng tái sử dụng ở controller nghiệp vụ.
 */

/** Danh sách công ty đang có trên nền tảng. */
export class TenantQueryDto extends PaginationQueryDto {
  // Lọc theo trạng thái để tách công ty đang hoạt động khỏi công ty đã tạm ngưng
  // (hết hạn hợp đồng, nợ phí) — hai nhóm cần cách chăm sóc khác nhau.
  @ApiPropertyOptional({ enum: CompanyStatus })
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;
}

/** Tra cứu tài khoản người dùng xuyên công ty — dùng khi hỗ trợ khách hàng. */
export class SystemUserQueryDto extends PaginationQueryDto {
  /**
   * ⚠ Đây là trường hợp DUY NHẤT trong hệ thống mà `companyId` được nhận từ
   * client. Mọi nơi khác đều lấy từ JWT (BR-09).
   *
   * Chấp nhận được vì endpoint đã bị khoá cứng cho SYSTEM_ADMIN — người vốn đã
   * có quyền xem mọi công ty, nên tham số này chỉ để LỌC cho gọn kết quả, không
   * phải để mở thêm quyền. Bỏ trống = tìm trên toàn nền tảng.
   */
  @ApiPropertyOptional({ description: 'Lọc theo công ty cụ thể' })
  @IsOptional()
  @IsString()
  companyId?: string;
}
