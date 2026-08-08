import { formatBssid, isValidBssid, normalizeBssid } from './network.util';

/**
 * AF-02 — chuẩn hoá BSSID.
 *
 * Hỏng ở đây thì hậu quả rất khó lần: nhân viên bị từ chối chấm công chỉ vì HR
 * gõ chữ hoa, mà nhìn bằng mắt thì hai chuỗi "giống hệt nhau".
 */
describe('normalizeBssid', () => {
  const CANONICAL = 'A42B8C119D0E';

  it.each([
    ['a4:2b:8c:11:9d:0e', 'Android — chữ thường, dấu hai chấm'],
    ['A4:2B:8C:11:9D:0E', 'chữ hoa, dấu hai chấm'],
    ['A4-2B-8C-11-9D-0E', 'Windows — dấu gạch'],
    ['a42b8c119d0e', 'HR chép tay, không dấu phân tách'],
    ['A4 2B 8C 11 9D 0E', 'có khoảng trắng'],
    ['  a4:2b:8c:11:9d:0e  ', 'thừa khoảng trắng hai đầu'],
    ['a4.2b.8c.11.9d.0e', 'dấu chấm'],
  ])('%s (%s) → cùng một giá trị', (input) => {
    expect(normalizeBssid(input)).toBe(CANONICAL);
  });

  describe('giá trị không dùng được', () => {
    const invalid: Array<[string | null | undefined, string]> = [
      ['', 'rỗng'],
      [null, 'null'],
      [undefined, 'undefined'],
      ['a4:2b:8c', 'quá ngắn'],
      ['a4:2b:8c:11:9d:0e:ff', 'quá dài'],
      ['khong-phai-mac', 'không phải hex'],
      ['a4:2b:8c:11:9d:zz', 'có ký tự ngoài hex'],
    ];

    it.each(invalid)('%s (%s) → chuỗi rỗng', (input) => {
      expect(normalizeBssid(input)).toBe('');
    });

    it('02:00:00:00:00:00 — Android trả khi app thiếu quyền vị trí', () => {
      // Đây là giá trị giữ chỗ, không phải bộ phát nào cả. Nhận nhầm nó thành
      // BSSID hợp lệ nghĩa là chỉ cần từ chối cấp quyền vị trí là qua được chốt.
      expect(normalizeBssid('02:00:00:00:00:00')).toBe('');
    });

    it('00:00:00:00:00:00 — địa chỉ rỗng', () => {
      expect(normalizeBssid('00:00:00:00:00:00')).toBe('');
    });
  });

  it('KHÔNG tự thêm số 0 thiếu — octet viết tắt là dữ liệu hỏng', () => {
    // "a4:2b:8c:11:9d:e" chỉ có 11 ký tự hex. Đoán rằng octet cuối là "0e" hay
    // "e0" đều là đoán, và đoán sai thì cho qua nhầm một bộ phát khác.
    expect(normalizeBssid('a4:2b:8c:11:9d:e')).toBe('');
  });
});

describe('formatBssid', () => {
  it('đưa về dạng dễ đọc cho người', () => {
    expect(formatBssid('A42B8C119D0E')).toBe('a4:2b:8c:11:9d:0e');
  });

  it('quay vòng được với normalizeBssid', () => {
    expect(normalizeBssid(formatBssid('A42B8C119D0E'))).toBe('A42B8C119D0E');
  });

  it('trả nguyên chuỗi nếu không đúng độ dài — không giả vờ định dạng được', () => {
    expect(formatBssid('rac')).toBe('rac');
  });
});

describe('isValidBssid', () => {
  it('chấp nhận mọi cách viết hợp lệ', () => {
    expect(isValidBssid('a4:2b:8c:11:9d:0e')).toBe(true);
    expect(isValidBssid('A4-2B-8C-11-9D-0E')).toBe(true);
  });

  it('từ chối giá trị hỏng', () => {
    expect(isValidBssid('02:00:00:00:00:00')).toBe(false);
    expect(isValidBssid('')).toBe(false);
  });
});
