import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import type { TenantContext } from 'src/common/types/request-context';
import { ReplaceApprovalFlowDto, UpsertRequestTypeDto } from './dto/request-config.dto';
import { RequestConfigService } from './request-config.service';

/**
 * Cấu hình loại đơn & luồng duyệt — `FR-WEB-REQ-05`, docs/04 mục 4.1.
 *
 * MANAGER **không** có mặt ở đây, kể cả quyền đọc. Duyệt đơn là việc của quản lý,
 * còn quyết định "đơn nghỉ trên 3 ngày có cần HR duyệt không" là chính sách công
 * ty — cùng nhóm với `POL_` ở docs/04 mục 1 ("Cấu hình chính sách công ty":
 * chỉ Admin công ty).
 *
 * `HR_PAYROLL` được đọc và sửa vì luồng duyệt quyết định thứ tự chứng từ vào
 * bảng lương, nhưng mọi thao tác ghi đều có `@Audit`.
 */
@ApiTags('Web Quản lý · Cấu hình đơn từ')
@ApiBearerAuth()
@Controller('admin/request-types')
export class RequestConfigController {
  constructor(private readonly config: RequestConfigService) {}

  @Get()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @ApiOperation({
    summary: 'Danh mục loại đơn kèm luồng duyệt',
    description: 'Gồm cả loại đã tắt (để bật lại được) và số đơn đã phát sinh của từng loại.',
  })
  list(@CurrentTenant() ctx: TenantContext) {
    return this.config.list(ctx.companyId);
  }

  @Post()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'REQUEST_TYPE_CREATE', targetType: 'REQUEST_TYPE' })
  @ApiOperation({ summary: 'Tạo loại đơn' })
  @ApiErrors('REQ_TYPE_CODE_TAKEN')
  create(@CurrentTenant() ctx: TenantContext, @Body() dto: UpsertRequestTypeDto) {
    return this.config.create(ctx, dto);
  }

  @Patch(':id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'REQUEST_TYPE_UPDATE', targetType: 'REQUEST_TYPE' })
  @ApiOperation({
    summary: 'Sửa loại đơn',
    description: 'Mã loại đơn bị khoá sau khi đã có đơn phát sinh — mã nằm trong báo cáo đã xuất.',
  })
  @ApiErrors('REQ_TYPE_NOT_FOUND', 'REQ_TYPE_CODE_TAKEN')
  update(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpsertRequestTypeDto,
  ) {
    return this.config.update(ctx, id, dto);
  }

  @Put(':id/approval-flow')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'APPROVAL_FLOW_UPDATE', targetType: 'REQUEST_TYPE' })
  @ApiOperation({
    summary: 'Thay toàn bộ luồng duyệt của một loại đơn',
    description:
      'Đơn ĐANG CHỜ DUYỆT giữ nguyên luồng của lúc gửi. Luồng rỗng = mặc định một cấp quản lý trực tiếp.',
  })
  @ApiErrors('REQ_TYPE_NOT_FOUND', 'REQ_FLOW_INVALID')
  replaceFlow(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ReplaceApprovalFlowDto,
  ) {
    return this.config.replaceFlow(ctx, id, dto);
  }
}
