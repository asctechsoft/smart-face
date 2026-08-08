import { Module } from '@nestjs/common';
import { EmployeeAdminController, MeController } from './employee.controller';
import { EmployeeService } from './employee.service';

@Module({
  controllers: [EmployeeAdminController, MeController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
