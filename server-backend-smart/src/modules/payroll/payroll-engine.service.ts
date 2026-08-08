import { Injectable, Logger } from '@nestjs/common';
import {
  AttendanceDecision,
  AttendanceType,
  DailyStatus,
  Prisma,
  RequestStatus,
} from '@prisma/client';
import {
  combineWorkDateAndTime,
  formatWorkDate,
  isWeekend,
  minutesBetween,
} from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';

export const CALC_ENGINE_VERSION = 'payroll-engine@1.0.0';

interface PunchPair {
  checkIn: Date;
  checkOut: Date | null;
}

export interface DailyCalculationResult {
  employeeId: string;
  workDate: Date;
  shiftId: string | null;
  firstCheckInAt: Date | null;
  lastCheckOutAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otMinutes: number;
  otMultiplier: number | null;
  makeupMinutes: number;
  standardDays: number;
  status: DailyStatus;
  appliedRequestIds: string[];
  hasFraudFlag: boolean;
  breakdown: Record<string, unknown>;
}

/**
 * Engine tính công — docs/04 mục 7.3, docs/02 mục 11.
 *
 * YÊU CẦU BẤT BIẾN:
 *   - IDEMPOTENT (NFR-REL-06): chạy lại nhiều lần cho cùng (employee, date) phải
 *     ra kết quả GIỐNG HỆT. Đơn duyệt muộn và sửa cấu hình ca đều kích hoạt tính lại.
 *   - Đọc `AttendanceLog` (thô, bất biến), ghi `AttendanceDaily` (tính lại được).
 *   - KHÔNG hard-code ngưỡng nào — tất cả qua PolicyService (BR-12).
 *
 * BẪY ĐÃ XỬ LÝ (docs/04 mục 6.4):
 *   ✓ Ca đêm vắt qua nửa đêm      ✓ Ca gãy (nhiều đoạn)
 *   ✓ Ca linh hoạt theo tổng giờ  ✓ Đổi cấu hình ca giữa tháng (hiệu lực thời gian)
 *   ✓ Quên chấm ra                ✓ Nhiều cặp vào/ra trong ngày
 *   ✓ Ngày lễ + nghỉ bù           ✓ Đơn duyệt ngược quá khứ
 *   ✓ Múi giờ (Luxon, không tự cộng trừ giờ)
 */
@Injectable()
export class PayrollEngineService {
  private readonly logger = new Logger(PayrollEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Tính bảng công một ngày cho một nhân viên và GHI vào AttendanceDaily.
   * Upsert theo (employeeId, workDate) — chạy lại là ghi đè, không nhân bản.
   */
  async calculateAndPersist(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<DailyCalculationResult> {
    const result = await this.calculate(companyId, employeeId, workDate);

    await this.prisma.attendanceDaily.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: {
        companyId,
        employeeId,
        workDate,
        shiftId: result.shiftId,
        firstCheckInAt: result.firstCheckInAt,
        lastCheckOutAt: result.lastCheckOutAt,
        workedMinutes: result.workedMinutes,
        breakMinutes: result.breakMinutes,
        lateMinutes: result.lateMinutes,
        earlyLeaveMinutes: result.earlyLeaveMinutes,
        otMinutes: result.otMinutes,
        otMultiplier: result.otMultiplier,
        makeupMinutes: result.makeupMinutes,
        standardDays: result.standardDays,
        status: result.status,
        appliedRequestIds: result.appliedRequestIds,
        hasFraudFlag: result.hasFraudFlag,
        calculatedAt: new Date(),
        calcEngineVersion: CALC_ENGINE_VERSION,
        breakdown: result.breakdown as Prisma.InputJsonValue,
      },
      update: {
        shiftId: result.shiftId,
        firstCheckInAt: result.firstCheckInAt,
        lastCheckOutAt: result.lastCheckOutAt,
        workedMinutes: result.workedMinutes,
        breakMinutes: result.breakMinutes,
        lateMinutes: result.lateMinutes,
        earlyLeaveMinutes: result.earlyLeaveMinutes,
        otMinutes: result.otMinutes,
        otMultiplier: result.otMultiplier,
        makeupMinutes: result.makeupMinutes,
        standardDays: result.standardDays,
        status: result.status,
        appliedRequestIds: result.appliedRequestIds,
        hasFraudFlag: result.hasFraudFlag,
        calculatedAt: new Date(),
        calcEngineVersion: CALC_ENGINE_VERSION,
        breakdown: result.breakdown as Prisma.InputJsonValue,
      },
    });

    return result;
  }

