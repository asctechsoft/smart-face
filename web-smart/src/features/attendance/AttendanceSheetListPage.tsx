import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, DatePicker } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { DataTable } from '@/components/DataTable';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { Can, useCan } from '@/lib/rbac/Can';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useDepartments } from '@/features/shared/org.api';
import { dayjs } from '@/lib/utils/dayjs';
import { AttendanceSheetFormModal } from './AttendanceSheetFormModal';
import {
  useAttendanceSheets,
  useDeleteAttendanceSheet,
  type AttendanceSheet,
} from './attendance-sheets.api';
import { Badge as StatusBadge, Icon } from '@/components/ui';

/**
 * Danh sách bảng chấm công — FR-WEB-ATT-08.
 *
 * ## Đây KHÔNG còn là cửa vào của việc rà công
 *
 * Cửa vào là `/attendance` — tổng hợp theo THÁNG, mỗi dòng một người. Màn này
 * lùi xuống một bậc và chỉ còn một việc: **lập, mở và xoá bảng**.
 *
 * Bảng chấm công vẫn là đơn vị tổ chức thật — nó chốt danh sách thành viên của
 * kỳ, và nó là thứ được chốt. Nhưng nó là khái niệm của người QUẢN TRỊ kỳ công,
 * không phải của người rà công hằng ngày: kế toán mở màn hình để hỏi "tháng 5
 * còn ai chưa xong", và câu đó không cần biết tháng 5 được chia thành mấy bảng.
 *
 * ## Vì sao ở đây không còn hàng thẻ chỉ số
 *
 * Trước đây màn này có hàng thẻ và cảnh báo "cần đối soát" của cả kỳ. Giờ chúng
 * nằm ở `/attendance`, đúng một cú bấm bên cạnh. Giữ thêm một bản sao là dựng
 * hai chỗ hiển thị cùng một con số — và ngày chúng lệch nhau (một bên lọc theo
 * kỳ lương, một bên theo tháng của bảng) thì không ai biết bên nào đúng.
 */
