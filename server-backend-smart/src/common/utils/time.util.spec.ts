import {
  absoluteSkewSeconds,
  combineWorkDateAndTime,
  eachWorkDate,
  formatWorkDate,
  isValidTimeOfDay,
  isWeekend,
  minutesBetween,
  parseWorkDate,
  timeToMinutes,
  toWorkDate,
  weekdayMaskOf,
} from './time.util';

const VN = 'Asia/Ho_Chi_Minh';

/**
 * docs/04 mục 6.4 — bẫy múi giờ.
 * Server chạy UTC, công ty ở Asia/Ho_Chi_Minh (UTC+7).
 */
describe('time.util', () => {
  describe('toWorkDate', () => {
    it('quy đổi instant UTC sang ngày làm việc theo timezone công ty', () => {
      // 2026-08-03T01:00Z = 08:00 giờ VN cùng ngày.
      expect(formatWorkDate(toWorkDate(new Date('2026-08-03T01:00:00Z'), VN))).toBe('2026-08-03');
    });

    it('23:00Z ngày 02 là 06:00 giờ VN ngày 03 — phải ra ngày 03', () => {
      expect(formatWorkDate(toWorkDate(new Date('2026-08-02T23:00:00Z'), VN))).toBe('2026-08-03');
    });

    it('16:00Z ngày 03 là 23:00 giờ VN cùng ngày — vẫn là ngày 03', () => {
      expect(formatWorkDate(toWorkDate(new Date('2026-08-03T16:00:00Z'), VN))).toBe('2026-08-03');
    });
  });

  describe('combineWorkDateAndTime', () => {
    it('08:00 giờ VN ngày 03/08 = 01:00Z cùng ngày', () => {
      const result = combineWorkDateAndTime(parseWorkDate('2026-08-03'), '08:00', VN);
      expect(result.toISOString()).toBe('2026-08-03T01:00:00.000Z');
    });

    it('17:30 giờ VN ngày 03/08 = 10:30Z cùng ngày', () => {
      const result = combineWorkDateAndTime(parseWorkDate('2026-08-03'), '17:30', VN);
      expect(result.toISOString()).toBe('2026-08-03T10:30:00.000Z');
    });

    it('dayOffset=1 dùng cho ca đêm kết thúc vào NGÀY HÔM SAU', () => {
      // Ca 22:00 → 06:00: giờ kết thúc thuộc ngày 04 theo giờ VN = 23:00Z ngày 03.
      const result = combineWorkDateAndTime(parseWorkDate('2026-08-03'), '06:00', VN, 1);
      expect(result.toISOString()).toBe('2026-08-03T23:00:00.000Z');
    });
  });

  describe('eachWorkDate', () => {
    it('liệt kê đủ các ngày, bao gồm cả hai đầu', () => {
      const dates = eachWorkDate(parseWorkDate('2026-08-01'), parseWorkDate('2026-08-05'));
      expect(dates.map(formatWorkDate)).toEqual([
        '2026-08-01',
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
      ]);
    });

    it('trả về một ngày khi from = to', () => {
      const dates = eachWorkDate(parseWorkDate('2026-08-03'), parseWorkDate('2026-08-03'));
      expect(dates).toHaveLength(1);
    });

    it('trả về rỗng khi to < from', () => {
      expect(eachWorkDate(parseWorkDate('2026-08-05'), parseWorkDate('2026-08-01'))).toHaveLength(0);
    });
  });

  describe('isWeekend', () => {
    it('nhận đúng thứ Bảy và Chủ nhật', () => {
      // 2026-08-01 là thứ Bảy, 2026-08-02 là Chủ nhật.
      expect(isWeekend(parseWorkDate('2026-08-01'))).toBe(true);
      expect(isWeekend(parseWorkDate('2026-08-02'))).toBe(true);
      expect(isWeekend(parseWorkDate('2026-08-03'))).toBe(false);
    });
  });

  describe('weekdayMaskOf', () => {
    it('T2 = 1, T3 = 2, CN = 64', () => {
      expect(weekdayMaskOf(parseWorkDate('2026-08-03'))).toBe(1); // thứ Hai
      expect(weekdayMaskOf(parseWorkDate('2026-08-04'))).toBe(2); // thứ Ba
      expect(weekdayMaskOf(parseWorkDate('2026-08-02'))).toBe(64); // Chủ nhật
    });

    it('mask T2–T6 (31) khớp thứ Hai nhưng không khớp thứ Bảy', () => {
      expect(weekdayMaskOf(parseWorkDate('2026-08-03')) & 31).toBeGreaterThan(0);
      expect(weekdayMaskOf(parseWorkDate('2026-08-01')) & 31).toBe(0);
    });
  });

  describe('isValidTimeOfDay', () => {
    it.each([
      ['08:00', true],
      ['23:59', true],
      ['00:00', true],
      ['24:00', false],
      ['8:00', false],
      ['08:60', false],
      ['abc', false],
    ])('%s → %s', (value, expected) => {
      expect(isValidTimeOfDay(value)).toBe(expected);
    });
  });

  describe('timeToMinutes', () => {
    it('quy đổi HH:mm sang phút', () => {
      expect(timeToMinutes('00:00')).toBe(0);
      expect(timeToMinutes('08:30')).toBe(510);
      expect(timeToMinutes('17:30')).toBe(1050);
    });
  });

  describe('absoluteSkewSeconds / minutesBetween', () => {
    it('tính lệch giờ tuyệt đối theo giây (AF-18)', () => {
      const a = new Date('2026-08-03T01:00:00Z');
      const b = new Date('2026-08-03T01:02:30Z');
      expect(absoluteSkewSeconds(a, b)).toBe(150);
      expect(absoluteSkewSeconds(b, a)).toBe(150);
    });

    it('minutesBetween âm khi to < from', () => {
      const a = new Date('2026-08-03T10:00:00Z');
      const b = new Date('2026-08-03T09:00:00Z');
      expect(minutesBetween(a, b)).toBe(-60);
    });
  });
});
