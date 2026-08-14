import { Button, Drawer, Steps } from 'antd';
import { DetailField, DetailGrid, DetailSection } from '@/components/DetailField';
import { StatusBadge, requestStatusTone } from '@/components/StatusBadge';
import { EmployeeCell } from '@/components/EmployeeCell';
import { CardSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/lib/auth/auth-context';
import { useCan } from '@/lib/rbac/Can';
import { formatDateTime, formatRelativeDay } from '@/lib/utils/date';
import { formatFileSize } from '@/lib/utils/format';
import { REQUEST_STATUS_LABEL } from '@/config/constants';
import { useApproveRequest, useRequestDetail, type LeaveRequest } from './requests.api';
import { ApiErrorState } from '@/components/ApiErrorState';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Chi tiết một đơn — docs/04 mục 4 (`FR-WEB-REQ-06`, `FR-WEB-REQ-07`).
 *
 * Phần quan trọng nhất là dòng thời gian duyệt: ai đã duyệt, còn chờ ai, ai từ
 * chối và vì sao. Thiếu nó thì mọi câu hỏi "đơn tôi đang nằm ở đâu" đều phải đi
 * hỏi người khác — và đó là lý do phổ biến nhất khiến người ta gọi điện cho HR.
 */
export function RequestDetailDrawer({
  requestId,
  onClose,
  onReject,
}: {
  requestId: string | null;
  onClose: () => void;
  onReject: (request: LeaveRequest) => void;
}) {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canApprove = useCan('request.approve');
  const detail = useRequestDetail(requestId);
  const approve = useApproveRequest();

  const request = detail.data;

  return (
    <Drawer
      open={Boolean(requestId)}
      onClose={onClose}
      width={640}
      destroyOnClose
      title={
        <div>
          <div className="sf-title-md">{request?.requestType?.name ?? 'Chi tiết đơn'}</div>
          {request ? (
            <div className="sf-body-sm sf-text-variant">
              Gửi {formatRelativeDay(request.submittedAt ?? request.createdAt, timezone)}
            </div>
          ) : null}
        </div>
      }
      extra={
        request?.status === 'PENDING' && canApprove ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <Button danger onClick={() => onReject(request)}>
              Từ chối
            </Button>
            <Button
              type="primary"
              loading={approve.isPending}
              onClick={async () => {
                try {
                  await approve.mutateAsync({ id: request.id });
                  toast.success('Đã duyệt đơn');
                  onClose();
                } catch (caught) {
                  showError(caught);
                }
              }}
            >
              Duyệt đơn
            </Button>
          </div>
        ) : null
      }
      styles={{ body: { padding: 24, display: 'flex', flexDirection: 'column', gap: 24 } }}
    >
      {detail.isLoading ? (
        <CardSkeleton height={320} />
      ) : detail.error ? (
        <ApiErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !request ? null : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <EmployeeCell employee={request.employee} />
            <StatusBadge tone={requestStatusTone(request.status)}>
              {REQUEST_STATUS_LABEL[request.status] ?? request.status}
            </StatusBadge>
          </div>

          <DetailSection title="Nội dung đơn">
            <DetailGrid>
              <DetailField label="Từ">{formatDateTime(request.startAt, timezone)}</DetailField>
              <DetailField label="Đến">{formatDateTime(request.endAt, timezone)}</DetailField>
              <DetailField label="Số lượng">
                {String(request.quantity)}{' '}
                {request.requestType?.unit === 'HOUR' ? 'giờ' : 'ngày'}
                {request.isHalfDay ? ' (nửa ngày)' : ''}
              </DetailField>
              <DetailField label="Trừ vào">
                {request.requestType?.deductFrom === 'ANNUAL_LEAVE'
                  ? 'Phép năm'
                  : request.requestType?.deductFrom === 'UNPAID'
                    ? 'Nghỉ không lương'
                    : request.requestType?.deductFrom === 'NONE'
                      ? 'Không trừ'
                      : (request.requestType?.deductFrom ?? '—')}
              </DetailField>
              {request.expectedReturnAt ? (
                <DetailField label="Giờ về dự kiến">
                  {formatDateTime(request.expectedReturnAt, timezone)}
                </DetailField>
              ) : null}
            </DetailGrid>

            <div>
              <span className="sf-label-md">Lý do</span>
              <p
                className="sf-body-md"
                style={{
                  margin: '4px 0 0',
                  padding: 12,
                  background: 'var(--sf-neutral-100)',
                  borderRadius: 12,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {request.reason}
              </p>
            </div>
          </DetailSection>

          {/* FR-WEB-REQ-07 — file đính kèm minh chứng. */}
          {request.attachments && request.attachments.length > 0 ? (
            <DetailSection title="Minh chứng đính kèm">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {request.attachments.map((file) => (
                  <li key={file.id}>
                    <a
                      href={file.url ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: 12,
                        border: '1px solid var(--sf-outline-variant)',
                        borderRadius: 12,
                        textDecoration: 'none',
                      }}
                    >
                      <Icon name="attach_file" size={20} />
                      <span className="sf-body-md" style={{ flex: 1 }}>
                        {file.fileName}
                      </span>
                      {file.sizeBytes ? (
                        <span className="sf-caption">{formatFileSize(file.sizeBytes)}</span>
                      ) : null}
                      <Icon name="open_in_new" size={16} />
                    </a>
                  </li>
                ))}
              </ul>
            </DetailSection>
          ) : null}

          {/* FR-WEB-REQ-06 — audit trail của luồng duyệt. */}
          <DetailSection title="Luồng duyệt">
            {request.approvalSteps && request.approvalSteps.length > 0 ? (
              <Steps
                direction="vertical"
                size="small"
                items={request.approvalSteps
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((step) => ({
                    title: step.approverName ?? step.approverRole ?? `Cấp ${step.order}`,
                    status:
                      step.status === 'APPROVED'
                        ? 'finish'
                        : step.status === 'REJECTED'
                          ? 'error'
                          : step.status === 'SKIPPED'
                            ? 'wait'
                            : 'process',
                    description: (
                      <div className="sf-body-sm sf-text-variant">
                        {step.status === 'PENDING'
                          ? 'Đang chờ xử lý'
                          : step.status === 'SKIPPED'
                            ? 'Không cần xử lý'
                            : `${step.status === 'APPROVED' ? 'Đã duyệt' : 'Đã từ chối'} · ${formatDateTime(step.decidedAt, timezone)}`}
                        {step.comment ? <div>Ghi chú: {step.comment}</div> : null}
                      </div>
                    ),
                  }))}
              />
            ) : (
              <p className="sf-body-sm sf-text-variant">
                Đơn chưa được gửi đi nên chưa sinh bước duyệt nào.
              </p>
            )}

            {request.status === 'REJECTED' && request.rejectReason ? (
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: 'var(--sf-error-50)',
                  color: 'var(--sf-error-800)',
                }}
              >
                <span className="sf-label-md" style={{ color: 'inherit' }}>
                  Lý do từ chối
                </span>
                <p className="sf-body-md" style={{ margin: '4px 0 0' }}>
                  {request.rejectReason}
                </p>
              </div>
            ) : null}
          </DetailSection>
        </>
      )}
    </Drawer>
  );
}
