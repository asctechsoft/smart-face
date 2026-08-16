import { ShiftType } from '@prisma/client';
import { findOverlappingShift, rangesOverlap, shiftRange } from './shift-overlap.util';

const fixed = (startTime: string, endTime: string, crossesMidnight = false) => ({
  startTime,
  endTime,
  crossesMidnight,
  type: ShiftType.FIXED,
});

const FLEXIBLE = {
  startTime: null,
  endTime: null,
  crossesMidnight: false,
  type: ShiftType.FLEXIBLE,
};

/**
 * Nhiều ca một ngày — điều kiện duy nhất là giờ không giao nhau.
 *
 * Ràng buộc này KHÔNG diễn đạt được bằng SQL, nên đây là chốt chặn thật sự.
 * Sai ở đây nghĩa là hai ca chồng giờ cùng được ghi vào lịch, rồi cùng tranh
 * một lượt quẹt thẻ khi chấm công.
 */
describe('Giao giờ giữa các ca trong ngày', () => {
  describe('quy khung giờ về trục phút', () => {
    it('ca thường nằm trong ngày', () => {
      expect(shiftRange(fixed('08:00', '17:30'))).toEqual({ from: 480, to: 1050 });
    });

    it('ca qua đêm kéo dài sang ngày hôm sau', () => {
      expect(shiftRange(fixed('22:00', '06:00', true))).toEqual({ from: 1320, to: 1800 });
    });

    /** Dữ liệu cũ có ca 22:00–06:00 mà quên bật cờ qua đêm — vẫn phải hiểu đúng. */
    it('suy ra ca qua đêm cả khi thiếu cờ', () => {
      expect(shiftRange(fixed('22:00', '06:00', false))).toEqual({ from: 1320, to: 1800 });
    });

    it('dịch theo độ lệch ngày', () => {
      expect(shiftRange(fixed('08:00', '17:30'), 1)).toEqual({ from: 1920, to: 2490 });
      expect(shiftRange(fixed('08:00', '17:30'), -1)).toEqual({ from: -960, to: -390 });
    });

    /**
     * Ca linh hoạt không khai giờ. Coi nó chiếm trọn ngày là lựa chọn CÓ Ý THỨC:
     * không biết nó chạy từ mấy giờ thì không thể khẳng định nó không đè lên ca
     * khác, mà đoán rộng ra sẽ thành hai ca tranh nhau cùng một lượt quẹt.
     */
    it('ca linh hoạt chiếm trọn ngày', () => {
      expect(shiftRange(FLEXIBLE)).toEqual({ from: 0, to: 1440 });
    });
  });

  describe('so hai khoảng', () => {
    it('chạm đầu–cuối KHÔNG tính là giao', () => {
      // Ca sáng 08:00–12:00 và ca chiều 12:00–17:00 là cách chia ca phổ biến
      // nhất. Coi đây là giao nhau thì tính năng vô dụng ngay từ đầu.
      expect(rangesOverlap({ from: 480, to: 720 }, { from: 720, to: 1020 })).toBe(false);
    });

    it('chồng một phút vẫn là giao', () => {
      expect(rangesOverlap({ from: 480, to: 721 }, { from: 720, to: 1020 })).toBe(true);
    });

    it('lồng hẳn bên trong là giao', () => {
      expect(rangesOverlap({ from: 540, to: 600 }, { from: 480, to: 1020 })).toBe(true);
    });
  });

  describe('tìm ca bị đè', () => {
    const existing = (shift: ReturnType<typeof fixed>, dayOffset: number, id: string) => ({
      shift,
      dayOffset,
      id,
    });

    it('cho xếp ca chiều cạnh ca sáng', () => {
      expect(
        findOverlappingShift(fixed('13:00', '17:00'), [existing(fixed('08:00', '12:00'), 0, 'a')]),
      ).toBeNull();
    });

    it('chặn ca trùng giờ trong cùng ngày', () => {
      expect(
        findOverlappingShift(fixed('11:00', '15:00'), [existing(fixed('08:00', '12:00'), 0, 'a')])
          ?.id,
      ).toBe('a');
    });

    /**
     * Đây là ca khó nhất và cũng là chỗ dễ bỏ sót nhất: ca đêm xếp cho HÔM QUA
     * chạy tới 06:00 hôm nay. Chỉ soi trong cùng `workDate` thì ca sáng 05:00
     * hôm nay lọt qua, và hai ca chồng nhau đúng một tiếng.
     */
    it('chặn ca sáng đè lên đuôi ca đêm của hôm trước', () => {
      expect(
        findOverlappingShift(fixed('05:00', '09:00'), [
          existing(fixed('22:00', '06:00', true), -1, 'dem'),
        ])?.id,
      ).toBe('dem');
    });

    it('cho xếp ca sáng bắt đầu đúng lúc ca đêm kết thúc', () => {
      expect(
        findOverlappingShift(fixed('06:00', '10:00'), [
          existing(fixed('22:00', '06:00', true), -1, 'dem'),
        ]),
      ).toBeNull();
    });

    /** Chiều ngược lại: xếp ca đêm cho hôm nay, hôm sau đã có ca sáng sớm. */
    it('chặn ca đêm đè lên ca sáng của hôm sau', () => {
      expect(
        findOverlappingShift(fixed('22:00', '06:00', true), [
          existing(fixed('05:00', '09:00'), 1, 'sang'),
        ])?.id,
      ).toBe('sang');
    });

    it('ca linh hoạt đè lên mọi ca trong ngày', () => {
      expect(
        findOverlappingShift(FLEXIBLE, [existing(fixed('08:00', '12:00'), 0, 'a')])?.id,
      ).toBe('a');
    });

    it('không có ca nào thì xếp được', () => {
      expect(findOverlappingShift(fixed('08:00', '17:30'), [])).toBeNull();
    });
  });
});
