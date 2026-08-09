import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttendanceDecision,
  AttendanceType,
  AuthMethod,
  Branch,
  DailyStatus,
  Employee,
  EmployeeStatus,
  Prisma,
  Shift,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { createVerify } from 'node:crypto';
import { AppException, ErrorCode } from 'src/common/errors';
import {
  absoluteSkewSeconds,
  bufferToEmbedding,
  combineWorkDateAndTime,
  dayBoundsUtc,
  formatWorkDate,
  haversineMeters,
  inZone,
  minutesBetween,
  ipInAnyCidr,
  isValidCidr,
  normalizeBssid,
  parseWorkDate,
  toWorkDate,
} from 'src/common/utils';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { StorageService } from 'src/infra/storage/storage.service';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import type { LivenessAction } from '../ai-gateway/ai-gateway.types';
import { FraudService } from '../fraud/fraud.service';
import { RealtimeGateway } from '../notification/realtime.gateway';
import {
  IpRestrictionRequirement,
  OutOfRangeAction,
  PolicyKeys,
  WifiRequirement,
} from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { AttendanceRepository } from './attendance.repository';
import type { CheckInDto } from './dto/attendance.dto';
import type { RequestContext } from 'src/common/types/request-context';

interface ChallengePayload {
  nonce: string;
  livenessAction: LivenessAction;
  issuedAt: number;
}

