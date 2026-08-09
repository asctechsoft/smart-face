import { Injectable } from '@nestjs/common';
import {
  AiModelVersion,
  AttendanceDecision,
  AuditLog,
  Employee,
  Prisma,
  UserAccount,
} from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type UserAccountWithCompanies = Prisma.UserAccountGetPayload<{
  include: {
    employees: {
      select: {
        id: true;
        companyId: true;
        employeeCode: true;
        status: true;
        company: { select: { name: true; code: true } };
      };
    };
    _count: { select: { devices: true } };
  };
}>;

export type UserAccountDetail = Prisma.UserAccountGetPayload<{
  include: {
    employees: { include: { company: { select: { name: true; code: true } } } };
    devices: true;
  };
}>;

export interface UserSearchFilter {
  q?: string;
  /** Số điện thoại đã chuẩn hoá từ `q` — tìm theo dạng lưu trong DB. */
  normalizedPhone?: string;
  companyId?: string;
  skip: number;
  take: number;
}

export interface RecentPunch {
  id: string;
  companyId: string;
  type: string;
  recordedAt: Date;
  decision: AttendanceDecision;
  fraudScore: number | null;
  deviceId: string | null;
}

export interface AiUsageStats {
  total: number;
  avgProcessingMs: number | null;
  avgMatchScore: number | null;
  avgLivenessScore: number | null;
  byDecision: Array<{ decision: AttendanceDecision; count: number }>;
}

export interface AiModelInput {
  name: string;
  version: string;
  farMeasured?: number;
  frrMeasured?: number;
  latencyP95Ms?: number;
  defaultMatchThreshold?: number;
  defaultLivenessThreshold?: number;
  notes?: string;
}

/**
 * Truy cập dữ liệu cho Web Admin (`/v1/system/*`).
 *
 * ## Vì sao đây là repository DUY NHẤT không nhận `companyId`
 *
 * Quy ước chung bắt mọi repository nhận `companyId` (BR-09). Module này là ngoại
 * lệ có chủ đích: đối tượng của nó là NỀN TẢNG, không phải một công ty — người
 * dùng xuyên tenant, phiên bản model AI, cấu hình hệ thống, sức khoẻ hàng đợi.
 *
 * Bù lại bằng hai chốt khác, và cả hai đều nằm NGOÀI tầng này:
 *   - `@Roles(SYSTEM_ADMIN)` ở controller — chỉ quản trị nền tảng gọi được.
 *   - `AuditService.recordCrossTenantAccess` (A1) — mọi lần Admin chạm vào dữ
 *     liệu của một công ty cụ thể đều để lại dấu vết. Không có "xem lén".
 *
 * Vì vậy KHÔNG thêm truy vấn nghiệp vụ theo công ty vào đây. Cần đọc dữ liệu của
 * một công ty thì gọi repository của module tương ứng, nơi `companyId` bắt buộc.
 */
