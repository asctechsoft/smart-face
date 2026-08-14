import { useEffect, useState } from 'react';
import { Alert, Checkbox, Collapse, Input, Modal, Tag } from 'antd';
import { CardSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDateTime, formatDay } from '@/lib/utils/date';
import { REASON_MIN_LENGTH, FRAUD_CODE_LABEL } from '@/config/constants';
import { usePreCloseReport, type PayrollPeriod } from './payroll.api';
import { ApiErrorState } from '@/components/ApiErrorState';

/**
 * Báo cáo tiền chốt — docs/04 mục 7.2 bước 3.
 *
 * Tài liệu nói thẳng: "Bắt buộc: bước 3 không được bỏ qua. Chốt kỳ khi còn đơn
 * chờ duyệt là nguyên nhân khiếu nại lương phổ biến nhất."
 *
 * Vì vậy giao diện không có đường tắt. Còn vấn đề tồn đọng thì nút Chốt bị khoá
 * cho tới khi kế toán tích ô "tôi đã cân nhắc và chấp nhận bỏ qua" — lúc đó
 * `force: true` được gửi lên và lý do đi thẳng vào nhật ký kiểm toán. Đây là
 * khác biệt giữa "hệ thống ngăn tôi làm sai" và "hệ thống ghi lại rằng tôi đã
 * chọn làm vậy".
 */
