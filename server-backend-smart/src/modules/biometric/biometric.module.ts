import { Module } from '@nestjs/common';
import { BiometricController } from './biometric.controller';
import { BiometricRepository } from './biometric.repository';
import { BiometricService } from './biometric.service';

@Module({
  controllers: [BiometricController],
  providers: [BiometricRepository, BiometricService],
  exports: [BiometricService],
})
export class BiometricModule {}
