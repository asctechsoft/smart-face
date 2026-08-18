import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppException } from 'src/common/errors';
import {
  buildMeta,
  combineWorkDateAndTime,
  dayBoundsUtc,
  formatWorkDate,
  parseWorkDate,
  timeToMinutes,
  toWorkDate,
  weekdayMaskOf,
} from 'src/common/utils';
import { isRedisEnabled } from 'src/config/configuration';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import type { TenantContext } from 'src/common/types/request-context';
import { NotificationService } from '../notification/notification.service';
import { PolicyRepository } from '../policy/policy.repository';
import { PolicyService } from '../policy/policy.service';
import { AttendanceRepository } from './attendance.repository';
import {
  AttendanceSheetRepository,
  type AttendanceSheetRequestRow,
} from './attendance-sheet.repository';
import {
  WorkStatusRepository,
  type WorkStatusEmployeeRow,
  type WorkStatusLogRow,
  type WorkStatusShiftRow,
} from './work-status.repository';
import {
  classifyWorkState,
  countWorkStates,
  outsideIntervals,
  END_OF_WORKDAY_MINUTES,
  WORK_STATE_LABELS,
  type LeaveCover,
  type ShiftWindow,
  type WorkMark,
} from './work-status.rules';
import type {
  ExportWorkStatusDto,
  RemindWorkStatusDto,
  WorkStatusQueryDto,
} from './dto/work-status.dto';
import { resolveExportDepartmentFilter } from './attendance-admin.service';

/**
 * Cache RẤT ngắn.
 *
 * Đây là màn hình theo dõi thời gian thực: người dùng để nó mở trên màn hình
 * phụ và làm mới mỗi phút. 20 giây đủ để chặn một cơn bão F5 và để nhiều người
 * cùng phòng dùng chung một kết quả, mà vẫn ngắn hơn nhịp làm mới của client —
 * nên không bao giờ có chuyện màn hình đứng yên ở số liệu cũ.
 */
const WORK_STATUS_CACHE_TTL_SECONDS = 20;

/** Trần một lượt nhắc. Bấm nhầm "chọn tất cả" không được biến thành 5000 push. */
const MAX_REMIND_RECIPIENTS = 200;

/**
 * Trần số CBNV màn hình này phân loại trong một lượt.
 *
 * Không phải giới hạn kỹ thuật mà là giới hạn về Ý NGHĨA: một cái lưới 5000 dòng
 * không ai theo dõi được, và người thật sự cần nó sẽ lọc theo phòng ban trước.
 * Đặt trần tường minh còn hơn để một công ty lớn mở màn hình rồi chờ 30 giây và
 * kết luận hệ thống hỏng — và khi chạm trần thì phải NÓI RA (`scopeTruncated`),
 * chứ cắt im lặng thì con số tổng đọc như thể đã phủ hết mọi người.
 */
const MAX_SCOPE_EMPLOYEES = 2000;

export interface WorkStatusExportParams {
  date: string;
  /** `null` = toàn công ty. Mảng rỗng = không phòng ban nào (fail-closed, có chủ đích). */
  departmentIds: string[] | null;
}

/**
 * Theo dõi công việc trong ngày — lưới CBNV × dòng thời gian.
 *
 * ## Màn này khác bảng chấm công ở đâu
 *
 * Bảng chấm công trả lời câu hỏi của KẾ TOÁN cuối tháng: "ai thiếu công". Nó đọc
 * `AttendanceDaily` — bảng đã tính, mỗi ngày một dòng, chỉ giữ giờ vào đầu tiên
 * và giờ ra cuối cùng.
 *
 * Màn này trả lời câu hỏi của QUẢN LÝ lúc 10 giờ sáng: "bây giờ ai đang ở đâu".
 * Hai câu hỏi khác nhau tới mức không dùng chung được nguồn dữ liệu: "đã chấm
 * vào lúc 08:02" không phân biệt được người đang ngồi làm với người vừa xin ra
 * ngoài — mà đó chính là điều cần biết. Vì vậy ở đây đọc thẳng `AttendanceLog`
 * thô, chấp nhận chi phí, và bù lại bằng phạm vi đúng MỘT ngày.
 *
 * ## Phân loại chạy trên TOÀN phạm vi, hiển thị chỉ một trang
 *
 * Con số ở đầu trang ("còn 12 người chưa đến") là thứ người dùng đọc trước tiên
 * và hành động theo. Tính nó trên 25 người của trang 1 là đưa ra một con số sai
 * theo cách người đọc không có cách nào phát hiện. Vì vậy service phân loại cả
 * phạm vi rồi mới cắt trang — xem `WorkStatusRepository.findEmployeeIds`.
 */
