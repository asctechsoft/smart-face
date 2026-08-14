import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Dropdown, Input, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatusBadge, employeeStatusTone } from '@/components/StatusBadge';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { EMPLOYEE_STATUS_LABEL, ROLE_LABEL, DEFAULT_PAGE_SIZE } from '@/config/constants';
import { formatDay } from '@/lib/utils/date';
import { useAuth } from '@/lib/auth/auth-context';
import { useDepartments, useBranches, toSelectOptions } from '@/features/shared/org.api';
import {
  useEmployeeList,
  useReactivateEmployee,
  useResendInvite,
  useSuspendEmployee,
  useTerminateEmployee,
  type Employee,
  type EmployeeQuery,
} from './employees.api';
import { EmployeeFormDrawer } from './EmployeeFormDrawer';
import { ImportEmployeesModal } from './ImportEmployeesModal';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

type LifecycleAction = 'suspend' | 'reactivate' | 'terminate';

/**
 * Quản lý nhân sự — docs/04 mục 8 (`FR-WEB-HR-01..12`).
 *
 * Vòng đời nhân viên (mục 8.3) quyết định thao tác nào hiện ra:
 *   PENDING_ACTIVATION → gửi lại lời mời, sửa, XOÁ được
 *   ACTIVE             → tạm ngưng, chấm dứt (KHÔNG xoá được)
 *   SUSPENDED          → kích hoạt lại, chấm dứt
 *   TERMINATED         → không quay lại được
 *
 * Ẩn nút "Xoá" ở trạng thái ACTIVE không phải để làm đẹp: xoá hồ sơ đang hoạt
 * động sẽ mất luôn liên kết tới các bản ghi chấm công đã ghi.
 */
