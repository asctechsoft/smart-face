import { format as formatDate, parseISO, differenceInCalendarDays } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { vi } from 'date-fns/locale';
import { env } from '@/config/env';

/**
 * Mọi phép định dạng thời gian đi qua đây — docs/04 mục 6.4, bẫy "Múi giờ".
 *
 * Backend lưu UTC. Công ty ở `Asia/Ho_Chi_Minh`. Dùng `new Date(iso).toLocaleString()`
 * là hiển thị theo múi giờ của MÁY NGƯỜI DÙNG, không phải của công ty — kế toán
 * mở máy đang để múi giờ khác sẽ thấy lượt chấm công 00:30 ngày 04 nhảy sang
 * ngày 03, và cả bảng công lệch một ngày.
 *
 * Vì vậy: cấm `toLocaleString`, cấm tự cộng trừ 7 tiếng. Chỉ dùng các hàm ở đây.
 */

export function tz(timezone?: string): string {
  return timezone || env.VITE_DEFAULT_TIMEZONE;
}

/** `2026-08-03T01:05:12Z` → `08:05` (giờ công ty). */
export function formatTime(iso: string | Date | null | undefined, timezone?: string): string {
  if (!iso) return '—';
  return formatInTimeZone(typeof iso === 'string' ? parseISO(iso) : iso, tz(timezone), 'HH:mm');
}

/** Kèm giây — dùng ở màn chi tiết, nơi lệch vài giây là thông tin có ý nghĩa. */
export function formatTimeWithSeconds(
  iso: string | Date | null | undefined,
  timezone?: string,
): string {
  if (!iso) return '—';
  return formatInTimeZone(typeof iso === 'string' ? parseISO(iso) : iso, tz(timezone), 'HH:mm:ss');
}

/** `2026-08-03` → `03/08/2026`. */
export function formatDay(iso: string | Date | null | undefined, timezone?: string): string {
  if (!iso) return '—';
  return formatInTimeZone(
    typeof iso === 'string' ? parseISO(iso) : iso,
    tz(timezone),
    'dd/MM/yyyy',
  );
}

/** `03/08/2026 08:05`. */
export function formatDateTime(iso: string | Date | null | undefined, timezone?: string): string {
  if (!iso) return '—';
  return formatInTimeZone(
    typeof iso === 'string' ? parseISO(iso) : iso,
    tz(timezone),
    'dd/MM/yyyy HH:mm',
  );
}

/** `Thứ Hai, 03/08/2026` — dùng ở tiêu đề trang. */
export function formatDayLong(iso: string | Date, timezone?: string): string {
  return formatInTimeZone(
    typeof iso === 'string' ? parseISO(iso) : iso,
    tz(timezone),
    'EEEE, dd/MM/yyyy',
    { locale: vi },
  );
}

/** Chuỗi `YYYY-MM-DD` của "hôm nay" theo giờ công ty — dùng làm tham số API. */
export function todayWorkDate(timezone?: string): string {
  return formatInTimeZone(new Date(), tz(timezone), 'yyyy-MM-dd');
}

/** Ngày đầu tháng hiện tại theo giờ công ty. */
export function firstDayOfMonth(timezone?: string): string {
  const now = toZonedTime(new Date(), tz(timezone));
  return formatDate(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
}

/** Ngày cuối tháng hiện tại theo giờ công ty. */
export function lastDayOfMonth(timezone?: string): string {
  const now = toZonedTime(new Date(), tz(timezone));
  return formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');
}

/**
 * `Date` của trình chọn ngày → chuỗi `YYYY-MM-DD`.
 *
 * Dùng `formatDate` cục bộ chứ KHÔNG `toISOString()`: người dùng chọn ngày 03
 * trên lịch, `toISOString()` quy về UTC và trả ra ngày 02 — lỗi lệch một ngày
 * kinh điển, chỉ xuất hiện với người dùng ở múi giờ dương.
 */
export function toWorkDate(date: Date | null | undefined): string | undefined {
  return date ? formatDate(date, 'yyyy-MM-dd') : undefined;
}

/** Số phút → `8h33`. Bảng công đọc bằng giờ-phút, không ai đọc "513 phút". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes === 0) return '0h';

  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) return `${sign}${rest}p`;
  if (rest === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h${String(rest).padStart(2, '0')}`;
}

/** "3 giây", "12 phút" — dùng cho độ lệch giờ máy ở màn chi tiết. */
export function formatSecondsGap(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const abs = Math.abs(seconds);
  if (abs < 60) return `${abs} giây`;
  if (abs < 3600) return `${Math.round(abs / 60)} phút`;
  return `${(abs / 3600).toFixed(1)} giờ`;
}

/** "Hôm nay", "Hôm qua", "3 ngày trước" — cho danh sách thông báo và cảnh báo. */
export function formatRelativeDay(iso: string | Date, timezone?: string): string {
  const target = toZonedTime(typeof iso === 'string' ? parseISO(iso) : iso, tz(timezone));
  const now = toZonedTime(new Date(), tz(timezone));
  const days = differenceInCalendarDays(now, target);

  if (days === 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  if (days > 1 && days < 7) return `${days} ngày trước`;
  return formatDay(iso, timezone);
}