@Injectable()
export class WorkStatusService {
  private readonly logger = new Logger(WorkStatusService.name);

  constructor(
    private readonly workStatus: WorkStatusRepository,
    private readonly sheets: AttendanceSheetRepository,
    private readonly attendances: AttendanceRepository,
    private readonly policies: PolicyRepository,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUES.EXPORT) private readonly exportQueue: Queue,
  ) {}

  // ===========================================================================
  //  Lưới theo dõi
  // ===========================================================================

  async getBoard(companyId: string, query: WorkStatusQueryDto, departmentScope: string[] | null) {
    // `.sort()` là bắt buộc: cùng một tập phòng ban nhưng khác thứ tự phải cho
    // ra cùng một khoá, nếu không cache gần như không bao giờ trúng.
    const scopeKey = departmentScope ? [...departmentScope].sort().join(',') : 'all';
    const cacheKey = RedisKeys.workStatus(
      companyId,
      [
        query.date ?? 'today',
        query.departmentId ?? '-',
        query.q ?? '-',
        query.state ?? '-',
        query.page,
        query.pageSize,
        scopeKey,
      ].join('|'),
    );

    return this.redis.remember(cacheKey, WORK_STATUS_CACHE_TTL_SECONDS, () =>
      this.buildBoard(companyId, query, departmentScope),
    );
  }

  /**
   * Đọc và phân loại CẢ phạm vi cho một ngày.
   *
   * Tách khỏi `buildBoard` vì worker xuất Excel cần đúng tập dữ liệu này, chỉ
   * khác ở chỗ nó không phân trang. Nếu worker tự dựng lại đường đọc riêng thì
   * file Excel và màn hình sẽ là hai câu trả lời khác nhau cho cùng một ngày —
   * mà file Excel là thứ được gửi đi họp.
   */
  private async collect(
    companyId: string,
    date: string | undefined,
    filter: { departmentIds?: string[]; departmentScope: string[] | null; q?: string },
  ) {
    const timezone = await this.policy.getTimezone(companyId);
    const day = await this.resolveDay(companyId, date, timezone);

    // Hồ sơ của CẢ phạm vi, một lượt. Đây là chỗ tốn nhất của màn hình và cũng
    // là chỗ không cắt được: mọi con số tổng đều đứng trên tập này.
    const { items: allEmployees, total: scopeTotal } = await this.workStatus.searchEmployees(
      companyId,
      { ...filter, skip: 0, take: MAX_SCOPE_EMPLOYEES },
    );
    const employeeIds = allEmployees.map((employee) => employee.id);
    const bounds = dayBoundsUtc(day.workDate, timezone);

    const [assignments, dailies, logs, requests, defaultShifts, branchNames, holiday] =
      await Promise.all([
        this.workStatus.findAssignments(companyId, employeeIds, day.workDate),
        this.workStatus.findDailies(companyId, employeeIds, day.workDate),
        this.workStatus.findLogs(companyId, employeeIds, day.workDate),
        this.sheets.findRequestsInRange(companyId, employeeIds, bounds.start, bounds.end),
        this.workStatus.findDefaultShifts(companyId, day.workDate),
        this.workStatus.findBranchNames(companyId),
        this.policy.findHoliday(companyId, day.workDate),
      ]);

    // ---- Gom theo người: tra ô phải là O(1), không quét lại mảng cho mỗi dòng.
    const shiftsByEmployee = new Map<string, WorkStatusShiftRow[]>();
    for (const assignment of assignments) {
      if (!assignment.shift) continue;
      push(shiftsByEmployee, assignment.employeeId, assignment.shift);
    }

    // BR-ATT-04: không được xếp ca thì áp ca mặc định của công ty. Bỏ bước này
    // thì mọi công ty không dùng phân ca sẽ thấy cả màn hình ghi "không có ca",
    // và màn hình mất sạch ý nghĩa với họ.
    const fallbackShift = pickDefaultShift(defaultShifts, day.workDate);

    const marksByEmployee = new Map<string, MarkWithBranch[]>();
    for (const log of logs) {
      push(marksByEmployee, log.employeeId, toMark(log, day.dayStart));
    }

    const coversByEmployee = new Map<string, CoverWithLabel[]>();
    for (const request of requests) {
      push(coversByEmployee, request.employeeId, toCover(request, day.dayStart));
    }

    const dailyByEmployee = new Map(dailies.map((daily) => [daily.employeeId, daily]));

    // ---- Phân loại MỘT LẦN cho cả phạm vi.
    const classified: ClassifiedRow[] = allEmployees.map((employee) => {
      const shifts = shiftsByEmployee.get(employee.id) ?? (fallbackShift ? [fallbackShift] : []);
      const marks = marksByEmployee.get(employee.id) ?? [];
      const covers = coversByEmployee.get(employee.id) ?? [];
      const windows = shifts
        .map(toShiftWindow)
        .filter((window): window is ShiftWindow => window !== null);

      return {
        employee,
        shifts,
        marks,
        covers,
        windows,
        result: classifyWorkState({
          nowMinutes: day.nowMinutes,
          isPastDay: day.isPastDay,
          isHoliday: holiday !== null,
          shiftWindows: windows,
          marks,
          covers,
        }),
      };
    });

    return {
      timezone,
      day,
      holiday,
      classified,
      dailyByEmployee,
      branchNames,
      scopeTotal,
      scopeLoaded: allEmployees.length,
    };
  }

  private async buildBoard(
    companyId: string,
    query: WorkStatusQueryDto,
    departmentScope: string[] | null,
  ) {
    const collected = await this.collect(companyId, query.date, {
      departmentIds: query.departmentId
        ? await this.policies.expandDepartmentIds(companyId, [query.departmentId])
        : undefined,
      departmentScope,
      q: query.q,
    });

    const { day, holiday, classified, dailyByEmployee, branchNames, timezone } = collected;

    // Tổng tính trên TOÀN phạm vi, cố ý bỏ qua `query.state`: bấm vào ô "Chưa
    // đến" để lọc mà chính ô đó tụt về đúng số dòng đang hiện thì người dùng mất
    // luôn mốc so sánh vừa dùng để bấm.
    const summary = countWorkStates(classified.map((row) => row.result.state));

    const matched = query.state
      ? classified.filter((row) => row.result.state === query.state)
      : classified;

    const start = (query.page - 1) * query.pageSize;
    const pageRows = matched.slice(start, start + query.pageSize);

    // Trục thời gian dùng chung cho MỌI dòng của trang. Mỗi dòng một trục riêng
    // thì hai thanh cùng độ dài lại là hai khoảng thời gian khác nhau — so sánh
    // theo chiều dọc, thứ mà một cái lưới sinh ra để làm, trở nên vô nghĩa.
    const window = resolveWindow(pageRows, day);

    return {
      workDate: formatWorkDate(day.workDate),
      timezone,
      isToday: day.isToday,
      isPastDay: day.isPastDay,
      /** Phút hiện tại tính từ 00:00 ngày làm việc — client vẽ vạch "bây giờ" từ đây. */
      nowMinutes: day.nowMinutes,
      holiday: holiday ? { id: holiday.id, name: holiday.name } : null,
      window,
      summary,
      /** Số CBNV mà phần tổng đã phủ — luôn là cả phạm vi, không phải một trang. */
      summaryScope: collected.scopeLoaded,
      /** Phạm vi vượt trần và đã bị cắt. Giao diện PHẢI nói ra điều này. */
      scopeTruncated: collected.scopeTotal > collected.scopeLoaded,
      scopeTotal: collected.scopeTotal,
      rows: pageRows.map((row) =>
        this.toRow(row, dailyByEmployee.get(row.employee.id), branchNames),
      ),
      meta: buildMeta(query.page, query.pageSize, matched.length),
    };
  }

  /**
   * Một dòng của lưới: hồ sơ + trạng thái + đủ thứ để VẼ, không phải để tính lại.
   *
   * Mọi con số đã ở dạng PHÚT của ngày làm việc. Client không được nhận instant
   * rồi tự quy đổi: quy đổi đúng cần timezone công ty, và mỗi chỗ quên kéo theo
   * nó là một lỗi lệch múi giờ chỉ lộ ra ở máy người dùng đặt sai giờ.
   */
  private toRow(
    row: ClassifiedRow,
    daily:
      | {
          workedMinutes: number;
          lateMinutes: number;
          earlyLeaveMinutes: number;
          otMinutes: number;
          hasFraudFlag: boolean;
          status: string;
        }
      | undefined,
    branchNames: Map<string, string>,
  ) {
    const { employee, result, shifts, marks, covers, windows } = row;

    const outside =
      result.firstCheckInMinutes === null
        ? []
        : outsideIntervals(
            marks,
            result.firstCheckInMinutes,
            result.lastCheckOutMinutes ?? undefined,
          );

    return {
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        employeeCode: employee.employeeCode,
        department: employee.department,
      },
      state: result.state,
      stateLabel: WORK_STATE_LABELS[result.state],
      firstCheckInMinutes: result.firstCheckInMinutes,
      lastCheckOutMinutes: result.lastCheckOutMinutes,
      outsideSinceMinutes: result.outsideSinceMinutes,
      expectedStartMinutes: result.expectedStartMinutes,
      expectedEndMinutes: result.expectedEndMinutes,
      hasPendingRequest: result.hasPendingRequest,
      activeCoverIds: result.activeCoverIds,

      shifts: shifts.map((shift) => ({
        id: shift.id,
        code: shift.code,
        name: shift.name,
        symbol: shift.symbol,
        startTime: shift.startTime,
        endTime: shift.endTime,
      })),
      shiftWindows: windows,
      breakWindows: shifts
        .map(toBreakWindow)
        .filter((value): value is { fromMinutes: number; toMinutes: number } => value !== null),
      outsideIntervals: outside,

      marks: marks.map((mark) => ({
        logId: mark.logId,
        type: mark.type,
        atMinutes: mark.atMinutes,
        authMethod: mark.authMethod,
        branchName: mark.branchId ? (branchNames.get(mark.branchId) ?? null) : null,
      })),

      requests: covers.map((cover) => ({
        id: cover.requestId,
        code: cover.code,
        status: cover.status,
        fromMinutes: cover.fromMinutes,
        toMinutes: cover.toMinutes,
        wholeDay: cover.wholeDay,
        typeName: cover.typeName,
        reason: cover.reason,
      })),

      // Số liệu công ĐÃ TÍNH. Không tính lại ở đây: `AttendanceDaily` là kết quả
      // của máy tính công với đầy đủ luật làm tròn, dung sai, nghỉ giữa ca — dựng
      // một phép tính thứ hai từ lượt quẹt thô sẽ ra con số khác, và người dùng
      // sẽ thấy hai màn hình nói hai điều về cùng một ngày.
      workedMinutes: daily?.workedMinutes ?? 0,
      lateMinutes: daily?.lateMinutes ?? 0,
      earlyLeaveMinutes: daily?.earlyLeaveMinutes ?? 0,
      otMinutes: daily?.otMinutes ?? 0,
      hasFraudFlag: daily?.hasFraudFlag ?? false,
      dailyStatus: daily?.status ?? null,
    };
  }

  // ===========================================================================
  //  Nhắc CBNV chưa chấm công
  // ===========================================================================

  /**
   * FR-WEB-NOT-01 áp cho một danh sách người cụ thể.
   *
   * Không tự suy danh sách từ trạng thái: xem chú thích ở `RemindWorkStatusDto`.
   * Ở đây chỉ kiểm tra lại QUYỀN — người gửi phải được phép chạm tới từng người
   * trong danh sách, vì `employeeIds` đến thẳng từ client.
   */
  async remind(ctx: TenantContext, dto: RemindWorkStatusDto, departmentScope: string[] | null) {
    if (dto.employeeIds.length > MAX_REMIND_RECIPIENTS) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: `Mỗi lượt nhắc tối đa ${MAX_REMIND_RECIPIENTS} người.`,
      });
    }

    const timezone = await this.policy.getTimezone(ctx.companyId);
    const day = await this.resolveDay(ctx.companyId, dto.date, timezone);

    // Lọc lại theo phạm vi phòng ban. `ScopeGuard` chặn được đường vào, nhưng nó
    // không biết gì về danh sách id nằm trong body — lớp này mới là lớp chặn.
    const allowed = await this.sheets.filterEmployeeIds(ctx.companyId, dto.employeeIds, {
      departmentScope,
    });

    const body =
      dto.message ??
      `Bạn chưa có lượt chấm công nào cho ngày ${formatWorkDate(day.workDate)}. Vui lòng chấm công hoặc gửi đơn nếu hôm nay bạn không đi làm.`;

    // Tuần tự chứ không `Promise.all`: mỗi lượt là một lần ghi database cộng một
    // job đẩy vào hàng đợi, và 200 lượt song song sẽ vét sạch connection pool
    // ngay giữa giờ làm — đúng lúc mọi người khác đang chấm công.
    let sent = 0;
    for (const employeeId of allowed) {
      try {
        await this.notifications.notify({
          companyId: ctx.companyId,
          employeeId,
          type: 'ATTENDANCE_REMINDER',
          title: 'Nhắc chấm công',
          body,
          data: { workDate: formatWorkDate(day.workDate) },
          createdBy: ctx.userId,
        });
        sent += 1;
      } catch (error) {
        this.logger.warn(
          `Không gửi được nhắc chấm công cho ${employeeId}: ${(error as Error).message}`,
        );
      }
    }

    return {
      sent,
      /** Người bị bỏ qua vì nằm ngoài phạm vi phòng ban của người gửi. */
      skipped: dto.employeeIds.length - allowed.length,
      workDate: formatWorkDate(day.workDate),
    };
  }

  // ===========================================================================
  //  Xuất Excel
  // ===========================================================================

  async requestExport(
    ctx: TenantContext,
    dto: ExportWorkStatusDto,
    departmentScope: string[] | null,
  ) {
    const timezone = await this.policy.getTimezone(ctx.companyId);
    const day = await this.resolveDay(ctx.companyId, dto.date, timezone);

    const params: WorkStatusExportParams = {
      date: formatWorkDate(day.workDate),
      // Phạm vi được chốt TẠI ĐÂY và ghi vào params: worker chạy ở tiến trình
      // khác, không có JWT, nên không còn cách nào tự suy lại quyền của người
      // đã bấm nút.
      departmentIds: resolveExportDepartmentFilter(dto.departmentIds, departmentScope),
    };

    const job = await this.attendances.createExportJob(ctx.companyId, {
      createdBy: ctx.userId,
      kind: 'WORK_STATUS',
      params: params as unknown as Prisma.InputJsonValue,
    });

    // Queue giả (`REDIS_ENABLED=false`) nuốt job và vẫn resolve, nên `.catch`
    // bên dưới không bắt được gì. Không đánh hỏng ngay ở đây thì job nằm im ở
    // `QUEUED` và client hỏi tiến độ đến hết phiên làm việc.
    if (!isRedisEnabled()) {
      await this.attendances.markExportJobFailed(
        ctx.companyId,
        job.id,
        'Máy chủ đang chạy không có dịch vụ nền (REDIS_ENABLED=false) nên không dựng được file Excel.',
      );
      return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}`, queued: false };
    }

    await this.exportQueue
      .add(JOBS.EXPORT_WORK_STATUS, { exportJobId: job.id })
      .catch(async (error: Error) => {
        this.logger.error(`Không đẩy được job export theo dõi: ${error.message}`);
        await this.attendances.markExportJobFailed(ctx.companyId, job.id, error.message);
      });

    return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}`, queued: true };
  }

  /**
   * Dòng phẳng cho worker dựng Excel — cùng đường đọc với lưới trên màn hình.
   *
   * `departmentIds` ở đây đã được áp quyền lúc NHẬN yêu cầu (`requestExport`) và
   * ghi vào params của job. Worker chạy ở tiến trình khác, không có JWT, nên
   * `departmentScope` bắt buộc là `null` — mọi giới hạn phải đã nằm sẵn trong
   * `params.departmentIds`, kể cả khi nó là mảng rỗng.
   */
  async exportRows(companyId: string, params: WorkStatusExportParams) {
    const { day, classified, dailyByEmployee, timezone } = await this.collect(
      companyId,
      params.date,
      { departmentIds: params.departmentIds ?? undefined, departmentScope: null },
    );

    return {
      workDate: formatWorkDate(day.workDate),
      timezone,
      rows: classified.map((row) => {
        const daily = dailyByEmployee.get(row.employee.id);
        return {
          employeeCode: row.employee.employeeCode,
          fullName: row.employee.fullName,
          department: row.employee.department?.name ?? '',
          shift: row.shifts.map((shift) => shift.code).join(', '),
          shiftTime: row.shifts
            .map((shift) => `${shift.startTime ?? '?'}–${shift.endTime ?? '?'}`)
            .join(', '),
          state: WORK_STATE_LABELS[row.result.state],
          checkIn: formatDayMinutes(row.result.firstCheckInMinutes),
          checkOut: formatDayMinutes(row.result.lastCheckOutMinutes),
          workedMinutes: daily?.workedMinutes ?? 0,
          lateMinutes: daily?.lateMinutes ?? 0,
          earlyLeaveMinutes: daily?.earlyLeaveMinutes ?? 0,
          otMinutes: daily?.otMinutes ?? 0,
          requests: row.covers
            .map((cover) => `${cover.typeName}${cover.status === 'PENDING' ? ' (chờ duyệt)' : ''}`)
            .join('; '),
          hasFraudFlag: daily?.hasFraudFlag ? 'Có' : '',
        };
      }),
    };
  }

  // ===========================================================================
  //  Ngày đang xem
  // ===========================================================================

  /**
   * Chốt mọi thứ liên quan tới "ngày nào, bây giờ là mấy giờ".
   *
   * Lấy "hôm nay" theo múi giờ CÔNG TY, không theo giờ máy chủ: server đặt ở UTC
   * thì lúc 8 giờ sáng Việt Nam vẫn còn là ngày hôm trước theo UTC — cả màn hình
   * sẽ hiện tình hình của ngày hôm qua suốt buổi sáng.
   */
  private async resolveDay(companyId: string, date: string | undefined, timezone: string) {
    const today = toWorkDate(new Date(), timezone);
    const workDate = date ? parseWorkDate(date) : today;

    const dayStart = combineWorkDateAndTime(workDate, '00:00', timezone);
    const isToday = workDate.getTime() === today.getTime();
    const isPastDay = workDate.getTime() < today.getTime();

    // Ngày đã qua: mọi mốc giờ đều đã trôi qua, và chính điều đó biến "chưa đến"
    // thành "vắng". Ngày trong tương lai: chưa mốc nào tới, nên ai cũng "chưa
    // đến" — đúng, vì đó là một bảng phân công chứ chưa phải một bản ghi.
    const nowMinutes = isToday
      ? Math.floor((Date.now() - dayStart.getTime()) / 60_000)
      : isPastDay
        ? END_OF_WORKDAY_MINUTES
        : 0;

    return { workDate, dayStart, isToday, isPastDay, nowMinutes };
  }
}

