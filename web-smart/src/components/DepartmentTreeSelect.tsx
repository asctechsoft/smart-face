import { useMemo } from 'react';
import { TreeSelect } from 'antd';
import { useDepartments, type Department } from '@/features/shared/org.api';

export interface DepartmentTreeNode {
  value: string;
  title: string;
  children: DepartmentTreeNode[];
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
 */
export function buildDepartmentTree(departments: Department[]): DepartmentTreeNode[] {
  const nodes = new Map<string, DepartmentTreeNode>(
    departments.map((d) => [d.id, { value: d.id, title: d.name, children: [] }]),
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

interface BaseProps {
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Giới hạn cây vào đúng những phòng ban này (và tổ tiên của chúng, để còn thấy nhánh). */
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

/** Bản chọn NHIỀU phòng ban. Tách hàm riêng vì kiểu của `value` khác hẳn. */
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
      multiple
      allowClear
      showSearch
      treeNodeFilterProp="title"
      treeDefaultExpandAll
      // Chọn cha KHÔNG tự chọn hết con: "áp dụng cho khối Kỹ thuật" và "áp dụng
      // cho từng tổ trong khối" là hai ý định khác nhau, và gộp lại thì người
      // dùng không diễn đạt được ý thứ nhất.
      treeCheckable={false}
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
    if (!limitTo) return buildDepartmentTree(all);

    // Giữ lại cả tổ tiên của các phòng ban được phép: bỏ cha đi thì con mất chỗ
    // đứng trong cây và bị đẩy lên làm gốc, đọc như một phòng ban độc lập.
    const keep = new Set(limitTo);
    const byId = new Map(all.map((d) => [d.id, d]));
    for (const id of limitTo) {
      let current = byId.get(id)?.parentId ?? null;
      while (current && !keep.has(current)) {
        keep.add(current);
        current = byId.get(current)?.parentId ?? null;
      }
    }

    return buildDepartmentTree(all.filter((d) => keep.has(d.id)));
  }, [departments.data, limitTo]);

  return { treeData, loading: departments.isLoading };
}
