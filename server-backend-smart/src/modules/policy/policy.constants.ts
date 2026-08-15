/**
 * BR-12 — TOÀN BỘ chính sách cấu hình được của công ty.
 *
 * Không hard-code ngưỡng nào ở service. Mọi giá trị lấy qua `PolicyService.resolve()`,
 * công ty chưa cấu hình thì rơi về `POLICY_DEFAULTS` dưới đây.
 *
 * Nguồn giá trị mặc định:
 *   - docs/02 mục 6.4 (ngưỡng AI)
 *   - docs/06 mục 7.1–7.2 (trọng số & ngưỡng fraud score)
 *   - docs/07 mục 4.5 (seed mặc định khi tạo tenant)
 *   - docs/09 NFR-LEGAL-05..07 (mức tối thiểu theo luật)
 */

export const PolicyKeys = {
  // --- Geofence & vị trí (AF-01..AF-04) -------------------------------------
  GEOFENCE_OUT_OF_RANGE_ACTION: 'attendance.geofence.outOfRangeAction',
  GEOFENCE_DEFAULT_RADIUS_M: 'attendance.geofence.defaultRadiusMeters',
  /** AF-02 — bắt buộc kết nối WiFi công ty mới chấm công được */
  WIFI_REQUIREMENT: 'attendance.wifi.requirement',
  /** AF-02b — bắt buộc request đến từ dải IP của mạng văn phòng */
  IP_RESTRICTION_REQUIREMENT: 'attendance.ipRestriction.requirement',
  GPS_MAX_ACCURACY_M: 'attendance.gps.maxAccuracyMeters',
  GPS_REJECT_MOCK: 'attendance.gps.rejectMockLocation',
  GPS_REQUIRE_GPS_PROVIDER: 'attendance.gps.requireGpsProvider',

  // --- Thiết bị (AF-14, AF-15) ----------------------------------------------
  DEVICE_REJECT_ROOTED: 'attendance.device.rejectRooted',
  DEVICE_REQUIRE_ATTESTATION: 'attendance.device.requireAttestation',
  DEVICE_BINDING_ENABLED: 'security.device.bindingEnabled',
  DEVICE_CHANGE_REQUIRES_APPROVAL: 'security.device.changeRequiresHrApproval',

  // --- Ngưỡng AI (P3 — Backend quyết định, AI Server chỉ trả số liệu) --------
  FACE_MATCH_THRESHOLD: 'ai.face.matchThreshold',
  FACE_LIVENESS_THRESHOLD: 'ai.face.livenessThreshold',
  FACE_MIN_PIXELS: 'ai.face.minFacePixels',
  FACE_REQUIRE_LIVENESS: 'ai.face.requireLiveness',
  FACE_DUPLICATE_THRESHOLD: 'ai.face.duplicateIdentityThreshold',
  FACE_MAX_ATTEMPTS_PER_HOUR: 'ai.face.maxAttemptsPerHour',
  /**
   * Góc mặt tối đa chấp nhận khi CHẤM CÔNG, tính bằng độ.
   *
   * ⚠ Chỉ áp cho luồng chấm công, KHÔNG áp cho luồng đăng ký: đăng ký cố ý chụp
   * hai bước lệch trục (`TURN_LEFT`, `TURN_RIGHT`) để lấy đủ góc mặt.
   */
  FACE_MAX_YAW_DEGREES: 'ai.face.maxYawDegrees',
  FACE_MAX_PITCH_DEGREES: 'ai.face.maxPitchDegrees',

  // --- Lệch giờ (AF-18) -----------------------------------------------------
  CLOCK_SKEW_FLAG_SECONDS: 'attendance.clock.skewFlagSeconds',
  CLOCK_SKEW_TAMPER_SECONDS: 'attendance.clock.skewTamperSeconds',

  // --- Fraud scoring (docs/06 mục 7) ----------------------------------------
  FRAUD_WEIGHTS: 'fraud.weights',
  FRAUD_THRESHOLD_FLAG: 'fraud.threshold.flag',
  FRAUD_THRESHOLD_PENDING_REVIEW: 'fraud.threshold.pendingReview',
  FRAUD_THRESHOLD_REJECT: 'fraud.threshold.reject',
  FRAUD_IMPOSSIBLE_TRAVEL_MPS: 'fraud.impossibleTravel.speedMps',
  FRAUD_SUSPICIOUS_TRAVEL_MPS: 'fraud.suspiciousTravel.speedMps',
  FRAUD_MULTI_DEVICE_WINDOW_MIN: 'fraud.multiDevice.windowMinutes',
  FRAUD_SHORT_ATTENDANCE_HIGH_RATIO: 'fraud.shortAttendance.highRatio',
  FRAUD_SHORT_ATTENDANCE_MEDIUM_RATIO: 'fraud.shortAttendance.mediumRatio',
  FRAUD_RANDOM_AUDIT_PERCENT: 'fraud.randomAudit.percent',

  // --- Tính công (docs/04 mục 7.3) ------------------------------------------
  PAYROLL_MINUTES_PER_STANDARD_DAY: 'payroll.minutesPerStandardDay',
  PAYROLL_ROUNDING_MINUTES: 'payroll.roundingMinutes',
  PAYROLL_ROUNDING_MODE: 'payroll.roundingMode',
  PAYROLL_OT_REQUIRES_APPROVAL: 'payroll.ot.requiresPreApproval',
  PAYROLL_OT_MULTIPLIER_NORMAL: 'payroll.ot.multiplierNormal',
  PAYROLL_OT_MULTIPLIER_WEEKEND: 'payroll.ot.multiplierWeekend',
  PAYROLL_OT_MULTIPLIER_HOLIDAY: 'payroll.ot.multiplierHoliday',
  PAYROLL_OT_MAX_MINUTES_PER_DAY: 'payroll.ot.maxMinutesPerDay',
  PAYROLL_OT_MAX_MINUTES_PER_MONTH: 'payroll.ot.maxMinutesPerMonth',
  PAYROLL_OT_MAX_MINUTES_PER_YEAR: 'payroll.ot.maxMinutesPerYear',
  PAYROLL_PENALTY_RULES: 'payroll.penalty.rules',
  PAYROLL_COUNT_WEEKEND_AS_WORKDAY: 'payroll.countWeekendAsWorkday',

  // --- Làm bù (docs/04 mục 5.1) ---------------------------------------------
  MAKEUP_DUE_DAYS: 'makeup.dueDays',
  MAKEUP_CARRY_SURPLUS: 'makeup.carrySurplusToNextMonth',
  /**
   * Thiếu dưới ngần này phút thì KHÔNG sinh khoản nợ công.
   *
   * Không có ngưỡng thì một ngày thiếu 2 phút do làm tròn cũng đẻ ra một khoản
   * nợ có hạn xử lý, có thông báo đẩy về điện thoại nhân viên, và nằm trong sổ
   * chờ ai đó ghi nhận. Sổ làm bù đầy những dòng như vậy sẽ che mất các khoản
   * thật sự đáng theo dõi.
   */
  MAKEUP_MIN_DEBT_MINUTES: 'makeup.minDebtMinutes',

  // --- Đơn từ ---------------------------------------------------------------
  REQUEST_BLOCK_WHEN_INSUFFICIENT_LEAVE: 'request.blockWhenInsufficientLeave',
  REQUEST_ALLOW_CANCEL_AFTER_APPROVAL: 'request.allowCancelAfterApproval',
  REQUEST_MAX_ATTACHMENTS: 'request.maxAttachments',
  REQUEST_MAX_ATTACHMENT_MB: 'request.maxAttachmentMb',

  // --- Dữ liệu sinh trắc học (NFR-LEGAL-04) ---------------------------------
  BIOMETRIC_PHOTO_RETENTION_DAYS: 'privacy.attendancePhotoRetentionDays',
  BIOMETRIC_DELETE_ON_TERMINATE: 'privacy.deleteBiometricOnTerminate',
  BIOMETRIC_DELETE_DELAY_DAYS: 'privacy.deleteBiometricDelayDays',
  /** File Excel xuất báo cáo — tệp tạm, không phải chứng từ */
  EXPORT_FILE_RETENTION_DAYS: 'privacy.exportFileRetentionDays',
} as const;

