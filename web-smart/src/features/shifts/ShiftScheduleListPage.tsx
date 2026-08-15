import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, DatePicker } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { DataTable } from '@/components/DataTable';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useDepartments } from '@/features/shared/org.api';
import { dayjs } from '@/lib/utils/dayjs';
import { ShiftScheduleFormModal } from './ShiftScheduleFormModal';
import { useDeleteShiftSchedule, useShiftSchedules, type ShiftSchedule } from './shifts.api';

/**
 * Danh sách bảng phân ca — FR-WEB-HR-13.
 *
 * Đây là cửa vào của việc xếp lịch: người dùng nghĩ theo đơn vị "bảng phân ca
 * tháng 8 phòng Kho", không theo từng ô lịch rời rạc. Mở một bảng ra mới tới
 * lưới người × ngày.
 */
export function ShiftScheduleListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const showError = useErrorToast();
  const canAssign = useCan('shift.assign');

  const departments = useDepartments();
  const remove = useDeleteShiftSchedule();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftSchedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShiftSchedule | null>(null);

  const month = searchParams.get('month') ?? undefined;
  const departmentId = searchParams.get('departmentId') ?? undefined;
  const page = Number(searchParams.get('page') ?? 1);
  const pageSize = Number(searchParams.get('pageSize') ?? 20);

  const schedules = useShiftSchedules({ month, departmentId, page, pageSize });
  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const columns: ColumnsType<ShiftSchedule> = [
    {
      title: 'Bảng phân ca',
      key: 'name',
      render: (_, row) => (
        <div>
          <Link to={`/shifts/${row.id}`} style={{ fontWeight: 600 }}>
            {row.name}
          </Link>
          <div className="sf-body-sm sf-text-variant">
            Kỳ {dayjs(row.periodMonth).format('MM/YYYY')}
          </div>
        </div>
      ),
    },
    {
      title: 'Phòng ban',
      key: 'departments',
      width: 260,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.departmentIds.map((id) => (
            <StatusBadge key={id} tone="neutral" soft>
              {departmentName.get(id) ?? 'Đã xoá'}
            </StatusBadge>
          ))}
        </div>
      ),
    },
    {
      title: 'Số CBNV',
      dataIndex: 'memberCount',
      key: 'memberCount',
      width: 110,
      align: 'right',
    },
    {
      title: 'Đã xếp',
      key: 'assignmentCount',
      width: 140,
      align: 'right',
      render: (_, row) =>
        row.assignmentCount === 0 ? (
          <StatusBadge tone="warning" soft>
            Chưa xếp ca
          </StatusBadge>
        ) : (
          `${row.assignmentCount} lượt`
        ),
    },
    ...(canAssign
      ? [
          {
            title: '',
            key: 'actions',
            width: 200,
            render: (_: unknown, row: ShiftSchedule) => (
              <div style={{ display: 'flex', gap: 8 }}>
                <Link to={`/shifts/${row.id}`}>
                  <Button size="small">Mở bảng</Button>
                </Link>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(row);
                    setFormOpen(true);
                  }}
                >
                  Sửa
                </Button>
                <Button size="small" type="text" danger onClick={() => setDeleteTarget(row)}>
                  Xoá
                </Button>
              </div>
            ),
          } as ColumnsType<ShiftSchedule>[number],
        ]
      : []),
  ];

  const activeFilters = ['month', 'departmentId'].filter((key) => searchParams.get(key)).length;

  return (
    <>
      <PageHeader
        title="Phân ca"
        description="Mỗi bảng phân ca là lịch ca của một tháng cho một nhóm phòng ban. Mở bảng ra để xếp ca cho từng người từng ngày."
        actions={
          <Can do="shift.assign">
            <Button
              type="primary"
              icon={<Icon name="add" size={20} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Lập bảng phân ca
            </Button>
          </Can>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => patchQuery({ month: undefined, departmentId: undefined })}
      >
        <FilterField label="Tháng" htmlFor="ss-month" width={180}>
          <DatePicker
            id="ss-month"
            picker="month"
            format="MM/YYYY"
            style={{ width: '100%' }}
            value={month ? dayjs(month) : null}
            onChange={(date) => patchQuery({ month: date?.format('YYYY-MM-01') })}
            placeholder="Tất cả"
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="ss-dept" width={240}>
          <DepartmentTreeSelect
            id="ss-dept"
            value={departmentId}
            onChange={(value) => patchQuery({ departmentId: value })}
            placeholder="Tất cả phòng ban"
          />
        </FilterField>
      </FilterBar>

      <DataTable<ShiftSchedule>
        rowKey="id"
        data={schedules.data?.items}
        meta={schedules.data?.meta}
        isLoading={schedules.isLoading}
        error={schedules.error}
        onRetry={() => void schedules.refetch()}
        columns={columns}
        onPageChange={(nextPage, nextSize) =>
          patchQuery({ page: String(nextPage), pageSize: String(nextSize) })
        }
        emptyIcon="event_busy"
        emptyTitle="Chưa có bảng phân ca nào"
        emptyDescription="Lập bảng cho một tháng và một nhóm phòng ban, hệ thống sẽ kéo toàn bộ CBNV của các phòng đó vào bảng để bạn xếp ca."
        emptyAction={
          canAssign ? (
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Lập bảng phân ca
            </Button>
          ) : undefined
        }
      />

      <ShiftScheduleFormModal
        open={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Xoá "${deleteTarget?.name ?? ''}"?`}
        message={
          deleteTarget && deleteTarget.assignmentCount > 0
            ? `Xoá luôn ${deleteTarget.assignmentCount} lượt phân ca đã xếp trong bảng này. ${deleteTarget.memberCount} nhân viên sẽ quay về ca mặc định của công ty cho cả tháng. Bảng công đã tính không tự đổi theo — chạy lại tính công nếu cần.`
            : 'Bảng này chưa xếp ca nào nên không có lịch ca nào bị mất.'
        }
        confirmText="Xoá bảng"
        danger
        loading={remove.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            const result = await remove.mutateAsync(deleteTarget.id);
            toast.success(
              'Đã xoá bảng phân ca',
              result.removedAssignments > 0
                ? `Kèm ${result.removedAssignments} lượt phân ca.`
                : undefined,
            );
            setDeleteTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </>
  );
}
