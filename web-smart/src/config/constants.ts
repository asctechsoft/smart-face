/** Vai trò hệ thống — khớp `enum SystemRole` trong prisma/schema.prisma. */
export const SystemRole = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  MANAGER: 'MANAGER',
  HR_PAYROLL: 'HR_PAYROLL',
  EMPLOYEE: 'EMPLOYEE',
} as const;

export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

export const ROLE_LABEL: Record<SystemRole, string> = {
  SYSTEM_ADMIN: 'Admin hệ thống',
  COMPANY_ADMIN: 'Admin công ty',
  MANAGER: 'Quản lý',
  HR_PAYROLL: 'Kế toán / HR',
  EMPLOYEE: 'Nhân viên',
};

/** `enum EmployeeStatus`. */
export const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  PENDING_ACTIVATION: 'Chờ kích hoạt',
  ACTIVE: 'Đang làm việc',
  SUSPENDED: 'Tạm ngưng',
  TERMINATED: 'Đã nghỉ việc',
};

/**
 * Nhân viên CÒN TRONG BIÊN CHẾ — dùng cho mọi ô chọn nhân viên.
 *
 * ⚠ Đừng lọc `status: 'ACTIVE'` ở ô chọn. `PENDING_ACTIVATION` là hồ sơ HR đã
 * tạo nhưng người đó chưa đăng nhập lần nào — vẫn là nhân viên thật, vẫn đi làm,
 * vẫn có thể xin nghỉ. Công ty mới triển khai thì TOÀN BỘ nhân sự nằm ở trạng
 * thái này, nên lọc `ACTIVE` cho ra một ô chọn rỗng trơn mà không có lỗi nào báo.
 *
 * Và đó chính là nhóm cần "tạo đơn hộ" nhất: người chưa cài ứng dụng thì không
 * tự gửi đơn được.
 *
 * `SUSPENDED` và `TERMINATED` cố ý nằm ngoài: tạm ngưng thì không phát sinh công,
 * đã nghỉ việc thì không tạo chứng từ mới.
 */
export const EMPLOYABLE_STATUSES = 'ACTIVE,PENDING_ACTIVATION';

/** `enum DailyStatus` — trạng thái một ngày công. */
export const DAILY_STATUS_LABEL: Record<string, string> = {
  ON_TIME: 'Đúng giờ',
  LATE: 'Đi muộn',
  EARLY_LEAVE: 'Về sớm',
  LATE_AND_EARLY: 'Muộn & về sớm',
  OVERTIME: 'Tăng ca',
  INSUFFICIENT: 'Thiếu giờ',
  ON_LEAVE: 'Nghỉ phép',
  HOLIDAY: 'Ngày lễ',
  ABSENT: 'Vắng mặt',
  MISSING_RECORD: 'Thiếu bản ghi',
  WEEKEND: 'Cuối tuần',
};

/** `enum RequestStatus`. */
export const REQUEST_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

/** `enum PayrollPeriodStatus`. */
export const PERIOD_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Mở',
  REVIEWING: 'Đang rà soát',
  CLOSED: 'Đã chốt',
};

/**
 * Mã cờ nghi vấn — `FraudFlag.code`, xem docs/06-anti-fraud.md.
 *
 * Không dùng enum ở Backend (cột `String`) nên bảng này là ánh xạ hiển thị, và
 * phải chịu được mã lạ: code không có trong bảng thì hiện nguyên mã.
 */
export const FRAUD_CODE_LABEL: Record<string, string> = {
  MOCK_LOCATION: 'Nghi ngờ vị trí giả',
  ROOTED_DEVICE: 'Thiết bị đã root / jailbreak',
  CLOCK_TAMPERING: 'Chỉnh giờ thiết bị',
  IMPOSSIBLE_TRAVEL: 'Di chuyển bất khả thi',
  MULTI_DEVICE_ANOMALY: 'Chấm công trên nhiều thiết bị',
  OUT_OF_GEOFENCE: 'Chấm công ngoài vùng cho phép',
  LOW_LIVENESS: 'Điểm liveness thấp bất thường',
  SHORT_ATTENDANCE: 'Thời lượng làm việc bất thường',
  ATT_OUT_OF_GEOFENCE: 'Chấm công ngoài vùng cho phép',
  LOW_MATCH_SCORE: 'Độ tương đồng khuôn mặt thấp',
};

export const FRAUD_SEVERITY_LABEL: Record<string, string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
};

/** Bitmask ngày trong tuần của `Shift.weekdayMask` — 1 = Thứ 2 … 64 = Chủ nhật. */
export const WEEKDAYS = [
  { mask: 1, label: 'T2' },
  { mask: 2, label: 'T3' },
  { mask: 4, label: 'T4' },
  { mask: 8, label: 'T5' },
  { mask: 16, label: 'T6' },
  { mask: 32, label: 'T7' },
  { mask: 64, label: 'CN' },
] as const;

/** Chiều dài tối thiểu của lý do — BR-ADJ-02, BR-07, BR-08 đều chốt 10 ký tự. */
export const REASON_MIN_LENGTH = 10;

export const DEFAULT_PAGE_SIZE = 20;
