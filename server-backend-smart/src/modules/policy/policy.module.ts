import { Global, Module } from '@nestjs/common';
import { PolicyAdminService } from './policy-admin.service';
import { PolicyController } from './policy.controller';
import { PolicyRepository } from './policy.repository';
import { PolicyService } from './policy.service';

/**
 * Global vì gần như mọi module nghiệp vụ đều cần đọc chính sách công ty
 * (attendance, payroll, request, fraud, biometric).
 */
@Global()
@Module({
  controllers: [PolicyController],
  providers: [PolicyRepository, PolicyService, PolicyAdminService],
  exports: [PolicyRepository, PolicyService, PolicyAdminService],
})
export class PolicyModule {}
