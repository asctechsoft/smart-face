import { DateTime } from 'luxon';

/**
 * Tiện ích thời gian có TIMEZONE.
 *
 * D5 + docs/04 mục 6.4: server chạy UTC, công ty ở Asia/Ho_Chi_Minh.
 * BẮT BUỘC dùng thư viện có timezone (Luxon), KHÔNG tự cộng trừ giờ —
 * đây là nguồn sai lệch lương phổ biến nhất.
 */

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Chuyển instant UTC sang thời điểm theo timezone công ty. */
export function inZone(instant: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(timezone);
}

/**
 * Ngày làm việc (workDate) suy ra từ một instant theo timezone công ty.
 *
 * ⚠ Với ca đêm vắt qua nửa đêm (22:00 → 06:00), workDate phải là NGÀY BẮT ĐẦU CA,
 * không phải ngày của timestamp. Hàm này chỉ trả về "ngày lịch" — logic gán ca
 * đêm nằm ở `resolveWorkDateForShift`.
 */
export function toWorkDate(instant: Date, timezone: string): Date {
  const local = inZone(instant, timezone).startOf('day');
  // Lưu dạng @db.Date → dùng UTC midnight của ngày lịch địa phương.
  return new Date(Date.UTC(local.year, local.month - 1, local.day));
}

/** Parse "YYYY-MM-DD" thành Date dùng cho cột @db.Date (UTC midnight). */
export function parseWorkDate(value: string): Date {
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  if (!parsed.isValid) {
    throw new Error(`Ngày không hợp lệ: ${value}`);
  }
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

/** Định dạng cột @db.Date thành "YYYY-MM-DD". */
export function formatWorkDate(date: Date): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('yyyy-MM-dd');
}

/** Danh sách ngày (dạng @db.Date) trong khoảng [from, to] — bao gồm hai đầu. */
export function eachWorkDate(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  let cursor = DateTime.fromJSDate(from, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromJSDate(to, { zone: 'utc' }).startOf('day');

  while (cursor <= end) {
    dates.push(new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day)));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

/** Kiểm tra định dạng giờ "HH:mm". */
export function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Ghép workDate (@db.Date) + giờ "HH:mm" theo timezone công ty thành instant UTC.
 *
 * @param dayOffset +1 cho giờ kết thúc của ca vắt qua nửa đêm (22:00 → 06:00 hôm sau).
 */
export function combineWorkDateAndTime(
  workDate: Date,
  time: string,
  timezone: string,
  dayOffset = 0,
): Date {
  const [hour, minute] = time.split(':').map(Number);
  const day = DateTime.fromJSDate(workDate, { zone: 'utc' });

  const local = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour, minute },
    { zone: timezone },
  ).plus({ days: dayOffset });

  return local.toUTC().toJSDate();
}

/** 1=Thứ 2 … 7=Chủ nhật (chuẩn ISO của Luxon). */
export function weekdayOf(workDate: Date): number {
  return DateTime.fromJSDate(workDate, { zone: 'utc' }).weekday;
}

export function isWeekend(workDate: Date): boolean {
  const weekday = weekdayOf(workDate);
  return weekday === 6 || weekday === 7;
}

/** Bitmask ngày trong tuần: 1=T2, 2=T3, 4=T4, 8=T5, 16=T6, 32=T7, 64=CN. */
export function weekdayMaskOf(workDate: Date): number {
  return 1 << (weekdayOf(workDate) - 1);
}

/** Khoảng [đầu ngày, cuối ngày) theo timezone công ty, trả về instant UTC. */
export function dayBoundsUtc(workDate: Date, timezone: string): { start: Date; end: Date } {
  const start = combineWorkDateAndTime(workDate, '00:00', timezone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Chênh lệch tuyệt đối giữa hai mốc, tính bằng GIÂY (AF-18). */
export function absoluteSkewSeconds(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 1000);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}
