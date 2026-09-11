import { useState } from 'react';
import { Switch } from 'antd';
import { Link } from 'react-router-dom';
import { useCreateEmployee, useEmployeeList, type Employee } from '@/features/employees/employees.api';
import { useDepartments } from '@/features/shared/org.api';
import { ROLE_LABEL, SystemRole } from '@/config/constants';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import {
  Badge,
  Button,
  CardSkeleton,
  Field,
  Icon,
  Select,
  TextInput,
  useToast,
} from '@/components/ui';

/**
 * Bước 4 của wizard — tạo tài khoản Kế toán/HR (mockup Figma `67:76`).
 *
 * ## Vì sao đây là một biểu mẫu thật, không phải hướng dẫn
 *
 * Bản trước chỉ có ba dòng hướng dẫn và hai nút dẫn sang màn Nhân sự rồi màn
 * Phân quyền. Nó đúng về mặt kỹ thuật — Kế toán/HR *là* một nhân viên được gán
 * vai trò — nhưng bắt người dùng rời wizard, làm hai việc ở hai màn khác nhau,
 * rồi tự tìm đường quay lại. Người ta không quay lại.
 *
 * `POST /admin/employees` nhận sẵn `roles` và `sendInvite` trong CÙNG một lời
 * gọi, nên hai việc đó gộp được thành một nút mà không cần Backend đổi gì.
 *
 * ## Vẫn giữ nguyên mô hình dữ liệu
 *
 * Không có "tài khoản Kế toán/HR" như một loại riêng: hồ sơ tạo ra ở đây là một
 * `Employee` bình thường có thêm vai trò `HR_PAYROLL`. Nhờ vậy họ có hồ sơ, có
 * chấm công, và gỡ vai trò không xoá mất dữ liệu của họ.
 */
export function SetupAccountantStep() {
  /*
   * Đọc 100 hồ sơ đầu rồi lọc ở phía Web thay vì lọc theo vai trò ở API:
   * `EmployeeQuery` không có tham số `role`, và ở bước này công ty vừa mới lập
   * nên danh sách còn rất ngắn. Khi nào công ty lớn lên thì màn này đã không
   * còn được mở nữa — wizard chỉ chạy một lần.
   */
  const employees = useEmployeeList({ page: 1, pageSize: 100 });
  const existing = (employees.data?.items ?? []).filter((row) =>
    row.roles?.includes(SystemRole.HR_PAYROLL),
  );

  if (employees.isPending) return <CardSkeleton height={420} />;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {existing.length > 0 ? <ExistingAccounts accounts={existing} /> : null}
      <AccountantForm hasExisting={existing.length > 0} />
    </div>
  );
}

