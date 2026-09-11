import { useState } from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { EmployeeCell } from '@/components/EmployeeCell';
import { ReasonDialog } from '@/components/ReasonDialog';
import {
  Badge,
  BulkAction,
  BulkActionBar,
  Button,
  EmptyState,
  ErrorState,
  requestStatusTone,
  useToast,
} from '@/components/ui';
import { Can, useCan } from '@/lib/rbac/Can';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { formatDay } from '@/lib/utils/date';
import {
  useApproveRequest,
  useBulkApprove,
  usePendingApprovals,
  useRejectRequest,
  useRequestMoreInfo,
  type LeaveRequest,
} from '@/features/requests/requests.api';

type DialogKind = 'reject' | 'more-info' | null;

/**
 * Trung tâm phê duyệt của Giám đốc (`FR-GDW-APV`, mockup Figma `63:67`).
 *
 * ## Vì sao là một màn hình riêng chứ không phải bộ lọc của "Đơn từ"
 *
 * Kế toán mở danh sách đơn để **tra cứu**: ai nghỉ ngày nào, còn bao nhiêu phép.
 * Giám đốc mở nó để **xử lý hết hàng chờ** rồi đóng lại. Hai ý định khác nhau
 * cần hai mặc định khác nhau — màn này chỉ có đơn đang chờ CHÍNH NGƯỜI NÀY
 * duyệt, mở ra là làm được ngay, không phải lọc trước.
 *
 * `GET /requests/pending-approval` không bao giờ trả đơn của chính người gọi
 * (`BR-APV-03`), nên hàng chờ ở đây đã sạch quy tắc không-tự-duyệt.
 *
 * ## Ba nút, không phải hai
 *
 * "Yêu cầu bổ sung" đứng giữa Duyệt và Từ chối. Thiếu nút đó thì một đơn thiếu
 * giấy khám bệnh chỉ còn cách bị từ chối, nhân viên phải nộp lại từ đầu, và tỉ
 * lệ từ chối trong báo cáo lẫn cả những đơn thực ra chỉ thiếu giấy tờ.
 */
