import { Module } from '@nestjs/common';
import { BiometricModule } from '../biometric/biometric.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Web Admin — quản trị NỀN TẢNG, không phải quản trị một công ty.
 *
 * Phân biệt rõ với `/admin/*` của Web Quản lý:
 *
 * - `/v1/admin/*`  — COMPANY_ADMIN quản lý công ty MÌNH, luôn bị lọc theo company_id.
 * - `/v1/system/*` — SYSTEM_ADMIN (module này) thao tác XUYÊN công ty: tạo tenant,
 *   khoá tài khoản, đổi gói dịch vụ, xem hàng đợi job.
 *
 * Vì các endpoint ở đây cố tình vượt qua ranh giới tenant nên chúng phải được
 * `@SkipTenant()` một cách có ý thức và chỉ mở cho SYSTEM_ADMIN.
 *
 * Import BiometricModule và PayrollModule để reset dữ liệu sinh trắc và tính lại
 * lương khi hỗ trợ khách hàng — hai việc COMPANY_ADMIN không tự làm được.
 */
@Module({
  imports: [BiometricModule, PayrollModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
