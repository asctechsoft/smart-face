import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PaginatedResult } from 'src/common/dto/api-response.dto';
import { AppException } from 'src/common/errors';
import {
  buildMeta,
  dayBoundsUtc,
  formatWorkDate,
  parseWorkDate,
  toWorkDate,
} from 'src/common/utils';
import { isRedisEnabled } from 'src/config/configuration';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import type { TenantContext } from 'src/common/types/request-context';
import { PayrollService } from '../payroll/payroll.service';
import { PolicyRepository } from '../policy/policy.repository';
import { PolicyService } from '../policy/policy.service';
import {
  AttendanceSheetRepository,
  type AttendanceSheetRequestRow,
  type AttendanceSheetRow,
} from './attendance-sheet.repository';
import type {
  AttendanceSheetBoardQueryDto,
  AttendanceSheetMemberDto,
  AttendanceSheetQueryDto,
  CreateAttendanceSheetDto,
} from './dto/attendance-sheet.dto';

/** Trần khoảng ngày của lưới — một bảng chỉ kéo dài một tháng, 31 ngày là đủ. */
const MAX_BOARD_DAYS = 31;

/**
 * Bảng chấm công — FR-WEB-ATT-08.
 *
 * ## Vì sao có tầng này
 *
 * Trước đây màn chấm công là một danh sách phẳng theo ngày: mỗi dòng một
 * (nhân viên, ngày). Nó trả lời được "ngày 12/08 ai đi muộn" nhưng không trả lời
 * được câu hỏi thật sự của kế toán cuối tháng — "phòng Kho tháng 8 công thế nào,
 * còn ai thiếu gì không". Muốn biết điều đó phải đọc 30 trang danh sách rồi tự
 * cộng lại trong đầu.
 *
 * Bảng chấm công đảo trục: mỗi dòng một NGƯỜI, mỗi cột một NGÀY, đúng hình dạng
 * bảng công giấy mà mọi công ty đang dùng — và đúng hình dạng của bảng phân ca,
 * nên hai màn hình đọc được bằng cùng một phản xạ.
 *
 * ## Bảng này không sở hữu số liệu nào
 *
 * Công vẫn ở `AttendanceDaily`, lịch ca vẫn ở `ShiftAssignment`, đơn từ vẫn ở
 * `LeaveRequest`. Bảng chỉ khai báo phạm vi (kỳ nào, phòng ban nào, ai) rồi đọc
 * ba nguồn đó. Chép số liệu xuống bảng là tạo bản sao thứ hai lệch khỏi bản gốc
 * ngay lần tính lại công tiếp theo — mà tính lại là chuyện xảy ra hằng ngày
 * (BR-ADJ-04).
 */
@Injectable()
export class AttendanceSheetService {
  private readonly logger = new Logger(AttendanceSheetService.name);

  constructor(
    private readonly sheets: AttendanceSheetRepository,
    private readonly policies: PolicyRepository,
    private readonly policy: PolicyService,
    private readonly payroll: PayrollService,
    private readonly transactions: TransactionManager,
    @InjectQueue(QUEUES.PAYROLL) private readonly payrollQueue: Queue,
  ) {}

  // ===========================================================================
  //  Danh sách & chi tiết
  // ===========================================================================

