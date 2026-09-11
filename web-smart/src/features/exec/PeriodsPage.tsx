import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Badge, Button, EmptyState, ErrorState, useToast, type BadgeTone } from '@/components/ui';
import { useCan } from '@/lib/rbac/Can';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { formatDay } from '@/lib/utils/date';
import {
  useApproveLock,
  useApproveReopen,
  usePeriods,
  useRejectLock,
  useRequestReopen,
  useSubmitLock,
  type PayrollPeriod,
  type PayrollPeriodStatus,
} from './periods.api';

const STATUS_LABEL: Record<PayrollPeriodStatus, string> = {
  OPEN: 'Đang mở',
  CALCULATING: 'Đang tính',
  PENDING_APPROVAL: 'Chờ Giám đốc duyệt',
  LOCKED: 'Đã chốt',
  REOPENED: 'Đã mở lại',
};

const STATUS_TONE: Record<PayrollPeriodStatus, BadgeTone> = {
  OPEN: 'neutral',
  CALCULATING: 'teal',
  PENDING_APPROVAL: 'warning',
  LOCKED: 'success',
  REOPENED: 'warning',
};

type DialogKind = 'submit' | 'reject' | 'request-reopen' | 'approve-reopen' | null;

/**
 * Kỳ công — **một màn hình, hai vai trò**.
 *
 * ## Vì sao không tách thành hai trang
 *
 * Kế toán và Giám đốc nhìn cùng một danh sách kỳ và cùng một trạng thái; chỉ
 * NÚT là khác. Tách hai trang thì trạng thái phải đồng bộ ở hai nơi, và câu
 * "kỳ tháng 8 đang ở đâu" có hai câu trả lời tuỳ người hỏi.
 *
 * Đây cũng là chỗ ranh giới #1 của `docs/08` §1.1 hiện ra bằng mắt:
 *
 * | Trạng thái | Kế toán thấy | Giám đốc thấy |
 * |---|---|---|
 * | `OPEN` / `REOPENED` | **Gửi duyệt chốt** | (không có nút) |
 * | `PENDING_APPROVAL` | "Đang chờ Giám đốc" | **Duyệt chốt** · Từ chối |
 * | `LOCKED` | **Đề nghị mở lại** | **Duyệt mở lại** |
 *
 * Không vai trò nào thấy cả hai nút của cùng một bước. Backend cưỡng chế điều
 * đó bằng `period.submit_lock` và `period.approve_lock` — hai quyền không cùng
 * nằm trên một vai trò nào (`role-matrix.spec.ts`).
 *
 * ## Vì sao nút "Duyệt chốt" có thể vẫn báo lỗi
 *
 * Duyệt chốt cần xác thực lại danh tính (`BR-18`). Backend trả `STEPUP_REQUIRED`
 * khi thiếu, và giao diện hiện thông báo dẫn người dùng đi xác thực. Ẩn nút cho
 * tới khi có step-up thì tệ hơn: người dùng không biết mình cần làm gì.
 */
