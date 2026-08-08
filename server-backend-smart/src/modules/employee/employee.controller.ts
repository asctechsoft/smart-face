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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { AppException } from 'src/common/errors';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  ImportExecuteDto,
  ImportValidateDto,
  LifecycleActionDto,
  PreviewCodeDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { EmployeeService } from './employee.service';

/**
 * docs/08-hop-dong-api.md mục 6.2 — Web Quản lý · Nhân sự.
 *
 * Phân quyền theo một quy tắc nhất quán trong cả class:
 *
 * - **MANAGER** chỉ ĐỌC (`list`, `detail`), và chỉ trong phòng ban mình quản lý.
 * - **HR_PAYROLL / COMPANY_ADMIN** mới GHI được.
 *
 * Mọi thao tác ghi đều có `@Audit`. Hồ sơ nhân sự quyết định quyền hạn, tiền
 * lương và khả năng đăng nhập — không thay đổi nào được phép mất dấu vết.
 */
@ApiTags('Web Quản lý · Nhân sự')
@ApiBearerAuth()
@Controller('admin/employees')
export class EmployeeAdminController {
  constructor(private readonly employees: EmployeeService) {}

  @Get()
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Danh sách nhân viên' })
  list(@CurrentTenant() ctx: TenantContext, @Query() query: EmployeeQueryDto) {
    return this.employees.list(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  // POST mà `@HttpCode(200)` vì endpoint này KHÔNG tạo gì cả — chỉ tính thử rồi
  // trả kết quả. Dùng POST thay vì GET vì họ tên đi trong body: tên tiếng Việt
  // có dấu nằm trên URL sẽ bị mã hoá lằng nhằng và lọt vào log truy cập.
  @Post('preview-code')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xem trước mã nhân viên sẽ sinh ra',
    description:
      'Quy tắc `<tên chính><viết tắt họ và tên lót>.<mã công ty>` — VD: Nguyễn Văn Đức @ amobi → ducnv.amobi. Trùng thì thêm số thứ tự: ducnv2.amobi.',
  })
  previewCode(@CurrentTenant() ctx: TenantContext, @Body() dto: PreviewCodeDto) {
    return this.employees.previewCode(ctx.companyId, dto.fullName);
  }

