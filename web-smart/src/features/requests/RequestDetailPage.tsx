import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Steps } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { ApiErrorState } from '@/components/ApiErrorState';
import { DetailField, DetailGrid } from '@/components/DetailField';
import { EmployeeCell } from '@/components/EmployeeCell';
import { ReasonDialog } from '@/components/ReasonDialog';
import { useAuth } from '@/lib/auth/auth-context';
import { useCan } from '@/lib/rbac/Can';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { formatDateTime, formatDay, formatMinutes, formatTime } from '@/lib/utils/date';
import { formatFileSize } from '@/lib/utils/format';
import { REQUEST_STATUS_LABEL } from '@/config/constants';
import { useAttendanceList, type AttendanceDaily } from '@/features/attendance/attendance.api';
import {
  Badge,
  Button,
  CardSkeleton,
  Field,
  Icon,
  TextArea,
  useToast,
  requestStatusTone,
} from '@/components/ui';
import {
  useApproveRequest,
  useRejectRequest,
  useRequestDetail,
  useRequestMoreInfo,
  type LeaveRequest,
} from './requests.api';

/**
 * Chi tiết đơn — TRANG, bố cục theo mockup Figma `63:67`.
 *
 * ## Vì sao là trang chứ không phải ngăn kéo
 *
 * Bản trước là `Drawer` rộng 640px. Khối đối chiếu "dữ liệu hệ thống → đề nghị
 * cập nhật" cần hai cột đặt cạnh nhau mới đọc được — xếp dọc thì người duyệt
 * phải tự nhớ con số bên trên để so với con số bên dưới, đúng việc mà khối này
 * sinh ra để khỏi phải làm. 640px không đủ cho hai cột.
 *
 * Đổi sang trang mất một thứ: không còn xem nhanh rồi đóng để quay lại danh
 * sách. Bù bằng đường dẫn quay lại ngay đầu trang và giữ nguyên bộ lọc của danh
 * sách khi quay về (`navigate(-1)`).
 *
 * ## Vì sao không có ô "Giờ check-out xác nhận" như mockup
 *
 * Mockup cho người duyệt sửa giờ check-out ngay trên form duyệt. Hợp đồng API
 * không có đường đó: `POST /requests/:id/approve` chỉ nhận `comment`, và giờ
 * công chỉ đổi được qua `POST /admin/attendance/adjust` — một thao tác riêng,
 * có kiểm khoá kỳ và ghi `AttendanceAdjustment` riêng (`BR-ADJ-01`).
 *
 * Vẽ ô nhập đó ra thì người duyệt sẽ sửa giờ, bấm duyệt, và giờ họ nhập biến
 * mất không dấu vết. Thay bằng đường dẫn sang màn hiệu chỉnh — dài hơn một
 * bước, nhưng thao tác thật sự xảy ra.
 */