export function EmployeeListPage() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canEdit = useCan('employee.edit');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [formTarget, setFormTarget] = useState<{
    mode: 'create' | 'edit';
    employee?: Employee;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<{
    action: LifecycleAction;
    employee: Employee;
  } | null>(null);

  const suspend = useSuspendEmployee();
  const reactivate = useReactivateEmployee();
  const terminate = useTerminateEmployee();
  const resendInvite = useResendInvite();

  const departments = useDepartments();
  const branches = useBranches();

  const query: EmployeeQuery = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
      status: searchParams.get('status') ?? undefined,
      departmentId: searchParams.get('departmentId') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
    }),
    [searchParams],
  );

  const list = useEmployeeList(query);

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const columns: ColumnsType<Employee> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      fixed: 'left',
      width: 260,
      render: (_, row) => (
        // Tên là đường vào hồ sơ chi tiết. Đặt ở đây thay vì một nút "Xem" riêng
        // vì bấm vào tên là phản xạ mặc định của người dùng trên mọi bảng danh sách.
        <Link to={`/employees/${row.id}`} style={{ color: 'inherit' }}>
          <EmployeeCell
            employee={{ id: row.id, fullName: row.fullName, employeeCode: row.employeeCode }}
          />
        </Link>
      ),
    },
    { title: 'Số điện thoại', dataIndex: 'phone', key: 'phone', width: 140 },
    {
      title: 'Phòng ban',
      key: 'department',
      width: 160,
      render: (_, row) => row.department?.name ?? <span className="sf-text-muted">Chưa phân</span>,
    },
    {
      title: 'Chức vụ',
      dataIndex: 'position',
      key: 'position',
      width: 140,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'Vai trò',
      key: 'roles',
      width: 180,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.roles.map((role) => (
            <StatusBadge key={role} tone={role === 'EMPLOYEE' ? 'neutral' : 'teal'} soft>
              {ROLE_LABEL[role] ?? role}
            </StatusBadge>
          ))}
        </div>
      ),
    },
    {
      title: 'Ngày vào',
      dataIndex: 'joinedAt',
      key: 'joinedAt',
      width: 120,
      render: (value: string | null) => formatDay(value, timezone),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (value: string) => (
        <StatusBadge tone={employeeStatusTone(value)}>
          {EMPLOYEE_STATUS_LABEL[value] ?? value}
        </StatusBadge>
      ),
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_, row) => {
        // "Xem hồ sơ" luôn có, kể cả với Quản lý chỉ được đọc. Các mục còn lại
        // đều là thao tác GHI nên chỉ hiện khi có `employee.edit`.
        const items = [
          { key: 'detail', label: 'Xem hồ sơ', icon: <Icon name="badge" size={18} /> },
          ...(!canEdit
            ? []
            : [
                { key: 'edit', label: 'Sửa hồ sơ', icon: <Icon name="edit" size={18} /> },
                ...(row.status === 'PENDING_ACTIVATION'
                  ? [
                      {
                        key: 'resend',
                        label: 'Gửi lại lời mời',
                        icon: <Icon name="sms" size={18} />,
                      },
                    ]
                  : []),
                ...(row.status === 'ACTIVE'
                  ? [
                      {
                        key: 'suspend',
                        label: 'Tạm ngưng',
                        icon: <Icon name="pause_circle" size={18} />,
                      },
                    ]
                  : []),
                ...(row.status === 'SUSPENDED'
                  ? [
                      {
                        key: 'reactivate',
                        label: 'Kích hoạt lại',
                        icon: <Icon name="play_circle" size={18} />,
                      },
                    ]
                  : []),
                ...(row.status === 'ACTIVE' || row.status === 'SUSPENDED'
                  ? [
                      { type: 'divider' as const },
                      {
                        key: 'terminate',
                        label: 'Chấm dứt hợp đồng',
                        icon: <Icon name="person_remove" size={18} />,
                        danger: true,
                      },
                    ]
                  : []),
              ]),
        ];

        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items,
              onClick: async ({ key }) => {
                if (key === 'detail') navigate(`/employees/${row.id}`);
                if (key === 'edit') setFormTarget({ mode: 'edit', employee: row });
                if (key === 'resend') {
                  try {
                    await resendInvite.mutateAsync(row.id);
                    toast.success(`Đã gửi lại tin nhắn mời tới ${row.phone}`);
                  } catch (caught) {
                    showError(caught);
                  }
                }
                if (key === 'suspend' || key === 'reactivate' || key === 'terminate') {
                  setLifecycle({ action: key, employee: row });
                }
              },
            }}
          >
            <Button size="small" aria-label={`Thao tác với ${row.fullName}`}>
              <Icon name="more_horiz" size={18} />
            </Button>
          </Dropdown>
        );
      },
    },
  ];

  const activeFilters = ['status', 'departmentId', 'branchId', 'q'].filter((key) =>
    searchParams.get(key),
  ).length;

  const lifecycleCopy = {
    suspend: {
      title: 'Tạm ngưng nhân viên',
      warning:
        'Nhân viên sẽ không đăng nhập và không chấm công được. Dữ liệu sinh trắc học được giữ nguyên nhưng vô hiệu hoá.',
      confirm: 'Tạm ngưng',
    },
    reactivate: {
      title: 'Kích hoạt lại nhân viên',
      warning: 'Nhân viên đăng nhập và chấm công lại được ngay sau thao tác này.',
      confirm: 'Kích hoạt lại',
    },
    terminate: {
      title: 'Chấm dứt hợp đồng',
      warning:
        'Thao tác KHÔNG quay lại được. Toàn bộ phiên đăng nhập bị thu hồi, liên kết thiết bị bị huỷ, dữ liệu sinh trắc học xử lý theo chính sách công ty. Bản ghi chấm công và bảng công đã chốt vẫn được giữ lại.',
      confirm: 'Chấm dứt hợp đồng',
    },
  }[lifecycle?.action ?? 'suspend'];

  return (
    <>
      <PageHeader
        title="Nhân viên"
        description="Hồ sơ nhân sự, phân quyền và vòng đời tài khoản. Nhân viên mới nhận tin nhắn mời và tự hoàn tất thiết lập trên ứng dụng."
        actions={
          <>
            <Can do="employee.import">
              <Button
                icon={<Icon name="upload_file" size={20} />}
                onClick={() => setImportOpen(true)}
              >
                Import Excel
              </Button>
            </Can>
            <Can do="employee.edit">
              <Button
                type="primary"
                icon={<Icon name="person_add" size={20} />}
                onClick={() => setFormTarget({ mode: 'create' })}
              >
                Thêm nhân viên
              </Button>
            </Can>
          </>
        }
      />

      <FilterBar activeCount={activeFilters} onClear={() => setSearchParams({}, { replace: true })}>
        <FilterField label="Trạng thái" htmlFor="e-status" width={180}>
          <Select
            id="e-status"
            value={query.status ?? ''}
            options={[
              { value: '', label: 'Tất cả' },
              ...Object.entries(EMPLOYEE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => patchQuery({ status: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="e-dept" width={200}>
          <Select
            id="e-dept"
            value={query.departmentId ?? ''}
            loading={departments.isLoading}
            options={toSelectOptions(departments.data, 'Tất cả phòng ban')}
            onChange={(value) => patchQuery({ departmentId: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Chi nhánh" htmlFor="e-branch" width={180}>
          <Select
            id="e-branch"
            value={query.branchId ?? ''}
            loading={branches.isLoading}
            options={toSelectOptions(branches.data, 'Tất cả chi nhánh')}
            onChange={(value) => patchQuery({ branchId: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Tìm kiếm" htmlFor="e-q" width={240}>
          <Input.Search
            id="e-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên, mã NV hoặc số điện thoại"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      <DataTable<Employee>
        rowKey="id"
        data={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onPageChange={(page, pageSize) =>
          patchQuery({ page: String(page), pageSize: String(pageSize) })
        }
        columns={columns}
        emptyIcon="group_add"
        emptyTitle="Chưa có nhân viên nào khớp bộ lọc"
        emptyDescription="Thêm từng người bằng nút Thêm nhân viên, hoặc tải lên file Excel để tạo hàng loạt."
        emptyAction={
          <Can do="employee.edit">
            <Button type="primary" onClick={() => setFormTarget({ mode: 'create' })}>
              Thêm nhân viên
            </Button>
          </Can>
        }
      />

      <EmployeeFormDrawer
        open={Boolean(formTarget)}
        mode={formTarget?.mode ?? 'create'}
        employee={formTarget?.employee}
        onClose={() => setFormTarget(null)}
      />

      <ImportEmployeesModal open={importOpen} onClose={() => setImportOpen(false)} />

      <ReasonDialog
        open={Boolean(lifecycle)}
        title={lifecycleCopy.title}
        description={
          lifecycle
            ? `${lifecycle.employee.fullName} · ${lifecycle.employee.employeeCode}`
            : undefined
        }
        warning={lifecycleCopy.warning}
        confirmText={lifecycleCopy.confirm}
        danger={lifecycle?.action === 'terminate'}
        loading={suspend.isPending || reactivate.isPending || terminate.isPending}
        onCancel={() => setLifecycle(null)}
        onConfirm={async (reason) => {
          if (!lifecycle) return;
          const payload = { id: lifecycle.employee.id, reason };

          try {
            if (lifecycle.action === 'suspend') await suspend.mutateAsync(payload);
            if (lifecycle.action === 'reactivate') await reactivate.mutateAsync(payload);
            if (lifecycle.action === 'terminate') await terminate.mutateAsync(payload);
            toast.success(`Đã cập nhật trạng thái của ${lifecycle.employee.fullName}`);
            setLifecycle(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </>
  );
}
