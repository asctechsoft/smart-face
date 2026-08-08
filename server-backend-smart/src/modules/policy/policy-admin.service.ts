import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { eachWorkDate, parseWorkDate, weekdayOf } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import {
  BulkShiftAssignmentDto,
  UpsertBranchDto,
  UpsertDepartmentDto,
  UpsertHolidayDto,
  UpsertShiftDto,
} from './dto/policy.dto';
import { PolicyService } from './policy.service';

/**
 * CRUD chính sách cho Web Quản lý (FR-WEB-POL, FR-WEB-INV-04).
 * Mọi phương thức BẮT BUỘC nhận `companyId` — không có default (BR-09).
 */
@Injectable()
export class PolicyAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Ca làm việc (FR-WEB-POL-01..03)
  // ---------------------------------------------------------------------------

  async listShifts(companyId: string) {
    return this.prisma.shift.findMany({
      where: { companyId, deletedAt: null },
      include: { segments: { orderBy: { order: 'asc' } } },
      orderBy: [{ isDefault: 'desc' }, { effectiveFrom: 'desc' }],
    });
  }

  async createShift(companyId: string, dto: UpsertShiftDto) {
    this.validateShiftTimes(dto);

    return this.prisma.shift.create({
      data: {
        companyId,
        name: dto.name,
        type: dto.type,
        startTime: dto.startTime,
        endTime: dto.endTime,
        crossesMidnight: dto.crossesMidnight ?? this.inferCrossesMidnight(dto),
        breakMinutes: dto.breakMinutes ?? 0,
        requiredMinutes: dto.requiredMinutes,
        lateToleranceMinutes: dto.lateToleranceMinutes ?? 0,
        earlyLeaveToleranceMinutes: dto.earlyLeaveToleranceMinutes ?? 0,
        isDefault: dto.isDefault ?? false,
        weekdayMask: dto.weekdayMask ?? 0,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        segments: dto.segments
          ? { create: dto.segments.map((s) => ({ order: s.order, startTime: s.startTime, endTime: s.endTime })) }
          : undefined,
      },
      include: { segments: { orderBy: { order: 'asc' } } },
    });
  }

  /**
   * D6 — đổi cấu hình ca giữa tháng KHÔNG ghi đè bản cũ.
   *
   * Nếu ca đã được dùng (có phân ca) và người dùng đổi giờ, hệ thống đóng bản
   * hiện tại bằng `effectiveTo` rồi tạo bản mới. Nhờ vậy tính lại công của ngày
   * trước đó vẫn ra đúng giờ ca cũ.
   */
  async updateShift(companyId: string, shiftId: string, dto: UpsertShiftDto) {
    const existing = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId, deletedAt: null },
      include: { segments: true },
    });
    if (!existing) {
      throw new AppException('POL_SHIFT_NOT_FOUND');
    }
    this.validateShiftTimes(dto);

    const changesTiming =
      (dto.startTime !== undefined && dto.startTime !== existing.startTime) ||
      (dto.endTime !== undefined && dto.endTime !== existing.endTime) ||
      (dto.breakMinutes !== undefined && dto.breakMinutes !== existing.breakMinutes);

    const usageCount = await this.prisma.shiftAssignment.count({ where: { shiftId } });

    if (changesTiming && usageCount > 0) {
      const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

      return this.prisma.$transaction(async (tx) => {
        await tx.shift.update({
          where: { id: shiftId },
          data: { effectiveTo: effectiveFrom },
        });
        return tx.shift.create({
          data: {
            companyId,
            name: dto.name ?? existing.name,
            type: dto.type ?? existing.type,
            startTime: dto.startTime ?? existing.startTime,
            endTime: dto.endTime ?? existing.endTime,
            crossesMidnight: dto.crossesMidnight ?? existing.crossesMidnight,
            breakMinutes: dto.breakMinutes ?? existing.breakMinutes,
            requiredMinutes: dto.requiredMinutes ?? existing.requiredMinutes,
            lateToleranceMinutes: dto.lateToleranceMinutes ?? existing.lateToleranceMinutes,
            earlyLeaveToleranceMinutes:
              dto.earlyLeaveToleranceMinutes ?? existing.earlyLeaveToleranceMinutes,
            isDefault: dto.isDefault ?? existing.isDefault,
            weekdayMask: dto.weekdayMask ?? existing.weekdayMask,
            effectiveFrom,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            segments: dto.segments
              ? { create: dto.segments.map((s) => ({ order: s.order, startTime: s.startTime, endTime: s.endTime })) }
              : {
                  create: existing.segments.map((s) => ({
                    order: s.order,
                    startTime: s.startTime,
                    endTime: s.endTime,
                  })),
                },
          },
          include: { segments: { orderBy: { order: 'asc' } } },
        });
      });
    }

    // Đổi thứ không ảnh hưởng số liệu quá khứ (tên, dung sai) → sửa tại chỗ.
    return this.prisma.$transaction(async (tx) => {
      if (dto.segments) {
        await tx.shiftSegment.deleteMany({ where: { shiftId } });
        await tx.shiftSegment.createMany({
          data: dto.segments.map((s) => ({
            shiftId,
            order: s.order,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        });
      }
      return tx.shift.update({
        where: { id: shiftId },
        data: {
          name: dto.name,
          type: dto.type,
          startTime: dto.startTime,
          endTime: dto.endTime,
          crossesMidnight: dto.crossesMidnight,
          breakMinutes: dto.breakMinutes,
          requiredMinutes: dto.requiredMinutes,
          lateToleranceMinutes: dto.lateToleranceMinutes,
          earlyLeaveToleranceMinutes: dto.earlyLeaveToleranceMinutes,
          isDefault: dto.isDefault,
          weekdayMask: dto.weekdayMask,
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        },
        include: { segments: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async deleteShift(companyId: string, shiftId: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, companyId } });
    if (!shift) {
      throw new AppException('POL_SHIFT_NOT_FOUND');
    }
    // D4: soft delete để bảng công quá khứ vẫn truy vết được ca.
    await this.prisma.shift.update({ where: { id: shiftId }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  /** FR-WEB-HR-04 — phân ca hàng loạt. */
  async bulkAssignShifts(companyId: string, dto: BulkShiftAssignmentDto, createdBy: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: dto.shiftId, companyId, deletedAt: null },
    });
    if (!shift) {
      throw new AppException('POL_SHIFT_NOT_FOUND');
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: dto.employeeIds }, companyId, deletedAt: null },
      select: { id: true },
    });
    const validIds = new Set(employees.map((e) => e.id));

    const dates = eachWorkDate(parseWorkDate(dto.from), parseWorkDate(dto.to)).filter(
      (date) => !dto.weekdays?.length || dto.weekdays.includes(weekdayOf(date)),
    );

    let assigned = 0;
    for (const employeeId of dto.employeeIds) {
      if (!validIds.has(employeeId)) continue;
      for (const workDate of dates) {
        await this.prisma.shiftAssignment.upsert({
          where: { employeeId_workDate: { employeeId, workDate } },
          create: { companyId, employeeId, shiftId: dto.shiftId, workDate, createdBy },
          update: { shiftId: dto.shiftId, createdBy },
        });
        assigned += 1;
      }
    }

    return {
      assigned,
      employeeCount: validIds.size,
      dayCount: dates.length,
      skippedEmployeeIds: dto.employeeIds.filter((id) => !validIds.has(id)),
    };
  }

  // ---------------------------------------------------------------------------
  // Ngày lễ (FR-WEB-POL-06)
  // ---------------------------------------------------------------------------

  async listHolidays(companyId: string, year?: number) {
    const where: Prisma.HolidayWhereInput = { companyId };
    if (year) {
      where.date = {
        gte: new Date(Date.UTC(year, 0, 1)),
        lte: new Date(Date.UTC(year, 11, 31)),
      };
    }
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  async upsertHoliday(companyId: string, dto: UpsertHolidayDto) {
    const date = parseWorkDate(dto.date);
    return this.prisma.holiday.upsert({
      where: { companyId_date: { companyId, date } },
      create: {
        companyId,
        name: dto.name,
        date,
        substituteDate: dto.substituteDate ? parseWorkDate(dto.substituteDate) : null,
        otMultiplier: dto.otMultiplier ?? 3.0,
        branchIds: dto.branchIds ?? [],
      },
      update: {
        name: dto.name,
        substituteDate: dto.substituteDate ? parseWorkDate(dto.substituteDate) : null,
        otMultiplier: dto.otMultiplier ?? undefined,
        branchIds: dto.branchIds ?? undefined,
      },
    });
  }

  async deleteHoliday(companyId: string, holidayId: string) {
    const holiday = await this.prisma.holiday.findFirst({ where: { id: holidayId, companyId } });
    if (!holiday) {
      throw new AppException('SYS_NOT_FOUND');
    }
    await this.prisma.holiday.delete({ where: { id: holidayId } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Chi nhánh & geofence (FR-WEB-INV-04, FR-WEB-POL-09)
  // ---------------------------------------------------------------------------

  async listBranches(companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async createBranch(companyId: string, dto: UpsertBranchDto) {
    await this.assertBranchQuota(companyId);
    return this.prisma.branch.create({
      data: {
        companyId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters ?? 100,
        wifiBssids: dto.wifiBssids ?? [],
        beaconUuids: dto.beaconUuids ?? [],
        timezone: dto.timezone,
      },
    });
  }

  async updateBranch(companyId: string, branchId: string, dto: UpsertBranchDto) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
    });
    if (!branch) {
      throw new AppException('POL_BRANCH_NOT_FOUND');
    }
    return this.prisma.branch.update({
      where: { id: branchId },
      data: {
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: dto.radiusMeters,
        wifiBssids: dto.wifiBssids,
        beaconUuids: dto.beaconUuids,
        timezone: dto.timezone,
      },
    });
  }

  /** FR-ADM-TEN-04 — giới hạn gói phải enforce ở Backend, không chỉ ẩn nút ở UI. */
  private async assertBranchQuota(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { plan: true },
    });
    const maxBranches = company?.plan?.maxBranches;
    if (!maxBranches) return;

    const current = await this.prisma.branch.count({ where: { companyId, deletedAt: null } });
    if (current >= maxBranches) {
      throw new AppException('PLAN_BRANCH_LIMIT_REACHED', { current, maxBranches });
    }
  }

  // ---------------------------------------------------------------------------
  // Phòng ban
  // ---------------------------------------------------------------------------

  async listDepartments(companyId: string) {
    return this.prisma.department.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
  }

  async createDepartment(companyId: string, dto: UpsertDepartmentDto) {
    return this.prisma.department.create({
      data: {
        companyId,
        name: dto.name,
        branchId: dto.branchId,
        parentId: dto.parentId,
        managerId: dto.managerId,
      },
    });
  }

  async updateDepartment(companyId: string, departmentId: string, dto: UpsertDepartmentDto) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId, deletedAt: null },
    });
    if (!department) {
      throw new AppException('POL_DEPARTMENT_NOT_FOUND');
    }
    return this.prisma.department.update({
      where: { id: departmentId },
      data: {
        name: dto.name,
        branchId: dto.branchId,
        parentId: dto.parentId,
        managerId: dto.managerId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  private validateShiftTimes(dto: UpsertShiftDto): void {
    this.policy.assertValidTime(dto.startTime);
    this.policy.assertValidTime(dto.endTime);
    for (const segment of dto.segments ?? []) {
      this.policy.assertValidTime(segment.startTime);
      this.policy.assertValidTime(segment.endTime);
    }
  }

  /** Ca đêm: giờ kết thúc ≤ giờ bắt đầu nghĩa là vắt qua nửa đêm. */
  private inferCrossesMidnight(dto: UpsertShiftDto): boolean {
    if (!dto.startTime || !dto.endTime) return false;
    return dto.endTime <= dto.startTime;
  }
}
