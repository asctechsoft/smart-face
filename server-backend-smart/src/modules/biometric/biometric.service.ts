import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { AppException } from 'src/common/errors';
import { bufferToEmbedding, embeddingToBuffer } from 'src/common/utils';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { StorageService } from 'src/infra/storage/storage.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import type { LivenessAction } from '../ai-gateway/ai-gateway.types';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { BiometricRepository } from './biometric.repository';
import type { RequestContext, TenantContext } from 'src/common/types/request-context';

const ENROLL_SESSION_TTL_SECONDS = 300;

export interface EnrollStep {
  order: number;
  angle: 'FRONT' | 'LEFT' | 'RIGHT';
  /** Bước cuối luôn có hành động liveness ngẫu nhiên do server chọn (AF-05). */
  action: LivenessAction | null;
}

interface EnrollSession {
  sessionId: string;
  employeeId: string;
  companyId: string;
  steps: EnrollStep[];
  completedOrders: number[];
  /** Embedding tạm, chỉ ghi DB khi hoàn tất toàn bộ các bước. */
  collected: Array<{
    order: number;
    angle: string;
    embedding: number[];
    quality: number | null;
    photoKey: string | null;
  }>;
  modelVersion: string | null;
  /**
   * Phiên này ghi ĐÈ lên hồ sơ đang có hay là đăng ký lần đầu.
   *
   * Ghi vào session ngay lúc bắt đầu, không kiểm lại lúc hoàn tất: nếu kiểm lại
   * thì một phiên hợp lệ bắt đầu lúc chưa có hồ sơ sẽ bị coi là đăng ký lần đầu
   * kể cả khi có hồ sơ xuất hiện xen giữa.
   */
  isReEnrollment: boolean;
}

/**
 * Đăng ký & quản lý sinh trắc học (docs/03 mục 3 và 4).
 *
 * BR-05 / NFR-SEC-07: hệ thống KHÔNG lưu dữ liệu vân tay. Vân tay xác thực cục bộ
 * trong secure enclave; server chỉ lưu PUBLIC KEY.
 *
 * BR-10: một khuôn mặt chỉ được đăng ký cho DUY NHẤT một nhân viên trong công ty.
 */
@Injectable()
export class BiometricService {
  private readonly logger = new Logger(BiometricService.name);

