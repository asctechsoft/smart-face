import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { IsDateString, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Audit, CurrentTenant, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import type { TenantContext } from 'src/common/types/request-context';
import { TenantService } from './tenant.service';

/**
 * Thông tin công ty hiện tại — dùng chung App và Web.
 *
 * Chỉ ĐỌC, và chỉ đọc công ty của chính mình (`ctx.companyId` từ JWT). Việc tạo,
 * sửa, khoá công ty nằm ở `/v1/system/tenants/*` dành cho SYSTEM_ADMIN.
 */
@ApiTags('Công ty')
@ApiBearerAuth()
@Controller('company')
export class CompanyController {
  constructor(private readonly tenants: TenantService) {}

  @Get('me')
  @ApiOperation({ summary: 'Thông tin công ty đang hoạt động' })
  @ApiErrors('TEN_NOT_FOUND')
  async me(@CurrentTenant() ctx: TenantContext) {
    const company = await this.tenants.getTenant(ctx.companyId);
    // Chọn tay từng trường thay vì trả nguyên bản ghi từ database. Bản ghi
    // `Company` còn chứa thông tin hợp đồng, hạn thanh toán, ghi chú nội bộ —
    // trả trọn gói là mọi nhân viên đọc được. Thêm cột mới vào bảng cũng không
    // vô tình rò rỉ ra ngoài, vì phải khai tường minh ở đây mới xuất hiện.
    return {
      id: company.id,
      code: company.code,
      name: company.name,
      timezone: company.timezone,
      status: company.status,
      // `features` là bản đồ tính năng theo gói. Client dùng nó để ẩn/hiện menu,
      // nhưng đó chỉ là trải nghiệm — chốt thật nằm ở guard phía server. Client
      // sửa cờ này trong bộ nhớ vẫn không gọi được API ngoài gói.
      plan: company.plan
        ? { name: company.plan.name, features: company.plan.features }
        : null,
    };
  }
}
