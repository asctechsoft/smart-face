import { AppException } from 'src/common/errors';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  // scrypt cố tình chậm — đó là mục đích của nó. Nới timeout cho các test có băm.
  jest.setTimeout(30_000);

  describe('băm và kiểm', () => {
    it('mật khẩu đúng thì kiểm thành công', async () => {
      const stored = await service.hash('MatKhauCuaToi2026');
      await expect(service.verify('MatKhauCuaToi2026', stored)).resolves.toBe(true);
    });

    it('mật khẩu sai thì không qua', async () => {
      const stored = await service.hash('MatKhauCuaToi2026');
      await expect(service.verify('MatKhauCuaToi2027', stored)).resolves.toBe(false);
    });

    it('phân biệt chữ hoa chữ thường', async () => {
      const stored = await service.hash('MatKhauCuaToi2026');
      await expect(service.verify('matkhaucuatoi2026', stored)).resolves.toBe(false);
    });

    it('cùng mật khẩu cho hai chuỗi băm KHÁC nhau', async () => {
      // Salt ngẫu nhiên mỗi lần. Nếu giống nhau thì kẻ đọc được DB biết ngay
      // những ai đang dùng chung một mật khẩu.
      const a = await service.hash('MatKhauCuaToi2026');
      const b = await service.hash('MatKhauCuaToi2026');
      expect(a).not.toBe(b);
    });

    it('không lưu mật khẩu gốc trong chuỗi băm', async () => {
      const stored = await service.hash('MatKhauCuaToi2026');
      expect(stored).not.toContain('MatKhauCuaToi2026');
    });

    it('ghi kèm tham số để nâng cấp về sau vẫn kiểm được mật khẩu cũ', async () => {
      const stored = await service.hash('MatKhauCuaToi2026');
      expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
    });

    it('chuẩn hoá Unicode — tiếng Việt gõ bằng hai bộ gõ khác nhau vẫn khớp', async () => {
      // "Đức" tổ hợp sẵn (NFC) và tách dấu (NFD) là hai chuỗi byte khác nhau
      // nhưng người dùng gõ ra cùng một thứ.
      const stored = await service.hash('MatKhauéDuc2026');
      await expect(service.verify('MatKhauéDuc2026', stored)).resolves.toBe(true);
    });
  });

  describe('chuỗi băm hỏng', () => {
    it.each([
      ['', 'rỗng'],
      ['khong-phai-hash', 'không đúng định dạng'],
      ['scrypt$65536$8$1$salt', 'thiếu phần'],
      ['bcrypt$65536$8$1$c2FsdA$aGFzaA', 'thuật toán lạ'],
      ['scrypt$abc$8$1$c2FsdA$aGFzaA', 'tham số không phải số'],
      ['scrypt$65536$8$1$c2FsdA$', 'hash rỗng'],
    ])('trả false thay vì ném lỗi với chuỗi %s (%s)', async (stored) => {
      // Một bản ghi hỏng trong DB không được biến thành 500, và cũng không được
      // để lộ ra rằng tài khoản này khác các tài khoản khác ở điểm nào.
      await expect(service.verify('bat-ky', stored)).resolves.toBe(false);
    });
  });

  describe('needsRehash', () => {
    it('chuỗi băm mới thì không cần băm lại', async () => {
      expect(service.needsRehash(await service.hash('MatKhauCuaToi2026'))).toBe(false);
    });

    it('chuỗi băm dùng tham số yếu hơn thì cần băm lại', () => {
      expect(service.needsRehash('scrypt$16384$8$1$c2FsdA$aGFzaA')).toBe(true);
    });

    it('chuỗi băm hỏng cũng coi là cần băm lại', () => {
      expect(service.needsRehash('rac')).toBe(true);
    });
  });

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
        expect(((error as AppException).details as { reasons: string[] }).reasons.length).toBeGreaterThan(1);
      }
    });

    it('từ chối mật khẩu dài quá mức — chặn tấn công làm nghẽn CPU', () => {
      // scrypt cố tình tốn kém; chuỗi 10MB sẽ chiếm CPU rất lâu.
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
