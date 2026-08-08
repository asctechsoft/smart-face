import { Injectable, Logger } from '@nestjs/common';
import { AttendanceDecision, Prisma, SystemRole } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import { buildMeta, derivedSpeedMps, isExactSameCoordinate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { FraudWeights, PolicyKeys } from '../policy/policy.constants';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../notification/realtime.gateway';
import {
  FraudCodes,
  FraudEvaluationInput,
  FraudEvaluationResult,
  FraudSignal,
} from './fraud.types';
import { FraudFlagQueryDto } from './dto/fraud.dto';

/**
 * Fraud scoring — docs/06-anti-fraud.md mục 7.
 *
 * Nguyên tắc thiết kế quan trọng nhất (mục 7.2):
 *   "Ưu tiên GẮN CỜ để con người xem xét hơn là chặn cứng. Chặn nhầm một nhân
 *    viên thật gây bức xúc lớn và tạo gánh nặng hỗ trợ."
 *
 * Vì vậy chỉ có hai nhóm bị chặn cứng:
 *   - Vi phạm chính sách rõ ràng (mock GPS / root khi công ty bật chặn) — xử lý
 *     ở AttendanceService TRƯỚC khi gọi hàm này.
 *   - Điểm rủi ro tổng ≥ ngưỡng reject (mặc định 80).
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ===========================================================================
  //  Chấm điểm realtime
  // ===========================================================================

  /**
   * Chấm điểm rủi ro cho một lượt chấm công, chạy ĐỒNG BỘ trên đường chấm công.
   *
   * Cách hoạt động: thu thập các tín hiệu độc lập (GPS giả, thiết bị root, tốc
   * độ di chuyển bất thường, điểm khuôn mặt thấp, lệch giờ máy…), mỗi tín hiệu
   * cộng một số điểm theo trọng số cấu hình được, rồi so tổng với ngưỡng.
   *
   * Vì sao CỘNG ĐIỂM chứ không chặn theo từng tín hiệu: mỗi tín hiệu riêng lẻ
   * đều có tỷ lệ báo nhầm cao. GPS lệch 200m trong nhà xưởng là bình thường;
   * máy "root" có khi là điện thoại của lập trình viên. Nhưng GPS lệch CỘNG máy
   * root CỘNG điểm khuôn mặt thấp cùng lúc thì khả năng gian lận là thật.
   *
   * ⚠ Hàm này chạy trong mỗi lần chấm công nên phải NHANH. Các phân tích tốn
   * kém (đối chiếu lại ảnh, so sánh hành vi dài hạn) đẩy sang job chạy nền
   * `fraud-scan.processor.ts`.
   */
  async evaluate(input: FraudEvaluationInput): Promise<FraudEvaluationResult> {
    // `Promise.all` vì hai lần đọc chính sách độc lập nhau — chạy tuần tự là
    // cộng thêm một vòng round-trip vào đường nóng nhất của hệ thống.
    const [weights, thresholds] = await Promise.all([
      this.policy.get<FraudWeights>(input.companyId, PolicyKeys.FRAUD_WEIGHTS),
      this.loadThresholds(input.companyId),
    ]);

    // Gom tín hiệu vào một mảng rồi mới cộng điểm ở cuối, thay vì cộng dần vào
    // một biến. Nhờ vậy giữ được LÝ DO của từng điểm để hiển thị cho người xét
    // duyệt — thấy "78 điểm" mà không biết gồm những gì thì không quyết được.
    const signals: FraudSignal[] = [];
    const add = (signal: FraudSignal) => signals.push(signal);

    // --- Vị trí (AF-01, AF-04) ------------------------------------------------
    if (input.isMockLocation) {
      add({
        code: FraudCodes.MOCK_LOCATION,
        severity: 'HIGH',
        score: weights.MOCK_LOCATION,
        message: 'Phát hiện ứng dụng giả lập vị trí.',
      });
    }

    const maxAccuracy = await this.policy.getNumber(input.companyId, PolicyKeys.GPS_MAX_ACCURACY_M);
    if (input.gpsAccuracy != null && input.gpsAccuracy > maxAccuracy) {
      add({
        code: FraudCodes.LOW_GPS_ACCURACY,
        severity: 'LOW',
        score: weights.LOW_GPS_ACCURACY,
        message: `Độ chính xác GPS ${Math.round(input.gpsAccuracy)}m vượt ngưỡng ${maxAccuracy}m.`,
        details: { gpsAccuracy: input.gpsAccuracy, threshold: maxAccuracy },
      });
    }

    if (input.insideGeofence === false) {
      add({
        code: FraudCodes.OUT_OF_GEOFENCE,
        severity: 'MEDIUM',
        score: weights.OUT_OF_GEOFENCE,
        message: `Ở ngoài vùng cho phép${
          input.distanceToBranchM ? ` (${Math.round(input.distanceToBranchM)}m)` : ''
        }. Lượt chấm công này sẽ được quản lý xem xét.`,
        details: { distanceToBranchM: input.distanceToBranchM },
      });
    }

    // AF-02: GPS báo trong vùng nhưng không thấy WiFi/beacon văn phòng.
    if (
      input.branchHasLocalNetworkConfig &&
      !input.matchedLocalNetwork &&
      input.insideGeofence === true
    ) {
      add({
        code: FraudCodes.MISSING_LOCAL_NETWORK,
        severity: 'MEDIUM',
        score: weights.MISSING_LOCAL_NETWORK,
        message: 'GPS báo trong vùng nhưng không phát hiện WiFi/beacon của văn phòng.',
      });
    }

    // AF-04: toạ độ trùng KHÍT với lần trước → dấu hiệu toạ độ set cứng.
    //
    // Đây là tín hiệu tinh vi hơn cờ `isMocked` và không dựa vào lời khai của
    // App. GPS thật luôn dao động vài mét ở chữ số thập phân cuối, kể cả khi
    // đứng yên tại chỗ — hai lượt chấm công cách nhau 8 tiếng mà ra đúng từng
    // chữ số thì toạ độ đó là một hằng số ai đó nhập vào, không phải đo được.
    if (input.latitude != null && input.longitude != null) {
      const previous = await this.prisma.attendanceLog.findFirst({
        where: { companyId: input.companyId, employeeId: input.employeeId },
        orderBy: { recordedAt: 'desc' },
        select: { latitude: true, longitude: true },
      });
      if (
        previous?.latitude != null &&
        previous.longitude != null &&
        isExactSameCoordinate(
          { latitude: input.latitude, longitude: input.longitude },
          { latitude: previous.latitude, longitude: previous.longitude },
        )
      ) {
        add({
          code: FraudCodes.IDENTICAL_COORDINATE,
          severity: 'MEDIUM',
          score: weights.IDENTICAL_COORDINATE,
          message: 'Toạ độ trùng khít tuyệt đối với lượt chấm công trước.',
        });
      }
    }

    // --- Thiết bị (AF-14, AF-15, AF-07) ---------------------------------------
    if (input.isRootedDevice) {
      add({
        code: FraudCodes.ROOTED_DEVICE,
        severity: 'HIGH',
        score: weights.ROOTED_DEVICE,
        message: 'Thiết bị đã root/jailbreak.',
      });
    }
    if (input.attestationPassed === false) {
      add({
        code: FraudCodes.ATTESTATION_FAILED,
        severity: 'HIGH',
        score: weights.ATTESTATION_FAILED,
        message: 'Không xác minh được tính toàn vẹn của ứng dụng.',
      });
    }
    // Thiết bị lạ là tín hiệu mạnh nhưng KHÔNG được chặn cứng: người đổi điện
    // thoại hoặc mượn máy khi máy mình hết pin là chuyện có thật. Cộng điểm để
    // nó kết hợp với các tín hiệu khác, thay vì khoá người ta ra ngoài.
    if (!input.isKnownDevice) {
      add({
        code: FraudCodes.UNKNOWN_DEVICE,
        severity: 'HIGH',
        score: weights.UNKNOWN_DEVICE,
        message: 'Chấm công trên thiết bị chưa được liên kết.',
      });
    }

    // --- Lệch giờ (AF-18) ------------------------------------------------------
    if (input.clockSkewSeconds != null) {
      const [flagSeconds, tamperSeconds] = await Promise.all([
        this.policy.getNumber(input.companyId, PolicyKeys.CLOCK_SKEW_FLAG_SECONDS),
        this.policy.getNumber(input.companyId, PolicyKeys.CLOCK_SKEW_TAMPER_SECONDS),
      ]);

      if (input.clockSkewSeconds > tamperSeconds) {
        add({
          code: FraudCodes.CLOCK_TAMPERING,
          severity: 'HIGH',
          score: weights.CLOCK_TAMPERING,
          message: `Giờ thiết bị lệch ${Math.round(input.clockSkewSeconds / 60)} phút so với giờ hệ thống.`,
          details: { clockSkewSeconds: input.clockSkewSeconds },
        });
      } else if (input.clockSkewSeconds > flagSeconds) {
        add({
          code: FraudCodes.CLOCK_SKEW,
          severity: 'LOW',
          score: weights.CLOCK_SKEW,
          message: `Giờ thiết bị lệch ${input.clockSkewSeconds} giây so với giờ hệ thống.`,
          details: { clockSkewSeconds: input.clockSkewSeconds },
        });
      }
    }

    // --- Kết quả AI ------------------------------------------------------------
    if (input.livenessScore != null) {
      const threshold = await this.policy.getNumber(
        input.companyId,
        PolicyKeys.FACE_LIVENESS_THRESHOLD,
      );
      // Gần ngưỡng (trong biên 0.10) → đáng ngờ dù đã qua.
      if (input.livenessScore >= threshold && input.livenessScore < threshold + 0.1) {
        add({
          code: FraudCodes.LOW_LIVENESS,
          severity: 'MEDIUM',
          score: weights.LOW_LIVENESS,
          message: 'Điểm liveness sát ngưỡng cho phép.',
          details: { livenessScore: input.livenessScore, threshold },
        });
      }
    }

    if (input.matchScore != null) {
      const threshold = await this.policy.getNumber(
        input.companyId,
        PolicyKeys.FACE_MATCH_THRESHOLD,
      );
      if (input.matchScore >= threshold && input.matchScore < threshold + 0.05) {
        add({
          code: FraudCodes.BORDERLINE_MATCH,
          severity: 'MEDIUM',
          score: weights.BORDERLINE_MATCH,
          message: 'Điểm tương đồng khuôn mặt sát ngưỡng cho phép.',
          details: { matchScore: input.matchScore, threshold },
        });
      }
    }

    // --- Đối chiếu với lịch sử (AF-03, AF-09) ---------------------------------
    signals.push(...(await this.checkImpossibleTravel(input, weights)));
    signals.push(...(await this.checkMultiDevice(input, weights)));

    const score = signals.reduce((sum, signal) => sum + signal.score, 0);

    let decision: AttendanceDecision = AttendanceDecision.ACCEPTED;
    if (score >= thresholds.reject) {
      decision = AttendanceDecision.REJECTED;
    } else if (score >= thresholds.pendingReview) {
      decision = AttendanceDecision.PENDING_REVIEW;
    } else if (score >= thresholds.flag) {
      decision = AttendanceDecision.FLAGGED;
    }

    return {
      score,
      signals,
      decision,
      rejectionCode: decision === AttendanceDecision.REJECTED ? 'FRAUD_RISK_TOO_HIGH' : undefined,
      thresholds,
    };
  }

  /** AF-03 — di chuyển bất khả thi so với lượt chấm công liền trước. */
  private async checkImpossibleTravel(
    input: FraudEvaluationInput,
    weights: FraudWeights,
  ): Promise<FraudSignal[]> {
    if (input.latitude == null || input.longitude == null) return [];

    const previous = await this.prisma.attendanceLog.findFirst({
      where: {
        companyId: input.companyId,
        employeeId: input.employeeId,
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true, recordedAt: true, gpsAccuracy: true },
    });
    if (!previous?.latitude || !previous.longitude) return [];

    const elapsedSeconds = (input.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
    // Ngoại lệ: khoảng quá ngắn là nhiễu GPS, bỏ qua.
    if (elapsedSeconds < 60) return [];
    // Ngoại lệ: sai số GPS lớn ở một trong hai điểm.
    if ((previous.gpsAccuracy ?? 0) > 100 || (input.gpsAccuracy ?? 0) > 100) return [];

    // Ngoại lệ: nhân viên có đơn công tác đã duyệt (đi máy bay).
    const onBusinessTrip = await this.prisma.leaveRequest.findFirst({
      where: {
        companyId: input.companyId,
        employeeId: input.employeeId,
        status: 'APPROVED',
        startAt: { lte: input.recordedAt },
        endAt: { gte: input.recordedAt },
        requestType: { code: { in: ['BUSINESS_TRIP', 'CONG_TAC'] } },
      },
      select: { id: true },
    });
    if (onBusinessTrip) return [];

    const speed = derivedSpeedMps(
      { latitude: previous.latitude, longitude: previous.longitude },
      { latitude: input.latitude, longitude: input.longitude },
      elapsedSeconds,
    );

    const [impossibleMps, suspiciousMps] = await Promise.all([
      this.policy.getNumber(input.companyId, PolicyKeys.FRAUD_IMPOSSIBLE_TRAVEL_MPS),
      this.policy.getNumber(input.companyId, PolicyKeys.FRAUD_SUSPICIOUS_TRAVEL_MPS),
    ]);

    if (speed > impossibleMps) {
      return [
        {
          code: FraudCodes.IMPOSSIBLE_TRAVEL,
          severity: 'HIGH',
          score: weights.IMPOSSIBLE_TRAVEL,
          message: `Tốc độ di chuyển suy ra ${Math.round(speed * 3.6)} km/h — vượt khả năng thực tế.`,
          details: { speedMps: speed, thresholdMps: impossibleMps, elapsedSeconds },
        },
      ];
    }
    if (speed > suspiciousMps) {
      return [
        {
          code: FraudCodes.SUSPICIOUS_TRAVEL,
          severity: 'MEDIUM',
          score: Math.round(weights.IMPOSSIBLE_TRAVEL / 2),
          message: `Tốc độ di chuyển suy ra ${Math.round(speed * 3.6)} km/h — cần xem xét.`,
          details: { speedMps: speed, thresholdMps: suspiciousMps },
        },
      ];
    }
    return [];
  }

  /** AF-09 — một tài khoản chấm công trên 2 thiết bị trong thời gian ngắn. */
  private async checkMultiDevice(
    input: FraudEvaluationInput,
    weights: FraudWeights,
  ): Promise<FraudSignal[]> {
    if (!input.deviceId) return [];

    const windowMinutes = await this.policy.getNumber(
      input.companyId,
      PolicyKeys.FRAUD_MULTI_DEVICE_WINDOW_MIN,
    );
    const since = new Date(input.recordedAt.getTime() - windowMinutes * 60_000);

    const other = await this.prisma.attendanceLog.findFirst({
      where: {
        companyId: input.companyId,
        employeeId: input.employeeId,
        recordedAt: { gte: since },
        deviceId: { not: null, notIn: [input.deviceId] },
      },
      select: { deviceId: true, recordedAt: true },
    });
    if (!other) return [];

    return [
      {
        code: FraudCodes.MULTI_DEVICE_ANOMALY,
        severity: 'HIGH',
        score: weights.MULTI_DEVICE_ANOMALY,
        message: `Tài khoản vừa chấm công trên thiết bị khác cách đây dưới ${windowMinutes} phút.`,
        details: { otherDeviceId: other.deviceId, otherRecordedAt: other.recordedAt },
      },
    ];
  }

  private async loadThresholds(companyId: string) {
    const [flag, pendingReview, reject] = await Promise.all([
      this.policy.getNumber(companyId, PolicyKeys.FRAUD_THRESHOLD_FLAG),
      this.policy.getNumber(companyId, PolicyKeys.FRAUD_THRESHOLD_PENDING_REVIEW),
      this.policy.getNumber(companyId, PolicyKeys.FRAUD_THRESHOLD_REJECT),
    ]);
    return { flag, pendingReview, reject };
  }

  // ===========================================================================
  //  Ghi cờ
  // ===========================================================================

  async persistFlags(params: {
    companyId: string;
    employeeId: string;
    attendanceLogId: string | null;
    signals: FraudSignal[];
  }): Promise<void> {
    if (params.signals.length === 0) return;

    await this.prisma.fraudFlag.createMany({
      data: params.signals.map((signal) => ({
        companyId: params.companyId,
        employeeId: params.employeeId,
        attendanceLogId: params.attendanceLogId,
        code: signal.code,
        severity: signal.severity,
        score: signal.score,
        details: (signal.details ?? {}) as Prisma.InputJsonValue,
      })),
    });

    // AF-09: cờ mức CAO cảnh báo NGAY, không đợi job nền.
    const highSeverity = params.signals.filter((signal) => signal.severity === 'HIGH');
    if (highSeverity.length > 0) {
      this.realtime.emitToCompanyRoles(
        params.companyId,
        [SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL],
        'fraud.flagged',
        {
          employeeId: params.employeeId,
          attendanceLogId: params.attendanceLogId,
          codes: highSeverity.map((signal) => signal.code),
        },
      );
    }
  }

  // ===========================================================================
  //  Dashboard cảnh báo (AF-21) & xử lý cờ (AF-23)
  // ===========================================================================

  /**
   * @param departmentScope null = không giới hạn (Admin/HR); mảng = chỉ các phòng
   *        ban MANAGER được phân công. Do controller truyền vào, không lấy từ query.
   */
  async listFlags(
    companyId: string,
    query: FraudFlagQueryDto,
    departmentScope: string[] | null,
  ) {
    const where: Prisma.FraudFlagWhereInput = { companyId };

    if (query.severity) where.severity = query.severity;
    if (query.code) where.code = query.code;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.reviewed === 'true') where.reviewedAt = { not: null };
    if (query.reviewed === 'false') where.reviewedAt = null;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    // ScopeGuard: MANAGER chỉ thấy cờ của nhân viên trong phòng ban mình quản lý.
    if (departmentScope || query.departmentId) {
      const employees = await this.prisma.employee.findMany({
        where: {
          companyId,
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
        },
        select: { id: true },
      });
      where.employeeId = { in: employees.map((employee) => employee.id) };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          attendanceLog: {
            select: {
              id: true,
              type: true,
              recordedAt: true,
              workDate: true,
              fraudScore: true,
              decision: true,
              latitude: true,
              longitude: true,
              distanceToBranchM: true,
            },
          },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    const items = rows.map((row) => ({
      ...row,
      employee: employeeMap.get(row.employeeId) ?? null,
    }));

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  async getFlag(companyId: string, flagId: string) {
    const flag = await this.prisma.fraudFlag.findFirst({
      where: { id: flagId, companyId },
      include: { attendanceLog: true },
    });
    if (!flag) {
      throw new AppException('SYS_NOT_FOUND', { reason: 'Không tìm thấy cờ nghi vấn.' });
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: flag.employeeId, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });

    return { ...flag, employee };
  }

  /** Thống kê cho dashboard (AF-21). */
  async stats(companyId: string, from?: Date, to?: Date) {
    const where: Prisma.FraudFlagWhereInput = { companyId };
    if (from || to) {
      where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    // groupBy tách khỏi $transaction([...]) vì gộp mảng làm mất kiểu narrow của `_count`.
    const [total, high, pending, reviewed] = await this.prisma.$transaction([
      this.prisma.fraudFlag.count({ where }),
      this.prisma.fraudFlag.count({ where: { ...where, severity: 'HIGH' } }),
      this.prisma.fraudFlag.count({ where: { ...where, reviewedAt: null } }),
      this.prisma.fraudFlag.count({ where: { ...where, reviewedAt: { not: null } } }),
    ]);

    const byCode = await this.prisma.fraudFlag.groupBy({
      by: ['code'],
      where,
      _count: { code: true },
      orderBy: { _count: { code: 'desc' } },
    });

    return {
      total,
      high,
      pending,
      reviewed,
      byCode: byCode.map((row) => ({ code: row.code, count: row._count.code })),
    };
  }

  /**
   * AF-23 — quyết định giữ/huỷ công nghi vấn.
   *
   * Việc huỷ công (VOID) tạo `AttendanceAdjustment` và kích hoạt tính lại — do
   * AttendanceService xử lý, service này chỉ chốt trạng thái cờ và báo nhân viên.
   *
   * ⚠ Quan trọng về pháp lý: nhân viên PHẢI được thông báo khi công bị huỷ và
   * xem được lý do. Huỷ công âm thầm là nguồn tranh chấp lao động.
   */
  async markReviewed(
    companyId: string,
    flagId: string,
    decision: 'KEEP' | 'VOID' | 'ESCALATE',
    reason: string,
    reviewedBy: string,
  ) {
    const flag = await this.prisma.fraudFlag.findFirst({ where: { id: flagId, companyId } });
    if (!flag) {
      throw new AppException('SYS_NOT_FOUND', { reason: 'Không tìm thấy cờ nghi vấn.' });
    }

    const updated = await this.prisma.fraudFlag.update({
      where: { id: flagId },
      data: {
        reviewedBy,
        reviewedAt: new Date(),
        reviewDecision: decision,
        reviewReason: reason,
      },
    });

    if (decision === 'VOID') {
      await this.notifications.notify({
        companyId,
        employeeId: flag.employeeId,
        type: 'ATTENDANCE_VOIDED',
        title: 'Một lượt chấm công của bạn đã bị huỷ',
        body: `Lý do: ${reason}. Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ bộ phận nhân sự.`,
        data: { fraudFlagId: flagId, attendanceLogId: flag.attendanceLogId },
      });
    }

    return updated;
  }

  /** Các cờ chưa xử lý trong khoảng thời gian — chặn chốt kỳ lương (docs/04 mục 7.2). */
  async countUnreviewedInRange(companyId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.fraudFlag.count({
      where: { companyId, reviewedAt: null, createdAt: { gte: from, lte: to } },
    });
  }
}
