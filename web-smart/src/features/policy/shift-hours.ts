import type { Shift } from './policy.api';

/**
 * Số phút công của một ca — bản sao ở phía Web của công thức trong
 * `policy-admin.service.ts` (`computeShiftWorkMinutes`).
 *
 * ⚠ Hai bản này PHẢI cho cùng kết quả. Sửa một bên thì sửa cả bên kia.
 *
 * Chấp nhận nhân đôi công thức vì ô "số giờ công" là ô CHỈ ĐỌC nằm ngay cạnh
 * hai ô giờ ca: người dùng cần thấy nó đổi trong lúc gõ, và con số đó là thứ
 * cho họ biết mình vừa khai đúng hay sai. Chờ lưu xong mới biết thì ô này mất
 * hết tác dụng. Backend vẫn là nơi quyết định — giá trị hiển thị sau khi lưu
 * luôn là `workMinutes` do Backend trả về, không phải số tính ở đây.
 */
export function estimateWorkMinutes(shift: Partial<Shift>): number {
  if (shift.type === 'FLEXIBLE') {
    return shift.requiredMinutes ?? 0;
  }

  const segments = shift.segments ?? [];
  if (segments.length > 0) {
    // Ca gãy: các đoạn đã loại giờ nghỉ, không trừ `breakMinutes` lần nữa.
    return segments.reduce((sum, s) => sum + spanMinutes(s.startTime, s.endTime), 0);
  }

  if (!shift.startTime || !shift.endTime) return 0;
  const gross = spanMinutes(shift.startTime, shift.endTime);
  return Math.max(0, gross - resolveBreakMinutes(shift));
}

/**
 * Phút nghỉ mà Backend sẽ dùng.
 *
 * Khai khoảng nghỉ cụ thể thì nó thắng `breakMinutes` — giống hệt thứ tự ưu
 * tiên ở `resolveBreakMinutes` phía Backend. Không theo đúng thứ tự đó thì ô
 * giờ công hiện một số, lưu xong ra một số khác.
 */
export function resolveBreakMinutes(shift: Partial<Shift>): number {
  if (shift.breakStart && shift.breakEnd) {
    return spanMinutes(shift.breakStart, shift.breakEnd);
  }
  return shift.breakMinutes ?? 0;
}

/** Khoảng cách giữa hai mốc "HH:mm", tự hiểu trường hợp vắt qua nửa đêm. */
function spanMinutes(from: string, to: string): number {
  const diff = toMinutes(to) - toMinutes(from);
  return diff > 0 ? diff : diff + 24 * 60;
}

function toMinutes(value: string): number {
  const [hh = '0', mm = '0'] = value.split(':');
  return Number(hh) * 60 + Number(mm);
}

/** "8h30" — đọc nhanh hơn "8.5 giờ" khi liếc qua một cột bảng. */
export function formatHours(minutes: number): string {
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
}