export function ExecApprovalsPage() {
  const toast = useToast();
  const showError = useErrorToast();
  const canApprove = useCan('request.approve');

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ kind: DialogKind; request: LeaveRequest | null }>({
    kind: null,
    request: null,
  });

  const pending = usePendingApprovals({ page, pageSize: 20 });
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const moreInfo = useRequestMoreInfo();
  const bulkApprove = useBulkApprove();

  const closeDialog = () => setDialog({ kind: null, request: null });

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Loại đơn',
      key: 'type',
      width: 160,
      render: (_, row) => row.requestType?.name ?? '—',
    },
    {
      title: 'Thời gian',
      key: 'range',
      width: 220,
      render: (_, row) => (
        <div>
          <div>
            {formatDay(row.startAt)} → {formatDay(row.endAt)}
          </div>
          <div className="sf-body-sm sf-text-muted">
            {row.quantity} {row.isHalfDay ? 'buổi' : 'ngày'}
          </div>
        </div>
      ),
    },
    { title: 'Lý do', dataIndex: 'reason', key: 'reason' },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 140,
      render: (_, row) => <Badge tone={requestStatusTone(row.status)}>{row.status}</Badge>,
    },
    {
      title: '',
      key: 'actions',
      width: 300,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={() => setDialog({ kind: 'reject', request: row })}
          >
            Từ chối
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon="help"
            onClick={() => setDialog({ kind: 'more-info', request: row })}
          >
            Yêu cầu bổ sung
          </Button>
          {/*
            Nút xác nhận xanh lá — biến thể `action`, không phải `primary`.
            Đây đúng là thao tác chốt một quy trình, và mỗi dòng chỉ có MỘT nút
            như vậy.
          */}
          <Button
            variant="action"
            size="sm"
            icon="check"
            loading={approve.isPending}
            onClick={() =>
              approve.mutate(
                { id: row.id },
                {
                  onSuccess: () => toast.success('Đã duyệt đơn'),
                  onError: showError,
                },
              )
            }
          >
            Phê duyệt
          </Button>
        </div>
      ),
    },
  ];

  if (pending.isError) {
    return (
      <ErrorState
        description="Không đọc được hàng chờ phê duyệt từ máy chủ."
        onRetry={() => void pending.refetch()}
      />
    );
  }

  const items = pending.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Đơn cần duyệt"
        description={
          items.length > 0
            ? `${pending.data?.meta.total ?? items.length} đơn đang chờ quyết định của bạn.`
            : 'Hàng chờ phê duyệt của bạn.'
        }
      />

      <Can
        do="request.approve"
        fallback={
          <EmptyState
            icon="lock"
            title="Bạn không có quyền duyệt đơn"
            description="Chức năng này thuộc về Quản lý trực tiếp và Giám đốc. Liên hệ người quản trị công ty nếu bạn cho rằng đây là nhầm lẫn."
          />
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={pending.isPending}
          dataSource={items}
          columns={columns}
          scroll={{ x: 'max-content' }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[]),
          }}
          pagination={{
            current: page,
            pageSize: 20,
            total: pending.data?.meta.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{
            emptyText: (
              <EmptyState
                icon="task_alt"
                title="Không còn đơn nào chờ bạn"
                description="Mọi đơn thuộc thẩm quyền của bạn đã được xử lý."
              />
            ),
          }}
        />
      </Can>

      {/*
        Chỉ có duyệt hàng loạt, KHÔNG có từ chối hàng loạt: từ chối cần lý do
        riêng cho từng đơn, gộp lại thì tất cả cùng nhận một lý do chung vô nghĩa.
      */}
      <BulkActionBar
        count={canApprove ? selected.length : 0}
        itemNoun="đơn"
        onClear={() => setSelected([])}
      >
        <BulkAction
          disabled={bulkApprove.isPending}
          onClick={() =>
            bulkApprove.mutate(
              { requestIds: selected },
              {
                onSuccess: (result) => {
                  setSelected([]);
                  if (result.failed.length === 0) {
                    toast.success(`Đã duyệt ${result.approved.length} đơn`);
                  } else {
                    // Không fail cả lô (BR-APV-05) — nên phải nói rõ cả hai phần,
                    // không thể báo "thành công" cho một lô có đơn hỏng.
                    toast.warning(
                      `Duyệt được ${result.approved.length} đơn, ${result.failed.length} đơn không duyệt được`,
                      result.failed.map((item) => item.message).join(' · '),
                    );
                  }
                },
                onError: showError,
              },
            )
          }
        >
          Phê duyệt {selected.length} đơn
        </BulkAction>
      </BulkActionBar>

      <ReasonDialog
        open={dialog.kind === 'reject'}
        title="Từ chối đơn"
        description="Lý do được gửi tới nhân viên. Nếu đơn chỉ thiếu giấy tờ, hãy dùng 'Yêu cầu bổ sung' thay vì từ chối."
        confirmText="Từ chối đơn"
        danger
        loading={reject.isPending}
        onCancel={closeDialog}
        onConfirm={(reason) => {
          if (!dialog.request) return;
          reject.mutate(
            { id: dialog.request.id, reason },
            {
              onSuccess: () => {
                toast.success('Đã từ chối đơn');
                closeDialog();
              },
              onError: showError,
            },
          );
        }}
      />

      <ReasonDialog
        open={dialog.kind === 'more-info'}
        title="Yêu cầu bổ sung thông tin"
        description="Đơn quay về trạng thái chờ bổ sung và vẫn giữ nguyên bước duyệt hiện tại. Bổ sung xong, đơn trở lại đúng chỗ này chứ không chạy lại từ đầu. Ví dụ: bổ sung giấy khám bệnh có dấu của cơ sở y tế."
        confirmText="Gửi yêu cầu"
        loading={moreInfo.isPending}
        onCancel={closeDialog}
        onConfirm={(question) => {
          if (!dialog.request) return;
          moreInfo.mutate(
            { id: dialog.request.id, question },
            {
              onSuccess: () => {
                toast.success('Đã gửi yêu cầu bổ sung');
                closeDialog();
              },
              onError: showError,
            },
          );
        }}
      />
    </div>
  );
}
