import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import {
  Audit,
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
  Roles,
  SkipTenant,
} from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import type { RequestContext, TenantContext } from 'src/common/types/request-context';
import { CompanySetupService } from './company-setup.service';
import { ProvisioningService, SETUP_STEPS, type SetupStep } from './provisioning.service';

class BootstrapDto {
  @ApiProperty({ example: 'Nguyễn Văn An' })
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @ApiProperty({ example: 'admin@smartface.vn' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @Length(9, 15)
  phone!: string;

  @ApiProperty({ description: 'Tối thiểu 8 ký tự, có hoa, thường, số và ký tự đặc biệt' })
  @IsString()
  @Length(8, 128)
  password!: string;
}

class TenantCompanyDto {
  @ApiProperty({ example: 'Công ty TNHH Amobilab' })
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiProperty({ example: 'amobilab', description: 'BẤT BIẾN — đi vào mã nhân viên (BR-04)' })
  @IsString()
  @Length(2, 30)
  code!: string;

  @ApiProperty({ example: 'amobilab.com', description: 'Tên miền nhân viên gõ khi đăng nhập' })
  @IsString()
  @Length(2, 100)
  domain!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'PLUS', description: 'Bỏ trống = gói mặc định' })
  @IsOptional()
  @IsString()
  planCode?: string;
}

class TenantDirectorDto {
  @ApiProperty({ example: 'Nguyễn Văn An' })
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @ApiProperty({ example: 'nguyenvanan@amobilab.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @Length(9, 15)
  phone!: string;
}

class ProvisionTenantDto {
  @ApiProperty({ type: TenantCompanyDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TenantCompanyDto)
  company!: TenantCompanyDto;

  @ApiProperty({ type: TenantDirectorDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TenantDirectorDto)
  director!: TenantDirectorDto;
}

class SetupStepDto {
  @ApiProperty({ enum: SETUP_STEPS })
  @IsIn(SETUP_STEPS as unknown as string[])
  step!: SetupStep;
}

/**
 * Khởi tạo nền tảng và khởi tạo tenant (docs/07 · docs/19).
 *
 * Ba nhóm endpoint ở ba tầng quyền khác nhau, cố ý gom vào một controller vì
 * chúng là ba mắt xích liên tiếp của cùng một câu chuyện và đọc rời từng mảnh
 * thì không thấy được thứ tự:
 *
 * | Nhóm                | Ai gọi              | Guard                        |
 * |---------------------|---------------------|------------------------------|
 * | `platform/bootstrap`| Chưa có ai          | `@Public` + điều kiện "bảng rỗng" |
 * | `system/tenants/*`  | Quản trị nền tảng   | `tenant.manage`              |
 * | `company/setup/*`   | Tổng giám đốc tenant| `setup.run`                  |
 */
@ApiTags('Khởi tạo nền tảng & tenant')
@Controller()
export class ProvisioningController {
  constructor(
    private readonly provisioning: ProvisioningService,
    private readonly setup: CompanySetupService,
  ) {}

  // ===========================================================================
  //  Khởi tạo nền tảng
  // ===========================================================================

  @Post('platform/bootstrap')
  @Public()
  @SkipTenant()
  @HttpCode(HttpStatus.CREATED)
  // Giới hạn rất chặt: endpoint này chỉ được gọi thành công đúng một lần trong
  // đời hệ thống, nên mọi lượt gọi sau đều là gõ nhầm hoặc dò tìm.
  @RateLimit({ bucket: 'platform-bootstrap', limit: 5, windowSeconds: 3600, by: 'ip' })
  @ApiOperation({
    summary: 'Tạo tài khoản Quản trị nền tảng đầu tiên',
    description:
      'CHỈ chạy được khi hệ thống chưa có tài khoản nền tảng nào. Sau đó luôn trả `PLATFORM_ALREADY_BOOTSTRAPPED`. Phải chạy ngay trong quy trình triển khai, trước khi mở cổng ra Internet (docs/22).',
  })
  @ApiErrors('PLATFORM_ALREADY_BOOTSTRAPPED', 'AUTH_PASSWORD_TOO_WEAK', 'SYS_RATE_LIMITED')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.provisioning.bootstrapPlatform(dto);
  }

  // ===========================================================================
  //  Khởi tạo tenant
  // ===========================================================================

  @Post('system/tenants/provision')
  @Roles(SystemRole.SYSTEM_ADMIN)
  @RequirePermission('tenant.manage')
  @SkipTenant()
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'TENANT_PROVISION', targetType: 'COMPANY' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tạo công ty kèm tài khoản Tổng giám đốc',
    description:
      'Một giao dịch duy nhất: công ty + tài khoản TGĐ + Owner + trạng thái wizard. Trả `temporaryPassword` ĐÚNG MỘT LẦN — không đọc lại được, mất thì phải dùng luồng đặt lại mật khẩu.',
  })
  @ApiErrors('TEN_CODE_TAKEN', 'TEN_DOMAIN_TAKEN', 'PLAN_NOT_FOUND', 'RBAC_PERMISSION_DENIED')
  provisionTenant(@CurrentUser() ctx: RequestContext, @Body() dto: ProvisionTenantDto) {
    return this.provisioning.provisionTenant(ctx, dto);
  }

  // ===========================================================================
  //  Wizard thiết lập ban đầu của tenant
  // ===========================================================================

  @Get('company/setup')
  @RequirePermission('setup.run')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tiến độ wizard thiết lập ban đầu (5 bước)',
    description: 'Trả cả `nextStep` để màn hình tô sáng đúng thẻ đang cần làm.',
  })
  getSetup(@CurrentTenant() ctx: TenantContext) {
    return this.setup.getState(ctx.companyId);
  }

  @Post('company/setup/complete')
  @RequirePermission('setup.run')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đánh dấu một bước thiết lập đã xong',
    description:
      'Bốn bước đầu làm được lệch thứ tự. Riêng `handover` đòi bốn bước kia xong trước — không có gì để bàn giao nếu chưa có phòng ban, ca làm việc và người nhận.',
  })
  @ApiErrors('SETUP_STEP_INCOMPLETE', 'RBAC_PERMISSION_DENIED')
  completeSetupStep(@CurrentTenant() ctx: TenantContext, @Body() dto: SetupStepDto) {
    return this.setup.completeStep(ctx, dto.step);
  }

  @Post('company/setup/reopen/:step')
  @RequirePermission('setup.run')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mở lại một bước đã đánh dấu xong' })
  reopenSetupStep(@CurrentTenant() ctx: TenantContext, @Param('step') step: SetupStep) {
    return this.setup.reopenStep(ctx, step);
  }
}