  constructor(
    private readonly biometrics: BiometricRepository,
    private readonly transactions: TransactionManager,
    private readonly redis: RedisService,
    private readonly ai: AiGatewayService,
    private readonly policy: PolicyService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ===========================================================================
  //  Đăng ký khuôn mặt
  // ===========================================================================

  /**
   * Bắt đầu phiên đăng ký đa góc.
   *
   * Bước cuối luôn kèm một hành động liveness NGẪU NHIÊN do server chọn (AF-05).
   *
   * ⚠ ĐĂNG KÝ LẦN ĐẦU khác ĐĂNG KÝ ĐÈ.
   *
   * Lần đầu (chưa có hồ sơ nào) thì đi thẳng — đây là bước onboarding bắt buộc
   * theo `BR-03`, chặn lại bằng xác thực lại là vô nghĩa vì người dùng chưa có
   * phương thức sinh trắc học nào để xác thực.
   *
   * Đăng ký ĐÈ lên hồ sơ đang có thì BẮT BUỘC `reauthToken`. Không có chốt này
   * thì ai cầm được điện thoại đang đăng nhập chỉ cần chụp 4 tấm ảnh của chính
   * mình là chiếm được danh tính chấm công của nạn nhân vĩnh viễn — và không
   * cần đụng tới `DELETE /biometric/face` (nơi đã có chốt xác thực lại).
   */
  async startFaceEnrollment(ctx: TenantContext, options: { reauthVerified?: boolean } = {}) {
    const employee = await this.requireEmployee(ctx);

    const activeProfiles = await this.biometrics.countActiveFaceProfiles(
      ctx.companyId,
      employee.id,
    );
    const isReEnrollment = activeProfiles > 0;

    if (isReEnrollment && !options.reauthVerified) {
      throw new AppException('AUTH_REAUTH_REQUIRED', {
        reason: 'Bạn đã đăng ký khuôn mặt. Để đăng ký lại, cần xác thực danh tính qua OTP trước.',
      });
    }

    const sessionId = `enr_${ulid()}`;
    const steps: EnrollStep[] = [
      { order: 1, angle: 'FRONT', action: null },
      { order: 2, angle: 'LEFT', action: 'TURN_LEFT' },
      { order: 3, angle: 'RIGHT', action: 'TURN_RIGHT' },
      { order: 4, angle: 'FRONT', action: this.ai.randomLivenessAction() },
    ];

    const session: EnrollSession = {
      sessionId,
      employeeId: employee.id,
      companyId: ctx.companyId,
      steps,
      completedOrders: [],
      collected: [],
      modelVersion: null,
      isReEnrollment,
    };

    await this.redis.setJson(
      RedisKeys.faceEnrollSession(sessionId),
      session,
      ENROLL_SESSION_TTL_SECONDS,
    );

    const minFacePixels = await this.policy.getNumber(ctx.companyId, PolicyKeys.FACE_MIN_PIXELS);

    return {
      sessionId,
      expiresIn: ENROLL_SESSION_TTL_SECONDS,
      steps,
      guidance: { minFacePixels, maxFileSizeKb: 800 },
      // App hiển thị cảnh báo "hồ sơ cũ sẽ bị thay thế" trước khi bắt đầu chụp.
      isReEnrollment,
    };
  }

  /**
   * Gửi ảnh cho một bước.
   *
   * Ở bước CUỐI mới đối chiếu trùng danh tính (BR-10) và ghi DB — tránh gọi
   * so khớp 1:N nhiều lần không cần thiết.
   */
  async submitFaceEnrollment(ctx: TenantContext, sessionId: string, order: number, image: Buffer) {
    const session = await this.redis.getJson<EnrollSession>(RedisKeys.faceEnrollSession(sessionId));
    if (!session || session.employeeId !== ctx.employeeId) {
      throw new AppException('FACE_ENROLL_SESSION_INVALID');
    }

    const step = session.steps.find((item) => item.order === order);
    if (!step) {
      throw new AppException('FACE_ENROLL_SESSION_INVALID', { reason: 'Bước không hợp lệ.' });
    }

    const requireLiveness = await this.policy.getBoolean(
      ctx.companyId,
      PolicyKeys.FACE_REQUIRE_LIVENESS,
    );

    const result = await this.ai.enroll(image, {
      requireLiveness: requireLiveness && step.action !== null,
      livenessAction: step.action ?? undefined,
    });

    if (!result.face_found) {
      throw this.ai.toAppException(result.error_code);
    }

    // Backend TỰ so ngưỡng (P3).
    const [minFacePixels, livenessThreshold] = await Promise.all([
      this.policy.getNumber(ctx.companyId, PolicyKeys.FACE_MIN_PIXELS),
      this.policy.getNumber(ctx.companyId, PolicyKeys.FACE_LIVENESS_THRESHOLD),
    ]);

    if (result.quality && result.quality.face_px < minFacePixels) {
      throw new AppException('FACE_TOO_SMALL', {
        facePx: result.quality.face_px,
        minFacePixels,
      });
    }
    if (step.action && requireLiveness) {
      const livenessScore = result.liveness?.score ?? 0;
      if (livenessScore < livenessThreshold) {
        throw new AppException('FACE_LIVENESS_FAILED', {
          livenessScore,
          threshold: livenessThreshold,
        });
      }
      // Chặn cả `null` — xem giải thích ở `attendance.service.ts`. Nhánh này chỉ
      // chạy khi bước có `action`, nên `null` ở đây luôn là "không đo được", không
      // phải "không yêu cầu hành động nào".
      const actionVerified = result.liveness?.action_verified;
      if (actionVerified !== true) {
        if (actionVerified === false) {
          throw new AppException('FACE_LIVENESS_FAILED', {
            reason: `Chưa thực hiện đúng hành động được yêu cầu (${step.action}).`,
          });
        }

        this.logger.warn(
          `AF-05: AI Server không đo được hành động ${step.action} ở bước ${order} — ` +
            `từ chối ảnh đăng ký. Kiểm tra module landmark_3d_68 của AI Server.`,
        );
        throw new AppException('FACE_LIVENESS_FAILED', {
          reason: 'ACTION_NOT_MEASURABLE',
          requestedAction: step.action,
        });
      }
    }
    if (!result.embedding?.length) {
      throw new AppException('FACE_NOT_FOUND', { reason: 'AI Server không trả về embedding.' });
    }

    // Lưu ảnh hồ sơ gốc (mã hoá at-rest, có lifecycle tự xoá — NFR-SEC-01).
    const photoKey = this.storage.buildFaceProfileKey(ctx.companyId, ctx.employeeId!, step.angle);
    await this.storage.upload(photoKey, image, 'image/jpeg', { employeeId: ctx.employeeId! });

    session.collected = [
      ...session.collected.filter((item) => item.order !== order),
      {
        order,
        angle: step.angle,
        embedding: result.embedding,
        quality: result.quality?.blur ?? null,
        photoKey,
      },
    ];
    session.completedOrders = [...new Set([...session.completedOrders, order])];
    session.modelVersion = result.model_version ?? session.modelVersion;

    const remaining = session.steps
      .map((item) => item.order)
      .filter((value) => !session.completedOrders.includes(value));

    if (remaining.length > 0) {
      await this.redis.setJson(
        RedisKeys.faceEnrollSession(sessionId),
        session,
        ENROLL_SESSION_TTL_SECONDS,
      );
      return {
        accepted: true,
        nextOrder: Math.min(...remaining),
        quality: result.quality ?? null,
      };
    }

    // --- Hoàn tất: kiểm tra trùng danh tính rồi ghi DB -------------------------
    await this.assertNoDuplicateIdentity(
      ctx.companyId,
      ctx.employeeId!,
      session.collected[0].embedding,
    );

    const modelVersion = session.modelVersion ?? 'unknown';

    await this.transactions.run(async (tx) => {
      // Đăng ký lại → đánh dấu hồ sơ cũ là REPLACED, không xoá (giữ dấu vết).
      await this.biometrics.markProfilesReplaced(ctx.companyId, ctx.employeeId!, new Date(), tx);

      await this.biometrics.createFaceProfiles(
        session.collected.map((item) => ({
          companyId: ctx.companyId,
          employeeId: ctx.employeeId!,
          embeddingRaw: embeddingToBuffer(item.embedding),
          embeddingDim: item.embedding.length,
          modelVersion,
          qualityScore: item.quality,
          photoKey: item.photoKey,
          angle: item.angle,
        })),
        tx,
      );

      // BR-03: đã có phương thức xác thực → chuyển sang ACTIVE.
      await this.biometrics.activateIfPending(ctx.companyId, ctx.employeeId!, tx);
    });

    await this.redis.del(RedisKeys.faceEnrollSession(sessionId));

    await this.audit.record(ctx, {
      action: session.isReEnrollment ? 'BIOMETRIC_FACE_REENROLL' : 'BIOMETRIC_FACE_ENROLL',
      targetType: 'EMPLOYEE',
      targetId: ctx.employeeId!,
      after: {
        profileCount: session.collected.length,
        modelVersion,
        isReEnrollment: session.isReEnrollment,
      },
    });

    // Đăng ký ĐÈ là hành vi đáng chú ý — HR phải nhìn thấy để phát hiện trường
    // hợp thiết bị bị chiếm. Đăng ký lần đầu là việc bình thường trong onboarding,
    // báo cho HR mỗi lần chỉ tạo nhiễu và làm họ bỏ qua cảnh báo thật.
    if (session.isReEnrollment) {
      const employee = await this.biometrics.findEmployee(ctx.companyId, ctx.employeeId!);
      await this.notifyHr(ctx.companyId, employee?.fullName ?? ctx.employeeId!, 'khuôn mặt');
    }

    return {
      accepted: true,
      completed: true,
      profileCount: session.collected.length,
      modelVersion,
      isReEnrollment: session.isReEnrollment,
    };
  }

  /**
   * BR-10 — một khuôn mặt chỉ đăng ký cho DUY NHẤT một nhân viên trong công ty.
   *
   * So khớp 1:N với toàn bộ embedding đã đăng ký của công ty. Trùng nhân viên
   * khác → CHẶN đăng ký và cảnh báo gian lận danh tính.
   */
  private async assertNoDuplicateIdentity(
    companyId: string,
    employeeId: string,
    embedding: number[],
  ): Promise<void> {
    const others = await this.biometrics.findOtherActiveEmbeddings(companyId, employeeId);
    if (others.length === 0) return;

    const threshold = await this.policy.getNumber(companyId, PolicyKeys.FACE_DUPLICATE_THRESHOLD);

    let bestScore = 0;
    let bestEmployeeId: string | null = null;

    for (const other of others) {
      if (!other.embeddingRaw) continue;
      const score = this.cosineSimilarity(embedding, bufferToEmbedding(other.embeddingRaw));
      if (score > bestScore) {
        bestScore = score;
        bestEmployeeId = other.employeeId;
      }
    }

    if (bestScore >= threshold && bestEmployeeId) {
      const conflictCode = await this.biometrics.findEmployeeCode(companyId, bestEmployeeId);

      this.logger.warn(
        `BR-10: chặn đăng ký khuôn mặt cho ${employeeId} — trùng ${bestEmployeeId} (score ${bestScore.toFixed(3)})`,
      );

      await this.notifications.broadcast({
        companyId,
        type: 'IDENTITY_DUPLICATE_ALERT',
        title: 'Cảnh báo trùng danh tính sinh trắc học',
        body: `Có nỗ lực đăng ký khuôn mặt đã thuộc về nhân viên ${conflictCode ?? bestEmployeeId}.`,
        data: { employeeId, conflictEmployeeId: bestEmployeeId, score: bestScore },
      });

      throw new AppException('FACE_DUPLICATE_IDENTITY', {
        matchScore: Math.round(bestScore * 1000) / 1000,
        threshold,
      });
    }
  }

  /** Embedding đã L2-normalize nên cosine = tích vô hướng. Vẫn chuẩn hoá cho chắc. */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < a.length; index += 1) {
      dot += a[index] * b[index];
      normA += a[index] * a[index];
      normB += b[index] * b[index];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
  }

