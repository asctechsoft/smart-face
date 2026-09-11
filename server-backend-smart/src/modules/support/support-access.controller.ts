import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Audit, CurrentUser, RequirePermission, Roles, SkipTenant } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import type { RequestContext } from 'src/common/types/request-context';
import { SupportAccessService } from './support-access.service';

class OpenSupportSessionDto {
  @ApiProperty({ description: 'Công ty cần truy cập' })
  @IsString()
  companyId!: string;

  @ApiProperty({ example: 'SUP-2026-0412', description: 'BẮT BUỘC — mã phiếu hỗ trợ' })
  @IsString()
  @Length(3, 60)
  ticketRef!: string;

  @ApiProperty({
    example: 'Khách báo chấm công ngày 05/09 không lên bảng công',
    description: 'BẮT BUỘC — lý do truy cập, hiển thị lại cho khách hàng khi họ hỏi',
  })
  @IsString()
  @Length(10, 500)
  purpose!: string;

  @ApiPropertyOptional({ default: 60, description: 'Từ 5 phút đến 8 giờ' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;

  @ApiPropertyOptional({ default: true, description: 'false = được phép ghi, phải khai từ đầu' })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

/**
 * Phiên hỗ trợ tenant và tra cứu chuỗi truy vết (`BR-08` · `NFR-AUD-02`).
 *
 * Đây là cửa duy nhất để một tài khoản nền tảng chạm vào dữ liệu của một công ty
 * cụ thể: `TenantGuard` chỉ chấp nhận header `X-Company-Id` khi có phiên mở ở
 * đây. Xem docstring của `SupportAccessService` cho lý do đầy đủ.
 */
@ApiTags('Quản trị nền tảng · Phiên hỗ trợ')
@ApiBearerAuth()
@Controller('system')
@Roles(SystemRole.SYSTEM_ADMIN)
@SkipTenant()
export class SupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Post('support-sessions')
  @RequirePermission('platform.support_access')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'SUPPORT_SESSION_OPEN', targetType: 'SUPPORT_ACCESS_SESSION' })
  @ApiOperation({
    summary: 'Mở phiên truy cập dữ liệu một công ty',
    description:
      'Mã phiếu, lý do và thời hạn đều bắt buộc. Đang có phiên hiệu lực thì trả lại chính phiên đó (`reused: true`) thay vì tạo thêm.',
  })
  open(@CurrentUser() ctx: RequestContext, @Body() dto: OpenSupportSessionDto) {
    return this.support.open(ctx, dto);
  }

  @Get('support-sessions')
  @RequirePermission('platform.support_access')
  @ApiOperation({ summary: 'Danh sách phiên hỗ trợ' })
  list(
    @Query('companyId') companyId?: string,
    @Query('adminUserId') adminUserId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.support.list({ companyId, adminUserId, activeOnly: activeOnly === 'true' });
  }

  @Get('support-sessions/:id/trail')
  @RequirePermission('platform.support_access')
  @ApiOperation({
    summary: 'Những gì đã xảy ra trong một phiên',
    description:
      'Toàn bộ bản ghi audit mang `supportSessionId` này — bằng chứng đưa cho khách hàng.',
  })
  @ApiErrors('SYS_NOT_FOUND')
  trail(@Param('id') id: string) {
    return this.support.trail(id);
  }

  @Delete('support-sessions/:id')
  @RequirePermission('platform.support_access')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'SUPPORT_SESSION_CLOSE', targetType: 'SUPPORT_ACCESS_SESSION' })
  @ApiOperation({ summary: 'Đóng phiên trước hạn' })
  @ApiErrors('SYS_NOT_FOUND')
  close(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.support.close(ctx, id);
  }

  @Get('trace/:correlationId')
  @RequirePermission('platform.support_access')
  @ApiOperation({
    summary: 'Lần theo một chuỗi truy vết (NFR-AUD-02)',
    description:
      'Ghép các bản ghi Backend của cùng một `correlationId`. Dòng log tương ứng ở AI Server mang cùng id trong header `X-Correlation-Id`.',
  })
  trace(@Param('correlationId') correlationId: string) {
    return this.support.trace(correlationId);
  }
}
