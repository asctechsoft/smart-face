import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AttendanceDecision, AttendanceType, DailyStatus, RequestStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { derivedSpeedMps, toWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { FraudService } from 'src/modules/fraud/fraud.service';
import { FraudCodes, FraudSignal } from 'src/modules/fraud/fraud.types';
import { PolicyKeys } from 'src/modules/policy/policy.constants';
import { PolicyService } from 'src/modules/policy/policy.service';
import { JOBS, QUEUES } from '../queue.constants';

/**
 * Queue `fraud-scan` — chạy mỗi 15 phút (docs/02 mục 10).
 *
 * Ba loại quét nền không làm được realtime:
 *   AF-03 — impossible travel (cần so hai lượt liên tiếp)
 *   AF-19 — thời lượng ca quá ngắn ("ghé qua rồi đi")
 *   AF-19 — chấm vào mà không chấm ra
 */
@Processor(QUEUES.FRAUD_SCAN)
export class FraudScanProcessor extends WorkerHost {
  private readonly logger = new Logger(FraudScanProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly fraud: FraudService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOBS.SCAN_IMPOSSIBLE_TRAVEL:
        return this.scanImpossibleTravel();
      case JOBS.SCAN_SHORT_ATTENDANCE:
        return this.scanShortAttendance();
      case JOBS.SCAN_MISSING_CHECKOUT:
        return this.scanMissingCheckout();
      default:
        this.logger.warn(`Job không xác định trong queue fraud-scan: ${job.name}`);
        return null;
    }
  }

  /** AF-03 — di chuyển bất khả thi giữa hai lượt chấm công liên tiếp. */
  private async scanImpossibleTravel() {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        recordedAt: { gte: since },
        latitude: { not: null },
        longitude: { not: null },
        decision: { not: AttendanceDecision.REJECTED },
      },
      orderBy: [{ employeeId: 'asc' }, { recordedAt: 'asc' }],
      select: {
        id: true,
        companyId: true,
        employeeId: true,
        latitude: true,
        longitude: true,
        gpsAccuracy: true,
        recordedAt: true,
      },
    });

    const byEmployee = new Map<string, typeof logs>();
    for (const log of logs) {
      byEmployee.set(log.employeeId, [...(byEmployee.get(log.employeeId) ?? []), log]);
    }

    let flagged = 0;

    for (const [employeeId, employeeLogs] of byEmployee) {
      for (let index = 1; index < employeeLogs.length; index += 1) {
        const previous = employeeLogs[index - 1];
        const current = employeeLogs[index];

        const elapsedSeconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
        // Ngoại lệ: khoảng quá ngắn là nhiễu GPS.
        if (elapsedSeconds < 60) continue;
        // Ngoại lệ: sai số GPS lớn ở một trong hai điểm.
        if ((previous.gpsAccuracy ?? 0) > 100 || (current.gpsAccuracy ?? 0) > 100) continue;
        // Ngoại lệ: có đơn công tác đã duyệt.
        if (await this.hasApprovedTrip(current.companyId, employeeId, current.recordedAt)) continue;

        const speed = derivedSpeedMps(
          { latitude: previous.latitude as number, longitude: previous.longitude as number },
          { latitude: current.latitude as number, longitude: current.longitude as number },
          elapsedSeconds,
        );

        const [impossibleMps, suspiciousMps] = await Promise.all([
          this.policy.getNumber(current.companyId, PolicyKeys.FRAUD_IMPOSSIBLE_TRAVEL_MPS),
          this.policy.getNumber(current.companyId, PolicyKeys.FRAUD_SUSPICIOUS_TRAVEL_MPS),
        ]);

        const signal = this.buildTravelSignal(speed, impossibleMps, suspiciousMps, elapsedSeconds);
        if (!signal) continue;

        if (await this.alreadyFlagged(current.id, signal.code)) continue;

        await this.fraud.persistFlags({
          companyId: current.companyId,
          employeeId,
          attendanceLogId: current.id,
          signals: [signal],
        });
        flagged += 1;
      }
    }

    return { scanned: logs.length, flagged };
  }

  private buildTravelSignal(
    speed: number,
    impossibleMps: number,
    suspiciousMps: number,
    elapsedSeconds: number,
  ): FraudSignal | null {
    if (speed > impossibleMps) {
      return {
        code: FraudCodes.IMPOSSIBLE_TRAVEL,
        severity: 'HIGH',
        score: 45,
        message: `Tốc độ di chuyển suy ra ${Math.round(speed * 3.6)} km/h — vượt khả năng thực tế.`,
        details: { speedMps: speed, thresholdMps: impossibleMps, elapsedSeconds },
      };
    }
    if (speed > suspiciousMps) {
      return {
        code: FraudCodes.SUSPICIOUS_TRAVEL,
        severity: 'MEDIUM',
        score: 22,
        message: `Tốc độ di chuyển suy ra ${Math.round(speed * 3.6)} km/h — cần xem xét.`,
        details: { speedMps: speed, thresholdMps: suspiciousMps, elapsedSeconds },
      };
    }
    return null;
  }

  /** AF-19 — thời lượng giữa chấm vào/ra quá ngắn so với ca chuẩn. */
  private async scanShortAttendance() {
    const yesterday = toWorkDate(new Date(Date.now() - 24 * 60 * 60 * 1000), 'UTC');

    const dailies = await this.prisma.attendanceDaily.findMany({
      where: {
        workDate: yesterday,
        workedMinutes: { gt: 0 },
        status: { notIn: [DailyStatus.ON_LEAVE, DailyStatus.HOLIDAY] },
      },
      select: {
        companyId: true,
        employeeId: true,
        workedMinutes: true,
        workDate: true,
        shiftId: true,
      },
    });

    let flagged = 0;

    for (const daily of dailies) {
      const shift = await this.policy.resolveShiftForDate(
        daily.companyId,
        daily.employeeId,
        daily.workDate,
      );
      const expectedMinutes =
        shift?.requiredMinutes ??
        (await this.policy.getNumber(daily.companyId, PolicyKeys.PAYROLL_MINUTES_PER_STANDARD_DAY));
      if (expectedMinutes <= 0) continue;

      // Ngoại lệ: có đơn về sớm / xin ra ngoài / nghỉ nửa ngày đã duyệt.
      if (await this.hasApprovedRequestOnDate(daily.companyId, daily.employeeId, daily.workDate)) {
        continue;
      }

      const ratio = daily.workedMinutes / expectedMinutes;
      const [highRatio, mediumRatio] = await Promise.all([
        this.policy.getNumber(daily.companyId, PolicyKeys.FRAUD_SHORT_ATTENDANCE_HIGH_RATIO),
        this.policy.getNumber(daily.companyId, PolicyKeys.FRAUD_SHORT_ATTENDANCE_MEDIUM_RATIO),
      ]);

      if (ratio >= mediumRatio) continue;

      await this.fraud.persistFlags({
        companyId: daily.companyId,
        employeeId: daily.employeeId,
        attendanceLogId: null,
        signals: [
          {
            code: FraudCodes.SHORT_ATTENDANCE,
            severity: ratio < highRatio ? 'HIGH' : 'MEDIUM',
            score: ratio < highRatio ? 30 : 20,
            message: `Chỉ làm ${daily.workedMinutes}/${expectedMinutes} phút (${Math.round(ratio * 100)}% ca chuẩn).`,
            details: { workedMinutes: daily.workedMinutes, expectedMinutes, ratio },
          },
        ],
      });
      flagged += 1;
    }

    return { scanned: dailies.length, flagged };
  }

  /** Chấm vào mà cuối ngày không có chấm ra — dấu hiệu chấm rồi bỏ về. */
  private async scanMissingCheckout() {
    const yesterday = toWorkDate(new Date(Date.now() - 24 * 60 * 60 * 1000), 'UTC');

    const dailies = await this.prisma.attendanceDaily.findMany({
      where: { workDate: yesterday, status: DailyStatus.MISSING_RECORD },
      select: { companyId: true, employeeId: true, workDate: true, firstCheckInAt: true },
    });

    let flagged = 0;

    for (const daily of dailies) {
      const lastLog = await this.prisma.attendanceLog.findFirst({
        where: {
          companyId: daily.companyId,
          employeeId: daily.employeeId,
          workDate: daily.workDate,
          type: AttendanceType.CHECK_IN,
        },
        orderBy: { recordedAt: 'desc' },
        select: { id: true },
      });

      if (lastLog && (await this.alreadyFlagged(lastLog.id, FraudCodes.MISSING_CHECKOUT))) {
        continue;
      }

      await this.fraud.persistFlags({
        companyId: daily.companyId,
        employeeId: daily.employeeId,
        attendanceLogId: lastLog?.id ?? null,
        signals: [
          {
            code: FraudCodes.MISSING_CHECKOUT,
            severity: 'MEDIUM',
            score: 20,
            message: 'Có chấm vào nhưng không có chấm ra trong ngày.',
            details: { firstCheckInAt: daily.firstCheckInAt?.toISOString() },
          },
        ],
      });
      flagged += 1;
    }

    return { scanned: dailies.length, flagged };
  }

  // ---------------------------------------------------------------------------

  private async hasApprovedTrip(companyId: string, employeeId: string, at: Date) {
    const trip = await this.prisma.leaveRequest.findFirst({
      where: {
        companyId,
        employeeId,
        status: RequestStatus.APPROVED,
        startAt: { lte: at },
        endAt: { gte: at },
        requestType: { code: { in: ['BUSINESS_TRIP', 'CONG_TAC'] } },
      },
      select: { id: true },
    });
    return Boolean(trip);
  }

  private async hasApprovedRequestOnDate(companyId: string, employeeId: string, workDate: Date) {
    const dayEnd = new Date(workDate.getTime() + 24 * 60 * 60 * 1000);
    const request = await this.prisma.leaveRequest.findFirst({
      where: {
        companyId,
        employeeId,
        status: RequestStatus.APPROVED,
        startAt: { lt: dayEnd },
        endAt: { gte: workDate },
      },
      select: { id: true },
    });
    return Boolean(request);
  }

  /** Job chạy mỗi 15 phút — không gắn cờ trùng cho cùng một bản ghi. */
  private async alreadyFlagged(attendanceLogId: string, code: string): Promise<boolean> {
    const existing = await this.prisma.fraudFlag.findFirst({
      where: { attendanceLogId, code },
      select: { id: true },
    });
    return Boolean(existing);
  }
}
