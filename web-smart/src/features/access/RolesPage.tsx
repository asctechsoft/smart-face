import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Input, Modal, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { EMPLOYABLE_STATUSES, ROLE_LABEL, SystemRole } from '@/config/constants';
import { rolesFor, type Permission } from '@/lib/rbac/permissions';
import { useDepartments } from '@/features/shared/org.api';
import {
  useEmployeeList,
  useUpdateEmployee,
  type Employee,
  type EmployeeQuery,
} from '@/features/employees/employees.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/** Các vai trò gán được từ Web Quản lý. `SYSTEM_ADMIN` chỉ cấp ở tầng nền tảng. */
const ASSIGNABLE_ROLES = [
  SystemRole.EMPLOYEE,
  SystemRole.MANAGER,
  SystemRole.HR_PAYROLL,
  SystemRole.COMPANY_ADMIN,
] as const;

/**
 * Phân quyền nội bộ — docs/04 mục 10 (`FR-WEB-NOT-04`, `FR-WEB-NOT-05`, `FR-WEB-NOT-06`).
 *
 * Màn hình lọc sẵn về những người CÓ quyền quản trị, thay vì bắt duyệt cả danh
 * sách nhân viên. Câu hỏi thật của người dùng là "ai đang có quyền gì" — và câu
 * đó chỉ trả lời được khi 400 dòng nhân viên thường không che mất 6 dòng đáng
 * xem.
 *
 * `MANAGER` bị giới hạn HAI CHIỀU (docs/04 mục 1): vai trò nói được LÀM GÌ, phạm
 * vi phòng ban nói được làm TRÊN AI. Gán vai trò Quản lý mà bỏ trống phạm vi thì
 * người đó đăng nhập vào không thấy nhân viên nào — nên form chặn lưu ở trạng
 * thái đó.
 *
 * Mọi thay đổi ở đây đi qua `PATCH /admin/employees/:id` và được ghi audit log
 * (`BR-08`, `FR-WEB-NOT-06`) — tra cứu ở Nhật ký kiểm toán, lọc hành động "Sửa
 * hồ sơ nhân viên".
 */
export function RolesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [target, setTarget] = useState<Employee | null>(null);

  const departments = useDepartments();

  const query: EmployeeQuery = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? 50),
      departmentId: searchParams.get('departmentId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      // Gồm cả `PENDING_ACTIVATION`: quyền được gán lúc tạo hồ sơ, TRƯỚC khi
      // người đó đăng nhập lần đầu. Lọc `ACTIVE` thì màn phân quyền không nhìn
      // thấy chính những tài khoản quản trị vừa được cấp.
      status: EMPLOYABLE_STATUSES,
    }),
    [searchParams],
  );

  const list = useEmployeeList(query);

  // Lọc ở client: Backend chưa có bộ lọc theo vai trò, mà danh sách người có
  // quyền quản trị của một công ty luôn nhỏ. Nếu về sau công ty nào đó có hàng
  // trăm người mang vai trò quản trị thì đây là chỗ cần một tham số `role` ở API.
  const privileged = (list.data?.items ?? []).filter((employee) =>
    employee.roles.some((role) => role !== SystemRole.EMPLOYEE),
  );

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
      title: 'Người dùng',
      key: 'employee',
      fixed: 'left',
      width: 260,
      render: (_, row) => (
        <EmployeeCell
          employee={{ id: row.id, fullName: row.fullName, employeeCode: row.employeeCode }}
          secondary={row.department?.name ?? row.employeeCode}
        />
      ),
    },
    {
      title: 'Vai trò',
      key: 'roles',
      width: 260,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.roles.map((role) => (
            <StatusBadge key={role} tone={role === SystemRole.EMPLOYEE ? 'neutral' : 'teal'}>
              {ROLE_LABEL[role] ?? role}
            </StatusBadge>
          ))}
        </div>
      ),
    },
    {
      title: 'Phạm vi phòng ban',
      key: 'scope',
      width: 300,
      render: (_, row) => {
        if (!row.roles.includes(SystemRole.MANAGER)) {
          return <span className="sf-text-muted">Toàn công ty</span>;
        }
        if (row.managedDepartmentIds.length === 0) {
          return (
            <StatusBadge tone="error">Chưa gán phòng ban — không thấy dữ liệu nào</StatusBadge>
          );
        }
        const names = row.managedDepartmentIds
          .map((id) => departments.data?.find((department) => department.id === id)?.name ?? id)
          .join(', ');
        return <span className="sf-body-sm">{names}</span>;
      },
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 130,
      render: (_, row) => (
        <Button size="small" onClick={() => setTarget(row)}>
          Đổi quyền
        </Button>
      ),
    },
  ];

  const activeFilters = ['departmentId', 'q'].filter((key) => searchParams.get(key)).length;

  return (
    <>
      <PageHeader
        title="Phân quyền nội bộ"
        description="Ai đang có quyền quản trị trên hệ thống và phạm vi dữ liệu của họ. Mọi thay đổi đều được ghi vào nhật ký kiểm toán."
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Phân quyền ở giao diện chỉ là trải nghiệm, không phải bảo mật"
        description="Backend kiểm tra lại toàn bộ quyền ở tầng API. Ẩn một nút không chặn được ai gọi thẳng API — nhưng gán nhầm vai trò thì có."
      />

      <FilterBar activeCount={activeFilters} onClear={() => setSearchParams({}, { replace: true })}>
        <FilterField label="Phòng ban" htmlFor="rl-dept" width={220}>
          <DepartmentTreeSelect
            id="rl-dept"
            value={query.departmentId}
            onChange={(value) => patchQuery({ departmentId: value })}
            placeholder="Tất cả phòng ban"
          />
        </FilterField>

        <FilterField label="Tìm người dùng" htmlFor="rl-q" width={240}>
          <Input.Search
            id="rl-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên hoặc mã nhân viên"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      <SectionTitle>Người có quyền quản trị ({privileged.length})</SectionTitle>

      <DataTable<Employee>
        rowKey="id"
        data={privileged}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="admin_panel_settings"
        emptyTitle="Chưa ai được gán quyền quản trị"
        emptyDescription="Tìm nhân viên ở ô tìm kiếm rồi bấm Đổi quyền để gán vai trò Quản lý, Kế toán/HR hoặc Admin công ty."
      />

      <SectionTitle>Vai trò làm được những gì</SectionTitle>
      <PermissionMatrix />

      <RoleDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}

