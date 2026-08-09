import { Module } from '@nestjs/common';
import { MyStatsController, ReportController } from './report.controller';
import { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

@Module({
  controllers: [ReportController, MyStatsController],
  providers: [ReportRepository, ReportService],
  exports: [ReportService],
})
export class ReportModule {}
