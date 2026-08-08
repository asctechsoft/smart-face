import {
  buildEmployeeCode,
  buildNameSlug,
  buildUniqueEmployeeCode,
  isValidEmployeeCode,
  normalizeFullName,
  removeVietnameseTones,
} from './employee-code.util';

/** docs/01-tong-quan-he-thong.md mục 8 — quy tắc sinh mã nhân viên. */
describe('employee-code.util', () => {
  describe('removeVietnameseTones', () => {
    it('bỏ dấu tiếng Việt', () => {
      expect(removeVietnameseTones('Nguyễn Văn Đức')).toBe('Nguyen Van Duc');
      expect(removeVietnameseTones('Phạm Thị Ánh Tuyết')).toBe('Pham Thi Anh Tuyet');
    });

    it('xử lý được đ/Đ mà chuẩn hoá NFD không tách ra', () => {
      expect(removeVietnameseTones('đường')).toBe('duong');
      expect(removeVietnameseTones('ĐỨC')).toBe('DUC');
    });
  });

  describe('normalizeFullName', () => {
    it('bỏ ký tự đặc biệt và gộp khoảng trắng thừa', () => {
      expect(normalizeFullName('  Nguyễn   Văn  Đức!! ')).toBe('nguyen van duc');
    });
  });

  describe('buildNameSlug', () => {
    it('lấy tên chính + viết tắt họ và tên lót theo thứ tự', () => {
      // Nguyễn Văn Đức → tên chính "duc", họ "n", tên lót "v" → ducnv
      expect(buildNameSlug('Nguyễn Văn Đức')).toBe('ducnv');
      expect(buildNameSlug('Lê Văn Hùng')).toBe('hunglv');
      expect(buildNameSlug('Trần Thị Mai')).toBe('maitt');
    });

    it('xử lý tên bốn chữ', () => {
      expect(buildNameSlug('Nguyễn Thị Ánh Tuyết')).toBe('tuyetnta');
    });

    it('xử lý tên một chữ', () => {
      expect(buildNameSlug('Đức')).toBe('duc');
    });

    it('trả chuỗi rỗng khi tên rỗng', () => {
      expect(buildNameSlug('   ')).toBe('');
    });
  });

  describe('buildEmployeeCode', () => {
    it('ghép mã theo định dạng <viết tắt tên>.<mã công ty>', () => {
      expect(buildEmployeeCode('Nguyễn Văn Đức', 'amobi')).toBe('ducnv.amobi');
      expect(buildEmployeeCode('Nguyễn Văn Đức', 'AMOBI')).toBe('ducnv.amobi');
    });
  });

  describe('buildUniqueEmployeeCode', () => {
    it('trả mã cơ sở khi chưa có ai dùng', () => {
      expect(buildUniqueEmployeeCode('Nguyễn Văn Đức', 'amobi', new Set())).toBe('ducnv.amobi');
    });

    it('thêm số thứ tự vào SAU phần tên viết tắt khi trùng', () => {
      const taken = new Set(['ducnv.amobi']);
      expect(buildUniqueEmployeeCode('Nguyễn Văn Đức', 'amobi', taken)).toBe('ducnv2.amobi');
    });

    it('tăng dần cho tới khi tìm được mã trống', () => {
      const taken = new Set(['ducnv.amobi', 'ducnv2.amobi', 'ducnv3.amobi']);
      expect(buildUniqueEmployeeCode('Nguyễn Văn Đức', 'amobi', taken)).toBe('ducnv4.amobi');
    });

    it('sinh mã khác nhau cho hai người TRÙNG TÊN trong cùng lô import (docs/04 mục 8.4)', () => {
      const taken = new Set<string>();

      const first = buildUniqueEmployeeCode('Nguyễn Văn Đức', 'amobi', taken);
      taken.add(first);
      const second = buildUniqueEmployeeCode('Nguyễn Văn Đức', 'amobi', taken);

      expect(first).toBe('ducnv.amobi');
      expect(second).toBe('ducnv2.amobi');
      expect(first).not.toBe(second);
    });
  });

  describe('isValidEmployeeCode', () => {
    it.each([
      ['ducnv.amobi', true],
      ['ducnv2.amobi', true],
      ['DucNV.amobi', false],
      ['ducnv', false],
      ['ducnv.amobi.extra', false],
      ['duc nv.amobi', false],
    ])('%s → %s', (code, expected) => {
      expect(isValidEmployeeCode(code)).toBe(expected);
    });
  });
});
