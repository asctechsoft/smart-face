import { Injectable, Logger } from '@nestjs/common';
import { Company, Prisma, Shift } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { DEFAULT_TIMEZONE, isValidTimeOfDay, weekdayMaskOf } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import {
  LABOR_LAW_MINIMUMS,
  POLICY_DEFAULTS,
  PolicyKey,
  PolicyKeys,
} from './policy.constants';

const POLICY_CACHE_TTL_SECONDS = 300;

/**
 * Nguồn duy nhất để đọc chính sách công ty (BR-12).
 *
 * Thứ tự ưu tiên: CompanyPolicy còn hiệu lực (D6) → POLICY_DEFAULTS.
 * Kết quả cache Redis 5 phút; mọi thao tác ghi chính sách đều gọi `invalidate()`.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  /** Toàn bộ chính sách đang hiệu lực của công ty, đã trộn với giá trị mặc định. */
  async resolveAll(companyId: string, at: Date = new Date()): Promise<Record<string, unknown>> {
    return this.redis.remember(RedisKeys.policy(companyId), POLICY_CACHE_TTL_SECONDS, async () => {
      const rows = await this.prisma.companyPolicy.findMany({
        where: {
          companyId,
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        },
        orderBy: { effectiveFrom: 'asc' },
      });

      const resolved: Record<string, unknown> = { ...POLICY_DEFAULTS };
      // effectiveFrom tăng dần → bản ghi mới nhất còn hiệu lực ghi đè bản cũ.
      for (const row of rows) {
        resolved[row.key] = row.value;
      }
      return resolved;
    });
  }

  /** Đọc một khoá chính sách, ép kiểu theo giá trị mặc định. */
  async get<T>(companyId: string, key: PolicyKey, at?: Date): Promise<T> {
    const all = await this.resolveAll(companyId, at);
    return (all[key] ?? POLICY_DEFAULTS[key]) as T;
  }

  async getNumber(companyId: string, key: PolicyKey, at?: Date): Promise<number> {
    const value = await this.get<unknown>(companyId, key, at);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number(POLICY_DEFAULTS[key]);
  }

  async getBoolean(companyId: string, key: PolicyKey, at?: Date): Promise<boolean> {
    const value = await this.get<unknown>(companyId, key, at);
    return value === true || value === 'true';
  }

  // ---------------------------------------------------------------------------
  // Ghi
  // ---------------------------------------------------------------------------

  /**
   * Cập nhật chính sách. D6: KHÔNG ghi đè bản ghi cũ — đóng bản cũ bằng
   * `effectiveTo` và tạo bản mới, để dữ liệu quá khứ tính lại vẫn ra đúng số.
   */
  async set(
    companyId: string,
    key: PolicyKey,
    value: Prisma.InputJsonValue,
    updatedBy: string,
    effectiveFrom: Date = new Date(),
  ): Promise<void> {
    this.assertLegalCompliance(key, value);

    await this.prisma.$transaction(async (tx) => {
      await tx.companyPolicy.updateMany({
        where: { companyId, key, effectiveTo: null },
        data: { effectiveTo: effectiveFrom },
      });
      await tx.companyPolicy.create({
        data: { companyId, key, value, effectiveFrom, updatedBy },
      });
    });

    await this.invalidate(companyId);
  }

  async setMany(
    companyId: string,
    entries: Record<string, Prisma.InputJsonValue>,
    updatedBy: string,
    effectiveFrom: Date = new Date(),
  ): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.assertLegalCompliance(key as PolicyKey, value);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(entries)) {
        await tx.companyPolicy.updateMany({
          where: { companyId, key, effectiveTo: null },
          data: { effectiveTo: effectiveFrom },
        });
        await tx.companyPolicy.create({
          data: { companyId, key, value, effectiveFrom, updatedBy },
        });
      }
    });

    await this.invalidate(companyId);
  }

  async invalidate(companyId: string): Promise<void> {
    await this.redis.del(RedisKeys.policy(companyId));
    await this.redis.invalidatePrefix(RedisKeys.dashboardPrefix(companyId));
  }

  /**
   * NFR-LEGAL-05/07: chặn cấu hình thấp hơn mức tối thiểu luật định.
   * Đây là giá trị gia tăng thật cho khách hàng, không chỉ là ràng buộc kỹ thuật.
   */
  private assertLegalCompliance(key: PolicyKey, value: unknown): void {
    const checks: Partial<Record<PolicyKey, { min: number; label: string }>> = {
      [PolicyKeys.PAYROLL_OT_MULTIPLIER_NORMAL]: {
        min: LABOR_LAW_MINIMUMS.otMultiplierNormal,
        label: 'Hệ số OT ngày thường',
      },
      [PolicyKeys.PAYROLL_OT_MULTIPLIER_WEEKEND]: {
        min: LABOR_LAW_MINIMUMS.otMultiplierWeekend,
        label: 'Hệ số OT ngày nghỉ hằng tuần',
      },
      [PolicyKeys.PAYROLL_OT_MULTIPLIER_HOLIDAY]: {
        min: LABOR_LAW_MINIMUMS.otMultiplierHoliday,
        label: 'Hệ số OT ngày lễ',
      },
    };

    const rule = checks[key];
    if (!rule) return;

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric < rule.min) {
      throw new AppException('POL_VIOLATES_LABOR_LAW', {
        key,
        provided: numeric,
        minimumRequired: rule.min,
        label: rule.label,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Công ty & timezone
  // ---------------------------------------------------------------------------

  async getCompany(companyId: string): Promise<Company> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!company) {
      throw new AppException('TEN_NOT_FOUND');
    }
    return company;
  }

  /** Timezone dùng cho mọi phép tính "ngày làm việc" (D5). */
  async getTimezone(companyId: string, branchId?: string | null): Promise<string> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { timezone: true },
      });
      if (branch?.timezone) return branch.timezone;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return company?.timezone ?? DEFAULT_TIMEZONE;
  }

  // ---------------------------------------------------------------------------
  // Ca làm việc
  // ---------------------------------------------------------------------------

  /**
   * Ca áp dụng cho (nhân viên, ngày).
   *
   * Thứ tự: ShiftAssignment của đúng ngày → ca mặc định của công ty còn hiệu lực
   * và khớp bitmask ngày trong tuần.
   *
   * D6: chỉ lấy ca có `effectiveFrom ≤ workDate` và (`effectiveTo` null hoặc ≥ workDate)
   * — đổi giờ ca giữa tháng không làm sai lệch dữ liệu cũ.
   */
  async resolveShiftForDate(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<(Shift & { segments: { order: number; startTime: string; endTime: string }[] }) | null> {
    const assignment = await this.prisma.shiftAssignment.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
      include: { shift: { include: { segments: { orderBy: { order: 'asc' } } } } },
    });

    if (assignment?.shift && assignment.shift.companyId === companyId) {
      return assignment.shift;
    }

    const mask = weekdayMaskOf(workDate);
    const defaults = await this.prisma.shift.findMany({
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

    return (
      defaults.find((shift) => shift.weekdayMask === 0 || (shift.weekdayMask & mask) !== 0) ?? null
    );
  }

  /** Ngày lễ áp dụng cho công ty/chi nhánh (FR-WEB-POL-06). */
  async findHoliday(companyId: string, workDate: Date, branchId?: string | null) {
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        companyId,
        OR: [{ date: workDate }, { substituteDate: workDate }],
      },
    });
    if (!holiday) return null;

    // branchIds rỗng = áp dụng toàn công ty
    if (holiday.branchIds.length > 0 && branchId && !holiday.branchIds.includes(branchId)) {
      return null;
    }
    return holiday;
  }

  assertValidTime(value: string | null | undefined): void {
    if (value && !isValidTimeOfDay(value)) {
      throw new AppException('POL_INVALID_TIME_FORMAT', { value });
    }
  }
}
