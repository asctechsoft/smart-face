import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Nhật ký kiểm toán — ai làm gì, lúc nào, từ đâu.
 *
 * `@Global()` vì `AuditInterceptor` chạy ở phạm vi toàn ứng dụng và cần
 * `AuditService` ở mọi request, bất kể request đó thuộc module nghiệp vụ nào.
 * Không đặt Global thì interceptor toàn cục không giải được phụ thuộc.
 *
 * Bảng `AuditLog` chỉ ghi thêm, không sửa không xoá — mất tính bất biến thì
 * nhật ký không còn giá trị đối chứng khi có tranh chấp.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
