import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, DatePicker, Modal, Select, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatusBadge, requestStatusTone } from '@/components/StatusBadge';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/lib/auth/auth-context';
import { useCan } from '@/lib/rbac/Can';
import { REQUEST_STATUS_LABEL, DEFAULT_PAGE_SIZE } from '@/config/constants';
import { formatDateTime, formatDay, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import {
  useApproveRequest,
  useBulkApprove,
  usePendingApprovals,
  useRejectRequest,
  useRequestList,
  useRequestTypes,
  type LeaveRequest,
  type RequestQuery,
} from './requests.api';
import { RequestDetailDrawer } from './RequestDetailDrawer';
import { CreateRequestOnBehalfModal } from './CreateRequestOnBehalfModal';
import { Can } from '@/lib/rbac/Can';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

const { RangePicker } = DatePicker;

/**
 * Quản lý & duyệt đơn từ — docs/04 mục 4 (`FR-WEB-REQ-01..08`).
 *
 * Hai tab, hai ý nghĩa khác nhau:
 *   "Chờ tôi duyệt" — việc cần làm hôm nay, mở lên là thấy ngay
 *   "Tất cả đơn"    — tra cứu, đối soát
 *
 * Tab đầu là mặc định vì đó là lý do người dùng vào màn hình này.
 */
export function RequestListPage() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canApprove = useCan('request.approve');
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = searchParams.get('tab') ?? (canApprove ? 'pending' : 'all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    approved: number;
    failed: { requestId: string; message: string }[];
  } | null>(null);

  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const bulkApprove = useBulkApprove();

  const requestTypes = useRequestTypes();

  const query: RequestQuery = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
      status: searchParams.get('status') ?? undefined,
      requestTypeCode: searchParams.get('type') ?? undefined,
      departmentId: searchParams.get('departmentId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
    }),
    [searchParams],
  );

  const pendingList = usePendingApprovals({ page: query.page, pageSize: query.pageSize });
  const allList = useRequestList(query);
  const active = tab === 'pending' ? pendingList : allList;

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  async function approveOne(request: LeaveRequest) {
    try {
      await approve.mutateAsync({ id: request.id });
      toast.success(`Đã duyệt đơn của ${request.employee?.fullName ?? 'nhân viên'}`);
    } catch (caught) {
      showError(caught);
    }
  }

  async function runBulkApprove() {
    try {
      const result = await bulkApprove.mutateAsync({ requestIds: selectedIds });
      setSelectedIds([]);

      if (result.failedCount === 0) {
        toast.success(`Đã duyệt ${result.approvedCount} đơn`);
      } else {
        // Không gộp thành một dòng "duyệt xong": người dùng phải biết đơn nào
        // bị bỏ lại và vì sao, nếu không họ tưởng cả lô đã xong (BR-APV-05).
        setBulkResult({
          approved: result.approvedCount,
          failed: result.failed.map((item) => ({
            requestId: item.requestId,
            message: item.message,
          })),
        });
      }
    } catch (caught) {
      showError(caught);
    }
  }

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      fixed: 'left',
      width: 240,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Loại đơn',
      key: 'type',
      width: 160,
      render: (_, row) => row.requestType?.name ?? '—',
    },
    {
      title: 'Thời gian nghỉ',
      key: 'range',
      width: 220,
      render: (_, row) => (
        <div>
          <div className="sf-body-sm">{formatDateTime(row.startAt, timezone)}</div>
          <div className="sf-body-sm sf-text-variant">
            đến {formatDateTime(row.endAt, timezone)}
          </div>
        </div>
      ),
    },
    {
      title: 'Số lượng',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 110,
      align: 'right',
      render: (value: string | number, row) =>
        `${value} ${row.requestType?.unit === 'HOUR' ? 'giờ' : 'ngày'}`,
    },
    {
      title: 'Lý do',
      dataIndex: 'reason',
      key: 'reason',
      width: 240,
      ellipsis: true,
    },
    {
      title: 'Gửi lúc',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 150,
      render: (value: string | null) => formatDateTime(value, timezone),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (value: string) => (
        <StatusBadge tone={requestStatusTone(value)}>
          {REQUEST_STATUS_LABEL[value] ?? value}
        </StatusBadge>
      ),
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" onClick={() => setDetailId(row.id)}>
            Chi tiết
          </Button>
          {canApprove && row.status === 'PENDING' ? (
            <>
              <Button
                size="small"
                type="primary"
                loading={approve.isPending}
                onClick={() => void approveOne(row)}
              >
                Duyệt
              </Button>
              <Button size="small" danger type="text" onClick={() => setRejectTarget(row)}>
                Từ chối
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const activeFilters = ['status', 'type', 'departmentId', 'from', 'to'].filter((key) =>
    searchParams.get(key),
  ).length;

  return (
    <>
      <PageHeader
        title="Đơn từ"
        description="Duyệt đơn nghỉ phép, xin ra ngoài, bổ sung công. Đơn được duyệt sẽ tự động kích hoạt tính lại công cho khoảng thời gian liên quan."
        actions={
          <Can do="request.create_on_behalf">
            <Button
              type="primary"
              icon={<Icon name="post_add" size={20} />}
              onClick={() => setCreateOpen(true)}
            >
              Tạo đơn hộ
            </Button>
          </Can>
        }
      />

      <Tabs
        activeKey={tab}
        onChange={(key) => patchQuery({ tab: key, page: undefined })}
        items={[
          {
            key: 'pending',
            label: (
              <span>
                Chờ tôi duyệt
                {pendingList.data?.meta.total ? ` (${pendingList.data.meta.total})` : ''}
              </span>
            ),
          },
          { key: 'all', label: 'Tất cả đơn' },
        ]}
      />

      {tab === 'all' ? (
        <FilterBar
          activeCount={activeFilters}
          onClear={() => setSearchParams({ tab: 'all' }, { replace: true })}
        >
          <FilterField label="Trạng thái" htmlFor="r-status" width={170}>
            <Select
              id="r-status"
              value={query.status ?? ''}
              options={[
                { value: '', label: 'Tất cả' },
                ...Object.entries(REQUEST_STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ]}
              onChange={(value) => patchQuery({ status: value })}
              style={{ width: '100%' }}
            />
          </FilterField>

          <FilterField label="Loại đơn" htmlFor="r-type" width={200}>
            <Select
              id="r-type"
              value={query.requestTypeCode ?? ''}
              loading={requestTypes.isLoading}
              options={[
                { value: '', label: 'Tất cả loại đơn' },
                ...(requestTypes.data ?? []).map((type) => ({
                  value: type.code,
                  label: type.name,
                })),
              ]}
              onChange={(value) => patchQuery({ type: value })}
              style={{ width: '100%' }}
            />
          </FilterField>

          <FilterField label="Phòng ban" htmlFor="r-dept" width={200}>
            <DepartmentTreeSelect
              id="r-dept"
              value={query.departmentId}
              onChange={(value) => patchQuery({ departmentId: value })}
              placeholder="Tất cả phòng ban"
            />
          </FilterField>

          <FilterField label="Khoảng ngày" width={260}>
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
        </FilterBar>
      ) : null}

      <DataTable<LeaveRequest>
        rowKey="id"
        data={active.data?.items}
        meta={active.data?.meta}
        isLoading={active.isLoading}
        error={active.error}
        onRetry={() => void active.refetch()}
        onPageChange={(page, pageSize) =>
          patchQuery({ page: String(page), pageSize: String(pageSize) })
        }
        columns={columns}
        emptyIcon={tab === 'pending' ? 'task_alt' : 'assignment'}
        emptyTitle={
          tab === 'pending' ? 'Không còn đơn nào chờ bạn duyệt' : 'Không có đơn nào khớp bộ lọc'
        }
        emptyDescription={
          tab === 'pending'
            ? 'Mọi đơn thuộc phạm vi duyệt của bạn đã được xử lý. Đơn mới sẽ xuất hiện ở đây kèm thông báo.'
            : 'Thử bỏ bớt bộ lọc hoặc mở rộng khoảng ngày để xem thêm đơn.'
        }
        rowSelection={
          canApprove && tab === 'pending'
            ? {
                selectedRowKeys: selectedIds,
                onChange: (keys) => setSelectedIds(keys as string[]),
                getCheckboxProps: (row) => ({ disabled: row.status !== 'PENDING' }),
              }
            : undefined
        }
      />

      {/* ── Bulk action bar — docs/16 mục 11.17 ───────────────────────── */}
      {selectedIds.length > 0 ? (
        <div className="sf-bulk-bar sf-on-dark" aria-live="polite">
          <span className="sf-body-md">Đã chọn {selectedIds.length} đơn</span>
          <span className="sf-bulk-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => void runBulkApprove()}
            disabled={bulkApprove.isPending}
            style={{
              background: 'none',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.7px',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {bulkApprove.isPending ? 'Đang duyệt...' : 'Duyệt tất cả'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Bỏ chọn
          </button>
        </div>
      ) : null}

      <RequestDetailDrawer
        requestId={detailId}
        onClose={() => setDetailId(null)}
        onReject={(request) => {
          setDetailId(null);
          setRejectTarget(request);
        }}
      />

      {/* FR-WEB-REQ-04: bắt buộc nhập lý do khi từ chối. */}
      <ReasonDialog
        open={Boolean(rejectTarget)}
        title="Từ chối đơn"
        description={
          rejectTarget
            ? `Đơn ${rejectTarget.requestType?.name ?? ''} của ${rejectTarget.employee?.fullName ?? 'nhân viên'}, từ ${formatDay(rejectTarget.startAt, timezone)}.`
            : undefined
        }
        warning="Nhân viên sẽ nhận được lý do này qua thông báo. Các cấp duyệt sau sẽ không cần xử lý nữa."
        confirmText="Từ chối đơn"
        danger
        loading={reject.isPending}
        onCancel={() => setRejectTarget(null)}
        onConfirm={async (reason) => {
          if (!rejectTarget) return;
          try {
            await reject.mutateAsync({ id: rejectTarget.id, reason });
            toast.success('Đã từ chối đơn và gửi thông báo tới nhân viên');
            setRejectTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />

      {/* Kết quả duyệt hàng loạt khi có đơn bị bỏ lại. */}
      <Modal
        open={Boolean(bulkResult)}
        onCancel={() => setBulkResult(null)}
        onOk={() => setBulkResult(null)}
        title="Kết quả duyệt hàng loạt"
        okText="Đã hiểu"
        cancelButtonProps={{ style: { display: 'none' } }}
        width={560}
      >
        {bulkResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--sf-success-800)',
              }}
            >
              <Icon name="check_circle" size={20} fill />
              <span className="sf-body-md">Đã duyệt {bulkResult.approved} đơn</span>
            </div>

            <div>
              <div
                className="sf-body-md"
                style={{ color: 'var(--sf-error-700)', fontWeight: 600, marginBottom: 8 }}
              >
                {bulkResult.failed.length} đơn không duyệt được
              </div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {bulkResult.failed.map((item) => (
                  <li key={item.requestId} className="sf-body-sm">
                    {item.message}
                  </li>
                ))}
              </ul>
              <p className="sf-body-sm sf-text-variant" style={{ marginTop: 8, marginBottom: 0 }}>
                Các đơn này vẫn ở trạng thái chờ duyệt. Mở từng đơn để xem chi tiết ràng buộc bị vi
                phạm.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      <CreateRequestOnBehalfModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