// =============================================================================
//  Quy đổi sang phút của ngày làm việc
// =============================================================================

type MarkWithBranch = WorkMark & { branchId: string | null };
type CoverWithLabel = LeaveCover & { typeName: string; reason: string };

interface ClassifiedRow {
  employee: WorkStatusEmployeeRow;
  shifts: WorkStatusShiftRow[];
  marks: MarkWithBranch[];
  covers: CoverWithLabel[];
  windows: ShiftWindow[];
  result: ReturnType<typeof classifyWorkState>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function minutesSince(instant: Date, dayStart: Date): number {
  return Math.round((instant.getTime() - dayStart.getTime()) / 60_000);
}

function toMark(log: WorkStatusLogRow, dayStart: Date): WorkMark & { branchId: string | null } {
  return {
    logId: log.id,
    type: log.type,
    atMinutes: minutesSince(log.recordedAt, dayStart),
    authMethod: log.authMethod,
    branchId: log.branchId,
  };
}

/**
 * Đơn từ → khoảng phủ trên trục thời gian của ngày.
 *
 * Đơn theo NGÀY được đánh dấu `wholeDay` thay vì quy về `[0, 1440]`: quy về
 * khoảng giờ rồi so với "bây giờ" sẽ cho ra kết luận "hết giờ nghỉ" vào lúc nửa
 * đêm, tức là sai hẳn ý nghĩa của một ngày phép.
 *
 * Đơn nhiều ngày bị CẮT về đúng ngày đang xem: một đơn nghỉ 28/07–02/08 phủ lên
 * ngày 30/07 từ đầu tới cuối ngày, không phải "từ -2880 phút".
 */
function toCover(
  request: AttendanceSheetRequestRow,
  dayStart: Date,
): LeaveCover & { typeName: string; reason: string } {
  const wholeDay = request.requestType.unit === 'DAY';
  const rawFrom = minutesSince(request.startAt, dayStart);
  const rawTo = minutesSince(request.endAt, dayStart);

  return {
    requestId: request.id,
    code: request.requestType.code,
    status: request.status,
    fromMinutes: clamp(rawFrom, 0, END_OF_WORKDAY_MINUTES),
    toMinutes: clamp(rawTo, 0, END_OF_WORKDAY_MINUTES),
    wholeDay,
    typeName: request.requestType.name,
    reason: request.reason,
  };
}

/**
 * Ca → khung giờ trên trục.
 *
 * `null` cho ca không khai giờ (ca linh hoạt): không có mốc vào ca thì không có
 * khái niệm "đi muộn", và vẽ một thanh kế hoạch cho nó là bịa ra một cam kết mà
 * cấu hình ca cố ý không đặt ra.
 *
 * Ca vắt qua nửa đêm cộng 1440 vào giờ kết thúc. Nhận diện bằng CẢ cờ
 * `crossesMidnight` lẫn phép so sánh `end < start`: cờ có thể bị khai sót, còn
 * phép so sánh thì không nói được gì về ca 22:00 → 22:00 (trực 24 tiếng).
 */
function toShiftWindow(shift: WorkStatusShiftRow): ShiftWindow | null {
  if (!shift.startTime) return null;

  const startMinutes = timeToMinutes(shift.startTime);
  const rawEnd = shift.endTime ? timeToMinutes(shift.endTime) : startMinutes;
  const endMinutes = shift.crossesMidnight || rawEnd <= startMinutes ? rawEnd + 24 * 60 : rawEnd;

  return {
    shiftId: shift.id,
    startMinutes,
    endMinutes,
    lateToleranceMinutes: shift.lateToleranceMinutes,
  };
}

function toBreakWindow(
  shift: WorkStatusShiftRow,
): { fromMinutes: number; toMinutes: number } | null {
  if (!shift.breakStart || !shift.breakEnd) return null;
  const fromMinutes = timeToMinutes(shift.breakStart);
  const rawTo = timeToMinutes(shift.breakEnd);
  return { fromMinutes, toMinutes: rawTo <= fromMinutes ? rawTo + 24 * 60 : rawTo };
}

/**
 * Ca mặc định áp cho ngày này — BR-ATT-04.
 *
 * Cùng luật với `PolicyService.resolveShiftForDate`, chỉ khác ở chỗ chạy theo LÔ:
 * ở đó là một truy vấn cho một người, còn ở đây là một danh mục dùng chung cho
 * cả trăm người của cùng một ngày.
 */
function pickDefaultShift<T extends { weekdayMask: number }>(
  defaults: T[],
  workDate: Date,
): T | null {
  const mask = weekdayMaskOf(workDate);
  return (
    defaults.find((shift) => shift.weekdayMask === 0 || (shift.weekdayMask & mask) !== 0) ?? null
  );
}

/**
 * Khoảng giờ mà trục thời gian phải phủ.
 *
 * Suy từ DỮ LIỆU của trang chứ không cố định 06:00–22:00: công ty làm ca đêm sẽ
 * thấy mọi thanh của mình bị cắt cụt ở hai đầu, còn công ty hành chính thuần thì
 * mất một phần ba chiều rộng cho khoảng giờ không bao giờ có gì xảy ra.
 *
 * Nới ra mốc giờ tròn hai đầu để các vạch chia trên trục là giờ chẵn — một trục
 * bắt đầu từ 07:58 thì mọi nhãn trên nó đều là số lẻ và không đọc được.
 */
function resolveWindow(
  rows: ClassifiedRow[],
  day: { nowMinutes: number; isToday: boolean },
): { fromMinutes: number; toMinutes: number } {
  const points: number[] = [];

  for (const row of rows) {
    for (const window of row.windows) points.push(window.startMinutes, window.endMinutes);
    for (const mark of row.marks) points.push(mark.atMinutes);
  }
  if (day.isToday) points.push(day.nowMinutes);

  // Trang rỗng, hoặc cả trang không ai có ca lẫn lượt chấm: vẫn phải trả về một
  // trục hợp lệ, nếu không client chia cho 0 khi tính bề rộng mỗi phút.
  if (points.length === 0) return { fromMinutes: 7 * 60, toMinutes: 19 * 60 };

  const from = Math.floor((Math.min(...points) - 30) / 60) * 60;
  const to = Math.ceil((Math.max(...points) + 30) / 60) * 60;

  return {
    fromMinutes: Math.max(0, from),
    // Ít nhất 4 tiếng: một trục hẹp hơn thế thì mọi thanh dài bằng cả trục và
    // không còn phân biệt được ai làm nhiều hơn ai.
    toMinutes: Math.min(END_OF_WORKDAY_MINUTES, Math.max(to, Math.max(0, from) + 4 * 60)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Phút của ngày làm việc → "HH:mm" để in ra Excel.
 *
 * Phút ≥ 1440 (ca đêm tan sau nửa đêm) in thành "25:40" chứ KHÔNG quay về
 * "01:40": trong một file bảng công, "01:40" đứng cạnh giờ vào "22:00" đọc như
 * người đó về trước khi đến.
 */
function formatDayMinutes(minutes: number | null): string {
  if (minutes === null) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