/** Danh mục quyền hiển thị — nhóm theo module để đọc như bảng ở docs/04 mục 1. */
const PERMISSION_ROWS: { group: string; items: { permission: Permission; label: string }[] }[] = [
  {
    group: 'Chấm công',
    items: [
      { permission: 'attendance.view', label: 'Xem bảng chấm công' },
      { permission: 'attendance.adjust', label: 'Sửa / bổ sung công thủ công' },
      { permission: 'attendance.export', label: 'Xuất Excel bảng công' },
      { permission: 'makeup.manage', label: 'Ghi nhận công làm bù' },
    ],
  },
  {
    group: 'Đơn từ',
    items: [
      { permission: 'request.approve', label: 'Duyệt / từ chối đơn' },
      { permission: 'request.configure', label: 'Cấu hình loại đơn & luồng duyệt' },
    ],
  },
  {
    group: 'Nhân sự',
    items: [
      { permission: 'employee.edit', label: 'Tạo / sửa hồ sơ nhân viên' },
      { permission: 'employee.import', label: 'Import nhân viên hàng loạt' },
      { permission: 'shift.assign', label: 'Xếp ca / phân ca' },
      { permission: 'device.revoke', label: 'Thu hồi thiết bị' },
      { permission: 'biometric.reset', label: 'Đặt lại sinh trắc học' },
    ],
  },
  {
    group: 'Tính công & chính sách',
    items: [
      { permission: 'payroll.calculate', label: 'Chạy tính công' },
      { permission: 'payroll.close', label: 'Chốt / mở lại kỳ lương' },
      { permission: 'policy.edit', label: 'Đổi chính sách công ty' },
    ],
  },
  {
    group: 'Giám sát',
    items: [
      { permission: 'fraud.review', label: 'Quyết định huỷ / giữ công nghi vấn' },
      { permission: 'audit.view', label: 'Xem nhật ký kiểm toán' },
      { permission: 'role.manage', label: 'Phân quyền nội bộ' },
    ],
  },
];

/**
 * Bảng "vai trò nào làm được gì" — đọc thẳng từ ma trận phân quyền của client.
 *
 * Dựng từ `rolesFor()` thay vì gõ lại bảng: một bảng chép tay sẽ lệch khỏi ma
 * trận thật ngay lần đầu ai đó sửa quyền, và bảng sai còn tệ hơn không có bảng.
 */
