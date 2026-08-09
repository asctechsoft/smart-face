import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto';
import { buildMeta } from 'src/common/utils';
import type { RequestContext } from 'src/common/types/request-context';
import { AuditLogQueryDto } from './dto/audit.dto';
import { AuditRepository } from './audit.repository';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  companyId?: string | null;
}

/** Ràng buộc tenant do CALLER áp đặt, không lấy từ query của client (BR-09). */
export interface AuditSearchScope {
  /** null = xuyên tenant (chỉ Web Admin) */
  companyId?: string | null;
}

/**
 * BR-08 — audit trail.
 *
 * Bảng `audit_log` là APPEND-ONLY, không cho update/delete kể cả Admin hệ thống
 * (rule ở tầng DB: prisma/sql/01_immutability_and_rls.sql).
 *
 * Interceptor `@Audit()` ghi ngữ cảnh chung; service gọi `record()` khi cần lưu
 * giá trị trước/sau để đối chiếu.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly audits: AuditRepository) {}

  async record(ctx: RequestContext, entry: AuditEntry): Promise<void> {
    try {
      await this.audits.create({
        companyId: entry.companyId ?? ctx.companyId ?? null,
        actorUserId: ctx.userId,
        actorRole: ctx.roles.join(','),
        actorIp: ctx.ip,
        actorUserAgent: ctx.userAgent,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        before: entry.before,
        after: entry.after,
        traceId: ctx.traceId,
      });
    } catch (error) {
      this.logger.error(`Không ghi được audit log (${entry.action}): ${(error as Error).message}`);
    }
  }

  /** Ghi audit từ job nền / cron — không có RequestContext. */
  async recordSystem(entry: AuditEntry & { actorName?: string }): Promise<void> {
    try {
      await this.audits.create({
        companyId: entry.companyId ?? null,
        actorName: entry.actorName ?? 'SYSTEM',
        actorRole: 'SYSTEM',
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        before: entry.before,
        after: entry.after,
      });
    } catch (error) {
      this.logger.error(`Không ghi được audit log hệ thống: ${(error as Error).message}`);
    }
  }

  /**
   * A1 — Admin hệ thống xem dữ liệu của một công ty cụ thể thì PHẢI để lại dấu vết.
   * Không có chuyện "xem lén không dấu vết".
   */
  async recordCrossTenantAccess(
    ctx: RequestContext,
    companyId: string,
    resource: string,
  ): Promise<void> {
    if (!ctx.isSystemAdmin) return;
    await this.record(ctx, {
      companyId,
      action: 'ADMIN_CROSS_TENANT_ACCESS',
      targetType: 'COMPANY',
      targetId: companyId,
      after: { resource },
    });
  }

  /**
   * FR-ADM-SEC-06 — tra cứu audit log.
   *
   * `scope.companyId` do controller truyền vào từ JWT, KHÔNG lấy từ query của
   * client — nếu không, người dùng công ty A sẽ đọc được log của công ty B (BR-09).
   */
  async search(query: AuditLogQueryDto, scope: AuditSearchScope = {}) {
    const companyId = scope.companyId === undefined ? (query.companyId ?? null) : scope.companyId;

    const { items, total } = await this.audits.search(companyId, {
      actorUserId: query.actorUserId,
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      skip: query.skip,
      take: query.take,
    });

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  /** BR-ADJ-06 — nhân viên xem được lịch sử hiệu chỉnh liên quan tới mình. */
  async findForTarget(companyId: string, targetType: string, targetId: string) {
    return this.audits.findForTarget(companyId, targetType, targetId);
  }
}
