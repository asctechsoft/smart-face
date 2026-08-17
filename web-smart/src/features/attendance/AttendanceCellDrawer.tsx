import { Alert, Button, Drawer, Empty } from 'antd';
import { DetailField, DetailGrid, DetailSection } from '@/components/DetailField';
import { StatusBadge, dailyStatusTone, requestStatusTone } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { Can } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { DAILY_STATUS_LABEL, REQUEST_STATUS_LABEL } from '@/config/constants';
import { formatDayLong, formatMinutes, formatTime } from '@/lib/utils/date';
import { formatStandardDays } from '@/lib/utils/format';
import type { Shift } from '@/features/policy/policy.api';
import type { AttendanceDaily } from './attendance.api';
import type { AttendanceSheetEmployee, SheetRequest } from './attendance-sheets.api';

/**
 * Số công ĐI LÀM THỰC TẾ của một ngày.
 *
 * Suy ra từ số phút đã làm so với số phút công của ca, nhân với số công mà ca
 * đó được tính. Cố ý KHÁC `standardDays` do máy tính công trả về: `standardDays`
 * là công HƯỞNG LƯƠNG, đã cộng cả ngày nghỉ phép có lương, ngày lễ và công bù.
 *
 * Hai con số này lệch nhau chính là thông tin mà người rà công cần: một người
 * nghỉ phép cả tháng vẫn có 22 công hưởng lương và 0 công đi làm. Gộp lại thành
 * một ô thì không ai phát hiện được điều đó khi liếc bảng.
 *
 * `null` khi không biết ca của ngày — chia cho một con số bịa ra còn tệ hơn
 * không hiện gì.
 */
export function actualWorkedDays(daily: AttendanceDaily | null, shift: Shift | null): number | null {
  if (!daily) return null;
  if (!shift || !shift.workMinutes) return null;
  const credit = shift.workDayCredit || 1;
  return Math.round(((daily.workedMinutes / shift.workMinutes) * credit + Number.EPSILON) * 100) / 100;
}

/**
 * Các mảnh của phép quy đổi công mà engine đã ghi vào `breakdown.dayCredit`.
 *
 * Đọc lại từ đây thay vì tính lại hệ số ở phía Web, và đó là chủ ý: hệ số ngày
 * phụ thuộc ngày lễ, cuối tuần và hệ số khai riêng cho từng ngày lễ. Chép công
 * thức sang client là dựng một bản sao thứ hai sẽ lệch khỏi engine ở lần sửa
 * luật tiếp theo — mà con số hiển thị lệch với con số trả lương là kiểu lỗi
 * người dùng phát hiện trước lập trình viên.
 */
export interface DayCreditBreakdown {
  dayCredit: number;
  dayFactor: number;
  workedRatio: number;
  workedDays: number;
  holidayDays: number;
  leaveDays: number;
  cap: number;
}

export function readDayCredit(daily: AttendanceDaily | null): DayCreditBreakdown | null {
  const raw = (daily?.breakdown as { dayCredit?: unknown } | null | undefined)?.dayCredit;
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  if (typeof value.dayFactor !== 'number' || typeof value.dayCredit !== 'number') return null;
  return value as unknown as DayCreditBreakdown;
}

/** "08:00–17:30", "22:00–06:00 (qua đêm)", "Linh hoạt". */
export function shiftHours(shift: Shift): string {
  if (shift.type === 'FLEXIBLE') return 'Linh hoạt';
  return `${shift.startTime ?? '—'}–${shift.endTime ?? '—'}${shift.crossesMidnight ? ' (qua đêm)' : ''}`;
}

/**
 * Chi tiết một ô của lưới chấm công — FR-WEB-ATT-09.
 *
 * Trả lời đúng câu hỏi mà một ô màu không trả lời được: "vì sao ngày này ra con
 * số đó". Ba nguồn cùng góp vào một ngày công — lịch ca, lượt chấm công thật và
 * đơn từ — nên cả ba đều phải có mặt ở đây, cạnh nhau, chứ không nằm rải ở ba
 * màn hình khác nhau.
 */
