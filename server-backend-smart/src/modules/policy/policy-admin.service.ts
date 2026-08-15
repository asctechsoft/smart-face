import { Injectable } from '@nestjs/common';
import { ShiftType } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto/api-response.dto';
import { AppException } from 'src/common/errors';
import {
  buildMeta,
  eachWorkDate,
  formatWorkDate,
  parseWorkDate,
  timeToMinutes,
  weekdayOf,
} from 'src/common/utils';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import {
  BulkShiftAssignmentDto,
  ClearShiftAssignmentDto,
  CreateShiftScheduleDto,
  ShiftAssignmentQueryDto,
  ShiftScheduleMemberDto,
  ShiftScheduleQueryDto,
  UpdateShiftScheduleDto,
  UpsertBranchDto,
  UpsertDepartmentDto,
  UpsertHolidayDto,
  UpsertLeavePolicyDto,
  UpsertShiftDto,
} from './dto/policy.dto';
import { PolicyRepository, ShiftCatalogRow, ShiftScheduleRow } from './policy.repository';
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
    const shifts = await this.policies.listShifts(companyId);
    return shifts.map(toShiftCatalogDto);
  }

  async createShift(companyId: string, dto: UpsertShiftDto) {
    this.validateShiftTimes(dto);
    this.validateShiftCatalog(dto);
    await this.assertCodeAvailable(companyId, dto.code, null);

    const created = await this.transactions.run(async (tx) => {
      const shift = await this.policies.createShift(
        companyId,
        {
          name: dto.name,
          type: dto.type,
          startTime: dto.startTime,
          endTime: dto.endTime,
          crossesMidnight: dto.crossesMidnight ?? this.inferCrossesMidnight(dto),
          breakMinutes: resolveBreakMinutes(dto, 0),
          requiredMinutes: dto.requiredMinutes,
          lateToleranceMinutes: dto.lateToleranceMinutes ?? 0,
          earlyLeaveToleranceMinutes: dto.earlyLeaveToleranceMinutes ?? 0,
          isDefault: dto.isDefault ?? false,
          weekdayMask: dto.weekdayMask ?? 0,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          ...resolveCatalogFields(dto),
          segments: dto.segments?.map((s) => ({
            order: s.order,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        },
        tx,
      );

      if (dto.holidayFactors) {
        await this.policies.replaceShiftHolidayFactors(shift.id, dto.holidayFactors, tx);
      }
      return shift;
    });

    return toShiftCatalogDto(await this.reloadShift(companyId, created.id));
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
    this.validateShiftCatalog(dto);
    await this.assertCodeAvailable(companyId, dto.code, shiftId);

    const breakMinutes = resolveBreakMinutes(dto, existing.breakMinutes);

    const changesTiming =
      (dto.startTime !== undefined && dto.startTime !== existing.startTime) ||
      (dto.endTime !== undefined && dto.endTime !== existing.endTime) ||
      breakMinutes !== existing.breakMinutes;

    const usageCount = await this.policies.countShiftAssignments(companyId, shiftId);

    if (changesTiming && usageCount > 0) {
      return this.createSuccessorShift(companyId, shiftId, dto, existing);
    }

    // Đổi thứ không ảnh hưởng số liệu quá khứ (tên, dung sai) → sửa tại chỗ.
    const updatedId = await this.transactions.run(async (tx) => {
      if (dto.segments) {
        await this.policies.replaceShiftSegments(
          shiftId,
          dto.segments.map((s) => ({ order: s.order, startTime: s.startTime, endTime: s.endTime })),
          tx,
        );
      }
      if (dto.holidayFactors) {
        await this.policies.replaceShiftHolidayFactors(shiftId, dto.holidayFactors, tx);
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
          breakMinutes,
          requiredMinutes: dto.requiredMinutes,
          lateToleranceMinutes: dto.lateToleranceMinutes,
          earlyLeaveToleranceMinutes: dto.earlyLeaveToleranceMinutes,
          isDefault: dto.isDefault,
          weekdayMask: dto.weekdayMask,
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
          ...resolveCatalogFields(dto),
        },
        tx,
      );
      if (!updated) {
        throw new AppException('POL_SHIFT_NOT_FOUND');
      }
      return updated.id;
    });

    return toShiftCatalogDto(await this.reloadShift(companyId, updatedId));
  }

  /**
   * Đóng bản ca hiện tại và mở bản kế nhiệm — cả hai trong một transaction (D6).
   *
   * Bản kế nhiệm mang CÙNG mã ca. Chỉ ghi được nhờ ràng buộc duy nhất là partial
   * (`WHERE "effectiveTo" IS NULL`) và `closeShift` chạy TRƯỚC — bản cũ nhả mã
   * ra rồi bản mới mới nhận. Đảo thứ tự hai lệnh này là vi phạm ràng buộc.
   */
  private createSuccessorShift(
    companyId: string,
    shiftId: string,
    dto: UpsertShiftDto,
    existing: ShiftCatalogRow,
  ) {
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    return this.transactions
      .run(async (tx) => {
        await this.policies.closeShift(companyId, shiftId, effectiveFrom, tx);

        const successor = await this.policies.createShift(
          companyId,
          {
            name: dto.name ?? existing.name,
            type: dto.type ?? existing.type,
            startTime: dto.startTime ?? existing.startTime,
            endTime: dto.endTime ?? existing.endTime,
            crossesMidnight: dto.crossesMidnight ?? existing.crossesMidnight,
            breakMinutes: resolveBreakMinutes(dto, existing.breakMinutes),
            requiredMinutes: dto.requiredMinutes ?? existing.requiredMinutes,
            lateToleranceMinutes: dto.lateToleranceMinutes ?? existing.lateToleranceMinutes,
            earlyLeaveToleranceMinutes:
              dto.earlyLeaveToleranceMinutes ?? existing.earlyLeaveToleranceMinutes,
            isDefault: dto.isDefault ?? existing.isDefault,
            weekdayMask: dto.weekdayMask ?? existing.weekdayMask,
            effectiveFrom,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            ...resolveCatalogFields(dto),
            // Không khai lại phân đoạn thì bản kế nhiệm giữ nguyên ca gãy của bản cũ.
            segments: (dto.segments ?? existing.segments).map((s) => ({
              order: s.order,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          },
          tx,
        );

        // Không khai lại ngoại lệ ngày lễ thì bản kế nhiệm thừa kế của bản cũ —
        // cùng lý do với ca gãy: đổi giờ ca không có nghĩa là bỏ hết ngoại lệ.
        const inherited = (dto.holidayFactors ??
          existing.holidayFactors.map((row) => ({
            holidayId: row.holidayId,
            factor: Number(row.factor),
          }))) as { holidayId: string; factor: number }[];
        await this.policies.replaceShiftHolidayFactors(successor.id, inherited, tx);

        return successor.id;
      })
      .then(async (successorId) =>
        toShiftCatalogDto(await this.reloadShift(companyId, successorId)),
      );
  }

  /** Đọc lại sau khi ghi để bản trả về luôn kèm phân đoạn và ngoại lệ mới nhất. */
  private async reloadShift(companyId: string, shiftId: string): Promise<ShiftCatalogRow> {
    const shift = await this.policies.findShift(companyId, shiftId);
    if (!shift) throw new AppException('POL_SHIFT_NOT_FOUND');
    return shift;
  }

  private async assertCodeAvailable(
    companyId: string,
    code: string,
    selfId: string | null,
  ): Promise<void> {
    const holderId = await this.policies.findShiftIdByCode(companyId, code);
    if (holderId && holderId !== selfId) {
      throw new AppException('POL_SHIFT_CODE_TAKEN', { code });
    }
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

    const from = parseWorkDate(dto.from);
    const to = parseWorkDate(dto.to);

    // Xếp trong một bảng thì bảng quyết định phạm vi, không phải client.
    let memberIds: Set<string> | null = null;
    if (dto.scheduleId) {
      const schedule = await this.requireSchedule(companyId, dto.scheduleId);
      this.assertShiftInScope(schedule, dto.shiftId);
      this.assertRangeInPeriod(schedule, from, to);
      memberIds = new Set(await this.policies.findScheduleMemberIds(schedule.id));
    }

    const validIds = new Set(
      (await this.policies.findEmployeeIdsInCompany(companyId, dto.employeeIds)).filter(
        (id) => !memberIds || memberIds.has(id),
      ),
    );

    const dates = eachWorkDate(from, to).filter(
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
          scheduleId: dto.scheduleId ?? null,
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
  // Bảng phân ca (FR-WEB-HR-13)
  // ---------------------------------------------------------------------------

  async listShiftSchedules(
    companyId: string,
    query: ShiftScheduleQueryDto,
    departmentScope: string[] | null,
  ) {
    const { items, total } = await this.policies.listShiftSchedules(companyId, {
      month: query.month ? startOfMonth(parseWorkDate(query.month)) : undefined,
      departmentId: query.departmentId,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    // MANAGER chỉ thấy bảng có chạm tới phòng ban họ quản lý. Lọc sau khi phân
    // trang là chấp nhận được ở đây: số bảng mỗi tháng đếm trên đầu ngón tay,
    // khác hẳn danh sách nhân viên hay chấm công.
    const visible = departmentScope
      ? items.filter((row) => row.departmentIds.some((id) => departmentScope.includes(id)))
      : items;

    // PHẢI là instance của `PaginatedResult`, không phải object cùng hình dạng:
    // `TransformInterceptor` nhận diện bằng `instanceof` rồi mới tách `items` ra
    // `data` và `meta` ra gốc. Trả object thường thì cả cụm chui vào `data`, và
    // phía Web nhận được một object ở chỗ nó chờ một mảng.
    return new PaginatedResult(
      visible.map(toScheduleDto),
      buildMeta(query.page, query.pageSize, total),
    );
  }

  async getShiftSchedule(companyId: string, scheduleId: string) {
    const schedule = await this.requireSchedule(companyId, scheduleId);
    return toScheduleDto(schedule);
  }

  /**
   * Lập bảng phân ca — FR-WEB-HR-13.
   *
   * Kéo TOÀN BỘ nhân viên đang làm việc của các phòng ban đã chọn vào bảng, chưa
   * xếp ca gì. Danh sách người được chốt tại đây thay vì suy ra động từ phòng
   * ban, vì một lần chuyển phòng của nhân viên không được phép viết lại một bảng
   * đã xếp xong.
   */
  async createShiftSchedule(
    companyId: string,
    dto: CreateShiftScheduleDto,
    createdBy: string,
    departmentScope: string[] | null,
  ) {
    const periodMonth = startOfMonth(parseWorkDate(dto.periodMonth));

    await this.assertShiftsExist(companyId, dto.shiftIds);

    const employeeIds = await this.policies.findAssignableEmployeeIdsInDepartments(
      companyId,
      dto.departmentIds,
      departmentScope,
    );
    await this.assertMembersFree(periodMonth, employeeIds, undefined);

    const scheduleId = await this.transactions.run(async (tx) => {
      const created = await this.policies.createShiftSchedule(
        companyId,
        {
          name: dto.name?.trim() || defaultScheduleName(periodMonth),
          periodMonth,
          departmentIds: dto.departmentIds,
          shiftIds: dto.shiftIds,
          createdBy,
        },
        tx,
      );
      await this.policies.addScheduleMembers(created.id, periodMonth, employeeIds, tx);
      return created.id;
    });

    return toScheduleDto(await this.requireSchedule(companyId, scheduleId));
  }

  async updateShiftSchedule(companyId: string, scheduleId: string, dto: UpdateShiftScheduleDto) {
    await this.requireSchedule(companyId, scheduleId);
    if (dto.shiftIds) {
      await this.assertShiftsExist(companyId, dto.shiftIds);
    }

    const updated = await this.policies.updateShiftSchedule(companyId, scheduleId, {
      name: dto.name?.trim(),
      departmentIds: dto.departmentIds,
      shiftIds: dto.shiftIds,
    });
    if (updated === 0) {
      throw new AppException('POL_SCHEDULE_NOT_FOUND');
    }
    return toScheduleDto(await this.requireSchedule(companyId, scheduleId));
  }

  /**
   * Xoá bảng và TOÀN BỘ lịch ca do nó xếp.
   *
   * Ba việc phải đi cùng nhau trong một transaction, và thứ tự có ý nghĩa:
   * lịch ca trước (còn tra được `scheduleId`), rồi thành viên, rồi mới đóng bảng.
   *
   * Thành viên bị xoá HẲN chứ không xoá mềm — ràng buộc "một người một tháng
   * một bảng" không lọc `deletedAt`, giữ lại dòng thành viên nghĩa là những
   * người đó vĩnh viễn không lập được bảng mới cho tháng đó.
   */
  async deleteShiftSchedule(companyId: string, scheduleId: string) {
    const schedule = await this.requireSchedule(companyId, scheduleId);

    // BR-07: lịch ca của tháng đã chốt lương là dữ liệu đã dùng để trả tiền.
    const closed = await this.policies.findClosedPeriodOverlapping(
      companyId,
      schedule.periodMonth,
      endOfMonth(schedule.periodMonth),
    );
    if (closed) {
      throw new AppException('PAY_PERIOD_CLOSED', { period: closed.name });
    }

    return this.transactions.run(async (tx) => {
      const removedAssignments = await this.policies.deleteAssignmentsOfSchedule(
        companyId,
        scheduleId,
        undefined,
        tx,
      );
      const removedMembers = await this.policies.deleteScheduleMembers(scheduleId, undefined, tx);
      await this.policies.softDeleteShiftSchedule(companyId, scheduleId, tx);

      return { deleted: true, removedAssignments, removedMembers };
    });
  }

  async addScheduleMembers(
    companyId: string,
    scheduleId: string,
    dto: ShiftScheduleMemberDto,
    departmentScope: string[] | null,
  ) {
    const schedule = await this.requireSchedule(companyId, scheduleId);

    const validIds = await this.policies.findEmployeeIdsInCompany(
      companyId,
      dto.employeeIds,
      departmentScope,
    );

    await this.assertMembersFree(schedule.periodMonth, validIds, scheduleId);
    const added = await this.policies.addScheduleMembers(
      scheduleId,
      schedule.periodMonth,
      validIds,
    );
    return { added, skipped: dto.employeeIds.length - validIds.length };
  }

  /**
   * Bỏ CBNV khỏi bảng — kèm xoá lịch ca của họ TRONG bảng này.
   *
   * Không xoá lịch thì người đã bị bỏ ra vẫn giữ nguyên ca đã xếp, và bảng công
   * cuối tháng vẫn tính theo ca đó dù họ không còn nằm trong bảng nào.
   */
  async removeScheduleMembers(companyId: string, scheduleId: string, dto: ShiftScheduleMemberDto) {
    await this.requireSchedule(companyId, scheduleId);

    return this.transactions.run(async (tx) => {
      const removedAssignments = await this.policies.deleteAssignmentsOfSchedule(
        companyId,
        scheduleId,
        dto.employeeIds,
        tx,
      );
      const removed = await this.policies.deleteScheduleMembers(scheduleId, dto.employeeIds, tx);
      return { removed, removedAssignments };
    });
  }

  private async requireSchedule(companyId: string, scheduleId: string) {
    const schedule = await this.policies.findShiftSchedule(companyId, scheduleId);
    if (!schedule) {
      throw new AppException('POL_SCHEDULE_NOT_FOUND');
    }
    return schedule;
  }

  private assertShiftInScope(schedule: ShiftScheduleRow, shiftId: string): void {
    if (!schedule.shiftIds.includes(shiftId)) {
      throw new AppException('POL_SCHEDULE_OUT_OF_SCOPE', { shiftId });
    }
  }

  private assertRangeInPeriod(schedule: ShiftScheduleRow, from: Date, to: Date): void {
    const start = schedule.periodMonth;
    const end = endOfMonth(start);
    if (from < start || to > end) {
      throw new AppException('POL_SCHEDULE_OUT_OF_PERIOD', {
        period: formatWorkDate(start).slice(0, 7),
        from: formatWorkDate(from),
        to: formatWorkDate(to),
      });
    }
  }

  private async assertShiftsExist(companyId: string, shiftIds: string[]): Promise<void> {
    for (const shiftId of shiftIds) {
      const shift = await this.policies.findShift(companyId, shiftId);
      if (!shift) {
        throw new AppException('POL_SHIFT_NOT_FOUND', { shiftId });
      }
    }
  }

  /**
   * Kiểm tra trước để báo lỗi có TÊN NGƯỜI thay vì ném lại lỗi ràng buộc thô của
   * Postgres. Ràng buộc trong database vẫn là chốt cuối — hai request lập bảng
   * chạy song song đều thấy "chưa ai giữ" rồi cùng ghi.
   */
  private async assertMembersFree(
    periodMonth: Date,
    employeeIds: string[],
    excludeScheduleId?: string,
  ): Promise<void> {
    const taken = await this.policies.findMembersTakenInMonth(
      periodMonth,
      employeeIds,
      excludeScheduleId,
    );
    if (taken.length > 0) {
      throw new AppException('POL_SCHEDULE_EMPLOYEE_TAKEN', {
        employees: taken.slice(0, 10).map((row) => `${row.fullName} (${row.scheduleName})`),
        total: taken.length,
      });
    }
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

    // Xem bảng chi tiết của một bảng phân ca: DÒNG là thành viên đã chốt của
    // bảng, không phải "ai đang thuộc phòng ban này". Hai thứ đó lệch nhau ngay
    // khi có người chuyển phòng giữa tháng.
    let memberIds: string[] | undefined;
    if (query.scheduleId) {
      const schedule = await this.requireSchedule(companyId, query.scheduleId);
      this.assertRangeInPeriod(schedule, from, to);
      memberIds = await this.policies.findScheduleMemberIds(schedule.id);
    }

    const { items: employees, total } = await this.policies.searchAssignableEmployees(companyId, {
      departmentId: query.departmentId,
      departmentScope,
      memberIds,
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

  /**
   * Luật của phần danh mục — những thứ decorator trên DTO không nói được vì
   * chúng là quan hệ giữa nhiều trường.
   */
  private validateShiftCatalog(dto: UpsertShiftDto): void {
    for (const time of [
      dto.checkInFrom,
      dto.checkInTo,
      dto.checkOutFrom,
      dto.checkOutTo,
      dto.breakStart,
      dto.breakEnd,
    ]) {
      this.policy.assertValidTime(time);
    }

    // BR-ATT-02. Từ chối thẳng thay vì âm thầm ghi đè thành `true`: người dùng
    // vừa cố tình tắt nó, im lặng sửa lại sau lưng họ thì lần sau họ vẫn tưởng
    // đã tắt được.
    if (dto.requireCheckIn === false) {
      throw new AppException('POL_SHIFT_CHECKIN_REQUIRED');
    }

    assertWindow(dto.checkInFrom, dto.checkInTo);
    assertWindow(dto.checkOutFrom, dto.checkOutTo);
    assertWindow(dto.breakStart, dto.breakEnd);
    assertBreakInsideShift(dto);
  }

  /** Ca đêm: giờ kết thúc ≤ giờ bắt đầu nghĩa là vắt qua nửa đêm. */
  private inferCrossesMidnight(dto: UpsertShiftDto): boolean {
    if (!dto.startTime || !dto.endTime) return false;
    return dto.endTime <= dto.startTime;
  }
}

// =============================================================================
//  Danh mục ca — hàm thuần, không chạm database
// =============================================================================

/**
 * Số phút giữa hai mốc "HH:mm", tự hiểu trường hợp vắt qua nửa đêm.
 *
 * Dấu của hiệu số đã nói đủ: 22:00 → 06:00 ra âm, cộng một ngày là xong. Cố ý
 * KHÔNG dùng cờ `crossesMidnight` ở đây — cờ đó trả lời "ca thuộc ngày nào",
 * còn độ dài ca thì không cần hỏi ai. Đọc thêm cờ vào đây chỉ tạo thêm một cách
 * để một ca 9 tiếng bị tính thành 33 tiếng khi người dùng tích nhầm.
 */
function spanMinutes(from: string, to: string): number {
  const diff = timeToMinutes(to) - timeToMinutes(from);
  return diff > 0 ? diff : diff + 24 * 60;
}

function assertWindow(from?: string, to?: string): void {
  if (!from || !to) return;
  // Khung rỗng không từ chối được gì mà cũng không chấp nhận được gì.
  if (from === to) {
    throw new AppException('POL_SHIFT_INVALID_WINDOW', { from, to });
  }
}

/**
 * Khoảng nghỉ phải nằm TRONG ca.
 *
 * Bắt đúng lỗi hay gặp nhất: khai ca đêm 22:00–06:00 rồi để nguyên khoảng nghỉ
 * trưa 12:00–13:00 của mẫu cũ. Không kiểm thì `breakMinutes` vẫn ra 60 và ca đêm
 * âm thầm bị trừ một tiếng không có thật.
 */
function assertBreakInsideShift(dto: UpsertShiftDto): void {
  if (!dto.breakStart || !dto.breakEnd || !dto.startTime || !dto.endTime) return;

  const shiftLength = spanMinutes(dto.startTime, dto.endTime);
  const offsetOf = (time: string) => {
    const diff = timeToMinutes(time) - timeToMinutes(dto.startTime as string);
    return diff >= 0 ? diff : diff + 24 * 60;
  };

  const startOffset = offsetOf(dto.breakStart);
  const endOffset = offsetOf(dto.breakEnd);

  if (startOffset >= endOffset || endOffset > shiftLength) {
    throw new AppException('POL_SHIFT_INVALID_WINDOW', {
      breakStart: dto.breakStart,
      breakEnd: dto.breakEnd,
      shift: `${dto.startTime}–${dto.endTime}`,
    });
  }
}

/**
 * `breakMinutes` mà máy tính công sẽ đọc.
 *
 * Khai khoảng nghỉ cụ thể thì con số tính từ đó và GHI ĐÈ `breakMinutes` client
 * gửi lên. Hai trường cùng mô tả một việc thì phải có một cái làm chủ, nếu không
 * sẽ có ca khai nghỉ 12:00–13:00 mà bảng công trừ 30 phút.
 */
function resolveBreakMinutes(dto: UpsertShiftDto, fallback: number): number {
  if (dto.breakStart && dto.breakEnd) {
    return spanMinutes(dto.breakStart, dto.breakEnd);
  }
  return dto.breakMinutes ?? fallback;
}

function resolveCatalogFields(dto: UpsertShiftDto) {
  return {
    code: dto.code,
    symbol: dto.symbol ?? null,
    departmentIds: dto.departmentIds ?? [],
    // Đã qua `validateShiftCatalog` nên chỉ còn `true` hoặc không khai.
    requireCheckIn: true,
    checkInFrom: dto.checkInFrom ?? null,
    checkInTo: dto.checkInTo ?? null,
    requireCheckOut: dto.requireCheckOut ?? true,
    checkOutFrom: dto.checkOutFrom ?? null,
    checkOutTo: dto.checkOutTo ?? null,
    breakStart: dto.breakStart ?? null,
    breakEnd: dto.breakEnd ?? null,
    workDayCredit: dto.workDayCredit ?? 1,
    normalDayFactor: dto.normalDayFactor ?? 1,
    weeklyRestFactor: dto.weeklyRestFactor ?? 2,
    holidayFactor: dto.holidayFactor ?? 3,
  };
}

/**
 * Số phút công của một ca — TÍNH RA, không lưu.
 *
 * Lưu thêm một bản sao vào database là tạo cơ hội cho nó lệch khỏi giờ ca: sửa
 * giờ mà quên tính lại thì bảng danh mục hiển thị một đằng, máy tính công hiểu
 * một nẻo, và không ai biết bên nào đúng.
 */
export function computeShiftWorkMinutes(shift: {
  type: ShiftType;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  requiredMinutes: number | null;
  segments: { startTime: string; endTime: string }[];
}): number {
  if (shift.type === ShiftType.FLEXIBLE) {
    return shift.requiredMinutes ?? 0;
  }

  // Ca gãy: các đoạn đã loại giờ nghỉ ra khỏi ca rồi, trừ `breakMinutes` lần nữa
  // là trừ hai lần cùng một khoảng.
  if (shift.segments.length > 0) {
    return shift.segments.reduce((sum, s) => sum + spanMinutes(s.startTime, s.endTime), 0);
  }

  if (!shift.startTime || !shift.endTime) return 0;
  return Math.max(0, spanMinutes(shift.startTime, shift.endTime) - shift.breakMinutes);
}

/**
 * Chuẩn hoá một dòng danh mục trước khi ra khỏi API.
 *
 * `Prisma.Decimal` serialize thành CHUỖI trong JSON. Để nguyên thì phía Web nhận
 * `"1.00"` và mọi phép tính trên nó ra `NaN` — đúng lỗi đã xảy ra ở bảng lương.
 */
/** Ngày 01 của tháng chứa `date`, theo UTC — `workDate` trong hệ thống là ngày trần. */
function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Ngày cuối cùng của tháng chứa `date`. `day 0` của tháng sau = ngày cuối tháng này. */
function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** "Bảng phân ca Tháng 08/2026" — mặc định khi người dùng không đặt tên riêng. */
function defaultScheduleName(periodMonth: Date): string {
  const month = String(periodMonth.getUTCMonth() + 1).padStart(2, '0');
  return `Bảng phân ca Tháng ${month}/${periodMonth.getUTCFullYear()}`;
}

/**
 * Bảng phân ca ra khỏi API.
 *
 * `periodMonth` trả về dạng `YYYY-MM-DD` chứ không phải ISO datetime: nó là
 * ngày trần theo lịch công ty, và client ở múi giờ âm sẽ hiển thị lùi một ngày —
 * đủ để tháng 8 hiện thành tháng 7.
 */
function toScheduleDto(schedule: ShiftScheduleRow) {
  return {
    id: schedule.id,
    name: schedule.name,
    periodMonth: formatWorkDate(schedule.periodMonth),
    departmentIds: schedule.departmentIds,
    shiftIds: schedule.shiftIds,
    memberCount: schedule._count.members,
    assignmentCount: schedule._count.assignments,
    createdBy: schedule.createdBy,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

function toShiftCatalogDto(shift: ShiftCatalogRow) {
  return {
    ...shift,
    workDayCredit: Number(shift.workDayCredit),
    normalDayFactor: Number(shift.normalDayFactor),
    weeklyRestFactor: Number(shift.weeklyRestFactor),
    holidayFactor: Number(shift.holidayFactor),
    holidayFactors: shift.holidayFactors.map((row) => ({
      holidayId: row.holidayId,
      factor: Number(row.factor),
    })),
    workMinutes: computeShiftWorkMinutes(shift),
  };
}
