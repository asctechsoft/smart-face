import { Injectable } from '@nestjs/common';
import { AppException } from 'src/common/errors';
import { eachWorkDate, parseWorkDate, weekdayOf } from 'src/common/utils';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import {
  BulkShiftAssignmentDto,
  UpsertBranchDto,
  UpsertDepartmentDto,
  UpsertHolidayDto,
  UpsertShiftDto,
} from './dto/policy.dto';
import { PolicyRepository, ShiftWithSegments } from './policy.repository';
import { PolicyService } from './policy.service';

/**
 * CRUD chính sách cho Web Quản lý (FR-WEB-POL, FR-WEB-INV-04).
 * Mọi phương thức BẮT BUỘC nhận `companyId` — không có default (BR-09).
 */
@Injectable()
export class PolicyAdminService {
  constructor(
    private readonly policies: PolicyRepository,
    private readonly transactions: TransactionManager,
    private readonly policy: PolicyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Ca làm việc (FR-WEB-POL-01..03)
  // ---------------------------------------------------------------------------

  async listShifts(companyId: string) {
    return this.policies.listShifts(companyId);
  }

  async createShift(companyId: string, dto: UpsertShiftDto) {
    this.validateShiftTimes(dto);

    return this.policies.createShift(companyId, {
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
      segments: dto.segments?.map((s) => ({
        order: s.order,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
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
    const existing = await this.policies.findShift(companyId, shiftId);
    if (!existing) {
      throw new AppException('POL_SHIFT_NOT_FOUND');
    }
    this.validateShiftTimes(dto);

    const changesTiming =
      (dto.startTime !== undefined && dto.startTime !== existing.startTime) ||
      (dto.endTime !== undefined && dto.endTime !== existing.endTime) ||
      (dto.breakMinutes !== undefined && dto.breakMinutes !== existing.breakMinutes);

    const usageCount = await this.policies.countShiftAssignments(companyId, shiftId);

    if (changesTiming && usageCount > 0) {
      return this.createSuccessorShift(companyId, shiftId, dto, existing);
    }

    // Đổi thứ không ảnh hưởng số liệu quá khứ (tên, dung sai) → sửa tại chỗ.
    return this.transactions.run(async (tx) => {
      if (dto.segments) {
        await this.policies.replaceShiftSegments(
          shiftId,
          dto.segments.map((s) => ({ order: s.order, startTime: s.startTime, endTime: s.endTime })),
          tx,
        );
      }

      const updated = await this.policies.updateShift(
        companyId,
        shiftId,
        {
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
        tx,
      );
      if (!updated) {
        throw new AppException('POL_SHIFT_NOT_FOUND');
      }
      return updated;
    });
  }

  /** Đóng bản ca hiện tại và mở bản kế nhiệm — cả hai trong một transaction (D6). */
  private createSuccessorShift(
    companyId: string,
    shiftId: string,
    dto: UpsertShiftDto,
    existing: ShiftWithSegments,
  ) {
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    return this.transactions.run(async (tx) => {
      await this.policies.closeShift(companyId, shiftId, effectiveFrom, tx);

      return this.policies.createShift(
        companyId,
        {
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
          // Không khai lại phân đoạn thì bản kế nhiệm giữ nguyên ca gãy của bản cũ.
          segments: (dto.segments ?? existing.segments).map((s) => ({
            order: s.order,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        },
        tx,
      );
    });
  }

  async deleteShift(companyId: string, shiftId: string) {
    // D4: soft delete để bảng công quá khứ vẫn truy vết được ca.
    const deleted = await this.policies.softDeleteShift(companyId, shiftId);
    if (deleted === 0) {
      throw new AppException('POL_SHIFT_NOT_FOUND');
    }
    return { deleted: true };
  }

  /** FR-WEB-HR-04 — phân ca hàng loạt. */
  async bulkAssignShifts(companyId: string, dto: BulkShiftAssignmentDto, createdBy: string) {
    const shift = await this.policies.findShift(companyId, dto.shiftId);
    if (!shift) {
      throw new AppException('POL_SHIFT_NOT_FOUND');
    }

    const validIds = new Set(
      await this.policies.findEmployeeIdsInCompany(companyId, dto.employeeIds),
    );

    const dates = eachWorkDate(parseWorkDate(dto.from), parseWorkDate(dto.to)).filter(
      (date) => !dto.weekdays?.length || dto.weekdays.includes(weekdayOf(date)),
    );

    let assigned = 0;
    for (const employeeId of dto.employeeIds) {
      if (!validIds.has(employeeId)) continue;
      for (const workDate of dates) {
        await this.policies.upsertShiftAssignment(companyId, {
          employeeId,
          shiftId: dto.shiftId,
          workDate,
          createdBy,
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
    return this.policies.listHolidays(companyId, year);
  }

  async upsertHoliday(companyId: string, dto: UpsertHolidayDto) {
    return this.policies.upsertHoliday(companyId, {
      name: dto.name,
      date: parseWorkDate(dto.date),
      substituteDate: dto.substituteDate ? parseWorkDate(dto.substituteDate) : null,
      otMultiplier: dto.otMultiplier,
      branchIds: dto.branchIds,
    });
  }

  async deleteHoliday(companyId: string, holidayId: string) {
    const deleted = await this.policies.deleteHoliday(companyId, holidayId);
    if (deleted === 0) {
      throw new AppException('SYS_NOT_FOUND');
    }
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Chi nhánh & geofence (FR-WEB-INV-04, FR-WEB-POL-09)
  // ---------------------------------------------------------------------------

  async listBranches(companyId: string) {
    return this.policies.listBranches(companyId);
  }

  async createBranch(companyId: string, dto: UpsertBranchDto) {
    await this.assertBranchQuota(companyId);
    return this.policies.createBranch(companyId, {
      name: dto.name,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusMeters: dto.radiusMeters,
      wifiBssids: dto.wifiBssids,
      beaconUuids: dto.beaconUuids,
      timezone: dto.timezone,
    });
  }

  async updateBranch(companyId: string, branchId: string, dto: UpsertBranchDto) {
    const updated = await this.policies.updateBranch(companyId, branchId, {
      name: dto.name,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusMeters: dto.radiusMeters,
      wifiBssids: dto.wifiBssids,
      beaconUuids: dto.beaconUuids,
      timezone: dto.timezone,
    });
    if (!updated) {
      throw new AppException('POL_BRANCH_NOT_FOUND');
    }
    return updated;
  }

  /** FR-ADM-TEN-04 — giới hạn gói phải enforce ở Backend, không chỉ ẩn nút ở UI. */
  private async assertBranchQuota(companyId: string): Promise<void> {
    const plan = await this.policies.findPlanLimits(companyId);
    const maxBranches = plan?.maxBranches;
    if (!maxBranches) return;

    const current = await this.policies.countBranches(companyId);
    if (current >= maxBranches) {
      throw new AppException('PLAN_BRANCH_LIMIT_REACHED', { current, maxBranches });
    }
  }

  // ---------------------------------------------------------------------------
  // Phòng ban
  // ---------------------------------------------------------------------------

  async listDepartments(companyId: string) {
    return this.policies.listDepartments(companyId);
  }

  async createDepartment(companyId: string, dto: UpsertDepartmentDto) {
    return this.policies.createDepartment(companyId, {
      name: dto.name,
      branchId: dto.branchId,
      parentId: dto.parentId,
      managerId: dto.managerId,
    });
  }

  async updateDepartment(companyId: string, departmentId: string, dto: UpsertDepartmentDto) {
    const updated = await this.policies.updateDepartment(companyId, departmentId, {
      name: dto.name,
      branchId: dto.branchId,
      parentId: dto.parentId,
      managerId: dto.managerId,
    });
    if (!updated) {
      throw new AppException('POL_DEPARTMENT_NOT_FOUND');
    }
    return updated;
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
