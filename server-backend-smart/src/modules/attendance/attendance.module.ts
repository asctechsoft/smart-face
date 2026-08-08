import { Module, forwardRef } from '@nestjs/common';
import { AttendanceAdminController, ExportJobController } from './attendance-admin.controller';
import { AttendanceAdminService } from './attendance-admin.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { FraudModule } from '../fraud/fraud.module';

/**
 * Chấm công — nghiệp vụ lõi của toàn hệ thống.
 *
 * Tách làm hai tầng controller vì hai đối tượng dùng khác hẳn nhau:
 *
 * - `AttendanceController`      — App Nhân viên tự chấm công cho chính mình.
 * - `AttendanceAdminController` — Web Quản lý xem/hiệu chỉnh công của người khác.
 * - `ExportJobController`       — tra trạng thái job xuất Excel chạy nền.
 *
 * `forwardRef` với FraudModule là bắt buộc: chấm công gọi sang chống gian lận để
 * chấm điểm rủi ro ngay lúc quẹt, còn chống gian lận lại phải đọc lịch sử chấm
 * công để so sánh hành vi. Hai module tham chiếu vòng, không có forwardRef thì
 * Nest không dựng được đồ thị phụ thuộc và chết ngay lúc khởi động.
 */
@Module({
  imports: [forwardRef(() => FraudModule)],
  controllers: [AttendanceController, AttendanceAdminController, ExportJobController],
  providers: [AttendanceService, AttendanceAdminService],
  exports: [AttendanceService, AttendanceAdminService],
})
export class AttendanceModule {}