export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();

  const canApprove = useCan('request.approve');
  const detail = useRequestDetail(id ?? null);
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const moreInfo = useRequestMoreInfo();

  const [comment, setComment] = useState('');
  const [dialog, setDialog] = useState<'reject' | 'more-info' | null>(null);

  const request = detail.data;

  if (detail.error) {
    return <ApiErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  if (detail.isPending || !request) {
    return <CardSkeleton height={520} />;
  }

  const actionable =
    canApprove && ACTIONABLE_STATUSES.includes(request.status) && Boolean(request.id);

  const done = () => {
    navigate(-1);
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/requests" className="sf-back-link">
            <Icon name="arrow_back" size={18} /> Quay lại danh sách đơn
          </Link>
        }
        title={request.requestType?.name ?? 'Chi tiết đơn'}
        description={
          request.submittedAt
            ? `Gửi lúc ${formatDateTime(request.submittedAt, timezone)}`
            : 'Đơn chưa được gửi đi'
        }
        actions={<Badge tone={requestStatusTone(request.status)}>
          {REQUEST_STATUS_LABEL[request.status] ?? request.status}
        </Badge>}
      />

      <div className="sf-detail-layout">
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <IdentityCard request={request} timezone={timezone} />

          {request.createdOnBehalf ? (
            <Alert
              type="warning"
              showIcon
              message={`Đơn này do ${request.createdOnBehalf.actorName ?? 'người khác'} nhập hộ, không phải nhân viên tự gửi`}
              description={
                <>
                  <div>{request.createdOnBehalf.reason}</div>
                  <div className="sf-body-sm sf-text-variant" style={{ marginTop: 4 }}>
                    Nhập lúc {formatDateTime(request.createdOnBehalf.createdAt, timezone)}. Đối
                    chiếu với chứng từ gốc trước khi duyệt.
                  </div>
                </>
              }
            />
          ) : null}

          {/*
            Chi so sanh duoc khi don nam gon trong MOT ngay cong — phep kiem
            nam o day chu khong trong `AttendanceDiff`, vi component do goi
            `useAttendanceList` va React khong cho goi hook co dieu kien.
          */}
          {request.startAt.slice(0, 10) === request.endAt.slice(0, 10) ? (
            <AttendanceDiff request={request} timezone={timezone} />
          ) : null}

          <NumberedSection order={2} title="Nội dung đơn">
            <DetailGrid>
              <DetailField label="Từ">{formatDateTime(request.startAt, timezone)}</DetailField>
              <DetailField label="Đến">{formatDateTime(request.endAt, timezone)}</DetailField>
              <DetailField label="Số lượng">
                {String(request.quantity)} {request.requestType?.unit === 'HOUR' ? 'giờ' : 'ngày'}
                {request.isHalfDay ? ' (nửa ngày)' : ''}
              </DetailField>
              <DetailField label="Trừ vào">{deductLabel(request)}</DetailField>
              {request.expectedReturnAt ? (
                <DetailField label="Giờ về dự kiến">
                  {formatDateTime(request.expectedReturnAt, timezone)}
                </DetailField>
              ) : null}
            </DetailGrid>

            <div style={{ marginTop: 16 }}>
              <span className="sf-label-md">Lý do nhân viên nêu</span>
              <blockquote className="sf-quote">{request.reason}</blockquote>
            </div>
          </NumberedSection>

          <Attachments request={request} />
        </div>

        <div style={{ display: 'grid', gap: 16, minWidth: 0, alignContent: 'start' }}>
          {actionable ? (
            <section className="sf-card sf-panel" style={{ padding: 0 }}>
              <header className="sf-panel__head">
                <h2 className="sf-title-md">Xử lý đơn</h2>
              </header>
              <div style={{ padding: 20, display: 'grid', gap: 16 }}>
                <Field
                  label="Ghi chú xử lý"
                  hint="Đi kèm quyết định và hiện trong lịch sử của đơn."
                >
                  {(field) => (
                    <TextArea
                      {...field}
                      rows={4}
                      maxLength={500}
                      showCount
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  )}
                </Field>

                <div className="sf-note">
                  <Icon name="info" size={18} color="var(--sf-blue-700)" />
                  <span className="sf-body-sm">
                    Mọi quyết định được ghi vào nhật ký kiểm toán kèm tên người thực hiện và thời
                    điểm. Không xoá được.
                  </span>
                </div>

                {/*
                  Ba nút, thứ tự trái → phải theo mức độ dứt khoát: Từ chối
                  (chấm dứt) · Yêu cầu bổ sung (giữ đơn sống) · Phê duyệt.
                  "Phê duyệt" là nút xanh lá duy nhất trên màn hình.
                */}
                <div style={{ display: 'grid', gap: 8 }}>
                  <Button
                    variant="action"
                    icon="check_circle"
                    block
                    loading={approve.isPending}
                    onClick={() => {
                      approve.mutate(
                        { id: request.id, comment: comment || undefined },
                        {
                          onSuccess: () => {
                            toast.success('Đã duyệt đơn');
                            done();
                          },
                          onError: showError,
                        },
                      );
                    }}
                  >
                    Phê duyệt
                  </Button>
                  <Button
                    variant="secondary"
                    icon="forum"
                    block
                    onClick={() => setDialog('more-info')}
                  >
                    Yêu cầu bổ sung
                  </Button>
                  <Button
                    variant="destructive-ghost"
                    icon="cancel"
                    block
                    onClick={() => setDialog('reject')}
                  >
                    Từ chối
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          <ApprovalFlow request={request} timezone={timezone} />
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'reject'}
        title="Từ chối đơn"
        description="Nhân viên nhận thông báo kèm lý do và phải nộp đơn mới nếu muốn xin lại."
        warning="Nếu đơn chỉ thiếu giấy tờ, hãy dùng Yêu cầu bổ sung — từ chối làm nhân viên phải nộp lại từ đầu, và làm sai tỉ lệ từ chối trong báo cáo."
        confirmText="Từ chối đơn"
        danger
        loading={reject.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => {
          reject.mutate(
            { id: request.id, reason },
            {
              onSuccess: () => {
                toast.success('Đã từ chối đơn');
                setDialog(null);
                done();
              },
              onError: showError,
            },
          );
        }}
      />

      <ReasonDialog
        open={dialog === 'more-info'}
        title="Yêu cầu bổ sung thông tin"
        description="Đơn quay về trạng thái chờ bổ sung và VẪN giữ nguyên bước duyệt hiện tại — bổ sung xong, đơn trở lại đúng chỗ này chứ không chạy lại từ cấp một."
        confirmText="Gửi yêu cầu"
        loading={moreInfo.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={(question) => {
          moreInfo.mutate(
            { id: request.id, question },
            {
              onSuccess: () => {
                toast.success('Đã gửi yêu cầu bổ sung');
                setDialog(null);
                done();
              },
              onError: showError,
            },
          );
        }}
      />
    </>
  );
}

/** Trạng thái còn quyết định được. Ngoài các trạng thái này thì đơn đã ngã ngũ. */
const ACTIONABLE_STATUSES = [
  'SUBMITTED',
  'PENDING',
  'PENDING_LEVEL_1',
  'PENDING_NEXT_LEVEL',
  'NEED_MORE_INFO',
];

function deductLabel(request: LeaveRequest): string {
  const map: Record<string, string> = {
    ANNUAL_LEAVE: 'Phép năm',
    UNPAID: 'Nghỉ không lương',
    NONE: 'Không trừ',
    OT_CREDIT: 'Quỹ OT',
    MAKEUP_CREDIT: 'Quỹ công bù',
  };
  const code = request.requestType?.deductFrom;
  return code ? (map[code] ?? code) : '—';
}

// ===========================================================================
//  Khung
// ===========================================================================

/**
 * Mục có đánh số — mockup dùng "1. Thông tin chấm công", "2. Lý do bổ sung"…
 *
 * Số thứ tự không phải trang trí: nó nói với người duyệt rằng đây là một trình
 * tự đọc, và họ đã đọc tới đâu. Trên màn hình dài, đó là thứ giữ chỗ tốt hơn
 * mọi đường kẻ ngang.
 */
function NumberedSection({
  order,
  title,
  children,
}: {
  order: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="sf-card" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">
          <span className="sf-section-number">{order}</span>
          {title}
        </h2>
      </header>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  );
}

function IdentityCard({ request, timezone }: { request: LeaveRequest; timezone: string }) {
  return (
    <section
      className="sf-card"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', padding: 20 }}
    >
      <span className="sf-stat-medallion" style={{ background: 'var(--sf-warning-50)' }}>
        <Icon name="assignment" size={24} color="var(--sf-warning-700)" />
      </span>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="sf-title-md">{request.requestType?.name ?? 'Đơn từ'}</div>
        <div className="sf-body-sm sf-text-variant">
          Mã đơn {request.id.slice(-10).toUpperCase()}
          {request.submittedAt ? ` · gửi ${formatDateTime(request.submittedAt, timezone)}` : ''}
        </div>
      </div>

      <EmployeeCell employee={request.employee} />
    </section>
  );
}

// ===========================================================================
//  Khối đối chiếu: hệ thống đang ghi gì · đơn đề nghị gì
// ===========================================================================

/**
 * Đối chiếu hai cột — trái là dữ liệu hệ thống, phải là đề nghị trong đơn.
 *
 * Chỉ hiện khi đơn nằm gọn trong MỘT ngày công. Đơn nghỉ 3 ngày không có một
 * bản ghi công nào để so, và cố vẽ ra thì cột trái là con số của ngày đầu tiên
 * — người duyệt sẽ tưởng đó là toàn bộ khoảng thời gian.
 *
 * Cột trái tô đỏ nhạt, cột phải tô xanh nhạt. Đây là ngoại lệ có chủ đích với
 * quy tắc "màu chỉ mang trạng thái": ở đây màu chính LÀ trạng thái — bên trái
 * là cái đang sai, bên phải là cái sẽ đúng sau khi duyệt.
 */
function AttendanceDiff({ request, timezone }: { request: LeaveRequest; timezone: string }) {
  const day = request.startAt.slice(0, 10);

  const daily = useAttendanceList({
    employeeId: request.employeeId,
    from: day,
    to: day,
    page: 1,
    pageSize: 1,
  });

  const row: AttendanceDaily | undefined = daily.data?.items?.[0];
  if (daily.isPending) return <CardSkeleton height={220} />;
  if (!row) return null;

  return (
    <NumberedSection order={1} title="Dữ liệu chấm công của ngày này">
      <DetailGrid>
        <DetailField label="Ngày">{formatDay(row.workDate, timezone)}</DetailField>
        <DetailField label="Ca làm việc">{row.shiftId ?? 'Không gán ca'}</DetailField>
        <DetailField label="Trạng thái hiện tại">{row.status}</DetailField>
      </DetailGrid>

      <div className="sf-diff">
        <div className="sf-diff__side sf-diff__side--before">
          <header>
            <Icon name="database" size={18} color="var(--sf-error-700)" />
            <span className="sf-label-md">Hệ thống đang ghi</span>
          </header>
          <dl>
            <DiffValue label="Check-in" value={formatTime(row.firstCheckInAt, timezone)} missing={!row.firstCheckInAt} />
            <DiffValue label="Check-out" value={formatTime(row.lastCheckOutAt, timezone)} missing={!row.lastCheckOutAt} />
            <DiffValue label="Giờ công" value={formatMinutes(row.workedMinutes)} missing={row.workedMinutes === 0} />
          </dl>
        </div>

        <Icon name="arrow_forward" size={22} color="var(--sf-on-surface-muted)" />

        <div className="sf-diff__side sf-diff__side--after">
          <header>
            <Icon name="edit_calendar" size={18} color="var(--sf-success-700)" />
            <span className="sf-label-md">Đơn đề nghị</span>
          </header>
          <dl>
            <DiffValue label="Từ" value={formatTime(request.startAt, timezone)} />
            <DiffValue label="Đến" value={formatTime(request.endAt, timezone)} />
            <DiffValue
              label="Số lượng"
              value={`${String(request.quantity)} ${request.requestType?.unit === 'HOUR' ? 'giờ' : 'ngày'}`}
            />
          </dl>
        </div>
      </div>

      {/*
        Đường dẫn sang màn hiệu chỉnh — xem docblock đầu file: duyệt đơn KHÔNG
        tự sửa giờ công, và người duyệt phải biết điều đó trước khi bấm duyệt.
      */}
      <div className="sf-note" style={{ marginTop: 16 }}>
        <Icon name="info" size={18} color="var(--sf-blue-700)" />
        <span className="sf-body-sm">
          Duyệt đơn không tự đổi giờ trên bảng công. Sau khi duyệt, sửa số liệu ở{' '}
          <Link to={`/attendance?employeeId=${request.employeeId}&date=${day}`}>
            bảng công ngày {formatDay(day, timezone)}
          </Link>
          .
        </span>
      </div>
    </NumberedSection>
  );
}

function DiffValue({
  label,
  value,
  missing = false,
}: {
  label: string;
  value: string;
  missing?: boolean;
}) {
  return (
    <div>
      <dt className="sf-body-sm sf-text-variant">{label}</dt>
      <dd
        className="sf-title-sm"
        style={{ margin: 0, color: missing ? 'var(--sf-error-700)' : 'var(--sf-on-surface)' }}
      >
        {missing ? 'Chưa ghi nhận' : value}
      </dd>
    </div>
  );
}

// ===========================================================================
//  Minh chứng & luồng duyệt
// ===========================================================================

function Attachments({ request }: { request: LeaveRequest }) {
  const files = request.attachments ?? [];
  if (files.length === 0) return null;

  return (
    <NumberedSection order={3} title={`Minh chứng đính kèm (${files.length})`}>
      <ul className="sf-file-grid">
        {files.map((file) => (
          <li key={file.id}>
            <a href={file.url ?? '#'} target="_blank" rel="noopener noreferrer">
              <span className="sf-stat-medallion" style={{ background: 'var(--sf-neutral-100)' }}>
                <Icon name="description" size={24} color="var(--sf-on-surface-variant)" />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="sf-body-md" style={{ display: 'block', fontWeight: 600 }}>
                  {file.fileName}
                </span>
                {file.sizeBytes ? (
                  <span className="sf-body-sm sf-text-variant">
                    {formatFileSize(file.sizeBytes)}
                  </span>
                ) : null}
              </span>
              <Icon name="open_in_new" size={18} color="var(--sf-blue-700)" />
            </a>
          </li>
        ))}
      </ul>
    </NumberedSection>
  );
}

function ApprovalFlow({ request, timezone }: { request: LeaveRequest; timezone: string }) {
  const steps = (request.approvalSteps ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">Luồng duyệt</h2>
      </header>
      <div style={{ padding: 20 }}>
        {steps.length === 0 ? (
          <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
            Đơn chưa được gửi đi nên chưa sinh bước duyệt nào.
          </p>
        ) : (
          <Steps
            direction="vertical"
            size="small"
            items={steps.map((step) => ({
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
        )}

        {request.status === 'REJECTED' && request.rejectReason ? (
          <div className="sf-reject-note">
            <span className="sf-label-md" style={{ color: 'inherit' }}>
              Lý do từ chối
            </span>
            <p className="sf-body-md" style={{ margin: '4px 0 0' }}>
              {request.rejectReason}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
