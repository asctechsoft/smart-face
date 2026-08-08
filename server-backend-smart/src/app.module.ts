import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ScopeGuard } from './common/guards/scope.guard';
import { SignatureGuard } from './common/guards/signature.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { LoggerModule } from './infra/logger/logger.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
import { WorkerModule } from './infra/queue/worker.module';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BiometricModule } from './modules/biometric/biometric.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PolicyModule } from './modules/policy/policy.module';
import { ReportModule } from './modules/report/report.module';
import { RequestModule } from './modules/request/request.module';
import { TenantModule } from './modules/tenant/tenant.module';

/**
 * Backend Core — SmartFace.
 *
 * Thứ tự guard toàn cục KHÔNG được đổi (docs/02 mục 8.2):
 *   JwtAuthGuard → PasswordChangeGuard → TenantGuard → RolesGuard → ScopeGuard
 *   → SignatureGuard → RateLimitGuard
 *
 * Guard chạy TRƯỚC interceptor, nên AuditInterceptor luôn có sẵn RequestContext.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,

    // Hạ tầng
    PrismaModule,
    RedisModule,
    StorageModule,
    QueueModule,

    // Module nền (Global) — mọi module nghiệp vụ đều dùng
    AuditModule,
    NotificationModule,
    PolicyModule,
    AiGatewayModule,
    AuthModule,
    TenantModule,

    // Nghiệp vụ
    EmployeeModule,
    BiometricModule,
    AttendanceModule,
    FraudModule,
    RequestModule,
    PayrollModule,
    ReportModule,
    AdminModule,
    HealthModule,

    // Worker — tự vô hiệu khi WORKER_ENABLED=false
    WorkerModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          // Loại bỏ field lạ thay vì ném lỗi, để App cũ gửi thừa field vẫn chạy.
          // Riêng các field kiểu `faceVerified` sẽ bị strip — đúng ý đồ BR-02.
          forbidNonWhitelisted: false,
          transform: true,
          transformOptions: { enableImplicitConversion: false },
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Ngay sau JwtAuthGuard: tài khoản chưa đổi mật khẩu tạm không được chạm
    // tới bất cứ thứ gì, kể cả đọc dữ liệu công ty.
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
    { provide: APP_GUARD, useClass: SignatureGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Middleware bổ sung (nếu cần) khai báo ở đây.
  }
}
