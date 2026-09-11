import { Module } from '@nestjs/common';
import { CompanySetupService } from './company-setup.service';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';

/**
 * Khởi tạo nền tảng và khởi tạo tenant (docs/07 §1 · docs/19).
 *
 * Không import module nghiệp vụ nào: `AccessModule`, `AuditModule`, `AuthModule`
 * và hạ tầng đều là Global. Cố ý giữ như vậy — provisioning chạy TRƯỚC khi tenant
 * có bất kỳ dữ liệu nghiệp vụ nào, nên nó không được phụ thuộc vào module nghiệp vụ.
 */
@Module({
  controllers: [ProvisioningController],
  providers: [ProvisioningService, CompanySetupService],
  exports: [ProvisioningService, CompanySetupService],
})
export class ProvisioningModule {}
