import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const logger = new Logger('JwtModule');

/**
 * NFR-SEC-03: ưu tiên RS256/ES256 với cặp khoá.
 * Không có cặp khoá → fallback HS256 (env.validation đã chặn ở production).
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const algorithm = config.get<string>('jwt.algorithm', 'RS256');
        const privateKey = config.get<string>('jwt.privateKey', '');
        const publicKey = config.get<string>('jwt.publicKey', '');
        const issuer = config.get<string>('jwt.issuer', 'smartface');

        if (privateKey && publicKey && algorithm !== 'HS256') {
          return {
            privateKey,
            publicKey,
            signOptions: { algorithm: algorithm as 'RS256' | 'ES256', issuer },
            verifyOptions: { algorithms: [algorithm as 'RS256' | 'ES256'], issuer },
          };
        }

        logger.warn('Đang ký JWT bằng HS256 — chỉ chấp nhận ở môi trường local/dev.');
        return {
          secret: config.get<string>('jwt.secret'),
          signOptions: { algorithm: 'HS256' as const, issuer },
          verifyOptions: { algorithms: ['HS256' as const], issuer },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    PasswordService,
    TokenService,
    DeviceService,
    // Lớp xác thực thứ hai chạy trên OtpService: Firebase chỉ lo lớp thứ nhất.
    OtpService,
  ],
  exports: [
    AuthRepository,
    AuthService,
    PasswordService,
    TokenService,
    DeviceService,
    OtpService,
    JwtModule,
  ],
})
export class AuthModule {}
