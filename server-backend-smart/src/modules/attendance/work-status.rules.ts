/**
 * Luật phân loại TRẠNG THÁI LÀM VIỆC trong ngày — màn "Theo dõi công việc".
 *
 * ## Vì sao là một module thuần, tách khỏi service
 *
 * Cùng một luật này được đọc ở BA nơi: dòng trên lưới, con số tổng ở đầu trang,
 * và file Excel do worker dựng ở tiến trình khác. Ba bản sao của một luật sẽ
 * lệch nhau, và ngày nó lệch thì con số "12 người chưa đến" ở đầu trang mâu
 * thuẫn với chính những dòng ngay bên dưới mà không có cách nào biết bên nào
 * đúng — đây đúng là bài học đã rút ra ở lưới bảng chấm công (`cellTones`).
 *
 * Không phụ thuộc Prisma, Nest hay múi giờ: đầu vào đã được service quy về PHÚT
 * tính từ 00:00 của ngày làm việc theo giờ công ty. Nhờ vậy toàn bộ luật kiểm
 * thử được bằng số nguyên, không cần dựng database và không có bẫy timezone.
 *
 * ## Vì sao đơn vị là "phút tính từ đầu ngày làm việc" chứ không phải instant
 *
 * Ca đêm 22:00 → 06:00 gắn với NGÀY BẮT ĐẦU ca (xem `AttendanceLog.workDate`).
 * Biểu diễn giờ tan ca của nó bằng 1800 (= 30:00) giữ được thứ tự so sánh với
 * giờ vào ca 1320 (= 22:00) chỉ bằng phép `<`. Dùng instant thì mọi so sánh phải
 * kéo theo timezone, và mọi chỗ quên kéo theo là một lỗi lệch múi giờ im lặng.
 */

/**
 * Trạng thái làm việc — MỘT nhãn cho mỗi người mỗi ngày, không chồng nhau.
 *
 * Thứ tự khai báo cũng là thứ tự CẦN XỬ LÝ, không phải bảng chữ cái: những
 * trạng thái đầu là thứ người quản lý phải làm gì đó ngay, những trạng thái cuối
 * là bối cảnh (ngày không có nghĩa vụ làm việc).
 */
export const WORK_STATES = [
  /** Có ca, đã quá giờ vào ca mà chưa có lượt chấm nào. Đây là cảnh báo chính. */
  'LATE_NOT_ARRIVED',
  /** Ngày đã qua: có ca, không chấm công, không đơn nào che. */
  'ABSENT',
  /** Đã chấm vào, đã quá giờ tan ca từ lâu mà chưa chấm ra. */
  'MISSING_CHECKOUT',
  /** Đang ở ngoài: lượt cuối là BREAK_OUT, hoặc đang trong khoảng đơn ra ngoài. */
  'OUTSIDE',
  /** Đã chấm vào, chưa chấm ra, chưa quá giờ tan ca. */
  'WORKING',
  /** Đã chấm ra. */
  'DONE',
  /** Có ca, chưa tới giờ vào ca và chưa chấm — chưa có gì bất thường. */
  'NOT_ARRIVED',
  /** Công tác: là ngày ĐI LÀM, chỉ là làm ở chỗ khác. */
  'BUSINESS_TRIP',
  /** Nghỉ cả ngày theo đơn đã duyệt. */
  'ON_LEAVE',
  'HOLIDAY',
  /** Không được xếp ca và cũng không có ca mặc định nào áp cho ngày này. */
  'NO_SHIFT',
] as const;

export type WorkState = (typeof WORK_STATES)[number];

/** Nhãn tiếng Việt — dùng chung cho Excel và cho `description` của Swagger. */
export const WORK_STATE_LABELS: Record<WorkState, string> = {
  LATE_NOT_ARRIVED: 'Chưa đến (quá giờ)',
  ABSENT: 'Vắng',
  MISSING_CHECKOUT: 'Quên chấm ra',
  OUTSIDE: 'Đang ra ngoài',
  WORKING: 'Đang làm',
  DONE: 'Đã về',
  NOT_ARRIVED: 'Chưa đến',
  BUSINESS_TRIP: 'Công tác',
  ON_LEAVE: 'Nghỉ theo đơn',
  HOLIDAY: 'Ngày lễ',
  NO_SHIFT: 'Không có ca',
};

