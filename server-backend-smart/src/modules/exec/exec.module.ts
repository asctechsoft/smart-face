import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { ExecController } from './exec.controller';
import { ExecService } from './exec.service';

/**
 * Phân hệ điều hành (`/v1/exec/*`) — vế duyệt của Giám đốc / Owner.
 *
 * Phụ thuộc `PayrollModule` MỘT CHIỀU. Chiều ngược lại không tồn tại và không
 * được tạo ra: `PayrollService` không được biết đến sự tồn tại của `/exec`,
 * nếu không thì state machine kỳ công lại phụ thuộc vào tầng trình bày.
 *
 * `AccessModule` và `AuditModule` là Global nên không cần import lại.
 */
@Module({
  imports: [PayrollModule],
  controllers: [ExecController],
  providers: [ExecService],
  exports: [ExecService],
})
export class ExecModule {}
