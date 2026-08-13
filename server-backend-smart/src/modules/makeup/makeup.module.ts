import { Module } from '@nestjs/common';
import { MakeupController } from './makeup.controller';
import { MakeupRepository } from './makeup.repository';
import { MakeupService } from './makeup.service';

/**
 * Công làm bù (FR-WEB-MKUP).
 *
 * Không `@Global()`: chỉ Web Quản lý dùng. Engine tính công đọc số phút bù qua
 * `PayrollRepository.sumMakeupMinutes` chứ không gọi service này — hai chiều
 * phụ thuộc lẫn nhau giữa payroll và makeup sẽ tạo vòng import.
 */
@Module({
  controllers: [MakeupController],
  providers: [MakeupRepository, MakeupService],
  exports: [MakeupService],
})
export class MakeupModule {}