export function AttendanceSheetListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const showError = useErrorToast();
  // Lập bảng và xoá bảng là hai mức quyền khác nhau: Quản lý tổ chức được bảng
  // của phòng mình, nhưng xoá cả một bảng đã rà là việc của Kế toán/HR.
  const canManage = useCan('attendance.sheet_manage');

  const departments = useDepartments();
  const remove = useDeleteAttendanceSheet();

  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceSheet | null>(null);

  const month = searchParams.get('month') ?? undefined;
  const departmentId = searchParams.get('departmentId') ?? undefined;
  const page = Number(searchParams.get('page') ?? 1);
  const pageSize = Number(searchParams.get('pageSize') ?? 20);

  const sheets = useAttendanceSheets({ month, departmentId, page, pageSize });

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

  const columns: ColumnsType<AttendanceSheet> = [
    {
      title: 'Bảng chấm công',
      key: 'name',
      render: (_, row) => (
        <div>
          <Link to={`/attendance/${row.id}`} style={{ fontWeight: 600 }}>
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
      // Người rà công cần biết bảng này lấy người từ đâu: từ lịch ca đã xếp, hay
      // chỉ từ danh sách phòng ban. Hai nguồn cho ra hai mức tin cậy khác nhau —
      // bảng dựng từ phòng ban dễ thiếu người vừa điều động sang giữa tháng.
      title: 'Nguồn dữ liệu',
      key: 'source',
      width: 170,
      render: (_, row) =>
        row.shiftScheduleIds.length > 0 ? (
          <StatusBadge tone="teal" soft>
            Từ bảng phân ca
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral" soft>
            Từ phòng ban
          </StatusBadge>
        ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 130,
      render: (_, row) =>
        row.status === 'CLOSED' ? (
          <StatusBadge tone="neutral">Đã chốt</StatusBadge>
        ) : (
          <StatusBadge tone="warning" soft>
            Đang rà soát
          </StatusBadge>
        ),
    },
    ...(canManage
      ? [
          {
            title: '',
            key: 'actions',
            // Đủ chỗ cho cả hai nhãn. Nút bị bóp lại cho vừa ô sẽ dính sát nhau,
            // và "Mở bảng" là một liên kết — bấm lệch vài pixel là mất trang.
            width: 200,
            render: (_: unknown, row: AttendanceSheet) => (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap' }}>
                <Link to={`/attendance/${row.id}`} style={{ flex: '0 0 auto' }}>
                  <Button size="small">Mở bảng</Button>
                </Link>
                <Can do="attendance.adjust">
                  <Button
                    size="small"
                    type="text"
                    danger
                    style={{ flex: '0 0 auto' }}
                    // Chặn sự kiện nổi lên: ô này nằm cạnh một liên kết, và một
                    // cú bấm đi lạc sẽ điều hướng mất trang thay vì mở hộp thoại.
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDeleteTarget(row);
                    }}
                  >
                    Xoá
                  </Button>
                </Can>
              </div>
            ),
          } as ColumnsType<AttendanceSheet>[number],
        ]
      : []),
  ];

  const activeFilters = ['month', 'departmentId'].filter((key) => searchParams.get(key)).length;

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label="Đường dẫn" className="sf-body-sm">
            <Link to="/attendance">Bảng công</Link>
            <span className="sf-text-variant" style={{ margin: '0 8px' }}>
              /
            </span>
            <span className="sf-text-variant">Danh sách bảng</span>
          </nav>
        }
        title="Danh sách bảng chấm công"
        description="Mỗi bảng là công của một tháng cho một nhóm phòng ban — nó chốt xem AI thuộc kỳ, và nó là thứ được chốt. Số liệu công của cả tháng nằm ở màn Bảng công."
        actions={
          <Can do="attendance.sheet_manage">
            <Button
              type="primary"
              icon={<Icon name="add" size={20} />}
              onClick={() => {
                setFormOpen(true);
              }}
            >
              Lập bảng chấm công
            </Button>
          </Can>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => patchQuery({ month: undefined, departmentId: undefined })}
      >
        <FilterField label="Tháng" htmlFor="as-month" width={180}>
          <DatePicker
            id="as-month"
            picker="month"
            format="MM/YYYY"
            style={{ width: '100%' }}
            value={month ? dayjs(month) : null}
            onChange={(date) => patchQuery({ month: date?.format('YYYY-MM-01') })}
            placeholder="Tất cả"
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="as-dept" width={240}>
          <DepartmentTreeSelect
            id="as-dept"
            value={departmentId}
            onChange={(value) => patchQuery({ departmentId: value })}
            placeholder="Tất cả phòng ban"
          />
        </FilterField>
      </FilterBar>

      <DataTable<AttendanceSheet>
        rowKey="id"
        data={sheets.data?.items}
        meta={sheets.data?.meta}
        isLoading={sheets.isLoading}
        error={sheets.error}
        onRetry={() => void sheets.refetch()}
        columns={columns}
        onPageChange={(nextPage, nextSize) =>
          patchQuery({ page: String(nextPage), pageSize: String(nextSize) })
        }
        emptyIcon="event_busy"
        emptyTitle="Chưa có bảng chấm công nào"
        emptyDescription="Lập bảng cho một tháng và một nhóm phòng ban. Hệ thống kéo thành viên từ bảng phân ca của tháng đó, rồi ghép công đã tính và đơn từ vào từng ngày."
        emptyAction={
          canManage ? (
            <Button
              type="primary"
              onClick={() => {
                setFormOpen(true);
              }}
            >
              Lập bảng chấm công
            </Button>
          ) : undefined
        }
      />

      <AttendanceSheetFormModal open={formOpen} onClose={() => setFormOpen(false)} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Xoá "${deleteTarget?.name ?? ''}"?`}
        // Khác hẳn xoá bảng phân ca: ở đó lịch ca đã xếp bị xoá theo. Ở đây
        // không có gì mất — nói rõ để người dùng không do dự vô ích, và cũng để
        // họ không tưởng rằng xoá bảng là cách xoá công.
        message="Chỉ xoá khung rà soát. Công đã tính, bản ghi chấm công và đơn từ của tháng này vẫn còn nguyên — lập lại bảng là thấy lại đúng số liệu."
        confirmText="Xoá bảng"
        danger
        loading={remove.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync(deleteTarget.id);
            toast.success('Đã xoá bảng chấm công', 'Số liệu công của tháng không bị ảnh hưởng.');
            setDeleteTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </>
  );
}
