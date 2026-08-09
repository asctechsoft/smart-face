import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

/** Một dòng nhật ký chờ ghi. `companyId = null` là hành động ở tầng nền tảng. */
export interface AuditLogRecord {
  companyId: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  traceId?: string | null;
}

export interface AuditLogFilter {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

/**
 * Truy cập bảng `audit_log` (BR-08).
 *
 * Bảng này APPEND-ONLY — rule ở tầng DB chặn UPDATE/DELETE kể cả với Admin hệ
 * thống (`prisma/sql/01_immutability_and_rls.sql`). Repository cố tình KHÔNG có
 * phương thức update/delete nào: thiếu luôn ở tầng code thì không ai viết nhầm
 * rồi mới phát hiện lúc chạy.
 */
@Injectable()
export class AuditRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(record: AuditLogRecord, tx?: Prisma.TransactionClient): Promise<void> {
    await this.db(tx).auditLog.create({
      data: {
        companyId: record.companyId,
        actorUserId: record.actorUserId,
        actorName: record.actorName,
        actorRole: record.actorRole,
        actorIp: record.actorIp,
        actorUserAgent: record.actorUserAgent,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        reason: record.reason,
        before: record.before,
        after: record.after,
        traceId: record.traceId,
      },
    });
  }

  /**
   * `companyId = null` nghĩa là tra cứu XUYÊN TENANT — chỉ Web Admin được phép,
   * và caller phải cố ý truyền `null` chứ không phải bỏ trống (BR-09).
   */
  async search(
    companyId: string | null,
    filter: AuditLogFilter,
  ): Promise<{ items: AuditLog[]; total: number }> {
    const where = this.buildWhere(companyId, filter);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }

  /** BR-ADJ-06 — lịch sử thao tác trên một đối tượng cụ thể. */
  async findForTarget(
    companyId: string,
    targetType: string,
    targetId: string,
    take = 50,
  ): Promise<AuditLog[]> {
    return this.db().auditLog.findMany({
      where: { companyId, targetType, targetId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  private buildWhere(companyId: string | null, filter: AuditLogFilter): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (filter.actorUserId) where.actorUserId = filter.actorUserId;
    if (filter.action) where.action = filter.action;
    if (filter.targetType) where.targetType = filter.targetType;
    if (filter.targetId) where.targetId = filter.targetId;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    return where;
  }
}
