/** Quy ước key Redis — tập trung một chỗ để tránh đụng namespace. */
export const RedisKeys = {
  /** OTP đang chờ xác thực */
  otp: (phone: string) => `otp:code:${phone}`,
  /** Chặn gửi lại quá nhanh (FR-APP-AUTH-05) */
  otpResendLock: (phone: string) => `otp:resend:${phone}`,
  /** Số lần gửi OTP trong giờ */
  otpSendCount: (phone: string) => `otp:send-count:${phone}`,
  /** Khoá sau khi nhập sai quá số lần cho phép */
  otpLock: (phone: string) => `otp:lock:${phone}`,

  /** Nonce chấm công (AF-12) — lưu challenge do server sinh */
  attendanceChallenge: (userId: string, nonce: string) => `att:challenge:${userId}:${nonce}`,
  /** Nonce đã tiêu thụ — chống replay */
  attendanceNonceUsed: (nonce: string) => `att:nonce-used:${nonce}`,
  /** Nonce của SignatureGuard (áp cho mọi endpoint nhạy cảm) */
  signatureNonce: (nonce: string) => `sig:nonce:${nonce}`,

  /** Phiên đăng ký khuôn mặt nhiều bước */
  faceEnrollSession: (sessionId: string) => `face:enroll:${sessionId}`,
  /** Số lần thử nhận diện thất bại (FR-APP-FACE-05) */
  faceAttempts: (employeeId: string) => `face:attempts:${employeeId}`,

  /** Token xác thực lại danh tính cho thao tác nhạy cảm */
  reauthToken: (token: string) => `auth:reauth:${token}`,

  /** Phiên chờ nhập mã 2 lớp — cấp sau khi mật khẩu đúng, trước khi cấp token */
  twoFactorChallenge: (token: string) => `auth:2fa:${token}`,
  /**
   * Bước thời gian TOTP đã dùng.
   *
   * Cửa sổ chấp nhận là 90 giây nên một mã sống khá lâu; không đánh dấu đã dùng
   * thì người nhìn trộm màn hình gõ lại được ngay mã vừa thấy.
   */
  totpUsedStep: (userId: string, counter: number) => `auth:totp-used:${userId}:${counter}`,

  /** Rate limit (AF-13) */
  rateLimit: (bucket: string, subject: string) => `rl:${bucket}:${subject}`,

  /** Cache dashboard (docs/04 mục 2.2) */
  dashboard: (companyId: string, scope: string) => `cache:dashboard:${companyId}:${scope}`,
  dashboardPrefix: (companyId: string) => `cache:dashboard:${companyId}:`,

  /** Chính sách công ty đã resolve */
  policy: (companyId: string) => `cache:policy:${companyId}`,

  /** Circuit breaker AI Server (NFR-REL-05) */
  aiCircuit: () => `ai:circuit-state`,

  /** Chế độ bảo trì (FR-ADM-OPS-06) */
  maintenance: () => `system:maintenance`,
} as const;
