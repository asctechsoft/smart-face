import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import {
  BulkShiftAssignmentDto,
  ClearShiftAssignmentDto,
  ShiftAssignmentQueryDto,
  UpdatePoliciesDto,
  UpsertBranchDto,
  UpsertDepartmentDto,
  UpsertHolidayDto,
  UpsertLeavePolicyDto,
  UpsertShiftDto,
} from './dto/policy.dto';
import { PolicyAdminService } from './policy-admin.service';
import { PolicyService } from './policy.service';
import { POLICY_DEFAULTS, PolicyKeys } from './policy.constants';

/**
 * docs/08-hop-dong-api.md mục 6.3 — cấu hình chính sách công ty.
 *
 * Gom vào một chỗ MỌI thứ mà công ty tự cấu hình được (BR-12): ngưỡng chính
 * sách, ca làm việc, ngày lễ, chi nhánh, phòng ban. Nói cách khác, đây là nơi
 * định nghĩa "luật chơi" mà module chấm công và tính lương chỉ việc áp dụng.
 *
 * MANAGER ĐỌC được chính sách (cần biết luật để giải thích cho cấp dưới) nhưng
 * không SỬA được — mọi endpoint ghi đều chỉ mở cho COMPANY_ADMIN / HR_PAYROLL và
 * đều có `@Audit`. Đổi ngưỡng đi muộn là đổi tiền lương của cả công ty.
 */
@ApiTags('Web Quản lý · Chính sách')
@ApiBearerAuth()
@Controller('admin')
export class PolicyController {
  constructor(
    private readonly policy: PolicyService,
    private readonly admin: PolicyAdminService,
  ) {}

  // ---------------------------------------------------------------------------
  // Chính sách key-value (BR-12)
  // ---------------------------------------------------------------------------

  @Get('policies')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({
    summary: 'Toàn bộ chính sách đang hiệu lực của công ty',
    description:
      'Trả về giá trị đã trộn giữa CompanyPolicy và giá trị mặc định, kèm danh mục khoá hợp lệ để UI dựng form động.',
  })
  async getPolicies(@CurrentTenant() ctx: TenantContext) {
    const [resolved] = await Promise.all([this.policy.resolveAll(ctx.companyId)]);
    // Trả kèm `availableKeys` và `defaults` để Web dựng form ĐỘNG: thêm một
    // chính sách mới ở backend là giao diện tự có thêm ô nhập, không phải build
    // lại frontend. `defaults` cũng cho người dùng thấy giá trị gốc là gì để so
    // với giá trị công ty mình đã đổi.
    return {
      policies: resolved,
      availableKeys: Object.values(PolicyKeys),
      defaults: POLICY_DEFAULTS,
    };
  }

