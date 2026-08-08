import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Audit, CurrentTenant, Roles } from 'src/common/decorators';
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
 * docs/08-hop-dong-api.md mục 6.3 — Tính công / Tính lương.
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
  @ApiOperation({ summary: 'Danh sách kỳ lương' })
  listPeriods(@CurrentTenant() ctx: TenantContext) {
    return this.payroll.listPeriods(ctx.companyId);
  }

  @Post('periods')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'PAYROLL_PERIOD_CREATE', targetType: 'PAYROLL_PERIOD' })
  @ApiOperation({ summary: 'Tạo kỳ lương' })
  @ApiErrors('PAY_PERIOD_OVERLAP')
  createPeriod(@CurrentTenant() ctx: TenantContext, @Body() dto: CreatePeriodDto) {
    return this.payroll.createPeriod(ctx.companyId, dto.name, dto.startDate, dto.endDate);
  }

  @Get('periods/:id/summary')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
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
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'PAYROLL_RECALCULATE', targetType: 'PAYROLL_PERIOD' })
  @ApiOperation({
    summary: 'Chạy lại tính công cho kỳ',
    description: 'Job idempotent — chạy 2 lần cho cùng dữ liệu ra kết quả giống hệt (NFR-REL-06).',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'PAY_PERIOD_CLOSED')
  recalculate(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.recalculatePeriod(ctx.companyId, id);
  }

  @Get('periods/:id/pre-close-report')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @ApiOperation({
    summary: 'Báo cáo tiền chốt',
    description:
      'BẮT BUỘC xem trước khi chốt. Liệt kê bản ghi thiếu, đơn còn chờ duyệt, cờ nghi vấn chưa xử lý và nhân viên có số công bất thường. Chốt kỳ khi còn đơn chờ duyệt là nguyên nhân khiếu nại lương phổ biến nhất.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND')
  preCloseReport(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.payroll.preCloseReport(ctx.companyId, id);
  }

  @Post('periods/:id/close')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_CLOSE', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Chốt kỳ lương',
    description:
      'Snapshot bảng công vào PayrollSummary rồi KHOÁ kỳ (BR-07): không chấm công, không sửa công, không duyệt đơn vào kỳ. Còn blocker mà vẫn muốn chốt thì phải truyền `force: true` — lý do được ghi vào audit.',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'PAY_PERIOD_CLOSED', 'PAY_PERIOD_HAS_BLOCKERS', 'PAY_REASON_REQUIRED')
  close(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() dto: ClosePeriodDto) {
    return this.payroll.closePeriod(ctx, id, dto.reason, dto.force ?? false);
  }

  @Post('periods/:id/reopen')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'PAYROLL_REOPEN', targetType: 'PAYROLL_PERIOD', requireReason: true })
  @ApiOperation({
    summary: 'Mở lại kỳ đã chốt',
    description: 'Thao tác ĐẶC QUYỀN. Bắt buộc lý do và ghi audit log (BR-07).',
  })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'PAY_REASON_REQUIRED')
  reopen(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() dto: ReopenPeriodDto) {
    return this.payroll.reopenPeriod(ctx, id, dto.reason);
  }

  @Post('recalculate')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'PAYROLL_RECALCULATE_RANGE' })
  @ApiOperation({
    summary: 'Chạy lại tính công cho một khoảng thời gian (FR-ADM-OPS-04)',
    description: 'Ngày thuộc kỳ đã chốt sẽ bị BỎ QUA kèm cảnh báo, không ghi đè (BR-07).',
  })
  recalculateRange(@CurrentTenant() ctx: TenantContext, @Body() dto: RecalculateRangeDto) {
    return this.payroll.requestRecalculateRange(
      ctx.companyId,
      dto.from,
      dto.to,
      dto.employeeIds,
    );
  }

  @Post('export')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ bucket: 'export', limit: 5, windowSeconds: 3600, by: 'account' })
  @ApiOperation({ summary: 'Xuất bảng công/lương ra Excel (bất đồng bộ)' })
  @ApiErrors('PAY_PERIOD_NOT_FOUND', 'SYS_RATE_LIMITED')
  export(@CurrentTenant() ctx: TenantContext, @Body() dto: ExportPayrollDto) {
    return this.payroll.requestExport(ctx, dto.periodId, dto.format);
  }
}
