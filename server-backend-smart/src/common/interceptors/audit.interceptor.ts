import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditRepository } from 'src/modules/audit/audit.repository';
import { AUDIT_KEY, AuditOptions } from '../decorators/audit.decorator';
import { AppException } from '../errors';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * BR-08 / A3 — ghi audit log cho mọi thao tác nhạy cảm.
 *
 * Hai việc:
 *   1. CHẶN request nếu `requireReason: true` mà body thiếu `reason`
 *      (docs/05 nguyên tắc A3: "bắt buộc nhập lý do TRƯỚC khi thực thi").
 *   2. Ghi AuditLog sau khi handler thành công.
 *
 * Interceptor chỉ ghi được ngữ cảnh chung. Trường `before`/`after` chi tiết do
 * service tự ghi qua AuditService khi cần đối chiếu giá trị cũ/mới.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audits: AuditRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditOptions>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    // Kiểm tra lý do TRƯỚC khi gọi `next.handle()` — tức là trước khi nghiệp vụ
    // chạy. Kiểm tra sau thì thao tác đã xảy ra rồi, ném lỗi lúc đó chỉ khiến
    // người dùng tưởng là thất bại trong khi dữ liệu đã bị thay đổi (A3).
    if (options.requireReason && reason.length < 10) {
      throw new AppException('PAY_REASON_REQUIRED', {
        reason: 'Lý do phải có ít nhất 10 ký tự.',
      });
    }

    const ctx = request.ctx;
    const params = (request.params ?? {}) as Record<string, string>;
    const targetId =
      params[options.targetIdFrom ?? 'id'] ??
      (typeof body[options.targetIdFrom ?? 'id'] === 'string'
        ? (body[options.targetIdFrom ?? 'id'] as string)
        : undefined);

    // `tap({ next })` chỉ chạy khi handler THÀNH CÔNG. Cố ý không ghi audit cho
    // request thất bại: nhật ký phải phản ánh những gì ĐÃ XẢY RA. Ghi cả lần thử
    // hỏng sẽ khiến người đọc sau này tưởng thao tác đó có hiệu lực.
    //
    // `void this.write(...)` — không await. Ghi audit là việc phụ, không được
    // kéo dài thời gian phản hồi của người dùng.
    return next.handle().pipe(
      tap({
        next: () => {
          void this.write(options, {
            companyId: ctx?.companyId ?? null,
            actorUserId: ctx?.userId ?? null,
            actorRole: ctx?.roles.join(',') ?? null,
            actorIp: ctx?.ip ?? request.ip ?? null,
            actorUserAgent: ctx?.userAgent ?? null,
            targetId: targetId ?? null,
            reason: reason || null,
            traceId: ctx?.traceId ?? request.traceId ?? null,
          });
        },
      }),
    );
  }

  private async write(
    options: AuditOptions,
    data: {
      companyId: string | null;
      actorUserId: string | null;
      actorRole: string | null;
      actorIp: string | null;
      actorUserAgent: string | null;
      targetId: string | null;
      reason: string | null;
      traceId: string | null;
    },
  ): Promise<void> {
    try {
      await this.audits.create({
        companyId: data.companyId,
        actorUserId: data.actorUserId,
        actorRole: data.actorRole,
        actorIp: data.actorIp,
        actorUserAgent: data.actorUserAgent,
        action: options.action,
        targetType: options.targetType,
        targetId: data.targetId,
        reason: data.reason,
        traceId: data.traceId,
      });
    } catch (error) {
      // Ghi audit thất bại KHÔNG được làm hỏng nghiệp vụ đã thực hiện xong,
      // nhưng phải kêu to để vận hành biết.
      this.logger.error(
        `Không ghi được audit log cho hành động ${options.action}: ${(error as Error).message}`,
      );
    }
  }
}