export function AttendanceCellDrawer({
  open,
  employee,
  date,
  daily,
  shifts,
  requests,
  holidayName,
  onClose,
  onViewLogs,
  onAdjust,
}: {
  open: boolean;
  employee: AttendanceSheetEmployee | null;
  date: string | null;
  daily: AttendanceDaily | null;
  /** Ca đã xếp cho ngày này, đã sắp theo giờ bắt đầu. */
  shifts: Shift[];
  /** Đơn từ phủ lên ngày này — gồm cả đơn chờ duyệt. */
  requests: SheetRequest[];
  holidayName?: string;
  onClose: () => void;
  onViewLogs: () => void;
  onAdjust: () => void;
}) {
  const { timezone } = useAuth();

  // Máy tính công đọc CA SỚM NHẤT trong ngày, nên số công thực tế phải quy chiếu
  // đúng ca đó. Lấy ca khác sẽ cho ra một tỉ lệ không khớp với con số bên cạnh.
  const primaryShift = shifts[0] ?? null;
  const actual = actualWorkedDays(daily, primaryShift);
  const credit = readDayCredit(daily);
  const pendingRequests = requests.filter((request) => request.status === 'PENDING');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
      title={
        <div>
          <div className="sf-title-md">{employee?.fullName ?? 'Nhân viên'}</div>
          <div className="sf-body-sm sf-text-variant">
            {date ? formatDayLong(date, timezone) : '—'}
            {employee?.employeeCode ? ` · ${employee.employeeCode}` : ''}
          </div>
        </div>
      }
      styles={{ body: { padding: 24, display: 'flex', flexDirection: 'column', gap: 24 } }}
      footer={
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button icon={<Icon name="fingerprint" size={20} />} onClick={onViewLogs}>
            Xem từng lượt chấm công
          </Button>
          <Can do="attendance.adjust">
            <Button type="primary" icon={<Icon name="edit" size={20} />} onClick={onAdjust}>
              Hiệu chỉnh công
            </Button>
          </Can>
        </div>
      }
    >
      {holidayName ? (
        <Alert
          type="warning"
          showIcon
          message={`Ngày lễ: ${holidayName}`}
          description="Giờ làm trong ngày lễ áp hệ số OT riêng theo cấu hình của ca (NFR-LEGAL-05)."
        />
      ) : null}

      {pendingRequests.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message={`${pendingRequests.length} đơn của ngày này còn chờ duyệt`}
          description="Đơn chưa duyệt CHƯA được tính vào công. Duyệt sau khi chốt bảng thì phải tính lại cả kỳ."
        />
      ) : null}

      {/* ── Ca làm việc ──────────────────────────────────────────────── */}
      <DetailSection title="Ca làm việc">
        {shifts.length === 0 ? (
          <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
            Ngày này chưa được phân ca. Công tính theo ca mặc định của công ty.
          </p>
        ) : (
          <DetailGrid>
            {shifts.map((shift, index) => (
              <DetailField
                key={shift.id}
                label={index === 0 ? 'Ca áp dụng' : `Ca thứ ${index + 1}`}
                hint={
                  index > 0
                    ? 'Máy tính công hiện chỉ tính ca sớm nhất trong ngày'
                    : `${formatMinutes(shift.workMinutes)} công · ${formatStandardDays(shift.workDayCredit)} ngày công`
                }
              >
                {shift.name} · {shiftHours(shift)}
              </DetailField>
            ))}
          </DetailGrid>
        )}
      </DetailSection>

      {/* ── Giờ chấm công ────────────────────────────────────────────── */}
      <DetailSection title="Giờ chấm công">
        <DetailGrid>
          <DetailField label="Chấm vào">{formatTime(daily?.firstCheckInAt, timezone)}</DetailField>
          <DetailField label="Chấm ra">{formatTime(daily?.lastCheckOutAt, timezone)}</DetailField>
          <DetailField label="Tổng giờ làm">{formatMinutes(daily?.workedMinutes)}</DetailField>
          <DetailField label="Giờ nghỉ giữa ca">{formatMinutes(daily?.breakMinutes)}</DetailField>
          <DetailField label="Đi muộn">
            {daily && daily.lateMinutes > 0 ? (
              <span style={{ color: 'var(--sf-warning-800)', fontWeight: 600 }}>
                {formatMinutes(daily.lateMinutes)}
              </span>
            ) : (
              '—'
            )}
          </DetailField>
          <DetailField label="Về sớm">
            {daily && daily.earlyLeaveMinutes > 0 ? (
              <span style={{ color: 'var(--sf-warning-800)', fontWeight: 600 }}>
                {formatMinutes(daily.earlyLeaveMinutes)}
              </span>
            ) : (
              '—'
            )}
          </DetailField>
        </DetailGrid>
      </DetailSection>

      {/* ── Số công ──────────────────────────────────────────────────── */}
      <DetailSection title="Số công">
        <DetailGrid>
          <DetailField
            label="Công hưởng lương"
            hint="Máy tính công trả về — đã gồm nghỉ phép có lương, ngày lễ và công bù"
          >
            <span className="sf-title-sm">{formatStandardDays(daily?.standardDays)}</span>
          </DetailField>
          <DetailField
            label="Công đi làm thực tế"
            hint={
              primaryShift
                ? 'Quy đổi từ giờ làm thực tế trên số giờ công của ca'
                : 'Chưa xác định được ca của ngày nên không quy đổi được'
            }
          >
            <span className="sf-title-sm">{actual === null ? '—' : formatStandardDays(actual)}</span>
          </DetailField>
          {/*
            Chỉ hiện khi hệ số khác 1. Ngày thường thì "× 1" là nhiễu; còn Chủ
            nhật ra 2 công cho 8 tiếng làm mà không nói vì sao thì người đọc
            tưởng bảng công tính sai.
          */}
          {credit && credit.dayFactor !== 1 ? (
            <DetailField
              label="Hệ số ngày"
              hint={`Ngày công của ca ${formatStandardDays(credit.dayCredit)} · trần ${formatStandardDays(credit.cap)} công`}
            >
              <span style={{ fontWeight: 600 }}>{formatStandardDays(credit.dayFactor)}×</span>
            </DetailField>
          ) : null}
          {credit && credit.holidayDays > 0 ? (
            <DetailField
              label="Công nghỉ lễ"
              hint="Nghỉ lễ hưởng nguyên lương, hệ số 1 — Điều 98 BLLĐ"
            >
              {formatStandardDays(credit.holidayDays)}
            </DetailField>
          ) : null}
          {credit && credit.leaveDays > 0 ? (
            <DetailField label="Công theo đơn" hint="Từ đơn nghỉ được hưởng lương">
              {formatStandardDays(credit.leaveDays)}
            </DetailField>
          ) : null}
          <DetailField label="Công bù">{formatMinutes(daily?.makeupMinutes)}</DetailField>
          <DetailField label="Trạng thái">
            {daily ? (
              <StatusBadge tone={dailyStatusTone(daily.status)}>
                {DAILY_STATUS_LABEL[daily.status] ?? daily.status}
              </StatusBadge>
            ) : (
              <span className="sf-text-muted">Chưa có bản ghi công</span>
            )}
          </DetailField>
        </DetailGrid>
      </DetailSection>

      {/* ── Tăng ca ──────────────────────────────────────────────────── */}
      <DetailSection title="Tăng ca">
        {daily && daily.otMinutes > 0 ? (
          <DetailGrid>
            <DetailField label="Giờ OT">{formatMinutes(daily.otMinutes)}</DetailField>
            <DetailField label="Hệ số OT" hint="Ngày lễ tối thiểu 300% — NFR-LEGAL-05">
              {daily.otMultiplier ? `${formatStandardDays(daily.otMultiplier)}×` : '—'}
            </DetailField>
          </DetailGrid>
        ) : (
          <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
            Ngày này không có giờ tăng ca.
          </p>
        )}
      </DetailSection>

      {/* ── Đơn từ ───────────────────────────────────────────────────── */}
      <DetailSection title="Đơn từ áp dụng cho ngày này">
        {requests.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Không có đơn nào chạm vào ngày này"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {requests.map((request) => (
              <RequestRow key={request.id} request={request} applied={daily?.appliedRequestIds} />
            ))}
          </div>
        )}
      </DetailSection>
    </Drawer>
  );
}

