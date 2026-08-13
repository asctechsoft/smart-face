import { api } from '@/lib/api/client';
import type { SystemRole } from '@/config/constants';

/** `nextStep` quyết định màn hình kế tiếp sau khi đổi ID token lấy phiên. */
export type NextStep = 'NONE' | 'CHANGE_PASSWORD' | 'TWO_FACTOR' | 'ENROLL_BIOMETRIC' | string;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  nextStep: NextStep;
}

/** Phản hồi khi tài khoản bật xác thực 2 lớp — chưa có token phiên. */
export interface TwoFactorChallenge {
  nextStep: 'TWO_FACTOR';
  twoFactorToken: string;
  expiresIn: number;
  /** Số điện thoại đã che, để người dùng biết tin nhắn bay tới đâu. */
  maskedPhone?: string;
}

export type CreateSessionResult = SessionTokens | TwoFactorChallenge;

export function isTwoFactorChallenge(result: CreateSessionResult): result is TwoFactorChallenge {
  return result.nextStep === 'TWO_FACTOR' && 'twoFactorToken' in result;
}

export interface SessionInfo {
  userId: string;
  employeeId: string | null;
  companyId: string | null;
  roles: SystemRole[];
  deviceId: string | null;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
}

export interface CompanyInfo {
  id: string;
  name: string;
  code?: string;
  domain?: string;
  timezone: string;
  logoUrl?: string | null;
}

export const authApi = {
  /**
   * Đổi Firebase ID token lấy phiên Backend.
   *
   * KHÔNG gửi `domain`: quan hệ tài khoản–công ty là 1–1 (`UserAccount.companyId`),
   * nên sau khi Firebase xác nhận danh tính, Backend đã biết chắc tài khoản này
   * thuộc công ty nào. Bắt người dùng gõ lại tên miền không thêm thông tin gì —
   * chỉ thêm một ô để gõ sai.
   */
  createSession(payload: { firebaseIdToken: string }) {
    return api.post<CreateSessionResult>('/auth/session', payload);
  },

  verifyTwoFactor(payload: { twoFactorToken: string; code: string }) {
    return api.post<SessionTokens>('/auth/2fa/verify', payload);
  },

  resendTwoFactor(twoFactorToken: string) {
    return api.post<{ codeExpiresIn: number }>('/auth/2fa/resend', { twoFactorToken });
  },

  /** Gọi SAU khi đã đổi mật khẩu thành công ở phía Firebase. */
  changePassword(payload: { firebaseIdToken: string; newPassword: string }) {
    return api.post<SessionTokens & { revokedSessions: number }>('/auth/password/change', payload);
  },

  logout(refreshToken?: string) {
    return api.post<{ revokedSessions: number }>('/auth/logout', { refreshToken });
  },

  me() {
    return api.get<SessionInfo>('/auth/me');
  },

  company() {
    return api.get<CompanyInfo>('/company/me');
  },

  setupTwoFactor(phone: string) {
    return api.post<{ codeExpiresIn: number }>('/auth/2fa/setup', { phone });
  },

  enableTwoFactor(code: string) {
    return api.post<{ backupCodes: string[] }>('/auth/2fa/enable', { code });
  },

  disableTwoFactor(firebaseIdToken: string) {
    return api.post<{ enabled: false }>('/auth/2fa/disable', { firebaseIdToken });
  },
};
