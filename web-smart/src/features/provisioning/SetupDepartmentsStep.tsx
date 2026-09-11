import { useState } from 'react';
import { useUpsertDepartment } from '@/features/policy/policy.api';
import { useBranches, useDepartments, type Department } from '@/features/shared/org.api';
import { useEmployeeList } from '@/features/employees/employees.api';
import { useAuth } from '@/lib/auth/auth-context';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import {
  Button,
  CardSkeleton,
  ErrorState,
  Field,
  Icon,
  Select,
  TextInput,
  useToast,
} from '@/components/ui';

/**
 * Bước 2 của wizard — sơ đồ tổ chức bên trái, biểu mẫu tạo phòng ban bên phải
 * (mockup Figma `67:77`).
 *
 * ## Vì sao không dùng lại `DepartmentsTab`
 *
 * Bản trước nhúng thẳng màn cấu hình chính thức vào đây. Nó đúng về nguyên tắc
 * "không chép lại form", nhưng sai về việc người dùng đang làm: ở bước này công
 * ty có KHÔNG phòng ban nào, và một cái bảng trống chín cột với nút "Thêm phòng
 * ban" mở ra hộp thoại không trả lời được câu hỏi duy nhất họ đang có — "cơ cấu
 * công ty tôi trông sẽ như thế nào". Sơ đồ dựng dần theo từng lần lưu trả lời
 * đúng câu đó.
 *
 * Đổi lại có hai chỗ nhập cùng ghi vào một bảng. Chấp nhận được vì cả hai gọi
 * chung `useUpsertDepartment`, và biểu mẫu ở đây CỐ TÌNH hẹp hơn: nó chỉ tạo
 * mới, không sửa, không xoá. Sửa và xoá vẫn chỉ có đúng một nơi.
 */
export function SetupDepartmentsStep() {
  const departments = useDepartments();
  const branches = useBranches();
  const { company } = useAuth();

  if (departments.isPending) return <CardSkeleton height={420} />;
  if (departments.isError) {
    return (
      <ErrorState
        title="Chưa đọc được danh mục phòng ban"
        description="Không tải được sơ đồ tổ chức từ máy chủ. Thử lại sau ít phút."
        onRetry={() => void departments.refetch()}
      />
    );
  }

  const rows = departments.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="sf-wizard-split">
        <section className="sf-card sf-panel" style={{ padding: 0 }}>
          <header className="sf-panel__head">
            <h2 className="sf-title-md">Sơ đồ tổ chức</h2>
            <span className="sf-body-sm sf-text-variant">
              {rows.length > 0 ? `${rows.length} phòng ban` : 'Chưa có phòng ban'}
            </span>
          </header>

          <div style={{ padding: 16 }}>
            <OrgChart
              companyName={company?.name ?? 'Công ty'}
              departments={rows}
              branchName={(id) => branches.data?.find((branch) => branch.id === id)?.name ?? null}
            />
          </div>
        </section>

        <DepartmentForm departments={rows} />
      </div>

      <SuggestionRow existing={rows} />
    </div>
  );
}

// ===========================================================================
//  Sơ đồ tổ chức
// ===========================================================================

/**
 * Cây phòng ban.
 *
 * Phòng ban có `parentId` trỏ tới phòng ban khác, nên dữ liệu phẳng từ API phải
 * được dựng lại thành cây. Một phòng ban có `parentId` trỏ tới id KHÔNG nằm
 * trong danh sách (cha đã bị xoá mềm) được coi là gốc — bỏ rơi nó thì nó biến
 * mất khỏi sơ đồ mà không ai biết vì sao.
 */
