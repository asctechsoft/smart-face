import { Injectable } from '@nestjs/common';
import {
  Branch,
  Company,
  CompanyPolicy,
  EmployeeStatus,
  Holiday,
  LeaveBalance,
  LeavePolicy,
  PayrollPeriodStatus,
  Prisma,
  ShiftType,
} from '@prisma/client';
import {
  withAncestorDepartments,
  withDescendantDepartments,
  type DepartmentNode,
} from 'src/common/utils';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type ShiftWithSegments = Prisma.ShiftGetPayload<{ include: { segments: true } }>;

/**
 * Ca kèm hệ số riêng của từng ngày lễ — chỉ dùng cho màn danh mục.
 *
 * Cố tình KHÔNG gộp vào `ShiftWithSegments`: máy tính công đọc ca cho từng nhân
 * viên từng ngày, nối thêm một bảng nữa vào mỗi lượt đọc chỉ để lấy dữ liệu nó
 * không dùng là trả giá ở đúng chỗ nóng nhất của hệ thống.
 */
export type ShiftCatalogRow = Prisma.ShiftGetPayload<{
  include: { segments: true; holidayFactors: true };
}>;

/** Bảng phân ca kèm hai con số mà danh sách luôn cần: bao nhiêu người, đã xếp bao nhiêu lượt. */
export type ShiftScheduleRow = Prisma.ShiftScheduleGetPayload<{
  include: { _count: { select: { members: true; assignments: true } } };
}>;

/** Một dòng của bảng phân ca — nhân viên kèm phòng ban để nhóm trên giao diện. */
export interface ShiftBoardEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  status: EmployeeStatus;
  department: { id: string; name: string } | null;
}

/** Một lượt đã xếp kèm khung giờ của ca — dùng để so giao giờ. */
export interface AssignedShiftWindow {
  employeeId: string;
  workDate: Date;
  shiftId: string;
  shift: {
    name: string;
    startTime: string | null;
    endTime: string | null;
    crossesMidnight: boolean;
    type: ShiftType;
  };
}

export interface ShiftAssignmentRow {
  id: string;
  employeeId: string;
  shiftId: string;
  workDate: Date;
  createdBy: string | null;
  /** Bảng phân ca đã xếp lượt này. `null` = lịch có trước khi có bảng, hoặc do API xếp thẳng. */
  scheduleId: string | null;
}

export interface LeavePolicyWriteInput {
  contractType: string | null;
  baseDaysPerYear: number;
  seniorityBonusDays: number;
  seniorityEveryYears: number;
  allowCarryOver: boolean;
  maxCarryOverDays: number | null;
  carryOverExpireMonth: number | null;
  accrualMode: string;
  effectiveFrom: Date;
}
/** ⚠ `_count.employees` là số người **xếp ca được** — xem `listDepartments`. */
export type DepartmentWithCount = Prisma.DepartmentGetPayload<{
  include: { _count: { select: { employees: true } } };
}>;

export interface ShiftSegmentInput {
  order: number;
  startTime: string;
  endTime: string;
}

/**
 * Phần danh mục — chung cho cả tạo mới lẫn sửa tại chỗ.
 *
 * Tách riêng vì đây là các trường MÔ TẢ ca, không tham gia vào công thức tính
 * giờ công. Đổi chúng không cần tạo phiên bản ca mới theo D6.
 */
interface ShiftCatalogFields {
  code: string;
  symbol: string | null;
  departmentIds: string[];
  requireCheckIn: boolean;
  checkInFrom: string | null;
  checkInTo: string | null;
  requireCheckOut: boolean;
  checkOutFrom: string | null;
  checkOutTo: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  workDayCredit: number;
  normalDayFactor: number;
  weeklyRestFactor: number;
  holidayFactor: number;
}

/** Giá trị đã được service giải xong (đã áp mặc định) — repository chỉ ghi. */
export interface ShiftWriteInput extends ShiftCatalogFields {
  name: string;
  type?: ShiftType;
  startTime?: string | null;
  endTime?: string | null;
  crossesMidnight: boolean;
  breakMinutes: number;
  requiredMinutes?: number | null;
  lateToleranceMinutes: number;
  earlyLeaveToleranceMinutes: number;
  isDefault: boolean;
  weekdayMask: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  segments?: ShiftSegmentInput[];
}