  /** Tính thuần — không chạm DB ghi. Tách riêng để unit test dễ phủ (NFR-MAINT-01). */
  async calculate(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<DailyCalculationResult> {
    const timezone = await this.policy.getTimezone(companyId);

    const [shift, holiday, logs, approvedRequests, fraudFlagCount, makeup] = await Promise.all([
      this.policy.resolveShiftForDate(companyId, employeeId, workDate),
      this.policy.findHoliday(companyId, workDate),
      this.prisma.attendanceLog.findMany({
        where: {
          companyId,
          employeeId,
          workDate,
          // PENDING_REVIEW chưa được duyệt thì KHÔNG tính công.
          decision: { in: [AttendanceDecision.ACCEPTED, AttendanceDecision.FLAGGED] },
          type: { in: [AttendanceType.CHECK_IN, AttendanceType.CHECK_OUT] },
        },
        orderBy: { recordedAt: 'asc' },
        select: { id: true, type: true, recordedAt: true },
      }),
      this.findApprovedRequestsForDate(companyId, employeeId, workDate, timezone),
      this.prisma.fraudFlag.count({
        where: { companyId, employeeId, attendanceLog: { workDate } },
      }),
      this.prisma.makeupWorkRecord.aggregate({
        where: { companyId, employeeId, makeupWorkDate: workDate },
        _sum: { makeupMinutes: true },
      }),
    ]);

    // Bỏ các lượt đã bị VOID bằng bản ghi điều chỉnh (BR-ADJ-01, AF-23).
    const voided = await this.prisma.attendanceAdjustment.findMany({
      where: { companyId, employeeId, workDate, adjustType: 'VOID' },
      select: { attendanceLogId: true },
    });
    const voidedIds = new Set(voided.map((row) => row.attendanceLogId).filter(Boolean));

    // Áp bản ghi MODIFY_TIME lên giờ đã ghi (bản ghi gốc vẫn nguyên vẹn).
    const modifications = await this.prisma.attendanceAdjustment.findMany({
      where: { companyId, employeeId, workDate, adjustType: 'MODIFY_TIME' },
      orderBy: { createdAt: 'asc' },
      select: { attendanceLogId: true, afterValue: true },
    });
    const timeOverrides = new Map<string, Date>();
    for (const modification of modifications) {
      const after = modification.afterValue as { recordedAt?: string } | null;
      if (modification.attendanceLogId && after?.recordedAt) {
        timeOverrides.set(modification.attendanceLogId, new Date(after.recordedAt));
      }
    }

    const effectiveLogs = logs
      .filter((log) => !voidedIds.has(log.id))
      .map((log) => ({ ...log, recordedAt: timeOverrides.get(log.id) ?? log.recordedAt }))
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

    const pairs = this.pairPunches(effectiveLogs);
    const firstCheckInAt = pairs[0]?.checkIn ?? null;
    const lastCheckOutAt = [...pairs].reverse().find((pair) => pair.checkOut)?.checkOut ?? null;

    // --- Thời lượng làm việc thực tế -----------------------------------------
    const rawWorkedMinutes = pairs.reduce(
      (total, pair) => total + (pair.checkOut ? minutesBetween(pair.checkIn, pair.checkOut) : 0),
      0,
    );

    // Trừ nghỉ trưa nếu ca có và nhân viên làm xuyên qua khoảng nghỉ.
    const breakMinutes = shift && rawWorkedMinutes > shift.breakMinutes ? shift.breakMinutes : 0;
    const workedMinutes = Math.max(0, rawWorkedMinutes - breakMinutes);

    // --- Đi muộn / về sớm -----------------------------------------------------
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;

    // Ca linh hoạt KHÔNG tính "đi muộn", chỉ tính đủ/thiếu giờ (FR-WEB-POL-03).
    if (shift && shift.type !== 'FLEXIBLE') {
      if (shift.startTime && firstCheckInAt) {
        const shiftStart = combineWorkDateAndTime(workDate, shift.startTime, timezone);
        lateMinutes = Math.max(
          0,
          minutesBetween(shiftStart, firstCheckInAt) - shift.lateToleranceMinutes,
        );
      }
      if (shift.endTime && lastCheckOutAt) {
        // Ca đêm: giờ kết thúc thuộc NGÀY HÔM SAU.
        const shiftEnd = combineWorkDateAndTime(
          workDate,
          shift.endTime,
          timezone,
          shift.crossesMidnight ? 1 : 0,
        );
        earlyLeaveMinutes = Math.max(
          0,
          minutesBetween(lastCheckOutAt, shiftEnd) - shift.earlyLeaveToleranceMinutes,
        );
      }
    }

    // --- OT --------------------------------------------------------------------
    const otResult = await this.calculateOvertime({
      companyId,
      workDate,
      timezone,
      shift,
      holiday: Boolean(holiday),
      lastCheckOutAt,
      approvedRequests,
    });

    // --- Quy đổi công chuẩn -----------------------------------------------------
    const minutesPerDay = await this.policy.getNumber(
      companyId,
      PolicyKeys.PAYROLL_MINUTES_PER_STANDARD_DAY,
    );
    const roundingMinutes = await this.policy.getNumber(
      companyId,
      PolicyKeys.PAYROLL_ROUNDING_MINUTES,
    );

    const makeupMinutes = makeup._sum.makeupMinutes ?? 0;
    const countedMinutes = this.applyRounding(workedMinutes + makeupMinutes, roundingMinutes);

    // Đơn nghỉ phép có lương tính đủ công cho phần được nghỉ.
    const leaveCredit = this.leaveCreditMinutes(approvedRequests, minutesPerDay);

    const standardDays =
      minutesPerDay > 0
        ? Math.round(((countedMinutes + leaveCredit) / minutesPerDay) * 1000) / 1000
        : 0;

    // --- Trạng thái ngày --------------------------------------------------------
    const status = this.resolveStatus({
      hasLogs: effectiveLogs.length > 0,
      hasOpenPair: pairs.some((pair) => !pair.checkOut),
      lateMinutes,
      earlyLeaveMinutes,
      otMinutes: otResult.otMinutes,
      workedMinutes: countedMinutes,
      requiredMinutes: shift?.requiredMinutes ?? minutesPerDay,
      isHoliday: Boolean(holiday),
      isWeekendDay: isWeekend(workDate),
      hasLeaveRequest: approvedRequests.some((request) => request.deductFrom !== 'NONE'),
      hasShift: Boolean(shift),
    });

    return {
      employeeId,
      workDate,
      shiftId: shift?.id ?? null,
      firstCheckInAt,
      lastCheckOutAt,
      workedMinutes: countedMinutes,
      breakMinutes,
      lateMinutes,
      earlyLeaveMinutes,
      otMinutes: otResult.otMinutes,
      otMultiplier: otResult.multiplier,
      makeupMinutes,
      standardDays,
      status,
      appliedRequestIds: approvedRequests.map((request) => request.id),
      hasFraudFlag: fraudFlagCount > 0,
      // Snapshot để giải trình "con số này ra từ đâu" khi có khiếu nại.
      breakdown: {
        engineVersion: CALC_ENGINE_VERSION,
        timezone,
        workDate: formatWorkDate(workDate),
        shift: shift
          ? {
              id: shift.id,
              name: shift.name,
              type: shift.type,
              startTime: shift.startTime,
              endTime: shift.endTime,
              crossesMidnight: shift.crossesMidnight,
              breakMinutes: shift.breakMinutes,
              lateToleranceMinutes: shift.lateToleranceMinutes,
            }
          : null,
        holiday: holiday ? { name: holiday.name, otMultiplier: holiday.otMultiplier } : null,
        pairs: pairs.map((pair) => ({
          checkIn: pair.checkIn.toISOString(),
          checkOut: pair.checkOut?.toISOString() ?? null,
        })),
        rawWorkedMinutes,
        breakMinutes,
        makeupMinutes,
        leaveCreditMinutes: leaveCredit,
        roundingMinutes,
        minutesPerStandardDay: minutesPerDay,
        overtime: otResult,
        voidedLogIds: [...voidedIds],
        timeOverrides: [...timeOverrides.entries()].map(([id, date]) => ({
          logId: id,
          recordedAt: date.toISOString(),
        })),
      },
    };
  }

  // ===========================================================================
  //  Chi tiết
  // ===========================================================================

  /**
   * Ghép các lượt vào/ra thành cặp.
   *
   * BR-ATT-01: một ngày có thể có NHIỀU cặp (ra ngoài giữa giờ). Cặp thiếu
   * chấm ra để `checkOut = null` → engine không cộng giờ, trạng thái MISSING_RECORD.
   */
  private pairPunches(logs: Array<{ type: AttendanceType; recordedAt: Date }>): PunchPair[] {
    const pairs: PunchPair[] = [];
    let open: Date | null = null;

    for (const log of logs) {
      if (log.type === AttendanceType.CHECK_IN) {
        // Hai lần CHECK_IN liên tiếp: giữ lần đầu, bỏ qua lần sau (đã chặn ở API).
        if (open === null) open = log.recordedAt;
      } else if (log.type === AttendanceType.CHECK_OUT) {
        if (open !== null) {
          pairs.push({ checkIn: open, checkOut: log.recordedAt });
          open = null;
        }
        // BR-ATT-03: chấm ra mà chưa chấm vào → bỏ qua, sẽ bị gắn cờ thiếu bản ghi.
      }
    }

    if (open !== null) {
      pairs.push({ checkIn: open, checkOut: null });
    }
    return pairs;
  }

  /**
   * OT — chỉ tính phần làm NGOÀI ca và CÓ ĐƠN OT ĐÃ DUYỆT TRƯỚC
   * (nếu chính sách `payroll.ot.requiresPreApproval` bật, mặc định bật).
   *
   * Hệ số theo loại ngày, tối thiểu theo NFR-LEGAL-05.
   * Giới hạn giờ theo NFR-LEGAL-06.
   */
  private async calculateOvertime(params: {
    companyId: string;
    workDate: Date;
    timezone: string;
    shift: { endTime: string | null; crossesMidnight: boolean } | null;
    holiday: boolean;
    lastCheckOutAt: Date | null;
    approvedRequests: Array<{ id: string; deductFrom: string; code: string }>;
  }): Promise<{ otMinutes: number; multiplier: number | null; reason: string }> {
    const requiresApproval = await this.policy.getBoolean(
      params.companyId,
      PolicyKeys.PAYROLL_OT_REQUIRES_APPROVAL,
    );

    const hasOtRequest = params.approvedRequests.some(
      (request) => request.deductFrom === 'OT_CREDIT' || request.code === 'OT_REGISTER',
    );

    // Mặc định BẬT `requiresPreApproval`, và đây là mặc định đúng: không có nó
    // thì ai nán lại văn phòng lướt điện thoại thêm 2 tiếng cũng thành OT được
    // trả 150%. OT là chi phí, phải do quản lý duyệt TRƯỚC chứ không phải hệ quả
    // tự động của việc ở lại muộn.
    //
    // Trả `reason` kèm theo để hiển thị cho nhân viên hiểu vì sao giờ ở lại của
    // họ không thành OT — thiếu lời giải thích này là nguồn khiếu nại thường gặp.
    if (requiresApproval && !hasOtRequest) {
      return { otMinutes: 0, multiplier: null, reason: 'Không có đơn OT đã duyệt trước' };
    }

    if (!params.shift?.endTime || !params.lastCheckOutAt) {
      return { otMinutes: 0, multiplier: null, reason: 'Không xác định được giờ kết thúc ca' };
    }

    const shiftEnd = combineWorkDateAndTime(
      params.workDate,
      params.shift.endTime,
      params.timezone,
      params.shift.crossesMidnight ? 1 : 0,
    );
    const rawOtMinutes = Math.max(0, minutesBetween(shiftEnd, params.lastCheckOutAt));
    if (rawOtMinutes === 0) {
      return { otMinutes: 0, multiplier: null, reason: 'Không làm ngoài ca' };
    }

    // NFR-LEGAL-06: trần OT theo ngày.
    const maxPerDay = await this.policy.getNumber(
      params.companyId,
      PolicyKeys.PAYROLL_OT_MAX_MINUTES_PER_DAY,
    );
    const otMinutes = Math.min(rawOtMinutes, maxPerDay);

    const multiplierKey = params.holiday
      ? PolicyKeys.PAYROLL_OT_MULTIPLIER_HOLIDAY
      : isWeekend(params.workDate)
        ? PolicyKeys.PAYROLL_OT_MULTIPLIER_WEEKEND
        : PolicyKeys.PAYROLL_OT_MULTIPLIER_NORMAL;

    const multiplier = await this.policy.getNumber(params.companyId, multiplierKey);

    return {
      otMinutes,
      multiplier,
      reason:
        rawOtMinutes > maxPerDay
          ? `Đã cắt từ ${rawOtMinutes} xuống ${maxPerDay} phút theo trần OT/ngày (NFR-LEGAL-06)`
          : 'OT có đơn duyệt trước',
    };
  }

  /**
   * Đơn từ đã duyệt ảnh hưởng tới ngày này.
   *
   * BR-REQ-03: đơn duyệt cho ngày TRONG QUÁ KHỨ vẫn hợp lệ và kích hoạt tính lại.
   */
  private async findApprovedRequestsForDate(
    companyId: string,
    employeeId: string,
    workDate: Date,
    timezone: string,
  ) {
    const dayStart = combineWorkDateAndTime(workDate, '00:00', timezone);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        companyId,
        employeeId,
        status: RequestStatus.APPROVED,
        startAt: { lt: dayEnd },
        endAt: { gte: dayStart },
      },
      include: { requestType: { select: { code: true, deductFrom: true, unit: true } } },
    });

    return requests.map((request) => ({
      id: request.id,
      code: request.requestType.code,
      deductFrom: request.requestType.deductFrom,
      unit: request.requestType.unit,
      isHalfDay: request.isHalfDay,
      quantity: Number(request.quantity),
    }));
  }

  /**
   * Nghỉ phép có lương được tính công; nghỉ không lương thì không.
   *
   * Phân biệt qua `deductFrom`: `ANNUAL_LEAVE` trừ vào quỹ phép năm nên vẫn được
   * trả lương, còn nghỉ không lương / nghỉ việc riêng thì không cộng phút nào.
   *
   * `find` (lấy đơn ĐẦU TIÊN) chứ không cộng dồn nhiều đơn: một ngày chỉ nghỉ
   * được tối đa một ngày công. Có hai đơn phép cùng ngày thì đó là lỗi dữ liệu
   * đã bị chặn từ chốt chống trùng khoảng thời gian (BR-REQ-02); cộng dồn ở đây
   * sẽ biến lỗi đó thành 2 ngày công được trả cho 1 ngày nghỉ.
   */
  private leaveCreditMinutes(
    requests: Array<{ deductFrom: string; isHalfDay: boolean }>,
    minutesPerDay: number,
  ): number {
    const paidLeave = requests.find((request) => request.deductFrom === 'ANNUAL_LEAVE');
    if (!paidLeave) return 0;
    return paidLeave.isHalfDay ? Math.round(minutesPerDay / 2) : minutesPerDay;
  }

  /**
   * Làm tròn theo bước cấu hình (0 = không làm tròn).
   *
   * Nhiều công ty tính công theo bước 15 hoặc 30 phút cho khớp cách làm thủ công
   * trước đây. Dùng `Math.round` (làm tròn hai chiều) chứ không `Math.floor`:
   * luôn làm tròn xuống là mỗi ngày ăn bớt vài phút của người lao động, cộng dồn
   * cả tháng thành con số thật và là chuyện dễ bị khiếu nại.
   *
   * `step <= 0` trả nguyên giá trị — vừa là "tắt làm tròn", vừa chặn chia cho 0.
   */
  private applyRounding(minutes: number, step: number): number {
    if (step <= 0) return minutes;
    return Math.round(minutes / step) * step;
  }

  /**
   * Quy toàn bộ số liệu của một ngày về MỘT nhãn trạng thái để hiển thị.
   *
   * ⚠ THỨ TỰ CÁC IF LÀ THỨ TỰ ƯU TIÊN, đảo là đổi nghĩa. Ba tầng, từ trên xuống:
   *
   * 1. **Vắng mặt có lý do** (nghỉ phép, lễ, cuối tuần) — xét trước, vì không có
   *    bản ghi chấm công ở những ngày này là ĐÚNG, không phải vi phạm.
   * 2. **Dữ liệu khuyết** (`MISSING_RECORD`) — xét trước mọi nhãn vi phạm. Người
   *    quên chấm ra chưa chắc đã về sớm; gắn `EARLY_LEAVE` cho họ là kết tội dựa
   *    trên dữ liệu thiếu.
   * 3. **Vi phạm và ngoại lệ** — muộn và về sớm gộp thành `LATE_AND_EARLY` để
   *    không mất một trong hai thông tin.
   *
   * `INSUFFICIENT` (thiếu giờ) đứng gần cuối vì nó là kết luận tổng hợp: đúng giờ
   * vào, đúng giờ ra, nhưng tổng giờ vẫn thiếu — thường do ra ngoài giữa ca.
   */
  private resolveStatus(input: {
    hasLogs: boolean;
    hasOpenPair: boolean;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    otMinutes: number;
    workedMinutes: number;
    requiredMinutes: number;
    isHoliday: boolean;
    isWeekendDay: boolean;
    hasLeaveRequest: boolean;
    hasShift: boolean;
  }): DailyStatus {
    if (input.hasLeaveRequest && !input.hasLogs) return DailyStatus.ON_LEAVE;
    if (input.isHoliday && !input.hasLogs) return DailyStatus.HOLIDAY;
    if (!input.hasShift && !input.hasLogs) {
      return input.isWeekendDay ? DailyStatus.WEEKEND : DailyStatus.ABSENT;
    }
    if (!input.hasLogs) return DailyStatus.ABSENT;
    // Chấm vào mà không chấm ra — dấu hiệu quên chấm hoặc bỏ về (AF-19).
    if (input.hasOpenPair) return DailyStatus.MISSING_RECORD;

    if (input.lateMinutes > 0 && input.earlyLeaveMinutes > 0) return DailyStatus.LATE_AND_EARLY;
    if (input.lateMinutes > 0) return DailyStatus.LATE;
    if (input.earlyLeaveMinutes > 0) return DailyStatus.EARLY_LEAVE;
    if (input.otMinutes > 0) return DailyStatus.OVERTIME;
    if (input.workedMinutes < input.requiredMinutes) return DailyStatus.INSUFFICIENT;

    return DailyStatus.ON_TIME;
  }
}
