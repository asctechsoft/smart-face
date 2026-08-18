import {
  classifyWorkState,
  countWorkStates,
  outsideIntervals,
  END_OF_WORKDAY_MINUTES,
  MISSING_CHECKOUT_GRACE_MINUTES,
  type LeaveCover,
  type ShiftWindow,
  type WorkMark,
} from './work-status.rules';

/**
 * Luật phân loại trạng thái làm việc — màn "Theo dõi công việc".
 *
 * Toàn bộ đầu vào là số nguyên (phút tính từ 00:00 ngày làm việc), nên bộ test
 * này không cần database và không có bẫy múi giờ nào. Đó chính là lý do luật
 * được tách khỏi service.
 *
 * Quy ước giờ dùng chung: ca hành chính 08:00–17:30 (480–1050).
 */

const HC: ShiftWindow = {
  shiftId: 'shift-hc',
  startMinutes: 8 * 60,
  endMinutes: 17 * 60 + 30,
  lateToleranceMinutes: 5,
};

/** Ca đêm 22:00 → 06:00 hôm sau: giờ tan ca là 30:00 = 1800 phút. */
const NIGHT: ShiftWindow = {
  shiftId: 'shift-night',
  startMinutes: 22 * 60,
  endMinutes: 30 * 60,
  lateToleranceMinutes: 10,
};

function mark(type: WorkMark['type'], hhmm: number): WorkMark {
  return { logId: `${type}-${hhmm}`, type, atMinutes: hhmm, authMethod: 'FACE' };
}

