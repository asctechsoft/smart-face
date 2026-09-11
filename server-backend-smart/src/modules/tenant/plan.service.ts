import { Injectable, Logger } from '@nestjs/common';
import { AppException } from 'src/common/errors';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedisService } from 'src/infra/redis/redis.service';

/**
 * Giới hạn số lượng của gói. Khoá trùng tên cột trên `SubscriptionPlan`.
 */
export const PLAN_LIMIT_KEYS = {
  maxEmployees: 'maxEmployees',
  maxBranches: 'maxBranches',
  maxDepartments: 'maxDepartments',
  maxShifts: 'maxShifts',
  maxAdminAccounts: 'maxAdminAccounts',
} as const;

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[keyof typeof PLAN_LIMIT_KEYS];

/**
 * Feature flag của gói (docs/07 §7). Khoá lấy từ màn "Chỉnh sửa gói dịch vụ".
 */
export const PLAN_FEATURE_KEYS = {
  appAccount: 'appAccount',
  leaveApproval: 'leaveApproval',
  advancedScheduling: 'advancedScheduling',
  excelExport: 'excelExport',
  advancedReport: 'advancedReport',
  apiIntegration: 'apiIntegration',
  fullAuditLog: 'fullAuditLog',
} as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[keyof typeof PLAN_FEATURE_KEYS];

export interface EffectivePlan {
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  limits: Record<PlanLimitKey, number | null>;
  features: Record<string, unknown>;
  photoRetentionDays: number;
  dataRetentionDays: number;
}

const PLAN_CACHE_TTL_SECONDS = 300;

/**
 * Gói dịch vụ có hiệu lực cho một tenant = gói dùng chung + ghi đè riêng.
 *
 * ## Vì sao giới hạn phải cưỡng chế ở Backend (`FR-ADM-PKG-03`)
 *
 * Ẩn nút "Thêm nhân viên" khi hết quota chỉ ngăn được người dùng lịch sự. Cùng
 * một tài khoản đó gọi thẳng API là qua — và với gói tính tiền theo đầu người
 * thì đó là thất thoát doanh thu, không phải lỗi giao diện.
 *
 * ## Vì sao có `CompanyFeatureOverride` thay vì sửa gói
 *
 * Bán hàng hay hứa riêng với một khách ("cho anh thêm 20 slot"). Sửa thẳng vào
 * gói `Plus` là 92 công ty khác cùng được thêm 20 slot. Ghi đè theo tenant giữ
 * gói dùng chung nguyên vẹn và để lại `reason` cho người sau đọc.
 */
