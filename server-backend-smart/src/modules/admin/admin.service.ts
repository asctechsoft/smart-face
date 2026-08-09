import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PaginatedResult } from 'src/common/dto';
import { SystemUserQueryDto } from './dto/admin-query.dto';
import { AppException } from 'src/common/errors';
import { buildMeta, maskPhone, normalizePhone } from 'src/common/utils';
import { FirebaseService } from 'src/infra/firebase/firebase.service';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { StorageService } from 'src/infra/storage/storage.service';
import { QUEUES } from 'src/infra/queue/queue.constants';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { DeviceService } from '../auth/device.service';
import { BiometricService } from '../biometric/biometric.service';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../notification/realtime.gateway';
import { AdminRepository } from './admin.repository';
import type { RequestContext } from 'src/common/types/request-context';

/**
 * Web Admin — quản trị toàn hệ thống (docs/05).
 *
 * Nguyên tắc chi phối:
 *   A1 — Admin xem xuyên tenant được, nhưng MỌI truy cập dữ liệu công ty cụ thể
 *        đều ghi audit log. Không có "xem lén không dấu vết".
 *   A2 — Admin KHÔNG tự ý sửa dữ liệu chấm công/lương của công ty.
 *   A3 — Mọi thao tác nhạy cảm BẮT BUỘC nhập lý do TRƯỚC khi thực thi.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly admins: AdminRepository,
    private readonly transactions: TransactionManager,
    private readonly redis: RedisService,
    private readonly firebase: FirebaseService,
    private readonly storage: StorageService,
    private readonly ai: AiGatewayService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly devices: DeviceService,
    private readonly biometric: BiometricService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue(QUEUES.PAYROLL) private readonly payrollQueue: Queue,
    @InjectQueue(QUEUES.SMS) private readonly smsQueue: Queue,
    @InjectQueue(QUEUES.NOTIFICATION) private readonly notificationQueue: Queue,
    @InjectQueue(QUEUES.EXPORT) private readonly exportQueue: Queue,
    @InjectQueue(QUEUES.AI_BATCH) private readonly aiBatchQueue: Queue,
    @InjectQueue(QUEUES.FRAUD_SCAN) private readonly fraudScanQueue: Queue,
  ) {}

  // ===========================================================================
  //  Người dùng toàn hệ thống (FR-ADM-USR)
  // ===========================================================================

  async searchUsers(query: SystemUserQueryDto) {
    const { items, total } = await this.admins.searchUsers({
      q: query.q,
      normalizedPhone: query.q ? normalizePhone(query.q) : undefined,
      companyId: query.companyId,
      skip: query.skip,
      take: query.take,
    });

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  /** FR-ADM-USR-07 — lịch sử hoạt động của một tài khoản. */
  async getUserActivity(userId: string) {
    const user = await this.admins.findUserWithCompanies(userId);
    if (!user) {
      throw new AppException('SYS_NOT_FOUND');
    }

    const employeeIds = user.employees.map((employee) => employee.id);

    const [recentAttendance, recentAudit, activeSessions] = await Promise.all([
      this.admins.findRecentPunches(employeeIds),
      this.admins.findRecentAudit(userId, employeeIds),
      this.admins.countActiveSessions(userId),
    ]);

    return {
      user: {
        id: user.id,
        phone: maskPhone(user.phone),
        fullName: user.fullName,
        isBlocked: user.isBlocked,
        blockedReason: user.blockedReason,
        isSystemAdmin: user.isSystemAdmin,
        lastLoginAt: user.lastLoginAt,
      },
      companies: user.employees.map((employee) => ({
        companyId: employee.companyId,
        companyName: employee.company.name,
        employeeCode: employee.employeeCode,
        status: employee.status,
      })),
      devices: user.devices,
      activeSessions,
      recentAttendance,
      recentAudit,
    };
  }

  /** FR-ADM-USR-02 */
  async blockUser(ctx: RequestContext, userId: string, blocked: boolean, reason: string) {
    const user = await this.admins.findUser(userId);
    if (!user) {
      throw new AppException('SYS_NOT_FOUND');
    }

    await this.admins.setBlocked(userId, blocked, reason);

    // Khoá ở CẢ HAI nơi.
    //
    // `AuthService.createSession` đã chặn tài khoản `isBlocked`, nên chỉ cờ này
    // thôi cũng đủ để không vào được hệ thống. Nhưng để tài khoản Firebase còn
    // sống nghĩa là người bị khoá vẫn đăng nhập được vào Firebase, vẫn tự đổi
    // được mật khẩu qua email đặt lại, và vẫn giữ được token hợp lệ — trạng thái
    // nửa vời đó không có lý do gì để tồn tại.
    await this.firebase.setDisabled(user.firebaseUid, blocked);

    if (blocked) {
      await this.firebase.revokeTokens(user.firebaseUid);
      await this.tokens.revokeAllForUser(userId, 'ACCOUNT_BLOCKED');
    }

    await this.audit.record(ctx, {
      action: blocked ? 'USER_BLOCK' : 'USER_UNBLOCK',
      targetType: 'USER',
      targetId: userId,
      reason,
      before: { isBlocked: user.isBlocked },
      after: { isBlocked: blocked },
    });

    return { isBlocked: blocked };
  }

  /**
   * FR-ADM-USR-03 — reset sinh trắc học.
   *
   * ⚠ Đây là điểm tấn công NỘI BỘ nguy hiểm nhất: một Admin có thể reset khuôn
   * mặt của bất kỳ ai rồi đăng ký khuôn mặt khác. Vì vậy:
   *   - bắt buộc lý do (A3)
   *   - xác nhận hai bước bằng employeeCode
   *   - audit log
   *   - THÔNG BÁO TỰ ĐỘNG cho nhân viên VÀ HR công ty
   */
  async resetBiometric(
    ctx: RequestContext,
    userId: string,
    input: {
      resetFace: boolean;
      resetFingerprint: boolean;
      revokeDevices: boolean;
      reason: string;
      confirmEmployeeCode: string;
    },
  ) {
    const employee = await this.admins.findEmployeeByUserAndCode(userId, input.confirmEmployeeCode);
    if (!employee) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason:
          'Mã nhân viên xác nhận không khớp với tài khoản. Xác nhận hai bước thất bại — thao tác bị huỷ.',
      });
    }

    const result = await this.biometric.resetForEmployee(
      ctx,
      employee.companyId,
      employee.id,
      { resetFace: input.resetFace, resetFingerprint: input.resetFingerprint },
      input.reason,
    );

    let revokedDevices = 0;
    if (input.revokeDevices) {
      const deviceIds = await this.admins.findActiveDeviceIds(userId);
      for (const deviceId of deviceIds) {
        const revoked = await this.devices.revoke(userId, deviceId, ctx.userId, input.reason);
        revokedDevices += revoked.revoked;
      }
      await this.tokens.revokeAllForUser(userId, 'ADMIN_BIOMETRIC_RESET');
    }

    return { ...result, revokedDevices };
  }

  /** FR-ADM-USR-04 */
  async revokeDevice(ctx: RequestContext, userId: string, deviceId: string, reason: string) {
    const result = await this.devices.revoke(userId, deviceId, ctx.userId, reason);
    await this.tokens.revokeAllForDevice(userId, deviceId, reason);

    await this.audit.record(ctx, {
      action: 'DEVICE_REVOKE',
      targetType: 'USER',
      targetId: userId,
      reason,
      after: { deviceId },
    });

    return result;
  }

  /** FR-ADM-USR-05 — đổi số điện thoại khi nhân viên đổi số. */
  async changePhone(ctx: RequestContext, userId: string, newPhone: string, reason: string) {
    const phone = normalizePhone(newPhone);
    const user = await this.admins.findUser(userId);
    if (!user) {
      throw new AppException('SYS_NOT_FOUND');
    }

    // Số điện thoại chỉ cần duy nhất TRONG công ty, không phải toàn hệ thống:
    // tài khoản đã gắn với đúng một công ty nên hai công ty khác nhau dùng
    // trùng số là chuyện bình thường (một người làm hai nơi).
    const taken = await this.admins.isPhoneTakenInCompany(user.companyId, phone, userId);
    if (taken) {
      throw new AppException('EMP_PHONE_TAKEN');
    }

    await this.transactions.run(async (tx) => {
      await this.admins.updatePhone(userId, phone, tx);
    });

    // Đổi SĐT = đổi định danh đăng nhập → thu hồi toàn bộ phiên.
    await this.tokens.revokeAllForUser(userId, 'PHONE_CHANGED');

    await this.audit.record(ctx, {
      action: 'USER_PHONE_CHANGE',
      targetType: 'USER',
      targetId: userId,
      reason,
      before: { phone: maskPhone(user.phone) },
      after: { phone: maskPhone(phone) },
    });

    return { phone: maskPhone(phone) };
  }

  // ===========================================================================
  //  Giám sát AI Server (FR-ADM-AI)
  // ===========================================================================

  async aiMetrics() {
    const [health, metrics] = await Promise.all([this.ai.health(), this.ai.metrics()]);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const usage = await this.admins.loadAiUsage(since);

    return {
      health,
      circuitBreakerState: this.ai.circuitBreakerState,
      rawMetrics: metrics,
      last24h: {
        totalRecognitions: usage.total,
        byDecision: usage.byDecision,
        avgProcessingMs: Math.round(usage.avgProcessingMs ?? 0),
        avgMatchScore: usage.avgMatchScore,
        avgLivenessScore: usage.avgLivenessScore,
      },
    };
  }

  async listAiModels() {
    return this.admins.listAiModels();
  }

  async registerAiModel(data: {
    name: string;
    version: string;
    farMeasured?: number;
    frrMeasured?: number;
    latencyP95Ms?: number;
    defaultMatchThreshold?: number;
    defaultLivenessThreshold?: number;
    notes?: string;
  }) {
    return this.admins.upsertAiModel(data);
  }

  /**
   * FR-ADM-AI-06 — triển khai model.
   *
   * ⚠ Đổi model làm THAY ĐỔI PHÂN BỐ điểm tương đồng — ngưỡng cũ có thể không còn
   * đúng. Response luôn kèm cảnh báo nhắc hiệu chỉnh lại ngưỡng cùng lúc.
   */
  async deployAiModel(ctx: RequestContext, modelId: string, reason: string) {
    const model = await this.admins.findAiModel(modelId);
    if (!model) {
      throw new AppException('SYS_NOT_FOUND');
    }

    const previous = await this.admins.findActiveAiModel();

    await this.admins.switchActiveAiModel(modelId, 'DEPLOY', new Date());

    await this.audit.record(ctx, {
      action: 'AI_MODEL_DEPLOY',
      targetType: 'AI_MODEL',
      targetId: modelId,
      reason,
      before: previous ? { name: previous.name, version: previous.version } : undefined,
      after: { name: model.name, version: model.version },
    });

    return {
      deployed: `${model.name}@${model.version}`,
      previous: previous ? `${previous.name}@${previous.version}` : null,
      warning:
        'Đổi model làm thay đổi phân bố điểm tương đồng. PHẢI hiệu chỉnh lại ngưỡng match/liveness cùng lúc, không đổi riêng lẻ.',
    };
  }

  async rollbackAiModel(ctx: RequestContext, modelId: string, reason: string) {
    const model = await this.admins.findAiModel(modelId);
    if (!model) {
      throw new AppException('SYS_NOT_FOUND');
    }

    await this.admins.switchActiveAiModel(modelId, 'ROLLBACK', new Date());

    await this.audit.record(ctx, {
      action: 'AI_MODEL_ROLLBACK',
      targetType: 'AI_MODEL',
      targetId: modelId,
      reason,
      after: { name: model.name, version: model.version },
    });

    return { rolledBackTo: `${model.name}@${model.version}` };
  }

  // ===========================================================================
  //  Cấu hình hệ thống (FR-ADM-CFG)
  // ===========================================================================

  async getSystemConfig() {
    const rows = await this.admins.findAllSystemConfig();
    return rows.reduce<Record<string, unknown>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  async setSystemConfig(
    ctx: RequestContext,
    entries: Record<string, Prisma.InputJsonValue>,
    reason: string,
  ) {
    await this.transactions.run(async (tx) => {
      for (const [key, value] of Object.entries(entries)) {
        await this.admins.upsertSystemConfig(key, value, ctx.userId, tx);
      }
    });

    await this.audit.record(ctx, {
      action: 'SYSTEM_CONFIG_UPDATE',
      targetType: 'SYSTEM',
      reason,
      after: entries as Prisma.InputJsonValue,
    });

    return { updated: Object.keys(entries).length };
  }

  // ===========================================================================
  //  Vận hành (FR-ADM-OPS)
  // ===========================================================================

  /** FR-ADM-OPS-03 — health check từng thành phần. */
  async healthCheck() {
    const checks = await Promise.all([
      this.timed('database', async () => {
        await this.admins.ping();
        return true;
      }),
      this.timed('redis', () => this.redis.ping()),
      this.timed('storage', () => this.storage.healthCheck()),
      this.timed('ai-server', async () => (await this.ai.health()) !== null),
    ]);

    const healthy = checks.every((check) => check.healthy);
    return {
      status: healthy ? 'healthy' : 'degraded',
      checks,
      checkedAt: new Date().toISOString(),
    };
  }

  private async timed(name: string, probe: () => Promise<boolean>) {
    const startedAt = Date.now();
    try {
      const healthy = await probe();
      return { name, healthy, responseMs: Date.now() - startedAt };
    } catch (error) {
      return {
        name,
        healthy: false,
        responseMs: Date.now() - startedAt,
        error: (error as Error).message,
      };
    }
  }

  /** FR-ADM-OPS-05 — trạng thái hàng đợi. */
  async queueStatus() {
    const queues: Array<[string, Queue]> = [
      [QUEUES.PAYROLL, this.payrollQueue],
      [QUEUES.SMS, this.smsQueue],
      [QUEUES.NOTIFICATION, this.notificationQueue],
      [QUEUES.EXPORT, this.exportQueue],
      [QUEUES.AI_BATCH, this.aiBatchQueue],
      [QUEUES.FRAUD_SCAN, this.fraudScanQueue],
    ];

    return Promise.all(
      queues.map(async ([name, queue]) => {
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          );
          return { name, ...counts };
        } catch (error) {
          return { name, error: (error as Error).message };
        }
      }),
    );
  }

  async retryFailedJobs(queueName: string, limit = 100) {
    const queue = this.resolveQueue(queueName);
    const failed = await queue.getFailed(0, limit - 1);

    let retried = 0;
    for (const job of failed) {
      await job.retry().catch(() => undefined);
      retried += 1;
    }
    return { queue: queueName, retried };
  }

  private resolveQueue(name: string): Queue {
    const map: Record<string, Queue> = {
      [QUEUES.PAYROLL]: this.payrollQueue,
      [QUEUES.SMS]: this.smsQueue,
      [QUEUES.NOTIFICATION]: this.notificationQueue,
      [QUEUES.EXPORT]: this.exportQueue,
      [QUEUES.AI_BATCH]: this.aiBatchQueue,
      [QUEUES.FRAUD_SCAN]: this.fraudScanQueue,
    };
    const queue = map[name];
    if (!queue) {
      throw new AppException('SYS_NOT_FOUND', { reason: `Hàng đợi "${name}" không tồn tại.` });
    }
    return queue;
  }

  /** FR-ADM-OPS-06 — chế độ bảo trì. */
  async setMaintenance(
    ctx: RequestContext,
    input: { enabled: boolean; message?: string; startAt?: string; endAt?: string; reason: string },
  ) {
    if (input.enabled) {
      await this.redis.setJson(
        RedisKeys.maintenance(),
        {
          enabled: true,
          message: input.message ?? 'Hệ thống đang bảo trì. Vui lòng quay lại sau.',
          startAt: input.startAt,
          endAt: input.endAt,
        },
        24 * 3600,
      );
    } else {
      await this.redis.del(RedisKeys.maintenance());
    }

    this.realtime.broadcastSystem('system.maintenance', {
      enabled: input.enabled,
      message: input.message,
      startAt: input.startAt,
      endAt: input.endAt,
    });

    await this.audit.record(ctx, {
      action: 'SYSTEM_MAINTENANCE',
      targetType: 'SYSTEM',
      reason: input.reason,
      after: { enabled: input.enabled, startAt: input.startAt, endAt: input.endAt },
    });

    return { enabled: input.enabled };
  }

  async getMaintenance() {
    return (
      (await this.redis.getJson<{ enabled: boolean; message: string }>(
        RedisKeys.maintenance(),
      )) ?? {
        enabled: false,
      }
    );
  }

  /** FR-ADM-SEC-03 — phát hiện brute-force OTP và thăm dò endpoint. */
  async securityAlerts() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [otpLocks, highSeverityFlags, multiDeviceFlags] = await Promise.all([
      this.admins.countAuditActionSince('AUTH_OTP_LOCKED', since),
      this.admins.countFraudFlagsSince(since, { severity: 'HIGH' }),
      this.admins.countFraudFlagsSince(since, { code: 'MULTI_DEVICE_ANOMALY' }),
    ]);

    // So với trung bình 7 ngày để phát hiện đột biến cờ gian lận.
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekFlags = await this.admins.countFraudFlagsSince(weekAgo);
    const dailyAverage = weekFlags / 7;

    return {
      window: '24h',
      otpLockouts: otpLocks,
      highSeverityFraudFlags: highSeverityFlags,
      multiDeviceAnomalies: multiDeviceFlags,
      fraudFlagSpike: dailyAverage > 0 && highSeverityFlags > dailyAverage * 3,
      dailyAverageLast7Days: Math.round(dailyAverage * 10) / 10,
    };
  }
}