export type PolicyKey = (typeof PolicyKeys)[keyof typeof PolicyKeys];

/** Hành động khi chấm công ngoài vùng geofence (Q2, BR-ATT-06, FR-WEB-POL-11). */
export type OutOfRangeAction = 'BLOCK' | 'WARN' | 'PENDING_REVIEW';

/**
 * AF-02 — mức độ bắt buộc của việc kết nối WiFi công ty khi chấm công.
 *
 * | Giá trị | Không bắt được WiFi công ty thì |
 * |---|---|
 * | `BLOCK` | **Từ chối, KHÔNG ghi nhận lượt chấm công** |
 * | `FLAG`  | Vẫn ghi nhận nhưng gắn cờ để quản lý xem xét |
 * | `OFF`   | Bỏ qua, chỉ dùng làm tín hiệu chấm điểm gian lận |
 */
export type WifiRequirement = 'BLOCK' | 'FLAG' | 'OFF';

/**
 * AF-02b — mức độ bắt buộc của việc gọi API từ dải IP mạng văn phòng.
 *
 * Cùng ba mức như `WifiRequirement`, nhưng đây là chốt **mạnh hơn hẳn**: địa
 * chỉ nguồn do server quan sát từ kết nối TCP, client không tự khai được. BSSID
 * thì App khai, và app đã bị sửa khai được bất cứ thứ gì.
 *
 * Hai chốt bổ trợ nhau chứ không thay thế: IP chứng minh "gói tin đi ra từ mạng
 * văn phòng", BSSID chứng minh "thiết bị đang ở trong tầm sóng văn phòng". Ai
 * đó cắm VPN về văn phòng qua được chốt IP nhưng không qua được chốt BSSID.
 */
