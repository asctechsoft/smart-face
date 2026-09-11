import { Injectable, Logger } from '@nestjs/common';
import { AppException } from 'src/common/errors';
import type { SupportAccessChecker } from 'src/common/guards/tenant.guard';
import type { RequestContext } from 'src/common/types/request-context';
import { AuditService } from '../audit/audit.service';
import { SupportAccessRepository } from './support-access.repository';

export interface OpenSessionInput {
  companyId: string;
  ticketRef: string;
  purpose: string;
  /** Số phút, tối đa `MAX_DURATION_MINUTES`. */
  durationMinutes?: number;
  readOnly?: boolean;
}

/** Không có phiên vô hạn, và cũng không có phiên dài hơn một ca làm việc. */
const MAX_DURATION_MINUTES = 8 * 60;
const DEFAULT_DURATION_MINUTES = 60;

/**
 * Phiên hỗ trợ tenant — thay cho việc mạo danh bằng header thô (`BR-08`).
 *
 * ## Cái gì hỏng trước đây
 *
 * `TenantGuard` chấp nhận `X-Company-Id` từ bất kỳ tài khoản nền tảng nào và đổi
 * `ctx.companyId` sang công ty đó. Nghĩa là: không có mã phiếu, không có lý do,
 * không có hạn, và bản ghi audit sinh ra chỉ nói "admin X đã xem công ty Y" chứ
 * không nói được vì sao. Khi khách hàng hỏi "ai đã xem dữ liệu của chúng tôi và
 * theo yêu cầu nào", không có câu trả lời.
 *
 * ## Cách làm bây giờ
 *
 * Quản trị viên phải mở phiên trước: khai mã phiếu, lý do và thời hạn. Guard
 * chỉ đổi `companyId` khi tìm thấy một phiên đang mở đúng cặp (người, công ty),
 * và gắn `supportSessionId` vào ngữ cảnh để MỌI bản ghi audit trong phiên đều
 * quy về đúng phiếu hỗ trợ đó.
 *
 * Phiên `readOnly` (mặc định) chỉ cho đọc: mọi phương thức ghi bị chặn tại guard.
 * Muốn ghi thì phải khai rõ khi mở phiên, và điều đó cũng nằm trong audit.
 */
@Injectable()
export class SupportAccessService implements SupportAccessChecker {
  private readonly logger = new Logger(SupportAccessService.name);

  constructor(
    private readonly sessions: SupportAccessRepository,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  //  Guard gọi
  // ===========================================================================

  async resolveActiveSession(
    adminUserId: string,
    companyId: string,
  ): Promise<{ id: string; readOnly: boolean } | null> {
    const session = await this.sessions.findActive(adminUserId, companyId, new Date());
    if (!session) return null;
    return { id: session.id, readOnly: session.readOnly };
  }

  // ===========================================================================
  //  Vòng đời phiên
  // ===========================================================================

  async open(ctx: RequestContext, input: OpenSessionInput) {
    const ticketRef = input.ticketRef.trim();
    const purpose = input.purpose.trim();
    if (!ticketRef || !purpose) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Phiên hỗ trợ bắt buộc có mã phiếu và lý do truy cập.',
      });
    }

    const minutes = Math.min(
      Math.max(input.durationMinutes ?? DEFAULT_DURATION_MINUTES, 5),
      MAX_DURATION_MINUTES,
    );
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    // Mở lại khi đang có phiên hiệu lực thì trả về chính phiên đó thay vì tạo
    // thêm: hai phiên song song cùng người cùng công ty làm việc quy trách nhiệm
    // rối ra mà không thêm được gì.
    const existing = await this.sessions.findActive(ctx.userId, input.companyId, new Date());
    if (existing) {
      return { ...this.present(existing), reused: true };
    }

    const session = await this.sessions.create({
      adminUserId: ctx.userId,
      companyId: input.companyId,
      ticketRef,
      purpose,
      expiresAt,
      readOnly: input.readOnly ?? true,
    });

    await this.audit.record(ctx, {
      companyId: input.companyId,
      action: 'SUPPORT_SESSION_OPEN',
      targetType: 'SUPPORT_ACCESS_SESSION',
      targetId: session.id,
      reason: purpose,
      after: { ticketRef, purpose, expiresAt, readOnly: session.readOnly },
    });

    this.logger.log(
      `Phiên hỗ trợ ${session.id} mở trên công ty ${input.companyId} (phiếu ${ticketRef}, hết hạn ${expiresAt.toISOString()}).`,
    );

    return { ...this.present(session), reused: false };
  }

  async close(ctx: RequestContext, sessionId: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new AppException('SYS_NOT_FOUND', { resource: 'SupportAccessSession' });
    }

    const { count } = await this.sessions.end(sessionId, ctx.userId);

    await this.audit.record(ctx, {
      companyId: session.companyId,
      action: 'SUPPORT_SESSION_CLOSE',
      targetType: 'SUPPORT_ACCESS_SESSION',
      targetId: sessionId,
      after: { alreadyClosed: count === 0 },
    });

    return { closed: true, alreadyClosed: count === 0 };
  }

  async list(filter: { companyId?: string; adminUserId?: string; activeOnly?: boolean }) {
    const rows = await this.sessions.list(filter, 100);
    return rows.map((row) => ({
      ...this.present(row),
      company: row.company,
    }));
  }

  /** Những gì đã thực sự xảy ra trong một phiên — bằng chứng đưa cho khách hàng. */
  async trail(sessionId: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new AppException('SYS_NOT_FOUND', { resource: 'SupportAccessSession' });
    }
    return {
      session: this.present(session),
      entries: await this.sessions.auditTrail(sessionId, 500),
    };
  }

  async trace(correlationId: string) {
    const entries = await this.sessions.traceByCorrelationId(correlationId, 500);
    return {
      correlationId,
      count: entries.length,
      entries,
    };
  }

  private present(session: {
    id: string;
    adminUserId: string;
    companyId: string;
    ticketRef: string;
    purpose: string;
    expiresAt: Date;
    endedAt: Date | null;
    readOnly: boolean;
    createdAt: Date;
  }) {
    const active = session.endedAt === null && session.expiresAt.getTime() > Date.now();
    return {
      id: session.id,
      adminUserId: session.adminUserId,
      companyId: session.companyId,
      ticketRef: session.ticketRef,
      purpose: session.purpose,
      readOnly: session.readOnly,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      createdAt: session.createdAt,
      active,
    };
  }
}