/** Cuối ngày làm việc mở rộng — ca đêm kết thúc sau nửa đêm vẫn nằm trong đây. */
export const END_OF_WORKDAY_MINUTES = 36 * 60;

/**
 * Quên chấm ra sau bao lâu thì mới gọi là quên.
 *
 * Không phải 0 phút: người tan ca lúc 17:30 thường quẹt lúc 17:35–17:45, và gắn
 * nhãn "quên chấm ra" cho họ trong 15 phút đó là biến cảnh báo thành nhiễu.
 */
export const MISSING_CHECKOUT_GRACE_MINUTES = 90;

/** Một lượt quẹt, đã quy về phút tính từ 00:00 của ngày làm việc. */
export interface WorkMark {
  logId: string;
  type: 'CHECK_IN' | 'CHECK_OUT' | 'BREAK_OUT' | 'BREAK_IN' | 'RANDOM_CHECK' | string;
  atMinutes: number;
  authMethod: string;
}

/** Một ca được xếp (hoặc ca mặc định) cho ngày này. */
export interface ShiftWindow {
  shiftId: string;
  startMinutes: number;
  /** Lớn hơn 1440 nếu ca vắt qua nửa đêm. */
  endMinutes: number;
  lateToleranceMinutes: number;
}

/**
 * Một đơn từ phủ lên ngày này.
 *
 * `wholeDay` tách khỏi khoảng `[fromMinutes, toMinutes]` có chủ đích: đơn nghỉ
 * phép theo NGÀY không có giờ thật sự — quy nó về `[0, 1440]` rồi so với
 * `nowMinutes` sẽ cho ra "hết giờ nghỉ" lúc nửa đêm, tức là sai hẳn ý nghĩa.
 */
export interface LeaveCover {
  requestId: string;
  /** Mã loại đơn do công ty tự khai: "GO_OUT", "ANNUAL_LEAVE", "BUSINESS_TRIP"… */
  code: string;
  status: string;
  fromMinutes: number;
  toMinutes: number;
  wholeDay: boolean;
}

export interface WorkStateInput {
  /**
   * "Bây giờ", quy về phút của ngày làm việc.
   *
   * Với ngày ĐÃ QUA, service truyền `END_OF_WORKDAY_MINUTES`: nhìn lại hôm qua
   * thì mọi mốc đều đã trôi qua, và đó chính là thứ biến "chưa đến" thành "vắng".
   */
  nowMinutes: number;
  /** Ngày đang xem nằm trước hôm nay (theo lịch công ty). */
  isPastDay: boolean;
  isHoliday: boolean;
  shiftWindows: ShiftWindow[];
  marks: WorkMark[];
  covers: LeaveCover[];
}

export interface WorkStateResult {
  state: WorkState;
  /** Lượt chấm vào đầu tiên. `null` = chưa có. */
  firstCheckInMinutes: number | null;
  /** Lượt chấm ra cuối cùng. `null` = chưa chấm ra. */
  lastCheckOutMinutes: number | null;
  /** Ra ngoài từ phút nào. `null` = không đang ở ngoài. */
  outsideSinceMinutes: number | null;
  /** Giờ vào ca sớm nhất trong ngày. `null` = không có ca nào. */
  expectedStartMinutes: number | null;
  /** Giờ tan ca muộn nhất trong ngày. `null` = không có ca nào. */
  expectedEndMinutes: number | null;
  /** Đơn đang che ngày/khoảnh khắc này — để giao diện chỉ đúng đơn cần xem. */
  activeCoverIds: string[];
  /** Có đơn nào đang CHỜ DUYỆT chạm vào ngày này không. */
  hasPendingRequest: boolean;
}

const APPROVED = 'APPROVED';
const PENDING = 'PENDING';

/**
 * Phân loại trạng thái làm việc của MỘT người trong MỘT ngày.
 *
 * ## Thứ tự các nhánh, và vì sao nó như vậy
 *
 * Lượt chấm công đứng TRƯỚC đơn từ. Người có đơn nghỉ cả ngày mà vẫn tới quẹt
 * thẻ thì họ đang đi làm — hiện "Nghỉ theo đơn" cho họ là giấu đi đúng cái bất
 * thường mà màn hình này sinh ra để tìm. Đơn vẫn còn nguyên trong `activeCoverIds`
 * nên giao diện vẫn nói được "người này có đơn nghỉ".
 *
 * Ngày lễ đứng SAU đơn công tác nhưng TRƯỚC "không có ca": lễ mà đi công tác thì
 * điều đáng nói là chuyến công tác, còn lễ mà không ai làm gì thì điều đáng nói
 * là ngày lễ.
 */