  // ===========================================================================
  //  Vân tay
  // ===========================================================================

  /**
   * FR-APP-BIO-01 — nhận PUBLIC KEY từ secure enclave của thiết bị.
   *
   * ⚠ Server KHÔNG BAO GIỜ nhận template vân tay hay cờ `fingerprintVerified`.
   * Private key nằm trong secure enclave và chỉ dùng được sau khi OS xác thực
   * sinh trắc học thành công.
   *
   * ⚠ CHỐT `deviceId` PHẢI TRÙNG THIẾT BỊ TRONG TOKEN.
   *
   * Kịch bản chặn: kẻ tấn công lấy được access token của nạn nhân (từ log, bản
   * sao lưu máy, proxy). Hắn gọi endpoint này với `deviceId` của MÁY HẮN và
   * public key của hắn, rồi chấm công bằng vân tay từ máy mình.
   *
   * Đăng ký khoá cho một thiết bị mà mình đang KHÔNG đứng trên đó vốn không có
   * kịch bản hợp lệ nào — App luôn đăng ký cho chính máy nó đang chạy. Vì vậy
   * lệch `deviceId` thì bắt buộc xác thực lại.
   *
   * Chốt này KHÔNG gây phiền cho người dùng thật: đổi điện thoại thì phải đăng
   * nhập lại trên máy mới, token mới mang `deviceId` mới, và hai bên khớp nhau.
   */
  async registerFingerprint(
    ctx: TenantContext,
    deviceId: string,
    publicKey: string,
    algorithm: string,
    attestation?: Prisma.InputJsonValue,
    options: { reauthVerified?: boolean } = {},
  ) {
    const employee = await this.requireEmployee(ctx);

    if (!publicKey.includes('BEGIN PUBLIC KEY')) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'publicKey phải ở định dạng PEM (-----BEGIN PUBLIC KEY-----).',
      });
    }

    // `ctx.deviceId` null = token của Web. Web không có chức năng đăng ký vân tay.
    if (!ctx.deviceId) {
      throw new AppException('AUTH_DEVICE_MISMATCH', {
        reason: 'Token không gắn thiết bị — chỉ App mới đăng ký được vân tay.',
      });
    }

    if (deviceId !== ctx.deviceId && !options.reauthVerified) {
      throw new AppException('AUTH_REAUTH_REQUIRED', {
        reason:
          'Chỉ đăng ký được vân tay cho chính thiết bị đang đăng nhập. ' +
          'Đăng ký cho thiết bị khác cần xác thực lại danh tính.',
      });
    }

    const existing = await this.biometrics.findFingerprintKey(ctx.companyId, employee.id, deviceId);
    const isReplacement = Boolean(existing) && existing?.publicKey !== publicKey;

    const key = await this.transactions.run(async (tx) => {
      const saved = await this.biometrics.upsertFingerprintKey(
        employee.id,
        { companyId: ctx.companyId, deviceId, publicKey, algorithm, attestation },
        tx,
      );
      // BR-03
      await this.biometrics.activateIfPending(ctx.companyId, employee.id, tx);
      return saved;
    });

    await this.audit.record(ctx, {
      action: isReplacement ? 'BIOMETRIC_FINGERPRINT_REPLACE' : 'BIOMETRIC_FINGERPRINT_ENROLL',
      targetType: 'EMPLOYEE',
      targetId: employee.id,
      after: { deviceId, algorithm, isReplacement },
    });

    // Thay khoá trên thiết bị đã đăng ký là hành vi đáng chú ý: có thể là người
    // dùng đăng ký lại vân tay ở tầng hệ điều hành (bình thường), cũng có thể là
    // ai đó cầm được máy và thêm vân tay của mình vào. Không phân biệt được từ
    // phía server nên phải báo để có người xem.
    //
    // Đăng ký LẦN ĐẦU trên một thiết bị thì không báo — đó là bước onboarding
    // bình thường, báo mỗi lần chỉ tạo nhiễu khiến HR bỏ qua cảnh báo thật.
    if (isReplacement) {
      await this.notifyHr(ctx.companyId, employee.fullName, 'vân tay');
    }

    return { keyId: key.id, registeredAt: key.createdAt };
  }

  // ===========================================================================
  //  Trạng thái & reset
  // ===========================================================================

  async getStatus(ctx: TenantContext) {
    const employee = await this.requireEmployee(ctx);

    const [faceProfiles, fingerprintKeys] = await Promise.all([
      this.biometrics.listActiveFaceProfiles(ctx.companyId, employee.id),
      this.biometrics.listActiveFingerprintKeys(ctx.companyId, employee.id),
    ]);

    return {
      face: { enrolled: faceProfiles.length > 0, profiles: faceProfiles },
      fingerprint: { enrolled: fingerprintKeys.length > 0, keys: fingerprintKeys },
      // BR-03: cần ít nhất một phương thức trước khi vào Home.
      satisfiesMinimum: faceProfiles.length > 0 || fingerprintKeys.length > 0,
    };
  }

  /**
   * Reset để đăng ký lại (FR-APP-FACE-08, FR-APP-BIO-06).
   *
   * ⚠ Điểm tấn công quan trọng: chiếm được điện thoại đang đăng nhập thì có thể
   * đăng ký khuôn mặt của mình đè lên. Vì vậy luồng này BẮT BUỘC đi qua
   * `reauthToken` (controller kiểm tra), luôn ghi audit và thông báo cho HR.
   */
  async resetFace(ctx: TenantContext, reason: string) {
    const employee = await this.requireEmployee(ctx);

    const revoked = await this.biometrics.revokeFaceProfiles(ctx.companyId, employee.id, {
      revokedAt: new Date(),
      revokedBy: ctx.userId,
      revokedReason: reason,
    });

    await this.audit.record(ctx, {
      action: 'BIOMETRIC_FACE_RESET',
      targetType: 'EMPLOYEE',
      targetId: employee.id,
      reason,
      before: { activeProfileCount: revoked },
      after: { activeProfileCount: 0 },
    });

    await this.notifyHr(ctx.companyId, employee.fullName, 'khuôn mặt');

    return { revoked };
  }

  async resetFingerprint(ctx: TenantContext, reason: string) {
    const employee = await this.requireEmployee(ctx);

    const revoked = await this.biometrics.revokeFingerprintKeys(
      ctx.companyId,
      employee.id,
      new Date(),
      reason,
    );

    await this.audit.record(ctx, {
      action: 'BIOMETRIC_FINGERPRINT_RESET',
      targetType: 'EMPLOYEE',
      targetId: employee.id,
      reason,
      before: { activeKeyCount: revoked },
    });

    await this.notifyHr(ctx.companyId, employee.fullName, 'vân tay');

    return { revoked };
  }

  /**
   * FR-ADM-USR-03 — Admin/HR reset sinh trắc học của nhân viên khác.
   * Luôn thông báo cho cả nhân viên và HR để phát hiện can thiệp bất thường (docs/05 mục 2.1).
   */
  async resetForEmployee(
    ctx: RequestContext,
    companyId: string,
    employeeId: string,
    options: { resetFace: boolean; resetFingerprint: boolean },
    reason: string,
  ) {
    const employee = await this.biometrics.findEmployee(companyId, employeeId);
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }

    let faceRevoked = 0;
    let fingerprintRevoked = 0;

    if (options.resetFace) {
      faceRevoked = await this.biometrics.revokeFaceProfiles(companyId, employeeId, {
        revokedAt: new Date(),
        revokedBy: ctx.userId,
        revokedReason: reason,
      });
    }

    if (options.resetFingerprint) {
      fingerprintRevoked = await this.biometrics.revokeFingerprintKeys(
        companyId,
        employeeId,
        new Date(),
        reason,
      );
    }

    await this.audit.record(ctx, {
      companyId,
      action: 'BIOMETRIC_RESET',
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      reason,
      before: { faceProfileCount: faceRevoked, fingerprintKeyCount: fingerprintRevoked },
      after: { faceProfileCount: 0, fingerprintKeyCount: 0 },
    });

    await this.notifications.notify({
      companyId,
      employeeId,
      type: 'BIOMETRIC_RESET',
      title: 'Dữ liệu sinh trắc học của bạn đã được đặt lại',
      body: `Lý do: ${reason}. Vui lòng đăng ký lại khuôn mặt/vân tay trong ứng dụng.`,
    });
    await this.notifyHr(companyId, employee.fullName, 'sinh trắc học');

    return { faceRevoked, fingerprintRevoked };
  }

  private async notifyHr(companyId: string, employeeName: string, kind: string): Promise<void> {
    await this.notifications.broadcast({
      companyId,
      type: 'BIOMETRIC_CHANGED',
      title: 'Thay đổi dữ liệu sinh trắc học',
      body: `Nhân viên ${employeeName} vừa đổi dữ liệu ${kind} lúc ${new Date().toISOString()}.`,
      channel: 'IN_APP',
    });
  }

  private async requireEmployee(ctx: TenantContext) {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    const employee = await this.biometrics.findEmployee(ctx.companyId, ctx.employeeId);
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }
    return employee;
  }
}
