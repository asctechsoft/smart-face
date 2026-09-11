import { useState, type ChangeEvent } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  Select,
  TextArea,
  TextInput,
  useToast,
} from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { formatDateTime } from '@/lib/utils/date';
import {
  useCloseSupportSession,
  useOpenSupportSession,
  useSupportSessions,
  type SupportSession,
} from './provisioning.api';

const DURATIONS = [
  { value: '30', label: '30 phút' },
  { value: '60', label: '1 giờ' },
  { value: '240', label: '4 giờ' },
  { value: '480', label: '8 giờ (tối đa)' },
];

/**
 * Phiên hỗ trợ truy cập dữ liệu tenant (`BR-08`).
 *
 * ## Vì sao màn hình này tồn tại
 *
 * Trước v2.1, một tài khoản nền tảng chỉ cần gửi kèm header `X-Company-Id` là
 * đọc được dữ liệu của bất kỳ công ty nào — không mã phiếu, không lý do, không
 * thời hạn. Bản ghi audit để lại chỉ nói *ai* đã xem, không nói được *vì sao*,
 * nên khi khách hàng hỏi "ai đã mở dữ liệu của chúng tôi và theo yêu cầu nào"
 * thì không có câu trả lời nào rút ra được từ hệ thống.
 *
 * Bây giờ header đó chỉ có tác dụng khi có một phiên đang mở ở đây, và mọi bản
 * ghi audit sinh ra trong phiên đều mang `supportSessionId` để quy về đúng phiếu.
 *
 * ## Chỉ đọc là mặc định
 *
 * Đọc để chẩn đoán là việc thường gặp; sửa dữ liệu của khách hàng thì phải khai
 * rõ từ lúc mở phiên, và điều đó cũng nằm trong audit.
 */
export function SupportSessionsPage() {
  const toast = useToast();
  const showError = useErrorToast();

  const sessions = useSupportSessions();
  const open = useOpenSupportSession();
  const close = useCloseSupportSession();

  const [form, setForm] = useState({
    companyId: '',
    ticketRef: '',
    purpose: '',
    durationMinutes: '60',
    readOnly: true,
  });
  const [closing, setClosing] = useState<SupportSession | null>(null);

  const ready =
    form.companyId.trim().length > 0 &&
    form.ticketRef.trim().length >= 3 &&
    form.purpose.trim().length >= 10;

  const submit = () => {
    open.mutate(
      {
        companyId: form.companyId.trim(),
        ticketRef: form.ticketRef.trim(),
        purpose: form.purpose.trim(),
        durationMinutes: Number(form.durationMinutes),
        readOnly: form.readOnly,
      },
      {
        onSuccess: (session) => {
          toast.success(
            session.reused ? 'Dùng lại phiên đang mở' : 'Đã mở phiên hỗ trợ',
            session.reused
              ? 'Bạn đã có một phiên còn hiệu lực trên công ty này, nên hệ thống dùng lại thay vì tạo thêm.'
              : `Hết hạn lúc ${formatDateTime(session.expiresAt)}.`,
          );
          setForm((prev) => ({ ...prev, ticketRef: '', purpose: '' }));
        },
        onError: showError,
      },
    );
  };

  const columns: ColumnsType<SupportSession> = [
    {
      title: 'Công ty',
      key: 'company',
      render: (_, row) => (
        <div>
          <div>{row.company?.name ?? row.companyId}</div>
          <div className="sf-body-sm sf-text-muted">{row.company?.code ?? ''}</div>
        </div>
      ),
    },
    { title: 'Mã phiếu', dataIndex: 'ticketRef', key: 'ticketRef', width: 160 },
    { title: 'Lý do', dataIndex: 'purpose', key: 'purpose' },
    {
      title: 'Quyền',
      key: 'readOnly',
      width: 120,
      render: (_, row) =>
        row.readOnly ? (
          <Badge tone="neutral">Chỉ đọc</Badge>
        ) : (
          <Badge tone="warning">Được ghi</Badge>
        ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 200,
      render: (_, row) =>
        row.active ? (
          <div>
            <Badge tone="success">Đang mở</Badge>
            <div className="sf-body-sm sf-text-muted">
              Hết hạn {formatDateTime(row.expiresAt)}
            </div>
          </div>
        ) : (
          <div>
            <Badge tone="neutral">Đã đóng</Badge>
            <div className="sf-body-sm sf-text-muted">
              {row.endedAt ? formatDateTime(row.endedAt) : formatDateTime(row.expiresAt)}
            </div>
          </div>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_, row) =>
        row.active ? (
          <Button variant="destructive-ghost" size="sm" onClick={() => setClosing(row)}>
            Đóng phiên
          </Button>
        ) : null,
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Phiên hỗ trợ"
        description="Truy cập dữ liệu của một công ty phải có mã phiếu, lý do và thời hạn."
      />

      <Alert
        type="info"
        showIcon
        message="Mọi thao tác trong phiên đều được quy về đúng phiếu hỗ trợ"
        description="Khách hàng hỏi 'ai đã xem dữ liệu của chúng tôi' thì tra được bằng nhật ký của phiên."
      />

      <Card>
        <div className="sf-title-sm" style={{ marginBottom: 12 }}>
          Mở phiên mới
        </div>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <Field label="Mã công ty (id)" htmlFor="s-company" required>
            <TextInput
              id="s-company"
              value={form.companyId}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setForm((prev) => ({ ...prev, companyId: event.target.value }))
              }
            />
          </Field>

          <Field label="Mã phiếu hỗ trợ" htmlFor="s-ticket" required>
            <TextInput
              id="s-ticket"
              placeholder="SUP-2026-0412"
              value={form.ticketRef}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setForm((prev) => ({ ...prev, ticketRef: event.target.value }))
              }
            />
          </Field>

          <Field label="Thời hạn" htmlFor="s-duration">
            <Select
              id="s-duration"
              options={DURATIONS}
              value={form.durationMinutes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))
              }
            />
          </Field>
        </div>

        <div style={{ marginTop: 16 }}>
          <Field
            label="Lý do truy cập"
            htmlFor="s-purpose"
            required
            hint="Câu này được hiển thị lại cho khách hàng khi họ yêu cầu đối chiếu. Viết cụ thể."
          >
            <TextArea
              id="s-purpose"
              rows={2}
              value={form.purpose}
              onChange={(event) => setForm((prev) => ({ ...prev, purpose: event.target.value }))}
            />
          </Field>
        </div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <Checkbox
            checked={!form.readOnly}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, readOnly: !event.target.checked }))
            }
          >
            Cho phép ghi dữ liệu
            <span className="sf-body-sm sf-text-muted" style={{ display: 'block' }}>
              Mặc định chỉ đọc. Bật khi thực sự phải sửa dữ liệu giúp khách hàng.
            </span>
          </Checkbox>
          <Button variant="primary" disabled={!ready} loading={open.isPending} onClick={submit}>
            Mở phiên
          </Button>
        </div>
      </Card>

      <Table
        rowKey="id"
        size="small"
        loading={sessions.isPending}
        dataSource={sessions.data ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />

      <ConfirmDialog
        open={closing !== null}
        title="Đóng phiên hỗ trợ?"
        message={
          closing
            ? `Sau khi đóng, bạn không còn đọc được dữ liệu của ${closing.company?.name ?? closing.companyId} cho tới khi mở phiên mới.`
            : ''
        }
        confirmText="Đóng phiên"
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (!closing) return;
          close.mutate(closing.id, {
            onSuccess: () => toast.success('Đã đóng phiên hỗ trợ'),
            onError: showError,
          });
          setClosing(null);
        }}
      />
    </div>
  );
}