@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async resolve(companyId: string): Promise<EffectivePlan> {
    const cacheKey = `plan:${companyId}`;
    return this.redis
      .remember(cacheKey, PLAN_CACHE_TTL_SECONDS, () => this.load(companyId))
      .catch((error: Error) => {
        this.logger.warn(`Không đọc được gói dịch vụ từ cache: ${error.message}`);
        return this.load(companyId);
      });
  }

  private async load(companyId: string): Promise<EffectivePlan> {
    const [company, overrides] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId }, include: { plan: true } }),
      this.prisma.companyFeatureOverride.findMany({ where: { companyId } }),
    ]);

    const plan = company?.plan ?? null;
    const now = new Date();

    const limits: Record<PlanLimitKey, number | null> = {
      maxEmployees: plan?.maxEmployees ?? null,
      maxBranches: plan?.maxBranches ?? null,
      maxDepartments: plan?.maxDepartments ?? null,
      maxShifts: plan?.maxShifts ?? null,
      maxAdminAccounts: plan?.maxAdminAccounts ?? null,
    };
    const features: Record<string, unknown> = {
      ...((plan?.features as Record<string, unknown>) ?? {}),
    };

    for (const override of overrides) {
      // Ghi đè hết hạn thì coi như không có — không cần job dọn, cùng nguyên tắc
      // với `RoleAssignment.validTo`.
      if (override.expiresAt && override.expiresAt <= now) continue;

      if (override.key in limits) {
        const value = override.value;
        limits[override.key as PlanLimitKey] = typeof value === 'number' ? value : null;
      } else {
        features[override.key] = override.value;
      }
    }

    return {
      planId: plan?.id ?? null,
      planCode: plan?.code ?? null,
      planName: plan?.name ?? null,
      limits,
      features,
      photoRetentionDays: plan?.photoRetentionDays ?? 90,
      dataRetentionDays: plan?.dataRetentionDays ?? 365,
    };
  }

  /**
   * Chặn khi đã chạm giới hạn.
   *
   * `null` nghĩa là KHÔNG giới hạn, không phải giới hạn bằng 0 — gói Max để null
   * ở mọi cột `max*`. Nhầm hai thứ này là khoá sạch khách hàng trả tiền cao nhất.
   */
  async assertLimit(companyId: string, key: PlanLimitKey, currentCount: number): Promise<void> {
    const plan = await this.resolve(companyId);
    const limit = plan.limits[key];
    if (limit === null || limit === undefined) return;

    if (currentCount >= limit) {
      throw new AppException('PLAN_LIMIT_EXCEEDED', {
        limitKey: key,
        limit,
        current: currentCount,
        planName: plan.planName,
      });
    }
  }

  /** Còn bao nhiêu suất — Web dùng để cảnh báo trước khi chạm (`FR-ADM-PKG-05`). */
  async remaining(companyId: string, key: PlanLimitKey, currentCount: number) {
    const plan = await this.resolve(companyId);
    const limit = plan.limits[key];
    if (limit === null || limit === undefined) {
      return { limit: null, used: currentCount, remaining: null, nearLimit: false };
    }
    const remaining = Math.max(0, limit - currentCount);
    return {
      limit,
      used: currentCount,
      remaining,
      // "Sắp chạm" = còn dưới 10% hoặc dưới 3 suất, tuỳ cái nào rộng hơn. Ngưỡng
      // theo tỉ lệ một mình thì gói 20 người chỉ báo khi còn 2 suất — quá muộn
      // để kịp nâng gói.
      nearLimit: remaining <= Math.max(3, Math.ceil(limit * 0.1)),
    };
  }

  async assertFeature(companyId: string, key: PlanFeatureKey): Promise<void> {
    const plan = await this.resolve(companyId);
    if (plan.features[key] !== true) {
      throw new AppException('PLAN_FEATURE_DISABLED', { feature: key, planName: plan.planName });
    }
  }

  async isFeatureEnabled(companyId: string, key: PlanFeatureKey): Promise<boolean> {
    const plan = await this.resolve(companyId);
    return plan.features[key] === true;
  }

  // ===========================================================================
  //  Ghi đè theo tenant (FR-ADM-PKG-04)
  // ===========================================================================

  async setOverride(
    companyId: string,
    key: string,
    value: unknown,
    setBy: string,
    reason?: string,
    expiresAt?: Date | null,
  ) {
    const record = await this.prisma.companyFeatureOverride.upsert({
      where: { companyId_key: { companyId, key } },
      create: {
        companyId,
        key,
        value: value as never,
        setBy,
        reason,
        expiresAt: expiresAt ?? null,
      },
      update: { value: value as never, setBy, reason, expiresAt: expiresAt ?? null },
    });
    await this.invalidate(companyId);
    return record;
  }

  async clearOverride(companyId: string, key: string) {
    await this.prisma.companyFeatureOverride.deleteMany({ where: { companyId, key } });
    await this.invalidate(companyId);
  }

  async listOverrides(companyId: string) {
    return this.prisma.companyFeatureOverride.findMany({
      where: { companyId },
      orderBy: { key: 'asc' },
    });
  }

  async invalidate(companyId: string): Promise<void> {
    await this.redis.del(`plan:${companyId}`).catch((error: Error) => {
      this.logger.warn(`Không xoá được cache gói dịch vụ: ${error.message}`);
    });
  }
}