/**
 * Một đơn từ trong ô.
 *
 * Phân biệt rõ "đơn có hiệu lực trong khoảng ngày này" với "đơn ĐÃ ĐƯỢC TÍNH vào
 * công của ngày này" (`appliedRequestIds`). Hai thứ đó lệch nhau khi đơn vừa
 * duyệt xong mà công chưa tính lại — và đó chính xác là lúc người rà công cần
 * nhìn thấy sự lệch, chứ không phải lúc mọi thứ đã khớp.
 */
function RequestRow({ request, applied }: { request: SheetRequest; applied?: string[] }) {
  const isApplied = applied?.includes(request.id) ?? false;

  return (
    <div
      style={{
        border: '1px solid var(--sf-outline-variant)',
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{request.requestTypeName}</span>
        <StatusBadge tone={requestStatusTone(request.status)} soft>
          {REQUEST_STATUS_LABEL[request.status] ?? request.status}
        </StatusBadge>
        {/*
          Hai nhãn khác nhau, đều cần thiết. "Hưởng lương" là thuộc tính của LOẠI
          đơn — nghỉ nguyên ngày sẽ ra đủ công. "Đã tính vào công" là trạng thái
          của ĐÚNG ngày này — đơn vừa duyệt mà công chưa tính lại thì hai thứ
          lệch nhau, và đó chính là lúc người rà công cần nhìn thấy sự lệch.
        */}
        <StatusBadge tone={request.isPaidLeave ? 'teal' : 'neutral'} soft>
          {request.isPaidLeave ? 'Nghỉ hưởng lương' : 'Không tính công'}
        </StatusBadge>
        {request.status === 'APPROVED' && request.isPaidLeave ? (
          <StatusBadge tone={isApplied ? 'teal' : 'warning'} soft>
            {isApplied ? 'Đã tính vào công' : 'Chưa tính vào công'}
          </StatusBadge>
        ) : null}
      </div>

      <div className="sf-body-sm sf-text-variant">
        {request.startDate === request.endDate
          ? `Ngày ${request.startDate}`
          : `Từ ${request.startDate} đến ${request.endDate}`}
        {' · '}
        {formatStandardDays(request.quantity)} {unitLabel(request.unit)}
        {request.isHalfDay ? ' · nửa ngày' : ''}
        {' · trừ vào '}
        {deductLabel(request.deductFrom)}
      </div>

      {request.reason ? <div className="sf-body-sm">Lý do: {request.reason}</div> : null}
    </div>
  );
}

function unitLabel(unit: string): string {
  if (unit === 'HOUR') return 'giờ';
  if (unit === 'HALF_DAY') return 'nửa ngày';
  return 'ngày';
}

/** Đơn nghỉ phép năm và nghỉ không lương trông giống nhau trên lịch, khác hẳn trên bảng lương. */
function deductLabel(deductFrom: string): string {
  switch (deductFrom) {
    case 'ANNUAL_LEAVE':
      return 'quỹ phép năm';
    case 'UNPAID':
      return 'nghỉ không lương';
    case 'OT_CREDIT':
      return 'quỹ giờ OT';
    case 'MAKEUP_CREDIT':
      return 'quỹ công bù';
    case 'NONE':
      return 'không trừ quỹ nào';
    default:
      return deductFrom;
  }
}
