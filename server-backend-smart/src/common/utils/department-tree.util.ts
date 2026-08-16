/** Phần cây phòng ban cần cho việc duyệt — chỉ id và cha, không quan tâm gì thêm. */
export interface DepartmentNode {
  id: string;
  parentId: string | null;
}

/**
 * Các phòng ban đã chọn CỘNG toàn bộ cấp dưới của chúng.
 *
 * Nhân viên gắn ở LÁ của cây, còn nút cha thường không có ai đứng trực tiếp:
 * trong dữ liệu thật, "Công ty AMOBI" có 0 nhân viên, cả bốn người nằm ở Kế
 * toán / Nhân sự / Kỹ thuật. Vì vậy lọc bằng `departmentId = <id đã chọn>` làm
 * cho việc chọn cấp CAO NHẤT lại thành phạm vi HẸP NHẤT — và nó không báo lỗi
 * gì, chỉ trả về danh sách rỗng.
 *
 * Duyệt trên danh sách phẳng đã đọc sẵn thay vì truy vấn đệ quy xuống database:
 * một công ty có vài chục phòng ban, còn đệ quy thì mỗi cấp một lượt đi về.
 *
 * `seen` vừa khử trùng lặp vừa chặn vòng lặp cha–con do dữ liệu sai (A là cha
 * của B, B là cha của A) — thiếu nó thì vòng `while` chạy vô hạn và treo request.
 */
export function withDescendantDepartments(
  departments: DepartmentNode[],
  selectedIds: string[],
): string[] {
  if (selectedIds.length === 0) return [];

  const childrenOf = new Map<string, string[]>();
  for (const department of departments) {
    if (!department.parentId) continue;
    const siblings = childrenOf.get(department.parentId) ?? [];
    siblings.push(department.id);
    childrenOf.set(department.parentId, siblings);
  }

  const seen = new Set<string>();
  const queue = [...selectedIds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return [...seen];
}

/**
 * Các phòng ban đã chọn CỘNG toàn bộ cấp trên của chúng.
 *
 * Dùng khi đối chiếu với một khai báo phạm vi ở cấp cao hơn: một bảng phân ca
 * lập cho cả công ty vẫn là bảng chứa người của tổ Kế toán, nên lọc theo Kế toán
 * phải tìm thấy nó. Chỉ đi xuống thì người dùng phải đoán đúng cấp đã dùng lúc
 * lập bảng mới tìm ra thứ mình cần.
 *
 * `seen` cũng là chốt chặn vòng lặp cha–con như ở hàm đi xuống.
 */
export function withAncestorDepartments(
  departments: DepartmentNode[],
  selectedIds: string[],
): string[] {
  if (selectedIds.length === 0) return [];

  const byId = new Map(departments.map((d) => [d.id, d]));
  const seen = new Set<string>();

  for (const id of selectedIds) {
    let current: string | null | undefined = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return [...seen];
}
