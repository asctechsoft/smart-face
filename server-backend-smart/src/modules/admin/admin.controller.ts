import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { CompanyStatus, SystemRole } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Audit, CurrentUser, Roles, SkipTenant } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import type { RequestContext } from 'src/common/types/request-context';
import { AuditLogQueryDto } from '../audit/dto/audit.dto';
import { AuditService } from '../audit/audit.service';
import { SystemUserQueryDto, TenantQueryDto } from './dto/admin-query.dto';
import { PayrollService } from '../payroll/payroll.service';
import { TenantService } from '../tenant/tenant.service';
import { AdminService } from './admin.service';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * Tạo công ty mới trên nền tảng — thao tác của SYSTEM_ADMIN khi ký hợp đồng.
 */
class CreateTenantDto {
  @ApiProperty({ example: 'Công ty AMOBI' })
  @IsString()
  @Length(2, 200)
  name!: string;

  /**
   * ⚠ BẤT BIẾN suốt vòng đời công ty. Không có endpoint nào đổi được.
   *
   * Mã này nằm trong mọi mã nhân viên (`ducnv.amobi`), mà mã nhân viên lại bị
   * khoá sau lần chấm công đầu tiên (BR-04). Đổi mã công ty nghĩa là hoặc phải
   * đổi mã của toàn bộ nhân viên — thứ đã tuyên bố là không đổi được — hoặc để
   * mã cũ và mã mới tồn tại song song, không ai còn hiểu mã nào thuộc về đâu.
   */
  @ApiProperty({ example: 'amobi', description: 'BẤT BIẾN suốt vòng đời — nằm trong mọi employee code' })
  @IsString()
  @Length(2, 32)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional({ default: 'Asia/Ho_Chi_Minh' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planId?: string;
}

/**
 * Lớp cơ sở cho mọi thao tác quản trị nền tảng — A3: luôn phải có lý do.
 *
 * Kế thừa thay vì lặp lại trường `reason` ở từng DTO, để không thể có endpoint
 * quản trị nào lỡ quên mất chốt này. SYSTEM_ADMIN là vai trò mạnh nhất hệ thống,
 * thao tác được lên dữ liệu của mọi công ty — mỗi lần dùng quyền đó đều phải
 * giải trình được, kể cả khi làm đúng.
 */
class ReasonDto {
  @ApiProperty({ minLength: 10, description: 'A3: bắt buộc nhập lý do trước khi thực thi' })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

class BlockUserDto extends ReasonDto {
  @ApiProperty()
  @IsBoolean()
  blocked!: boolean;
}

class ResetBiometricDto extends ReasonDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  resetFace?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  resetFingerprint?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  revokeDevices?: boolean;

  @ApiProperty({
    example: 'ducnv.amobi',
    description: 'Xác nhận hai bước — phải khớp mã nhân viên của tài khoản',
  })
  @IsString()
  confirmEmployeeCode!: string;
}

class RevokeDeviceDto extends ReasonDto {
  @ApiProperty()
  @IsString()
  deviceId!: string;
}

class ChangePhoneDto extends ReasonDto {
  @ApiProperty({ example: '0909999999' })
  @IsString()
  newPhone!: string;
}

class AssignPlanDto extends ReasonDto {
  @ApiProperty()
  @IsString()
  planId!: string;
}

class UpsertPlanDto {
  @ApiProperty({ example: 'Pro' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'null = không giới hạn' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxEmployees?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxBranches?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRecognitionsPerMonth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  storageGb?: number;

  @ApiPropertyOptional({ default: 90 })
  @IsOptional()
  @IsInt()
  photoRetentionDays?: number;

  @ApiPropertyOptional({ example: { rotatingShift: true, ot: true, multiBranch: false } })
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pricePerMonth?: number;
}

class DeployModelDto extends ReasonDto {}

class RegisterModelDto {
  @ApiProperty({ example: 'buffalo_l' })
  @IsString()
  name!: string;

  @ApiProperty({ example: '2.1' })
  @IsString()
  version!: string;

  @ApiPropertyOptional({ description: 'FAR đo trên tập kiểm định' })
  @IsOptional()
  @IsNumber()
  farMeasured?: number;

  @ApiPropertyOptional({ description: 'FRR đo trên tập kiểm định' })
  @IsOptional()
  @IsNumber()
  frrMeasured?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  latencyP95Ms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  defaultMatchThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  defaultLivenessThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

class SystemConfigDto extends ReasonDto {
  @ApiProperty({ example: { 'otp.ttlSeconds': 300, 'ai.timeoutMs': 2000 } })
  @IsObject()
  config!: Record<string, unknown>;
}

class MaintenanceDto extends ReasonDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endAt?: string;
}

class InterveneRecalculateDto extends ReasonDto {
  @ApiProperty()
  @IsString()
  companyId!: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to!: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * docs/08-hop-dong-api.md mục 7 — Web Admin (`/system/*`).
 *
 * Toàn bộ endpoint yêu cầu SYSTEM_ADMIN và bỏ qua TenantGuard vì phạm vi là
 * toàn hệ thống. A1: mọi truy cập dữ liệu công ty cụ thể đều ghi audit.
 */
@ApiTags('Web Admin · Hệ thống')
@ApiBearerAuth()
@Controller('system')
// Hai decorator này đặt ở CẤP CLASS, không phải từng phương thức — đây là quyết
// định an toàn quan trọng nhất của file. Với 40+ endpoint, khai lẻ từng cái thì
// chỉ cần một lần quên `@Roles` là mở một endpoint xuyên tenant cho bất kỳ ai
// đăng nhập. Đặt ở class thì endpoint mới thêm sau này mặc định đã được khoá.
@Roles(SystemRole.SYSTEM_ADMIN)
// `@SkipTenant()` bỏ qua TenantGuard một cách CÓ Ý THỨC: đây đúng là nơi duy
// nhất được phép nhìn xuyên qua ranh giới công ty. Đổi lại, `@Audit` phải có ở
// mọi thao tác chạm vào dữ liệu của một công ty cụ thể (A1).
@SkipTenant()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    private readonly payroll: PayrollService,
  ) {}

  // --- Tenant ---------------------------------------------------------------

  @Get('tenants')
  @ApiOperation({ summary: 'Danh sách tenant' })
  listTenants(@Query() query: TenantQueryDto) {
    return this.tenants.listTenants(query);
  }

  @Post('tenants')
  @Audit({ action: 'TENANT_CREATE', targetType: 'COMPANY' })
  @ApiOperation({
    summary: 'Tạo tenant mới',
    description: 'Mã công ty BẤT BIẾN suốt vòng đời vì nằm trong mọi employee code đã sinh.',
  })
  @ApiErrors('TEN_CODE_TAKEN')
  createTenant(@CurrentUser() ctx: RequestContext, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(ctx, dto);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Chi tiết tenant' })
  @ApiErrors('TEN_NOT_FOUND')
  async getTenant(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    // A1: Admin xem dữ liệu của một công ty cụ thể → ghi audit.
    await this.audit.recordCrossTenantAccess(ctx, id, 'tenant-detail');
    return this.tenants.getTenant(id);
  }

  @Get('tenants/:id/usage')
  @ApiOperation({ summary: 'Thống kê sử dụng theo tenant (FR-ADM-TEN-07)' })
  async usage(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.audit.recordCrossTenantAccess(ctx, id, 'tenant-usage');
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    return this.tenants.getUsage(id, start, end);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'TENANT_SUSPEND', targetType: 'COMPANY', requireReason: true })
  @ApiOperation({
    summary: 'Tạm ngưng công ty',
    description:
      'Nhân viên không đăng nhập/chấm công được ngay, nhưng DỮ LIỆU GIỮ NGUYÊN — khôi phục được khi thanh toán.',
  })
  @ApiErrors('TEN_NOT_FOUND', 'PAY_REASON_REQUIRED')
  suspendTenant(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.tenants.suspendTenant(ctx, id, dto.reason);
  }

  @Post('tenants/:id/activate')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'TENANT_ACTIVATE', targetType: 'COMPANY', requireReason: true })
  @ApiOperation({ summary: 'Kích hoạt lại công ty' })
  activateTenant(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.tenants.activateTenant(ctx, id, dto.reason);
  }

  @Post('tenants/:id/plan')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'TENANT_PLAN_CHANGE', targetType: 'COMPANY', requireReason: true })
  @ApiOperation({ summary: 'Gán gói dịch vụ cho tenant' })
  assignPlan(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: AssignPlanDto,
  ) {
    return this.tenants.assignPlan(ctx, id, dto.planId, dto.reason);
  }

  // --- Gói dịch vụ ----------------------------------------------------------

  @Get('plans')
  @ApiOperation({ summary: 'Danh sách gói dịch vụ' })
  listPlans() {
    return this.tenants.listPlans();
  }

  @Put('plans')
  @Audit({ action: 'PLAN_UPSERT', targetType: 'PLAN' })
  @ApiOperation({
    summary: 'Tạo/cập nhật gói dịch vụ',
    description: 'Giới hạn gói được enforce ở tầng Backend, không chỉ ẩn nút ở UI (FR-ADM-TEN-04).',
  })
  upsertPlan(@Body() dto: UpsertPlanDto) {
    return this.tenants.upsertPlan(dto as never);
  }

  // --- Người dùng -----------------------------------------------------------

  @Get('users')
  @ApiOperation({ summary: 'Tìm kiếm tài khoản toàn hệ thống (FR-ADM-USR-01)' })
  searchUsers(@Query() query: SystemUserQueryDto) {
    return this.admin.searchUsers(query);
  }

  @Get('users/:id/activity')
  @ApiOperation({ summary: 'Lịch sử hoạt động của một tài khoản (FR-ADM-USR-07)' })
  @ApiErrors('SYS_NOT_FOUND')
  userActivity(@Param('id') id: string) {
    return this.admin.getUserActivity(id);
  }

  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'USER_BLOCK', targetType: 'USER', requireReason: true })
  @ApiOperation({ summary: 'Khoá / mở khoá tài khoản' })
  @ApiErrors('SYS_NOT_FOUND', 'PAY_REASON_REQUIRED')
  blockUser(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: BlockUserDto,
  ) {
    return this.admin.blockUser(ctx, id, dto.blocked, dto.reason);
  }

  @Post('users/:id/reset-biometric')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'BIOMETRIC_RESET', targetType: 'USER', requireReason: true })
  @ApiOperation({
    summary: 'Reset sinh trắc học của một tài khoản',
    description:
      'Điểm tấn công NỘI BỘ nguy hiểm nhất — Admin có thể reset khuôn mặt của bất kỳ ai rồi đăng ký khuôn mặt khác. Vì vậy: bắt buộc lý do, XÁC NHẬN HAI BƯỚC bằng employeeCode, ghi audit, và tự động thông báo cho nhân viên + HR công ty.',
  })
  @ApiErrors('SYS_VALIDATION_ERROR', 'EMP_NOT_FOUND', 'PAY_REASON_REQUIRED')
  resetBiometric(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ResetBiometricDto,
  ) {
    return this.admin.resetBiometric(ctx, id, {
      resetFace: dto.resetFace ?? true,
      resetFingerprint: dto.resetFingerprint ?? true,
      revokeDevices: dto.revokeDevices ?? true,
      reason: dto.reason,
      confirmEmployeeCode: dto.confirmEmployeeCode,
    });
  }

  @Post('users/:id/revoke-device')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'DEVICE_REVOKE', targetType: 'USER', requireReason: true })
  @ApiOperation({ summary: 'Thu hồi liên kết thiết bị (FR-ADM-USR-04)' })
  revokeDevice(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RevokeDeviceDto,
  ) {
    return this.admin.revokeDevice(ctx, id, dto.deviceId, dto.reason);
  }

  @Post('users/:id/change-phone')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'USER_PHONE_CHANGE', targetType: 'USER', requireReason: true })
  @ApiOperation({ summary: 'Đổi số điện thoại của tài khoản (FR-ADM-USR-05)' })
  @ApiErrors('SYS_NOT_FOUND', 'EMP_PHONE_TAKEN')
  changePhone(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ChangePhoneDto,
  ) {
    return this.admin.changePhone(ctx, id, dto.newPhone, dto.reason);
  }

  // --- AI Server ------------------------------------------------------------

  @Get('ai/metrics')
  @ApiOperation({ summary: 'Chỉ số AI Server + thống kê nhận diện 24h (FR-ADM-AI-01..03)' })
  aiMetrics() {
    return this.admin.aiMetrics();
  }

  @Get('ai/models')
  @ApiOperation({ summary: 'Danh sách phiên bản model' })
  listModels() {
    return this.admin.listAiModels();
  }

  @Post('ai/models')
  @Audit({ action: 'AI_MODEL_REGISTER', targetType: 'AI_MODEL' })
  @ApiOperation({
    summary: 'Đăng ký phiên bản model kèm kết quả đo FAR/FRR',
    description: 'Chỉ triển khai model nếu FAR/FRR KHÔNG XẤU ĐI so với model hiện tại (docs/05 mục 3.2).',
  })
  registerModel(@Body() dto: RegisterModelDto) {
    return this.admin.registerAiModel(dto);
  }

  @Post('ai/models/:id/deploy')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'AI_MODEL_DEPLOY', targetType: 'AI_MODEL', requireReason: true })
  @ApiOperation({
    summary: 'Triển khai model',
    description:
      'Đổi model làm THAY ĐỔI phân bố điểm tương đồng — phải hiệu chỉnh lại ngưỡng cùng lúc, không đổi riêng lẻ.',
  })
  @ApiErrors('SYS_NOT_FOUND', 'PAY_REASON_REQUIRED')
  deployModel(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: DeployModelDto,
  ) {
    return this.admin.deployAiModel(ctx, id, dto.reason);
  }

  @Post('ai/models/:id/rollback')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'AI_MODEL_ROLLBACK', targetType: 'AI_MODEL', requireReason: true })
  @ApiOperation({ summary: 'Rollback về phiên bản model trước' })
  rollbackModel(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: DeployModelDto,
  ) {
    return this.admin.rollbackAiModel(ctx, id, dto.reason);
  }

  // --- Cấu hình & vận hành --------------------------------------------------

  @Get('config')
  @ApiOperation({ summary: 'Cấu hình chung của hệ thống (FR-ADM-CFG)' })
  getConfig() {
    return this.admin.getSystemConfig();
  }

  @Put('config')
  @Audit({ action: 'SYSTEM_CONFIG_UPDATE', targetType: 'SYSTEM', requireReason: true })
  @ApiOperation({ summary: 'Cập nhật cấu hình chung' })
  setConfig(@CurrentUser() ctx: RequestContext, @Body() dto: SystemConfigDto) {
    return this.admin.setSystemConfig(ctx, dto.config as never, dto.reason);
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check từng thành phần (FR-ADM-OPS-03)' })
  health() {
    return this.admin.healthCheck();
  }

  @Get('queues')
  @ApiOperation({ summary: 'Trạng thái hàng đợi (FR-ADM-OPS-05)' })
  queues() {
    return this.admin.queueStatus();
  }

  @Post('queues/:name/retry')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'QUEUE_RETRY', targetType: 'SYSTEM' })
  @ApiOperation({ summary: 'Retry các job lỗi của một hàng đợi' })
  @ApiErrors('SYS_NOT_FOUND')
  retryQueue(@Param('name') name: string, @Query('limit') limit?: string) {
    return this.admin.retryFailedJobs(name, limit ? Number(limit) : 100);
  }

  @Post('maintenance')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'SYSTEM_MAINTENANCE', targetType: 'SYSTEM', requireReason: true })
  @ApiOperation({
    summary: 'Bật/tắt chế độ bảo trì',
    description: 'TRÁNH bảo trì trong khung giờ cao điểm 07:30–09:00 và 17:00–18:30.',
  })
  maintenance(@CurrentUser() ctx: RequestContext, @Body() dto: MaintenanceDto) {
    return this.admin.setMaintenance(ctx, dto);
  }

  @Post('recalculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'ADMIN_RECALCULATE', targetType: 'COMPANY', requireReason: true })
  @ApiOperation({
    summary: 'Can thiệp: chạy lại tính công cho một công ty (FR-ADM-OPS-04)',
    description:
      'A2 — Admin KHÔNG tự ý sửa dữ liệu chấm công. Thao tác này chỉ TÍNH LẠI từ bản ghi thô, không thay đổi bản ghi gốc, và luôn có audit log.',
  })
  async intervene(@CurrentUser() ctx: RequestContext, @Body() dto: InterveneRecalculateDto) {
    await this.audit.recordCrossTenantAccess(ctx, dto.companyId, 'payroll-recalculate');
    return this.payroll.requestRecalculateRange(dto.companyId, dto.from, dto.to);
  }

  // --- Bảo mật & audit ------------------------------------------------------

  @Get('security/alerts')
  @ApiOperation({ summary: 'Cảnh báo bảo mật 24h gần nhất (FR-ADM-SEC-02..04)' })
  securityAlerts() {
    return this.admin.securityAlerts();
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Tra cứu audit log xuyên tenant (FR-ADM-SEC-06)',
    description: 'Bảng audit_log là APPEND-ONLY, không sửa/xoá được kể cả bởi Admin hệ thống.',
  })
  auditLogs(@Query() query: AuditLogQueryDto) {
    // Admin hệ thống được tra cứu xuyên tenant → không ép scope companyId.
    return this.audit.search(query);
  }
}
