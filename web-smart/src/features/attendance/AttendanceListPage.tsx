import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Checkbox, DatePicker, Input, Select, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatusBadge, dailyStatusTone } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { Can } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { DAILY_STATUS_LABEL, DEFAULT_PAGE_SIZE } from '@/config/constants';
import { formatDay, formatMinutes, formatTime, firstDayOfMonth, todayWorkDate, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { formatStandardDays } from '@/lib/utils/format';
import { useDepartments, useBranches, toSelectOptions } from '@/features/shared/org.api';
import { useAttendanceList, type AttendanceDaily, type AttendanceQuery } from './attendance.api';
import { AttendanceDetailDrawer } from './AttendanceDetailDrawer';
import { ExportAttendanceModal } from './ExportAttendanceModal';
import { AdjustAttendanceModal } from './AdjustAttendanceModal';

const { RangePicker } = DatePicker;

/**
 * Danh sách chấm công — docs/04 mục 3 (`FR-WEB-ATT-01..07`).
 *
 * Bộ lọc nằm trên URL (`useSearchParams`) chứ không trong state cục bộ. Kế toán
 * hay gửi cho nhau đường dẫn "xem giúp phòng Kỹ thuật tuần trước"; giữ trong
 * state thì link dán sang máy khác mở ra bộ lọc mặc định.
 */
export function AttendanceListPage() {
  const { timezone } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState<{ employeeId: string; workDate: string; name: string } | null>(
    null,
  );
  const [adjustTarget, setAdjustTarget] = useState<AttendanceDaily | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const query: AttendanceQuery = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
      from: searchParams.get('from') ?? firstDayOfMonth(timezone),
      to: searchParams.get('to') ?? todayWorkDate(timezone),
      departmentId: searchParams.get('departmentId') ?? undefined,
      branchId: searchParams.get('branchId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      hasFraudFlag: searchParams.get('hasFraudFlag') === 'true' ? true : undefined,
      q: searchParams.get('q') ?? undefined,
    }),
    [searchParams, timezone],
  );

  const departments = useDepartments();
  const branches = useBranches();
  const list = useAttendanceList(query);

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    });
    // Mọi thay đổi bộ lọc đều đưa về trang 1 — giữ nguyên trang 7 sau khi lọc
    // lại thường cho ra một bảng trống và người dùng tưởng là không có dữ liệu.
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const activeFilters = ['departmentId', 'branchId', 'status', 'hasFraudFlag', 'q'].filter((key) =>
    searchParams.get(key),
  ).length;

  const columns: ColumnsType<AttendanceDaily> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      fixed: 'left',
      width: 260,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Ngày',
      dataIndex: 'workDate',
      key: 'workDate',
      width: 120,
      render: (value: string) => formatDay(value, timezone),
    },
    {
      title: 'Vào',
      dataIndex: 'firstCheckInAt',
      key: 'in',
      width: 90,
      render: (value: string | null) => formatTime(value, timezone),
    },
    {
      title: 'Ra',
      dataIndex: 'lastCheckOutAt',
      key: 'out',
      width: 90,
      render: (value: string | null) => formatTime(value, timezone),
    },
    {
      title: 'Tổng giờ',
      dataIndex: 'workedMinutes',
      key: 'worked',
      width: 100,
      align: 'right',
      render: (value: number) => formatMinutes(value),
    },
    {
      title: 'Muộn',
      dataIndex: 'lateMinutes',
      key: 'late',
      width: 90,
      align: 'right',
      render: (value: number) =>
        value > 0 ? (
          <span style={{ color: 'var(--sf-warning-700)', fontWeight: 600 }}>
            {formatMinutes(value)}
          </span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'OT',
      dataIndex: 'otMinutes',
      key: 'ot',
      width: 90,
      align: 'right',
      render: (value: number) => (value > 0 ? formatMinutes(value) : <span className="sf-text-muted">—</span>),
    },
    {
      title: 'Công',
      dataIndex: 'standardDays',
      key: 'standardDays',
      width: 80,
      align: 'right',
      render: (value: string | number) => formatStandardDays(value),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (value: string) => (
        <StatusBadge tone={dailyStatusTone(value)}>{DAILY_STATUS_LABEL[value] ?? value}</StatusBadge>
      ),
    },
    {
      title: 'Cờ',
      dataIndex: 'hasFraudFlag',
      key: 'flag',
      width: 70,
      align: 'center',
      render: (value: boolean) =>
        value ? (
          <Tooltip title="Ngày này có lượt chấm công bị gắn cờ nghi vấn">
            {/* Cờ có `aria-label` chứ không chỉ là màu — docs/16 mục 14.2 điều 1. */}
            <Icon name="flag" size={20} color="var(--sf-error-600)" fill label="Có cờ nghi vấn" />
          </Tooltip>
        ) : null,
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="small"
            onClick={() =>
              setDetail({
                employeeId: row.employeeId,
                workDate: row.workDate,
                name: row.employee?.fullName ?? 'Nhân viên',
              })
            }
          >
            Chi tiết
          </Button>
          <Can do="attendance.adjust">
            <Button size="small" type="text" onClick={() => setAdjustTarget(row)}>
              Hiệu chỉnh
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quản lý chấm công"
        description="Bảng công theo ngày, tính sẵn từ bản ghi thô. Bấm vào một dòng để xem ảnh, vị trí và điểm nhận diện của từng lượt."
        actions={
          <Can do="attendance.export">
            <Button
              icon={<Icon name="download" size={20} />}
              onClick={() => setExportOpen(true)}
            >
              Xuất Excel
            </Button>
          </Can>
        }
      />

      <FilterBar activeCount={activeFilters} onClear={() => setSearchParams({}, { replace: true })}>
        <FilterField label="Khoảng ngày" width={260}>
          <RangePicker
            format="DD/MM/YYYY"
            allowClear={false}
            value={[toDayjs(query.from), toDayjs(query.to)]}
            onChange={(dates) => {
              patchQuery({
                from: toWorkDate(dates?.[0]?.toDate()),
                to: toWorkDate(dates?.[1]?.toDate()),
              });
            }}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="f-dept" width={200}>
          <Select
            id="f-dept"
            value={query.departmentId ?? ''}
            options={toSelectOptions(departments.data, 'Tất cả phòng ban')}
            loading={departments.isLoading}
            onChange={(value) => patchQuery({ departmentId: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Chi nhánh" htmlFor="f-branch" width={180}>
          <Select
            id="f-branch"
            value={query.branchId ?? ''}
            options={toSelectOptions(branches.data, 'Tất cả chi nhánh')}
            loading={branches.isLoading}
            onChange={(value) => patchQuery({ branchId: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Trạng thái" htmlFor="f-status" width={170}>
          <Select
            id="f-status"
            value={query.status ?? ''}
            options={[
              { value: '', label: 'Tất cả' },
              ...Object.entries(DAILY_STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => patchQuery({ status: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Tìm nhân viên" htmlFor="f-q" width={220}>
          <Input.Search
            id="f-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên, mã NV hoặc SĐT"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>

        <Checkbox
          checked={query.hasFraudFlag === true}
          onChange={(event) =>
            patchQuery({ hasFraudFlag: event.target.checked ? 'true' : undefined })
          }
          style={{ alignSelf: 'flex-end', height: 42, display: 'flex', alignItems: 'center' }}
        >
          Chỉ dòng có cờ nghi vấn
        </Checkbox>
      </FilterBar>

      <DataTable<AttendanceDaily>
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
        emptyIcon="event_busy"
        emptyTitle="Không có ngày công nào khớp bộ lọc"
        emptyDescription="Thử mở rộng khoảng ngày, bỏ bớt bộ lọc phòng ban, hoặc kiểm tra lại từ khoá tìm kiếm."
        onRow={(row) => ({
          onDoubleClick: () =>
            setDetail({
              employeeId: row.employeeId,
              workDate: row.workDate,
              name: row.employee?.fullName ?? 'Nhân viên',
            }),
        })}
      />

      <AttendanceDetailDrawer
        open={Boolean(detail)}
        employeeId={detail?.employeeId ?? null}
        workDate={detail?.workDate ?? null}
        employeeName={detail?.name ?? ''}
        onClose={() => setDetail(null)}
      />

      <AdjustAttendanceModal
        open={Boolean(adjustTarget)}
        daily={adjustTarget}
        onClose={() => setAdjustTarget(null)}
      />

      <ExportAttendanceModal
        open={exportOpen}
        defaultFrom={query.from}
        defaultTo={query.to}
        onClose={() => setExportOpen(false)}
      />
    </>
  );
}
