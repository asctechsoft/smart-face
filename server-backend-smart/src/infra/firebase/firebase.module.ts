import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service';

/**
 * `@Global` vì cả AuthModule (đăng nhập) lẫn EmployeeModule (cấp tài khoản) đều
 * cần — cùng lý do với RedisModule và PrismaModule.
 */
@Global()
@Module({
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class FirebaseModule {}
