import { useState } from 'react';
import { Button, Input, Modal, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useBranches, useDepartments, type Department } from '@/features/shared/org.api';
import { useUpsertDepartment } from '../policy.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Phòng ban.
 *
 * Phòng ban không chỉ để nhóm nhân viên: nó là ĐƠN VỊ PHÂN QUYỀN. Vai trò
 * `MANAGER` bị giới hạn theo danh sách phòng ban được giao (`ScopeGuard`), và
 * trưởng phòng là mắt xích đầu trong luồng duyệt đơn (`DIRECT_MANAGER`).
 * Vì vậy để trống ô "Trưởng phòng" làm cả luồng duyệt đơn của phòng đó đứng lại.
 */
export function DepartmentsTab() {
  const canEdit = useCan('policy.edit');
  const departments = useDepartments();
  const branches = useBranches();
  const [editing, setEditing] = useState<Partial<Department> | null>(null);

  const branchName = (id: string | null) =>
    branches.data?.find((branch) => branch.id === id)?.name ?? '—';

  const columns: ColumnsType<Department> = [
    { title: 'Tên phòng ban', dataIndex: 'name', key: 'name', width: 260 },
    {
      title: 'Thuộc chi nhánh',
      dataIndex: 'branchId',
      key: 'branch',
      width: 200,
      render: (value: string | null) => branchName(value),
    },
    {
      title: 'Phòng ban cha',
      dataIndex: 'parentId',
      key: 'parent',
      width: 200,
      render: (value: string | null) =>
        value
          ? (departments.data?.find((item) => item.id === value)?.name ?? '—')
          : <span className="sf-text-muted">Cấp cao nhất</span>,
    },
    {
      title: 'Trưởng phòng',
      dataIndex: 'managerId',
      key: 'manager',
      width: 200,
      render: (value: string | null) =>
        value ? (
          'Đã phân công'
        ) : (
          <span style={{ color: 'var(--sf-warning-800)' }}>Chưa phân công</span>
        ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, row: Department) => (
              <Button size="small" onClick={() => setEditing(row)}>
                Sửa
              </Button>
            ),
          } as ColumnsType<Department>[number],
        ]
      : []),
  ];

  return (
    <div>
      {canEdit ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Button type="primary" icon={<Icon name="add" size={20} />} onClick={() => setEditing({})}>
            Thêm phòng ban
          </Button>
        </div>
      ) : null}

      <DataTable<Department>
        rowKey="id"
        data={departments.data}
        isLoading={departments.isLoading}
        error={departments.error}
        onRetry={() => void departments.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="account_tree"
        emptyTitle="Chưa có phòng ban nào"
        emptyDescription="Phòng ban là đơn vị phân quyền của hệ thống: vai trò Quản lý chỉ xem được dữ liệu của các phòng ban được giao."
        emptyAction={
          canEdit ? (
            <Button type="primary" onClick={() => setEditing({})}>
              Thêm phòng ban
            </Button>
          ) : undefined
        }
      />

      <DepartmentFormModal
        department={editing}
        allDepartments={departments.data ?? []}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function DepartmentFormModal({
  department,
  allDepartments,
  onClose,
}: {
  department: Partial<Department> | null;
  allDepartments: Department[];
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const branches = useBranches();
  const upsert = useUpsertDepartment();
  const [draft, setDraft] = useState<Partial<Department>>({});

  const value = { ...department, ...draft };

  return (
    <Modal
      open={Boolean(department)}
      onCancel={onClose}
      title={department?.id ? `Sửa phòng ban · ${department.name}` : 'Thêm phòng ban'}
      okText="Lưu"
      cancelText="Huỷ bỏ"
      okButtonProps={{ size: 'large', loading: upsert.isPending, disabled: !value.name }}
      cancelButtonProps={{ size: 'large' }}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open) setDraft({});
      }}
      onOk={async () => {
        try {
          await upsert.mutateAsync(value);
          toast.success('Đã lưu phòng ban');
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label className="sf-field__label" htmlFor="d-name" style={{ display: 'block', marginBottom: 4 }}>
            Tên phòng ban
          </label>
          <Input
            id="d-name"
            value={value.name ?? ''}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Kỹ thuật"
          />
        </div>

        <div>
          <label className="sf-field__label" htmlFor="d-branch" style={{ display: 'block', marginBottom: 4 }}>
            Thuộc chi nhánh
          </label>
          <Select
            id="d-branch"
            allowClear
            style={{ width: '100%' }}
            value={value.branchId ?? undefined}
            onChange={(branchId) => setDraft((prev) => ({ ...prev, branchId: branchId ?? null }))}
            loading={branches.isLoading}
            options={(branches.data ?? []).map((branch) => ({
              value: branch.id,
              label: branch.name,
            }))}
          />
        </div>

        <div>
          <label className="sf-field__label" htmlFor="d-parent" style={{ display: 'block', marginBottom: 4 }}>
            Phòng ban cha
          </label>
          <Select
            id="d-parent"
            allowClear
            style={{ width: '100%' }}
            value={value.parentId ?? undefined}
            onChange={(parentId) => setDraft((prev) => ({ ...prev, parentId: parentId ?? null }))}
            placeholder="Bỏ trống nếu đây là phòng ban cấp cao nhất"
            options={allDepartments
              // Không cho chọn chính nó làm cha — sẽ tạo vòng lặp trong cây.
              .filter((item) => item.id !== department?.id)
              .map((item) => ({ value: item.id, label: item.name }))}
          />
        </div>
      </div>
    </Modal>
  );
}
