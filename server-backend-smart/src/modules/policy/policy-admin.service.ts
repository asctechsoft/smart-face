import { Injectable } from '@nestjs/common';
import { AppException } from 'src/common/errors';
import {
  buildMeta,
  eachWorkDate,
  formatWorkDate,
  parseWorkDate,
  weekdayOf,
} from 'src/common/utils';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import {
  BulkShiftAssignmentDto,
  ClearShiftAssignmentDto,
  ShiftAssignmentQueryDto,
  UpsertBranchDto,
  UpsertDepartmentDto,
  UpsertHolidayDto,
  UpsertLeavePolicyDto,
  UpsertShiftDto,
} from './dto/policy.dto';
import { PolicyRepository, ShiftWithSegments } from './policy.repository';
import { PolicyService } from './policy.service';

/** Trần khoảng ngày của bảng phân ca — hai tháng là đủ cho mọi thao tác xếp lịch thật. */
const MAX_BOARD_DAYS = 62;

/** NFR-LEGAL-07 — Điều 113 Bộ luật Lao động 2019, điều kiện làm việc bình thường. */
const STATUTORY_MIN_LEAVE_DAYS = 12;

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

  /**
   * Bảng phân ca của một khoảng ngày — FR-WEB-HR-03.
   *
   * Trả về đồng thời DÒNG (nhân viên trong phạm vi) và Ô (bản ghi phân ca) trong
   * một lượt gọi. Tách thành hai endpoint thì giao diện phải tự ghép, và trong
   * khoảnh khắc chỉ một trong hai về tới nơi thì lịch hiện ra trống trơn — người
   * dùng đọc thành "cả phòng chưa được xếp ca" và bắt đầu xếp đè lên lịch cũ.
   *
   * Nhân viên được phân trang, ngày thì không: 25 người × 31 ngày là kích thước
   * đọc được trên một màn hình, còn số ngày do người dùng chọn và bị chặn trần
   * ở `MAX_BOARD_DAYS`.
   */
  async getShiftBoard(
    companyId: string,
    query: ShiftAssignmentQueryDto,
    departmentScope: string[] | null,
  ) {
    const from = parseWorkDate(query.from);
    const to = parseWorkDate(query.to);

    if (to < from) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Ngày kết thúc trước ngày bắt đầu.',
      });
    }
    const dayCount = eachWorkDate(from, to).length;
    if (dayCount > MAX_BOARD_DAYS) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: `Khoảng ngày tối đa ${MAX_BOARD_DAYS} ngày, đang xin ${dayCount} ngày.`,
      });
    }

    const { items: employees, total } = await this.policies.searchAssignableEmployees(companyId, {
      departmentId: query.departmentId,
      departmentScope,
      q: query.q,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    const assignments = await this.policies.findShiftAssignments(
      companyId,
      employees.map((employee) => employee.id),
      from,
      to,
    );

    const holidays = await this.policies.listHolidays(companyId);

    return {
      from: query.from,
      to: query.to,
      employees,
      assignments: assignments.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        shiftId: row.shiftId,
        // Trả chuỗi `YYYY-MM-DD` chứ không phải ISO datetime: `workDate` là ngày
        // làm việc theo lịch công ty, không có giờ. Để nguyên `Date` thì client
        // ở múi giờ âm sẽ hiển thị lệch một ngày.
        workDate: formatWorkDate(row.workDate),
      })),
      // Ngày lễ hiển thị mờ trên lịch để người xếp ca không xếp nhầm vào ngày nghỉ.
      holidays: holidays
        .filter((holiday) => {
          const date = holiday.substituteDate ?? holiday.date;
          return date >= from && date <= to;
        })
        .map((holiday) => ({
          name: holiday.name,
          date: formatWorkDate(holiday.substituteDate ?? holiday.date),
        })),
      meta: buildMeta(query.page, query.pageSize, total),
    };
  }

  /** Dọn lịch một khoảng ngày trước khi xếp lại (FR-WEB-HR-04). */
  async clearShiftAssignments(companyId: string, dto: ClearShiftAssignmentDto) {
    const validIds = await this.policies.findEmployeeIdsInCompany(companyId, dto.employeeIds);
    if (validIds.length === 0) {
      return { deleted: 0, employeeCount: 0 };
    }

    const deleted = await this.policies.deleteShiftAssignments(
      companyId,
      validIds,
      parseWorkDate(dto.from),
      parseWorkDate(dto.to),
    );
    return { deleted, employeeCount: validIds.length };
  }

  // ---------------------------------------------------------------------------
  // Chính sách phép năm (FR-WEB-POL-07, FR-WEB-POL-08)
  // ---------------------------------------------------------------------------

  async listLeavePolicies(companyId: string) {
    const policies = await this.policies.listLeavePolicies(companyId);
    return policies.map((policy) => ({
      ...policy,
      baseDaysPerYear: policy.baseDaysPerYear.toNumber(),
      seniorityBonusDays: policy.seniorityBonusDays.toNumber(),
      maxCarryOverDays: policy.maxCarryOverDays?.toNumber() ?? null,
      /** Bản đang áp dụng là bản chưa bị đóng — giao diện dùng để làm nổi bật. */
      isCurrent: policy.effectiveTo === null,
    }));
  }

  /**
   * Tạo phiên bản mới của chính sách phép — D6, KHÔNG ghi đè.
   *
   * Sửa đè bản cũ nghĩa là "công ty đã luôn cho 15 ngày phép", và số phép đã cấp
   * hồi tháng 1 theo mức 12 ngày trở thành không giải thích được. Vì vậy mỗi lần
   * lưu là đóng bản đang mở rồi mở bản mới.
   */
  async upsertLeavePolicy(companyId: string, dto: UpsertLeavePolicyDto) {
    // NFR-LEGAL-07 — Điều 113 Bộ luật Lao động 2019. Chặn ở Backend chứ không chỉ
    // cảnh báo ở giao diện: đây là ngưỡng pháp lý, không phải gợi ý.
    if (dto.baseDaysPerYear < STATUTORY_MIN_LEAVE_DAYS) {
      throw new AppException('POL_LEAVE_BELOW_STATUTORY', {
        provided: dto.baseDaysPerYear,
        minimum: STATUTORY_MIN_LEAVE_DAYS,
      });
    }

    const contractType = dto.contractType ?? null;
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    return this.transactions.run(async (tx) => {
      await this.policies.closeOpenLeavePolicy(companyId, contractType, effectiveFrom, tx);

      return this.policies.createLeavePolicy(
        companyId,
        {
          contractType,
          baseDaysPerYear: dto.baseDaysPerYear,
          seniorityBonusDays: dto.seniorityBonusDays ?? 0,
          seniorityEveryYears: dto.seniorityEveryYears ?? 5,
          allowCarryOver: dto.allowCarryOver ?? false,
          maxCarryOverDays: dto.maxCarryOverDays ?? null,
          // Cho cộng dồn mà không đặt hạn dùng thì phép tích luỹ vô hạn và thành
          // một khoản nợ tiền mặt khi nhân viên nghỉ việc — mặc định hết Q1.
          carryOverExpireMonth: dto.allowCarryOver ? (dto.carryOverExpireMonth ?? 3) : null,
          accrualMode: dto.accrualMode ?? 'YEARLY',
          effectiveFrom,
        },
        tx,
      );
    });
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
