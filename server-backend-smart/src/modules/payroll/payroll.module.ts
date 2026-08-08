import { Module, forwardRef } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { PayrollEngineService } from './payroll-engine.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/**
 * Tính công và lương.
 *
 * Tách `PayrollEngineService` khỏi `PayrollService` một cách có chủ đích:
 *
 * - `PayrollEngineService` — hàm thuần tuý tính toán: giờ công, đi muộn, OT,
 *   nghỉ phép. Không chạm DB nên test được bằng dữ liệu dựng sẵn, và đây là
 *   nơi ra tiền lương nên phải kiểm chứng được từng trường hợp biên.
 * - `PayrollService`        — điều phối: đọc DB, gọi engine, ghi kết quả, chốt kỳ.
 *
 * `forwardRef` với FraudModule: chốt kỳ lương phải kiểm tra còn cờ gian lận nào
 * chưa xử lý không (trả lương cho lượt chấm công gian lận là mất tiền thật), còn
 * FraudModule lại tham chiếu ngược về đây.
 */
@Module({
  imports: [forwardRef(() => FraudModule)],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollEngineService],
  exports: [PayrollService, PayrollEngineService],
})
export class PayrollModule {}