  @Put('policies')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'POLICY_UPDATE', targetType: 'COMPANY' })
  @ApiOperation({
    summary: 'Cập nhật chính sách công ty',
    description:
      'D6: không ghi đè — đóng bản cũ bằng effectiveTo và tạo bản mới, để tính lại công quá khứ vẫn ra đúng số. NFR-LEGAL-05: chặn hệ số OT dưới mức luật định.',
  })
  @ApiErrors('POL_VIOLATES_LABOR_LAW', 'AUTH_FORBIDDEN')
  async updatePolicies(@CurrentTenant() ctx: TenantContext, @Body() dto: UpdatePoliciesDto) {
    await this.policy.setMany(
      ctx.companyId,
      dto.policies as Record<string, never>,
      ctx.userId,
      dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
    );
    return { updated: Object.keys(dto.policies).length };
  }

  // ---------------------------------------------------------------------------
  // Ca làm việc
  // ---------------------------------------------------------------------------

  @Get('shifts')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({ summary: 'Danh sách ca làm việc' })
  listShifts(@CurrentTenant() ctx: TenantContext) {
    return this.admin.listShifts(ctx.companyId);
  }

  @Post('shifts')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'SHIFT_CREATE', targetType: 'SHIFT' })
  @ApiOperation({ summary: 'Tạo ca làm việc' })
  @ApiErrors('POL_INVALID_TIME_FORMAT')
  createShift(@CurrentTenant() ctx: TenantContext, @Body() dto: UpsertShiftDto) {
    return this.admin.createShift(ctx.companyId, dto);
  }

  @Put('shifts/:id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'SHIFT_UPDATE', targetType: 'SHIFT' })
  @ApiOperation({
    summary: 'Cập nhật ca làm việc',
    description:
      'Đổi giờ ca đã được phân → tạo phiên bản mới theo hiệu lực thời gian, không sửa đè (bẫy "đổi cấu hình ca giữa tháng" — docs/04 mục 6.4).',
  })
  @ApiErrors('POL_SHIFT_NOT_FOUND', 'POL_INVALID_TIME_FORMAT')
  updateShift(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpsertShiftDto,
  ) {
    return this.admin.updateShift(ctx.companyId, id, dto);
  }

  @Delete('shifts/:id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'SHIFT_DELETE', targetType: 'SHIFT' })
  @ApiOperation({ summary: 'Xoá ca làm việc (soft delete)' })
  @ApiErrors('POL_SHIFT_NOT_FOUND')
  deleteShift(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.admin.deleteShift(ctx.companyId, id);
  }

  /**
   * Lịch phân ca của một khoảng ngày — FR-WEB-HR-03.
   *
   * `@DepartmentScoped()` chứ không chỉ `@Roles`: quản lý phòng A xếp ca được,
   * nhưng chỉ cho người phòng A. Guard chặn việc lọc sang phòng khác, còn phạm
   * vi thực sự do service chèn vào truy vấn (docs/04 mục 1).
   */
  @Get('shift-assignments')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Bảng phân ca theo khoảng ngày (FR-WEB-HR-03)',
    description:
      'Trả về nhân viên trong phạm vi (có phân trang), bản ghi phân ca và ngày lễ rơi vào khoảng — đủ để dựng lịch trong một lượt gọi.',
  })
  @ApiErrors('SYS_VALIDATION_ERROR')
  listAssignments(@CurrentTenant() ctx: TenantContext, @Query() query: ShiftAssignmentQueryDto) {
    return this.admin.getShiftBoard(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Post('shift-assignments/bulk')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @Audit({ action: 'SHIFT_ASSIGN_BULK', targetType: 'SHIFT' })
  @ApiOperation({ summary: 'Phân ca hàng loạt (FR-WEB-HR-04)' })
  @ApiErrors('POL_SHIFT_NOT_FOUND')
  bulkAssign(@CurrentTenant() ctx: TenantContext, @Body() dto: BulkShiftAssignmentDto) {
    return this.admin.bulkAssignShifts(ctx.companyId, dto, ctx.userId);
  }

  /**
   * Dùng POST chứ không phải DELETE: thao tác nhận một danh sách nhân viên và
   * một khoảng ngày trong body. `DELETE` kèm body được nhiều proxy và thư viện
   * HTTP cắt bỏ âm thầm — request tới nơi với body rỗng thì `employeeIds` trống,
   * và tuỳ cách viết truy vấn, kết quả có thể là xoá lịch của cả công ty.
   */
  @Post('shift-assignments/clear')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'SHIFT_ASSIGN_CLEAR', targetType: 'SHIFT' })
  @ApiOperation({ summary: 'Xoá phân ca trong một khoảng ngày (FR-WEB-HR-04)' })
  clearAssignments(@CurrentTenant() ctx: TenantContext, @Body() dto: ClearShiftAssignmentDto) {
    return this.admin.clearShiftAssignments(ctx.companyId, dto);
  }

  // ---------------------------------------------------------------------------
  // Chính sách phép năm (FR-WEB-POL-07, FR-WEB-POL-08)
  // ---------------------------------------------------------------------------

  @Get('leave-policies')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({
    summary: 'Chính sách phép năm theo loại hợp đồng',
    description:
      'Gồm cả các bản đã bị đóng (`effectiveTo` khác null) để tra cứu số phép đã cấp ở kỳ trước được tính theo luật nào.',
  })
  listLeavePolicies(@CurrentTenant() ctx: TenantContext) {
    return this.admin.listLeavePolicies(ctx.companyId);
  }

  @Put('leave-policies')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'LEAVE_POLICY_UPDATE', targetType: 'COMPANY' })
  @ApiOperation({
    summary: 'Tạo phiên bản mới của chính sách phép năm',
    description:
      'D6: đóng bản đang hiệu lực rồi mở bản mới, không ghi đè. NFR-LEGAL-07: chặn mức dưới 12 ngày/năm.',
  })
  @ApiErrors('POL_LEAVE_BELOW_STATUTORY')
  upsertLeavePolicy(@CurrentTenant() ctx: TenantContext, @Body() dto: UpsertLeavePolicyDto) {
    return this.admin.upsertLeavePolicy(ctx.companyId, dto);
  }

  // ---------------------------------------------------------------------------
  // Ngày lễ
  // ---------------------------------------------------------------------------

  @Get('holidays')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({ summary: 'Danh mục ngày lễ' })
  listHolidays(@CurrentTenant() ctx: TenantContext, @Query('year') year?: string) {
    return this.admin.listHolidays(ctx.companyId, year ? Number(year) : undefined);
  }

  @Post('holidays')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'HOLIDAY_UPSERT', targetType: 'HOLIDAY' })
  @ApiOperation({ summary: 'Thêm/cập nhật ngày lễ (hỗ trợ ngày nghỉ bù)' })
  upsertHoliday(@CurrentTenant() ctx: TenantContext, @Body() dto: UpsertHolidayDto) {
    return this.admin.upsertHoliday(ctx.companyId, dto);
  }

  @Delete('holidays/:id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'HOLIDAY_DELETE', targetType: 'HOLIDAY' })
  @ApiOperation({ summary: 'Xoá ngày lễ' })
  deleteHoliday(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.admin.deleteHoliday(ctx.companyId, id);
  }

  // ---------------------------------------------------------------------------
  // Chi nhánh & phòng ban
  // ---------------------------------------------------------------------------

  @Get('branches')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({ summary: 'Danh sách chi nhánh kèm cấu hình geofence' })
  listBranches(@CurrentTenant() ctx: TenantContext) {
    return this.admin.listBranches(ctx.companyId);
  }

  @Post('branches')
  @Roles(SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'BRANCH_CREATE', targetType: 'BRANCH' })
  @ApiOperation({ summary: 'Tạo chi nhánh' })
  @ApiErrors('PLAN_BRANCH_LIMIT_REACHED')
  createBranch(@CurrentTenant() ctx: TenantContext, @Body() dto: UpsertBranchDto) {
    return this.admin.createBranch(ctx.companyId, dto);
  }

  @Patch('branches/:id')
  @Roles(SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'BRANCH_UPDATE', targetType: 'BRANCH' })
  @ApiOperation({ summary: 'Cập nhật chi nhánh / bán kính geofence' })
  @ApiErrors('POL_BRANCH_NOT_FOUND')
  updateBranch(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpsertBranchDto,
  ) {
    return this.admin.updateBranch(ctx.companyId, id, dto);
  }

  @Get('departments')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({ summary: 'Danh sách phòng ban' })
  listDepartments(@CurrentTenant() ctx: TenantContext) {
    return this.admin.listDepartments(ctx.companyId);
  }

  @Post('departments')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'DEPARTMENT_CREATE', targetType: 'DEPARTMENT' })
  @ApiOperation({ summary: 'Tạo phòng ban' })
  createDepartment(@CurrentTenant() ctx: TenantContext, @Body() dto: UpsertDepartmentDto) {
    return this.admin.createDepartment(ctx.companyId, dto);
  }

  @Patch('departments/:id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'DEPARTMENT_UPDATE', targetType: 'DEPARTMENT' })
  @ApiOperation({ summary: 'Cập nhật phòng ban' })
  @ApiErrors('POL_DEPARTMENT_NOT_FOUND')
  updateDepartment(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpsertDepartmentDto,
  ) {
    return this.admin.updateDepartment(ctx.companyId, id, dto);
  }
}
