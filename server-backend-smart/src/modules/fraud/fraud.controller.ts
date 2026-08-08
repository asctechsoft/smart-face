import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import { AttendanceAdminService } from '../attendance/attendance-admin.service';
import { FraudFlagQueryDto, ReviewFlagDto } from './dto/fraud.dto';
import { FraudService } from './fraud.service';

/** docs/08-hop-dong-api.md mục 6.4 — Dashboard cảnh báo gian lận (AF-21, AF-23). */
@ApiTags('Web Quản lý · Chống gian lận')
@ApiBearerAuth()
@Controller('admin/fraud')
export class FraudController {
  constructor(
    private readonly fraud: FraudService,
    private readonly attendanceAdmin: AttendanceAdminService,
  ) {}

  @Get('flags')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Danh sách cờ nghi vấn',
    description:
      'Lọc theo mức độ, loại cờ, phòng ban, nhân viên, trạng thái xử lý và khoảng thời gian (AF-21). MANAGER chỉ thấy cờ của phòng ban mình quản lý.',
  })
  listFlags(@CurrentTenant() ctx: TenantContext, @Query() query: FraudFlagQueryDto) {
    // `@DepartmentScoped()` bật kiểm tra ở `ScopeGuard`, còn `resolveDepartmentScope()`
    // lấy ra danh sách phòng ban thực tế để nhét vào mệnh đề WHERE. Cần cả hai:
    // guard chặn truy cập, hàm này thu hẹp dữ liệu. Thiếu vế thứ hai thì MANAGER
    // qua được guard nhưng vẫn đọc thấy cờ nghi vấn của toàn công ty.
    return this.fraud.listFlags(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Get('stats')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Thống kê cờ theo thời gian và theo loại' })
  stats(
    @CurrentTenant() ctx: TenantContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.fraud.stats(
      ctx.companyId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('flags/:id')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Chi tiết cờ + bằng chứng (ảnh, vị trí, thiết bị, điểm AI)' })
  @ApiErrors('SYS_NOT_FOUND')
  getFlag(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.fraud.getFlag(ctx.companyId, id);
  }

  // ⚠ MANAGER XEM được cờ nhưng KHÔNG quyết được — danh sách vai trò ở đây hẹp
  // hơn ba endpoint trên. Quyết định huỷ công là cắt tiền lương; để trưởng phòng
  // trực tiếp làm điều đó với cấp dưới của mình là đặt họ vào thế xung đột lợi
  // ích. Việc đó thuộc về HR hoặc admin công ty.
  @Post('flags/:id/review')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'FRAUD_FLAG_REVIEW', targetType: 'FRAUD_FLAG', requireReason: true })
  @ApiOperation({
    summary: 'Quyết định giữ / huỷ công nghi vấn (AF-23)',
    description:
      'VOID → tạo AttendanceAdjustment, tính lại công, ghi audit và THÔNG BÁO cho nhân viên kèm lý do. Huỷ công âm thầm là nguồn tranh chấp lao động.',
  })
  @ApiErrors('SYS_NOT_FOUND', 'PAY_REASON_REQUIRED', 'ATT_PERIOD_LOCKED')
  async review(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ReviewFlagDto,
  ) {
    // Đọc cờ qua `getFlag(companyId, ...)` chứ không tra thẳng theo id: hàm này
    // đã kèm điều kiện công ty, nên đoán được id của công ty khác cũng không lấy
    // được gì (BR-09).
    const flag = await this.fraud.getFlag(ctx.companyId, id);

    // Chỉ `VOID` mới đụng tới bảng công. `KEEP` và `ESCALATE` chỉ đổi trạng thái
    // xử lý của cờ — người lao động vẫn được tính công bình thường.
    if (dto.decision === 'VOID' && flag.attendanceLog) {
      // Gọi lại `adjust()` của module chấm công thay vì tự sửa bản ghi ở đây.
      // Nhờ vậy huỷ công do gian lận đi đúng con đường như mọi hiệu chỉnh khác:
      // tạo bản ghi điều chỉnh (không xoá bản gốc), tính lại bảng công, kiểm tra
      // kỳ lương đã chốt chưa, và ghi audit (BR-ADJ-01).
      await this.attendanceAdmin.adjust(ctx, {
        employeeId: flag.employeeId,
        workDate: flag.attendanceLog.workDate.toISOString().slice(0, 10),
        adjustType: 'VOID',
        attendanceLogId: flag.attendanceLogId ?? undefined,
        reason: dto.reason,
      });
    }

    // Đánh dấu đã xử lý SAU khi huỷ công thành công. Đảo thứ tự thì `adjust()`
    // ném lỗi (vd: kỳ lương đã khoá) sẽ để lại cờ mang trạng thái "đã xử lý"
    // trong khi công vẫn còn nguyên — sai lệch âm thầm, không ai rà lại.
    return this.fraud.markReviewed(ctx.companyId, id, dto.decision, dto.reason, ctx.userId);
  }
}