export function classifyWorkState(input: WorkStateInput): WorkStateResult {
  const { nowMinutes, isPastDay, isHoliday, shiftWindows, marks, covers } = input;

  const sorted = [...marks].sort((a, b) => a.atMinutes - b.atMinutes);
  const firstCheckIn = sorted.find((mark) => mark.type === 'CHECK_IN') ?? null;
  const lastCheckOut = [...sorted].reverse().find((mark) => mark.type === 'CHECK_OUT') ?? null;

  const expectedStartMinutes = minOrNull(shiftWindows.map((window) => window.startMinutes));
  const expectedEndMinutes = maxOrNull(shiftWindows.map((window) => window.endMinutes));

  const approved = covers.filter((cover) => cover.status === APPROVED);
  const hasPendingRequest = covers.some((cover) => cover.status === PENDING);

  const wholeDayLeave = approved.filter((cover) => cover.wholeDay);
  const businessTrip = wholeDayLeave.find((cover) => cover.code === 'BUSINESS_TRIP') ?? null;

  const base = {
    firstCheckInMinutes: firstCheckIn?.atMinutes ?? null,
    lastCheckOutMinutes: lastCheckOut?.atMinutes ?? null,
    expectedStartMinutes,
    expectedEndMinutes,
    hasPendingRequest,
  };

  // ---------------------------------------------------------------------------
  //  1. Đã có dấu vết chấm công → trạng thái đọc từ chính dấu vết đó
  // ---------------------------------------------------------------------------

  if (firstCheckIn) {
    const intervals = outsideIntervals(sorted, firstCheckIn.atMinutes, lastCheckOut?.atMinutes);
    const outsideSince =
      intervals.find((interval) => interval.toMinutes === null)?.fromMinutes ?? null;

    // Quẹt BREAK_OUT mà chưa quẹt về là bằng chứng TRỰC TIẾP, mạnh hơn mọi thứ
    // suy ra từ đơn từ — nên nó đứng trước cả "đã chấm ra".
    if (outsideSince !== null) {
      return {
        ...base,
        state: 'OUTSIDE',
        outsideSinceMinutes: outsideSince,
        activeCoverIds: [],
      };
    }

    // Đã quẹt ra về thì họ đã về. Nhánh này phải đứng TRƯỚC nhánh đơn ra ngoài
    // bên dưới: một đơn xin ra ngoài 14:00–18:00 của người đã quẹt ra lúc 16:30
    // không biến họ thành "đang ra ngoài rồi sẽ quay lại".
    if (lastCheckOut) {
      return { ...base, state: 'DONE', outsideSinceMinutes: null, activeCoverIds: [] };
    }

    // Đơn ra ngoài đã duyệt, dùng cho công ty KHÔNG bắt quẹt lúc ra khỏi cổng.
    // Bỏ nguồn này thì với họ màn hình luôn nói "đang làm" cho người đã đi vắng.
    const activeGoOut = approved.filter(
      (cover) => !cover.wholeDay && cover.fromMinutes <= nowMinutes && nowMinutes < cover.toMinutes,
    );

    if (activeGoOut.length > 0) {
      return {
        ...base,
        state: 'OUTSIDE',
        outsideSinceMinutes: activeGoOut[0]?.fromMinutes ?? nowMinutes,
        activeCoverIds: activeGoOut.map((cover) => cover.requestId),
      };
    }

    // Chưa chấm ra. Quá giờ tan ca một khoảng đủ dài thì đây không còn là "đang
    // làm" mà là một bản ghi thiếu, và nó phải được sửa trước khi chốt công.
    const overdue =
      expectedEndMinutes !== null &&
      nowMinutes > expectedEndMinutes + MISSING_CHECKOUT_GRACE_MINUTES;

    return {
      ...base,
      state: overdue || isPastDay ? 'MISSING_CHECKOUT' : 'WORKING',
      outsideSinceMinutes: null,
      activeCoverIds: [],
    };
  }

  // ---------------------------------------------------------------------------
  //  2. Chưa quẹt lần nào → đơn từ và lịch ca quyết định
  // ---------------------------------------------------------------------------

  if (businessTrip) {
    return {
      ...base,
      state: 'BUSINESS_TRIP',
      outsideSinceMinutes: null,
      activeCoverIds: [businessTrip.requestId],
    };
  }

  if (wholeDayLeave.length > 0) {
    return {
      ...base,
      state: 'ON_LEAVE',
      outsideSinceMinutes: null,
      activeCoverIds: wholeDayLeave.map((cover) => cover.requestId),
    };
  }

  if (isHoliday) {
    return { ...base, state: 'HOLIDAY', outsideSinceMinutes: null, activeCoverIds: [] };
  }

  if (shiftWindows.length === 0 || expectedStartMinutes === null) {
    return { ...base, state: 'NO_SHIFT', outsideSinceMinutes: null, activeCoverIds: [] };
  }

  // Dung sai của ĐÚNG ca sớm nhất, không phải dung sai lớn nhất trong ngày: người
  // được xếp hai ca thì mốc phải trễ giờ là mốc của ca họ vào trước.
  const earliest = shiftWindows.reduce((best, window) =>
    window.startMinutes < best.startMinutes ? window : best,
  );
  const deadline = earliest.startMinutes + earliest.lateToleranceMinutes;

  if (isPastDay) {
    return { ...base, state: 'ABSENT', outsideSinceMinutes: null, activeCoverIds: [] };
  }

  return {
    ...base,
    state: nowMinutes > deadline ? 'LATE_NOT_ARRIVED' : 'NOT_ARRIVED',
    outsideSinceMinutes: null,
    activeCoverIds: [],
  };
}

