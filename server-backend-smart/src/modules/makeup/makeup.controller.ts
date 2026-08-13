import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import {
  CancelMakeupDto,
  CreateMakeupDebtDto,
  ExtendMakeupDto,
  MakeupQueryDto,
  RecordMakeupDto,
} from './dto/makeup.dto';
import { MakeupService } from './makeup.service';

/**
 * Công làm bù — docs/04 mục 5 (`FR-WEB-MKUP-01..04`).
 *
 * Phân quyền theo cùng logic với chấm công: **MANAGER đọc được** (cần biết ai
 * trong phòng còn nợ giờ để xếp lịch bù) nhưng **không ghi được**. Ghi nhận giờ
 * bù là thao tác đi thẳng vào bảng công và bảng lương, nên chỉ Kế toán/HR và
 * Admin công ty — cùng ranh giới với "Sửa/bổ sung công thủ công" ở docs/04 mục 1.
 */
@ApiTags('Web Quản lý · Công làm bù')
@ApiBearerAuth()
@Controller('admin/makeup')
export class MakeupController {
  constructor(private readonly makeup: MakeupService) {}

  @Get()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Danh sách khoản nợ công và tình trạng làm bù',
    description:
      'Mỗi dòng kèm số công chuẩn quy đổi theo chính sách công ty và cờ quá hạn tính theo múi giờ công ty.',
  })
  list(@CurrentTenant() ctx: TenantContext, @Query() query: MakeupQueryDto) {
    return this.makeup.list(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Get('summary')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Tổng hợp nợ công / đã bù / quá hạn',
    description:
      'Trả kèm `conversion` (số phút một công chuẩn, bước làm tròn, hạn làm bù) để giao diện quy đổi giống hệt Backend.',
  })
  summary(@CurrentTenant() ctx: TenantContext, @Query() query: MakeupQueryDto) {
    return this.makeup.summary(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Post()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'MAKEUP_DEBT_CREATE', targetType: 'MAKEUP', requireReason: true })
  @ApiOperation({
    summary: 'Ghi nhận một khoản nợ công (FR-WEB-MKUP-02)',
    description: 'Hạn làm bù bỏ trống thì tính từ ngày phát sinh nợ + `makeup.dueDays`.',
  })
  @ApiErrors('EMP_NOT_FOUND')
  create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateMakeupDebtDto) {
    return this.makeup.createDebt(ctx, dto);
  }

  @Post(':id/record')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'MAKEUP_RECORD', targetType: 'MAKEUP' })
  @ApiOperation({
    summary: 'Ghi nhận một lần làm bù (FR-WEB-MKUP-03)',
    description:
      'Bù thiếu thì phần còn nợ tự tách sang một dòng mới giữ nguyên ngày phát sinh và hạn. Bù vượt số nợ bị từ chối — phần dôi ra là tăng ca, có luồng duyệt và hệ số riêng.',
  })
  @ApiErrors('MKUP_NOT_FOUND', 'MKUP_ALREADY_CLOSED', 'MKUP_EXCEEDS_DEBT', 'MKUP_OVERDUE')
  record(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: RecordMakeupDto,
  ) {
    return this.makeup.record(ctx, id, dto);
  }

  @Post(':id/extend')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'MAKEUP_EXTEND', targetType: 'MAKEUP', requireReason: true })
  @ApiOperation({ summary: 'Gia hạn làm bù' })
  @ApiErrors('MKUP_NOT_FOUND', 'MKUP_ALREADY_CLOSED')
  extend(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ExtendMakeupDto,
  ) {
    return this.makeup.extend(ctx, id, dto);
  }

  @Post(':id/cancel')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'MAKEUP_CANCEL', targetType: 'MAKEUP', requireReason: true })
  @ApiOperation({
    summary: 'Huỷ khoản nợ ghi nhầm',
    description:
      'Chỉ huỷ được khi chưa ghi nhận giờ bù nào — giờ đã bù đã vào bảng công của ngày làm bù.',
  })
  @ApiErrors('MKUP_NOT_FOUND', 'MKUP_ALREADY_CLOSED')
  cancel(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: CancelMakeupDto,
  ) {
    return this.makeup.cancel(ctx, id, dto.reason);
  }
}
