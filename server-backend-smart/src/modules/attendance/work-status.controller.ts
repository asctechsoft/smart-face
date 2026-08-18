import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import {
  ExportWorkStatusDto,
  RemindWorkStatusDto,
  WorkStatusQueryDto,
} from './dto/work-status.dto';
import { WorkStatusService } from './work-status.service';

/**
 * Theo dõi công việc trong ngày — Web Quản lý.
 *
 * Endpoint riêng chứ không phải một tham số của `admin/attendance-sheets/:id/board`:
 * lưới bảng chấm công phân trang theo NGƯỜI trên trục NGÀY và chỉ chứa thành
 * viên đã chốt của một bảng, còn ở đây trục là GIỜ trong đúng một ngày và tập
 * người là "ai đang làm việc trong phạm vi quyền của tôi" — không có bảng nào
 * quyết định điều đó. Nhồi hai hình dạng vào một endpoint sẽ tạo ra một DTO mà
 * nửa số trường luôn rỗng, tuỳ chế độ.
 *
 * Quyền đọc dùng chung `attendance.view` (MANAGER trở lên) vì đây là một CÁCH
 * ĐỌC dữ liệu chấm công, không mở thêm dữ liệu nào. `ScopeGuard` vẫn giới hạn
 * MANAGER trong phòng ban họ quản lý.
 */
@ApiTags('Web Quản lý · Theo dõi công việc')
@ApiBearerAuth()
@Controller('admin/work-status')
export class WorkStatusController {
  constructor(private readonly workStatus: WorkStatusService) {}

  @Get()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Lưới trạng thái làm việc của một ngày',
    description:
      'Mỗi dòng một CBNV trên trục GIỜ: ca được xếp, các lượt quẹt thô, khoảng ra ngoài và đơn từ phủ lên ngày. Mọi mốc thời gian trả về dưới dạng SỐ PHÚT tính từ 00:00 của ngày làm việc theo múi giờ công ty — client không phải quy đổi timezone. Phần `summary` đếm trên TOÀN phạm vi bộ lọc, không phải trên trang đang xem.',
  })
  board(@CurrentTenant() ctx: TenantContext, @Query() query: WorkStatusQueryDto) {
    return this.workStatus.getBoard(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Post('remind')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'work-status-remind', limit: 20, windowSeconds: 3600, by: 'account' })
  @Audit({ action: 'WORK_STATUS_REMIND', targetType: 'EMPLOYEE' })
  @ApiOperation({
    summary: 'Nhắc CBNV chưa chấm công',
    description:
      'Gửi thông báo tới đúng danh sách `employeeIds` người dùng đã chọn trên lưới. Người nằm ngoài phạm vi phòng ban của người gửi bị bỏ qua và đếm vào `skipped` — KHÔNG làm hỏng cả lượt gửi.',
  })
  @ApiErrors('SYS_VALIDATION_ERROR', 'SYS_RATE_LIMITED')
  remind(@CurrentTenant() ctx: TenantContext, @Body() dto: RemindWorkStatusDto) {
    return this.workStatus.remind(ctx, dto, resolveDepartmentScope(ctx));
  }

  @Post('export')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: 'export', limit: 5, windowSeconds: 3600, by: 'account' })
  @ApiOperation({
    summary: 'Xuất trạng thái làm việc của một ngày ra Excel (bất đồng bộ)',
    description:
      'Trả 202 kèm `jobId`; hỏi tiến độ qua `GET /v1/jobs/:id` như mọi việc chạy nền khác. Phạm vi phòng ban được chốt tại đây và ghi vào params của job, vì worker chạy sau không còn request context.',
  })
  @ApiErrors('SYS_RATE_LIMITED', 'AUTH_FORBIDDEN')
  export(@CurrentTenant() ctx: TenantContext, @Body() dto: ExportWorkStatusDto) {
    return this.workStatus.requestExport(ctx, dto, resolveDepartmentScope(ctx));
  }
}
