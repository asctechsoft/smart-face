import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { StepUpGuard } from './common/guards/step-up.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ScopeGuard } from './common/guards/scope.guard';
import { SignatureGuard } from './common/guards/signature.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { VersionGuard } from './common/guards/version.guard';
import { FirebaseModule } from './infra/firebase/firebase.module';
import { LoggerModule } from './infra/logger/logger.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
import { WorkerModule } from './infra/queue/worker.module';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.module';
import { AdminModule } from './modules/admin/admin.module';
import { SupportModule } from './modules/support/support.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AccessModule } from './modules/access/access.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BiometricModule } from './modules/biometric/biometric.module';
import { ExecModule } from './modules/exec/exec.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { HealthModule } from './modules/health/health.module';
import { MakeupModule } from './modules/makeup/makeup.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PolicyModule } from './modules/policy/policy.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { ReportModule } from './modules/report/report.module';
import { RequestModule } from './modules/request/request.module';
import { TenantModule } from './modules/tenant/tenant.module';

/**
 * Backend Core — SmartFace.
 *
 * Thứ tự guard toàn cục KHÔNG được đổi (docs/02 mục 8.2):
 *   JwtAuthGuard → PasswordChangeGuard → TenantGuard → RolesGuard
 *   → PermissionGuard → StepUpGuard → ScopeGuard → VersionGuard
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
    FirebaseModule,
    StorageModule,
    QueueModule,

    // Module nền (Global) — mọi module nghiệp vụ đều dùng
    AuditModule,
    AccessModule,
    // Phải nằm ở nhóm nền: `TenantGuard` toàn cục cần `SUPPORT_ACCESS_CHECKER`.
    SupportModule,
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
    MakeupModule,
    PayrollModule,
    ExecModule,
    ProvisioningModule,
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
    // Ngay sau RolesGuard: kiểm quyền chi tiết + chặn tự duyệt (BR-13 #2, BR-14).
    // Endpoint chưa khai `@RequirePermission()` thì guard này cho qua, nên hai
    // mô hình quyền chạy song song được trong lúc chuyển đổi.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // Sau PermissionGuard: không có quyền thì bị chặn trước, khỏi bắt người dùng
    // xác thực lại để rồi vẫn bị từ chối.
    { provide: APP_GUARD, useClass: StepUpGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
    // Bóc `If-Match` trước khi vào controller (BR-13 #5). Đặt sau ScopeGuard vì
    // nó chỉ phân tích header, không quyết định ai được vào.
    { provide: APP_GUARD, useClass: VersionGuard },
    { provide: APP_GUARD, useClass: SignatureGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Middleware bổ sung (nếu cần) khai báo ở đây.
  }
}
