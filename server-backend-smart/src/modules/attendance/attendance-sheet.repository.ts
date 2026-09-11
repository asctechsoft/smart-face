import { Injectable } from '@nestjs/common';
import { AttendanceDaily, DailyStatus, Prisma, RequestStatus } from '@prisma/client';
import { periodLockedFilter } from 'src/common/constants/payroll-period.constants';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

/** Bảng chấm công kèm con số mà danh sách luôn cần: bao nhiêu người trong bảng. */
export type AttendanceSheetRow = Prisma.AttendanceSheetGetPayload<{
  include: { _count: { select: { members: true } } };
}>;

/**
 * Một đơn từ có ảnh hưởng tới công của một ngày trong kỳ.
 *
 * Lấy kèm cấu hình loại đơn (`unit`, `deductFrom`) vì lưới chấm công phải nói
 * được đơn này trừ vào đâu — "nghỉ phép năm" và "nghỉ không lương" trông giống
 * nhau trên lịch nhưng khác nhau hoàn toàn trên bảng lương.
 */
export type AttendanceSheetRequestRow = Prisma.LeaveRequestGetPayload<{
  select: {
    id: true;
    employeeId: true;
    status: true;
    startAt: true;
    endAt: true;
    quantity: true;
    isHalfDay: true;
    reason: true;
    requestType: {
      select: {
        id: true;
        code: true;
        name: true;
        unit: true;
        deductFrom: true;
        isPaidLeave: true;
      };
    };
  };
}>;

/** Bộ lọc CHUNG cho mọi cách đọc thành viên bảng: lưới ngày và bảng tổng hợp. */
export interface MemberEmployeeFilter {
  /** Thành viên của bảng. `[]` = bảng rỗng, trả về không dòng nào. */
  memberIds: string[];
  departmentIds?: string[];
  departmentScope: string[] | null;
  branchId?: string;
  /** Đúng một người — dùng cho màn chi tiết bảng công của từng CBNV. */
  employeeId?: string;
  q?: string;
}

/**
 * Điều kiện chọn dòng của bảng chấm công — MỘT bản khai, hai nơi dùng.
 *
 * Lưới người × ngày và bảng tổng hợp phải chọn ĐÚNG cùng một tập người: hai bản
 * sao của cùng bộ lọc sẽ lệch nhau ngay lần đầu ai đó thêm một điều kiện vào
 * một bên, và khi đó thẻ "Tổng nhân viên" đếm 256 trong lúc lưới bên cạnh chỉ
 * có 254 dòng — không có cách nào biết bên nào đúng.
 */