/** Sửa tại chỗ: field `undefined` nghĩa là GIỮ NGUYÊN, không phải xoá. */
export interface ShiftPatchInput extends Partial<ShiftCatalogFields> {
  name?: string;
  type?: ShiftType;
  startTime?: string;
  endTime?: string;
  crossesMidnight?: boolean;
  breakMinutes?: number;
  requiredMinutes?: number;
  lateToleranceMinutes?: number;
  earlyLeaveToleranceMinutes?: number;
  isDefault?: boolean;
  weekdayMask?: number;
  effectiveTo?: Date;
}

export interface BranchWriteInput {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number;
  wifiBssids?: string[];
  beaconUuids?: string[];
  timezone?: string | null;
}

export interface DepartmentWriteInput {
  name: string;
  branchId?: string | null;
  parentId?: string | null;
  managerId?: string | null;
}

export interface HolidayWriteInput {
  name: string;
  date: Date;
  substituteDate: Date | null;
  otMultiplier?: number;
  branchIds?: string[];
}

/**
 * Truy cập dữ liệu cấu hình công ty: chính sách, ca làm việc, ngày lễ, chi nhánh,
 * phòng ban (BR-12, FR-WEB-POL).
 *
 * Mọi phương thức nhận `companyId` làm tham số ĐẦU TIÊN và đưa nó vào `where`.
 * Cấu hình là thứ quyết định lương và kỷ luật lao động; một truy vấn thiếu
 * `companyId` ở đây không chỉ rò rỉ dữ liệu mà còn làm công ty này tính công theo
 * ca của công ty khác.
 */
