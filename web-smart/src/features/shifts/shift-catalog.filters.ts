import type { Shift } from '@/features/policy/policy.api';

/**
 * Ca mới bắt đầu từ mẫu hành chính — mẫu hay dùng nhất, và hợp lệ ngay.
 *
 * Để ở đây chứ không trong component vì thanh công cụ (`ShiftCatalogToolbar`)
 * và bảng (`ShiftCatalogTab`) nằm ở hai chỗ khác nhau trên màn hình, và cả hai
 * đều nói về "ca mới".
 */
export const NEW_SHIFT: Partial<Shift> = {
  type: 'FIXED',
  startTime: '08:00',
  endTime: '17:30',
  breakStart: '12:00',
  breakEnd: '13:00',
  breakMinutes: 60,
  requireCheckIn: true,
  requireCheckOut: true,
  workDayCredit: 1,
  normalDayFactor: 1,
  weeklyRestFactor: 2,
  holidayFactor: 3,
  holidayFactors: [],
  departmentIds: [],
  lateToleranceMinutes: 5,
  earlyLeaveToleranceMinutes: 0,
  weekdayMask: 31,
  crossesMidnight: false,
};

/** Ô tìm kiếm khớp mã ca, tên ca hoặc ký hiệu — không phân biệt hoa thường. */
export function matchesKeyword(shift: Shift, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (keyword.length === 0) return true;
  return [shift.code ?? '', shift.name, shift.symbol ?? ''].some((field) =>
    field.toLowerCase().includes(keyword),
  );
}

/**
 * Ca có thuộc chi nhánh đang chọn không.
 *
 * ⚠ Chi nhánh KHÔNG phải một trường của ca — `Shift` chỉ có `departmentIds`.
 * Quan hệ được suy ra qua phòng ban (`Department.branchId`), và ca "mọi phòng
 * ban" (`departmentIds` rỗng) luôn khớp: nó thật sự áp dụng cho mọi chi nhánh,
 * nên lọc nó đi sẽ giấu mất chính ca hành chính mặc định.
 */
export function matchesBranch(
  shift: Shift,
  branchId: string,
  branchDepartments: Set<string>,
): boolean {
  if (branchId.length === 0) return true;
  const ids = shift.departmentIds ?? [];
  return ids.length === 0 || ids.some((id) => branchDepartments.has(id));
}
