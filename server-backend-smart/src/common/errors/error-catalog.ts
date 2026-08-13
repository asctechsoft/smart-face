import { HttpStatus } from '@nestjs/common';

/**
 * Bảng mã lỗi TẬP TRUNG của SmartFace.
 *
 * Nguồn: docs/02-kien-truc-he-thong.md mục 9 + docs/08-hop-dong-api.md.
 *
 * Nguyên tắc (NFR-UX-02, FR-APP-FACE-06):
 *   - Mỗi lỗi có mã riêng + thông điệp tiếng Việt + tiếng Anh + hướng dẫn khắc phục.
 *   - Đây là NGUỒN DUY NHẤT. App/Web KHÔNG hard-code chuỗi tiếng Việt, mà lấy
 *     qua `GET /v1/meta/error-codes` rồi ánh xạ sang i18n của mình.
 *   - Thêm mã lỗi mới => thêm ở đây, không ném HttpException thô trong service.
 */
export interface ErrorDefinition {
  /** HTTP status trả về */
  status: HttpStatus;
  /** Thông điệp hiển thị cho người dùng (vi) */
  message: string;
  /** Thông điệp hiển thị cho người dùng (en) */
  messageEn: string;
  /** Hướng dẫn khắc phục cụ thể */
  hint?: string;
  /** Người dùng thử lại có khả năng thành công không */
  retryable: boolean;
}

