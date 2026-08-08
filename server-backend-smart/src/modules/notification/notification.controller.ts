import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Audit, CurrentTenant, Roles } from 'src/common/decorators';
import { PaginationQueryDto } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import type { TenantContext } from 'src/common/types/request-context';
import { NotificationService } from './notification.service';

/**
 * Khai ngay trong file controller vì chỉ dùng đúng một chỗ. DTO nào được dùng ở
 * hơn một nơi thì tách sang `dto/` như các module khác.
 */
class BroadcastDto {
  @ApiProperty({ example: 'Thông báo nghỉ lễ 02/09' })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  body!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống = gửi toàn công ty' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ enum: ['PUSH', 'IN_APP', 'SMS', 'EMAIL'], default: 'PUSH' })
  @IsOptional()
  @IsIn(['PUSH', 'IN_APP', 'SMS', 'EMAIL'])
  channel?: 'PUSH' | 'IN_APP' | 'SMS' | 'EMAIL';

  @ApiPropertyOptional({ description: 'Lên lịch gửi (FR-WEB-NOT-02)' })
  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

/**
 * Thông báo — gộp cả phía nhận (App) và phía gửi (Web Quản lý) vào một controller.
 *
 * `@Controller()` để trống tiền tố vì hai nhóm endpoint nằm ở hai nhánh URL khác
 * nhau: `/notifications/*` cho người nhận, `/admin/notifications/*` cho người
 * gửi. Đặt tiền tố chung sẽ không diễn đạt được sự phân tách này.
 */
@ApiTags('Thông báo')
@ApiBearerAuth()
@Controller()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'Danh sách thông báo của tôi' })
  list(@CurrentTenant() ctx: TenantContext, @Query() query: PaginationQueryDto) {
    return this.notifications.list(ctx.companyId, this.employeeIdOf(ctx), query);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Số thông báo chưa đọc (FR-APP-HOME-02)' })
  async unreadCount(@CurrentTenant() ctx: TenantContext) {
    return { count: await this.notifications.countUnread(ctx.companyId, this.employeeIdOf(ctx)) };
  }

  @Post('notifications/:id/read')
  @ApiOperation({ summary: 'Đánh dấu đã đọc' })
  markRead(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.notifications.markRead(ctx.companyId, this.employeeIdOf(ctx), id);
  }

  @Post('notifications/read-all')
  @ApiOperation({ summary: 'Đánh dấu đã đọc tất cả' })
  markAllRead(@CurrentTenant() ctx: TenantContext) {
    return this.notifications.markAllRead(ctx.companyId, this.employeeIdOf(ctx));
  }

  @Post('admin/notifications/broadcast')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  // Có `@Audit` vì đây là thao tác chạm tới TẤT CẢ nhân viên cùng lúc — cần biết
  // ai đã gửi cái gì cho toàn công ty. MANAGER cũng gửi được nhưng `ScopeGuard`
  // giới hạn trong phòng ban họ quản lý, không phát ra toàn công ty được.
  @Audit({ action: 'NOTIFICATION_BROADCAST', targetType: 'COMPANY' })
  @ApiOperation({ summary: 'Gửi thông báo toàn công ty / theo phòng ban (FR-WEB-NOT-01)' })
  broadcast(@CurrentTenant() ctx: TenantContext, @Body() dto: BroadcastDto) {
    return this.notifications.broadcast({
      companyId: ctx.companyId,
      departmentId: dto.departmentId,
      type: 'COMPANY_ANNOUNCEMENT',
      title: dto.title,
      body: dto.body,
      channel: dto.channel,
      createdBy: ctx.userId,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    });
  }

  /**
   * Ép `employeeId` từ dạng có thể thiếu sang chắc chắn có.
   *
   * `ctx.employeeId` là optional vì SYSTEM_ADMIN đăng nhập không gắn với hồ sơ
   * nhân viên nào. Họ gọi các endpoint "của tôi" ở đây thì không có gì để trả —
   * ném lỗi rõ ràng thay vì để `undefined` lọt xuống query và trả về mảng rỗng
   * khó hiểu, hoặc tệ hơn là khớp nhầm bản ghi có `employeeId` null.
   */
  private employeeIdOf(ctx: TenantContext): string {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    return ctx.employeeId;
  }
}
