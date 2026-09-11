import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/request-context';

/** Công ty mà quản trị viên nền tảng muốn thao tác trong phiên hỗ trợ. */
export const SUPPORT_COMPANY_HEADER = 'x-company-id';

/**
 * Guard chỉ cần đúng một hàm, nên nhận qua token DI — cùng lý do như
 * `STEP_UP_CONSUMER`: import thẳng service kéo theo cả cây phụ thuộc Prisma vào
 * mọi bài test chạm tới guard.
 */
export const SUPPORT_ACCESS_CHECKER = Symbol('SUPPORT_ACCESS_CHECKER');

export interface SupportAccessChecker {
  resolveActiveSession(
    adminUserId: string,
    companyId: string,
  ): Promise<{ id: string; readOnly: boolean } | null>;
}

/** Phương thức HTTP thay đổi dữ liệu — phiên chỉ-đọc không được dùng. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * BR-09 / ADR-05 — bảo đảm mọi request nghiệp vụ đều có `companyId` trong ngữ cảnh.
 *
 * `companyId` LUÔN lấy từ JWT, KHÔNG BAO GIỜ từ body/query của client.
 *
 * ## Truy cập xuyên tenant của quản trị viên nền tảng (BR-08)
 *
 * Trước v2.1, chỉ cần gửi kèm `X-Company-Id` là một tài khoản nền tảng đọc được
 * dữ liệu của bất kỳ công ty nào. Không mã phiếu, không lý do, không thời hạn —
 * và bản ghi audit để lại chỉ nói *ai* đã xem, không nói được *vì sao*. Khi khách
 * hàng hỏi "ai đã mở dữ liệu của chúng tôi và theo yêu cầu nào", không có câu
 * trả lời nào rút ra được từ hệ thống.
 *
 * Bây giờ header đó chỉ có tác dụng khi đã có một `SupportAccessSession` đang mở
 * đúng cặp (quản trị viên, công ty). Guard gắn `supportSessionId` vào ngữ cảnh
 * để mọi bản ghi audit sinh ra trong phiên đều quy được về đúng phiếu hỗ trợ.
 *
 * Phiên `readOnly` chặn luôn mọi phương thức ghi: đọc để chẩn đoán là việc thường
 * gặp, còn sửa dữ liệu của khách hàng thì phải khai rõ từ lúc mở phiên.
 *
 * Guard này chỉ chặn "không có tenant". Việc lọc dữ liệu theo companyId là trách
 * nhiệm của Repository — đó mới là lớp thực sự chống rò rỉ chéo tenant.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SUPPORT_ACCESS_CHECKER) private readonly support: SupportAccessChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const [isPublic, skipTenant] = [IS_PUBLIC_KEY, SKIP_TENANT_KEY].map((key) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]),
    );
    if (isPublic || skipTenant) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ctx = request.ctx;
    if (!ctx) {
      throw new AppException('AUTH_TOKEN_INVALID');
    }

    if (ctx.isSystemAdmin) {
      const raw = request.headers[SUPPORT_COMPANY_HEADER];
      const requestedCompanyId = Array.isArray(raw) ? raw[0] : raw;

      // Không chỉ định công ty nào thì đây là một endpoint quản trị nền tảng
      // thuần tuý — không có dữ liệu tenant nào bị chạm tới, không cần phiên.
      if (!requestedCompanyId) return true;

      const session = await this.support.resolveActiveSession(ctx.userId, requestedCompanyId);
      if (!session) {
        throw new AppException('SUPPORT_SESSION_REQUIRED', { companyId: requestedCompanyId });
      }

      const method = request.method?.toUpperCase() ?? 'GET';
      if (session.readOnly && WRITE_METHODS.has(method)) {
        throw new AppException('SUPPORT_SESSION_REQUIRED', {
          companyId: requestedCompanyId,
          reason: 'Phiên hỗ trợ đang ở chế độ chỉ đọc, không thực hiện được thao tác ghi.',
        });
      }

      ctx.companyId = requestedCompanyId;
      ctx.supportSessionId = session.id;
      return true;
    }

    if (!ctx.companyId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }

    return true;
  }
}
