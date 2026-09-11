import { Global, Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';

/**
 * Phân quyền Role × Permission × Scope (docs/08 §2 · E-V21.1).
 *
 * `@Global()` vì `PermissionGuard` được đăng ký làm `APP_GUARD` toàn cục nên
 * phải giải được `AccessService` mà không cần mọi module nghiệp vụ import lại —
 * cùng lý do với `PolicyModule` và `AuditModule`.
 */
@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessRepository, AccessService],
  exports: [AccessRepository, AccessService],
})
export class AccessModule {}
