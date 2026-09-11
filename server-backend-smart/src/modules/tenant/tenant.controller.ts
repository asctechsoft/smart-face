import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsTimeZone, Length, Matches } from 'class-validator';
import { Audit, CurrentTenant } from 'src/common/decorators';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import type { TenantContext } from 'src/common/types/request-context';
import { TenantService } from './tenant.service';

/**
 * Thong tin cong ty do tenant tu khai (buoc 1 wizard, mockup `69:254`).
 *
 * Mockup con co "ten viet tat", "logo cong ty" va "so dien thoai cong ty" —
 * ba truong nay CHUA co cot trong `Company`. Khong khai o day de tranh mot
 * form nhan du lieu roi vut di. Them chung can mot migration, va migration
 * `v21_foundation` hien chua chay tren DB — chong them mot cai nua len tren
 * la lam kho ca hai.
 */
class UpdateCompanyProfileDto {
  @ApiPropertyOptional({ example: 'Công ty TNHH Amobilab' })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @ApiPropertyOptional({
    example: 'amobilab.com',
    description: 'Tên miền nhân viên gõ ở màn đăng nhập. Phải duy nhất toàn hệ thống.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  // Chan khoang trang va ky tu la ngay o tang DTO: mot ten mien co dau cach se
  // qua duoc rang buoc duy nhat cua database nhung khong ai go dung duoc no.
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, {
    message: 'Tên miền chỉ gồm chữ thường, số, dấu gạch ngang và dấu chấm',
  })
  domain?: string;

  @ApiPropertyOptional({ example: '0101234567' })
  @IsOptional()
  @IsString()
  @Length(0, 20)
  taxCode?: string;

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh' })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

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
      plan: company.plan ? { name: company.plan.name, features: company.plan.features } : null,
    };
  }

  /*
   * Tach khoi `GET me` co chu dich.
   *
   * `me` la endpoint MOI nhan vien goi duoc — no chi tra nhung gi mot nguoi
   * cham cong can biet. Ma so thue va ten mien la du lieu quan tri; de chung
   * o `me` la moi nguoi trong cong ty deu doc duoc chung ma khong ai chu y.
   */
  @Get('profile')
  @RequirePermission('org.update')
  @ApiOperation({ summary: 'Thông tin công ty ở dạng sửa được (cho form thiết lập)' })
  @ApiErrors('TEN_NOT_FOUND')
  profile(@CurrentTenant() ctx: TenantContext) {
    return this.tenants.getCompanyProfile(ctx.companyId);
  }

  @Put('profile')
  @RequirePermission('org.update')
  @Audit({ action: 'COMPANY_PROFILE_UPDATE', targetType: 'COMPANY' })
  @ApiOperation({
    summary: 'Sửa thông tin công ty của chính mình',
    description:
      'Mã công ty (`code`) BẤT BIẾN vì nó nằm trong mọi mã nhân viên đã sinh (BR-04). Trạng thái và gói dịch vụ thuộc tầng nền tảng, không sửa được từ đây.',
  })
  @ApiErrors('TEN_NOT_FOUND', 'TEN_DOMAIN_TAKEN')
  updateProfile(@CurrentTenant() ctx: TenantContext, @Body() dto: UpdateCompanyProfileDto) {
    return this.tenants.updateCompanyProfile(ctx, dto);
  }
}
