import { AppException } from 'src/common/errors';
import { PasswordService } from './password.service';

/**
 * Từ khi chuyển sang Firebase Authentication, service này không còn băm mật khẩu
 * — Firebase giữ. Các test về `hash` / `verify` / `needsRehash` (scrypt) đã bỏ
 * cùng với những hàm đó.
 *
 * Phần còn lại QUAN TRỌNG HƠN TRƯỚC: Firebase bản không nâng cấp Identity
 * Platform chỉ ép được độ dài tối thiểu 6 ký tự, nên đây là nơi duy nhất còn giữ
 * chuẩn 12 ký tự của hệ thống.
 */
describe('PasswordService', () => {
  const service = new PasswordService();

  describe('chính sách độ mạnh', () => {
    it('chấp nhận mật khẩu hợp lệ', () => {
      expect(() => service.assertStrong('CongTyAmobi2026')).not.toThrow();
    });

    it.each([
      ['Ngan12', 'quá ngắn'],
      ['MatKhau2026', 'thiếu một ký tự nữa mới đủ 12'],
      ['123456789012', 'chỉ chữ số và chưa đủ 16 ký tự'],
      ['aaaaaaaaaaaaaa', 'chỉ một ký tự lặp lại'],
      ['password1234', 'nằm trong danh sách phổ biến'],
    ])('từ chối %s (%s)', (weak) => {
      expect(() => service.assertStrong(weak)).toThrow(AppException);
    });

    it('từ chối mật khẩu chứa phần đầu email', () => {
      // Kẻ tấn công thử những thứ này đầu tiên.
      expect(() => service.assertStrong('ducnv12345678', { email: 'ducnv@amobi.vn' })).toThrow(
        AppException,
      );
    });

    it('KHÔNG áp quy tắc thành phần ký tự', () => {
      // Quy tắc "phải có chữ hoa, số, ký tự đặc biệt" đẩy người dùng tới đúng
      // một khuôn `Matkhau@123` — thoả mọi điều kiện mà nằm đầu mọi danh sách
      // dò. Cụm dưới đây toàn chữ thường nhưng dài 19 ký tự, mạnh hơn hẳn.
      expect(() => service.assertStrong('caidenhoihaidongsau')).not.toThrow();
    });

    it('cho phép mật khẩu toàn chữ số nếu đủ dài', () => {
      // 16 chữ số ~ 10^16 khả năng, đã ngoài tầm dò offline thực tế.
      expect(() => service.assertStrong('4738295016482759')).not.toThrow();
    });

    it('nêu rõ TỪNG lý do để App hiển thị cho người dùng sửa', () => {
      try {
        // Vừa quá ngắn vừa chỉ gồm một ký tự lặp lại → hai lý do.
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
    it('thoả chính sách độ mạnh của chính hệ thống', () => {
      for (let index = 0; index < 20; index += 1) {
        const temporary = service.generateTemporary();
        expect(() => service.assertStrong(temporary)).not.toThrow();
      }
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
