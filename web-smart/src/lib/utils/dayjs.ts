import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/vi';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);
dayjs.locale('vi');

/**
 * Cầu nối giữa Ant Design (dùng `dayjs`) và phần còn lại của ứng dụng
 * (dùng `date-fns-tz`).
 *
 * Chỉ dùng `dayjs` ở đúng ranh giới này. Mọi phép TÍNH TOÁN và HIỂN THỊ thời
 * gian đều đi qua `lib/utils/date.ts` — nơi múi giờ công ty được áp dụng. Trộn
 * hai thư viện trong cùng một phép tính là cách nhanh nhất để có bug lệch ngày
 * mà không ai tìm ra nguồn.
 */

/** Chuỗi `YYYY-MM-DD` → `Dayjs` cho các control ngày của antd. */
export function toDayjs(value: string | null | undefined): Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed : dayjs(value);
}

/**
 * Chuỗi `HH:mm` → `Dayjs` cho `TimePicker` của antd.
 *
 * Tách riêng khỏi `toDayjs` vì `dayjs('08:30')` KHÔNG parse được giờ trần — nó
 * cần format tường minh, và thiếu nó thì ô giờ hiện trống dù state đang có giá
 * trị. Ngày nền lấy hôm nay và bị bỏ đi ở phía gọi; chỉ phần giờ có ý nghĩa.
 */
export function toDayjsTime(value: string | null | undefined): Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value, 'HH:mm', true);
  return parsed.isValid() ? parsed : null;
}

/** `Dayjs` (giờ cục bộ của trình duyệt) → `YYYY-MM-DD`. */
export function fromDayjs(value: Dayjs | null | undefined): string | undefined {
  return value ? value.format('YYYY-MM-DD') : undefined;
}

export { dayjs };
export type { Dayjs };
