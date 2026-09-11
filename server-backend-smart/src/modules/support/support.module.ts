import { Global, Module } from '@nestjs/common';
import { SUPPORT_ACCESS_CHECKER } from 'src/common/guards/tenant.guard';
import { AuditModule } from '../audit/audit.module';
import { SupportAccessController } from './support-access.controller';
import { SupportAccessRepository } from './support-access.repository';
import { SupportAccessService } from './support-access.service';

/**
 * `@Global` vì `TenantGuard` là guard toàn cục: nó được khởi tạo trong ngữ cảnh
 * của `AppModule` nên `SUPPORT_ACCESS_CHECKER` phải nhìn thấy được từ đó.
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [SupportAccessController],
  providers: [
    SupportAccessRepository,
    SupportAccessService,
    { provide: SUPPORT_ACCESS_CHECKER, useExisting: SupportAccessService },
  ],
  exports: [SupportAccessService, SUPPORT_ACCESS_CHECKER],
})
export class SupportModule {}