@Injectable()
export class AdminRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Người dùng toàn hệ thống (FR-ADM-USR)
  // ===========================================================================

  async searchUsers(
    filter: UserSearchFilter,
  ): Promise<{ items: UserAccountWithCompanies[]; total: number }> {
    const where: Prisma.UserAccountWhereInput = { deletedAt: null };

    if (filter.q) {
      where.OR = [
        { phone: { contains: filter.normalizedPhone ?? filter.q } },
        { fullName: { contains: filter.q, mode: 'insensitive' } },
        { employees: { some: { employeeCode: { contains: filter.q, mode: 'insensitive' } } } },
      ];
    }
    if (filter.companyId) {
      where.employees = { some: { companyId: filter.companyId } };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userAccount.findMany({
        where,
        include: {
          employees: {
            select: {
              id: true,
              companyId: true,
              employeeCode: true,
              status: true,
              company: { select: { name: true, code: true } },
            },
          },
          _count: { select: { devices: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.userAccount.count({ where }),
    ]);

    return { items, total };
  }

  async findUser(userId: string): Promise<UserAccount | null> {
    return this.db().userAccount.findUnique({ where: { id: userId } });
  }

  async findUserWithCompanies(userId: string): Promise<UserAccountDetail | null> {
    return this.db().userAccount.findUnique({
      where: { id: userId },
      include: {
        employees: { include: { company: { select: { name: true, code: true } } } },
        devices: true,
      },
    });
  }

  /** FR-ADM-USR-07 — hoạt động gần đây của một tài khoản. */
  async findRecentPunches(employeeIds: string[], take = 20): Promise<RecentPunch[]> {
    return this.db().attendanceLog.findMany({
      where: { employeeId: { in: employeeIds } },
      orderBy: { recordedAt: 'desc' },
      take,
      select: {
        id: true,
        companyId: true,
        type: true,
        recordedAt: true,
        decision: true,
        fraudScore: true,
        deviceId: true,
      },
    });
  }

  async findRecentAudit(userId: string, employeeIds: string[], take = 30): Promise<AuditLog[]> {
    return this.db().auditLog.findMany({
      where: { OR: [{ actorUserId: userId }, { targetId: { in: employeeIds } }] },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async countActiveSessions(userId: string): Promise<number> {
    return this.db().refreshToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  async setBlocked(
    userId: string,
    blocked: boolean,
    reason: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).userAccount.update({
      where: { id: userId },
      data: { isBlocked: blocked, blockedReason: blocked ? reason : null },
    });
  }

  /**
   * Hồ sơ nhân viên khớp CẢ `userId` lẫn mã nhân viên xác nhận.
   *
   * Đây là bước xác nhận hai lớp của FR-ADM-USR-03: Admin phải gõ đúng mã nhân
   * viên thì thao tác reset sinh trắc học mới chạy. Không khớp là huỷ.
   */
  async findEmployeeByUserAndCode(userId: string, employeeCode: string): Promise<Employee | null> {
    return this.db().employee.findFirst({
      where: { userId, employeeCode, deletedAt: null },
    });
  }

  async findActiveDeviceIds(userId: string): Promise<string[]> {
    const rows = await this.db().deviceBinding.findMany({
      where: { userId, isActive: true },
      select: { deviceId: true },
    });
    return rows.map((row) => row.deviceId);
  }

  /**
   * Số điện thoại chỉ cần duy nhất TRONG công ty, không phải toàn hệ thống: tài
   * khoản gắn với đúng một công ty nên hai công ty dùng trùng số là bình thường
   * (một người làm hai nơi).
   */
  async isPhoneTakenInCompany(
    companyId: string | null,
    phone: string,
    excludeUserId: string,
  ): Promise<boolean> {
    const taken = await this.db().userAccount.findFirst({
      where: { companyId, phone, deletedAt: null, NOT: { id: excludeUserId } },
      select: { id: true },
    });
    return taken !== null;
  }

  /** Đổi số ở cả tài khoản lẫn hồ sơ nhân sự — hai bảng phải khớp nhau. */
  async updatePhone(userId: string, phone: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = this.db(tx);
    await client.userAccount.update({ where: { id: userId }, data: { phone } });
    await client.employee.updateMany({ where: { userId }, data: { phone } });
  }

  // ===========================================================================
  //  Giám sát AI Server (FR-ADM-AI)
  // ===========================================================================

  async loadAiUsage(since: Date): Promise<AiUsageStats> {
    const [total, aggregate] = await this.prisma.$transaction([
      this.prisma.attendanceLog.count({ where: { recordedAt: { gte: since } } }),
      this.prisma.attendanceLog.aggregate({
        where: { recordedAt: { gte: since }, aiProcessingMs: { not: null } },
        _avg: { aiProcessingMs: true, matchScore: true, livenessScore: true },
      }),
    ]);

    // groupBy gọi riêng: gộp vào $transaction([...]) làm mất kiểu narrow của `_count`.
    const byDecision = await this.db().attendanceLog.groupBy({
      by: ['decision'],
      where: { recordedAt: { gte: since } },
      _count: { decision: true },
      orderBy: { decision: 'asc' },
    });

    return {
      total,
      avgProcessingMs: aggregate._avg.aiProcessingMs,
      avgMatchScore: aggregate._avg.matchScore,
      avgLivenessScore: aggregate._avg.livenessScore,
      byDecision: byDecision.map((row) => ({
        decision: row.decision,
        count: row._count.decision,
      })),
    };
  }

  async listAiModels(): Promise<AiModelVersion[]> {
    return this.db().aiModelVersion.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findAiModel(modelId: string): Promise<AiModelVersion | null> {
    return this.db().aiModelVersion.findUnique({ where: { id: modelId } });
  }

  async findActiveAiModel(): Promise<AiModelVersion | null> {
    return this.db().aiModelVersion.findFirst({ where: { isActive: true } });
  }

  async upsertAiModel(data: AiModelInput): Promise<AiModelVersion> {
    return this.db().aiModelVersion.upsert({
      where: { name_version: { name: data.name, version: data.version } },
      create: data,
      update: data,
    });
  }

  /**
   * Chuyển model đang chạy sang model khác — trong MỘT transaction.
   *
   * Tách hai lệnh ra ngoài transaction có thể để lại khoảnh khắc không model nào
   * `isActive`, và đúng lúc đó mọi lượt chấm công đều không tìm được ngưỡng.
   *
   * `rolledBackAt` phân biệt hai lối vào: triển khai bản mới thì xoá dấu rollback
   * của bản đích, còn quay lui thì đánh dấu bản vừa bị gỡ.
   */
  async switchActiveAiModel(modelId: string, mode: 'DEPLOY' | 'ROLLBACK', at: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiModelVersion.updateMany({
        where: { isActive: true },
        data: mode === 'ROLLBACK' ? { isActive: false, rolledBackAt: at } : { isActive: false },
      }),
      this.prisma.aiModelVersion.update({
        where: { id: modelId },
        data:
          mode === 'ROLLBACK'
            ? { isActive: true, deployedAt: at }
            : { isActive: true, deployedAt: at, rolledBackAt: null },
      }),
    ]);
  }

  // ===========================================================================
  //  Cấu hình hệ thống (FR-ADM-CFG)
  // ===========================================================================

  async findAllSystemConfig(): Promise<Array<{ key: string; value: Prisma.JsonValue }>> {
    return this.db().systemConfig.findMany({ select: { key: true, value: true } });
  }

  async upsertSystemConfig(
    key: string,
    value: Prisma.InputJsonValue,
    updatedBy: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).systemConfig.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
  }

  // ===========================================================================
  //  Vận hành & an ninh (FR-ADM-OPS, FR-ADM-SEC)
  // ===========================================================================

  /** Probe database cho health check — truy vấn rẻ nhất có thể. */
  async ping(): Promise<void> {
    await this.db().$queryRaw`SELECT 1`;
  }

  async countAuditActionSince(action: string, since: Date): Promise<number> {
    return this.db().auditLog.count({ where: { action, createdAt: { gte: since } } });
  }

  async countFraudFlagsSince(
    since: Date,
    filter: { severity?: string; code?: string } = {},
  ): Promise<number> {
    return this.db().fraudFlag.count({ where: { ...filter, createdAt: { gte: since } } });
  }
}
