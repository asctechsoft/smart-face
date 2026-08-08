import { Global, Module } from '@nestjs/common';
import { CompanyController } from './tenant.controller';
import { TenantService } from './tenant.service';

/**
 * Công ty (tenant) — thông tin công ty, gói dịch vụ, giới hạn theo gói.
 *
 * `@Global()` vì `TenantGuard` chạy toàn cục và mỗi request đều phải tra xem
 * công ty còn hoạt động không, gói dịch vụ có mở tính năng đang gọi không.
 *
 * Lưu ý tên: class là `CompanyController` nhưng file đặt là `tenant.controller.ts`.
 * "Tenant" là góc nhìn kỹ thuật (một đơn vị cách ly dữ liệu), "Company" là góc
 * nhìn người dùng — URL và Swagger dùng từ người dùng hiểu được.
 */
@Global()
@Module({
  controllers: [CompanyController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
