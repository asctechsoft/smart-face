/**
 * Nhãn hiển thị và tiện ích đọc audit log — dùng chung giữa màn Nhật ký kiểm
 * toán và tab "Lịch sử thay đổi" của hồ sơ nhân viên.
 *
 * Gom về một chỗ vì hai màn hình đọc CÙNG một nguồn dữ liệu (`audit_log`); mỗi
 * nơi tự khai một bảng nhãn thì thêm một hành động mới ở Backend sẽ hiện tên
 * tiếng Việt ở màn này và mã thô ở màn kia.
 *
 * Bảng phải chịu được mã lạ: `ACTION_LABEL[value] ?? value` — Backend thêm hành
 * động mới không được làm giao diện hiện ô trống.
 */
export const ACTION_LABEL: Record<string, string> = {
  ATTENDANCE_ADJUST: 'Hiệu chỉnh công',
  PAYROLL_CLOSE: 'Chốt kỳ lương',
  PAYROLL_REOPEN: 'Mở lại kỳ lương',
  PAYROLL_RECALCULATE: 'Tính lại kỳ lương',
  PAYROLL_PERIOD_CREATE: 'Tạo kỳ lương',
  EMPLOYEE_CREATE: 'Tạo hồ sơ nhân viên',
  EMPLOYEE_UPDATE: 'Sửa hồ sơ nhân viên',
  EMPLOYEE_DELETE: 'Xoá hồ sơ nhân viên',
  EMPLOYEE_SUSPEND: 'Tạm ngưng nhân viên',
  EMPLOYEE_REACTIVATE: 'Kích hoạt lại nhân viên',
  EMPLOYEE_TERMINATE: 'Chấm dứt hợp đồng',
  EMPLOYEE_IMPORT: 'Import nhân viên hàng loạt',
  EMPLOYEE_DEVICE_REVOKE: 'Thu hồi thiết bị',
  EMPLOYEE_BIOMETRIC_RESET: 'Đặt lại sinh trắc học',
  POLICY_UPDATE: 'Đổi chính sách công ty',
  LEAVE_POLICY_UPDATE: 'Đổi chính sách phép năm',
  SHIFT_CREATE: 'Tạo ca làm việc',
  SHIFT_UPDATE: 'Sửa ca làm việc',
  SHIFT_DELETE: 'Xoá ca làm việc',
  SHIFT_ASSIGN_BULK: 'Phân ca hàng loạt',
  SHIFT_ASSIGN_CLEAR: 'Xoá phân ca',
  HOLIDAY_UPSERT: 'Cập nhật ngày lễ',
  HOLIDAY_DELETE: 'Xoá ngày lễ',
  BRANCH_CREATE: 'Tạo chi nhánh',
  BRANCH_UPDATE: 'Sửa chi nhánh / geofence',
  DEPARTMENT_CREATE: 'Tạo phòng ban',
  DEPARTMENT_UPDATE: 'Sửa phòng ban',
  MAKEUP_DEBT_CREATE: 'Ghi nhận nợ công',
  MAKEUP_RECORD: 'Ghi nhận giờ làm bù',
  MAKEUP_EXTEND: 'Gia hạn làm bù',
  MAKEUP_CANCEL: 'Huỷ khoản nợ công',
  REQUEST_TYPE_CREATE: 'Tạo loại đơn',
  REQUEST_TYPE_UPDATE: 'Sửa loại đơn',
  APPROVAL_FLOW_UPDATE: 'Đổi luồng duyệt đơn',
  FRAUD_REVIEW: 'Xử lý cảnh báo gian lận',
  REQUEST_APPROVE: 'Duyệt đơn',
  REQUEST_REJECT: 'Từ chối đơn',
  ROLE_CHANGE: 'Đổi phân quyền',
  DEVICE_REVOKE: 'Thu hồi thiết bị',
  BIOMETRIC_RESET: 'Đặt lại sinh trắc học',
};

export const TARGET_LABEL: Record<string, string> = {
  ATTENDANCE_LOG: 'Lượt chấm công',
  PAYROLL_PERIOD: 'Kỳ lương',
  EMPLOYEE: 'Nhân viên',
  COMPANY: 'Công ty',
  COMPANY_POLICY: 'Chính sách',
  FRAUD_FLAG: 'Cờ nghi vấn',
  LEAVE_REQUEST: 'Đơn từ',
  REQUEST_TYPE: 'Loại đơn',
  MAKEUP: 'Công làm bù',
  SHIFT: 'Ca làm việc',
  BRANCH: 'Chi nhánh',
  DEPARTMENT: 'Phòng ban',
  HOLIDAY: 'Ngày lễ',
};

export interface DiffLine {
  key: string;
  before: string;
  after: string;
}

/**
 * So sánh hai ảnh chụp để hiện đúng những trường đã đổi.
 *
 * Hiện cả object JSON thô sẽ có 20 dòng giống hệt nhau và 1 dòng khác — mắt
 * người không tìm ra dòng khác đó, mà đây lại chính là thông tin cần tìm.
 */
export function diffLines(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  limit = 5,
): DiffLine[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  return [...keys]
    .map((key) => ({
      key,
      before: stringify(before?.[key]),
      after: stringify(after?.[key]),
    }))
    .filter((line) => line.before !== line.after)
    .slice(0, limit);
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