function memberEmployeeWhere(
  companyId: string,
  filter: MemberEmployeeFilter,
): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {
    companyId,
    deletedAt: null,
    // GIAO với danh sách thành viên chứ không ghi đè: người được hỏi mà không
    // thuộc bảng này thì phải ra RỖNG, không phải ra dữ liệu của họ ở bảng khác.
    // `in: []` khớp không dòng nào — đúng nghĩa một bảng chưa có ai.
    id: {
      in: filter.employeeId
        ? filter.memberIds.filter((id) => id === filter.employeeId)
        : filter.memberIds,
    },
  };

  // Phạm vi của MANAGER thu hẹp, không mở rộng. GIAO hai tập chứ không ghi đè:
  // ghi đè thì một MANAGER lọc theo đúng một phòng trong quyền của mình vẫn
  // nhận về cả phạm vi, tức là bộ lọc họ vừa chọn im lặng không có tác dụng.
  const picked = filter.departmentIds?.length ? filter.departmentIds : null;
  if (picked && filter.departmentScope) {
    where.departmentId = { in: picked.filter((id) => filter.departmentScope?.includes(id)) };
  } else if (picked) {
    where.departmentId = { in: picked };
  } else if (filter.departmentScope) {
    where.departmentId = { in: filter.departmentScope };
  }

  if (filter.branchId) where.branchId = filter.branchId;

  if (filter.q) {
    where.OR = [
      { fullName: { contains: filter.q, mode: 'insensitive' } },
      { employeeCode: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Truy cập dữ liệu của bảng chấm công — `attendance_sheet`,
 * `attendance_sheet_member`, cộng các lượt đọc phục vụ lưới người × ngày.
 *
 * Tách khỏi `AttendanceRepository` vì hai thứ khác tầng: kia là dữ liệu chấm
 * công (bản ghi thô và bảng đã tính), đây là KHUNG tổ chức để rà soát chúng.
 */
@Injectable()
export class AttendanceSheetRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Bảng chấm công
  // ===========================================================================

  async listSheets(
    companyId: string,
    filter: { month?: Date; departmentIds?: string[]; skip: number; take: number },
  ): Promise<{ items: AttendanceSheetRow[]; total: number }> {
    const where: Prisma.AttendanceSheetWhereInput = { companyId, deletedAt: null };
    if (filter.month) where.periodMonth = filter.month;
    // `hasSome` chứ không `has`: lọc theo một khối cha phải ra cả bảng lập cho
    // các tổ bên dưới nó, nếu không thì chọn cấp cao nhất lại là chọn hẹp nhất.
    if (filter.departmentIds?.length) where.departmentIds = { hasSome: filter.departmentIds };

    const [items, total] = await Promise.all([
      this.db().attendanceSheet.findMany({
        where,
        include: { _count: { select: { members: true } } },
        orderBy: [{ periodMonth: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.db().attendanceSheet.count({ where }),
    ]);
    return { items, total };
  }

  async findSheet(companyId: string, sheetId: string): Promise<AttendanceSheetRow | null> {
    return this.db().attendanceSheet.findFirst({
      where: { id: sheetId, companyId, deletedAt: null },
      include: { _count: { select: { members: true } } },
    });
  }

  async createSheet(
    companyId: string,
    data: {
      name: string;
      periodMonth: Date;
      departmentIds: string[];
      shiftScheduleIds: string[];
      createdBy: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return this.db(tx).attendanceSheet.create({
      data: { companyId, ...data },
      select: { id: true },
    });
  }

  async updateSheetStatus(
    companyId: string,
    sheetId: string,
    data: { status: string; closedAt: Date | null; closedBy: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).attendanceSheet.updateMany({
      where: { id: sheetId, companyId, deletedAt: null },
      data,
    });
    return result.count;
  }

  /** D4 — xoá mềm để audit log còn tra được bảng đã bị xoá. */
  async softDeleteSheet(
    companyId: string,
    sheetId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).attendanceSheet.updateMany({
      where: { id: sheetId, companyId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  // ===========================================================================
  //  Thành viên
  // ===========================================================================

  async addMembers(
    sheetId: string,
    periodMonth: Date,
    employeeIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (employeeIds.length === 0) return 0;
    const result = await this.db(tx).attendanceSheetMember.createMany({
      data: employeeIds.map((employeeId) => ({ sheetId, employeeId, periodMonth })),
      // Thêm lại người đã có trong bảng là thao tác vô hại, không phải lỗi.
      skipDuplicates: true,
    });
    return result.count;
  }

  /**
   * Thành viên bị XOÁ HẲN, không xoá mềm.
   *
   * Ràng buộc `(employeeId, periodMonth)` không lọc `deletedAt` — giữ lại dòng
   * thành viên của một bảng đã xoá nghĩa là những người đó vĩnh viễn không lập
   * được bảng chấm công mới cho tháng đó.
   */
  async deleteMembers(
    sheetId: string,
    employeeIds?: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).attendanceSheetMember.deleteMany({
      where: { sheetId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    });
    return result.count;
  }

  /**
   * MỌI bảng chấm công của một tháng, không phân trang.
   *
   * Màn "Bảng công" đọc theo THÁNG chứ không theo từng bảng: một tháng được
   * chia thành nhiều bảng theo nhóm phòng ban, và người rà công nghĩ theo "công
   * tháng 5", không theo "bảng tháng 5 của Kho vận". Các bảng vẫn là đơn vị tổ
   * chức bên dưới — chúng quyết định AI thuộc kỳ này và chốt theo từng bảng.
   *
   * Không phân trang vì số bảng của một tháng đếm bằng đầu ngón tay: nó bằng số
   * nhóm phòng ban được lập bảng, không phải số nhân viên.
   */
  async listSheetsInMonth(companyId: string, month: Date): Promise<AttendanceSheetRow[]> {
    return this.db().attendanceSheet.findMany({
      where: { companyId, deletedAt: null, periodMonth: month },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Thành viên của nhiều bảng, KÈM bảng nào giữ họ.
   *
   * Cần cả `sheetId` chứ không chỉ danh sách người: trạng thái "Đã khoá" của một
   * dòng phụ thuộc vào bảng mà người đó thuộc về, và một tháng chốt dần từng
   * bảng chứ không chốt một lượt. Trả về danh sách người trần rồi hỏi lại bảng
   * cho từng người là N+1 lượt đọc cho đúng dữ liệu vừa có trong tay.
   */
  async findMembersOfSheets(
    sheetIds: string[],
  ): Promise<Array<{ employeeId: string; sheetId: string }>> {
    if (sheetIds.length === 0) return [];
    return this.db().attendanceSheetMember.findMany({
      where: { sheetId: { in: sheetIds } },
      select: { employeeId: true, sheetId: true },
    });
  }

  async findMemberIds(sheetId: string): Promise<string[]> {
    const rows = await this.db().attendanceSheetMember.findMany({
      where: { sheetId },
      select: { employeeId: true },
    });
    return rows.map((row) => row.employeeId);
  }

  /** Ai trong danh sách này đã thuộc một bảng chấm công khác của cùng tháng. */
  async findMembersTakenInMonth(
    periodMonth: Date,
    employeeIds: string[],
    excludeSheetId?: string,
  ): Promise<{ employeeId: string; fullName: string; sheetName: string }[]> {
    if (employeeIds.length === 0) return [];
    const rows = await this.db().attendanceSheetMember.findMany({
      where: {
        periodMonth,
        employeeId: { in: employeeIds },
        ...(excludeSheetId ? { sheetId: { not: excludeSheetId } } : {}),
      },
      select: {
        employeeId: true,
        employee: { select: { fullName: true } },
        sheet: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      employeeId: row.employeeId,
      fullName: row.employee.fullName,
      sheetName: row.sheet.name,
    }));
  }

  // ===========================================================================
  //  Nguồn dữ liệu: bảng phân ca của cùng kỳ
  // ===========================================================================

  /**
   * Các bảng phân ca của đúng tháng này có chạm tới các phòng ban đã chọn.
   *
   * Đây là NGUỒN thành viên của bảng chấm công: ai đã được xếp lịch ca trong
   * tháng thì phải có mặt trên bảng công của tháng đó.
   */
  async findShiftSchedulesForPeriod(
    companyId: string,
    periodMonth: Date,
    departmentIds: string[],
  ): Promise<{ id: string; name: string; departmentIds: string[]; shiftIds: string[] }[]> {
    return this.db().shiftSchedule.findMany({
      where: {
        companyId,
        deletedAt: null,
        periodMonth,
        ...(departmentIds.length ? { departmentIds: { hasSome: departmentIds } } : {}),
      },
      select: { id: true, name: true, departmentIds: true, shiftIds: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findScheduleMemberIds(scheduleIds: string[]): Promise<string[]> {
    if (scheduleIds.length === 0) return [];
    const rows = await this.db().shiftScheduleMember.findMany({
      where: { scheduleId: { in: scheduleIds } },
      select: { employeeId: true },
    });
    return [...new Set(rows.map((row) => row.employeeId))];
  }

  /**
   * Giữ lại những id thật sự thuộc công ty, thuộc phòng ban đã chọn, và nằm
   * trong quyền của người gọi.
   *
   * Ba bộ lọc GIAO nhau chứ không ghi đè nhau: nguồn thành viên là bảng phân ca,
   * mà một bảng phân ca lập cho cả khối sẽ chứa người của những phòng nằm ngoài
   * phạm vi bảng chấm công đang lập.
   */
  async filterEmployeeIds(
    companyId: string,
    employeeIds: string[],
    filter: { departmentIds?: string[]; departmentScope: string[] | null },
  ): Promise<string[]> {
    if (employeeIds.length === 0) return [];

    const allowed =
      filter.departmentIds && filter.departmentScope
        ? filter.departmentIds.filter((id) => filter.departmentScope?.includes(id))
        : (filter.departmentIds ?? filter.departmentScope);

    const rows = await this.db().employee.findMany({
      where: {
        id: { in: employeeIds },
        companyId,
        deletedAt: null,
        ...(allowed ? { departmentId: { in: allowed } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Dòng của lưới chấm công.
   *
   * ⚠ KHÔNG lọc theo `status` — khác hẳn danh sách nhân viên của bảng phân ca.
   * Người nghỉ việc giữa tháng vẫn có công của những ngày đã đi làm, và kế toán
   * vẫn phải trả lương cho chúng. Lọc `ACTIVE` ở đây sẽ làm cả dòng của họ biến
   * mất khỏi bảng ngay hôm hồ sơ chuyển sang `TERMINATED`, tức là đúng lúc cần
   * chốt công lần cuối cho họ.
   *
   * Tập dòng đã được chốt bởi `memberIds`, nên không lọc thêm là an toàn: người
   * không có tên trong bảng thì không xuất hiện dù trạng thái nào.
   */
  async searchMemberEmployees(
    companyId: string,
    filter: MemberEmployeeFilter & { skip: number; take: number },
  ): Promise<{
    items: {
      id: string;
      fullName: string;
      employeeCode: string;
      status: string;
      department: { id: string; name: string } | null;
    }[];
    total: number;
  }> {
    const where = memberEmployeeWhere(companyId, filter);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          status: true,
          department: { select: { id: true, name: true } },
        },
        orderBy: [{ employeeCode: 'asc' }, { fullName: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * TOÀN BỘ id khớp bộ lọc, không phân trang.
   *
   * Hàng thẻ chỉ số của bảng tổng hợp nói về CẢ KỲ — "256 nhân viên", "5.632
   * công chuẩn". Tính chúng trên 20 dòng của trang đang mở sẽ ra một con số nhỏ
   * hơn nhiều và đổi mỗi lần lật trang, trong khi nhãn vẫn ghi "Tổng".
   *
   * Chỉ lấy `id`: một công ty 500 người là 500 chuỗi, đủ nhẹ để làm đầu vào cho
   * các phép gộp bên dưới; kéo cả bản ghi nhân viên về đây thì không.
   */
  async findMemberEmployeeIds(companyId: string, filter: MemberEmployeeFilter): Promise<string[]> {
    if (filter.memberIds.length === 0) return [];
    const rows = await this.prisma.employee.findMany({
      where: memberEmployeeWhere(companyId, filter),
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  // ===========================================================================
  //  Tổng hợp công của cả kỳ — mỗi dòng một người
  //
  //  Mọi phép gộp ở đây chạy TRONG database (`groupBy`), không kéo 8.000 dòng
  //  công về Node rồi cộng bằng vòng lặp. Với 256 người × 31 ngày, khác biệt là
  //  giữa một truy vấn vài chục mili-giây và một payload vài megabyte.
  // ===========================================================================

  /** Cộng dồn công đã tính theo từng người trong kỳ. */
  async sumDailiesByEmployee(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      employeeId: string;
      standardDays: number;
      workedMinutes: number;
      otMinutes: number;
      lateMinutes: number;
      earlyLeaveMinutes: number;
    }>
  > {
    if (employeeIds.length === 0) return [];
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['employeeId'],
      where: { companyId, employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      _sum: {
        standardDays: true,
        workedMinutes: true,
        otMinutes: true,
        lateMinutes: true,
        earlyLeaveMinutes: true,
      },
    });

    return rows.map((row) => ({
      employeeId: row.employeeId,
      // `standardDays` là `Decimal`, không phải `number`. Ép kiểu ở ĐÂY chứ
      // không ở service: ra khỏi repository thì không còn ai nhớ điều đó, và
      // `a + b` trên hai Decimal cho ra chuỗi nối chứ không phải tổng.
      standardDays: Number(row._sum.standardDays ?? 0),
      workedMinutes: row._sum.workedMinutes ?? 0,
      otMinutes: row._sum.otMinutes ?? 0,
      lateMinutes: row._sum.lateMinutes ?? 0,
      earlyLeaveMinutes: row._sum.earlyLeaveMinutes ?? 0,
    }));
  }

  /**
   * Đếm ngày công theo (người, trạng thái).
   *
   * Nguồn của cột "Nghỉ phép": số ngày `ON_LEAVE`, cùng định nghĩa với
   * `PayrollService.buildSummaries`. Đếm lại từ đơn từ sẽ ra con số khác — một
   * đơn 5 ngày bắc qua hai tháng đóng góp khác nhau vào từng tháng — và khi đó
   * bảng công với bảng lương nói hai điều khác nhau về cùng một người.
   */
  async countDailyStatusByEmployee(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Array<{ employeeId: string; status: DailyStatus; days: number }>> {
    if (employeeIds.length === 0) return [];
    const rows = await this.db().attendanceDaily.groupBy({
      by: ['employeeId', 'status'],
      where: { companyId, employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      employeeId: row.employeeId,
      status: row.status,
      days: row._count._all,
    }));
  }

  /**
   * Những người còn ít nhất một ngày phải rà, tách theo loại việc phải làm.
   *
   * `missingCheckOut` là TẬP CON của `needsReview` chứ không phải nhánh song
   * song — nó được tách ra vì đó là lỗi có cách sửa rõ ràng nhất (bổ sung giờ
   * ra), nên đáng có nhãn riêng trên bảng thay vì lẫn vào "cần đối soát".
   *
   * Điều kiện khớp từng nhánh với `needsReviewWhere` của `ReportRepository`:
   * thẻ "Cần đối soát" ở Tổng quan và ở bảng công phải đếm cùng một thứ.
   */
  async findEmployeesNeedingReview(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ needsReview: Set<string>; missingCheckOut: Set<string> }> {
    if (employeeIds.length === 0) {
      return { needsReview: new Set(), missingCheckOut: new Set() };
    }

    const base: Prisma.AttendanceDailyWhereInput = {
      companyId,
      employeeId: { in: employeeIds },
      workDate: { gte: from, lte: to },
    };

    const [review, missing] = await Promise.all([
      this.db().attendanceDaily.groupBy({
        by: ['employeeId'],
        where: {
          ...base,
          OR: [
            {
              status: {
                in: [DailyStatus.MISSING_RECORD, DailyStatus.ABSENT, DailyStatus.INSUFFICIENT],
              },
            },
            { hasFraudFlag: true },
            { firstCheckInAt: { not: null }, lastCheckOutAt: null },
            { firstCheckInAt: null, lastCheckOutAt: { not: null } },
          ],
        },
      }),
      this.db().attendanceDaily.groupBy({
        by: ['employeeId'],
        where: { ...base, firstCheckInAt: { not: null }, lastCheckOutAt: null },
      }),
    ]);

    return {
      needsReview: new Set(review.map((row) => row.employeeId)),
      missingCheckOut: new Set(missing.map((row) => row.employeeId)),
    };
  }

  /**
   * Số NGÀY có ca được xếp trong kỳ, theo từng người — cột "Công chuẩn".
   *
   * Đếm theo NGÀY chứ không theo lượt phân ca: một người trực hai ca trong cùng
   * một ngày vẫn chỉ là một ngày công chuẩn, đếm lượt sẽ ra 2,0 công cho một
   * ngày duy nhất. Prisma không có `COUNT(DISTINCT)`, nên gộp theo cặp
   * (người, ngày) rồi đếm nhóm — số nhóm trần là số người × 31, đủ nhỏ.
   *
   * Không lấy từ `AttendanceDaily.standardDays`: cột đó là công THỰC TẾ đã tính,
   * và cả bảng này tồn tại để đặt hai con số ấy cạnh nhau.
   */
  async countScheduledDaysByEmployee(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.db().shiftAssignment.groupBy({
      by: ['employeeId', 'workDate'],
      where: { companyId, employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
    });

    const days = new Map<string, number>();
    for (const row of rows) days.set(row.employeeId, (days.get(row.employeeId) ?? 0) + 1);
    return days;
  }

  /**
   * Lần tính công gần nhất chạm vào kỳ này — dòng "Cập nhật lúc…" trên bộ lọc.
   *
   * Người rà công cần biết số trên màn hình cũ tới mức nào TRƯỚC khi quyết định
   * chốt. Không có mốc này thì "Đối soát tự động" là một nút bấm cho yên tâm:
   * bấm rồi cũng không ai biết lần sau có cần bấm nữa hay không.
   */
  async findLastCalculatedAt(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Date | null> {
    if (employeeIds.length === 0) return null;
    const row = await this.db().attendanceDaily.aggregate({
      where: { companyId, employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      _max: { calculatedAt: true },
    });
    return row._max.calculatedAt ?? null;
  }

  // ===========================================================================
  //  Ô của lưới: công đã tính + lịch ca + đơn từ
  // ===========================================================================

  /**
   * Công đã tính của khoảng ngày.
   *
   * KHÔNG phân trang: lưới đã phân trang theo người ở tầng trên, và một trang 25
   * người × 31 ngày là trần 775 dòng — đọc một lượt rẻ hơn nhiều so với ghép
   * từng ô ở client.
   */
  async findDailies(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<AttendanceDaily[]> {
    if (employeeIds.length === 0) return [];
    return this.db().attendanceDaily.findMany({
      where: { companyId, employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      orderBy: [{ employeeId: 'asc' }, { workDate: 'asc' }],
    });
  }

  /**
   * Đơn từ chạm vào khoảng ngày này.
   *
   * Điều kiện là GIAO NHAU (`startAt <= hết khoảng` và `endAt >= đầu khoảng`),
   * không phải "nằm trọn trong khoảng": đơn nghỉ từ 28/07 tới 02/08 vẫn ảnh
   * hưởng tới công của tháng 8, và lọc theo `startAt` trong tháng sẽ đánh rơi nó.
   *
   * Lấy cả `PENDING` chứ không chỉ `APPROVED`: đơn chờ duyệt CHƯA vào công,
   * nhưng người rà bảng cần thấy nó trước khi chốt — chốt xong mới duyệt đơn là
   * phải tính lại cả kỳ.
   */
  async findRequestsInRange(
    companyId: string,
    employeeIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<AttendanceSheetRequestRow[]> {
    if (employeeIds.length === 0) return [];
    return this.db().leaveRequest.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        status: { in: [RequestStatus.APPROVED, RequestStatus.PENDING] },
        startAt: { lte: rangeEnd },
        endAt: { gte: rangeStart },
      },
      select: {
        id: true,
        employeeId: true,
        status: true,
        startAt: true,
        endAt: true,
        quantity: true,
        isHalfDay: true,
        reason: true,
        requestType: {
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            deductFrom: true,
            isPaidLeave: true,
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /**
   * Bản ghi theo dõi lượt tính lại công của một bảng.
   *
   * Dùng chung bảng `export_job` với xuất Excel và tính lại kỳ lương — client
   * hỏi tiến độ qua đúng một endpoint `GET /v1/jobs/:id` cho mọi loại việc chạy
   * nền, phân biệt bằng `kind`.
   */
  async createRecalculateJob(
    companyId: string,
    data: { createdBy: string; params: Prisma.InputJsonValue },
  ): Promise<{ id: string }> {
    return this.db().exportJob.create({
      data: { companyId, status: 'QUEUED', kind: 'ATTENDANCE_SHEET_RECALCULATE', ...data },
      select: { id: true },
    });
  }

  /** Đóng job ngay khi không có gì để tính — bảng rỗng vẫn phải trả về một job đã xong. */
  async markRecalculateJobDone(jobId: string): Promise<void> {
    await this.db().exportJob.update({
      where: { id: jobId },
      data: { status: 'DONE', progress: 100, completedAt: new Date() },
    });
  }

  /** BR-07 — kỳ lương đã chốt phủ lên tháng của bảng thì bảng là dữ liệu đã trả tiền. */
  async findClosedPeriodOverlapping(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<{ id: string; name: string } | null> {
    return this.db().payrollPeriod.findFirst({
      where: {
        companyId,
        status: periodLockedFilter(),
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { id: true, name: true },
    });
  }
}
