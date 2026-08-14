import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, DatePicker, Dropdown, Input, Modal, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatusBadge, type BadgeTone } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { StatCardSkeleton } from '@/components/Skeleton';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { DEFAULT_PAGE_SIZE, REASON_MIN_LENGTH } from '@/config/constants';
import { formatDay, formatMinutes, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { formatStandardDays } from '@/lib/utils/format';
import { useDepartments, toSelectOptions } from '@/features/shared/org.api';
import { CreateDebtModal } from './CreateDebtModal';
import { RecordMakeupModal } from './RecordMakeupModal';
import {
  MAKEUP_STATUS_LABEL,
  useCancelMakeup,
  useExtendMakeup,
  useMakeupList,
  useMakeupSummary,
  type MakeupQuery,
  type MakeupRecord,
} from './makeup.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

const { RangePicker } = DatePicker;

/**
 * Công làm bù — docs/04 mục 5 (`FR-WEB-MKUP-01..04`).
 *
 * Màn hình trả lời ba câu hỏi theo đúng thứ tự người dùng hỏi:
 *
 *   1. Cả công ty còn nợ bao nhiêu giờ, quy ra bao nhiêu công?  → thẻ chỉ số
 *   2. Khoản nào SẮP HẾT HẠN?                                    → sắp xếp mặc định + cờ đỏ
 *   3. Ghi nhận giờ đã bù của một người                          → thao tác trên dòng
 *
 * Quá hạn được làm nổi bật vì đó là chỗ mất tiền: quá hạn mà vẫn cho bù nghĩa là
 * nhân viên gom nợ nửa năm rồi bù một lần, và bảng công của các tháng trước đó
 * đều đã chốt sai so với thực tế.
 */
export function MakeupPage() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canManage = useCan('makeup.manage');
  const [searchParams, setSearchParams] = useSearchParams();

  const [createOpen, setCreateOpen] = useState(false);
  const [recordTarget, setRecordTarget] = useState<MakeupRecord | null>(null);
  const [extendTarget, setExtendTarget] = useState<MakeupRecord | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MakeupRecord | null>(null);

  const departments = useDepartments();
  const extend = useExtendMakeup();
  const cancel = useCancelMakeup();

  const query: MakeupQuery = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
      status: searchParams.get('status') ?? undefined,
      departmentId: searchParams.get('departmentId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      q: searchParams.get('q') ?? undefined,
    }),
    [searchParams],
  );

  const list = useMakeupList(query);
  const summary = useMakeupSummary(query);

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const conversion = summary.data?.conversion;

  const columns: ColumnsType<MakeupRecord> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      fixed: 'left',
      width: 240,
      render: (_, row) =>
        row.employee ? (
          <EmployeeCell
            employee={{
              id: row.employee.id,
              fullName: row.employee.fullName,
              employeeCode: row.employee.employeeCode,
            }}
            secondary={row.employee.department?.name ?? row.employee.employeeCode}
          />
        ) : (
          <span className="sf-text-muted">Không xác định</span>
        ),
    },
    {
      title: 'Ngày phát sinh nợ',
      dataIndex: 'debtWorkDate',
      key: 'debtWorkDate',
      width: 150,
      render: (value: string) => formatDay(value, timezone),
    },
    {
      title: 'Nợ',
      key: 'debt',
      width: 140,
      align: 'right',
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{formatMinutes(row.debtMinutes)}</div>
          <div className="sf-body-sm sf-text-variant">
            {formatStandardDays(row.debtStandardDays)} công
          </div>
        </div>
      ),
    },
    {
      title: 'Đã bù',
      key: 'madeUp',
      width: 160,
      align: 'right',
      render: (_, row) => (
        <div>
          <div>{formatMinutes(row.makeupMinutes)}</div>
          {row.makeupWorkDate ? (
            <div className="sf-body-sm sf-text-variant">
              ngày {formatDay(row.makeupWorkDate, timezone)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Còn nợ',
      key: 'remaining',
      width: 130,
      align: 'right',
      render: (_, row) =>
        row.remainingMinutes > 0 ? (
          <span style={{ fontWeight: 600, color: 'var(--sf-error-700)' }}>
            {formatMinutes(row.remainingMinutes)}
          </span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'Hạn làm bù',
      key: 'dueDate',
      width: 170,
      render: (_, row) => {
        if (!row.dueDate) return <span className="sf-text-muted">Không hạn</span>;

        return (
          <div>
            <div>{formatDay(row.dueDate, timezone)}</div>
            {row.isOverdue ? (
              <StatusBadge tone="error" soft>
                Quá hạn {Math.abs(row.daysUntilDue ?? 0)} ngày
              </StatusBadge>
            ) : row.daysUntilDue !== null && row.daysUntilDue <= 7 && row.remainingMinutes > 0 ? (
              <StatusBadge tone="warning" soft>
                Còn {row.daysUntilDue} ngày
              </StatusBadge>
            ) : null}
          </div>
        );
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (value: string) => (
        <StatusBadge tone={statusTone(value)}>{MAKEUP_STATUS_LABEL[value] ?? value}</StatusBadge>
      ),
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_, row) => {
        if (!canManage) return null;

        const items = [
          ...(row.status !== 'COMPLETED'
            ? [
                {
                  key: 'record',
                  label: 'Ghi nhận giờ bù',
                  icon: <Icon name="more_time" size={18} />,
                  // Quá hạn thì phải gia hạn trước — Backend từ chối với MKUP_OVERDUE.
                  disabled: row.isOverdue,
                },
                { key: 'extend', label: 'Gia hạn', icon: <Icon name="event_repeat" size={18} /> },
              ]
            : []),
          // Chỉ huỷ được khoản CHƯA bù giờ nào: giờ đã bù đã vào bảng công của
          // ngày làm bù, xoá đi là làm ngày đó tính lại ra số khác.
          ...(row.makeupMinutes === 0
            ? [
                { type: 'divider' as const },
                {
                  key: 'cancel',
                  label: 'Huỷ khoản nợ',
                  icon: <Icon name="delete" size={18} />,
                  danger: true,
                },
              ]
            : []),
        ];

        if (items.length === 0) return null;

        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === 'record') setRecordTarget(row);
                if (key === 'extend') setExtendTarget(row);
                if (key === 'cancel') setCancelTarget(row);
              },
            }}
          >
            <Button size="small" aria-label="Thao tác với khoản nợ công">
              <Icon name="more_horiz" size={18} />
            </Button>
          </Dropdown>
        );
      },
    },
  ];

  const activeFilters = ['status', 'departmentId', 'from', 'to', 'q'].filter((key) =>
    searchParams.get(key),
  ).length;

  return (
    <>
      <PageHeader
        title="Công làm bù"
        description="Giờ công còn thiếu và tiến độ làm bù. Giờ bù được cộng vào bảng công của đúng NGÀY LÀM BÙ, không phải ngày phát sinh nợ."
        actions={
          <Can do="makeup.manage">
            <Button
              type="primary"
              icon={<Icon name="add" size={20} />}
              onClick={() => setCreateOpen(true)}
            >
              Ghi nhận nợ công
            </Button>
          </Can>
        }
      />

      {summary.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : summary.data ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <StatCard
            label="Tổng giờ còn nợ"
            value={formatMinutes(summary.data.openDebtMinutes)}
            hint={`≈ ${formatStandardDays(summary.data.openDebtStandardDays)} công chuẩn`}
            icon="hourglass_bottom"
          />
          <StatCard
            label="Nhân viên đang nợ giờ"
            value={String(summary.data.employeesWithDebt)}
            hint={`${summary.data.openRecords} khoản chưa bù xong`}
            icon="group"
          />
          <StatCard
            label="Đã bù trong bộ lọc"
            value={formatMinutes(summary.data.madeUpMinutes)}
            hint={`≈ ${formatStandardDays(summary.data.madeUpStandardDays)} công chuẩn`}
            icon="task_alt"
          />
          <StatCard
            label="Khoản quá hạn"
            value={String(summary.data.overdueRecords)}
            hint={
              summary.data.overdueRecords > 0
                ? `${formatMinutes(summary.data.overdueMinutes)} không bù được nữa nếu không gia hạn`
                : 'Không có khoản nào quá hạn'
            }
            icon="warning"
            tone={summary.data.overdueRecords > 0 ? 'error' : undefined}
          />
        </div>
      ) : null}

      {conversion ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Quy đổi hiện tại: ${formatMinutes(conversion.minutesPerStandardDay)} = 1 công chuẩn`}
          description={
            <>
              Làm tròn{' '}
              {conversion.roundingMinutes > 0
                ? `theo bước ${conversion.roundingMinutes} phút (${roundingLabel(conversion.roundingMode)})`
                : 'tắt'}
              . Hạn làm bù {conversion.dueDays} ngày kể từ ngày phát sinh nợ. Giờ dư{' '}
              {conversion.carrySurplusToNextMonth ? 'cộng dồn sang tháng sau' : 'bị bỏ'}. Đổi các
              giá trị này ở Chính sách công ty.
            </>
          }
        />
      ) : null}

      <FilterBar activeCount={activeFilters} onClear={() => setSearchParams({}, { replace: true })}>
        <FilterField label="Trạng thái" htmlFor="mk-status" width={180}>
          <Select
            id="mk-status"
            value={query.status ?? ''}
            options={[
              { value: '', label: 'Tất cả' },
              ...Object.entries(MAKEUP_STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => patchQuery({ status: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="mk-dept" width={200}>
          <Select
            id="mk-dept"
            value={query.departmentId ?? ''}
            loading={departments.isLoading}
            options={toSelectOptions(departments.data, 'Tất cả phòng ban')}
            onChange={(value) => patchQuery({ departmentId: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Ngày phát sinh nợ" width={260}>
          <RangePicker
            format="DD/MM/YYYY"
            value={[toDayjs(query.from), toDayjs(query.to)]}
            onChange={(dates) =>
              patchQuery({
                from: toWorkDate(dates?.[0]?.toDate()),
                to: toWorkDate(dates?.[1]?.toDate()),
              })
            }
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Tìm nhân viên" htmlFor="mk-q" width={220}>
          <Input.Search
            id="mk-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên hoặc mã nhân viên"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      <DataTable<MakeupRecord>
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
        emptyIcon="hourglass_empty"
        emptyTitle="Không có khoản nợ công nào khớp bộ lọc"
        emptyDescription="Nợ công thường do engine tính công sinh ra khi nhân viên thiếu giờ so với ca. Bạn cũng ghi nhận tay được bằng nút Ghi nhận nợ công."
      />

      <CreateDebtModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <RecordMakeupModal record={recordTarget} onClose={() => setRecordTarget(null)} />

      <ExtendDialog
        record={extendTarget}
        loading={extend.isPending}
        onCancel={() => setExtendTarget(null)}
        onConfirm={async (dueDate, reason) => {
          if (!extendTarget) return;
          try {
            await extend.mutateAsync({ id: extendTarget.id, dueDate, reason });
            toast.success('Đã gia hạn làm bù');
            setExtendTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />

      <ReasonDialog
        open={Boolean(cancelTarget)}
        title="Huỷ khoản nợ công"
        description={
          cancelTarget
            ? `${cancelTarget.employee?.fullName ?? ''} · nợ ${formatMinutes(cancelTarget.debtMinutes)} ngày ${formatDay(cancelTarget.debtWorkDate, timezone)}`
            : undefined
        }
        warning="Khoản nợ bị xoá hẳn khỏi danh sách. Chỉ dùng khi ghi nhầm — nếu công ty quyết định miễn nợ cho nhân viên thì vẫn nên giữ bản ghi và ghi rõ lý do ở đây trước khi huỷ."
        confirmText="Huỷ khoản nợ"
        danger
        loading={cancel.isPending}
        onCancel={() => setCancelTarget(null)}
        onConfirm={async (reason) => {
          if (!cancelTarget) return;
          try {
            await cancel.mutateAsync({ id: cancelTarget.id, reason });
            toast.success('Đã huỷ khoản nợ công');
            setCancelTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </>
  );
}

/**
 * Gia hạn cần CẢ ngày mới lẫn lý do.
 *
 * Không dùng lại `ReasonDialog` được vì hộp thoại đó chỉ nhận đúng một ô lý do —
 * thêm khe cắm nội dung vào nó để phục vụ một màn hình sẽ làm mọi màn hình khác
 * phải chịu một API rộng hơn nhu cầu của chúng.
 */
function ExtendDialog({
  record,
  loading,
  onCancel,
  onConfirm,
}: {
  record: MakeupRecord | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (dueDate: string, reason: string) => void;
}) {
  const { timezone } = useAuth();
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  const tooShort = reason.trim().length < REASON_MIN_LENGTH;

  function close() {
    setDueDate(undefined);
    setReason('');
    onCancel();
  }

  return (
    <Modal
      open={Boolean(record)}
      title="Gia hạn làm bù"
      okText="Gia hạn"
      cancelText="Huỷ bỏ"
      okButtonProps={{ size: 'large', loading, disabled: !dueDate || tooShort }}
      cancelButtonProps={{ size: 'large' }}
      onCancel={close}
      onOk={() => dueDate && onConfirm(dueDate, reason.trim())}
      destroyOnClose
      width={520}
      afterOpenChange={(open) => {
        if (open) {
          setDueDate(record?.dueDate ?? undefined);
          setReason('');
        }
      }}
    >
      {record ? (
        <p className="sf-body-md" style={{ marginTop: 0 }}>
          {record.employee?.fullName} · hạn hiện tại{' '}
          {record.dueDate ? formatDay(record.dueDate, timezone) : 'không có'} · còn nợ{' '}
          {formatMinutes(record.remainingMinutes)}
        </p>
      ) : null}

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="Gia hạn là ngoại lệ có kiểm soát"
        description="Khoản nợ để càng lâu thì bảng công của các kỳ đã chốt càng lệch xa thực tế. Lý do được ghi vào nhật ký kiểm toán."
      />

      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label
            className="sf-field__label"
            htmlFor="mk-due"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Hạn làm bù mới <span style={{ color: 'var(--sf-error-600)' }}>*</span>
          </label>
          <DatePicker
            id="mk-due"
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(dueDate)}
            onChange={(date) => setDueDate(toWorkDate(date?.toDate()))}
          />
        </div>

        <div>
          <label
            className="sf-field__label"
            htmlFor="mk-extend-reason"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Lý do (bắt buộc)
          </label>
          <Input.TextArea
            id="mk-extend-reason"
            rows={3}
            maxLength={1000}
            showCount
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={`Mô tả lý do, tối thiểu ${REASON_MIN_LENGTH} ký tự`}
          />
        </div>
      </div>
    </Modal>
  );
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'PARTIAL':
      return 'teal';
    case 'EXPIRED':
      return 'error';
    default:
      return 'warning';
  }
}

function roundingLabel(mode: string): string {
  switch (mode) {
    case 'DOWN':
      return 'làm tròn xuống';
    case 'UP':
      return 'làm tròn lên';
    default:
      return 'về giá trị gần nhất';
  }
}
