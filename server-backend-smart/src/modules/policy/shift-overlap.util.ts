import { ShiftType } from '@prisma/client';

/** Phần thông tin ca cần để biết nó chiếm khoảng giờ nào trong ngày. */
export interface ShiftWindow {
  startTime: string | null;
  endTime: string | null;
  crossesMidnight: boolean;
  type: ShiftType;
}

/** Khoảng thời gian tính bằng PHÚT kể từ 00:00 của ngày mốc. */
export interface MinuteRange {
  from: number;
  to: number;
}

const MINUTES_PER_DAY = 1440;

function toMinutes(time: string | null): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

/**
 * Khoảng giờ một ca chiếm, quy về trục phút của MỘT ngày mốc chung.
 *
 * `dayOffset` là số ngày lệch giữa ngày được xếp ca và ngày mốc. Nhờ nó, ca đêm
 * 22:00–06:00 xếp cho hôm qua và ca sáng 05:00–09:00 xếp cho hôm nay nằm chung
 * một trục và so được với nhau — thiếu điều này thì hai ca chồng lên nhau đúng
 * một tiếng vẫn lọt qua, vì chúng thuộc hai `workDate` khác nhau.
 *
 * Ca LINH HOẠT (hoặc ca thiếu giờ) chiếm TRỌN ngày. Không biết nó chạy từ mấy
 * giờ tới mấy giờ thì không có cách nào khẳng định nó không đè lên ca khác, và
 * đoán rộng ở đây chỉ dẫn tới chấm công của hai ca tranh nhau cùng một lượt quẹt.
 */
export function shiftRange(shift: ShiftWindow, dayOffset = 0): MinuteRange {
  const base = dayOffset * MINUTES_PER_DAY;
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);

  if (shift.type === ShiftType.FLEXIBLE || start === null || end === null) {
    return { from: base, to: base + MINUTES_PER_DAY };
  }

  // Ca qua đêm kết thúc ở ngày hôm sau. Cả `crossesMidnight` lẫn phép so giờ đều
  // được xét: dữ liệu cũ có ca 22:00–06:00 mà quên bật cờ.
  const crosses = shift.crossesMidnight || end <= start;
  return { from: base + start, to: base + end + (crosses ? MINUTES_PER_DAY : 0) };
}

/** Hai khoảng có giao nhau không. Chạm đầu–cuối (17:00 và 17:00) KHÔNG tính là giao. */
export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.from < b.to && b.from < a.to;
}

/**
 * Ca mới có đè lên ca nào đã xếp không.
 *
 * @param candidate ca đang muốn xếp, cùng ngày mốc (`dayOffset = 0`).
 * @param existing các ca đã xếp kèm độ lệch ngày so với ngày mốc — phải gồm cả
 *   ngày TRƯỚC và ngày SAU, không chỉ đúng ngày đang xếp, vì ca qua đêm tràn
 *   qua ranh giới ngày theo cả hai chiều.
 * @returns ca đầu tiên bị đè, hoặc `null` nếu xếp được.
 */
export function findOverlappingShift<T extends { shift: ShiftWindow; dayOffset: number }>(
  candidate: ShiftWindow,
  existing: T[],
): T | null {
  const target = shiftRange(candidate, 0);
  return existing.find((row) => rangesOverlap(target, shiftRange(row.shift, row.dayOffset))) ?? null;
}

/** Một lượt đã xếp, đủ thông tin để so giờ và để gọi tên trong thông báo lỗi. */
export interface AssignedWindow {
  employeeId: string;
  workDate: Date;
  shiftId: string;
  shift: ShiftWindow & { name: string };
}

/** `workDate` là ngày UTC tròn (`@db.Date`), nên chia thẳng ra số ngày là an toàn. */
function epochDay(date: Date): number {
  return Math.floor(date.getTime() / (MINUTES_PER_DAY * 60_000));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MINUTES_PER_DAY * 60_000);
}

/**
 * Lịch đã xếp, tra theo (nhân viên, ngày) trong bộ nhớ.
 *
 * Xếp ca cả tháng cho 25 người là 775 ô; hỏi database từng ô một sẽ biến một
 * thao tác thành 775 lượt đi về. Đọc một lượt cho cả khoảng rồi tra tại chỗ.
 *
 * Lượt vừa ghi được nạp lại vào đây (`add`) để những ngày sau trong cùng một
 * lần xếp vẫn so đúng.
 */
export class AssignedShiftIndex {
  private readonly rows = new Map<string, AssignedWindow[]>();

  constructor(initial: AssignedWindow[] = []) {
    for (const row of initial) this.add(row);
  }

  add(row: AssignedWindow): void {
    const key = `${row.employeeId}|${epochDay(row.workDate)}`;
    const bucket = this.rows.get(key);
    if (bucket) bucket.push(row);
    else this.rows.set(key, [row]);
  }

  /**
   * Ca đã xếp bị `candidate` đè lên, hoặc `null` nếu xếp được.
   *
   * Soi cả ngày TRƯỚC và ngày SAU chứ không chỉ đúng ngày đang xếp: ca đêm tràn
   * qua ranh giới ngày theo cả hai chiều, và chỉ soi trong cùng `workDate` thì
   * ca 22:00–06:00 của hôm trước với ca 05:00 hôm nay chồng nhau một tiếng mà
   * vẫn lọt.
   *
   * Xếp lại ĐÚNG ca đang có không phải là đè lên chính nó — đó là thao tác ghi
   * đè bình thường (đổi bảng chủ quản, đổi người xếp).
   */
  findClash(
    employeeId: string,
    workDate: Date,
    candidate: ShiftWindow,
    candidateShiftId: string,
  ): AssignedWindow | null {
    const day = epochDay(workDate);
    const neighbours: (AssignedWindow & { dayOffset: number })[] = [];

    for (const offset of [-1, 0, 1]) {
      for (const row of this.rows.get(`${employeeId}|${day + offset}`) ?? []) {
        if (offset === 0 && row.shiftId === candidateShiftId) continue;
        neighbours.push({ ...row, dayOffset: offset });
      }
    }

    return findOverlappingShift(candidate, neighbours);
  }
}