export const ERROR_CATALOG = {
  // ==========================================================================
  //  AUTH_ — Đăng nhập, OTP, token
  // ==========================================================================
  AUTH_PHONE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Số điện thoại không hợp lệ.',
    messageEn: 'Invalid phone number.',
    hint: 'Nhập số điện thoại di động Việt Nam gồm 10 chữ số, bắt đầu bằng 0.',
    retryable: true,
  },
  AUTH_PHONE_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Số điện thoại không hợp lệ hoặc đã bị khoá. Liên hệ quản trị viên.',
    messageEn: 'This phone number is invalid or has been blocked. Contact your administrator.',
    retryable: false,
  },
  AUTH_OTP_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Mã OTP không đúng.',
    messageEn: 'Incorrect OTP code.',
    hint: 'Kiểm tra lại tin nhắn và nhập đúng mã gồm 6 chữ số.',
    retryable: true,
  },
  AUTH_OTP_EXPIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Mã OTP đã hết hạn. Vui lòng gửi lại mã.',
    messageEn: 'The OTP code has expired. Please request a new one.',
    retryable: true,
  },
  AUTH_OTP_MAX_ATTEMPTS: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau.',
    messageEn: 'Too many failed attempts. Please try again later.',
    retryable: true,
  },
  AUTH_OTP_RESEND_TOO_SOON: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Vui lòng đợi trước khi gửi lại mã.',
    messageEn: 'Please wait before requesting another code.',
    retryable: true,
  },
  AUTH_OTP_SEND_LIMIT: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Bạn đã yêu cầu gửi mã quá nhiều lần trong một giờ.',
    messageEn: 'You have requested too many codes within an hour.',
    retryable: true,
  },
  AUTH_TOKEN_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
    messageEn: 'Invalid session. Please sign in again.',
    retryable: false,
  },
  AUTH_TOKEN_EXPIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Phiên đăng nhập đã hết hạn.',
    messageEn: 'Your session has expired.',
    hint: 'App sẽ tự làm mới phiên. Nếu vẫn lỗi, hãy đăng nhập lại.',
    retryable: true,
  },
  AUTH_REFRESH_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Không làm mới được phiên đăng nhập. Vui lòng đăng nhập lại.',
    messageEn: 'Could not refresh the session. Please sign in again.',
    retryable: false,
  },
  /** AF-16: phát hiện dùng lại refresh token cũ → thu hồi toàn bộ phiên */
  AUTH_REFRESH_REUSE_DETECTED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Phát hiện bất thường ở phiên đăng nhập. Toàn bộ phiên đã bị thu hồi vì an toàn.',
    messageEn: 'Session anomaly detected. All sessions were revoked for your safety.',
    retryable: false,
  },
  /** AF-16: X-Device-Id không khớp deviceId trong token */
  AUTH_DEVICE_MISMATCH: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Thiết bị không khớp với phiên đăng nhập.',
    messageEn: 'Device does not match the current session.',
    retryable: false,
  },
  /** AF-12: chữ ký HMAC sai */
  AUTH_SIGNATURE_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Yêu cầu không hợp lệ.',
    messageEn: 'Invalid request signature.',
    retryable: false,
  },
  AUTH_REAUTH_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Thao tác này yêu cầu xác thực lại danh tính.',
    messageEn: 'This action requires identity re-verification.',
    hint: 'Nhập mã OTP gửi tới số điện thoại đã đăng ký, hoặc dùng phương thức sinh trắc học còn lại.',
    retryable: true,
  },
  AUTH_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn không có quyền thực hiện thao tác này.',
    messageEn: 'You do not have permission to perform this action.',
    retryable: false,
  },
  AUTH_COMPANY_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn chưa tham gia công ty nào.',
    messageEn: 'You have not joined any company yet.',
    hint: 'Nhập mã mời của công ty để tiếp tục.',
    retryable: false,
  },
  AUTH_ACCOUNT_SUSPENDED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Tài khoản của bạn đang bị tạm ngưng. Liên hệ bộ phận nhân sự.',
    messageEn: 'Your account is suspended. Please contact HR.',
    retryable: false,
  },

  // ==========================================================================
  //  AUTH_ — Đăng nhập qua Firebase Authentication
  // ==========================================================================
  //
  // Việc đối chiếu email + mật khẩu diễn ra bên Firebase, nên các mã lỗi cũ về
  // "sai thông tin đăng nhập" và "khoá tạm do sai nhiều lần" không còn phát sinh
  // ở đây nữa — client nhận lỗi tương ứng thẳng từ Firebase SDK
  // (`auth/wrong-password`, `auth/too-many-requests`) và tự hiển thị.
  //
  // Những mã dưới đây là phần Backend vẫn quyết định: token có dùng được không,
  // uid đã được cấp hồ sơ chưa, và có vào đúng công ty không.

  AUTH_FIREBASE_TOKEN_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Phiên đăng nhập không hợp lệ.',
    messageEn: 'The sign-in token is not valid.',
    hint: 'Đăng nhập lại với Firebase rồi thử lại.',
    retryable: true,
  },
  AUTH_FIREBASE_TOKEN_EXPIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Phiên đăng nhập đã hết hạn.',
    messageEn: 'The sign-in token has expired.',
    hint: 'Gọi `user.getIdToken(true)` để lấy token mới rồi thử lại.',
    retryable: true,
  },
  /**
   * Token hợp lệ nhưng uid chưa gắn với `UserAccount` nào.
   *
   * Xảy ra khi ai đó tự đăng ký thẳng qua Firebase SDK ở phía client. Đây không
   * phải lỗi xác thực mà là chưa được cấp quyền vào: tài khoản trong hệ thống
   * chỉ do HR cấp, không có đường tự đăng ký.
   */
  AUTH_ACCOUNT_NOT_PROVISIONED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Tài khoản chưa được cấp quyền sử dụng hệ thống.',
    messageEn: 'This account has not been provisioned.',
    hint: 'Liên hệ bộ phận nhân sự của công ty để được cấp tài khoản.',
    retryable: false,
  },
  /**
   * Tên miền không khớp công ty của tài khoản.
   *
   * Không gộp vào một mã chung với "tên miền không tồn tại": cả hai đều trả về
   * mã này, nên gõ bừa tên miền cũng không biết được tên miền nào có thật.
   */
  AUTH_DOMAIN_MISMATCH: {
    status: HttpStatus.FORBIDDEN,
    message: 'Tên miền không đúng với công ty của tài khoản.',
    messageEn: 'The domain does not match this account’s company.',
    hint: 'Kiểm tra lại tên miền công ty cấp cho bạn.',
    retryable: true,
  },
  /**
   * Thao tác nhạy cảm nhưng lần xác thực gần nhất đã quá cũ.
   *
   * Firebase ID token sống một giờ, nên token hợp lệ KHÔNG chứng minh được người
   * đang thao tác biết mật khẩu. Ngưỡng đặt ở `FIREBASE_FRESH_AUTH_WINDOW_SECONDS`.
   */
  AUTH_REAUTH_STALE: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Cần xác thực lại để tiếp tục.',
    messageEn: 'Recent authentication is required to continue.',
    hint: 'Gọi `reauthenticateWithCredential` của Firebase rồi gửi lại ID token mới.',
    retryable: true,
  },
  AUTH_MUST_CHANGE_PASSWORD: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn phải đổi mật khẩu trước khi sử dụng hệ thống.',
    messageEn: 'You must change your password before using the system.',
    hint: 'Gọi POST /v1/auth/password/change với mật khẩu mới.',
    retryable: false,
  },
  AUTH_PASSWORD_TOO_WEAK: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Mật khẩu chưa đủ mạnh.',
    messageEn: 'Password does not meet the strength policy.',
    hint: 'Xem `details.reasons` để biết cần sửa gì.',
    retryable: true,
  },
  // `AUTH_PASSWORD_REUSED` đã bị bỏ: Backend không còn giữ mật khẩu cũ nên không
  // so sánh được, và Firebase cũng không kiểm điều này. Giữ lại một mã lỗi mà
  // không chỗ nào ném ra chỉ khiến client viết nhánh xử lý chết.

  AUTH_COMPANY_INACTIVE: {
    status: HttpStatus.FORBIDDEN,
    message: 'Công ty đang tạm ngưng sử dụng dịch vụ.',
    messageEn: 'This company account is currently suspended.',
    retryable: false,
  },

  // ==========================================================================
  //  AUTH_2FA_ — Xác thực 2 lớp bằng OTP gửi qua SMS
  // ==========================================================================
  //
  // Chi tiết về mã sai / hết hạn / khoá do nhập sai nhiều lần dùng chung nhóm
  // `AUTH_OTP_*` ở đầu file. Nhóm này chỉ nói về TRẠNG THÁI của lớp thứ hai.

  AUTH_2FA_REQUIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Cần nhập mã xác thực 2 lớp.',
    messageEn: 'A two-factor authentication code is required.',
    hint: 'Mã đã được gửi tới số điện thoại đã đăng ký.',
    retryable: true,
  },
  AUTH_2FA_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Phiên xác thực 2 lớp không hợp lệ hoặc đã hết hạn.',
    messageEn: 'The two-factor session is invalid or has expired.',
    hint: 'Đăng nhập lại để nhận mã mới.',
    retryable: true,
  },
  AUTH_2FA_ALREADY_ENABLED: {
    status: HttpStatus.CONFLICT,
    message: 'Xác thực 2 lớp đã được bật.',
    messageEn: 'Two-factor authentication is already enabled.',
    hint: 'Tắt trước rồi mới thiết lập lại được.',
    retryable: false,
  },
  AUTH_2FA_NOT_ENABLED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Xác thực 2 lớp chưa được bật.',
    messageEn: 'Two-factor authentication is not enabled.',
    retryable: false,
  },

  // ==========================================================================
  //  FACE_ — Nhận diện khuôn mặt
  // ==========================================================================
  FACE_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Không thấy khuôn mặt trong ảnh.',
    messageEn: 'No face detected.',
    hint: 'Đưa mặt vào giữa khung hình, giữ điện thoại ngang tầm mắt.',
    retryable: true,
  },
  FACE_MULTIPLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Có nhiều người trong khung hình.',
    messageEn: 'Multiple faces detected.',
    hint: 'Vui lòng chỉ chụp một mình.',
    retryable: true,
  },
  FACE_LOW_LIGHT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Nơi bạn đứng quá tối.',
    messageEn: 'Lighting is too dim.',
    hint: 'Di chuyển tới chỗ sáng hơn rồi thử lại.',
    retryable: true,
  },
  FACE_BACKLIT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Ánh sáng chiếu sau lưng làm khuôn mặt bị tối.',
    messageEn: 'Backlight is making your face too dark.',
    hint: 'Quay lưng lại nguồn sáng rồi thử lại.',
    retryable: true,
  },
  FACE_OCCLUDED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Khuôn mặt bị che khuất.',
    messageEn: 'Your face is partially covered.',
    hint: 'Vui lòng tháo khẩu trang, kính râm hoặc mũ và thử lại.',
    retryable: true,
  },
  FACE_MASK_DETECTED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Vui lòng tháo khẩu trang và thử lại.',
    messageEn: 'Please remove your face mask and try again.',
    hint: 'Đảm bảo khuôn mặt không bị che bởi khẩu trang, kính râm hoặc mũ.',
    retryable: true,
  },
  FACE_BLURRY: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Ảnh bị mờ.',
    messageEn: 'The image is too blurry.',
    hint: 'Giữ điện thoại ổn định và thử lại.',
    retryable: true,
  },
  FACE_BAD_ANGLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Góc chụp quá nghiêng.',
    messageEn: 'Face angle is too steep.',
    hint: 'Nhìn thẳng vào camera, không nghiêng đầu quá nhiều.',
    retryable: true,
  },
  FACE_TOO_SMALL: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Khuôn mặt quá nhỏ trong khung hình.',
    messageEn: 'Your face is too small in the frame.',
    hint: 'Đưa điện thoại lại gần hơn.',
    retryable: true,
  },
  /** AF-05, AF-06 */
  FACE_LIVENESS_FAILED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Không xác nhận được người thật. Vui lòng nhìn thẳng vào camera và thử lại.',
    messageEn: 'Liveness check failed. Please look directly at the camera and try again.',
    hint: 'Đảm bảo đủ ánh sáng và không dùng ảnh/video.',
    retryable: true,
  },
  FACE_NOT_MATCHED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Khuôn mặt không khớp với hồ sơ đã đăng ký.',
    messageEn: 'Face does not match the enrolled profile.',
    hint: 'Thử lại ở nơi đủ sáng. Nếu vẫn lỗi, liên hệ HR để đăng ký lại khuôn mặt.',
    retryable: true,
  },
  /** BR-10 */
  FACE_DUPLICATE_IDENTITY: {
    status: HttpStatus.CONFLICT,
    message: 'Khuôn mặt này đã được đăng ký cho tài khoản khác. Vui lòng liên hệ quản trị viên.',
    messageEn:
      'This face is already enrolled for another account. Please contact your administrator.',
    retryable: false,
  },
  FACE_MAX_ATTEMPTS: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau hoặc liên hệ HR.',
    messageEn: 'Too many attempts. Please try again later or contact HR.',
    retryable: true,
  },
  FACE_NOT_ENROLLED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bạn chưa đăng ký khuôn mặt.',
    messageEn: 'You have not enrolled your face yet.',
    hint: 'Vào phần Cá nhân → Thiết lập bảo mật để đăng ký.',
    retryable: false,
  },
  FACE_ENROLL_SESSION_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Phiên đăng ký khuôn mặt không hợp lệ hoặc đã hết hạn.',
    messageEn: 'Face enrollment session is invalid or expired.',
    hint: 'Bắt đầu lại quá trình đăng ký.',
    retryable: true,
  },

  // ==========================================================================
  //  BIO_ — Vân tay / sinh trắc thiết bị
  // ==========================================================================
  BIO_NOT_SUPPORTED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Thiết bị không hỗ trợ xác thực bằng vân tay.',
    messageEn: 'This device does not support fingerprint authentication.',
    hint: 'Bạn có thể dùng khuôn mặt để chấm công.',
    retryable: false,
  },
  BIO_NOT_ENROLLED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bạn chưa đăng ký vân tay cho ứng dụng.',
    messageEn: 'Fingerprint is not enrolled for this app.',
    hint: 'Vào Cá nhân → Thiết lập bảo mật để đăng ký vân tay.',
    retryable: false,
  },
  BIO_LOCKED_OUT: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Thiết bị đã tạm khoá vân tay.',
    messageEn: 'Fingerprint is temporarily locked on this device.',
    hint: 'Dùng khuôn mặt hoặc thử lại sau ít phút.',
    retryable: true,
  },
  BIO_DEVICE_CHANGED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bạn đang dùng thiết bị khác với thiết bị đã đăng ký.',
    messageEn: 'You are using a device different from the enrolled one.',
    hint: 'Xác thực lại danh tính để liên kết thiết bị mới.',
    retryable: true,
  },
  BIO_KEY_INVALIDATED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Khoá vân tay đã mất hiệu lực do thay đổi sinh trắc học trên thiết bị.',
    messageEn: 'The fingerprint key was invalidated by a change in device biometrics.',
    hint: 'Đăng ký lại vân tay trong phần Thiết lập bảo mật.',
    retryable: false,
  },
  BIO_SIGNATURE_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Không xác minh được chữ ký sinh trắc học.',
    messageEn: 'Biometric signature verification failed.',
    retryable: true,
  },

  // ==========================================================================
  //  ATT_ — Chấm công
  // ==========================================================================
  ATT_INVALID_NONCE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Phiên chấm công đã hết hạn.',
    messageEn: 'The attendance challenge has expired.',
    hint: 'Bấm chấm công lại để lấy phiên mới.',
    retryable: true,
  },
  ATT_OUT_OF_GEOFENCE: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn đang ở ngoài vùng được phép chấm công.',
    messageEn: 'You are outside the allowed check-in area.',
    hint: 'Di chuyển tới gần văn phòng, hoặc tạo đơn công tác nếu làm việc bên ngoài.',
    retryable: true,
  },
  /**
   * AF-02 — không kết nối WiFi công ty.
   *
   * Lỗi của NHÂN VIÊN: họ đang dùng 4G, WiFi hàng xóm, hoặc chưa bật WiFi.
   * Tách khỏi `ATT_WIFI_NOT_CONFIGURED` để App hiển thị đúng hướng dẫn —
   * bảo nhân viên "liên hệ HR" khi thật ra chỉ cần bật WiFi là gây phiền vô ích.
   */
  ATT_WIFI_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn phải kết nối WiFi của công ty mới chấm công được.',
    messageEn: 'You must be connected to the company WiFi to check in.',
    hint: 'Bật WiFi và kết nối vào mạng của văn phòng, sau đó thử lại.',
    retryable: true,
  },

  /**
   * AF-02 — chi nhánh chưa khai BSSID.
   *
   * Lỗi của CẤU HÌNH, không phải của nhân viên. Chặn thay vì cho qua là có chủ
   * đích: cho qua nghĩa là một chi nhánh bị quên cấu hình sẽ âm thầm mất lớp
   * phòng thủ này, và không ai biết cho tới khi có sự cố.
   */
  ATT_WIFI_NOT_CONFIGURED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Chi nhánh chưa được khai báo WiFi. Vui lòng liên hệ bộ phận nhân sự.',
    messageEn: 'This branch has no WiFi configured. Please contact HR.',
    hint: 'HR khai BSSID của bộ phát WiFi văn phòng trong phần Chi nhánh trên Web Quản lý.',
    retryable: false,
  },

  /**
   * AF-02b — request không đến từ dải IP mạng văn phòng.
   *
   * Lỗi của NHÂN VIÊN: họ đang dùng 4G, WiFi nhà, hoặc VPN ra ngoài.
   *
   * ⚠ KHÔNG trả dải IP hợp lệ về client — đó chính là thứ kẻ tấn công cần.
   */
  ATT_IP_NOT_ALLOWED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn phải dùng mạng của công ty mới chấm công được.',
    messageEn: 'You must be on the company network to check in.',
    hint: 'Tắt 4G và kết nối WiFi văn phòng. Nếu đang bật VPN, hãy tắt đi.',
    retryable: true,
  },

  /**
   * AF-02b — chi nhánh chưa khai dải IP.
   *
   * Lỗi của CẤU HÌNH. Tách khỏi `ATT_IP_NOT_ALLOWED` vì hướng xử lý khác hẳn:
   * một bên nhân viên tự sửa được, một bên phải chờ HR.
   */
  ATT_IP_NOT_CONFIGURED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Chi nhánh chưa được khai báo dải IP mạng. Vui lòng liên hệ bộ phận nhân sự.',
    messageEn: 'This branch has no allowed IP range configured. Please contact HR.',
    hint: 'HR khai dải IP công cộng của văn phòng trong phần Chi nhánh trên Web Quản lý.',
    retryable: false,
  },

  ATT_ALREADY_CHECKED_IN: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bạn đã chấm vào rồi.',
    messageEn: 'You have already checked in.',
    hint: 'Bạn có muốn chấm ra không?',
    retryable: false,
  },
  ATT_NOT_CHECKED_IN: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bạn chưa chấm vào hôm nay.',
    messageEn: 'You have not checked in today.',
    hint: 'Chấm vào trước, hoặc tạo đơn Bổ sung công nếu quên chấm.',
    retryable: false,
  },
  ATT_NO_SHIFT_TODAY: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Hôm nay bạn không có ca làm việc.',
    messageEn: 'You have no shift scheduled today.',
    hint: 'Liên hệ quản lý nếu bạn cho rằng đây là nhầm lẫn.',
    retryable: false,
  },
  ATT_PERIOD_LOCKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Kỳ lương của ngày này đã được chốt, không thể thay đổi.',
    messageEn: 'The payroll period for this date is closed.',
    hint: 'Liên hệ kế toán để mở lại kỳ nếu thật sự cần hiệu chỉnh.',
    retryable: false,
  },
  ATT_LOG_IMMUTABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bản ghi chấm công gốc không thể sửa hoặc xoá.',
    messageEn: 'Raw attendance records are immutable.',
    hint: 'Dùng chức năng Hiệu chỉnh công để tạo bản ghi điều chỉnh kèm lý do.',
    retryable: false,
  },
  ATT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy lượt chấm công.',
    messageEn: 'Attendance record not found.',
    retryable: false,
  },

  // ==========================================================================
  //  FRAUD_ — Chống gian lận
  // ==========================================================================
  FRAUD_MOCK_LOCATION: {
    status: HttpStatus.FORBIDDEN,
    message: 'Phát hiện ứng dụng giả lập vị trí. Vui lòng tắt và thử lại.',
    messageEn: 'Mock location app detected. Please disable it and try again.',
    retryable: true,
  },
  FRAUD_REPLAY_DETECTED: {
    status: HttpStatus.CONFLICT,
    message: 'Yêu cầu này đã được xử lý trước đó.',
    messageEn: 'This request has already been processed.',
    hint: 'Bấm chấm công lại để lấy phiên mới.',
    retryable: true,
  },
  FRAUD_CLOCK_SKEW: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Giờ trên thiết bị lệch quá nhiều so với giờ hệ thống.',
    messageEn: 'Your device clock differs too much from the server clock.',
    hint: 'Bật chế độ đặt giờ tự động trong Cài đặt thiết bị rồi thử lại.',
    retryable: true,
  },
  FRAUD_ROOTED_DEVICE: {
    status: HttpStatus.FORBIDDEN,
    message: 'Không thể chấm công trên thiết bị đã root/jailbreak.',
    messageEn: 'Check-in is not allowed on rooted/jailbroken devices.',
    retryable: false,
  },
  FRAUD_ATTESTATION_FAILED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Không xác minh được tính toàn vẹn của ứng dụng.',
    messageEn: 'App integrity verification failed.',
    hint: 'Cài lại ứng dụng từ App Store / Google Play chính thức.',
    retryable: false,
  },
  FRAUD_UNKNOWN_DEVICE: {
    status: HttpStatus.FORBIDDEN,
    message: 'Thiết bị chưa được liên kết với tài khoản.',
    messageEn: 'This device is not linked to your account.',
    hint: 'Xác thực lại danh tính để liên kết thiết bị.',
    retryable: true,
  },
  FRAUD_LOW_GPS_ACCURACY: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Độ chính xác vị trí quá thấp.',
    messageEn: 'GPS accuracy is too low.',
    hint: 'Ra chỗ thoáng, bật GPS độ chính xác cao rồi thử lại.',
    retryable: true,
  },
  FRAUD_RISK_TOO_HIGH: {
    status: HttpStatus.FORBIDDEN,
    message: 'Lượt chấm công bị từ chối do có nhiều dấu hiệu bất thường.',
    messageEn: 'Check-in rejected due to multiple suspicious signals.',
    hint: 'Liên hệ quản lý hoặc bộ phận nhân sự để được hỗ trợ.',
    retryable: false,
  },
  FRAUD_IMPOSSIBLE_TRAVEL: {
    status: HttpStatus.FORBIDDEN,
    message: 'Vị trí chấm công không hợp lý so với lượt chấm công trước đó.',
    messageEn: 'Location is implausible compared to your previous check-in.',
    retryable: false,
  },

  // ==========================================================================
  //  REQ_ — Đơn từ
  // ==========================================================================
  REQ_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy đơn.',
    messageEn: 'Request not found.',
    retryable: false,
  },
  REQ_TYPE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Loại đơn không tồn tại hoặc đã bị vô hiệu hoá.',
    messageEn: 'Request type not found or inactive.',
    retryable: false,
  },
  REQ_INSUFFICIENT_LEAVE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Số ngày phép còn lại không đủ.',
    messageEn: 'Insufficient remaining leave balance.',
    hint: 'Giảm số ngày nghỉ, hoặc chọn loại đơn Nghỉ không lương.',
    retryable: false,
  },
  REQ_OVERLAP: {
    status: HttpStatus.CONFLICT,
    message: 'Khoảng thời gian này trùng với một đơn khác của bạn.',
    messageEn: 'This time range overlaps with another request.',
    hint: 'Kiểm tra lại danh sách đơn đang chờ duyệt hoặc đã duyệt.',
    retryable: false,
  },
  REQ_ATTACHMENT_REQUIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Loại đơn này bắt buộc có file minh chứng.',
    messageEn: 'This request type requires an attachment.',
    retryable: false,
  },
  REQ_ATTACHMENT_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'File đính kèm không hợp lệ.',
    messageEn: 'Invalid attachment.',
    hint: 'Chỉ chấp nhận jpg/png/pdf, tối đa 10MB mỗi file và 5 file mỗi đơn.',
    retryable: true,
  },
  REQ_INVALID_STATUS: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Không thực hiện được thao tác này với trạng thái hiện tại của đơn.',
    messageEn: 'This action is not allowed for the current request status.',
    retryable: false,
  },
  REQ_ALREADY_DECIDED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Đơn đã được xử lý trước đó.',
    messageEn: 'This request has already been decided.',
    retryable: false,
  },
  /** BR-APV-03 */
  REQ_CANNOT_APPROVE_OWN: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bạn không được duyệt đơn của chính mình.',
    messageEn: 'You cannot approve your own request.',
    retryable: false,
  },
  REQ_NOT_YOUR_TURN: {
    status: HttpStatus.FORBIDDEN,
    message: 'Đơn chưa tới lượt bạn duyệt.',
    messageEn: 'It is not your turn to approve this request.',
    retryable: false,
  },
  REQ_PERIOD_LOCKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Đơn nằm trong kỳ lương đã chốt.',
    messageEn: 'This request falls within a closed payroll period.',
    hint: 'Liên hệ kế toán để mở lại kỳ nếu cần xử lý.',
    retryable: false,
  },
  REQ_REJECT_REASON_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Vui lòng nhập lý do từ chối.',
    messageEn: 'A rejection reason is required.',
    retryable: true,
  },
  REQ_TYPE_CODE_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Mã loại đơn này đã tồn tại trong công ty.',
    messageEn: 'This request type code already exists in the company.',
    hint: 'Đổi mã khác, hoặc sửa loại đơn đang có thay vì tạo mới.',
    retryable: true,
  },
  /** FR-WEB-REQ-05 — luồng duyệt sai cấu hình khiến đơn treo không ai duyệt được. */
  REQ_FLOW_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Luồng duyệt không hợp lệ.',
    messageEn: 'The approval flow configuration is invalid.',
    hint: 'Luồng phải có ít nhất một cấp bắt buộc, thứ tự các cấp liên tục từ 1 và không trùng nhau.',
    retryable: true,
  },

  // ==========================================================================
  //  PAY_ — Tính công / lương
  // ==========================================================================
  PAY_PERIOD_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy kỳ lương.',
    messageEn: 'Payroll period not found.',
    retryable: false,
  },
  PAY_PERIOD_CLOSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Kỳ lương đã được chốt.',
    messageEn: 'This payroll period is already closed.',
    retryable: false,
  },
  PAY_PERIOD_OVERLAP: {
    status: HttpStatus.CONFLICT,
    message: 'Khoảng thời gian kỳ lương bị trùng với kỳ đã có.',
    messageEn: 'This payroll period overlaps an existing one.',
    retryable: false,
  },
  PAY_PERIOD_HAS_BLOCKERS: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Kỳ lương còn vấn đề chưa xử lý, chưa thể chốt.',
    messageEn: 'This period still has unresolved blockers and cannot be closed.',
    hint: 'Xem báo cáo tiền chốt: bản ghi thiếu, đơn chờ duyệt, cờ nghi vấn chưa xử lý.',
    retryable: false,
  },
  PAY_MISSING_POLICY: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Thiếu cấu hình chính sách để tính công.',
    messageEn: 'Missing policy configuration required for payroll calculation.',
    retryable: false,
  },
  PAY_REASON_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Thao tác này bắt buộc nhập lý do.',
    messageEn: 'A reason is required for this action.',
    retryable: true,
  },

  // ==========================================================================
  //  PLAN_ — Giới hạn gói dịch vụ (enforce ở Backend, không chỉ ẩn nút — FR-ADM-TEN-04)
  // ==========================================================================
  PLAN_EMPLOYEE_LIMIT_REACHED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Đã đạt giới hạn số nhân viên của gói dịch vụ.',
    messageEn: 'Employee limit for the current subscription plan has been reached.',
    hint: 'Nâng cấp gói dịch vụ để thêm nhân viên.',
    retryable: false,
  },
  PLAN_BRANCH_LIMIT_REACHED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Đã đạt giới hạn số chi nhánh của gói dịch vụ.',
    messageEn: 'Branch limit for the current subscription plan has been reached.',
    retryable: false,
  },
  PLAN_FEATURE_NOT_AVAILABLE: {
    status: HttpStatus.FORBIDDEN,
    message: 'Tính năng này không có trong gói dịch vụ hiện tại.',
    messageEn: 'This feature is not included in your current plan.',
    retryable: false,
  },

  // ==========================================================================
  //  EMP_ — Nhân sự
  // ==========================================================================
  EMP_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy nhân viên.',
    messageEn: 'Employee not found.',
    retryable: false,
  },
  EMP_CODE_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Mã nhân viên đã được sử dụng trong công ty.',
    messageEn: 'This employee code is already in use.',
    retryable: true,
  },
  /** BR-04 */
  EMP_CODE_LOCKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Mã nhân viên đã bị khoá sau lần chấm công đầu tiên.',
    messageEn: 'The employee code is locked after the first check-in.',
    hint: 'Việc đổi mã cần Admin/Kế toán phê duyệt và sẽ được ghi log.',
    retryable: false,
  },
  EMP_PHONE_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Số điện thoại đã tồn tại trong công ty.',
    messageEn: 'This phone number already exists in the company.',
    retryable: true,
  },
  EMP_EMAIL_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Email đã được dùng cho một tài khoản khác trong công ty.',
    messageEn: 'This email is already used by another account in this company.',
    hint: 'Email là định danh đăng nhập nên phải duy nhất trong phạm vi công ty.',
    retryable: true,
  },
  EMP_DELETE_NOT_ALLOWED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Chỉ xoá được hồ sơ chưa kích hoạt.',
    messageEn: 'Only records pending activation can be deleted.',
    hint: 'Với nhân viên đã kích hoạt, hãy dùng Tạm ngưng hoặc Chấm dứt hợp đồng.',
    retryable: false,
  },
  EMP_IMPORT_INVALID_FILE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'File import không đúng định dạng mẫu.',
    messageEn: 'The import file does not match the expected template.',
    hint: 'Tải file mẫu và giữ nguyên thứ tự cột.',
    retryable: true,
  },
  /** FR-WEB-INV-06 — thu hồi liên kết thiết bị của nhân viên. */
  EMP_DEVICE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy thiết bị đang liên kết với nhân viên này.',
    messageEn: 'No active device binding found for this employee.',
    hint: 'Liên kết có thể đã bị thu hồi trước đó. Tải lại danh sách thiết bị.',
    retryable: false,
  },
  EMP_NO_ACCOUNT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Nhân viên chưa có tài khoản đăng nhập.',
    messageEn: 'This employee has no login account yet.',
    hint: 'Hồ sơ chưa kích hoạt thì chưa phát sinh thiết bị hay dữ liệu sinh trắc học.',
    retryable: false,
  },

  // ==========================================================================
  //  POL_ — Chính sách, ca làm việc
  // ==========================================================================
  POL_SHIFT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy ca làm việc.',
    messageEn: 'Shift not found.',
    retryable: false,
  },
  POL_INVALID_TIME_FORMAT: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Định dạng giờ không hợp lệ.',
    messageEn: 'Invalid time format.',
    hint: 'Dùng định dạng HH:mm, ví dụ 08:00.',
    retryable: true,
  },
  /** NFR-LEGAL-05 — cảnh báo khi cấu hình vi phạm Bộ luật Lao động */
  POL_VIOLATES_LABOR_LAW: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Cấu hình vi phạm quy định tối thiểu của Bộ luật Lao động.',
    messageEn: 'This configuration violates statutory labour law minimums.',
    hint: 'Hệ số OT tối thiểu: ngày thường 150%, ngày nghỉ tuần 200%, ngày lễ 300%.',
    retryable: true,
  },
  POL_BRANCH_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy chi nhánh.',
    messageEn: 'Branch not found.',
    retryable: false,
  },
  POL_DEPARTMENT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy phòng ban.',
    messageEn: 'Department not found.',
    retryable: false,
  },
  /** NFR-LEGAL-07 — phép năm tối thiểu 12 ngày cho điều kiện làm việc bình thường. */
  POL_LEAVE_BELOW_STATUTORY: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Số ngày phép năm thấp hơn mức tối thiểu của Bộ luật Lao động.',
    messageEn: 'Annual leave entitlement is below the statutory minimum.',
    hint: 'Điều 113 Bộ luật Lao động 2019: tối thiểu 12 ngày/năm với điều kiện làm việc bình thường.',
    retryable: true,
  },
  POL_LEAVE_POLICY_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy chính sách phép năm.',
    messageEn: 'Leave policy not found.',
    retryable: false,
  },

  // ==========================================================================
  //  MKUP_ — Công làm bù (docs/04 mục 5)
  // ==========================================================================
  MKUP_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy bản ghi làm bù.',
    messageEn: 'Makeup work record not found.',
    retryable: false,
  },
  MKUP_ALREADY_CLOSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Bản ghi làm bù đã hoàn tất hoặc đã hết hạn.',
    messageEn: 'This makeup record is already completed or expired.',
    hint: 'Chỉ ghi nhận thêm giờ bù được cho bản ghi đang mở hoặc đang bù dở.',
    retryable: false,
  },
  MKUP_EXCEEDS_DEBT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Số phút làm bù vượt quá số phút còn nợ.',
    messageEn: 'Makeup minutes exceed the outstanding debt.',
    hint: 'Ghi nhận tối đa bằng số phút còn nợ. Phần dư xử lý theo chính sách giờ dư.',
    retryable: true,
  },
  MKUP_OVERDUE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Đã quá hạn làm bù cho khoản nợ công này.',
    messageEn: 'The makeup deadline for this debt has passed.',
    hint: 'Hạn làm bù cấu hình ở Chính sách → makeup.dueDays. Muốn ghi nhận thì gia hạn trước.',
    retryable: false,
  },

  // ==========================================================================
  //  TEN_ — Tenant (Web Admin)
  // ==========================================================================
  TEN_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy công ty.',
    messageEn: 'Company not found.',
    retryable: false,
  },
  TEN_CODE_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Mã công ty đã tồn tại.',
    messageEn: 'This company code is already taken.',
    retryable: true,
  },
  TEN_DOMAIN_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Tên miền đã được dùng cho công ty khác.',
    messageEn: 'This domain is already used by another company.',
    hint: 'Tên miền là thứ nhân viên gõ ở màn hình đăng nhập nên phải duy nhất toàn hệ thống.',
    retryable: true,
  },
  TEN_SUSPENDED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Công ty đang bị tạm ngưng.',
    messageEn: 'This company is suspended.',
    retryable: false,
  },

  // ==========================================================================
  //  SYS_ — Hệ thống
  // ==========================================================================
  SYS_VALIDATION_ERROR: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Dữ liệu gửi lên không hợp lệ.',
    messageEn: 'The submitted data is invalid.',
    retryable: true,
  },
  SYS_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Không tìm thấy tài nguyên yêu cầu.',
    messageEn: 'The requested resource was not found.',
    retryable: false,
  },
  SYS_RATE_LIMITED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    messageEn: 'Too many requests. Please slow down and try again.',
    retryable: true,
  },
  SYS_AI_TIMEOUT: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Hệ thống nhận diện đang bận. Vui lòng thử lại sau ít giây.',
    messageEn: 'The recognition service is busy. Please retry shortly.',
    retryable: true,
  },
  /** NFR-REL-05, NFR-REL-10: gợi ý dùng vân tay khi AI Server không khả dụng */
  SYS_AI_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Hệ thống nhận diện khuôn mặt tạm thời không khả dụng.',
    messageEn: 'The face recognition service is temporarily unavailable.',
    hint: 'Nếu đã đăng ký vân tay, bạn có thể chấm công bằng vân tay.',
    retryable: true,
  },
  SYS_SMS_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Không gửi được tin nhắn lúc này. Vui lòng thử lại sau.',
    messageEn: 'SMS delivery is unavailable right now. Please try again later.',
    retryable: true,
  },
  SYS_STORAGE_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Không lưu được tệp lúc này. Vui lòng thử lại sau.',
    messageEn: 'File storage is unavailable right now. Please try again later.',
    retryable: true,
  },
  SYS_MAINTENANCE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Hệ thống đang bảo trì. Vui lòng quay lại sau.',
    messageEn: 'The system is under maintenance. Please come back later.',
    retryable: true,
  },
  SYS_INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Đã xảy ra lỗi hệ thống. Chúng tôi đã ghi nhận và sẽ xử lý.',
    messageEn: 'An internal error occurred. It has been logged for investigation.',
    retryable: true,
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_CATALOG[code];
}

/** Dùng cho `GET /v1/meta/error-codes` — App/Web import cùng một nguồn. */
export function listErrorDefinitions(): Array<ErrorDefinition & { code: string }> {
  return Object.entries(ERROR_CATALOG).map(([code, def]) => ({ code, ...def }));
}
