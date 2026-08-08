import { Module, forwardRef } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { FraudController } from './fraud.controller';
import { FraudService } from './fraud.service';

/**
 * forwardRef vì hai chiều phụ thuộc nhau một cách có chủ đích:
 *   - AttendanceService gọi FraudService để chấm điểm rủi ro mỗi lượt chấm công.
 *   - FraudController gọi AttendanceAdminService khi huỷ công nghi vấn (AF-23).
 */
@Module({
  imports: [forwardRef(() => AttendanceModule)],
  controllers: [FraudController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