/** Người đã có vai trò Kế toán/HR — tạo thêm là hợp lệ, nhưng phải biết là đang tạo THÊM. */
function ExistingAccounts({ accounts }: { accounts: Employee[] }) {
  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">Đã có tài khoản Kế toán/HR</h2>
        <Badge tone="success">{accounts.length} người</Badge>
      </header>

      <ul className="sf-mini-list">
        {accounts.map((account) => (
          <li key={account.id}>
            <Icon name="support_agent" size={20} color="var(--sf-on-surface-muted)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sf-body-md" style={{ fontWeight: 600 }}>
                {account.fullName}
              </div>
              <div className="sf-body-sm sf-text-variant">
                {account.employeeCode} · {account.phone}
                {account.email ? ` · ${account.email}` : ''}
              </div>
            </div>
            <Link to={`/employees/${account.id}`} className="sf-back-link">
              Xem hồ sơ
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  departmentId: '',
};

function AccountantForm({ hasExisting }: { hasExisting: boolean }) {
  const toast = useToast();
  const showError = useErrorToast();

  const departments = useDepartments();
  const create = useCreateEmployee();

  const [form, setForm] = useState(EMPTY_FORM);
  const [sendInvite, setSendInvite] = useState(true);

  const patch = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    try {
      const created = await create.mutateAsync({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        departmentId: form.departmentId || undefined,
        roles: [SystemRole.HR_PAYROLL],
        sendInvite,
      });

      toast.success(
        `Đã tạo tài khoản Kế toán/HR · ${created.employeeCode}`,
        sendInvite
          ? 'Lời mời đã gửi qua SMS. Họ đổi mật khẩu ở lần đăng nhập đầu.'
          : 'Chưa gửi lời mời — gửi lại từ hồ sơ nhân viên khi cần.',
      );
      setForm(EMPTY_FORM);
    } catch (error) {
      showError(error);
    }
  };

  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">
          {hasExisting ? 'Thêm một người phụ trách nữa' : 'Thông tin người dùng'}
        </h2>
      </header>

      <form style={{ padding: 20 }} onSubmit={submit}>
        <div className="sf-form-grid">
          <Field label="Họ và tên" required>
            {(field) => (
              <TextInput
                {...field}
                value={form.fullName}
                onChange={patch('fullName')}
                placeholder="Nguyễn Thị Mai"
                required
              />
            )}
          </Field>

          <Field
            label="Số điện thoại"
            hint="Lời mời gửi qua SMS tới số này, và đây cũng là tên đăng nhập."
            required
          >
            {(field) => (
              <TextInput
                {...field}
                type="tel"
                value={form.phone}
                onChange={patch('phone')}
                placeholder="0986 222 333"
                required
              />
            )}
          </Field>

          <Field label="Email" hint="Dùng để nhận bảng công và thông báo. Không bắt buộc.">
            {(field) => (
              <TextInput {...field} type="email" value={form.email} onChange={patch('email')} />
            )}
          </Field>

          <Field label="Phòng ban" hint="Hồ sơ của họ thuộc phòng ban này. Chọn sau cũng được.">
            {(field) => (
              <Select
                {...field}
                placeholder="Chưa gán phòng ban"
                value={form.departmentId}
                onChange={patch('departmentId')}
                options={(departments.data ?? []).map((row) => ({
                  value: row.id,
                  label: row.name,
                }))}
              />
            )}
          </Field>

          <Field label="Vai trò" hint="Bước này chỉ tạo Kế toán/HR. Vai trò khác gán ở màn Phân quyền.">
            {(field) => (
              <TextInput {...field} value={ROLE_LABEL.HR_PAYROLL} disabled readOnly />
            )}
          </Field>

          <Field
            label="Phạm vi dữ liệu"
            hint="Kế toán/HR luôn có phạm vi toàn công ty. Phạm vi theo phòng ban là của vai trò Quản lý."
          >
            {(field) => <TextInput {...field} value="Toàn công ty" disabled readOnly />}
          </Field>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            padding: 12,
            marginTop: 16,
            background: 'var(--sf-neutral-100)',
            borderRadius: 12,
          }}
        >
          <div>
            <div className="sf-body-md" style={{ fontWeight: 600 }}>
              Gửi lời mời kích hoạt ngay
            </div>
            {/*
              Bản vẽ ghi "Kích hoạt tài khoản ngay". Nhãn ở đây nói đúng thứ nút
              này làm: hồ sơ mới LUÔN ở trạng thái "Chờ kích hoạt", và chính
              người được mời kích hoạt nó bằng lần đăng nhập đầu. Không ai kích
              hoạt hộ được — đó là điểm của việc bắt đổi mật khẩu lần đầu.
            */}
            <div className="sf-body-sm sf-text-variant">
              Hồ sơ tạo ra ở trạng thái “Chờ kích hoạt”. Tắt nếu bạn muốn gửi lời mời sau.
            </div>
          </div>
          <Switch checked={sendInvite} onChange={setSendInvite} />
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <Button
            type="submit"
            variant="primary"
            icon="person_add"
            loading={create.isPending}
            disabled={!form.fullName.trim() || !form.phone.trim()}
          >
            {sendInvite ? 'Tạo tài khoản & gửi lời mời' : 'Tạo tài khoản'}
          </Button>
        </div>
      </form>
    </section>
  );
}