function PermissionMatrix() {
  const rows = PERMISSION_ROWS.flatMap((group) =>
    group.items.map((item) => ({ key: item.permission, group: group.group, ...item })),
  );

  return (
    <Table
      size="small"
      rowKey="key"
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: 'Nhóm', dataIndex: 'group', key: 'group', width: 200 },
        { title: 'Hành động', dataIndex: 'label', key: 'label', width: 280 },
        ...ASSIGNABLE_ROLES.map((role) => ({
          title: ROLE_LABEL[role],
          key: role,
          width: 140,
          align: 'center' as const,
          render: (_: unknown, row: { permission: Permission }) =>
            rolesFor(row.permission).includes(role) ? (
              <Icon name="check_circle" size={20} color="var(--sf-success-700)" />
            ) : (
              <span className="sf-text-muted" aria-label="Không có quyền">
                —
              </span>
            ),
        })),
      ]}
    />
  );
}

function RoleDialog({ target, onClose }: { target: Employee | null; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const departments = useDepartments();
  const update = useUpdateEmployee();

  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [scope, setScope] = useState<string[]>([]);

  const isManager = roles.includes(SystemRole.MANAGER);
  // Vai trò Quản lý mà không có phòng ban nào là một tài khoản không dùng được:
  // đăng nhập vào và không thấy nhân viên nào cả.
  const missingScope = isManager && scope.length === 0;

  return (
    <Modal
      open={Boolean(target)}
      title={`Đổi quyền · ${target?.fullName ?? ''}`}
      okText="Lưu"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: update.isPending, disabled: missingScope }}
      width={560}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open && target) {
          setRoles(target.roles);
          setScope(target.managedDepartmentIds);
        }
      }}
      onCancel={onClose}
      onOk={async () => {
        if (!target) return;
        try {
          await update.mutateAsync({
            id: target.id,
            roles,
            // Chỉ gửi phạm vi khi thật sự là Quản lý — gửi ở vai trò khác chỉ tạo
            // dữ liệu rác mà `ScopeGuard` không bao giờ đọc tới.
            ...(isManager ? { managedDepartmentIds: scope } : { managedDepartmentIds: [] }),
          });
          toast.success(`Đã cập nhật phân quyền của ${target.fullName}`);
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label
            className="sf-field__label"
            htmlFor="rl-roles"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Vai trò trên hệ thống
          </label>
          <Select
            id="rl-roles"
            mode="multiple"
            style={{ width: '100%' }}
            value={roles}
            onChange={setRoles}
            options={ASSIGNABLE_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
          />
        </div>

        {isManager ? (
          <div>
            <label
              className="sf-field__label"
              htmlFor="rl-scope"
              style={{ display: 'block', marginBottom: 4 }}
            >
              Phòng ban được quản lý <span style={{ color: 'var(--sf-error-600)' }}>*</span>
            </label>
            <Select
              id="rl-scope"
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Chọn các phòng ban người này quản lý"
              loading={departments.isLoading}
              value={scope}
              onChange={setScope}
              options={(departments.data ?? []).map((department) => ({
                value: department.id,
                label: department.name,
              }))}
            />
            {missingScope ? (
              <Alert
                style={{ marginTop: 8 }}
                type="error"
                showIcon
                role="alert"
                message="Vai trò Quản lý phải có ít nhất một phòng ban"
                description="Bỏ trống nghĩa là người này đăng nhập vào và không thấy nhân viên, chấm công hay đơn từ nào cả."
              />
            ) : (
              <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
                Quản lý chỉ đọc được dữ liệu của các phòng ban chọn ở đây — thêm một phòng ban là
                trao quyền xem toàn bộ chấm công của phòng đó.
              </p>
            )}
          </div>
        ) : null}

        {roles.includes(SystemRole.COMPANY_ADMIN) ? (
          <Alert
            type="warning"
            showIcon
            message="Admin công ty thấy và sửa được mọi thứ trong công ty"
            description="Gồm cả chính sách tính lương, chốt kỳ và phân quyền cho người khác. Chỉ gán cho người thật sự chịu trách nhiệm về hệ thống."
          />
        ) : null}
      </div>
    </Modal>
  );
}
