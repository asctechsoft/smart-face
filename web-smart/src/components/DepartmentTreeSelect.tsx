import { useMemo } from 'react';
import { TreeSelect } from 'antd';
import { useDepartments, type Department } from '@/features/shared/org.api';

export interface DepartmentTreeNode {
  value: string;
  title: string;
  children: DepartmentTreeNode[];
  /** Nút chỉ để dựng hình cây, không được chọn — xem `limitTo`. */
  disabled?: boolean;
  selectable?: boolean;
}

/**
 * Dựng cây phòng ban từ danh sách phẳng.
 *
 * Hai chỗ dễ hỏng, và cả hai đều làm MẤT phòng ban khỏi giao diện chứ không báo
 * lỗi gì:
 *
 *   **Cha không có trong danh sách.** Phòng ban cha đã xoá, hoặc bị bộ lọc quyền
 *   cắt khỏi danh sách MANAGER nhận được. Con của nó phải nổi lên làm gốc, nếu
 *   không nó biến mất khỏi cây và người dùng không chọn được.
 *
 *   **Vòng lặp cha–con.** Dữ liệu sai (A là cha của B, B là cha của A) sẽ làm
 *   hàm dựng cây đệ quy chạy vô hạn và treo tab trình duyệt. Duyệt theo bản đồ
 *   phẳng rồi mới nối, nên vòng lặp chỉ khiến nhánh đó không xuất hiện ở gốc —
 *   không treo.
 *
 * @param selectableIds bỏ trống = chọn được tất cả. Có giá trị thì những nút
 *   ngoài tập này chỉ còn nhiệm vụ dựng hình cây và bị khoá.
 */
