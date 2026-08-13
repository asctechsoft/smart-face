import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { RequestConfigController } from './request-config.controller';
import { RequestConfigService } from './request-config.service';
import { RequestController } from './request.controller';
import { RequestRepository } from './request.repository';
import { RequestService } from './request.service';

/**
 * Đơn từ — nghỉ phép, làm bù, giải trình công, hiệu chỉnh chấm công.
 *
 * Import AttendanceModule vì đơn được duyệt phải ĐỔI dữ liệu chấm công: đơn nghỉ
 * phép được duyệt thì ngày đó không còn tính là vắng mặt nữa. Đây là chiều phụ
 * thuộc một hướng (đơn từ → chấm công) nên không cần `forwardRef`.
 */
@Module({
  imports: [AttendanceModule],
  controllers: [RequestController, RequestConfigController],
  providers: [RequestRepository, RequestService, RequestConfigService],
  exports: [RequestRepository, RequestService],
})
export class RequestModule {}