  @Post()
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'EMPLOYEE_CREATE', targetType: 'EMPLOYEE' })
  @ApiOperation({
    summary: 'Tạo hồ sơ nhân viên (Luồng B) và gửi SMS mời',
    description:
      'Nhân viên đăng nhập bằng SĐT này sẽ được nhận diện là đã có hồ sơ và BỎ QUA màn nhập mã mời (FR-APP-AUTH-07).',
  })
  @ApiErrors('AUTH_PHONE_INVALID', 'EMP_PHONE_TAKEN', 'EMP_CODE_TAKEN', 'PLAN_EMPLOYEE_LIMIT_REACHED')
  create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(ctx, dto);
  }

  @Get(':id')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Chi tiết hồ sơ nhân viên' })
  @ApiErrors('EMP_NOT_FOUND')
  detail(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.employees.getById(ctx.companyId, id);
  }

  @Patch(':id')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'EMPLOYEE_UPDATE', targetType: 'EMPLOYEE' })
  @ApiOperation({
    summary: 'Sửa hồ sơ nhân viên',
    description: 'BR-04: mã nhân viên bị khoá sau lần chấm công đầu tiên, không sửa được nữa.',
  })
  @ApiErrors('EMP_NOT_FOUND', 'EMP_CODE_LOCKED', 'EMP_CODE_TAKEN')
  update(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(ctx, id, dto);
  }

  /**
   * Xoá thật, và vì thế chỉ cho phép với hồ sơ chưa từng hoạt động.
   *
   * Hồ sơ `PENDING_ACTIVATION` là hồ sơ HR vừa gõ nhầm, chưa ai đăng nhập, chưa
   * có bản ghi chấm công nào — xoá đi không mất gì. Còn hồ sơ đã kích hoạt thì
   * gắn với dữ liệu chấm công và bảng lương là chứng từ phải lưu theo luật
   * (NFR-LEGAL-08); với họ, đường đúng là `terminate`, không phải `delete`.
   */
  @Delete(':id')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'EMPLOYEE_DELETE', targetType: 'EMPLOYEE' })
  @ApiOperation({
    summary: 'Xoá hồ sơ',
    description: 'CHỈ xoá được hồ sơ PENDING_ACTIVATION. Hồ sơ đã kích hoạt thì tạm ngưng/chấm dứt.',
  })
  @ApiErrors('EMP_NOT_FOUND', 'EMP_DELETE_NOT_ALLOWED')
  remove(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.employees.remove(ctx, id);
  }

  @Post(':id/resend-invite')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi lại SMS mời' })
  @ApiErrors('EMP_NOT_FOUND')
  resendInvite(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.employees.resendInvite(ctx, id);
  }

  // ---------------------------------------------------------------------------
  // Vòng đời
  // ---------------------------------------------------------------------------

  @Post(':id/suspend')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'EMPLOYEE_SUSPEND', targetType: 'EMPLOYEE', requireReason: true })
  @ApiOperation({ summary: 'Tạm ngưng — thu hồi phiên ngay, không cho đăng nhập/chấm công' })
  @ApiErrors('EMP_NOT_FOUND', 'PAY_REASON_REQUIRED')
  suspend(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
  ) {
    return this.employees.suspend(ctx, id, dto.reason);
  }

  @Post(':id/reactivate')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'EMPLOYEE_REACTIVATE', targetType: 'EMPLOYEE', requireReason: true })
  @ApiOperation({ summary: 'Kích hoạt lại nhân viên đang tạm ngưng' })
  @ApiErrors('EMP_NOT_FOUND', 'PAY_REASON_REQUIRED')
  reactivate(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
  ) {
    return this.employees.reactivate(ctx, id, dto.reason);
  }

  @Post(':id/terminate')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'EMPLOYEE_TERMINATE', targetType: 'EMPLOYEE', requireReason: true })
  @ApiOperation({
    summary: 'Chấm dứt hợp đồng',
    description:
      'Thu hồi token + device binding, vô hiệu dữ liệu sinh trắc học (xoá hẳn nếu chính sách bật), nhưng GIỮ bản ghi chấm công và bảng công đã chốt để làm chứng từ (NFR-LEGAL-08).',
  })
  @ApiErrors('EMP_NOT_FOUND', 'PAY_REASON_REQUIRED')
  terminate(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
  ) {
    return this.employees.terminate(ctx, id, dto.reason, dto.effectiveDate);
  }

  // ---------------------------------------------------------------------------
  // Import Excel
  // ---------------------------------------------------------------------------

  // Không có `@Audit` vì bước này không ghi gì vào database — chỉ kiểm tra rồi
  // trả kết quả. Bước `import/execute` mới có audit.
  @Post('import/validate')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kiểm tra file import, trả kết quả THEO TỪNG DÒNG',
    description:
      'Import không bao giờ fail toàn bộ file vì một dòng lỗi. Mã nhân viên sinh ra duy nhất kể cả khi hai người trùng tên trong cùng file. Web parse Excel rồi gửi mảng `rows` lên đây.',
  })
  validateImport(@CurrentTenant() ctx: TenantContext, @Body() dto: ImportValidateDto) {
    return this.employees.validateImport(ctx.companyId, dto.rows);
  }

  @Post('import/execute')
  @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @Audit({ action: 'EMPLOYEE_IMPORT', targetType: 'COMPANY' })
  @ApiOperation({ summary: 'Thực hiện import các dòng hợp lệ và gửi SMS mời hàng loạt' })
  @ApiErrors('PLAN_EMPLOYEE_LIMIT_REACHED')
  executeImport(@CurrentTenant() ctx: TenantContext, @Body() dto: ImportExecuteDto) {
    return this.employees.executeImport(ctx, dto.rows, dto.sendInvite ?? true);
  }
}

/**
 * Hồ sơ cá nhân của nhân viên trên App (FR-APP-PRO-01).
 *
 * Tách hẳn controller thay vì thêm route vào `EmployeeAdminController` vì mô
 * hình quyền khác hẳn: ở đây KHÔNG có `@Roles` — mọi nhân viên đều gọi được,
 * nhưng chỉ đọc được chính mình (`ctx.employeeId` lấy từ JWT, không nhận từ URL).
 * Trộn hai mô hình vào một class là cách nhanh nhất để một ngày nào đó có người
 * thêm route thiếu chốt quyền.
 */
@ApiTags('App · Cá nhân')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Hồ sơ cá nhân của tôi' })
  @ApiErrors('EMP_NOT_FOUND')
  profile(@CurrentTenant() ctx: TenantContext) {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    return this.employees.getMyProfile(ctx.companyId, ctx.employeeId);
  }
}