  async list(
    companyId: string,
    query: AttendanceSheetQueryDto,
    departmentScope: string[] | null,
  ): Promise<PaginatedResult<ReturnType<typeof toSheetDto>>> {
    const { items, total } = await this.sheets.listSheets(companyId, {
      month: query.month ? startOfMonth(parseWorkDate(query.month)) : undefined,
      // Cả hai chiều: lọc theo một tổ phải thấy bảng lập cho khối chứa tổ đó,
      // lọc theo khối phải thấy bảng lập riêng cho từng tổ bên dưới.
      departmentIds: query.departmentId
        ? await this.policies.relatedDepartmentIds(companyId, [query.departmentId])
        : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    // MANAGER chỉ thấy bảng có chạm tới phòng ban họ quản lý. Lọc sau khi phân
    // trang chấp nhận được ở đây: số bảng mỗi tháng đếm trên đầu ngón tay.
    const visible = departmentScope
      ? items.filter((row) => row.departmentIds.some((id) => departmentScope.includes(id)))
      : items;

    // PHẢI là instance `PaginatedResult`: `TransformInterceptor` nhận diện bằng
    // `instanceof` rồi mới tách `items` ra `data` và `meta` ra gốc.
    return new PaginatedResult(
      visible.map(toSheetDto),
      buildMeta(query.page, query.pageSize, total),
    );
  }

  async get(companyId: string, sheetId: string) {
    return toSheetDto(await this.requireSheet(companyId, sheetId));
  }

  // ===========================================================================
  //  Lập bảng
  // ===========================================================================

  /**
   * Lập bảng chấm công cho một tháng và một nhóm phòng ban.
   *
   * Thành viên lấy theo thứ tự ưu tiên:
   *
   *  1. **Bảng phân ca của cùng tháng** chạm tới các phòng ban đã chọn. Đây là
   *     nguồn đúng nhất: ai đã được xếp lịch ca trong tháng thì chắc chắn phát
   *     sinh công trong tháng, kể cả khi giữa tháng họ chuyển sang phòng khác.
   *  2. **CBNV đang làm việc của các phòng ban** — dùng khi tháng đó chưa lập
   *     bảng phân ca nào. Không có lịch ca riêng thì công vẫn được tính theo ca
   *     mặc định của công ty, nên bỏ trắng những người này là bỏ sót công thật.
   *
   * Cả hai nguồn đều bị giao lại với phạm vi phòng ban đã chọn (kèm cấp dưới) và
   * với phạm vi quyền của người lập — một bảng phân ca lập cho cả khối không
   * được kéo người phòng khác vào bảng chấm công của riêng một tổ.
   */
  async create(
    companyId: string,
    dto: CreateAttendanceSheetDto,
    createdBy: string,
    departmentScope: string[] | null,
  ) {
    const periodMonth = startOfMonth(parseWorkDate(dto.periodMonth));
    const scopedDepartmentIds = await this.policies.expandDepartmentIds(
      companyId,
      dto.departmentIds,
    );

    const schedules = await this.sheets.findShiftSchedulesForPeriod(
      companyId,
      periodMonth,
      scopedDepartmentIds,
    );

    // Thành viên của các bảng phân ca đó, LỌC LẠI theo phòng ban đang chọn và
    // theo quyền của người lập. Một bảng phân ca lập cho cả khối Vận hành mà
    // được dùng nguyên xi sẽ kéo cả phòng Kho vào bảng chấm công của phòng Giao.
    const fromSchedules = await this.sheets.filterEmployeeIds(
      companyId,
      await this.sheets.findScheduleMemberIds(schedules.map((schedule) => schedule.id)),
      { departmentIds: scopedDepartmentIds, departmentScope },
    );

    const employeeIds = fromSchedules.length
      ? fromSchedules
      : await this.policies.findAssignableEmployeeIdsInDepartments(
          companyId,
          scopedDepartmentIds,
          departmentScope,
        );

    if (employeeIds.length === 0) {
      throw new AppException('ATT_SHEET_NO_MEMBERS', {
        departments: await this.policies.findDepartmentNames(companyId, dto.departmentIds),
      });
    }

    await this.assertMembersFree(periodMonth, employeeIds, undefined);

    const sheetId = await this.transactions.run(async (tx) => {
      const created = await this.sheets.createSheet(
        companyId,
        {
          name: dto.name?.trim() || defaultSheetName(periodMonth),
          periodMonth,
          departmentIds: dto.departmentIds,
          // Chỉ ghi nhận bảng phân ca khi nó THẬT SỰ cấp người cho bảng này.
          // Ghi cả khi rơi về nguồn phòng ban là nói dối về xuất xứ dữ liệu.
          shiftScheduleIds: fromSchedules.length ? schedules.map((schedule) => schedule.id) : [],
          createdBy,
        },
        tx,
      );
      await this.sheets.addMembers(created.id, periodMonth, employeeIds, tx);
      return created.id;
    });

    return toSheetDto(await this.requireSheet(companyId, sheetId));
  }

  /**
   * Xoá bảng chấm công.
   *
   * Chỉ xoá KHUNG: không đụng tới `AttendanceDaily`, `AttendanceLog` hay đơn từ.
   * Công của tháng đó vẫn còn nguyên và lập lại bảng là thấy lại đúng số liệu —
   * khác hẳn xoá bảng phân ca, vốn xoá luôn lịch ca do nó xếp.
   */
  async remove(companyId: string, sheetId: string) {
    await this.requireSheet(companyId, sheetId);

    return this.transactions.run(async (tx) => {
      const removedMembers = await this.sheets.deleteMembers(sheetId, undefined, tx);
      await this.sheets.softDeleteSheet(companyId, sheetId, tx);
      return { deleted: true, removedMembers };
    });
  }

  // ===========================================================================
  //  Thành viên
  // ===========================================================================

  async addMembers(
    companyId: string,
    sheetId: string,
    dto: AttendanceSheetMemberDto,
    departmentScope: string[] | null,
  ) {
    const sheet = await this.requireOpenSheet(companyId, sheetId);

    const validIds = await this.sheets.filterEmployeeIds(companyId, dto.employeeIds, {
      departmentScope,
    });

    await this.assertMembersFree(sheet.periodMonth, validIds, sheetId);
    const added = await this.sheets.addMembers(sheetId, sheet.periodMonth, validIds);
    return { added, skipped: dto.employeeIds.length - validIds.length };
  }

  async removeMembers(companyId: string, sheetId: string, dto: AttendanceSheetMemberDto) {
    await this.requireOpenSheet(companyId, sheetId);
    const removed = await this.sheets.deleteMembers(sheetId, dto.employeeIds);
    return { removed };
  }

  // ===========================================================================
  //  Chốt / mở lại
  // ===========================================================================

  /**
   * Chốt bảng — tuyên bố "đã rà xong, số này dùng để tính lương".
   *
   * Không khoá dữ liệu công ở tầng database (kỳ lương mới làm việc đó, BR-07);
   * nó khoá việc sửa CHÍNH BẢNG: thêm bớt người sau khi đã bàn giao số liệu là
   * cách chắc chắn nhất để bảng lương và bảng công lệch nhau mà không ai biết.
   */
  async close(companyId: string, sheetId: string, userId: string) {
    const sheet = await this.requireSheet(companyId, sheetId);
    if (sheet.status === 'CLOSED') return toSheetDto(sheet);

    await this.sheets.updateSheetStatus(companyId, sheetId, {
      status: 'CLOSED',
      closedAt: new Date(),
      closedBy: userId,
    });
    return toSheetDto(await this.requireSheet(companyId, sheetId));
  }

  async reopen(companyId: string, sheetId: string) {
    const sheet = await this.requireSheet(companyId, sheetId);

    // BR-07: kỳ lương đã chốt thì số liệu đã ra tiền. Mở lại bảng lúc này chỉ
    // tạo ra một phiên bản thứ hai của một tháng đã trả lương xong.
    const closedPeriod = await this.sheets.findClosedPeriodOverlapping(
      companyId,
      sheet.periodMonth,
      endOfMonth(sheet.periodMonth),
    );
    if (closedPeriod) {
      throw new AppException('PAY_PERIOD_CLOSED', { period: closedPeriod.name });
    }

    await this.sheets.updateSheetStatus(companyId, sheetId, {
      status: 'DRAFT',
      closedAt: null,
      closedBy: null,
    });
    return toSheetDto(await this.requireSheet(companyId, sheetId));
  }

  // ===========================================================================
  //  Cập nhật bảng công
  // ===========================================================================

  /**
   * Tính lại công cho ĐÚNG thành viên và ĐÚNG kỳ của bảng — `FR-WEB-ATT-10`.
   *
   * ## Vì sao cần nút này
   *
   * `AttendanceDaily` là bảng ĐÃ TÍNH (ADR-08). Nó chỉ đổi khi có gì đó kích
   * hoạt tính lại: một lượt chấm công mới, một hiệu chỉnh (BR-ADJ-04), hoặc job
   * chạy đêm. Ba việc KHÔNG tự kích hoạt nó:
   *
   *  - Đơn từ duyệt ngược cho ngày đã qua (BR-REQ-03).
   *  - Sửa cấu hình ca, hệ số ngày, hay loại đơn có tính công hay không.
   *  - Xếp lại ca trong bảng phân ca của tháng.
   *
   * Cả ba đều là chuyện thường xảy ra ngay trước lúc chốt công, và nếu không có
   * cách chạy lại theo yêu cầu thì người rà công nhìn thấy số cũ mà không có
   * cách nào biết nó cũ.
   *
   * ## Vì sao trả `202` chứ không đợi
   *
   * Một bảng 50 người × 31 ngày là 1550 lượt tính, mỗi lượt vài truy vấn. Giữ
   * kết nối HTTP suốt thời gian đó sẽ chạm timeout của proxy trước khi xong.
   * Client nhận `jobId` rồi hỏi tiến độ qua `GET /v1/jobs/:id`.
   *
   * ## Không có Redis vẫn chạy được
   *
   * Chạy nội tuyến, tách khỏi request, nhưng VẪN ghi tiến độ vào bản ghi job —
   * giống hệt `PayrollService.recalculatePeriod`. Nếu để nhánh này ném lỗi như
   * xuất Excel thì nút bấm vô dụng ở mọi môi trường chưa bật dịch vụ nền.
   *
   * BR-07 do `runRecalculateRange` lo: ngày thuộc kỳ lương đã chốt bị BỎ QUA,
   * không ghi đè, và số ngày bị bỏ qua được đếm trả về.
   */
  async recalculate(ctx: TenantContext, sheetId: string) {
    const sheet = await this.requireSheet(ctx.companyId, sheetId);
    const memberIds = await this.sheets.findMemberIds(sheetId);

    const from = sheet.periodMonth;
    const to = endOfMonth(sheet.periodMonth);

    const job = await this.sheets.createRecalculateJob(ctx.companyId, {
      createdBy: ctx.userId,
      params: {
        sheetId,
        from: formatWorkDate(from),
        to: formatWorkDate(to),
        employeeCount: memberIds.length,
      },
    });

    // Bảng rỗng: không có gì để tính, nhưng vẫn phải trả về một job đã kết thúc
    // chứ không phải lỗi — client đang chờ một `jobId` để hỏi tiến độ, và một
    // job mãi mãi `QUEUED` là kiểu hỏng khó chịu nhất.
    if (memberIds.length === 0) {
      await this.sheets.markRecalculateJobDone(job.id);
      return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}`, employeeCount: 0 };
    }

    if (isRedisEnabled()) {
      await this.payrollQueue.add(JOBS.RECALCULATE_RANGE, {
        companyId: ctx.companyId,
        jobId: job.id,
        from: formatWorkDate(from),
        to: formatWorkDate(to),
        employeeIds: memberIds,
      });
    } else {
      // Cố ý không `await`: request phải trả 202 ngay, client theo dõi qua job.
      // `.catch` bắt trọn vì promise không ai giữ — để lọt sẽ thành
      // unhandledRejection và giết tiến trình Node.
      void this.payroll
        .runTrackedRecalculate(ctx.companyId, job.id, from, to, memberIds)
        .catch((error: Error) =>
          this.logger.error(
            `Tính lại bảng chấm công ${sheetId} (nội tuyến) thất bại: ${error.message}`,
          ),
        );
    }

    return {
      jobId: job.id,
      statusUrl: `/v1/jobs/${job.id}`,
      employeeCount: memberIds.length,
    };
  }

  // ===========================================================================
  //  Lưới người × ngày
  // ===========================================================================

  /**
   * Lưới chấm công của một bảng — `FR-WEB-ATT-09`.
   *
   * Trả về BỐN nguồn trong một lượt gọi: dòng (thành viên), lịch ca đã xếp, công
   * đã tính, và đơn từ chạm vào kỳ. Tách thành bốn endpoint thì có khoảnh khắc
   * chỉ vài phần về tới nơi và lưới hiện ra thiếu — trên một bảng công, "ô trống"
   * và "chưa tải xong" trông giống hệt nhau, mà một cái nghĩa là vắng mặt.
   *
   * Ô của lưới do client ghép: server trả dữ liệu phẳng theo từng nguồn để
   * payload không phình lên 775 object lồng nhau cho một trang 25 người.
   */
  async getBoard(
    companyId: string,
    sheetId: string,
    query: AttendanceSheetBoardQueryDto,
    departmentScope: string[] | null,
  ) {
    const sheet = await this.requireSheet(companyId, sheetId);
    const period = {
      from: sheet.periodMonth,
      to: endOfMonth(sheet.periodMonth),
    };

    const from = query.from ? parseWorkDate(query.from) : period.from;
    const to = query.to ? parseWorkDate(query.to) : period.to;

    if (to < from) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Ngày kết thúc trước ngày bắt đầu.',
      });
    }
    if (from < period.from || to > period.to) {
      throw new AppException('ATT_SHEET_OUT_OF_PERIOD', {
        period: formatWorkDate(period.from).slice(0, 7),
        from: formatWorkDate(from),
        to: formatWorkDate(to),
      });
    }
    if (dayCountBetween(from, to) > MAX_BOARD_DAYS) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: `Khoảng ngày tối đa ${MAX_BOARD_DAYS} ngày.`,
      });
    }

    // DÒNG là thành viên đã chốt của bảng, không phải "ai đang thuộc phòng ban
    // này". Hai thứ đó lệch nhau ngay khi có người chuyển phòng giữa tháng, và
    // lấy theo phòng ban thì công của họ biến mất khỏi bảng đang rà.
    const memberIds = await this.sheets.findMemberIds(sheetId);

    const { items: employees, total } = await this.sheets.searchMemberEmployees(companyId, {
      memberIds,
      departmentIds: query.departmentId
        ? await this.policies.expandDepartmentIds(companyId, [query.departmentId])
        : undefined,
      departmentScope,
      q: query.q,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    const employeeIds = employees.map((employee) => employee.id);
    const timezone = await this.policy.getTimezone(companyId);

    const [assignments, dailies, requests, holidays] = await Promise.all([
      this.policies.findShiftAssignments(companyId, employeeIds, from, to),
      this.sheets.findDailies(companyId, employeeIds, from, to),
      this.sheets.findRequestsInRange(
        companyId,
        employeeIds,
        dayBoundsUtc(from, timezone).start,
        dayBoundsUtc(to, timezone).end,
      ),
      this.policies.listHolidays(companyId),
    ]);

    return {
      from: formatWorkDate(from),
      to: formatWorkDate(to),
      employees,
      assignments: assignments.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        shiftId: row.shiftId,
        // `YYYY-MM-DD` chứ không ISO datetime: `workDate` là ngày làm việc theo
        // lịch công ty, không có giờ. Để nguyên `Date` thì client ở múi giờ âm
        // hiển thị lệch một ngày.
        workDate: formatWorkDate(row.workDate),
        scheduleId: row.scheduleId,
      })),
      dailies: dailies.map((row) => ({
        ...row,
        workDate: formatWorkDate(row.workDate),
      })),
      requests: requests.map((row) => toRequestDto(row, timezone)),
      holidays: holidays.map((holiday) => ({
        name: holiday.name,
        date: formatWorkDate(holiday.date),
      })),
      meta: buildMeta(query.page, query.pageSize, total),
    };
  }

  // ===========================================================================
  //  Ràng buộc dùng chung
  // ===========================================================================

  private async requireSheet(companyId: string, sheetId: string): Promise<AttendanceSheetRow> {
    const sheet = await this.sheets.findSheet(companyId, sheetId);
    if (!sheet) {
      throw new AppException('ATT_SHEET_NOT_FOUND');
    }
    return sheet;
  }

  private async requireOpenSheet(companyId: string, sheetId: string): Promise<AttendanceSheetRow> {
    const sheet = await this.requireSheet(companyId, sheetId);
    if (sheet.status === 'CLOSED') {
      throw new AppException('ATT_SHEET_CLOSED', { sheet: sheet.name });
    }
    return sheet;
  }

  /**
   * Kiểm tra trước để báo lỗi có TÊN NGƯỜI thay vì ném lại lỗi ràng buộc thô của
   * Postgres. Ràng buộc trong database vẫn là chốt cuối — hai request lập bảng
   * chạy song song đều thấy "chưa ai giữ" rồi cùng ghi.
   */
  private async assertMembersFree(
    periodMonth: Date,
    employeeIds: string[],
    excludeSheetId?: string,
  ): Promise<void> {
    const taken = await this.sheets.findMembersTakenInMonth(
      periodMonth,
      employeeIds,
      excludeSheetId,
    );
    if (taken.length > 0) {
      throw new AppException('ATT_SHEET_EMPLOYEE_TAKEN', {
        employees: taken.slice(0, 10).map((row) => `${row.fullName} (${row.sheetName})`),
        total: taken.length,
      });
    }
  }
}

// =============================================================================
//  Ánh xạ ra DTO
// =============================================================================

function toSheetDto(row: AttendanceSheetRow) {
  return {
    id: row.id,
    name: row.name,
    periodMonth: formatWorkDate(row.periodMonth),
    departmentIds: row.departmentIds,
    shiftScheduleIds: row.shiftScheduleIds,
    status: row.status,
    closedAt: row.closedAt,
    closedBy: row.closedBy,
    memberCount: row._count.members,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Đơn từ trả kèm NGÀY LÀM VIỆC bắt đầu và kết thúc, không chỉ instant gốc.
 *
 * Lưới cần biết đơn phủ lên những ô nào. Quy đổi instant → ngày làm việc phải
 * theo timezone công ty và phải làm ở server: client tự cắt chuỗi ISO sẽ ra
 * ngày UTC, và mọi đơn bắt đầu sau 17:00 giờ Việt Nam sẽ nhảy về ngày hôm trước.
 */
function toRequestDto(row: AttendanceSheetRequestRow, timezone: string) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    startDate: formatWorkDate(toWorkDate(row.startAt, timezone)),
    endDate: formatWorkDate(toWorkDate(row.endAt, timezone)),
    quantity: row.quantity,
    isHalfDay: row.isHalfDay,
    reason: row.reason,
    requestTypeId: row.requestType.id,
    requestTypeCode: row.requestType.code,
    requestTypeName: row.requestType.name,
    unit: row.requestType.unit,
    deductFrom: row.requestType.deductFrom,
    isPaidLeave: row.requestType.isPaidLeave,
  };
}

/** "Bảng chấm công Tháng 08/2026" — Web sinh cùng chuỗi khi người dùng bỏ trống tên. */
function defaultSheetName(periodMonth: Date): string {
  return `Bảng chấm công Tháng ${formatWorkDate(periodMonth).slice(5, 7)}/${formatWorkDate(periodMonth).slice(0, 4)}`;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function dayCountBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}
