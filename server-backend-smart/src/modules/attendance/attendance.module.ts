import { Module, forwardRef } from '@nestjs/common';
import { AttendanceAdminController, ExportJobController } from './attendance-admin.controller';
import { AttendanceAdminService } from './attendance-admin.service';
import { AttendanceSheetController } from './attendance-sheet.controller';
import { AttendanceSheetRepository } from './attendance-sheet.repository';
import { AttendanceSheetService } from './attendance-sheet.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';
import { WorkStatusController } from './work-status.controller';
import { WorkStatusRepository } from './work-status.repository';
import { WorkStatusService } from './work-status.service';
import { FraudModule } from '../fraud/fraud.module';
import { PayrollModule } from '../payroll/payroll.module';

/**
 * Chấm công — nghiệp vụ lõi của toàn hệ thống.
 *
 * Tách làm hai tầng controller vì hai đối tượng dùng khác hẳn nhau:
 *
 * - `AttendanceController`      — App Nhân viên tự chấm công cho chính mình.
 * - `AttendanceAdminController` — Web Quản lý xem/hiệu chỉnh công của người khác.
 * - `AttendanceSheetController` — bảng chấm công theo tháng × phòng ban, lưới người × ngày.
 * - `WorkStatusController`      — theo dõi công việc trong ngày, lưới người × giờ.
 * - `ExportJobController`       — tra trạng thái job xuất Excel chạy nền.
 *
 * `WorkStatusController` cùng dữ liệu nhưng khác TRỤC với bảng chấm công: bảng
 * đọc cả tháng từ `AttendanceDaily` (đã tính) để trả lời "ai thiếu công", còn
 * theo dõi đọc một ngày từ `AttendanceLog` (thô) để trả lời "bây giờ ai đang ở
 * đâu" — câu hỏi mà bảng đã tính không giữ đủ thông tin để trả lời.
 *
 * `forwardRef` với FraudModule là bắt buộc: chấm công gọi sang chống gian lận để
 * chấm điểm rủi ro ngay lúc quẹt, còn chống gian lận lại phải đọc lịch sử chấm
 * công để so sánh hành vi. Hai module tham chiếu vòng, không có forwardRef thì
 * Nest không dựng được đồ thị phụ thuộc và chết ngay lúc khởi động.
 */
/*
 * `PayrollModule` phải qua `forwardRef`, dù payroll KHÔNG gọi ngược về đây.
 *
 * Vòng phụ thuộc đi đường vòng qua chống gian lận:
 *
 *     AttendanceModule → PayrollModule → FraudModule → AttendanceModule
 *
 * Ở tầng ES module, một trong ba binding sẽ còn `undefined` vào lúc Nest đọc
 * mảng `imports`, và ứng dụng chết ngay khi khởi động với thông báo "module at
 * index [1] is undefined" — không phải lỗi biên dịch, nên TypeScript không bắt được.
 *
 * Attendance cần PayrollModule cho nút "Cập nhật bảng công": nó gọi
 * `PayrollService.runTrackedRecalculate` để tính lại đúng thành viên của bảng.
 */
@Module({
  imports: [forwardRef(() => FraudModule), forwardRef(() => PayrollModule)],
  controllers: [
    AttendanceController,
    AttendanceAdminController,
    AttendanceSheetController,
    WorkStatusController,
    ExportJobController,
  ],
  providers: [
    AttendanceRepository,
    AttendanceService,
    AttendanceAdminService,
    AttendanceSheetRepository,
    AttendanceSheetService,
    WorkStatusRepository,
    WorkStatusService,
  ],
  exports: [
    AttendanceRepository,
    AttendanceService,
    AttendanceAdminService,
    AttendanceSheetService,
    WorkStatusService,
  ],
})
export class AttendanceModule {}
