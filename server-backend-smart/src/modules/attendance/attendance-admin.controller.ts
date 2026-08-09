import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import { AttendanceAdminService } from './attendance-admin.service';
import { AttendanceService } from './attendance.service';
import {
  AdjustAttendanceDto,
  AdminAttendanceQueryDto,
  ExportAttendanceDto,
} from './dto/attendance.dto';

/**
 * docs/08-hop-dong-api.md mục 6.1 — Web Quản lý · Chấm công.
 *
 * Khác `AttendanceController` (App) ở chỗ mọi endpoint đều thao tác trên NGƯỜI
 * KHÁC, nên đều phải qua `@Roles` + `@DepartmentScoped()`.
 *
 * Hai nguồn dữ liệu, dùng cho hai mục đích khác nhau:
 *
 * - `AttendanceDaily` — đã tính sẵn theo ngày, dùng cho bảng công và báo cáo.
 *   Nhanh vì không phải gộp lại từ bản ghi thô mỗi lần xem (NFR-PERF-06).
 * - `AttendanceLog`   — bản ghi thô từng lượt quẹt, BẤT BIẾN. Chỉ mở ra khi cần
 *   đối soát khiếu nại: ai quẹt lúc mấy giờ, ở đâu, ảnh nào, điểm AI bao nhiêu.
 *
 * Hiệu chỉnh KHÔNG sửa vào `AttendanceLog` mà tạo `AttendanceAdjustment` rồi
 * tính lại `AttendanceDaily` (BR-ADJ-01).
 */
@ApiTags('Web Quản lý · Chấm công')
@ApiBearerAuth()
@Controller('admin/attendance')
export class AttendanceAdminController {
  constructor(
    private readonly admin: AttendanceAdminService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get()
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Bảng công theo ngày',
    description:
      'MANAGER chỉ thấy nhân viên thuộc phòng ban mình quản lý (ScopeGuard). Dữ liệu lấy từ AttendanceDaily đã tính sẵn để đạt NFR-PERF-06.',
  })
  list(@CurrentTenant() ctx: TenantContext, @Query() query: AdminAttendanceQueryDto) {
    return this.admin.listDaily(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Get('logs')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Các lượt chấm công thô của một nhân viên trong một ngày' })
  listLogs(
    @CurrentTenant() ctx: TenantContext,
    @Query('employeeId') employeeId: string,
    @Query('workDate') workDate: string,
  ) {
    return this.admin.listLogsForDay(ctx.companyId, employeeId, workDate);
  }

  @Get(':id')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Chi tiết một lượt chấm công',
    description:
      'Kèm ảnh (presigned URL 5 phút), toạ độ, thông tin thiết bị, điểm AI và cờ nghi vấn — phục vụ đối soát khiếu nại (AF-22).',
  })
  @ApiErrors('ATT_NOT_FOUND')
  detail(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.attendance.getLogDetail(ctx.companyId, id);
  }

  @Post('adjust')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'ATTENDANCE_ADJUST', targetType: 'ATTENDANCE_LOG', requireReason: true })
  @ApiOperation({
    summary: 'Hiệu chỉnh công thủ công',
    description:
      'BR-ADJ-01: KHÔNG sửa đè bản ghi thô — tạo AttendanceAdjustment trỏ về bản ghi gốc. Bắt buộc lý do ≥ 10 ký tự (BR-ADJ-02), ghi audit (BR-ADJ-03), tự kích hoạt tính lại (BR-ADJ-04), chặn nếu kỳ đã chốt (BR-ADJ-05), thông báo cho nhân viên (BR-ADJ-06). MANAGER KHÔNG có quyền này.',
  })
  @ApiErrors('EMP_NOT_FOUND', 'ATT_NOT_FOUND', 'ATT_PERIOD_LOCKED', 'PAY_REASON_REQUIRED')
  adjust(@CurrentTenant() ctx: TenantContext, @Body() dto: AdjustAttendanceDto) {
    return this.admin.adjust(ctx, dto);
  }

  @Post('export')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: 'export', limit: 5, windowSeconds: 3600, by: 'account' })
  @ApiOperation({
    summary: 'Xuất bảng công ra Excel (bất đồng bộ)',
    description:
      'Trả 202 kèm jobId. File xử lý ở Backend rồi lưu S3, tải qua link có thời hạn — không xuất ở client (docs/04 mục 7.4). MANAGER chỉ xuất được phòng ban mình quản lý: phạm vi được chốt tại đây và ghi vào params của job, vì worker chạy sau không còn request context.',
  })
  @ApiErrors('SYS_RATE_LIMITED', 'AUTH_FORBIDDEN')
  export(@CurrentTenant() ctx: TenantContext, @Body() dto: ExportAttendanceDto) {
    return this.admin.requestExport(ctx, dto, resolveDepartmentScope(ctx));
  }
}

@ApiTags('Web Quản lý · Job bất đồng bộ')
@ApiBearerAuth()
@Controller('jobs')
export class ExportJobController {
  constructor(private readonly admin: AttendanceAdminService) {}

  @Get(':id')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Trạng thái job export + link tải khi hoàn tất' })
  @ApiErrors('SYS_NOT_FOUND')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.admin.getJob(ctx.companyId, id);
  }
}
