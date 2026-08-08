import { base32Decode, base32Encode, TotpService } from './totp.service';

/**
 * Bản tự cài TOTP chỉ đáng tin khi khớp vector thử chuẩn.
 *
 * Secret dùng trong RFC 4226 phụ lục D và RFC 6238 phụ lục B là chuỗi ASCII
 * "12345678901234567890" (20 byte), tức base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
 *
 * Test ở đây FAIL nghĩa là ứng dụng xác thực trên điện thoại người dùng sẽ sinh
 * mã mà server không nhận — không đăng nhập được nữa.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TotpService', () => {
  const totp = new TotpService();

  // ===========================================================================
  //  RFC 4226 phụ lục D — vector HOTP
  // ===========================================================================

  describe('HOTP — RFC 4226 phụ lục D', () => {
    // Bộ đếm TOTP = floor(giây / 30), nên bộ đếm N ứng với mốc N*30 giây.
    it.each([
      [0, '755224'],
      [1, '287082'],
      [2, '359152'],
      [3, '969429'],
      [4, '338314'],
      [5, '254676'],
      [6, '287922'],
      [7, '162583'],
      [8, '399871'],
      [9, '520489'],
    ])('bộ đếm %i → %s', (counter, expected) => {
      expect(totp.generate(RFC_SECRET, counter * 30 * 1000)).toBe(expected);
    });
  });

  // ===========================================================================
  //  RFC 6238 phụ lục B — vector TOTP
  // ===========================================================================

  describe('TOTP — RFC 6238 phụ lục B', () => {
    // RFC liệt kê mã 8 chữ số; bản 6 chữ số là 6 chữ số cuối, vì phép cắt là
    // `binary % 10^digits`.
    it.each([
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ])('mốc %i giây → %s', (seconds, expected) => {
      expect(totp.generate(RFC_SECRET, seconds * 1000)).toBe(expected);
    });
  });

  // ===========================================================================
  //  Cửa sổ chấp nhận lệch giờ
  // ===========================================================================

  describe('cửa sổ thời gian', () => {
    const now = 1_700_000_000_000;

    it('chấp nhận mã của bước hiện tại', () => {
      expect(totp.verify(RFC_SECRET, totp.generate(RFC_SECRET, now), now)).toBe(0);
    });

    it('chấp nhận mã của bước TRƯỚC — người dùng gõ chậm', () => {
      const previous = totp.generate(RFC_SECRET, now - 30_000);
      expect(totp.verify(RFC_SECRET, previous, now)).toBe(-1);
    });

    it('chấp nhận mã của bước SAU — đồng hồ điện thoại nhanh vài giây', () => {
      const next = totp.generate(RFC_SECRET, now + 30_000);
      expect(totp.verify(RFC_SECRET, next, now)).toBe(1);
    });

    it('TỪ CHỐI mã quá cũ hai bước', () => {
      const stale = totp.generate(RFC_SECRET, now - 60_000);
      expect(totp.verify(RFC_SECRET, stale, now)).toBeNull();
    });

    it('trả về CHỈ SỐ BƯỚC chứ không phải boolean', () => {
      // Tầng gọi cần lưu bước đã dùng để chặn dùng lại cùng một mã trong 90
      // giây — không có chốt đó thì kẻ nhìn trộm màn hình gõ lại được ngay.
      const result = totp.verify(RFC_SECRET, totp.generate(RFC_SECRET, now), now);
      expect(typeof result).toBe('number');
    });
  });

  // ===========================================================================
  //  Đầu vào không hợp lệ
  // ===========================================================================

  describe('đầu vào không hợp lệ', () => {
    const now = 1_700_000_000_000;

    it.each([
      ['12345', 'thiếu chữ số'],
      ['1234567', 'thừa chữ số'],
      ['abcdef', 'không phải số'],
      ['', 'rỗng'],
      ['12 34 56', 'có khoảng trắng ở giữa nhưng sai độ dài sau khi bỏ'],
    ])('từ chối %s (%s)', (code) => {
      // Chuỗi cuối sau khi bỏ khoảng trắng là "123456" — 6 chữ số hợp lệ về
      // hình thức, nên chỉ sai vì không khớp secret.
      expect(totp.verify(RFC_SECRET, code, now)).toBeNull();
    });

    it('bỏ qua khoảng trắng khi người dùng chép mã có dấu cách', () => {
      const code = totp.generate(RFC_SECRET, now);
      const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
      expect(totp.verify(RFC_SECRET, spaced, now)).toBe(0);
    });

    it('mã đúng nhưng secret khác thì không khớp', () => {
      const other = totp.generateSecret();
      expect(totp.verify(other, totp.generate(RFC_SECRET, now), now)).toBeNull();
    });
  });

  // ===========================================================================
  //  Sinh secret và URI
  // ===========================================================================

  describe('sinh secret', () => {
    it('secret dài 32 ký tự base32 = 160 bit, đúng khuyến nghị RFC 4226', () => {
      const secret = totp.generateSecret();
      expect(secret).toHaveLength(32);
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('mỗi lần gọi cho một secret khác nhau', () => {
      const secrets = new Set(Array.from({ length: 50 }, () => totp.generateSecret()));
      expect(secrets.size).toBe(50);
    });
  });

  describe('URI mã QR', () => {
    it('đúng định dạng otpauth và có đủ tham số', () => {
      const uri = totp.buildOtpAuthUri(RFC_SECRET, 'duc@amobi.vn', 'SmartFace');

      expect(uri.startsWith('otpauth://totp/')).toBe(true);
      expect(uri).toContain('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });

    it('issuer xuất hiện ở CẢ nhãn lẫn tham số truy vấn', () => {
      // Vài ứng dụng chỉ đọc một trong hai chỗ.
      const uri = totp.buildOtpAuthUri(RFC_SECRET, 'duc@amobi.vn', 'SmartFace');
      expect(uri).toContain('SmartFace%3Aduc%40amobi.vn');
      expect(uri).toContain('issuer=SmartFace');
    });
  });

  describe('mã dự phòng', () => {
    it('sinh đúng số lượng, không trùng nhau', () => {
      const codes = totp.generateRecoveryCodes(8);
      expect(codes).toHaveLength(8);
      expect(new Set(codes).size).toBe(8);
    });

    it('không chứa ký tự dễ đọc nhầm', () => {
      // Mã dự phòng thường được in ra giấy rồi chép tay lại.
      const codes = totp.generateRecoveryCodes(30).join('');
      expect(codes).not.toMatch(/[01ilo]/);
    });
  });
});

describe('base32 (RFC 4648)', () => {
  it('mã hoá đúng secret chuẩn của RFC', () => {
    expect(base32Encode(Buffer.from('12345678901234567890', 'ascii'))).toBe(RFC_SECRET);
  });

  it('giải mã ngược lại đúng', () => {
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
  });

  it.each([0, 1, 2, 3, 5, 10, 20, 64])('quay vòng đúng với %i byte', (length) => {
    const original = Buffer.alloc(length, 0xab);
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it('bỏ qua padding, khoảng trắng và dấu gạch khi giải mã', () => {
    // Người dùng chép secret từ màn hình thường kèm dấu cách để dễ đọc.
    expect(base32Decode('GEZD GNBV-GY3T QOJQ==')).toEqual(base32Decode('GEZDGNBVGY3TQOJQ'));
  });

  it('chấp nhận chữ thường', () => {
    expect(base32Decode(RFC_SECRET.toLowerCase())).toEqual(base32Decode(RFC_SECRET));
  });

  it('ném lỗi với ký tự ngoài bảng chữ cái base32', () => {
    // '1' và '8' không nằm trong bảng RFC 4648 — dễ bị chép nhầm từ 'I' và 'B'.
    expect(() => base32Decode('GEZD1NBV')).toThrow(/base32/);
  });
});