function OrgChart({
  companyName,
  departments,
  branchName,
}: {
  companyName: string;
  departments: Department[];
  branchName: (id: string | null) => string | null;
}) {
  const ids = new Set(departments.map((row) => row.id));
  const childrenOf = new Map<string | null, Department[]>();

  for (const row of departments) {
    const parent = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), row]);
  }

  const roots = childrenOf.get(null) ?? [];

  const renderNodes = (nodes: Department[]) => (
    <ul>
      {nodes.map((node) => {
        const children = childrenOf.get(node.id) ?? [];
        const place = branchName(node.branchId);

        return (
          <li key={node.id}>
            <div className="sf-orgnode">
              <span className="sf-orgnode__name">{node.name}</span>
              <span className="sf-orgnode__meta">
                {node.managerId ? 'Đã có trưởng phòng' : 'Chưa có trưởng phòng'}
                {place ? ` · ${place}` : ''}
              </span>
            </div>
            {children.length > 0 ? renderNodes(children) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="sf-orgchart">
      <ul className="sf-orgtree">
        <li>
          <div className="sf-orgnode sf-orgnode--root">
            <span className="sf-orgnode__name">{companyName}</span>
            <span className="sf-orgnode__meta">
              {departments.length > 0
                ? `${departments.length} phòng ban trực thuộc`
                : 'Chưa có phòng ban nào'}
            </span>
          </div>

          {roots.length > 0 ? (
            renderNodes(roots)
          ) : (
            <ul>
              <li>
                <div
                  className="sf-orgnode"
                  style={{
                    borderStyle: 'dashed',
                    color: 'var(--sf-on-surface-muted)',
                    textAlign: 'center',
                  }}
                >
                  <Icon name="add" size={20} style={{ margin: '0 auto' }} />
                  <span className="sf-orgnode__meta">
                    Tạo phòng ban đầu tiên ở biểu mẫu bên cạnh
                  </span>
                </div>
              </li>
            </ul>
          )}
        </li>
      </ul>
    </div>
  );
}

// ===========================================================================
//  Biểu mẫu tạo phòng ban
// ===========================================================================

const EMPTY_FORM = { name: '', parentId: '', managerId: '', branchId: '' };

function DepartmentForm({ departments }: { departments: Department[] }) {
  const toast = useToast();
  const showError = useErrorToast();

  const branches = useBranches();
  const upsert = useUpsertDepartment();

  /*
   * Danh sách trưởng phòng để chọn.
   *
   * Ở bước này công ty thường mới có đúng một người — chính giám đốc đang thao
   * tác. Vẫn hiện ô chọn thay vì ẩn đi: nó cho biết trường này TỒN TẠI và sẽ
   * phải điền, còn ẩn đi thì người dùng chỉ phát hiện ra khi luồng duyệt đơn
   * của phòng đó đứng lại vài tuần sau.
   */
  const employees = useEmployeeList({ page: 1, pageSize: 100, status: 'ACTIVE' });

  const [form, setForm] = useState(EMPTY_FORM);

  const patch = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const isFirst = departments.length === 0;

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    try {
      await upsert.mutateAsync({
        name: form.name.trim(),
        parentId: form.parentId || null,
        managerId: form.managerId || null,
        branchId: form.branchId || null,
      });
      toast.success(`Đã tạo phòng ban "${form.name.trim()}"`);
      // Xoá form thay vì giữ nguyên: nút này tạo phòng ban KẾ TIẾP, và để lại
      // tên cũ trong ô là mời người dùng lưu nhầm hai phòng ban trùng tên.
      setForm(EMPTY_FORM);
    } catch (error) {
      showError(error);
    }
  };

  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">
          {isFirst ? 'Tạo phòng ban đầu tiên' : 'Tạo thêm phòng ban'}
        </h2>
      </header>

      <form style={{ padding: 20, display: 'grid', gap: 16 }} onSubmit={submit}>
        <Field label="Tên phòng ban" required>
          {(field) => (
            <TextInput
              {...field}
              value={form.name}
              onChange={patch('name')}
              placeholder="Phòng Kế toán"
              required
            />
          )}
        </Field>

        <Field
          label="Phòng ban cấp trên"
          hint="Bỏ trống nếu đây là phòng ban trực thuộc công ty."
        >
          {(field) => (
            <Select
              {...field}
              placeholder="Trực thuộc công ty"
              value={form.parentId}
              onChange={patch('parentId')}
              options={departments.map((row) => ({ value: row.id, label: row.name }))}
            />
          )}
        </Field>

        <Field
          label="Trưởng phòng"
          hint="Trưởng phòng là mắt xích đầu của luồng duyệt đơn. Để trống thì đơn của phòng này chưa đi được."
        >
          {(field) => (
            <Select
              {...field}
              placeholder="Chọn sau"
              value={form.managerId}
              onChange={patch('managerId')}
              options={(employees.data?.items ?? []).map((row) => ({
                value: row.id,
                label: `${row.fullName} · ${row.employeeCode}`,
              }))}
            />
          )}
        </Field>

        <Field label="Địa điểm làm việc">
          {(field) => (
            <Select
              {...field}
              placeholder="Chưa gán địa điểm"
              value={form.branchId}
              onChange={patch('branchId')}
              options={(branches.data ?? []).map((branch) => ({
                value: branch.id,
                label: branch.name,
              }))}
            />
          )}
        </Field>

        {/*
          Bản vẽ còn hai ô nữa: MÃ PHÒNG BAN và LOẠI ĐƠN VỊ. Bảng `Department`
          chỉ có `name`, `parentId`, `managerId`, `branchId` — không có cột nào
          để cất hai giá trị đó. Nói ra thay vì vẽ hai ô rồi vứt đi thứ người
          dùng vừa gõ.
        */}
        <p className="sf-body-sm sf-text-muted" style={{ margin: 0 }}>
          Mã phòng ban và loại đơn vị chưa có chỗ lưu trong cơ sở dữ liệu nên chưa khai ở bản này.
        </p>

        <div style={{ display: 'flex', gap: 12 }}>
          <Button
            type="submit"
            variant="primary"
            icon="add"
            loading={upsert.isPending}
            disabled={!form.name.trim()}
          >
            {isFirst ? 'Tạo phòng ban & tiếp tục' : 'Tạo phòng ban'}
          </Button>
        </div>
      </form>
    </section>
  );
}

// ===========================================================================
//  Gợi ý cơ cấu ban đầu
// ===========================================================================

const SUGGESTIONS = [
  { name: 'Kinh doanh', icon: 'trending_up' },
  { name: 'Kế toán', icon: 'account_balance' },
  { name: 'Nhân sự', icon: 'group' },
  { name: 'Vận hành', icon: 'settings' },
];

/**
 * Bốn phòng ban hay gặp nhất, bấm là tạo luôn.
 *
 * Không phải để tiết kiệm mấy giây gõ chữ: người lập công ty lần đầu thường
 * không biết nên chia phòng ban tới mức nào, và bốn cái tên này là một điểm
 * khởi đầu hợp lý mà họ đổi được sau. Nút đã tạo rồi thì tắt đi — bấm hai lần
 * ra hai phòng ban trùng tên là lỗi người dùng không tự thấy được.
 */
function SuggestionRow({ existing }: { existing: Department[] }) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertDepartment();
  const [pending, setPending] = useState<string | null>(null);

  const taken = new Set(existing.map((row) => row.name.trim().toLowerCase()));

  const create = async (name: string) => {
    setPending(name);
    try {
      await upsert.mutateAsync({ name, parentId: null, managerId: null, branchId: null });
      toast.success(`Đã tạo phòng ban "${name}"`);
    } catch (error) {
      showError(error);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="sf-card" style={{ padding: 20 }}>
      <h2 className="sf-title-sm" style={{ margin: '0 0 12px' }}>
        Gợi ý cơ cấu ban đầu
      </h2>

      <div className="sf-suggest-chips">
        {SUGGESTIONS.map((suggestion) => {
          const already = taken.has(suggestion.name.toLowerCase());

          return (
            <button
              key={suggestion.name}
              type="button"
              className="sf-suggest-chip"
              disabled={already || pending !== null}
              onClick={() => void create(suggestion.name)}
            >
              <Icon name={already ? 'check' : suggestion.icon} size={20} />
              {suggestion.name}
              {already ? ' · đã tạo' : ''}
            </button>
          );
        })}
      </div>
    </section>
  );
}
