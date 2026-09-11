import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { ScopeLevel } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import {
  Audit,
  CurrentTenant,
  NoSelfApproval,
  RequirePermission,
  RequireStepUp,
} from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import type { TenantContext } from 'src/common/types/request-context';
import { ExecService } from './exec.service';

class DecisionDto {
  @ApiProperty({ description: 'Bắt buộc, tối thiểu 10 ký tự', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

class GrantOwnerDto {
  @ApiProperty()
  @IsString()
  employeeId!: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

class CreateDelegationDto {
  @ApiProperty({ description: 'Người nhận uỷ quyền' })
  @IsString()
  delegateId!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống = uỷ quyền mọi loại đơn' })
  @IsOptional()
  @IsString()
  requestTypeId?: string;

  @ApiProperty({ enum: ScopeLevel })
  @IsEnum(ScopeLevel)
  scopeLevel!: ScopeLevel;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  scopeIds?: string[];

  @ApiProperty({ example: '2026-09-10' })
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ example: '2026-09-20', description: 'BẮT BUỘC — uỷ quyền phải có ngày kết thúc' })
  @IsDateString()
  validTo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 1000)
  reason?: string;
}

/**
 * Phân hệ Giám đốc / Owner (docs/04 · docs/06 · docs/16 phụ lục C.2).
 *
 * ## Vì sao là một namespace riêng chứ không thêm route vào `/admin/*`
 *
 * `/admin/*` là không gian của Kế toán. Các thao tác ở đây là **vế còn lại** của
 * những thao tác bên đó: Kế toán gửi đề nghị chốt kỳ ở `/admin`, Giám đốc duyệt
 * ở `/exec`. Để chung một namespace thì ranh giới "người tính số không duyệt số
 * của chính mình" (docs/08 §1.1) chỉ còn được giữ bởi decorator, và một lần
 * copy-paste sai decorator là mất luôn. Tách namespace làm ranh giới đó nhìn
 * thấy được ngay trong đường dẫn.
 *
 * Mọi endpoint ở đây kiểm quyền qua `@RequirePermission`, KHÔNG qua `@Roles`:
 * Giám đốc chi nhánh là vai trò tuỳ biến của tenant, không có trong enum
 * `SystemRole` và sẽ không bao giờ có.
 */
@ApiTags('Web/App Giám đốc · Điều hành')
@ApiBearerAuth()
@Controller('exec')
export class ExecController {
  constructor(private readonly exec: ExecService) {}

  // ===========================================================================
  //  Kỳ công — vế duyệt
  // ===========================================================================

