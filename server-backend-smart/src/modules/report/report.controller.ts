import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { AppException } from 'src/common/errors';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import { ReportService } from './report.service';

/**
 * docs/08-hop-dong-api.md mục 6.3 — Dashboard & báo cáo.
 *
 * Toàn bộ là truy vấn TỔNG HỢP trên khoảng thời gian dài, nên hai điểm chi phối
 * thiết kế của controller này:
 *
 * 1. **Bắt buộc có khoảng thời gian.** `assertRange()` chặn request không khai
 *    `from`/`to`. Thiếu là quét toàn bộ lịch sử chấm công của công ty — một truy
 *    vấn đủ sức làm chậm cả hệ thống trong giờ cao điểm.
 * 2. **Cache Redis.** Dashboard là màn hình mở nhiều nhất, mỗi lần tải mà tính
 *    lại từ bảng thô thì database gánh không nổi (docs/04 mục 2.2).
 *
 * MANAGER xem được nhưng `resolveDepartmentScope()` thu hẹp về phòng ban họ
 * quản lý — con số tổng trên dashboard của mỗi người là khác nhau, đúng như vậy.
 */
@ApiTags('Web Quản lý · Dashboard & Báo cáo')
@ApiBearerAuth()
@Controller('admin')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('dashboard')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Dashboard tổng quan',
    description:
      'Cache Redis TTL 2 phút (docs/04 mục 2.2) — màn hình mở nhiều nhất, không query thẳng bảng chấm công mỗi lần tải.',
  })
  dashboard(@CurrentTenant() ctx: TenantContext) {
    return this.reports.dashboard(ctx.companyId, resolveDepartmentScope(ctx));
  }

  @Get('dashboard/alerts')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Cảnh báo bất thường hôm nay (FR-WEB-DASH-05)' })
  alerts(@CurrentTenant() ctx: TenantContext) {
    return this.reports.todayAlerts(ctx.companyId, resolveDepartmentScope(ctx));
  }

  @Get('reports/attendance-trend')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Biểu đồ chuyên cần theo ngày (FR-WEB-REP-01)' })
  trend(
    @CurrentTenant() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    this.assertRange(from, to);
    return this.reports.attendanceTrend(ctx.companyId, from, to, resolveDepartmentScope(ctx));
  }

  @Get('reports/violations')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Nhân viên vi phạm nhiều lần (FR-WEB-REP-02)' })
  violations(
    @CurrentTenant() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('minOccurrences') minOccurrences?: string,
  ) {
    this.assertRange(from, to);
    return this.reports.violations(
      ctx.companyId,
      from,
      to,
      resolveDepartmentScope(ctx),
      minOccurrences ? Number(minOccurrences) : 3,
    );
  }

  @Get('reports/leave-usage')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Báo cáo sử dụng phép năm (FR-WEB-REP-03)' })
  leaveUsage(@CurrentTenant() ctx: TenantContext, @Query('year') year?: string) {
    return this.reports.leaveUsage(
      ctx.companyId,
      year ? Number(year) : new Date().getUTCFullYear(),
      resolveDepartmentScope(ctx),
    );
  }

  @Get('reports/overtime')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Tổng hợp OT theo nhân viên và phòng ban (FR-WEB-REP-05)' })
  overtime(
    @CurrentTenant() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    this.assertRange(from, to);
    return this.reports.overtimeReport(ctx.companyId, from, to, resolveDepartmentScope(ctx));
  }

  private assertRange(from?: string, to?: string): void {
    if (!from || !to) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Bắt buộc có tham số `from` và `to` (YYYY-MM-DD).',
      });
    }
  }
}

/** FR-APP-STAT — thống kê cá nhân trên App. */
@ApiTags('App · Thống kê')
@ApiBearerAuth()
@Controller('me/stats')
export class MyStatsController {
  constructor(private readonly reports: ReportService) {}

  @Get()
  @ApiOperation({ summary: 'Thống kê chuyên cần & đơn từ của tôi' })
  myStats(
    @CurrentTenant() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    if (!from || !to) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Bắt buộc có tham số `from` và `to` (YYYY-MM-DD).',
      });
    }
    return this.reports.myStats(ctx.companyId, ctx.employeeId, from, to);
  }
}