export function buildDepartmentTree(
  departments: Department[],
  selectableIds?: Set<string>,
): DepartmentTreeNode[] {
  const nodes = new Map<string, DepartmentTreeNode>(
    departments.map((d) => [
      d.id,
      {
        value: d.id,
        title: d.name,
        children: [],
        ...(selectableIds && !selectableIds.has(d.id)
          ? { disabled: true, selectable: false }
          : null),
      },
    ]),
  );

  const roots: DepartmentTreeNode[] = [];
  for (const department of departments) {
    const node = nodes.get(department.id);
    if (!node) continue;

    const parent = department.parentId ? nodes.get(department.parentId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Nhánh nằm trong vòng lặp không bao giờ tới được gốc. Nhặt lại chúng để người
  // dùng vẫn chọn được, thay vì im lặng đánh rơi.
  const reachable = new Set<string>();
  const walk = (list: DepartmentTreeNode[]) => {
    for (const node of list) {
      if (reachable.has(node.value)) continue;
      reachable.add(node.value);
      walk(node.children);
    }
  };
  walk(roots);
  for (const [id, node] of nodes) {
    if (!reachable.has(id)) roots.push(node);
  }

  return roots;
}

/**
 * Các phòng ban đã chọn CỘNG toàn bộ cấp dưới của chúng.
 *
 * Nhân viên gắn ở LÁ của cây, nút cha thường không có ai đứng trực tiếp. Vì vậy
 * mọi chỗ hiểu "phòng ban đã chọn" theo nghĩa khớp đúng id đều biến việc chọn
 * cấp CAO NHẤT thành phạm vi HẸP NHẤT — không lỗi, chỉ là danh sách rỗng.
 *
 * ⚠ Backend có bản sao của hàm này (`withDescendantDepartments`) và là chốt
 * cuối. Bản trên Web tồn tại để giao diện đếm đúng số người TRƯỚC khi bấm Lưu.
 */
export function withDescendantDepartments(
  departments: Department[],
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

/** Các phòng ban đã chọn cộng toàn bộ cấp TRÊN của chúng. */
export function withAncestorDepartments(
  departments: Department[],
  selectedIds: string[],
): string[] {
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

/**
 * Tập phòng ban thực sự nằm dưới các id đã chọn — dùng để lọc/đếm nhân viên.
 *
 * Trả về `null` khi không chọn gì, nghĩa là "không giới hạn". Mảng rỗng và
 * "không lọc" là hai ý khác hẳn nhau, gộp lại thì bộ lọc rỗng biến thành bộ lọc
 * khớp tất cả.
 */
export function useDepartmentDescendants(selectedIds: string[] | undefined): Set<string> | null {
  const departments = useDepartments();

  // Khoá theo NỘI DUNG chứ không theo tham chiếu mảng: nơi gọi thường dựng
  // `[departmentId]` ngay trong thân component, nên mảng đổi tham chiếu mỗi lần
  // render và `useMemo` sẽ không bao giờ giữ được kết quả nào.
  const key = selectedIds?.length ? [...selectedIds].sort().join(',') : '';

  return useMemo(() => {
    if (!key) return null;
    return new Set(withDescendantDepartments(departments.data ?? [], key.split(',')));
  }, [departments.data, key]);
}

/**
 * Tập phòng ban đã chọn cộng cấp TRÊN — dùng khi đối chiếu với một khai báo
 * "áp dụng cho phòng ban nào" ở cấp cao hơn.
 *
 * Ca khai cho cả công ty vẫn phải hiện ra khi người dùng chỉ chọn một tổ, nếu
 * không thì đúng những ca dùng chung lại là những ca không chọn được.
 */
export function useDepartmentAncestors(selectedIds: string[] | undefined): Set<string> | null {
  const departments = useDepartments();
  const key = selectedIds?.length ? [...selectedIds].sort().join(',') : '';

  return useMemo(() => {
    if (!key) return null;
    return new Set(withAncestorDepartments(departments.data ?? [], key.split(',')));
  }, [departments.data, key]);
}

interface BaseProps {
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /**
   * Giới hạn phần chọn được vào đúng những phòng ban này VÀ cấp dưới của chúng.
   *
   * Tổ tiên của chúng vẫn hiện nhưng bị khoá: bỏ hẳn cha đi thì con mất chỗ đứng
   * trong cây và bị đẩy lên làm gốc, đọc như một phòng ban độc lập; còn để chọn
   * được thì người dùng lọc ra một phạm vi rộng hơn phạm vi của bảng.
   */
  limitTo?: string[];
}

/**
 * Combo chọn phòng ban dạng CÂY — dùng chung cho mọi màn.
 *
 * Danh sách phẳng đọc được khi công ty có sáu phòng ban; tới ba cấp thì "Tổ 1"
 * và "Tổ 2" nằm cạnh nhau mà không cho biết chúng thuộc khối nào, và người dùng
 * phải nhớ cây trong đầu để chọn đúng.
 *
 * `treeNodeFilterProp="title"` để gõ tìm theo tên; mặc định của antd là tìm
 * theo `value`, tức là tìm theo id — không ai gõ được id phòng ban.
 */
export function DepartmentTreeSelect({
  value,
  onChange,
  allowClear = true,
  emptyLabel,
  ...base
}: BaseProps & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  allowClear?: boolean;
  /** Có nhãn này thì thêm một mục "tất cả" ở đầu cây (dùng cho bộ lọc). */
  emptyLabel?: string;
}) {
  const { treeData, loading } = useDepartmentTree(base.limitTo);

  return (
    <TreeSelect
      id={base.id}
      style={{ width: '100%', ...base.style }}
      disabled={base.disabled}
      loading={loading}
      allowClear={allowClear}
      showSearch
      treeNodeFilterProp="title"
      treeDefaultExpandAll
      placeholder={base.placeholder ?? 'Chọn phòng ban'}
      value={value ?? undefined}
      onChange={(next: string | undefined) => onChange(next || undefined)}
      treeData={
        emptyLabel ? [{ value: '', title: emptyLabel, children: [] }, ...treeData] : treeData
      }
    />
  );
}

/**
 * Bản chọn NHIỀU phòng ban. Tách hàm riêng vì kiểu của `value` khác hẳn.
 *
 * Chọn theo CỤM: tích một khối là tích luôn mọi phòng bên dưới nó, và khối chỉ
 * hiện là đã tích khi mọi phòng con đều được tích. Đây là cách người dùng đọc
 * một cây tổ chức — "áp dụng cho khối Kỹ thuật" luôn bao hàm các tổ trong khối,
 * không ai hiểu nó là "chỉ đúng cái nhãn Kỹ thuật".
 *
 * `SHOW_ALL` để `value` chứa CẢ cha lẫn con: bên nhận (Backend, bộ lọc màn chi
 * tiết) nhờ đó không phải tự suy ra cây mới biết bảng phủ tới đâu.
 */
export function DepartmentTreeMultiSelect({
  value,
  onChange,
  ...base
}: BaseProps & {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { treeData, loading } = useDepartmentTree(base.limitTo);

  return (
    <TreeSelect
      id={base.id}
      style={{ width: '100%', ...base.style }}
      disabled={base.disabled}
      loading={loading}
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_ALL}
      allowClear
      showSearch
      treeNodeFilterProp="title"
      treeDefaultExpandAll
      placeholder={base.placeholder ?? 'Chọn phòng ban'}
      value={value}
      onChange={(next: string[]) => onChange(next ?? [])}
      treeData={treeData}
      maxTagCount="responsive"
    />
  );
}

function useDepartmentTree(limitTo?: string[]) {
  const departments = useDepartments();

  const treeData = useMemo(() => {
    const all = departments.data ?? [];
    if (!limitTo?.length) return buildDepartmentTree(all);

    // Chọn được: các phòng ban đã chốt và cấp dưới của chúng.
    // Hiện nhưng khoá: tổ tiên, chỉ để cây giữ đúng hình.
    const selectable = new Set(withDescendantDepartments(all, limitTo));
    const visible = new Set(withAncestorDepartments(all, [...selectable]));

    return buildDepartmentTree(
      all.filter((d) => visible.has(d.id)),
      selectable,
    );
  }, [departments.data, limitTo]);

  return { treeData, loading: departments.isLoading };
}
