import { SystemRole } from '@prisma/client';
import type { Request } from 'express';

/**
 * Payload của access token (docs/11-kien-truc-va-technology-stack.md mục 8.1).
 *
 * ```
 * { sub, employeeId, companyId, roles, deviceId, jti, iat, exp }
 * ```
 */
export interface JwtPayload {
  /** userId */
  sub: string;
  /** Employee đang hoạt động — null khi user chưa tham gia công ty nào */
  employeeId: string | null;
  /** Công ty đang hoạt động — null khi chưa tham gia công ty nào */
  companyId: string | null;
  roles: SystemRole[];
  /** AF-16: token gắn với thiết bị cụ thể */
  deviceId: string | null;
  isSystemAdmin: boolean;
  /** Phạm vi phòng ban của vai trò MANAGER — ScopeGuard dùng */
  scopeDepartmentIds?: string[];
  /**
   * Tài khoản vừa được cấp, chưa đổi mật khẩu tạm.
   *
   * Nằm trong token chứ không chỉ trả về ở response đăng nhập: nếu chỉ trả về
   * thì việc "bắt đổi mật khẩu" phụ thuộc vào App có chịu điều hướng hay không.
   * `PasswordChangeGuard` đọc cờ này và chặn mọi API khác ở phía server.
   */
  mustChangePassword?: boolean;
  jti: string;
  iat?: number;
  exp?: number;
}

/** Ngữ cảnh người gọi, gắn vào request sau khi qua JwtAuthGuard + TenantGuard. */
export interface RequestContext {
  userId: string;
  employeeId: string | null;
  companyId: string | null;
  roles: SystemRole[];
  deviceId: string | null;
  isSystemAdmin: boolean;
  scopeDepartmentIds: string[];
  mustChangePassword: boolean;
  jti: string;
  ip?: string;
  userAgent?: string;
  traceId: string;
  /** Xem `AuditLogRecord.correlationId`. Nhận từ header `X-Correlation-Id` nếu có. */
  correlationId: string;
  /** Phiên hỗ trợ tenant đang mở, nếu hành động này chạy trong một phiên như vậy. */
  supportSessionId?: string | null;
}

export interface AuthenticatedRequest extends Request {
  ctx?: RequestContext;
  correlationId?: string;
  /**
   * Quyền đã giải xong, do `PermissionGuard` gắn vào.
   *
   * Có để service khỏi giải quyền lần thứ hai trong cùng một request — mỗi lần
   * giải là bốn bảng. Kiểu là `unknown` ở đây thay vì `EffectiveAccess` để
   * `common/` không phải phụ thuộc ngược lên `modules/access`; chỗ dùng ép kiểu
   * qua `AccessService`.
   */
  access?: unknown;
  /** Id thử thách step-up đã tiêu thụ cho request này (NFR-AUD-02). */
  stepUpChallengeId?: string;
  /** Phiên bản bản ghi client kỳ vọng, do `VersionGuard` bóc từ `If-Match`. */
  expectedVersion?: number;
  traceId?: string;
  /** Body thô — SignatureGuard cần để tính HMAC (AF-12) */
  rawBody?: Buffer;
}

/**
 * Ngữ cảnh có companyId chắc chắn khác null.
 * Dùng cho các API nghiệp vụ đã qua TenantGuard (BR-09).
 */
export type TenantContext = RequestContext & { companyId: string };