/**
 * Chấm công — luồng nghiệp vụ quan trọng nhất hệ thống (docs/03 mục 5.3).
 *
 * Thứ tự kiểm tra bắt buộc (docs/02 mục 8.2):
 *   1. JWT hợp lệ + khớp deviceId          → JwtAuthGuard
 *   2. Chữ ký HMAC hợp lệ                   → SignatureGuard
 *   3. |server_time − client_time| ≤ 120s   → tại đây, gắn cờ AF-18
 *   4. Nonce chưa dùng (Redis SETNX)        → tại đây, 409 REPLAY
 *   5. Rate limit                            → RateLimitGuard
 *   6. is_mock == false, accuracy hợp lệ     → tại đây
 *   7. GỌI AI SERVER kiểm chứng khuôn mặt    → tại đây (BR-02 — KHÔNG tin client)
 *   8. Kiểm tra geofence
 *   9. Ghi AttendanceLog với SERVER TIMESTAMP (BR-01)
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly engineVersion = 'attendance@1.0.0';

  constructor(
    private readonly attendances: AttendanceRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly policy: PolicyService,
    private readonly ai: AiGatewayService,
    private readonly fraud: FraudService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue(QUEUES.PAYROLL) private readonly payrollQueue: Queue,
  ) {}

  // ===========================================================================
  //  1. Challenge — bắt buộc gọi trước mỗi lần chấm công
  // ===========================================================================

  async createChallenge(ctx: RequestContext) {
    const employee = await this.requireActiveEmployee(ctx);
    const timezone = await this.policy.getTimezone(employee.companyId, employee.branchId);
    const serverTime = new Date();

    const workDate = await this.resolveWorkDate(employee, serverTime, timezone);
    const expectedType = await this.determineNextType(employee, workDate);

    const nonce = `${employee.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    // AF-05: hành động liveness do SERVER chọn ngẫu nhiên, App KHÔNG tự quyết.
    const livenessAction = this.ai.randomLivenessAction();
    const ttl = this.config.get<number>('attendance.nonceTtlSeconds', 60);

    const payload: ChallengePayload = { nonce, livenessAction, issuedAt: Date.now() };
    await this.redis.setJson(RedisKeys.attendanceChallenge(ctx.userId, nonce), payload, ttl);

    return {
      nonce,
      // AF-18: App đối chiếu với giờ máy để phát hiện chỉnh giờ.
      serverTime: serverTime.toISOString(),
      expiresIn: ttl,
      livenessAction,
      expectedType,
      requiresPhoto: true,
      workDate: formatWorkDate(workDate),
    };
  }

  // ===========================================================================
  //  2. Chấm công
  // ===========================================================================

  async punch(
    ctx: RequestContext,
    dto: CheckInDto,
    image: Buffer | undefined,
    type: AttendanceType,
    ipAddress?: string,
  ) {
    const recordedAt = new Date(); // BR-01: giờ CHÍNH THỨC là giờ server
    const employee = await this.requireActiveEmployee(ctx);
    const companyId = employee.companyId;

    // --- (4) Nonce dùng một lần ------------------------------------------------
    const challenge = await this.consumeChallenge(ctx.userId, dto.nonce);

    // --- (3) Lệch giờ ----------------------------------------------------------
    const clientReportedAt = new Date(dto.clientTime);
    const clockSkewSeconds = Number.isNaN(clientReportedAt.getTime())
      ? null
      : absoluteSkewSeconds(recordedAt, clientReportedAt);

    // --- (6) Chính sách vị trí & thiết bị -------------------------------------
    await this.assertLocationPolicy(companyId, dto);
    await this.assertDevicePolicy(companyId, dto);

    const timezone = await this.policy.getTimezone(companyId, employee.branchId);
    const workDate = await this.resolveWorkDate(employee, recordedAt, timezone);

    // BR-ATT-05: kỳ lương đã chốt thì không cho ghi thêm vào kỳ đó.
    await this.assertPeriodOpen(companyId, workDate);

    // BR-ATT-04: không có ca làm việc hôm nay.
    const shift = await this.policy.resolveShiftForDate(companyId, employee.id, workDate);
    if (!shift) {
      throw new AppException('ATT_NO_SHIFT_TODAY', { workDate: formatWorkDate(workDate) });
    }

    // BR-ATT-01/02/03: xác định IN/OUT theo TRẠNG THÁI HIỆN TẠI, không giả định
    // "lần 1 là vào". Một ngày có thể có nhiều cặp vào/ra.
    await this.assertTypeAllowed(employee, workDate, type);

    // --- (8) Geofence ----------------------------------------------------------
    const geo = await this.evaluateGeofence(companyId, employee, dto);

    // --- (8b) AF-02 — BẮT BUỘC kết nối WiFi công ty ---------------------------
    //
    // Đặt TRƯỚC lời gọi AI Server: đây là phép so chuỗi trong bộ nhớ, còn bên
    // dưới là suy luận trên GPU. Kiểm sau nghĩa là đốt tài nguyên GPU cho
    // những request chắc chắn bị từ chối — và ở giờ cao điểm 8h sáng đó là tài
    // nguyên lấy đi từ người đang chấm công hợp lệ.
    const wifi = await this.evaluateWifiRequirement(companyId, geo, dto);
    if (wifi.decision === 'BLOCK') {
      throw new AppException(wifi.errorCode, wifi.details);
    }

    // --- (8c) AF-02b — BẮT BUỘC gọi từ dải IP mạng văn phòng ------------------
    const network = await this.evaluateIpRestriction(companyId, geo, ipAddress);
    if (network.decision === 'BLOCK') {
      throw new AppException(network.errorCode, network.details);
    }

    // --- (7) Xác thực sinh trắc học — BACKEND TỰ KIỂM CHỨNG (BR-02, AF-10) ----
    const verification = await this.verifyIdentity(
      companyId,
      employee,
      dto,
      image,
      challenge.livenessAction,
    );

    // --- Chấm điểm rủi ro ------------------------------------------------------
    const isKnownDevice = await this.isKnownDevice(ctx.userId, dto.deviceContext.deviceId);
    const evaluation = await this.fraud.evaluate({
      companyId,
      employeeId: employee.id,
      userId: ctx.userId,
      deviceId: dto.deviceContext.deviceId,
      latitude: dto.location.latitude,
      longitude: dto.location.longitude,
      gpsAccuracy: dto.location.accuracy,
      locationProvider: dto.location.provider,
      isMockLocation: dto.location.isMocked ?? false,
      insideGeofence: geo.insideGeofence,
      distanceToBranchM: geo.distanceMeters,
      branchHasLocalNetworkConfig: geo.hasLocalNetworkConfig,
      matchedLocalNetwork: geo.matchedLocalNetwork,
      isRootedDevice: dto.deviceContext.isRooted ?? false,
      attestationPassed: verification.attestationPassed,
      isKnownDevice,
      clockSkewSeconds,
      matchScore: verification.matchScore,
      livenessScore: verification.livenessScore,
      recordedAt,
    });

    // Ngoài vùng + chính sách BLOCK → chặn trước khi ghi bản ghi.
    if (geo.insideGeofence === false && geo.outOfRangeAction === 'BLOCK') {
      throw new AppException('ATT_OUT_OF_GEOFENCE', {
        distanceToBranchM: geo.distanceMeters,
        allowedRadiusMeters: geo.radiusMeters,
      });
    }

    if (evaluation.decision === AttendanceDecision.REJECTED) {
      // Vẫn ghi cờ để lại dấu vết dù bản ghi chấm công bị từ chối.
      await this.fraud.persistFlags({
        companyId,
        employeeId: employee.id,
        attendanceLogId: null,
        signals: evaluation.signals,
      });
      throw new AppException('FRAUD_RISK_TOO_HIGH', {
        fraudScore: evaluation.score,
        flags: evaluation.signals.map((signal) => signal.code),
      });
    }

    // Ngoài vùng + chính sách PENDING_REVIEW → công chưa tính cho tới khi duyệt.
    let decision = evaluation.decision;
    if (geo.insideGeofence === false && geo.outOfRangeAction === 'PENDING_REVIEW') {
      decision = AttendanceDecision.PENDING_REVIEW;
    }

    // AF-02 mức FLAG: vẫn ghi nhận nhưng phải để lại dấu cho quản lý xem.
    // Không nâng lên FLAGGED thì mức FLAG không khác gì OFF.
    if (
      (wifi.decision === 'FLAG' || network.decision === 'FLAG') &&
      decision === AttendanceDecision.ACCEPTED
    ) {
      decision = AttendanceDecision.FLAGGED;
    }

    // --- Lưu ảnh bằng chứng ----------------------------------------------------
    let photoKey: string | null = null;
    let photoHash: string | null = null;
    if (image) {
      const key = this.storage.buildAttendancePhotoKey(companyId, employee.id, recordedAt);
      const uploaded = await this.storage.upload(key, image, 'image/jpeg', {
        employeeId: employee.id,
        companyId,
      });
      photoKey = uploaded.key;
      photoHash = uploaded.hash;
    }

    // --- (9) Ghi bản ghi THÔ — BẤT BIẾN (BR-06) -------------------------------
    const log = await this.attendances.createLog(companyId, {
      employeeId: employee.id,
      branchId: geo.branch?.id ?? employee.branchId,
      type,
      authMethod: dto.authMethod,
      recordedAt,
      clientReportedAt: Number.isNaN(clientReportedAt.getTime()) ? null : clientReportedAt,
      clockSkewSeconds,
      workDate,
      latitude: dto.location.latitude,
      longitude: dto.location.longitude,
      gpsAccuracy: dto.location.accuracy,
      locationProvider: dto.location.provider,
      isMockLocation: dto.location.isMocked ?? false,
      distanceToBranchM: geo.distanceMeters,
      insideGeofence: geo.insideGeofence,
      wifiBssid: dto.deviceContext.wifiBssid,
      beaconUuid: dto.deviceContext.beaconUuid,
      deviceId: dto.deviceContext.deviceId,
      deviceModel: dto.deviceContext.model,
      osVersion: dto.deviceContext.osVersion,
      appVersion: dto.deviceContext.appVersion,
      isRootedDevice: dto.deviceContext.isRooted ?? false,
      attestationPassed: verification.attestationPassed,
      ipAddress,
      matchScore: verification.matchScore,
      livenessScore: verification.livenessScore,
      imageQuality: verification.quality as Prisma.InputJsonValue,
      livenessChallenge: challenge.livenessAction,
      aiModelVersion: verification.modelVersion,
      aiProcessingMs: verification.processingMs,
      photoKey,
      photoHash,
      fraudScore: evaluation.score,
      decision,
    });

    // BR-04: mã nhân viên bất biến sau lần chấm công đầu tiên.
    if (!employee.codeLocked) {
      await this.attendances.lockEmployeeCode(companyId, employee.id);
    }

    await this.fraud.persistFlags({
      companyId,
      employeeId: employee.id,
      attendanceLogId: log.id,
      signals: evaluation.signals,
    });

    // Tính lại bảng công của ngày — chạy nền, idempotent (ADR-08, NFR-REL-06).
    await this.enqueueRecalculate(companyId, employee.id, workDate);

    this.realtime.emitToCompany(companyId, 'attendance.recorded', {
      employeeId: employee.id,
      type,
      recordedAt: recordedAt.toISOString(),
      decision,
    });

    const lateMinutes = this.computeLateMinutes(shift, workDate, timezone, recordedAt, type);

    return {
      attendanceId: log.id,
      type,
      // Hiển thị GIỜ SERVER, không phải giờ máy.
      recordedAt: recordedAt.toISOString(),
      workDate: formatWorkDate(workDate),
      decision,
      shift: {
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMinutes: shift.breakMinutes,
      },
      lateMinutes,
      distanceToBranchM: geo.distanceMeters,
      insideGeofence: geo.insideGeofence,
      // Gọi thẳng storage, KHÔNG qua `getAttendancePhotoUrl`: ảnh vừa được tạo
      // vài mili giây trước nên kiểm thời hạn lưu luôn đúng. Thêm một lượt đọc
      // chính sách vào đường chấm công — đường nóng nhất hệ thống — cho một
      // phép kiểm không bao giờ sai là đánh đổi tồi.
      photoUrl: await this.storage.getPresignedUrl(photoKey),
      fraudScore: evaluation.score,
      flags: evaluation.signals.map((signal) => ({
        code: signal.code,
        severity: signal.severity,
        message: signal.message,
      })),
    };
  }

  // ===========================================================================
  //  3. Xác thực danh tính — BR-02: KHÔNG tin cờ từ client
  // ===========================================================================

  private async verifyIdentity(
    companyId: string,
    employee: Employee,
    dto: CheckInDto,
    image: Buffer | undefined,
    livenessAction: LivenessAction,
  ): Promise<{
    matchScore: number | null;
    livenessScore: number | null;
    quality: Record<string, unknown> | null;
    modelVersion: string | null;
    processingMs: number | null;
    attestationPassed: boolean | null;
  }> {
    const attestationPassed = await this.verifyAttestation(companyId, dto);

    if (dto.authMethod === AuthMethod.FINGERPRINT) {
      // Vân tay: challenge–response có chữ ký từ secure enclave (docs/03 mục 4.2).
      // KHÔNG nhận `{fingerprintVerified: true}` — chỉ nhận chữ ký để tự verify.
      await this.verifyFingerprintSignature(employee, dto);
      return {
        matchScore: null,
        livenessScore: null,
        quality: null,
        modelVersion: null,
        processingMs: null,
        attestationPassed,
      };
    }

    if (!image || image.length === 0) {
      throw new AppException('FACE_NOT_FOUND', {
        reason: 'Thiếu ảnh khuôn mặt — Backend không chấp nhận chấm công bằng mặt mà không có ảnh.',
      });
    }

    const rawEmbeddings = await this.attendances.findActiveFaceEmbeddings(companyId, employee.id);
    if (rawEmbeddings.length === 0) {
      throw new AppException('FACE_NOT_ENROLLED');
    }

    const embeddings = rawEmbeddings.map((raw) => bufferToEmbedding(raw));

    const requireLiveness = await this.policy.getBoolean(
      companyId,
      PolicyKeys.FACE_REQUIRE_LIVENESS,
    );

    // Gọi AI Server. AI Server chỉ trả SỐ LIỆU (P3).
    const result = await this.ai.verify(image, embeddings, { requireLiveness, livenessAction });

    if (!result.face_found) {
      throw this.ai.toAppException(result.error_code);
    }

    // --- Backend TỰ so ngưỡng và TỰ quyết định --------------------------------
    const [matchThreshold, livenessThreshold, minFacePixels] = await Promise.all([
      this.policy.getNumber(companyId, PolicyKeys.FACE_MATCH_THRESHOLD),
      this.policy.getNumber(companyId, PolicyKeys.FACE_LIVENESS_THRESHOLD),
      this.policy.getNumber(companyId, PolicyKeys.FACE_MIN_PIXELS),
    ]);

    if (result.quality && result.quality.face_px < minFacePixels) {
      throw new AppException('FACE_TOO_SMALL', {
        facePx: result.quality.face_px,
        minFacePixels,
      });
    }

    if (requireLiveness) {
      const livenessScore = result.liveness?.score ?? 0;
      if (livenessScore < livenessThreshold) {
        throw new AppException('FACE_LIVENESS_FAILED', {
          livenessScore,
          threshold: livenessThreshold,
        });
      }
      // AF-05: phải thực hiện ĐÚNG hành động server yêu cầu.
      if (result.liveness?.action_verified === false) {
        throw new AppException('FACE_LIVENESS_FAILED', {
          reason: `Chưa thực hiện đúng hành động được yêu cầu (${livenessAction}).`,
          requestedAction: livenessAction,
        });
      }
    }

    const bestScore = result.match?.best_score ?? 0;
    if (bestScore < matchThreshold) {
      await this.registerFailedAttempt(companyId, employee.id);
      throw new AppException('FACE_NOT_MATCHED', {
        matchScore: bestScore,
        threshold: matchThreshold,
      });
    }

    return {
      matchScore: bestScore,
      livenessScore: result.liveness?.score ?? null,
      quality: (result.quality as unknown as Record<string, unknown>) ?? null,
      modelVersion: result.model_version ?? null,
      processingMs: result.processing_ms ?? null,
      attestationPassed,
    };
  }

  /**
   * Vân tay — verify chữ ký bằng public key đã lưu (BR-05, AF-10).
   *
   * Ký được nghĩa là vân tay ĐÃ được xác thực thật ở tầng OS, vì secure enclave
   * chỉ cho dùng private key sau khi xác thực sinh trắc học thành công.
   */
  private async verifyFingerprintSignature(employee: Employee, dto: CheckInDto): Promise<void> {
    if (!dto.signedChallenge) {
      throw new AppException('BIO_SIGNATURE_INVALID', {
        reason: 'Thiếu chữ ký challenge.',
      });
    }

    const key = await this.attendances.findFingerprintKey(
      employee.companyId,
      employee.id,
      dto.deviceContext.deviceId,
    );
    if (!key) {
      throw new AppException('BIO_NOT_ENROLLED');
    }

    try {
      const verifier = createVerify('SHA256');
      verifier.update(dto.nonce);
      verifier.end();

      const valid = verifier.verify(
        { key: key.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(dto.signedChallenge, 'base64'),
      );
      if (!valid) {
        throw new AppException('BIO_SIGNATURE_INVALID');
      }
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException('BIO_SIGNATURE_INVALID', { reason: (error as Error).message });
    }
  }

  /**
   * AF-15 — App Attestation.
   *
   * ⚠ Hiện chỉ ghi nhận việc client có gửi token hay không. Bước xác minh THẬT
   * phải gọi API của Google Play Integrity / Apple App Attest — tự parse token
   * là vô nghĩa vì kẻ tấn công tự tạo được. Đây là hạng mục Giai đoạn 3.
   */
  private async verifyAttestation(companyId: string, dto: CheckInDto): Promise<boolean | null> {
    const required = await this.policy.getBoolean(companyId, PolicyKeys.DEVICE_REQUIRE_ATTESTATION);
    if (!required) {
      return dto.deviceContext.attestationToken ? null : null;
    }
    if (!dto.deviceContext.attestationToken) {
      throw new AppException('FRAUD_ATTESTATION_FAILED', { reason: 'Thiếu attestation token.' });
    }
    this.logger.warn(
      'DEVICE_REQUIRE_ATTESTATION đang bật nhưng chưa tích hợp Play Integrity/App Attest — token chưa được xác minh với Google/Apple.',
    );
    return null;
  }

  // ===========================================================================
  //  4. Kiểm tra chính sách
  // ===========================================================================

  private async assertLocationPolicy(companyId: string, dto: CheckInDto): Promise<void> {
    // AF-01
    if (dto.location.isMocked) {
      const reject = await this.policy.getBoolean(companyId, PolicyKeys.GPS_REJECT_MOCK);
      if (reject) {
        throw new AppException('FRAUD_MOCK_LOCATION');
      }
    }

    // AF-04
    const maxAccuracy = await this.policy.getNumber(companyId, PolicyKeys.GPS_MAX_ACCURACY_M);
    if (dto.location.accuracy != null && dto.location.accuracy > maxAccuracy * 3) {
      // Sai số gấp 3 lần ngưỡng thì vị trí vô nghĩa — chặn thẳng.
      throw new AppException('FRAUD_LOW_GPS_ACCURACY', {
        accuracy: dto.location.accuracy,
        threshold: maxAccuracy,
      });
    }

    const requireGps = await this.policy.getBoolean(companyId, PolicyKeys.GPS_REQUIRE_GPS_PROVIDER);
    if (requireGps && dto.location.provider && dto.location.provider !== 'gps') {
      throw new AppException('FRAUD_LOW_GPS_ACCURACY', {
        reason: `Nguồn vị trí "${dto.location.provider}" không đủ tin cậy.`,
      });
    }
  }

  private async assertDevicePolicy(companyId: string, dto: CheckInDto): Promise<void> {
    // AF-14
    if (dto.deviceContext.isRooted) {
      const reject = await this.policy.getBoolean(companyId, PolicyKeys.DEVICE_REJECT_ROOTED);
      if (reject) {
        throw new AppException('FRAUD_ROOTED_DEVICE');
      }
    }
  }

  /** BR-07 / BR-ATT-05 — kỳ lương đã chốt thì khoá hoàn toàn. */
  private async assertPeriodOpen(companyId: string, workDate: Date): Promise<void> {
    const closed = await this.attendances.findClosedPeriodCovering(companyId, workDate);
    if (closed) {
      throw new AppException('ATT_PERIOD_LOCKED', { period: closed.name });
    }
  }

  /** BR-ATT-01/02/03 — xác định IN/OUT theo trạng thái hiện tại. */
  private async assertTypeAllowed(
    employee: Employee,
    workDate: Date,
    type: AttendanceType,
  ): Promise<void> {
    const last = await this.attendances.findLastPunch(employee.companyId, employee.id, workDate);

    if (type === AttendanceType.CHECK_IN && last?.type === AttendanceType.CHECK_IN) {
      throw new AppException('ATT_ALREADY_CHECKED_IN', {
        lastCheckInAt: last.recordedAt.toISOString(),
      });
    }
    // BR-ATT-03: chưa chấm vào mà chấm ra thì VẪN CHO, gắn cờ thiếu bản ghi vào.
    // Việc gắn cờ do job `scan-missing-checkout` / engine tính công xử lý.
  }

  private async determineNextType(employee: Employee, workDate: Date): Promise<AttendanceType> {
    const last = await this.attendances.findLastPunch(employee.companyId, employee.id, workDate);
    return last?.type === AttendanceType.CHECK_IN
      ? AttendanceType.CHECK_OUT
      : AttendanceType.CHECK_IN;
  }

  // ===========================================================================
  //  5. Geofence
  // ===========================================================================

  private async evaluateGeofence(companyId: string, employee: Employee, dto: CheckInDto) {
    const outOfRangeAction = await this.policy.get<OutOfRangeAction>(
      companyId,
      PolicyKeys.GEOFENCE_OUT_OF_RANGE_ACTION,
    );

    const branches = await this.attendances.findGeofenceBranches(companyId, dto.branchId);

    if (branches.length === 0) {
      // Chưa cấu hình geofence → không đánh giá được, không gắn cờ oan.
      return {
        branch: null as Branch | null,
        distanceMeters: null as number | null,
        insideGeofence: null as boolean | null,
        radiusMeters: null as number | null,
        outOfRangeAction,
        hasLocalNetworkConfig: false,
        matchedLocalNetwork: false,
        exemptOnTrip: false,
      };
    }

    // Chọn chi nhánh GẦN NHẤT — nhân viên có thể chấm ở chi nhánh khác chi nhánh gốc.
    const point = { latitude: dto.location.latitude, longitude: dto.location.longitude };
    const ranked = branches
      .map((branch) => ({
        branch,
        distance: haversineMeters(point, {
          latitude: branch.latitude as number,
          longitude: branch.longitude as number,
        }),
      }))
      .sort((a, b) => a.distance - b.distance);

    const nearest = ranked[0];
    const insideGeofence = nearest.distance <= nearest.branch.radiusMeters;

    // Nhân viên có đơn công tác đã duyệt được MIỄN kiểm tra geofence (BR-ATT-06).
    if (!insideGeofence) {
      const onTrip = await this.attendances.hasApprovedBusinessTrip(
        companyId,
        employee.id,
        new Date(),
      );
      if (onTrip) {
        return {
          branch: nearest.branch,
          distanceMeters: nearest.distance,
          insideGeofence: true,
          radiusMeters: nearest.branch.radiusMeters,
          outOfRangeAction,
          hasLocalNetworkConfig: false,
          matchedLocalNetwork: false,
          // Miễn luôn cả yêu cầu WiFi: người đang ở nhà khách hàng thì không
          // thể bắt WiFi văn phòng, miễn geofence mà không miễn WiFi thì đơn
          // công tác vẫn vô dụng.
          exemptOnTrip: true,
        };
      }
    }

    // AF-02 — xác thực lớp 2 tại chỗ.
    const hasLocalNetworkConfig =
      nearest.branch.wifiBssids.length > 0 || nearest.branch.beaconUuids.length > 0;
    const matchedLocalNetwork =
      (dto.deviceContext.wifiBssid
        ? nearest.branch.wifiBssids.includes(dto.deviceContext.wifiBssid)
        : false) ||
      (dto.deviceContext.beaconUuid
        ? nearest.branch.beaconUuids.includes(dto.deviceContext.beaconUuid)
        : false);

    return {
      branch: nearest.branch,
      distanceMeters: Math.round(nearest.distance * 10) / 10,
      insideGeofence,
      radiusMeters: nearest.branch.radiusMeters,
      outOfRangeAction,
      hasLocalNetworkConfig,
      matchedLocalNetwork,
      exemptOnTrip: false,
    };
  }

  /**
   * AF-02 — bắt buộc kết nối WiFi công ty mới chấm công được.
   *
   * ## Đối chiếu bằng BSSID, KHÔNG bằng SSID
   *
   * SSID là *tên* mạng — ai cũng đặt điểm phát sóng cá nhân tên `AMOBI-WiFi`
   * được trong ba giây. BSSID là địa chỉ MAC của chính bộ phát, gắn với thiết
   * bị phần cứng cụ thể trong văn phòng.
   *
   * `Branch.wifiSsids` vẫn giữ nhưng CHỈ để hiển thị cho HR biết mình đang khai
   * bộ phát nào; nó không tham gia vào quyết định.
   *
   * ## ⚠ Giới hạn — đọc trước khi tin vào chốt này
   *
   * `wifiBssid` do **App tự khai**. Máy đã root, hoặc bản app bị sửa, khai được
   * bất kỳ BSSID nào. Đây đúng là loại dữ liệu mà `BR-02` cảnh báo không được
   * tin — khác với ảnh khuôn mặt, Backend không có cách nào tự kiểm chứng.
   *
   * Vậy nó có tác dụng gì: nâng chi phí tấn công từ "ngồi nhà bấm nút" lên
   * "phải biết BSSID của văn phòng VÀ phải sửa được app". Kết hợp với phát hiện
   * root (`AF-14`) và App Attestation (`AF-15`) thì đủ chặn phần lớn trường
   * hợp. Một mình nó thì không.
   *
   * Muốn ràng buộc mạng thật sự thì phải kiểm ở tầng khác: chỉ cho gọi API
   * chấm công từ dải IP của văn phòng, hoặc dùng chứng chỉ thiết bị cấp qua
   * mạng nội bộ. Chưa làm.
   */
  private async evaluateWifiRequirement(
    companyId: string,
    geo: Awaited<ReturnType<AttendanceService['evaluateGeofence']>>,
    dto: CheckInDto,
  ): Promise<{
    decision: 'ALLOW' | 'FLAG' | 'BLOCK';
    matched: boolean;
    errorCode: 'ATT_WIFI_REQUIRED' | 'ATT_WIFI_NOT_CONFIGURED';
    details: Record<string, unknown>;
  }> {
    const requirement = await this.policy.get<WifiRequirement>(
      companyId,
      PolicyKeys.WIFI_REQUIREMENT,
    );

    const allow = {
      decision: 'ALLOW' as const,
      matched: geo.matchedLocalNetwork,
      errorCode: 'ATT_WIFI_REQUIRED' as const,
      details: {},
    };

    if (requirement === 'OFF') return allow;

    // Đơn công tác đã duyệt được MIỄN (BR-ATT-06). Người đang ở nhà khách hàng
    // thì không thể bắt WiFi văn phòng — không miễn ở đây thì chốt geofence
    // miễn cho họ cũng thành vô nghĩa.
    if (geo.exemptOnTrip) return allow;

    if (!geo.branch) {
      // Công ty chưa cấu hình chi nhánh nào có toạ độ → không xác định được
      // đang ở đâu, cũng không biết BSSID nào là hợp lệ.
      return requirement === 'BLOCK'
        ? {
            decision: 'BLOCK',
            matched: false,
            errorCode: 'ATT_WIFI_NOT_CONFIGURED',
            details: { reason: 'Công ty chưa cấu hình chi nhánh.' },
          }
        : { ...allow, decision: 'FLAG', matched: false };
    }

    const allowed = geo.branch.wifiBssids.map(normalizeBssid).filter(Boolean);
    if (allowed.length === 0) {
      return requirement === 'BLOCK'
        ? {
            decision: 'BLOCK',
            matched: false,
            errorCode: 'ATT_WIFI_NOT_CONFIGURED',
            details: { branchId: geo.branch.id, branchName: geo.branch.name },
          }
        : { ...allow, decision: 'FLAG', matched: false };
    }

    const reported = normalizeBssid(dto.deviceContext.wifiBssid ?? '');
    const matched = reported.length > 0 && allowed.includes(reported);

    if (matched) return { ...allow, matched: true };

    return {
      decision: requirement === 'BLOCK' ? 'BLOCK' : 'FLAG',
      matched: false,
      errorCode: 'ATT_WIFI_REQUIRED',
      details: {
        branchName: geo.branch.name,
        // KHÔNG trả danh sách BSSID hợp lệ về client: đó chính là thứ kẻ tấn
        // công cần để giả mạo. Chỉ cho biết có khai báo hay chưa.
        connected: reported.length > 0,
      },
    };
  }

  /**
   * AF-02b — chỉ chấm công được từ dải IP của mạng văn phòng.
   *
   * ## Vì sao chốt này mạnh hơn hẳn BSSID
   *
   * `wifiBssid` do **App tự khai** — app đã bị sửa khai được bất cứ thứ gì.
   * Địa chỉ IP nguồn thì **server tự quan sát** từ kết nối TCP; client không có
   * cách nào tự đặt. Muốn gói tin đi ra từ IP văn phòng thì phải thật sự ở
   * trong mạng đó, hoặc phải kiểm soát được đường mạng của văn phòng.
   *
   * Hai chốt bổ trợ nhau: IP chứng minh "gói tin đi ra từ mạng văn phòng",
   * BSSID chứng minh "thiết bị đang trong tầm sóng văn phòng". Người cắm VPN về
   * văn phòng qua được chốt IP nhưng không qua được chốt BSSID.
   *
   * ## Phụ thuộc sống còn vào `trust proxy`
   *
   * `request.ip` chỉ đúng khi `TRUSTED_PROXY_HOPS` khai chính xác số proxy đứng
   * trước Backend. Khai thiếu thì đây là IP của Nginx và cả công ty bị chặn;
   * khai thừa thì lấy nhầm mục do client tự thêm vào `X-Forwarded-For` và ai
   * cũng giả mạo được. Xem `main.ts` và `env.validation.ts`.
   */
  private async evaluateIpRestriction(
    companyId: string,
    geo: Awaited<ReturnType<AttendanceService['evaluateGeofence']>>,
    ipAddress: string | undefined,
  ): Promise<{
    decision: 'ALLOW' | 'FLAG' | 'BLOCK';
    errorCode: 'ATT_IP_NOT_ALLOWED' | 'ATT_IP_NOT_CONFIGURED';
    details: Record<string, unknown>;
  }> {
    const requirement = await this.policy.get<IpRestrictionRequirement>(
      companyId,
      PolicyKeys.IP_RESTRICTION_REQUIREMENT,
    );

    const allow = {
      decision: 'ALLOW' as const,
      errorCode: 'ATT_IP_NOT_ALLOWED' as const,
      details: {},
    };

    if (requirement === 'OFF') return allow;

    // Đơn công tác đã duyệt được miễn (BR-ATT-06) — người ở nhà khách hàng
    // không thể đi ra từ IP văn phòng.
    if (geo.exemptOnTrip) return allow;

    const notConfigured = (details: Record<string, unknown>) =>
      requirement === 'BLOCK'
        ? { decision: 'BLOCK' as const, errorCode: 'ATT_IP_NOT_CONFIGURED' as const, details }
        : { ...allow, decision: 'FLAG' as const };

    if (!geo.branch) {
      return notConfigured({ reason: 'Công ty chưa cấu hình chi nhánh.' });
    }

    const allowed = geo.branch.allowedIpCidrs.filter(isValidCidr);
    if (allowed.length === 0) {
      return notConfigured({ branchId: geo.branch.id, branchName: geo.branch.name });
    }

    if (!ipAddress) {
      // Không đọc được địa chỉ nguồn thì không kết luận được là hợp lệ. Cho qua
      // ở đây nghĩa là chỉ cần làm request rơi vào trường hợp biên là thoát chốt.
      this.logger.error(
        'Không đọc được request.ip — kiểm tra cấu hình trust proxy. Đang từ chối chấm công.',
      );
      return requirement === 'BLOCK'
        ? {
            decision: 'BLOCK',
            errorCode: 'ATT_IP_NOT_ALLOWED',
            details: { reason: 'Không xác định được địa chỉ mạng.' },
          }
        : { ...allow, decision: 'FLAG' };
    }

    if (ipInAnyCidr(ipAddress, allowed)) return allow;

    return {
      decision: requirement === 'BLOCK' ? 'BLOCK' : 'FLAG',
      errorCode: 'ATT_IP_NOT_ALLOWED',
      details: {
        branchName: geo.branch.name,
        // ⚠ KHÔNG trả danh sách dải IP hợp lệ về client — đó chính là thứ kẻ
        // tấn công cần để biết mình phải giả mạo cái gì.
      },
    };
  }

  // ===========================================================================
  //  6. Ngày làm việc & ca đêm
  // ===========================================================================

  /**
   * Ngày làm việc quy đổi theo timezone công ty.
   *
   * ⚠ BẪY CA ĐÊM (docs/04 mục 6.4): ca 22:00 → 06:00 hôm sau. Chấm vào ngày 03,
   * chấm ra ngày 04 → CẢ HAI phải gắn với workDate = 03 (ngày BẮT ĐẦU CA),
   * nếu không bảng công bị tách thành hai ngày và tính sai lương.
   */
  private async resolveWorkDate(
    employee: Employee,
    instant: Date,
    timezone: string,
  ): Promise<Date> {
    const calendarDate = toWorkDate(instant, timezone);

    // Kiểm tra ca của NGÀY HÔM TRƯỚC có vắt qua nửa đêm và còn đang chạy không.
    const previousDate = new Date(calendarDate.getTime() - 24 * 60 * 60 * 1000);
    const previousShift = await this.policy.resolveShiftForDate(
      employee.companyId,
      employee.id,
      previousDate,
    );

    if (previousShift?.crossesMidnight && previousShift.endTime) {
      const shiftEnd = combineWorkDateAndTime(previousDate, previousShift.endTime, timezone, 1);
      // Cho phép chấm ra trễ tối đa 3 giờ sau giờ kết thúc ca đêm.
      const graceEnd = new Date(shiftEnd.getTime() + 3 * 60 * 60 * 1000);
      if (instant <= graceEnd) {
        return previousDate;
      }
    }

    return calendarDate;
  }

  private computeLateMinutes(
    shift: Shift,
    workDate: Date,
    timezone: string,
    recordedAt: Date,
    type: AttendanceType,
  ): number {
    if (type !== AttendanceType.CHECK_IN || !shift.startTime) return 0;
    const shiftStart = combineWorkDateAndTime(workDate, shift.startTime, timezone);
    const diff = minutesBetween(shiftStart, recordedAt) - shift.lateToleranceMinutes;
    return Math.max(0, diff);
  }

  // ===========================================================================
  //  7. Truy vấn cho App
  // ===========================================================================

  /** GET /attendance/today */
  /**
   * GET /attendance/history — lịch sử chấm công của CHÍNH người đang đăng nhập.
   *
   * `companyId` và `employeeId` là chốt an toàn chứ không phải bộ lọc tiện dụng:
   * cái đầu cách ly giữa các công ty (BR-09), cái sau bảo đảm không ai đọc được
   * lịch sử của người khác. Cả hai đến từ JWT, không bao giờ từ query.
   */
  async getHistory(
    companyId: string,
    employeeId: string,
    query: { from?: string; to?: string; status?: DailyStatus; skip: number; take: number },
  ) {
    return this.attendances.searchDaily(companyId, {
      employeeId,
      from: query.from ? parseWorkDate(query.from) : undefined,
      to: query.to ? parseWorkDate(query.to) : undefined,
      status: query.status,
      skip: query.skip,
      take: query.take,
    });
  }

  async getToday(ctx: RequestContext) {
    const employee = await this.requireActiveEmployee(ctx);
    const timezone = await this.policy.getTimezone(employee.companyId, employee.branchId);
    const now = new Date();
    const workDate = await this.resolveWorkDate(employee, now, timezone);

    const [shift, logs, daily, branch] = await Promise.all([
      this.policy.resolveShiftForDate(employee.companyId, employee.id, workDate),
      this.attendances.listPunchesForDay(employee.companyId, employee.id, workDate),
      this.attendances.findDaily(employee.companyId, employee.id, workDate),
      this.attendances.findBranchForEmployee(employee.companyId, employee.branchId),
    ]);

    const lastPunch = [...logs]
      .reverse()
      .find((log) => log.type === AttendanceType.CHECK_IN || log.type === AttendanceType.CHECK_OUT);

    // Đồng hồ đếm giờ của App tính từ mốc này — dùng giờ server, không dùng giờ máy.
    const firstCheckIn = logs.find((log) => log.type === AttendanceType.CHECK_IN);
    const workedMinutes =
      daily?.workedMinutes ??
      (firstCheckIn && lastPunch?.type === AttendanceType.CHECK_IN
        ? minutesBetween(firstCheckIn.recordedAt, now)
        : 0);

    return {
      workDate: formatWorkDate(workDate),
      serverTime: now.toISOString(),
      shift: shift
        ? {
            id: shift.id,
            name: shift.name,
            type: shift.type,
            startTime: shift.startTime,
            endTime: shift.endTime,
            breakMinutes: shift.breakMinutes,
            crossesMidnight: shift.crossesMidnight,
            segments: shift.segments,
          }
        : null,
      status: lastPunch?.type === AttendanceType.CHECK_IN ? 'CHECKED_IN' : 'CHECKED_OUT',
      logs,
      workedMinutes,
      daily,
      branch: branch
        ? {
            id: branch.id,
            name: branch.name,
            latitude: branch.latitude,
            longitude: branch.longitude,
            radiusMeters: branch.radiusMeters,
          }
        : null,
    };
  }

  /** GET /attendance/{id} — chi tiết một lượt, kèm ảnh qua presigned URL. */
  async getLogDetail(companyId: string, logId: string, restrictToEmployeeId?: string) {
    const log = await this.attendances.findLogDetail(companyId, logId, restrictToEmployeeId);
    if (!log) {
      throw new AppException('ATT_NOT_FOUND');
    }

    const employee = await this.attendances.findEmployeeSummary(companyId, log.employeeId);

    return {
      ...log,
      employee,
      // NFR-SEC-12: ảnh chỉ truy cập qua presigned URL TTL ≤ 5 phút.
      // NFR-LEGAL-04: quá thời hạn lưu thì trả null, không phục vụ nữa.
      photoUrl: await this.getAttendancePhotoUrl(companyId, log.recordedAt, log.photoKey),
    };
  }

  /**
   * Sinh presigned URL cho ảnh chấm công — KÈM kiểm tra thời hạn lưu.
   *
   * ## Vì sao phải kiểm tuổi ở đây thay vì xoá `photoKey` trong DB
   *
   * `RetentionProcessor` xoá ảnh khỏi kho lưu trữ khi quá
   * `BIOMETRIC_PHOTO_RETENTION_DAYS`, nhưng KHÔNG xoá được `photoKey` khỏi
   * `attendance_log` — bảng đó có rule `DO INSTEAD NOTHING` cho mọi UPDATE
   * (`BR-06`). Mà kể cả xoá được cũng không nên: `photoHash` vẫn cần cho việc
   * đối chiếu tranh chấp, và `photoKey` là dấu vết cho biết từng có ảnh.
   *
   * Nên việc "ảnh này còn được phục vụ không" suy ra từ TUỔI bản ghi. Cách này
   * tự nhất quán: đổi chính sách thì hành vi đổi theo ngay, không cần chạy lại
   * job nào.
   *
   * ## Chặt hơn về một phía
   *
   * Nếu job dọn chưa chạy mà bản ghi đã quá hạn → vẫn không phục vụ. Đúng ý:
   * quá hạn là quá hạn, không phụ thuộc job có kịp chạy hay không.
   *
   * Nếu chính sách vừa được nới dài ra mà ảnh đã bị xoá → trả URL trỏ tới đối
   * tượng không còn. Đây là đánh đổi đã biết; nới chính sách không khôi phục
   * lại được thứ đã xoá.
   *
   * ⚠ MỌI chỗ trả `photoUrl` cho client phải đi qua hàm này. Gọi thẳng
   * `storage.getPresignedUrl` sẽ phục vụ cả ảnh đáng lẽ đã hết hạn lưu.
   */
  async getAttendancePhotoUrl(
    companyId: string,
    recordedAt: Date,
    photoKey: string | null | undefined,
  ): Promise<string | null> {
    if (!photoKey) return null;

    const retentionDays = await this.policy.getNumber(
      companyId,
      PolicyKeys.BIOMETRIC_PHOTO_RETENTION_DAYS,
    );

    // <= 0 nghĩa là giữ vĩnh viễn.
    if (retentionDays > 0) {
      const ageDays = (Date.now() - recordedAt.getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays > retentionDays) return null;
    }

    return this.storage.getPresignedUrl(photoKey);
  }

  // ===========================================================================
  //  8. Tiện ích dùng chung
  // ===========================================================================

  async enqueueRecalculate(companyId: string, employeeId: string, workDate: Date): Promise<void> {
    await this.payrollQueue
      .add(
        JOBS.RECALCULATE_DAILY,
        { companyId, employeeId, workDate: formatWorkDate(workDate) },
        {
          // Idempotent: nhiều lượt chấm công trong cùng ngày gộp thành một job.
          jobId: `daily:${employeeId}:${formatWorkDate(workDate)}`,
          removeOnComplete: true,
        },
      )
      .catch((error: Error) => this.logger.warn(`Không đẩy được job tính công: ${error.message}`));
  }

  private async consumeChallenge(userId: string, nonce: string): Promise<ChallengePayload> {
    const key = RedisKeys.attendanceChallenge(userId, nonce);
    const challenge = await this.redis.getJson<ChallengePayload>(key);
    if (!challenge) {
      throw new AppException('ATT_INVALID_NONCE');
    }

    // AF-12: nonce dùng MỘT LẦN. SETNX nguyên tử, an toàn với nhiều pod.
    const fresh = await this.redis.consumeOnce(RedisKeys.attendanceNonceUsed(nonce), 300);
    if (!fresh) {
      throw new AppException('FRAUD_REPLAY_DETECTED');
    }
    await this.redis.del(key);

    return challenge;
  }

  private async isKnownDevice(userId: string, deviceId: string): Promise<boolean> {
    return this.attendances.isDeviceActive(userId, deviceId);
  }

  /** FR-APP-FACE-05 — giới hạn số lần thử, tạm khoá khi vượt ngưỡng. */
  private async registerFailedAttempt(companyId: string, employeeId: string): Promise<void> {
    const attempts = await this.redis.incrementWithTtl(RedisKeys.faceAttempts(employeeId), 3600);
    const max = await this.policy.getNumber(companyId, PolicyKeys.FACE_MAX_ATTEMPTS_PER_HOUR);
    if (attempts > max) {
      throw new AppException('FACE_MAX_ATTEMPTS', { attempts, max });
    }
  }

  private async requireActiveEmployee(ctx: RequestContext): Promise<Employee> {
    if (!ctx.employeeId || !ctx.companyId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }

    const employee = await this.attendances.findEmployee(ctx.companyId, ctx.employeeId);
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }
    if (
      employee.status === EmployeeStatus.SUSPENDED ||
      employee.status === EmployeeStatus.TERMINATED
    ) {
      throw new AppException('AUTH_ACCOUNT_SUSPENDED');
    }
    return employee;
  }

  /** Khoảng thời gian UTC tương ứng một ngày làm việc — dùng chung với engine tính công. */
  async workDayBounds(companyId: string, workDate: Date): Promise<{ start: Date; end: Date }> {
    const timezone = await this.policy.getTimezone(companyId);
    return dayBoundsUtc(workDate, timezone);
  }

  /** Giờ địa phương của một instant — phục vụ hiển thị. */
  localTimeOf(instant: Date, timezone: string): string {
    return inZone(instant, timezone).toFormat('HH:mm:ss');
  }

  toAppError(code: string): AppException {
    return new AppException(code as ErrorCode);
  }
}
