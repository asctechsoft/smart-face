/**
 * Dãy ngày của một kỳ chấm công — dùng chung cho lưới người × ngày và cho bảng
 * chi tiết theo ngày của một CBNV.
 *
 * ## Vì sao tính bằng UTC chứ không bằng giờ địa phương
 *
 * `workDate` mà Backend trả về là NGÀY LÀM VIỆC theo lịch công ty, dạng
 * `YYYY-MM-DD` — nó không có giờ, và nó đã được quy đổi rồi. Dựng `new Date(from)`
 * rồi cộng ngày bằng giờ địa phương sẽ lệch đúng vào hai chỗ: múi giờ âm làm
 * ngày 01 nhảy về 31 tháng trước, và mốc đổi giờ mùa hè làm một ngày trong năm
 * dài 23 hoặc 25 tiếng nên vòng lặp nhảy cóc hoặc lặp lại một ngày.
 *
 * Cộng 86.400.000 mili-giây trên trục UTC thì không có ngoại lệ nào — đó là lý
 * do mọi thứ ở đây đọc/ghi bằng `getUTC*` và `toISOString()`.
 */

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const DAY_MS = 86_400_000;

export interface CalendarDay {
  /** `YYYY-MM-DD` — cùng dạng với `workDate` của Backend, so sánh chuỗi được. */
  date: string;
  dayOfMonth: number;
  /** "T2" … "CN". Nhãn hiển thị, không phải chỉ số. */
  weekdayLabel: string;
  isWeekend: boolean;
}

/** Mọi ngày trong khoảng, hai đầu bao gồm. Khoảng đảo ngược trả về rỗng. */
export function eachDay(from: string, to: string): CalendarDay[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const days: CalendarDay[] = [];
  for (let time = start; time <= end; time += DAY_MS) {
    const date = new Date(time);
    const weekday = date.getUTCDay();
    days.push({
      date: date.toISOString().slice(0, 10),
      dayOfMonth: date.getUTCDate(),
      weekdayLabel: WEEKDAY_LABELS[weekday] as string,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }
  return days;
}

/** Các ngày `YYYY-MM-DD` mà một đơn phủ lên, hai đầu bao gồm. */
export function eachDateString(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const dates: string[] = [];
  for (let time = start; time <= end; time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

/** Khoá tra ô `employeeId|workDate`. Một bản khai để hai bảng không lệch nhau. */
export function cellKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}
