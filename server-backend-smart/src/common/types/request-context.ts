import { SystemRole } from '@prisma/client';
import type { Request } from 'express';

/**
 * Payload của access token (docs/02-kien-truc-he-thong.md mục 8.1).
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
}

export interface AuthenticatedRequest extends Request {
  ctx?: RequestContext;
  traceId?: string;
  /** Body thô — SignatureGuard cần để tính HMAC (AF-12) */
  rawBody?: Buffer;
}

/**
 * Ngữ cảnh có companyId chắc chắn khác null.
 * Dùng cho các API nghiệp vụ đã qua TenantGuard (BR-09).
 */
export type TenantContext = RequestContext & { companyId: string };