  @Post('periods/:id/approve-lock')
  @RequirePermission('period.approve_lock')
  @RequireStepUp('period.approve_lock')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_APPROVE_LOCK', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Duyệt chốt kỳ công (FR-WEB-PERIOD-09)',
    description:
      'Đóng dấu lên đúng version Kế toán đã gửi — KHÔNG tính lại. Kỳ chuyển sang `LOCKED` và dữ liệu trong kỳ trở thành bất biến (BR-07).',
  })
  @ApiErrors(
    'PAY_PERIOD_NOT_FOUND',
    'PERIOD_INVALID_TRANSITION',
    'RBAC_PERMISSION_DENIED',
    'STEPUP_REQUIRED',
  )
  approveLock(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.exec.approveLock(ctx, id, dto.reason);
  }

  @Post('periods/:id/reject-lock')
  @RequirePermission('period.approve_lock')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_REJECT_LOCK', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Từ chối đề nghị chốt kỳ',
    description:
      'Kỳ quay về `OPEN` để Kế toán sửa rồi gửi lại. Lý do là thứ Kế toán đọc để biết phải sửa gì.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'PERIOD_INVALID_TRANSITION', 'RBAC_PERMISSION_DENIED')
  rejectLock(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.exec.rejectLock(ctx, id, dto.reason);
  }

  @Post('periods/:id/approve-reopen')
  @RequirePermission('period.approve_reopen')
  @RequireStepUp('period.reopen')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_APPROVE_REOPEN', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Duyệt mở lại kỳ đã chốt (FR-WEB-PERIOD-10)',
    description:
      'Thao tác ĐẶC QUYỀN: bảng lương có thể đã gửi đi, thậm chí đã chi tiền. Lý do bắt buộc và vào `PeriodTransition` để sau còn đối chiếu được vì sao hai con số khác nhau (BR-07).',
  })
  @ApiErrors(
    'PAY_PERIOD_NOT_FOUND',
    'PERIOD_INVALID_TRANSITION',
    'RBAC_PERMISSION_DENIED',
    'STEPUP_REQUIRED',
  )
  approveReopen(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.exec.approveReopen(ctx, id, dto.reason);
  }

  // ===========================================================================
  //  Owner (BR-15)
  // ===========================================================================

  @Get('owners')
  @RequirePermission('owner.assign', 'role.view')
  @ApiOperation({ summary: 'Danh sách Owner đang hiệu lực của công ty' })
  listOwners(@CurrentTenant() ctx: TenantContext) {
    return this.exec.listOwners(ctx.companyId);
  }

  @Post('owners')
  @RequirePermission('owner.assign')
  @RequireStepUp('owner.assign')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'OWNER_GRANT', targetType: 'COMPANY_OWNER', requireReason: true })
  @ApiOperation({ summary: 'Chỉ định thêm Owner cho công ty' })
  @ApiErrors('OWNER_ALREADY_GRANTED', 'RBAC_PERMISSION_DENIED', 'STEPUP_REQUIRED')
  grantOwner(@CurrentTenant() ctx: TenantContext, @Body() dto: GrantOwnerDto) {
    return this.exec.grantOwner(ctx, dto.employeeId, dto.reason);
  }

  @Delete('owners/:employeeId')
  @RequirePermission('owner.assign')
  @RequireStepUp('owner.assign')
  // Tự gỡ quyền Owner của chính mình là cách nhanh nhất để một công ty tự khoá
  // mình ra ngoài phần cấu hình. Muốn rút lui thì nhờ Owner khác gỡ.
  @NoSelfApproval({ subjectFrom: { param: 'employeeId' } })
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'OWNER_REVOKE', targetType: 'COMPANY_OWNER', requireReason: true })
  @ApiOperation({
    summary: 'Gỡ quyền Owner',
    description: 'Không gỡ được Owner cuối cùng — phép đếm nằm trong cùng transaction (BR-15).',
  })
  @ApiErrors(
    'OWNER_LAST_ONE',
    'SELF_APPROVAL_FORBIDDEN',
    'RBAC_PERMISSION_DENIED',
    'STEPUP_REQUIRED',
  )
  revokeOwner(
    @CurrentTenant() ctx: TenantContext,
    @Param('employeeId') employeeId: string,
    @Body() dto: DecisionDto,
  ) {
    return this.exec.revokeOwner(ctx, employeeId, dto.reason);
  }

  // ===========================================================================
  //  Uỷ quyền duyệt (FR-GDW-FLOW-03)
  // ===========================================================================

  @Post('delegations')
  @RequirePermission('delegation.manage')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'APPROVAL_DELEGATION_CREATE', targetType: 'APPROVAL_DELEGATION' })
  @ApiOperation({
    summary: 'Uỷ quyền duyệt tạm thời',
    description:
      '`validTo` là bắt buộc: uỷ quyền vô thời hạn thì không còn là uỷ quyền, mà là cấp quyền — và cấp quyền phải đi đường `role.assign` để còn nhìn thấy trong màn phân quyền.',
  })
  @ApiErrors('RBAC_PERMISSION_DENIED')
  createDelegation(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateDelegationDto) {
    return this.exec.createDelegation(ctx, dto);
  }

  @Get('delegations')
  @RequirePermission('delegation.manage')
  @ApiOperation({ summary: 'Uỷ quyền đang hiệu lực mà tôi được nhận' })
  listDelegations(@CurrentTenant() ctx: TenantContext) {
    return this.exec.listMyDelegations(ctx);
  }
}
