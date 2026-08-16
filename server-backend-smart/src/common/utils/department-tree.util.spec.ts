import { withAncestorDepartments, withDescendantDepartments } from './department-tree.util';

/**
 * Cây phòng ban của công ty mẫu — khối cha KHÔNG có nhân viên đứng trực tiếp,
 * đúng như dữ liệu thật. Đó là lý do hàm này tồn tại.
 */
const TREE = [
  { id: 'cty', parentId: null },
  { id: 'ketoan', parentId: 'cty' },
  { id: 'nhansu', parentId: 'cty' },
  { id: 'kythuat', parentId: 'cty' },
  { id: 'to1', parentId: 'kythuat' },
  { id: 'to2', parentId: 'kythuat' },
];

describe('Mở rộng phòng ban xuống cấp dưới', () => {
  it('lấy cả cây khi chọn gốc', () => {
    expect(withDescendantDepartments(TREE, ['cty']).sort()).toEqual(
      ['cty', 'ketoan', 'kythuat', 'nhansu', 'to1', 'to2'].sort(),
    );
  });

  it('xuống được nhiều cấp, không dừng ở cấp con trực tiếp', () => {
    expect(withDescendantDepartments(TREE, ['kythuat']).sort()).toEqual(
      ['kythuat', 'to1', 'to2'].sort(),
    );
  });

  it('lá chỉ trả về chính nó', () => {
    expect(withDescendantDepartments(TREE, ['to1'])).toEqual(['to1']);
  });

  it('không nhân bản khi chọn cả cha lẫn con', () => {
    const result = withDescendantDepartments(TREE, ['kythuat', 'to1']);
    expect(result.sort()).toEqual(['kythuat', 'to1', 'to2'].sort());
    expect(new Set(result).size).toBe(result.length);
  });

  /**
   * Mảng rỗng phải ra mảng rỗng, KHÔNG phải cả cây: nơi gọi hiểu mảng rỗng là
   * "không lọc gì" và chỉ truyền xuống database khi có phần tử. Trả cả cây ở đây
   * sẽ biến một bộ lọc trống thành bộ lọc khớp tất cả.
   */
  it('không chọn gì thì không mở rộng gì', () => {
    expect(withDescendantDepartments(TREE, [])).toEqual([]);
  });

  it('bỏ qua id không có trong cây thay vì ném lỗi', () => {
    expect(withDescendantDepartments(TREE, ['da-xoa'])).toEqual(['da-xoa']);
  });

  /**
   * Dữ liệu sai kiểu A là cha của B và B là cha của A tồn tại được trong database
   * (không có ràng buộc nào cấm). Không có `seen` thì vòng `while` chạy vô hạn và
   * treo cả request — hỏng nặng hơn nhiều so với việc trả thiếu một phòng ban.
   */
  it('không chạy vô hạn khi cha–con thành vòng lặp', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ];
    expect(withDescendantDepartments(cyclic, ['a']).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('Mở rộng phòng ban lên cấp trên', () => {
  it('đi hết đường lên gốc', () => {
    expect(withAncestorDepartments(TREE, ['to1']).sort()).toEqual(['cty', 'kythuat', 'to1'].sort());
  });

  it('không kéo theo anh em cùng cấp', () => {
    expect(withAncestorDepartments(TREE, ['to1'])).not.toContain('to2');
  });

  it('gốc chỉ trả về chính nó', () => {
    expect(withAncestorDepartments(TREE, ['cty'])).toEqual(['cty']);
  });

  it('không chọn gì thì không mở rộng gì', () => {
    expect(withAncestorDepartments(TREE, [])).toEqual([]);
  });

  it('không chạy vô hạn khi cha–con thành vòng lặp', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(withAncestorDepartments(cyclic, ['a']).sort()).toEqual(['a', 'b']);
  });
});
