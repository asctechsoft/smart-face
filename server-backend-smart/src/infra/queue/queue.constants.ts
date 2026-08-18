/**
 * Hàng đợi BullMQ — docs/02-kien-truc-he-thong.md mục 10.
 *
 * | Queue          | Job                                   | Trigger                  | Retry |
 * |----------------|---------------------------------------|--------------------------|-------|
 * | sms            | OTP, SMS mời nhân viên                | Đăng nhập, HR tạo hồ sơ  | 3     |
 * | notification   | Push FCM hàng loạt, email báo cáo     | Duyệt đơn, thông báo     | 5     |
 * | payroll        | Tính công theo ngày / theo kỳ         | Cron + khi có thay đổi   | 3     |
 * | export         | Xuất Excel/PDF file lớn               | Kế toán bấm xuất         | 2     |
 * | ai-batch       | Đối chiếu ngẫu nhiên ảnh (AF-08)      | Cron                     | 3     |
 * | fraud-scan     | Impossible travel, thiết bị lạ (AF-03)| Cron mỗi 15 phút         | 3     |
 * | retention      | Xoá ảnh/tệp quá hạn lưu (NFR-LEGAL-04)| Cron 05:00               | 3     |
 */
export const QUEUES = {
  SMS: 'sms',
  NOTIFICATION: 'notification',
  PAYROLL: 'payroll',
  EXPORT: 'export',
  AI_BATCH: 'ai-batch',
  FRAUD_SCAN: 'fraud-scan',
  RETENTION: 'retention',
} as const;

export const JOBS = {
  // sms
  SEND_OTP: 'send-otp',
  SEND_INVITE_SMS: 'send-invite-sms',

  // notification
  PUSH_NOTIFICATION: 'push-notification',
  BROADCAST_NOTIFICATION: 'broadcast-notification',

  // payroll — BẮT BUỘC idempotent (NFR-REL-06)
  RECALCULATE_DAILY: 'recalculate-daily',
  RECALCULATE_RANGE: 'recalculate-range',
  RECALCULATE_PERIOD: 'recalculate-period',
  NIGHTLY_RECALCULATE: 'nightly-recalculate',

  // export
  EXPORT_ATTENDANCE: 'export-attendance',
  EXPORT_PAYROLL: 'export-payroll',
  /** Trạng thái làm việc của MỘT ngày — màn "Theo dõi công việc". */
  EXPORT_WORK_STATUS: 'export-work-status',

  // ai-batch
  RANDOM_AUDIT: 'random-audit',

  // fraud-scan
  SCAN_IMPOSSIBLE_TRAVEL: 'scan-impossible-travel',
  SCAN_SHORT_ATTENDANCE: 'scan-short-attendance',
  SCAN_MISSING_CHECKOUT: 'scan-missing-checkout',

  // retention — thực thi tự động chính sách lưu trữ (NFR-LEGAL-04, NFR-SCALE-07)
  PURGE_ATTENDANCE_PHOTOS: 'purge-attendance-photos',
  PURGE_REVOKED_FACE_PROFILES: 'purge-revoked-face-profiles',
  PURGE_EXPIRED_EXPORTS: 'purge-expired-exports',
} as const;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
