import { Injectable } from '@nestjs/common';
import { Branch, Company, CompanyPolicy, Holiday, Prisma, ShiftType } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type ShiftWithSegments = Prisma.ShiftGetPayload<{ include: { segments: true } }>;
export type DepartmentWithCount = Prisma.DepartmentGetPayload<{
  include: { _count: { select: { employees: true } } };
}>;

export interface ShiftSegmentInput {
  order: number;
  startTime: string;
  endTime: string;
}

/** Giá trị đã được service giải xong (đã áp mặc định) — repository chỉ ghi. */
export interface ShiftWriteInput {
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
export interface ShiftPatchInput {
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
   * Ca được phân cho đúng ngày.
   *
   * Trả `null` khi ca thuộc công ty khác: `employeeId_workDate` là khoá duy nhất
   * TOÀN CỤC nên bản thân nó không ràng buộc tenant (BR-09).
   */
  async findAssignedShift(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<ShiftWithSegments | null> {
    const assignment = await this.db().shiftAssignment.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
      include: { shift: { include: { segments: { orderBy: { order: 'asc' } } } } },
    });

    if (!assignment?.shift || assignment.shift.companyId !== companyId) return null;
    return assignment.shift;
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

  async listShifts(companyId: string): Promise<ShiftWithSegments[]> {
    return this.db().shift.findMany({
      where: { companyId, deletedAt: null },
      include: { segments: { orderBy: { order: 'asc' } } },
      orderBy: [{ isDefault: 'desc' }, { effectiveFrom: 'desc' }],
    });
  }

  async findShift(companyId: string, shiftId: string): Promise<ShiftWithSegments | null> {
    return this.db().shift.findFirst({
      where: { id: shiftId, companyId, deletedAt: null },
      include: { segments: { orderBy: { order: 'asc' } } },
    });
  }

  async createShift(
    companyId: string,
    data: ShiftWriteInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ShiftWithSegments> {
    const { segments, ...shift } = data;
    return this.db(tx).shift.create({
      data: {
        companyId,
        ...shift,
        segments: segments ? { create: segments } : undefined,
      },
      include: { segments: { orderBy: { order: 'asc' } } },
    });
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
  ): Promise<ShiftWithSegments | null> {
    const updated = await this.db(tx).shift.updateMany({
      where: { id: shiftId, companyId, deletedAt: null },
      data,
    });
    if (updated.count === 0) return null;

    return this.db(tx).shift.findFirst({
      where: { id: shiftId, companyId },
      include: { segments: { orderBy: { order: 'asc' } } },
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
    data: { employeeId: string; shiftId: string; workDate: Date; createdBy: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const { employeeId, shiftId, workDate, createdBy } = data;
    await this.db(tx).shiftAssignment.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: { companyId, employeeId, shiftId, workDate, createdBy },
      update: { shiftId, createdBy },
    });
  }

  /** Lọc ra id thực sự thuộc công ty — dùng trước khi phân ca hàng loạt (BR-09). */
  async findEmployeeIdsInCompany(companyId: string, employeeIds: string[]): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: { id: { in: employeeIds }, companyId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
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

  async listDepartments(companyId: string): Promise<DepartmentWithCount[]> {
    return this.db().department.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
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
