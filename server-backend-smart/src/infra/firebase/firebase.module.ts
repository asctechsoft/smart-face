import { Global, Module } from '@nestjs/common';
import { STORAGE_BUCKET_PROVIDER } from '../storage/storage-bucket.provider';
import { FirebaseService } from './firebase.service';

/**
 * `@Global` vì cả AuthModule (đăng nhập) lẫn EmployeeModule (cấp tài khoản) đều
 * cần — cùng lý do với RedisModule và PrismaModule.
 */
@Global()
@Module({
  providers: [
    FirebaseService,
    // Cùng service account, cùng Firebase App — `StorageService` lấy bucket qua
    // cổng này thay vì import thẳng `FirebaseService`. Lý do ở
    // `storage-bucket.provider.ts`.
    { provide: STORAGE_BUCKET_PROVIDER, useExisting: FirebaseService },
  ],
  exports: [FirebaseService, STORAGE_BUCKET_PROVIDER],
})
export class FirebaseModule {}