/** Một lần ra khỏi nơi làm việc. `toMinutes === null` = chưa quay lại. */
export interface OutsideInterval {
  fromMinutes: number;
  toMinutes: number | null;
}

/**
 * Các khoảng ra ngoài, ghép theo CẶP `BREAK_OUT` → `BREAK_IN`.
 *
 * Ghép cặp chứ không chỉ nhìn "lượt cuối cùng có phải BREAK_OUT không": cách sau
 * sai ngay khi người dùng quẹt nhầm rồi quẹt lại, hoặc khi máy chấm công đẩy
 * lượt offline lên muộn và thứ tự ghi trong database không còn là thứ tự thật.
 *
 * Chỉ tính những lượt nằm SAU giờ chấm vào và TRƯỚC giờ chấm ra: một `BREAK_OUT`
 * mồ côi từ trước lúc vào ca là dữ liệu rác, không phải người đang ở ngoài.
 *
 * Cùng một hàm phục vụ hai việc — phân loại trạng thái, và vẽ đoạn màu trên dòng
 * thời gian. Nếu tách đôi thì sẽ có ngày lưới vẽ một đoạn "đang ở ngoài" trong
 * khi cột trạng thái ngay cạnh ghi "đang làm".
 */
export function outsideIntervals(
  marks: WorkMark[],
  checkInMinutes: number,
  checkOutMinutes: number | undefined,
): OutsideInterval[] {
  const sorted = [...marks].sort((a, b) => a.atMinutes - b.atMinutes);
  const intervals: OutsideInterval[] = [];
  let open: OutsideInterval | null = null;

  for (const mark of sorted) {
    if (mark.atMinutes < checkInMinutes) continue;
    if (checkOutMinutes !== undefined && mark.atMinutes > checkOutMinutes) break;

    if (mark.type === 'BREAK_OUT') {
      // Hai `BREAK_OUT` liên tiếp: giữ khoảng đang mở, đừng mở khoảng thứ hai —
      // người ta không ra ngoài được hai lần mà chưa quay về lần nào.
      if (!open) {
        open = { fromMinutes: mark.atMinutes, toMinutes: null };
        intervals.push(open);
      }
    } else if (mark.type === 'BREAK_IN' && open) {
      open.toMinutes = mark.atMinutes;
      open = null;
    }
  }

  return intervals;
}

function minOrNull(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function maxOrNull(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

/**
 * Đếm trạng thái cho phần tổng ở đầu trang.
 *
 * Nhận đúng những `WorkState` đã phân loại ở trên chứ không phân loại lại — đây
 * là toàn bộ lý do tồn tại của hàm này thay vì một vòng lặp thứ hai ở service.
 */
export function countWorkStates(states: WorkState[]): Record<WorkState, number> {
  const counts = Object.fromEntries(WORK_STATES.map((state) => [state, 0])) as Record<
    WorkState,
    number
  >;
  for (const state of states) counts[state] += 1;
  return counts;
}