export function PeriodsPage() {
  const toast = useToast();
  const showError = useErrorToast();

  const canSubmit = useCan('period.submit_lock');
  const canApprove = useCan('period.approve_lock');
  const canRequestReopen = useCan('period.request_reopen');
  const canApproveReopen = useCan('period.approve_reopen');

  const periods = usePeriods();
  const submitLock = useSubmitLock();
  const rejectLock = useRejectLock();
  const approveLock = useApproveLock();
  const requestReopen = useRequestReopen();
  const approveReopen = useApproveReopen();

  const [dialog, setDialog] = useState<{ kind: DialogKind; period: PayrollPeriod | null }>({
    kind: null,
    period: null,
  });
  const close = () => setDialog({ kind: null, period: null });

  const open = (kind: Exclude<DialogKind, null>, period: PayrollPeriod) =>
    setDialog({ kind, period });

  const columns: ColumnsType<PayrollPeriod> = [
    {
      title: 'Kỳ công',
      key: 'name',
      render: (_, row) => (
        <div>
          <div className="sf-title-sm">{row.name}</div>
          <div className="sf-body-sm sf-text-muted">
            {formatDay(row.startDate)} → {formatDay(row.endDate)}
          </div>
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 200,
      render: (_, row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>,
    },
    {
      title: 'Phiên bản',
      key: 'version',
      width: 120,
      align: 'right',
      render: (_, row) => (
        // Mỗi lần gửi duyệt sinh một phiên bản mới và giữ nguyên phiên bản cũ.
        // Số này là thứ phải đi kèm mọi bản xuất (FR-WEB-PERIOD-05).
        <span title="Số lần đã tính và gửi duyệt">v{row.currentVersion}</span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 320,
      render: (_, row) => <PeriodActions period={row} />,
    },
  ];

  function PeriodActions({ period }: { period: PayrollPeriod }) {
    const submittable = period.status === 'OPEN' || period.status === 'REOPENED';

    if (submittable) {
      if (!canSubmit) {
        return (
          <span className="sf-body-sm sf-text-muted">
            Chờ Kế toán tính công và gửi duyệt
          </span>
        );
      }
      return (
        <Button variant="primary" size="sm" onClick={() => open('submit', period)}>
          Gửi duyệt chốt
        </Button>
      );
    }

    if (period.status === 'PENDING_APPROVAL') {
      if (!canApprove) {
        return <span className="sf-body-sm sf-text-muted">Đang chờ Giám đốc duyệt</span>;
      }
      return (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={() => open('reject', period)}
          >
            Từ chối
          </Button>
          <Button
            variant="action"
            size="sm"
            icon="lock"
            loading={approveLock.isPending}
            onClick={() =>
              approveLock.mutate(
                { id: period.id },
                {
                  onSuccess: () => toast.success(`Đã chốt kỳ ${period.name}`),
                  onError: showError,
                },
              )
            }
          >
            Duyệt chốt kỳ
          </Button>
        </div>
      );
    }

    if (period.status === 'LOCKED') {
      return (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {canRequestReopen ? (
            <Button variant="tertiary" size="sm" onClick={() => open('request-reopen', period)}>
              Đề nghị mở lại
            </Button>
          ) : null}
          {canApproveReopen ? (
            <Button variant="secondary" size="sm" onClick={() => open('approve-reopen', period)}>
              Duyệt mở lại
            </Button>
          ) : null}
          {!canRequestReopen && !canApproveReopen ? (
            <span className="sf-body-sm sf-text-muted">Kỳ đã chốt</span>
          ) : null}
        </div>
      );
    }

    return <span className="sf-body-sm sf-text-muted">Đang tính công…</span>;
  }

  if (periods.isError) {
    return (
      <ErrorState
        description="Không đọc được danh sách kỳ công từ máy chủ."
        onRetry={() => void periods.refetch()}
      />
    );
  }

  const items = periods.data?.items ?? [];
  const awaiting = items.filter((row) => row.status === 'PENDING_APPROVAL').length;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Kỳ công"
        description="Kế toán gửi đề nghị chốt, Giám đốc duyệt. Một người không làm cả hai bước."
      />

      {awaiting > 0 && canApprove ? (
        <Alert
          type="warning"
          showIcon
          message={`${awaiting} kỳ đang chờ bạn duyệt chốt`}
          description="Kỳ chưa chốt thì Kế toán vẫn sửa được số liệu, và bảng lương chưa có căn cứ cuối cùng."
        />
      ) : null}

      <Table
        rowKey="id"
        size="small"
        loading={periods.isPending}
        dataSource={items}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <EmptyState
              icon="calendar_month"
              title="Chưa có kỳ công nào"
              description="Kế toán tạo kỳ công đầu tiên từ màn hình Bảng công."
            />
          ),
        }}
      />

      <ReasonDialog
        open={dialog.kind === 'submit'}
        title="Gửi đề nghị chốt kỳ"
        description="Hệ thống tính lại toàn bộ số liệu, tạo một phiên bản mới của kỳ và chuyển sang chờ Giám đốc duyệt. Bạn vẫn xem được nhưng không sửa được số liệu cho tới khi Giám đốc quyết định."
        confirmText="Gửi duyệt"
        requireReason={false}
        loading={submitLock.isPending}
        onCancel={close}
        onConfirm={(note) => {
          if (!dialog.period) return;
          submitLock.mutate(
            { id: dialog.period.id, note: note || undefined },
            {
              onSuccess: () => {
                toast.success('Đã gửi đề nghị chốt kỳ', 'Giám đốc đã nhận được thông báo.');
                close();
              },
              onError: showError,
            },
          );
        }}
      />

      <ReasonDialog
        open={dialog.kind === 'reject'}
        title="Từ chối đề nghị chốt"
        description="Kỳ quay về trạng thái đang mở để Kế toán sửa lại số liệu. Lý do được gửi cho họ."
        confirmText="Từ chối"
        danger
        loading={rejectLock.isPending}
        onCancel={close}
        onConfirm={(reason) => {
          if (!dialog.period) return;
          rejectLock.mutate(
            { id: dialog.period.id, reason },
            {
              onSuccess: () => {
                toast.success('Đã trả kỳ về cho Kế toán');
                close();
              },
              onError: showError,
            },
          );
        }}
      />

      <ReasonDialog
        open={dialog.kind === 'request-reopen'}
        title="Đề nghị mở lại kỳ đã chốt"
        description="Thao tác này KHÔNG mở kỳ — nó chỉ báo cho Giám đốc. Việc mở thật do Giám đốc quyết định và cần xác thực lại danh tính."
        warning="Mở lại kỳ đã chốt làm số liệu đã báo cáo thay đổi. Nêu rõ vì sao cần mở."
        confirmText="Gửi đề nghị"
        loading={requestReopen.isPending}
        onCancel={close}
        onConfirm={(reason) => {
          if (!dialog.period) return;
          requestReopen.mutate(
            { id: dialog.period.id, reason },
            {
              onSuccess: () => {
                toast.success('Đã gửi đề nghị mở lại kỳ');
                close();
              },
              onError: showError,
            },
          );
        }}
      />

      <ReasonDialog
        open={dialog.kind === 'approve-reopen'}
        title="Duyệt mở lại kỳ đã chốt"
        description="Kỳ chuyển sang trạng thái đã mở lại và Kế toán sửa được số liệu trở lại."
        warning="Số liệu đã chốt của kỳ này có thể đã dùng để trả lương. Mở lại là thay đổi một con số đã công bố — lý do sẽ nằm vĩnh viễn trong nhật ký kiểm toán."
        confirmText="Duyệt mở lại"
        danger
        loading={approveReopen.isPending}
        onCancel={close}
        onConfirm={(reason) => {
          if (!dialog.period) return;
          approveReopen.mutate(
            { id: dialog.period.id, reason },
            {
              onSuccess: () => {
                toast.success('Đã mở lại kỳ công');
                close();
              },
              onError: showError,
            },
          );
        }}
      />
    </div>
  );
}