function at(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

function input(overrides: Partial<Parameters<typeof classifyWorkState>[0]> = {}) {
  return classifyWorkState({
    nowMinutes: at(10),
    isPastDay: false,
    isHoliday: false,
    shiftWindows: [HC],
    marks: [],
    covers: [],
    ...overrides,
  });
}

function cover(overrides: Partial<LeaveCover> = {}): LeaveCover {
  return {
    requestId: 'req-1',
    code: 'ANNUAL_LEAVE',
    status: 'APPROVED',
    fromMinutes: 0,
    toMinutes: 24 * 60,
    wholeDay: true,
    ...overrides,
  };
}

describe('classifyWorkState — chưa có lượt chấm nào', () => {
  it('chưa tới giờ vào ca thì là "chưa đến", không phải cảnh báo', () => {
    expect(input({ nowMinutes: at(7, 30) }).state).toBe('NOT_ARRIVED');
  });

  it('đúng mốc dung sai vẫn là "chưa đến" — dung sai phải được hưởng trọn', () => {
    expect(input({ nowMinutes: at(8, 5) }).state).toBe('NOT_ARRIVED');
  });

  it('quá dung sai một phút thì chuyển sang cảnh báo', () => {
    expect(input({ nowMinutes: at(8, 6) }).state).toBe('LATE_NOT_ARRIVED');
  });

  it('dung sai lấy của ca VÀO TRƯỚC khi một người có hai ca', () => {
    const late: ShiftWindow = { ...HC, shiftId: 'shift-late', startMinutes: at(14) };
    // 08:06 đã quá dung sai của ca sáng, dù ca chiều còn lâu mới tới.
    expect(input({ nowMinutes: at(8, 6), shiftWindows: [late, HC] }).state).toBe(
      'LATE_NOT_ARRIVED',
    );
  });

  it('ngày đã qua mà không chấm, không đơn → vắng, không phải "chưa đến"', () => {
    expect(input({ isPastDay: true, nowMinutes: END_OF_WORKDAY_MINUTES }).state).toBe('ABSENT');
  });

  it('không có ca thì không có nghĩa vụ nào để vi phạm', () => {
    expect(input({ shiftWindows: [], nowMinutes: at(20) }).state).toBe('NO_SHIFT');
  });

  it('ngày lễ đứng trước "không có ca" — hôm đó không ai phải đến', () => {
    expect(input({ isHoliday: true, shiftWindows: [], nowMinutes: at(20) }).state).toBe('HOLIDAY');
  });

  it('nghỉ cả ngày theo đơn ĐÃ DUYỆT che mất cảnh báo trễ giờ', () => {
    expect(input({ nowMinutes: at(11), covers: [cover()] }).state).toBe('ON_LEAVE');
  });

  it('đơn CHỜ DUYỆT thì KHÔNG che — chưa duyệt thì người đó vẫn phải có mặt', () => {
    const result = input({ nowMinutes: at(11), covers: [cover({ status: 'PENDING' })] });
    expect(result.state).toBe('LATE_NOT_ARRIVED');
    expect(result.hasPendingRequest).toBe(true);
  });

  it('công tác tách khỏi nghỉ phép: là ngày đi làm, chỉ là làm ở chỗ khác', () => {
    const result = input({
      nowMinutes: at(11),
      covers: [cover({ code: 'BUSINESS_TRIP' })],
    });
    expect(result.state).toBe('BUSINESS_TRIP');
  });

  it('nghỉ nửa ngày KHÔNG che cả ngày — buổi còn lại vẫn phải đi làm', () => {
    const halfDay = cover({ wholeDay: false, fromMinutes: at(13), toMinutes: at(17, 30) });
    expect(input({ nowMinutes: at(11), covers: [halfDay] }).state).toBe('LATE_NOT_ARRIVED');
  });
});

describe('classifyWorkState — đã có lượt chấm', () => {
  it('chấm vào, chưa chấm ra, chưa quá giờ tan ca → đang làm', () => {
    const result = input({ nowMinutes: at(10), marks: [mark('CHECK_IN', at(8, 2))] });
    expect(result.state).toBe('WORKING');
    expect(result.firstCheckInMinutes).toBe(at(8, 2));
    expect(result.lastCheckOutMinutes).toBeNull();
  });

  it('đã chấm ra → đã về', () => {
    const result = input({
      nowMinutes: at(18),
      marks: [mark('CHECK_IN', at(8, 2)), mark('CHECK_OUT', at(17, 35))],
    });
    expect(result.state).toBe('DONE');
    expect(result.lastCheckOutMinutes).toBe(at(17, 35));
  });

  it('trong thời gian ân hạn sau giờ tan ca vẫn là "đang làm", chưa phải quên chấm ra', () => {
    const result = input({
      nowMinutes: HC.endMinutes + MISSING_CHECKOUT_GRACE_MINUTES,
      marks: [mark('CHECK_IN', at(8))],
    });
    expect(result.state).toBe('WORKING');
  });

  it('quá ân hạn mà chưa chấm ra → quên chấm ra', () => {
    const result = input({
      nowMinutes: HC.endMinutes + MISSING_CHECKOUT_GRACE_MINUTES + 1,
      marks: [mark('CHECK_IN', at(8))],
    });
    expect(result.state).toBe('MISSING_CHECKOUT');
  });

  it('ngày đã qua mà chỉ có giờ vào → quên chấm ra, dù ca chưa khai giờ kết thúc', () => {
    const result = input({
      isPastDay: true,
      nowMinutes: END_OF_WORKDAY_MINUTES,
      shiftWindows: [],
      marks: [mark('CHECK_IN', at(8))],
    });
    expect(result.state).toBe('MISSING_CHECKOUT');
  });

  it('lượt chấm THẮNG đơn nghỉ cả ngày — người có đơn mà vẫn tới làm là điều cần thấy', () => {
    const result = input({
      nowMinutes: at(10),
      marks: [mark('CHECK_IN', at(8, 2))],
      covers: [cover()],
    });
    expect(result.state).toBe('WORKING');
  });

  it('ca đêm: chấm vào 22:05, lúc 02:00 hôm sau (1560 phút) vẫn đang làm', () => {
    const result = input({
      shiftWindows: [NIGHT],
      nowMinutes: 26 * 60,
      marks: [mark('CHECK_IN', at(22, 5))],
    });
    expect(result.state).toBe('WORKING');
  });
});

describe('classifyWorkState — ra ngoài', () => {
  it('BREAK_OUT chưa có BREAK_IN → đang ra ngoài, kèm mốc bắt đầu', () => {
    const result = input({
      nowMinutes: at(13, 30),
      marks: [mark('CHECK_IN', at(8)), mark('BREAK_OUT', at(13))],
    });
    expect(result.state).toBe('OUTSIDE');
    expect(result.outsideSinceMinutes).toBe(at(13));
  });

  it('đã quay lại thì trở về "đang làm"', () => {
    const result = input({
      nowMinutes: at(15),
      marks: [mark('CHECK_IN', at(8)), mark('BREAK_OUT', at(13)), mark('BREAK_IN', at(14, 10))],
    });
    expect(result.state).toBe('WORKING');
    expect(result.outsideSinceMinutes).toBeNull();
  });

  it('đơn ra ngoài đã duyệt đang trong khoảng → ra ngoài, kể cả khi không quẹt BREAK_OUT', () => {
    const goOut = cover({
      requestId: 'req-goout',
      code: 'GO_OUT',
      wholeDay: false,
      fromMinutes: at(14),
      toMinutes: at(16),
    });
    const result = input({
      nowMinutes: at(15),
      marks: [mark('CHECK_IN', at(8))],
      covers: [goOut],
    });
    expect(result.state).toBe('OUTSIDE');
    expect(result.activeCoverIds).toEqual(['req-goout']);
  });

  it('hết giờ của đơn ra ngoài thì thôi tính là ở ngoài', () => {
    const goOut = cover({
      code: 'GO_OUT',
      wholeDay: false,
      fromMinutes: at(14),
      toMinutes: at(16),
    });
    const result = input({
      nowMinutes: at(16),
      marks: [mark('CHECK_IN', at(8))],
      covers: [goOut],
    });
    expect(result.state).toBe('WORKING');
  });

  it('đã chấm ra rồi thì đơn ra ngoài không kéo trạng thái về "ra ngoài" nữa', () => {
    const goOut = cover({
      code: 'GO_OUT',
      wholeDay: false,
      fromMinutes: at(14),
      toMinutes: at(18),
    });
    const result = input({
      nowMinutes: at(17),
      marks: [mark('CHECK_IN', at(8)), mark('CHECK_OUT', at(16, 30))],
      covers: [goOut],
    });
    // Người đã quẹt ra về thì họ đã về, không phải "đang ra ngoài rồi sẽ quay lại".
    expect(result.state).toBe('DONE');
  });
});

describe('outsideIntervals', () => {
  it('ghép từng cặp BREAK_OUT → BREAK_IN', () => {
    const marks = [
      mark('CHECK_IN', at(8)),
      mark('BREAK_OUT', at(10)),
      mark('BREAK_IN', at(10, 30)),
      mark('BREAK_OUT', at(14)),
      mark('BREAK_IN', at(14, 20)),
    ];
    expect(outsideIntervals(marks, at(8), undefined)).toEqual([
      { fromMinutes: at(10), toMinutes: at(10, 30) },
      { fromMinutes: at(14), toMinutes: at(14, 20) },
    ]);
  });

  it('hai BREAK_OUT liên tiếp chỉ mở MỘT khoảng — không ai ra ngoài hai lần cùng lúc', () => {
    const marks = [mark('BREAK_OUT', at(10)), mark('BREAK_OUT', at(10, 1))];
    expect(outsideIntervals(marks, at(8), undefined)).toEqual([
      { fromMinutes: at(10), toMinutes: null },
    ]);
  });

  it('bỏ qua lượt mồ côi trước giờ chấm vào — đó là dữ liệu rác', () => {
    const marks = [mark('BREAK_OUT', at(6)), mark('CHECK_IN', at(8))];
    expect(outsideIntervals(marks, at(8), undefined)).toEqual([]);
  });

  it('không đọc quá giờ chấm ra', () => {
    const marks = [mark('CHECK_OUT', at(17)), mark('BREAK_OUT', at(18))];
    expect(outsideIntervals(marks, at(8), at(17))).toEqual([]);
  });

  it('thứ tự ghi trong database lộn xộn vẫn ra đúng kết quả', () => {
    const marks = [mark('BREAK_IN', at(10, 30)), mark('BREAK_OUT', at(10))];
    expect(outsideIntervals(marks, at(8), undefined)).toEqual([
      { fromMinutes: at(10), toMinutes: at(10, 30) },
    ]);
  });
});

describe('countWorkStates', () => {
  it('mọi trạng thái đều có mặt, kể cả khi bằng 0 — ô thống kê không được biến mất', () => {
    const counts = countWorkStates(['WORKING', 'WORKING', 'ABSENT']);
    expect(counts.WORKING).toBe(2);
    expect(counts.ABSENT).toBe(1);
    expect(counts.ON_LEAVE).toBe(0);
    expect(counts.HOLIDAY).toBe(0);
  });
});
