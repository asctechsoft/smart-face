import { Injectable } from '@nestjs/common';
import { AttendanceDaily, Prisma, RequestStatus } from '@prisma/client';
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
    filter: {
      /** Thành viên của bảng. `[]` = bảng rỗng, trả về không dòng nào. */
      memberIds: string[];
      departmentIds?: string[];
      departmentScope: string[] | null;
      q?: string;
      skip: number;
      take: number;
    },
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
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      // `in: []` khớp không dòng nào — đúng nghĩa một bảng chưa có ai.
      id: { in: filter.memberIds },
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

    if (filter.q) {
      where.OR = [
        { fullName: { contains: filter.q, mode: 'insensitive' } },
        { employeeCode: { contains: filter.q, mode: 'insensitive' } },
      ];
    }

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
      where: { companyId, status: 'CLOSED', startDate: { lte: to }, endDate: { gte: from } },
      select: { id: true, name: true },
    });
  }
}