export type IpRestrictionRequirement = 'BLOCK' | 'FLAG' | 'OFF';

/** Trọng số fraud score — docs/06 mục 7.1. */
export interface FraudWeights {
  MOCK_LOCATION: number;
  ROOTED_DEVICE: number;
  ATTESTATION_FAILED: number;
  CLOCK_TAMPERING: number;
  UNKNOWN_DEVICE: number;
  IMPOSSIBLE_TRAVEL: number;
  MULTI_DEVICE_ANOMALY: number;
  LOW_LIVENESS: number;
  BORDERLINE_MATCH: number;
  OUT_OF_GEOFENCE: number;
  LOW_GPS_ACCURACY: number;
  MISSING_LOCAL_NETWORK: number;
  CLOCK_SKEW: number;
  SHORT_ATTENDANCE: number;
  IDENTICAL_COORDINATE: number;
}

export interface PenaltyRule {
  /** Áp dụng khi số lần vi phạm luỹ kế trong tháng ≥ giá trị này */
  fromOccurrence: number;
  /** Số tiền phạt cố định */
  fixedAmount?: number;
  /** Phạt theo phút đi muộn */
  amountPerMinute?: number;
}

export const POLICY_DEFAULTS: Record<string, unknown> = {
  // Geofence & vị trí
  [PolicyKeys.GEOFENCE_OUT_OF_RANGE_ACTION]: 'WARN' satisfies OutOfRangeAction,
  [PolicyKeys.GEOFENCE_DEFAULT_RADIUS_M]: 100,

  /**
   * ⚠ Mặc định `BLOCK` — không bắt được WiFi công ty thì KHÔNG chấm công được.
   *
   * Kèm theo đó là một yêu cầu vận hành bắt buộc: **mỗi chi nhánh phải khai
   * BSSID trước khi nhân viên chấm công**. Chi nhánh chưa khai thì mọi lượt
   * chấm công đều bị từ chối với `ATT_WIFI_NOT_CONFIGURED`.
   *
   * Chọn chặn thay vì cho qua khi thiếu cấu hình là có chủ đích: cho qua nghĩa
   * là một chi nhánh bị quên cấu hình sẽ âm thầm mất lớp phòng thủ này, và
   * không ai biết cho tới khi có sự cố.
   */
  [PolicyKeys.WIFI_REQUIREMENT]: 'BLOCK' satisfies WifiRequirement,

  /**
   * ⚠ Mặc định `BLOCK` — request không đến từ dải IP văn phòng thì KHÔNG chấm
   * công được.
   *
   * Hai yêu cầu vận hành đi kèm, thiếu một trong hai là cả công ty bị chặn:
   *
   *   1. Mỗi chi nhánh khai `allowedIpCidrs` — dải IP CÔNG CỘNG nhà mạng cấp
   *      cho văn phòng, không phải dải nội bộ sau NAT.
   *   2. `TRUSTED_PROXY_HOPS` khai đúng số proxy đứng trước Backend.
   */
  [PolicyKeys.IP_RESTRICTION_REQUIREMENT]: 'BLOCK' satisfies IpRestrictionRequirement,
  [PolicyKeys.GPS_MAX_ACCURACY_M]: 100,
  [PolicyKeys.GPS_REJECT_MOCK]: true,
  [PolicyKeys.GPS_REQUIRE_GPS_PROVIDER]: false,

  // Thiết bị
  [PolicyKeys.DEVICE_REJECT_ROOTED]: true,
  [PolicyKeys.DEVICE_REQUIRE_ATTESTATION]: false,
  [PolicyKeys.DEVICE_BINDING_ENABLED]: true,
  [PolicyKeys.DEVICE_CHANGE_REQUIRES_APPROVAL]: false,

  // Ngưỡng AI — docs/02 mục 6.4.
  // ⚠ PHẢI hiệu chỉnh bằng dữ liệu thật của khách hàng trước go-live (checklist docs/09).
  [PolicyKeys.FACE_MATCH_THRESHOLD]: 0.45,
  [PolicyKeys.FACE_LIVENESS_THRESHOLD]: 0.7,
  [PolicyKeys.FACE_MIN_PIXELS]: 112,
  [PolicyKeys.FACE_REQUIRE_LIVENESS]: true,
  [PolicyKeys.FACE_DUPLICATE_THRESHOLD]: 0.6,
  [PolicyKeys.FACE_MAX_ATTEMPTS_PER_HOUR]: 10,
  // Nới hơn mức "nhìn thẳng" khá nhiều: người chấm công cầm điện thoại một tay,
  // hiếm khi mặt vuông góc với camera. Siết quá thì chặn đúng người dùng thật.
  [PolicyKeys.FACE_MAX_YAW_DEGREES]: 30,
  [PolicyKeys.FACE_MAX_PITCH_DEGREES]: 25,

  // Lệch giờ
  [PolicyKeys.CLOCK_SKEW_FLAG_SECONDS]: 120,
  [PolicyKeys.CLOCK_SKEW_TAMPER_SECONDS]: 3600,

  // Fraud scoring
  [PolicyKeys.FRAUD_WEIGHTS]: {
    MOCK_LOCATION: 50,
    ROOTED_DEVICE: 40,
    ATTESTATION_FAILED: 50,
    CLOCK_TAMPERING: 40,
    UNKNOWN_DEVICE: 35,
    IMPOSSIBLE_TRAVEL: 45,
    MULTI_DEVICE_ANOMALY: 45,
    LOW_LIVENESS: 25,
    BORDERLINE_MATCH: 20,
    OUT_OF_GEOFENCE: 30,
    LOW_GPS_ACCURACY: 15,
    MISSING_LOCAL_NETWORK: 25,
    CLOCK_SKEW: 15,
    SHORT_ATTENDANCE: 20,
    IDENTICAL_COORDINATE: 20,
  } satisfies FraudWeights,
  [PolicyKeys.FRAUD_THRESHOLD_FLAG]: 30,
  [PolicyKeys.FRAUD_THRESHOLD_PENDING_REVIEW]: 60,
  [PolicyKeys.FRAUD_THRESHOLD_REJECT]: 80,
  [PolicyKeys.FRAUD_IMPOSSIBLE_TRAVEL_MPS]: 60,
  [PolicyKeys.FRAUD_SUSPICIOUS_TRAVEL_MPS]: 33,
  [PolicyKeys.FRAUD_MULTI_DEVICE_WINDOW_MIN]: 30,
  [PolicyKeys.FRAUD_SHORT_ATTENDANCE_HIGH_RATIO]: 0.3,
  [PolicyKeys.FRAUD_SHORT_ATTENDANCE_MEDIUM_RATIO]: 0.6,
  [PolicyKeys.FRAUD_RANDOM_AUDIT_PERCENT]: 5,

  // Tính công
  [PolicyKeys.PAYROLL_MINUTES_PER_STANDARD_DAY]: 480,
  [PolicyKeys.PAYROLL_ROUNDING_MINUTES]: 0,
  [PolicyKeys.PAYROLL_ROUNDING_MODE]: 'NEAREST',
  [PolicyKeys.PAYROLL_OT_REQUIRES_APPROVAL]: true,
  // NFR-LEGAL-05: mức tối thiểu theo Bộ luật Lao động 2019, Điều 98.
  [PolicyKeys.PAYROLL_OT_MULTIPLIER_NORMAL]: 1.5,
  [PolicyKeys.PAYROLL_OT_MULTIPLIER_WEEKEND]: 2.0,
  [PolicyKeys.PAYROLL_OT_MULTIPLIER_HOLIDAY]: 3.0,
  // NFR-LEGAL-06: Điều 107 — 50% giờ bình thường/ngày, 40h/tháng, 200h/năm.
  [PolicyKeys.PAYROLL_OT_MAX_MINUTES_PER_DAY]: 240,
  [PolicyKeys.PAYROLL_OT_MAX_MINUTES_PER_MONTH]: 2400,
  [PolicyKeys.PAYROLL_OT_MAX_MINUTES_PER_YEAR]: 12000,
  [PolicyKeys.PAYROLL_PENALTY_RULES]: [] satisfies PenaltyRule[],
  [PolicyKeys.PAYROLL_COUNT_WEEKEND_AS_WORKDAY]: false,

  // Làm bù
  [PolicyKeys.MAKEUP_DUE_DAYS]: 30,
  [PolicyKeys.MAKEUP_CARRY_SURPLUS]: true,
  [PolicyKeys.MAKEUP_MIN_DEBT_MINUTES]: 15,

  // Đơn từ
  [PolicyKeys.REQUEST_BLOCK_WHEN_INSUFFICIENT_LEAVE]: true,
  [PolicyKeys.REQUEST_ALLOW_CANCEL_AFTER_APPROVAL]: true,
  [PolicyKeys.REQUEST_MAX_ATTACHMENTS]: 5,
  [PolicyKeys.REQUEST_MAX_ATTACHMENT_MB]: 10,

  // Dữ liệu sinh trắc học
  //
  // ⚠ Ba khoá dưới đây được `RetentionProcessor` THỰC THI TỰ ĐỘNG hằng đêm
  // (NFR-LEGAL-04 yêu cầu "thực thi tự động", không phải làm tay khi nhớ ra).
  // Đổi giá trị là đổi hành vi xoá thật — đặt số nhỏ hơn sẽ xoá ảnh của những
  // ngày đang nằm trong khoảng đó ngay đêm hôm sau.
  [PolicyKeys.BIOMETRIC_PHOTO_RETENTION_DAYS]: 90,
  [PolicyKeys.BIOMETRIC_DELETE_ON_TERMINATE]: false,
  [PolicyKeys.BIOMETRIC_DELETE_DELAY_DAYS]: 90,

  // File xuất báo cáo là tệp TẠM, không phải chứng từ — kế toán tải về rồi lưu
  // ở nơi khác. Giữ lâu chỉ tốn dung lượng.
  [PolicyKeys.EXPORT_FILE_RETENTION_DAYS]: 7,
};

/** Mức tối thiểu theo luật — dùng để cảnh báo/chặn cấu hình sai (NFR-LEGAL-05). */
export const LABOR_LAW_MINIMUMS = {
  otMultiplierNormal: 1.5,
  otMultiplierWeekend: 2.0,
  otMultiplierHoliday: 3.0,
  annualLeaveDays: 12,
} as const;
