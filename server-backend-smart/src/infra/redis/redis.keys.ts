/** Quy ước key Redis — tập trung một chỗ để tránh đụng namespace. */
export const RedisKeys = {
  // Nhóm OTP đánh theo `subject` chứ không theo số điện thoại.
  //
  // Đánh theo số thì hai tài khoản khai cùng một số (vợ chồng dùng chung máy,
  // nhân sự thời vụ khai số của quản lý) sẽ giẫm lên mã và lên bộ đếm khoá của
  // nhau — người này nhập sai năm lần là người kia bị khoá. `subject` để bên gọi
  // tự chọn phạm vi; xem `OtpService`.

  /** OTP đang chờ xác thực */
  otp: (subject: string) => `otp:code:${subject}`,
  /** Chặn gửi lại quá nhanh (FR-APP-AUTH-05) */
  otpResendLock: (subject: string) => `otp:resend:${subject}`,
  /** Số lần gửi OTP trong giờ */
  otpSendCount: (subject: string) => `otp:send-count:${subject}`,
  /** Khoá sau khi nhập sai quá số lần cho phép */
  otpLock: (subject: string) => `otp:lock:${subject}`,

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

  /** Phiên chờ nhập mã 2 lớp — cấp sau khi Firebase xác nhận, trước khi cấp token */
  twoFactorChallenge: (token: string) => `auth:2fa:${token}`,
  /** Phạm vi OTP của thử thách 2 lớp — mỗi tài khoản một ngăn riêng */
  twoFactorOtp: (userId: string) => `2fa:${userId}`,
  /**
   * Số điện thoại đang chờ xác minh ở bước bật 2 lớp.
   *
   * Để ở Redis chứ không ghi thẳng vào `UserAccount.twoFactorPhone`: số chỉ được
   * ghi xuống khi đã chứng minh là người dùng nhận được tin nhắn tới số đó. Ghi
   * trước rồi mới xác minh nghĩa là gõ nhầm một chữ số cũng đủ khiến mã OTP về
   * sau bay tới máy người lạ.
   */
  twoFactorPendingPhone: (userId: string) => `auth:2fa-setup:${userId}`,

  /** Rate limit (AF-13) */
  rateLimit: (bucket: string, subject: string) => `rl:${bucket}:${subject}`,

  /** Cache dashboard (docs/04 mục 2.2) */
  dashboard: (companyId: string, scope: string) => `cache:dashboard:${companyId}:${scope}`,
  dashboardPrefix: (companyId: string) => `cache:dashboard:${companyId}:`,

  /**
   * Cache lưới theo dõi công việc trong ngày.
   *
   * TTL rất ngắn (20 giây) và khoá gồm CẢ bộ lọc lẫn số trang: đây là màn hình
   * làm mới mỗi phút, cache chỉ để nhiều người cùng phòng dùng chung một kết
   * quả và để một cơn bão F5 không thành một cơn bão truy vấn.
   */
  workStatus: (companyId: string, scope: string) => `cache:work-status:${companyId}:${scope}`,

  /** Chính sách công ty đã resolve */
  policy: (companyId: string) => `cache:policy:${companyId}`,

  /** Circuit breaker AI Server (NFR-REL-05) */
  aiCircuit: () => `ai:circuit-state`,

  /** Chế độ bảo trì (FR-ADM-OPS-06) */
  maintenance: () => `system:maintenance`,
} as const;
