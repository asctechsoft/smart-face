import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Audit, CurrentTenant, RequirePermission, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import type { TenantContext } from 'src/common/types/request-context';
import { PayrollService } from './payroll.service';

class CreatePeriodDto {
  @ApiProperty({ example: 'Tháng 08/2026' })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  endDate!: string;
}

/**
 * Chốt kỳ lương — thao tác KHÓ HOÀN TÁC nhất trong hệ thống.
 *
 * Sau khi chốt, toàn bộ dữ liệu chấm công trong khoảng thời gian đó bị khoá:
 * không hiệu chỉnh, không duyệt đơn ảnh hưởng tới kỳ, không tính lại. Đây là
 * điều kiện cần để bảng lương đã gửi đi không âm thầm đổi số phía sau lưng.
 */
class ClosePeriodDto {
  @ApiProperty({ description: 'Bắt buộc, tối thiểu 10 ký tự (BR-08)', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;

  /**
   * Chốt dù hệ thống báo còn vướng.
   *
   * "Blocker" là những thứ như đơn từ chưa duyệt xong, cờ gian lận chưa xử lý,
   * nhân viên thiếu công chưa giải trình. Chặn cứng thì đến hạn trả lương mà một
   * trưởng phòng đi vắng chưa duyệt đơn là cả công ty không nhận được lương.
   *
   * Nên đây là cửa thoát có kiểm soát: mở được, nhưng lý do vào audit log và
   * người bấm phải chịu trách nhiệm. Ghi lại vẫn tốt hơn là chặn cứng rồi người
   * ta tìm cách lách bằng đường khác.
   */
  @ApiPropertyOptional({
    description:
      'Chốt dù còn blocker. CHỈ dùng khi kế toán đã cân nhắc — lý do sẽ được ghi vào audit log.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/**
 * Mở lại kỳ đã chốt — chỉ dùng khi phát hiện sai sót sau khi chốt.
 *
 * Nguy hiểm vì bảng lương có thể đã gửi cho kế toán, thậm chí đã chi tiền. Mở
 * lại rồi tính ra con số khác nghĩa là sổ sách và thực chi lệch nhau. Vì vậy
 * `reason` bắt buộc và toàn bộ thao tác vào audit log (BR-07) — để sau này còn
 * đối chiếu được vì sao hai con số khác nhau.
 */
class ReopenPeriodDto {
  @ApiProperty({ description: 'Bắt buộc, tối thiểu 10 ký tự (BR-07)', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

class RecalculateRangeDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ type: [String], description: 'Bỏ trống = toàn bộ nhân viên' })
  @IsOptional()
  employeeIds?: string[];
}

class ExportPayrollDto {
  @ApiProperty()
  @IsString()
  periodId!: string;

  @ApiPropertyOptional({ enum: ['XLSX', 'CSV'], default: 'XLSX' })
  @IsOptional()
  @IsIn(['XLSX', 'CSV'])
  format?: 'XLSX' | 'CSV';
}

/**
 * docs/15-hop-dong-api.md mục 6.3 — Tính công / Tính lương.
 *
 * Chỉ HR_PAYROLL và COMPANY_ADMIN, không có MANAGER ở bất kỳ endpoint nào —
 * kể cả endpoint chỉ đọc. Bảng công tổng hợp cho thấy giờ làm, OT, ngày nghỉ của
 * từng người, đủ để suy ra thu nhập. Trưởng phòng không có nhu cầu nghiệp vụ nào
 * cần dữ liệu đó ở mức chi tiết này.
 *
 * Vòng đời một kỳ lương:
 *
 *   tạo kỳ → tính công → xem báo cáo tiền chốt → CHỐT (khoá dữ liệu) → [mở lại]
 *
 * Bước "báo cáo tiền chốt" tồn tại để kế toán nhìn thấy các vướng mắc TRƯỚC khi
 * khoá, thay vì phát hiện sau rồi phải mở lại — thao tác vốn đã gây lệch sổ sách.
 */
@ApiTags('Web Quản lý · Tính công & Lương')
@ApiBearerAuth()
@Controller('admin/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('periods')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.view')
  @ApiOperation({ summary: 'Danh sách kỳ lương' })
  listPeriods(@CurrentTenant() ctx: TenantContext) {
    return this.payroll.listPeriods(ctx.companyId);
  }

  @Post('periods')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.calculate')
  @Audit({ action: 'PAYROLL_PERIOD_CREATE', targetType: 'PAYROLL_PERIOD' })
  @ApiOperation({ summary: 'Tạo kỳ lương' })
  @ApiErrors('PAY_PERIOD_OVERLAP')
  createPeriod(@CurrentTenant() ctx: TenantContext, @Body() dto: CreatePeriodDto) {
    return this.payroll.createPeriod(ctx.companyId, dto.name, dto.startDate, dto.endDate);
  }

  @Get('periods/:id/summary')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.view')
  @ApiOperation({
    summary: 'Bảng công tổng hợp của kỳ',
    description:
      'Kỳ đã chốt → đọc snapshot PayrollSummary (bất biến). Kỳ đang mở → tính trực tiếp từ AttendanceDaily.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND')
  summary(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.getPeriodSummary(ctx.companyId, id);
  }

  @Post('periods/:id/recalculate')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.calculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'PAYROLL_RECALCULATE', targetType: 'PAYROLL_PERIOD' })
  @ApiOperation({
    summary: 'Chạy lại tính công cho kỳ',
    description:
      'Job idempotent — chạy 2 lần cho cùng dữ liệu ra kết quả giống hệt (NFR-REL-06). Trả `jobId`; hỏi tiến độ qua `GET /v1/jobs/:id` cho tới khi `status` là `COMPLETED` hoặc `FAILED`.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'PAY_PERIOD_CLOSED')
  recalculate(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.recalculatePeriod(ctx, id);
  }

  @Get('periods/:id/pre-close-report')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('period.submit_lock')
  @ApiOperation({
    summary: 'Báo cáo tiền chốt',
    description:
      'BẮT BUỘC xem trước khi chốt. Liệt kê bản ghi thiếu, đơn còn chờ duyệt, cờ nghi vấn chưa xử lý và nhân viên có số công bất thường. Chốt kỳ khi còn đơn chờ duyệt là nguyên nhân khiếu nại lương phổ biến nhất.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND')
  preCloseReport(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.preCloseReport(ctx.companyId, id);
  }

  @Post('periods/:id/submit-lock')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('period.submit_lock')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_SUBMIT_LOCK', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Gửi đề nghị chốt kỳ (FR-WEB-PERIOD-08)',
    description:
      'Kế toán GỬI, Giám đốc DUYỆT — hai việc của hai người (docs/08 §1.1). Bước này tính bảng công, ghi thành một `PayrollPeriodVersion` mới rồi chuyển kỳ sang `PENDING_APPROVAL`. Từ lúc này dữ liệu trong kỳ bị khoá sửa để Giám đốc duyệt đúng bộ số đã xem. Còn blocker mà vẫn muốn gửi thì truyền `force: true` — lý do vào audit.',
  })
  @ApiErrors(
    'PAY_PERIOD_NOT_FOUND',
    'PERIOD_INVALID_TRANSITION',
    'PAY_PERIOD_HAS_BLOCKERS',
    'PAY_REASON_REQUIRED',
  )
  submitLock(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ClosePeriodDto,
  ) {
    return this.payroll.submitLock(ctx, id, dto.reason, dto.force ?? false);
  }

  @Post('periods/:id/request-reopen')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('period.request_reopen')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_REOPEN_REQUESTED', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Đề nghị mở lại kỳ đã chốt',
    description:
      'KHÔNG mở kỳ. Chỉ báo cho Giám đốc; việc mở thật nằm ở `POST /v1/exec/periods/:id/approve-reopen` và cần step-up (BR-07).',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'PERIOD_INVALID_TRANSITION', 'PAY_REASON_REQUIRED')
  requestReopen(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ReopenPeriodDto,
  ) {
    return this.payroll.requestReopen(ctx, id, dto.reason);
  }

  @Get('periods/:id/versions')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.view')
  @ApiOperation({
    summary: 'Lịch sử các lần tính của kỳ (FR-WEB-PERIOD-07)',
    description:
      'Mỗi lần gửi đề nghị chốt sinh một version, kèm ảnh chụp chính sách đã dùng. Đây là thứ trả lời được câu "vì sao kỳ mở lại ra số khác lần chốt đầu".',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND')
  versions(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.listPeriodVersions(ctx.companyId, id);
  }

  @Get('periods/:id/transitions')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.view')
  @ApiOperation({
    summary: 'Nhật ký chuyển trạng thái của kỳ (FR-WEB-PERIOD-06)',
    description: 'Giữ đủ chuỗi, kể cả các lần bị Giám đốc từ chối và các lần mở lại trước đó.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND')
  transitions(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.listPeriodTransitions(ctx.companyId, id);
  }

  @Post('recalculate')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('timesheet.calculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'PAYROLL_RECALCULATE_RANGE' })
  @ApiOperation({
    summary: 'Chạy lại tính công cho một khoảng thời gian (FR-ADM-OPS-04)',
    description: 'Ngày thuộc kỳ đã chốt sẽ bị BỎ QUA kèm cảnh báo, không ghi đè (BR-07).',
  })
  recalculateRange(@CurrentTenant() ctx: TenantContext, @Body() dto: RecalculateRangeDto) {
    return this.payroll.requestRecalculateRange(ctx.companyId, dto.from, dto.to, dto.employeeIds);
  }

  @Post('export')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @RequirePermission('report.export')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: 'export', limit: 5, windowSeconds: 3600, by: 'account' })
  @ApiOperation({ summary: 'Xuất bảng công/lương ra Excel (bất đồng bộ)' })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'SYS_RATE_LIMITED')
  export(@CurrentTenant() ctx: TenantContext, @Body() dto: ExportPayrollDto) {
    return this.payroll.requestExport(ctx, dto.periodId, dto.format);
  }
}