@Injectable()
export class PolicyRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  CompanyPolicy (D6 — có hiệu lực theo thời gian)
  // ===========================================================================

  /** Bản ghi còn hiệu lực tại thời điểm `at`, sắp xếp cũ → mới để bản mới ghi đè. */
  async findEffectivePolicies(companyId: string, at: Date): Promise<CompanyPolicy[]> {
    return this.db().companyPolicy.findMany({
      where: {
        companyId,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
  }

  /** D6 — đóng bản đang mở thay vì ghi đè, để tính lại quá khứ vẫn ra đúng số. */
  async closeOpenPolicy(
    companyId: string,
    key: string,
    effectiveTo: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).companyPolicy.updateMany({
      where: { companyId, key, effectiveTo: null },
      data: { effectiveTo },
    });
  }

  async createPolicy(
    companyId: string,
    data: { key: string; value: Prisma.InputJsonValue; effectiveFrom: Date; updatedBy: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).companyPolicy.create({ data: { companyId, ...data } });
  }

  // ===========================================================================
  //  Công ty & timezone
  // ===========================================================================

  async findCompany(companyId: string): Promise<Company | null> {
    return this.db().company.findFirst({ where: { id: companyId, deletedAt: null } });
  }

  async findCompanyTimezone(companyId: string): Promise<string | null> {
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return company?.timezone ?? null;
  }

  async findBranchTimezone(companyId: string, branchId: string): Promise<string | null> {
    const branch = await this.db().branch.findFirst({
      where: { id: branchId, companyId },
      select: { timezone: true },
    });
    return branch?.timezone ?? null;
  }

  /** FR-ADM-TEN-04 — giới hạn gói dịch vụ. */
  async findPlanLimits(companyId: string): Promise<{ maxBranches: number | null } | null> {
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      include: { plan: true },
    });
    if (!company?.plan) return null;
    return { maxBranches: company.plan.maxBranches };
  }

  // ===========================================================================
  //  Ca làm việc
  // ===========================================================================

  /**
   * Ca được phân cho đúng ngày — lấy ca SỚM NHẤT khi ngày đó có nhiều ca.
   *
   * ⚠ Một ngày nay có thể mang nhiều ca (miễn giờ không giao nhau), nhưng máy
   * tính công và chấm công vẫn đọc đúng MỘT ca. Đây là giới hạn đã biết và đã
   * được chọn có ý thức: mở lịch cho nhiều ca là việc của bảng phân ca, còn
   * tính công cộng dồn nhiều ca trong ngày là một thay đổi khác hẳn về phạm vi
   * (chia lượt quẹt theo ca, đi muộn/về sớm từng ca, OT từng ca).
   *
   * Vì vậy thứ tự phải TIỀN ĐỊNH, không được để database trả bừa: sắp theo giờ
   * bắt đầu tăng dần. Postgres xếp `NULL` xuống cuối trong `ASC`, nên ca linh
   * hoạt (không khai giờ) chỉ được chọn khi ngày đó không còn ca nào khác.
   *
   * Trả `null` khi ca thuộc công ty khác (BR-09).
   */
  async findAssignedShift(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<ShiftWithSegments | null> {
    const assignment = await this.db().shiftAssignment.findFirst({
      where: { employeeId, workDate },
      include: { shift: { include: { segments: { orderBy: { order: 'asc' } } } } },
      orderBy: [{ shift: { startTime: 'asc' } }, { shiftId: 'asc' }],
    });

    if (!assignment?.shift || assignment.shift.companyId !== companyId) return null;
    return assignment.shift;
  }

  /** Số ca đã xếp cho đúng (người, ngày) — để cảnh báo khi tính công chỉ đọc ca đầu. */
  async countAssignedShifts(employeeId: string, workDate: Date): Promise<number> {
    return this.db().shiftAssignment.count({ where: { employeeId, workDate } });
  }

  /** Ca mặc định còn hiệu lực tại `workDate`, mới nhất trước (D6). */
  async findDefaultShifts(companyId: string, workDate: Date): Promise<ShiftWithSegments[]> {
    return this.db().shift.findMany({
      where: {
        companyId,
        isDefault: true,
        deletedAt: null,
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      include: { segments: { orderBy: { order: 'asc' } } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async listShifts(companyId: string): Promise<ShiftCatalogRow[]> {
    return this.db().shift.findMany({
      where: { companyId, deletedAt: null },
      include: { segments: { orderBy: { order: 'asc' } }, holidayFactors: true },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
    });
  }

  async findShift(companyId: string, shiftId: string): Promise<ShiftCatalogRow | null> {
    return this.db().shift.findFirst({
      where: { id: shiftId, companyId, deletedAt: null },
      include: { segments: { orderBy: { order: 'asc' } }, holidayFactors: true },
    });
  }

  /**
   * Ca nào đang GIỮ mã này — soi đúng tập hợp mà partial unique index bảo vệ.
   *
   * Điều kiện `effectiveTo: null` phải khớp chính xác với `WHERE` của index
   * (xem `20260815130000_shift_code_partial_unique`). Lệch nhau thì hoặc người
   * dùng bị chặn ở một mã thật ra dùng được, hoặc đi hết cả cái form rồi mới
   * nhận lỗi ràng buộc thô từ Postgres.
   *
   * KHÔNG lọc `deletedAt`: ca xoá mềm vẫn giữ mã của nó, vì mã đó đã nằm trên
   * bảng công đã in ra.
   */
  async findShiftIdByCode(companyId: string, code: string): Promise<string | null> {
    const row = await this.db().shift.findFirst({
      where: { companyId, code, effectiveTo: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async createShift(
    companyId: string,
    data: ShiftWriteInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ShiftCatalogRow> {
    const { segments, ...shift } = data;
    return this.db(tx).shift.create({
      data: {
        companyId,
        ...shift,
        segments: segments ? { create: segments } : undefined,
      },
      include: { segments: { orderBy: { order: 'asc' } }, holidayFactors: true },
    });
  }

  /**
   * Thay TOÀN BỘ danh sách hệ số ngoại lệ của một ca.
   *
   * Xoá rồi ghi lại thay vì so từng dòng: danh sách này nhiều nhất bằng số ngày
   * lễ trong năm, và "thay cả cụm" là đúng ý nghĩa của thao tác người dùng vừa
   * làm — họ nộp lên bảng ngoại lệ mới, không nộp lên một danh sách thay đổi.
   */
  async replaceShiftHolidayFactors(
    shiftId: string,
    factors: { holidayId: string; factor: number }[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.db(tx);
    await client.shiftHolidayFactor.deleteMany({ where: { shiftId } });
    if (factors.length > 0) {
      await client.shiftHolidayFactor.createMany({
        data: factors.map((row) => ({ shiftId, holidayId: row.holidayId, factor: row.factor })),
      });
    }
  }

  /**
   * `updateMany` + đọc lại thay vì `update({ where: { id } })`: `where` của
   * `update` chỉ nhận khoá duy nhất nên không chèn được `companyId` vào đó, và
   * một `shiftId` đoán đúng sẽ sửa được ca của công ty khác (BR-09).
   */
  async updateShift(
    companyId: string,
    shiftId: string,
    data: ShiftPatchInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ShiftCatalogRow | null> {
    const updated = await this.db(tx).shift.updateMany({
      where: { id: shiftId, companyId, deletedAt: null },
      data,
    });
    if (updated.count === 0) return null;

    return this.db(tx).shift.findFirst({
      where: { id: shiftId, companyId },
      include: { segments: { orderBy: { order: 'asc' } }, holidayFactors: true },
    });
  }

  /** Đóng bản ca hiện tại — dùng khi đổi giờ ca đã phát sinh dữ liệu (D6). */
  async closeShift(
    companyId: string,
    shiftId: string,
    effectiveTo: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).shift.updateMany({
      where: { id: shiftId, companyId },
      data: { effectiveTo },
    });
  }

  async replaceShiftSegments(
    shiftId: string,
    segments: ShiftSegmentInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.db(tx);
    await client.shiftSegment.deleteMany({ where: { shiftId } });
    await client.shiftSegment.createMany({
      data: segments.map((segment) => ({ shiftId, ...segment })),
    });
  }

  /** D4 — soft delete để bảng công quá khứ vẫn truy vết được ca. */
  async softDeleteShift(companyId: string, shiftId: string): Promise<number> {
    const result = await this.db().shift.updateMany({
      where: { id: shiftId, companyId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async countShiftAssignments(companyId: string, shiftId: string): Promise<number> {
    return this.db().shiftAssignment.count({ where: { companyId, shiftId } });
  }

  async upsertShiftAssignment(
    companyId: string,
    data: {
      employeeId: string;
      shiftId: string;
      workDate: Date;
      createdBy: string;
      scheduleId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const { employeeId, shiftId, workDate, createdBy, scheduleId = null } = data;
    // Khoá gồm cả `shiftId`: xếp thêm ca thứ hai vào cùng ngày là THÊM DÒNG, chỉ
    // xếp lại đúng ca đó mới ghi đè. Điều kiện "giờ không giao nhau" do service
    // kiểm trước khi gọi vào đây (`assertNoShiftOverlap`).
    await this.db(tx).shiftAssignment.upsert({
      where: { employeeId_workDate_shiftId: { employeeId, workDate, shiftId } },
      create: { companyId, employeeId, shiftId, workDate, createdBy, scheduleId },
      update: { createdBy, scheduleId },
    });
  }

  /**
   * Lịch đã xếp kèm khung giờ của ca — nguồn để kiểm tra giao giờ.
   *
   * Lấy dư một ngày ở hai đầu là CỐ Ý: ca đêm 22:00–06:00 xếp cho ngày hôm
   * trước vẫn còn chạy tới 6 giờ sáng ngày đang xét.
   */
  async findAssignmentsWithShift(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<AssignedShiftWindow[]> {
    if (employeeIds.length === 0) return [];
    return this.db().shiftAssignment.findMany({
      where: { companyId, employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      select: {
        employeeId: true,
        workDate: true,
        shiftId: true,
        shift: {
          select: {
            name: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true,
            type: true,
          },
        },
      },
    });
  }

  // ===========================================================================
  //  Bảng phân ca (FR-WEB-HR-13)
  // ===========================================================================

  async listShiftSchedules(
    companyId: string,
    filter: { month?: Date; departmentIds?: string[]; skip: number; take: number },
  ): Promise<{ items: ShiftScheduleRow[]; total: number }> {
    const where: Prisma.ShiftScheduleWhereInput = { companyId, deletedAt: null };
    if (filter.month) where.periodMonth = filter.month;
    // `hasSome` chứ không `has`: lọc theo một khối cha phải ra cả bảng lập cho
    // các tổ bên dưới nó, nếu không thì chọn cấp cao nhất lại là chọn hẹp nhất.
    if (filter.departmentIds?.length) where.departmentIds = { hasSome: filter.departmentIds };

    const [items, total] = await Promise.all([
      this.db().shiftSchedule.findMany({
        where,
        include: { _count: { select: { members: true, assignments: true } } },
        orderBy: [{ periodMonth: 'desc' }, { createdAt: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.db().shiftSchedule.count({ where }),
    ]);
    return { items, total };
  }

  async findShiftSchedule(companyId: string, scheduleId: string): Promise<ShiftScheduleRow | null> {
    return this.db().shiftSchedule.findFirst({
      where: { id: scheduleId, companyId, deletedAt: null },
      include: { _count: { select: { members: true, assignments: true } } },
    });
  }

  async createShiftSchedule(
    companyId: string,
    data: {
      name: string;
      periodMonth: Date;
      departmentIds: string[];
      shiftIds: string[];
      createdBy: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const row = await this.db(tx).shiftSchedule.create({
      data: { companyId, ...data },
      select: { id: true },
    });
    return row;
  }

  async updateShiftSchedule(
    companyId: string,
    scheduleId: string,
    data: { name?: string; departmentIds?: string[]; shiftIds?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).shiftSchedule.updateMany({
      where: { id: scheduleId, companyId, deletedAt: null },
      data,
    });
    return result.count;
  }

  /** D4 — soft delete để audit log còn tra được bảng đã bị xoá. */
  async softDeleteShiftSchedule(
    companyId: string,
    scheduleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).shiftSchedule.updateMany({
      where: { id: scheduleId, companyId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Thành viên bị XOÁ HẲN, không phải xoá mềm.
   *
   * Ràng buộc `(employeeId, periodMonth)` không lọc `deletedAt` — giữ lại dòng
   * thành viên của một bảng đã xoá nghĩa là những người đó vĩnh viễn không lập
   * được bảng mới cho tháng đó.
   */
  async deleteScheduleMembers(
    scheduleId: string,
    employeeIds?: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).shiftScheduleMember.deleteMany({
      where: { scheduleId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    });
    return result.count;
  }

  async addScheduleMembers(
    scheduleId: string,
    periodMonth: Date,
    employeeIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (employeeIds.length === 0) return 0;
    const result = await this.db(tx).shiftScheduleMember.createMany({
      data: employeeIds.map((employeeId) => ({ scheduleId, employeeId, periodMonth })),
      // Thêm lại người đã có trong bảng là thao tác vô hại, không phải lỗi.
      skipDuplicates: true,
    });
    return result.count;
  }

  async findScheduleMemberIds(scheduleId: string): Promise<string[]> {
    const rows = await this.db().shiftScheduleMember.findMany({
      where: { scheduleId },
      select: { employeeId: true },
    });
    return rows.map((row) => row.employeeId);
  }

  /**
   * Ai trong danh sách này đã thuộc một bảng khác của cùng tháng.
   *
   * Dùng để báo lỗi có tên người thay vì ném lại lỗi ràng buộc thô của Postgres.
   */
  async findMembersTakenInMonth(
    periodMonth: Date,
    employeeIds: string[],
    excludeScheduleId?: string,
  ): Promise<{ employeeId: string; fullName: string; scheduleName: string }[]> {
    if (employeeIds.length === 0) return [];
    const rows = await this.db().shiftScheduleMember.findMany({
      where: {
        periodMonth,
        employeeId: { in: employeeIds },
        ...(excludeScheduleId ? { scheduleId: { not: excludeScheduleId } } : {}),
      },
      select: {
        employeeId: true,
        employee: { select: { fullName: true } },
        schedule: { select: { name: true } },
      },
    });
    return rows.map((row) => ({
      employeeId: row.employeeId,
      fullName: row.employee.fullName,
      scheduleName: row.schedule.name,
    }));
  }

  /** Phòng ban đã chọn kèm toàn bộ cấp dưới — xem `withDescendantDepartments`. */
  async expandDepartmentIds(companyId: string, departmentIds: string[]): Promise<string[]> {
    if (departmentIds.length === 0) return [];
    return withDescendantDepartments(await this.findDepartmentTree(companyId), departmentIds);
  }

  /**
   * Phòng ban đã chọn kèm cấp dưới VÀ cấp trên — chỉ dùng cho bộ lọc *tìm bảng*.
   *
   * Tìm khác với áp dụng: lọc danh sách theo tổ Kế toán phải thấy cả bảng lập
   * cho toàn công ty (bảng đó có người Kế toán trong đó), trong khi lấy thành
   * viên cho một bảng thì chỉ được đi xuống — đi lên sẽ kéo cả người phòng khác
   * vào bảng.
   */
  async relatedDepartmentIds(companyId: string, departmentIds: string[]): Promise<string[]> {
    if (departmentIds.length === 0) return [];
    const all = await this.findDepartmentTree(companyId);
    return [
      ...new Set([
        ...withDescendantDepartments(all, departmentIds),
        ...withAncestorDepartments(all, departmentIds),
      ]),
    ];
  }

  private async findDepartmentTree(companyId: string): Promise<DepartmentNode[]> {
    return this.db().department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, parentId: true },
    });
  }

  /** Nhân viên đang làm việc của các phòng ban — nguồn thành viên lúc lập bảng. */
  async findAssignableEmployeeIdsInDepartments(
    companyId: string,
    departmentIds: string[],
    departmentScope: string[] | null,
  ): Promise<string[]> {
    const allowed = departmentScope
      ? departmentIds.filter((id) => departmentScope.includes(id))
      : departmentIds;
    if (allowed.length === 0) return [];

    const rows = await this.db().employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        departmentId: { in: allowed },
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.PENDING_ACTIVATION] },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Xoá lịch ca do một bảng sinh ra — chỉ những lượt mang đúng `scheduleId`. */
  async deleteAssignmentsOfSchedule(
    companyId: string,
    scheduleId: string,
    employeeIds?: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).shiftAssignment.deleteMany({
      where: {
        companyId,
        scheduleId,
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
    });
    return result.count;
  }

  /** BR-07 — kỳ lương đã chốt phủ lên tháng của bảng phân ca. */
  async findClosedPeriodOverlapping(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<{ name: string } | null> {
    return this.db().payrollPeriod.findFirst({
      where: {
        companyId,
        status: PayrollPeriodStatus.CLOSED,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { name: true },
    });
  }

  /**
   * Lọc ra id thực sự thuộc công ty — dùng trước khi phân ca hàng loạt (BR-09).
   *
   * `departmentScope` là phạm vi của MANAGER: chỉ thu hẹp, không bao giờ mở
   * rộng. Bỏ qua nó ở đây thì một MANAGER đoán đúng id là thêm được người phòng
   * khác vào bảng của mình.
   */
  async findEmployeeIdsInCompany(
    companyId: string,
    employeeIds: string[],
    departmentScope?: string[] | null,
  ): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: {
        id: { in: employeeIds },
        companyId,
        deletedAt: null,
        ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Danh sách nhân viên làm DÒNG của bảng phân ca (FR-WEB-HR-03).
   *
   * Chỉ lấy người còn đi làm được: hồ sơ `TERMINATED` không xếp ca được nữa, mà
   * để lẫn vào bảng thì tháng nào cũng có vài dòng trống không ai hiểu vì sao.
   */
  async searchAssignableEmployees(
    companyId: string,
    filter: {
      /** Phòng ban đã chọn kèm cấp dưới — service gọi `expandDepartmentIds` trước. */
      departmentIds?: string[];
      departmentScope: string[] | null;
      /**
       * Thành viên của bảng phân ca. `[]` nghĩa là bảng RỖNG và phải trả về
       * không dòng nào — khác hẳn `undefined` là "không lọc theo bảng".
       */
      memberIds?: string[];
      q?: string;
      skip: number;
      take: number;
    },
  ): Promise<{ items: ShiftBoardEmployee[]; total: number }> {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.PENDING_ACTIVATION] },
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
    // `in: []` khớp không dòng nào — đúng ý nghĩa của một bảng chưa có ai.
    if (filter.memberIds !== undefined) where.id = { in: filter.memberIds };
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
        orderBy: [{ department: { name: 'asc' } }, { fullName: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * @param scheduleId chỉ lấy lượt do ĐÚNG bảng này xếp. Bỏ trống = mọi lượt
   *   trong khoảng, dùng cho màn xem lịch chung không gắn bảng nào.
   */
  async findShiftAssignments(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
    scheduleId?: string,
  ): Promise<ShiftAssignmentRow[]> {
    if (employeeIds.length === 0) return [];
    return this.db().shiftAssignment.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        workDate: { gte: from, lte: to },
        ...(scheduleId ? { scheduleId } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        shiftId: true,
        workDate: true,
        createdBy: true,
        scheduleId: true,
      },
      orderBy: { workDate: 'asc' },
    });
  }

  /** @param shiftId chỉ xoá đúng ca này; bỏ trống = xoá mọi ca trong khoảng. */
  async deleteShiftAssignments(
    companyId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
    shiftId?: string,
  ): Promise<number> {
    const result = await this.db().shiftAssignment.deleteMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        workDate: { gte: from, lte: to },
        ...(shiftId ? { shiftId } : {}),
      },
    });
    return result.count;
  }

  // ===========================================================================
  //  Chính sách phép năm (FR-WEB-POL-07, FR-WEB-POL-08)
  // ===========================================================================

  async listLeavePolicies(companyId: string): Promise<LeavePolicy[]> {
    return this.db().leavePolicy.findMany({
      where: { companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { contractType: 'asc' }],
    });
  }

  async findLeavePolicy(companyId: string, id: string): Promise<LeavePolicy | null> {
    return this.db().leavePolicy.findFirst({ where: { id, companyId } });
  }

  /**
   * Đóng bản đang mở của cùng loại hợp đồng (D6).
   *
   * `contractType: null` là một GIÁ TRỊ chứ không phải "mọi loại": đóng bản mặc
   * định không được đụng tới chính sách riêng của loại hợp đồng khác.
   */
  async closeOpenLeavePolicy(
    companyId: string,
    contractType: string | null,
    effectiveTo: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).leavePolicy.updateMany({
      where: { companyId, contractType, effectiveTo: null },
      data: { effectiveTo },
    });
  }

  async createLeavePolicy(
    companyId: string,
    data: LeavePolicyWriteInput,
    tx?: Prisma.TransactionClient,
  ): Promise<LeavePolicy> {
    return this.db(tx).leavePolicy.create({ data: { companyId, ...data } });
  }

  /** Số dư phép của cả công ty trong một năm — nguồn của báo cáo sử dụng phép. */
  async listLeaveBalances(companyId: string, year: number): Promise<LeaveBalance[]> {
    return this.db().leaveBalance.findMany({ where: { companyId, year } });
  }

  // ===========================================================================
  //  Ngày lễ
  // ===========================================================================

  /** Khớp cả ngày lễ gốc lẫn ngày nghỉ bù. */
  async findHolidayOnDate(companyId: string, workDate: Date): Promise<Holiday | null> {
    return this.db().holiday.findFirst({
      where: { companyId, OR: [{ date: workDate }, { substituteDate: workDate }] },
    });
  }

  async listHolidays(companyId: string, year?: number): Promise<Holiday[]> {
    const where: Prisma.HolidayWhereInput = { companyId };
    if (year) {
      where.date = { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) };
    }
    return this.db().holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  async upsertHoliday(companyId: string, data: HolidayWriteInput): Promise<Holiday> {
    return this.db().holiday.upsert({
      where: { companyId_date: { companyId, date: data.date } },
      create: {
        companyId,
        name: data.name,
        date: data.date,
        substituteDate: data.substituteDate,
        otMultiplier: data.otMultiplier ?? 3.0,
        branchIds: data.branchIds ?? [],
      },
      update: {
        name: data.name,
        substituteDate: data.substituteDate,
        otMultiplier: data.otMultiplier ?? undefined,
        branchIds: data.branchIds ?? undefined,
      },
    });
  }

  async findHoliday(companyId: string, holidayId: string): Promise<Holiday | null> {
    return this.db().holiday.findFirst({ where: { id: holidayId, companyId } });
  }

  async deleteHoliday(companyId: string, holidayId: string): Promise<number> {
    const result = await this.db().holiday.deleteMany({ where: { id: holidayId, companyId } });
    return result.count;
  }

  // ===========================================================================
  //  Chi nhánh
  // ===========================================================================

  async listBranches(companyId: string): Promise<Branch[]> {
    return this.db().branch.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async countBranches(companyId: string): Promise<number> {
    return this.db().branch.count({ where: { companyId, deletedAt: null } });
  }

  async findBranch(companyId: string, branchId: string): Promise<Branch | null> {
    return this.db().branch.findFirst({ where: { id: branchId, companyId, deletedAt: null } });
  }

  async createBranch(companyId: string, data: BranchWriteInput): Promise<Branch> {
    return this.db().branch.create({
      data: {
        companyId,
        ...data,
        radiusMeters: data.radiusMeters ?? 100,
        wifiBssids: data.wifiBssids ?? [],
        beaconUuids: data.beaconUuids ?? [],
      },
    });
  }

  async updateBranch(
    companyId: string,
    branchId: string,
    data: Partial<BranchWriteInput>,
  ): Promise<Branch | null> {
    const updated = await this.db().branch.updateMany({
      where: { id: branchId, companyId, deletedAt: null },
      data,
    });
    if (updated.count === 0) return null;
    return this.findBranch(companyId, branchId);
  }

  // ===========================================================================
  //  Phòng ban
  // ===========================================================================

  /**
   * `_count.employees` đếm người **xếp ca được**, không phải mọi hồ sơ từng
   * thuộc phòng ban.
   *
   * Web dùng con số này để nói trước "sẽ đưa N CBNV vào bảng" ngay lúc chọn
   * phòng ban. Đếm cả `TERMINATED` thì lời hứa đó sai, và người dùng chỉ phát
   * hiện sau khi bảng đã lập xong và trống trơn.
   */
  async listDepartments(companyId: string): Promise<DepartmentWithCount[]> {
    return this.db().department.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            employees: {
              where: {
                deletedAt: null,
                status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.PENDING_ACTIVATION] },
              },
            },
          },
        },
      },
    });
  }

  /** Tên phòng ban để đưa vào thông báo lỗi — id trần không nói được gì với người dùng. */
  async findDepartmentNames(companyId: string, departmentIds: string[]): Promise<string[]> {
    if (departmentIds.length === 0) return [];
    const rows = await this.db().department.findMany({
      where: { companyId, id: { in: departmentIds }, deletedAt: null },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => row.name);
  }

  async findDepartment(companyId: string, departmentId: string) {
    return this.db().department.findFirst({
      where: { id: departmentId, companyId, deletedAt: null },
    });
  }

  async createDepartment(companyId: string, data: DepartmentWriteInput) {
    return this.db().department.create({ data: { companyId, ...data } });
  }

  async updateDepartment(
    companyId: string,
    departmentId: string,
    data: Partial<DepartmentWriteInput>,
  ) {
    const updated = await this.db().department.updateMany({
      where: { id: departmentId, companyId, deletedAt: null },
      data,
    });
    if (updated.count === 0) return null;
    return this.findDepartment(companyId, departmentId);
  }
}