export function PreCloseReportModal({
  open,
  period,
  onClose,
  onConfirm,
  closing,
}: {
  open: boolean;
  period: PayrollPeriod | null;
  onClose: () => void;
  onConfirm: (reason: string, force: boolean) => void | Promise<void>;
  closing: boolean;
}) {
  const { timezone } = useAuth();
  const report = usePreCloseReport(open ? (period?.id ?? null) : null);

  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setAcknowledged(false);
    }
  }, [open]);

  const blockers = report.data?.blockerCount ?? 0;
  const hasBlockers = blockers > 0;
  const reasonOk = reason.trim().length >= REASON_MIN_LENGTH;
  const canClose = reasonOk && (!hasBlockers || acknowledged);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={() => void onConfirm(reason.trim(), hasBlockers)}
      title={`Chốt kỳ · ${period?.name ?? ''}`}
      okText="Chốt kỳ lương"
      cancelText="Để sau"
      okButtonProps={{ disabled: !canClose, loading: closing, danger: hasBlockers, size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
      width={720}
      destroyOnClose
    >
      {report.isLoading ? (
        <CardSkeleton height={280} />
      ) : report.error ? (
        <ApiErrorState
          error={report.error}
          title="Không đọc được báo cáo tiền chốt"
          onRetry={() => void report.refetch()}
          fallbackDescription="Chưa dựng được báo cáo tiền chốt cho kỳ này. Không có báo cáo thì không nên chốt kỳ."
        />
      ) : report.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {hasBlockers ? (
            <Alert
              type="warning"
              showIcon
              message={`Còn ${blockers} vấn đề chưa xử lý trong kỳ này`}
              description="Chốt kỳ khi còn tồn đọng là nguyên nhân khiếu nại lương phổ biến nhất. Xử lý hết rồi quay lại, hoặc xác nhận bỏ qua ở cuối hộp thoại."
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message="Không còn vấn đề tồn đọng"
              description="Mọi bản ghi đã đầy đủ, đơn từ đã xử lý và cờ nghi vấn đã được rà soát."
            />
          )}

          <Collapse
            defaultActiveKey={hasBlockers ? ['missing', 'requests', 'flags'] : []}
            items={[
              {
                key: 'missing',
                label: (
                  <IssueLabel
                    icon="event_busy"
                    title="Bản ghi thiếu"
                    hint="Chấm vào nhưng không chấm ra"
                    count={report.data.missingRecords.length}
                  />
                ),
                children: report.data.missingRecords.length === 0 ? (
                  <Empty>Không có bản ghi nào thiếu.</Empty>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {report.data.missingRecords.map((item, index) => (
                      <li key={`${item.workDate}-${index}`} className="sf-body-sm">
                        {item.employee?.fullName ?? 'Không xác định'} ·{' '}
                        {formatDay(item.workDate, timezone)} · {item.issue}
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                key: 'requests',
                label: (
                  <IssueLabel
                    icon="assignment_late"
                    title="Đơn còn chờ duyệt"
                    hint="Duyệt xong sẽ làm bảng công thay đổi"
                    count={report.data.pendingRequests.length}
                  />
                ),
                children: report.data.pendingRequests.length === 0 ? (
                  <Empty>Không còn đơn nào chờ duyệt ảnh hưởng tới kỳ này.</Empty>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {report.data.pendingRequests.map((item) => (
                      <li key={item.id} className="sf-body-sm">
                        {item.employee?.fullName ?? 'Không xác định'} · {item.requestTypeName} · từ{' '}
                        {formatDateTime(item.startAt, timezone)}
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                key: 'flags',
                label: (
                  <IssueLabel
                    icon="flag"
                    title="Cờ nghi vấn chưa xử lý"
                    hint="Cần quyết định giữ hay huỷ công"
                    count={report.data.unreviewedFraudFlags.length}
                  />
                ),
                children: report.data.unreviewedFraudFlags.length === 0 ? (
                  <Empty>Mọi cờ nghi vấn trong kỳ đã được rà soát.</Empty>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {report.data.unreviewedFraudFlags.map((item) => (
                      <li key={item.id} className="sf-body-sm">
                        {item.employee?.fullName ?? 'Không xác định'} ·{' '}
                        {FRAUD_CODE_LABEL[item.code] ?? item.code} ·{' '}
                        {formatDateTime(item.createdAt, timezone)}
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                key: 'abnormal',
                label: (
                  <IssueLabel
                    icon="query_stats"
                    title="Số công bất thường"
                    hint="Quá cao hoặc quá thấp so với mặt bằng"
                    count={report.data.abnormalEmployees.length}
                    warningOnly
                  />
                ),
                children: report.data.abnormalEmployees.length === 0 ? (
                  <Empty>Không có nhân viên nào có số công bất thường.</Empty>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {report.data.abnormalEmployees.map((item, index) => (
                      <li key={index} className="sf-body-sm">
                        {item.employee?.fullName ?? 'Không xác định'} · {item.standardDays} công ·{' '}
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />

          <div>
            <label className="sf-field__label" htmlFor="close-reason" style={{ display: 'block', marginBottom: 4 }}>
              Ghi chú chốt kỳ (bắt buộc)
            </label>
            <Input.TextArea
              id="close-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              showCount
              placeholder="VD: Đã đối soát với bảng chấm công phòng Kỹ thuật và Kinh doanh, bàn giao cho bộ phận lương ngày 05/09."
              status={reason.length > 0 && !reasonOk ? 'error' : undefined}
              aria-invalid={reason.length > 0 && !reasonOk}
            />
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Tối thiểu {REASON_MIN_LENGTH} ký tự, được ghi vào nhật ký kiểm toán.
            </p>
          </div>

          {hasBlockers ? (
            <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
              Tôi đã xem hết các vấn đề trên và chấp nhận chốt kỳ dù chưa xử lý xong.
            </Checkbox>
          ) : null}

          <Alert
            type="info"
            showIcon
            message="Sau khi chốt, kỳ này bị khoá hoàn toàn"
            description="Không chấm công, không hiệu chỉnh công, không duyệt đơn rơi vào kỳ. Muốn sửa phải mở lại kỳ — thao tác đặc quyền, có ghi nhật ký."
          />
        </div>
      ) : null}
    </Modal>
  );
}

function IssueLabel({
  icon,
  title,
  hint,
  count,
  warningOnly = false,
}: {
  icon: string;
  title: string;
  hint: string;
  count: number;
  warningOnly?: boolean;
}) {
  const tone = count === 0 ? 'success' : warningOnly ? 'warning' : 'error';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon
        name={icon}
        size={20}
        color={
          tone === 'success'
            ? 'var(--sf-success-600)'
            : tone === 'warning'
              ? 'var(--sf-warning-700)'
              : 'var(--sf-error-600)'
        }
      />
      <div style={{ flex: 1 }}>
        <span className="sf-body-md" style={{ fontWeight: 600 }}>
          {title}
        </span>
        <div className="sf-body-sm sf-text-variant">{hint}</div>
      </div>
      <Tag color={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'error'}>
        {count}
      </Tag>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
      {children}
    </p>
  );
}
