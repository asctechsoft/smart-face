import { AppException } from 'src/common/errors';
import { PasswordService } from './password.service';

/**
 * Từ khi chuyển sang Firebase Authentication, service này không còn băm mật khẩu
 * — Firebase giữ. Các test về `hash` / `verify` / `needsRehash` (scrypt) đã bỏ
 * cùng với những hàm đó.
 *
 * Phần còn lại QUAN TRỌNG HƠN TRƯỚC: Firebase bản không nâng cấp Identity
 * Platform chỉ ép được độ dài tối thiểu 6 ký tự và không ép được quy tắc thành
 * phần nào, nên đây là nơi duy nhất còn giữ chuẩn của hệ thống.
 */
describe('PasswordService', () => {
  const service = new PasswordService();

  describe('chính sách độ mạnh', () => {
    it('chấp nhận mật khẩu hợp lệ', () => {
      expect(() => service.assertStrong('CongTyAmobi2026')).not.toThrow();
    });

    it('chấp nhận đúng mức sàn 8 ký tự của bản thiết kế', () => {
      expect(() => service.assertStrong('Matbau26')).not.toThrow();
    });

    it.each([
      ['Ngan12', 'quá ngắn'],
      ['matkhau2026', 'không có chữ hoa'],
      ['MATKHAU2026', 'không có chữ thường'],
      ['MatKhauMoi', 'không có chữ số lẫn ký tự đặc biệt'],
      ['123456789012', 'không có chữ cái nào'],
      ['aaaaaaaaaaaaaa', 'chỉ một ký tự lặp lại nên không có chữ hoa'],
      ['Password1', 'nằm trong danh sách phổ biến'],
      ['Matkhau@123', 'khuôn mà chính luật thành phần đẻ ra'],
    ])('từ chối %s (%s)', (weak) => {
      expect(() => service.assertStrong(weak)).toThrow(AppException);
    });

    it('chấp nhận ký tự đặc biệt thay cho chữ số', () => {
      expect(() => service.assertStrong('CaiDenHoi!')).not.toThrow();
    });

    it('nhận chữ hoa và chữ thường có dấu tiếng Việt', () => {
      /*
       * `[a-z]` không khớp `ầ` hay `ồ`. Nếu luật thành phần viết bằng lớp ký tự
       * ASCII thì `Cầuvồng1` — tám chữ thường rành rành — bị từ chối vì "thiếu
       * chữ thường", và người dùng không có cách nào hiểu vì sao.
       */
      expect(() => service.assertStrong('Cầuvồng1')).not.toThrow();
      expect(() => service.assertStrong('CẦUVỒNG1')).toThrow(AppException);
    });

    it('từ chối mật khẩu chứa phần đầu email', () => {
      // Kẻ tấn công thử những thứ này đầu tiên.
      expect(() => service.assertStrong('Ducnv12345678', { email: 'ducnv@amobi.vn' })).toThrow(
        AppException,
      );
    });

    it('nêu rõ TỪNG lý do để App hiển thị cho người dùng sửa', () => {
      try {
        // Vừa quá ngắn, vừa thiếu chữ hoa, vừa thiếu số/ký tự đặc biệt → ba lý do.
        service.assertStrong('aaa');
        fail('đáng lẽ phải ném lỗi');
      } catch (error) {
        expect((error as AppException).details).toHaveProperty('reasons');
        expect(
          ((error as AppException).details as { reasons: string[] }).reasons.length,
        ).toBeGreaterThan(1);
      }
    });

    it('từ chối mật khẩu dài quá mức', () => {
      // Firebase cũng có giới hạn riêng; chặn sớm ở đây cho thông báo lỗi rõ ràng
      // thay vì để SDK trả về một mã lỗi khó hiểu.
      expect(() => service.assertStrong('a1'.repeat(200))).toThrow(AppException);
    });
  });

  describe('mật khẩu tạm', () => {
    /*
     * 500 lần, không phải 20.
     *
     * Bốc ngẫu nhiên từ bảng gộp trượt luật "có ít nhất 1 chữ số" với xác suất
     * (48/56)^14 ≈ 11%. Một vòng 20 lần vẫn trượt được — nhưng cũng qua được
     * khoảng 9% số lần chạy, nên nó sẽ đỏ một cách ngẫu nhiên trên CI và bị coi
     * là test chập chờn thay vì là lỗi thật. 500 lần thì xác suất lọt của một
     * cài đặt hỏng nhỏ hơn 10^-25.
     */
    it('thoả chính sách độ mạnh của chính hệ thống', () => {
      for (let index = 0; index < 500; index += 1) {
        const temporary = service.generateTemporary();
        expect(() => service.assertStrong(temporary)).not.toThrow();
      }
    });

    it('không luôn đặt ba ký tự bắt buộc ở ba vị trí đầu', () => {
      // Nếu không xáo, mọi mật khẩu tạm đều theo khuôn thường-HOA-số ở đầu, và
      // người nhìn vài cái là đoán ra ba ký tự đầu thuộc loại nào.
      const heads = new Set(
        Array.from({ length: 60 }, () =>
          service
            .generateTemporary()
            .slice(0, 3)
            .replace(/\p{Lu}/gu, 'U')
            .replace(/\p{Ll}/gu, 'l')
            .replace(/\p{N}/gu, 'd'),
        ),
      );
      expect(heads.size).toBeGreaterThan(1);
    });

    it('không chứa ký tự dễ đọc nhầm', () => {
      // HR đọc mật khẩu này qua điện thoại hoặc chép tay từ giấy.
      const generated = Array.from({ length: 30 }, () => service.generateTemporary()).join('');
      expect(generated).not.toMatch(/[0O1lI]/);
    });

    it('mỗi lần sinh một giá trị khác nhau', () => {
      const values = new Set(Array.from({ length: 50 }, () => service.generateTemporary()));
      expect(values.size).toBe(50);
    });
  });
});
