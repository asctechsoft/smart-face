import { Module, forwardRef } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { MakeupModule } from '../makeup/makeup.module';
import { PayrollEngineService } from './payroll-engine.service';
import { PayrollController } from './payroll.controller';
import { PayrollRepository } from './payroll.repository';
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
/*
 * `MakeupModule` được import MỘT CHIỀU: engine tính công ghi khoản nợ vào sổ làm
 * bù (docs/04 mục 5.1). Chiều ngược lại KHÔNG tồn tại — `MakeupService` đọc
 * chính sách qua `PolicyService`, không gọi sang payroll — nên không cần
 * `forwardRef` và cũng không được tạo ra chiều đó về sau.
 */
@Module({
  imports: [forwardRef(() => FraudModule), MakeupModule],
  controllers: [PayrollController],
  providers: [PayrollRepository, PayrollService, PayrollEngineService],
  exports: [PayrollRepository, PayrollService, PayrollEngineService],
})
export class PayrollModule {}
