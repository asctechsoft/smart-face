import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditOptions {
  /** Mã hành động: "BIOMETRIC_RESET" | "PAYROLL_REOPEN" | "ATTENDANCE_ADJUST"… */
  action: string;
  /** Loại đối tượng bị tác động: "EMPLOYEE" | "PAYROLL_PERIOD"… */
  targetType?: string;
  /** Tên field trong params/body chứa id đối tượng. Mặc định `id`. */
  targetIdFrom?: string;
  /**
   * BR-08: thao tác nhạy cảm BẮT BUỘC có `reason` trong body.
   * Nếu true mà body thiếu `reason` → AuditInterceptor chặn request.
   */
  requireReason?: boolean;
}

/**
 * Ghi audit log cho thao tác nhạy cảm (BR-08, A3).
 *
 * ```ts
 * @Audit({ action: 'PAYROLL_REOPEN', targetType: 'PAYROLL_PERIOD', requireReason: true })
 * ```
 */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);
