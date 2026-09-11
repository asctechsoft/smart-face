import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { ApiErrorState } from '@/components/ApiErrorState';
import { useAuth } from '@/lib/auth/auth-context';
import { useCan } from '@/lib/rbac/Can';
import { formatDay, formatMinutes, formatTime } from '@/lib/utils/date';
import { formatNumber } from '@/lib/utils/format';
import { ACTION_LABEL } from '@/features/audit/audit-labels';
import { ROLE_LABEL } from '@/config/constants';
import { useBranches, useDepartments, toSelectOptions } from '@/features/shared/org.api';
import { usePeriods } from '@/features/exec/periods.api';
import {
  Badge,
  Button,
  CardSkeleton,
  EmptyState,
  Icon,
  Select,
  StatCard,
  StatCardSkeleton,
  LinkButton,
} from '@/components/ui';
import {
  useDashboard,
  useReconciliation,
  useRecentActivity,
  type PayrollMilestone,
  type ReconcileIssue,
  type Reconciliation,
  type ReconciliationFilters,
  type ReconciliationRow,
} from './dashboard.api';

/**
 * Tổng quan — màn hình Kế toán, bố cục theo ảnh thiết kế "Tổng quan Kế toán".
 *
 * ## Nó trả lời câu hỏi nào
 *
 * "Kỳ này còn bao nhiêu việc phải đối soát trước hạn chốt." Không phải "hôm nay
 * ai đang ở công ty" — bản cũ hỏi câu đó, và câu đó thuộc về màn Theo dõi trong
 * ngày. Kế toán mở phần mềm để làm cho xong một kỳ công, nên thứ đầu tiên họ
 * thấy phải là khối lượng việc còn lại và cái hạn đang tới gần.
 *
 * ## Thứ tự các khối không tuỳ tiện
 *
 * 1. **Thanh lọc** — kỳ nào, văn phòng nào, phòng ban nào
 * 2. **Hàng thẻ chỉ số** — quy mô: bao nhiêu người, bao nhiêu người còn vướng
 * 3. **Tiến độ · Cần xử lý · Trạng thái kỳ** — ba câu trả lời cho "còn bao lâu",
 *    "làm gì trước", "đang chờ ai"
 * 4. **Bảng cần đối soát · Lịch chốt lương · OT & phép** — danh sách việc bấm
 *    được vào thẳng, đặt cạnh hai khối nền để đọc khi cần
 * 5. **Hoạt động gần đây** — dấu vết, đọc sau cùng
 *
 * Bảng danh sách nằm DƯỚI ba khối tóm tắt vì nó dài và cuộn được; đặt nó lên
 * trên thì mọi thứ tóm tắt bị đẩy khỏi màn hình đầu tiên.
 *
 * ## "Lịch trình chốt lương" lấy ngày ở đâu
 *
 * `PayrollPeriod` chỉ biết ngày đầu, ngày cuối và trạng thái — bốn mốc trong
 * thiết kế không có trong cơ sở dữ liệu. Backend suy chúng ra từ ngày cuối kỳ
 * cộng ba khoá chính sách `payroll.schedule.*` (Cài đặt → Chính sách). Vì đó là
 * lịch DỰ KIẾN chứ không phải việc đã xảy ra, khối này ghi rõ chữ "dự kiến" và
 * mốc "Chốt công" lấy trạng thái từ máy trạng thái kỳ (`docs/13` §5.4) chứ
 * không tô xanh chỉ vì ngày đã qua.
 */
export function DashboardPage() {
  const { company, timezone, roles } = useAuth();
  const canViewAudit = useCan('audit.view');
  const canPickPeriod = useCan('timesheet.view');

  const [filters, setFilters] = useState<ReconciliationFilters>({});

  const branches = useBranches();
  const departments = useDepartments();
  const periods = usePeriods(canPickPeriod);

  const summary = useDashboard();
  const recon = useReconciliation(filters);
  const activity = useRecentActivity(canViewAudit);

  const data = recon.data;

  /*
   * Phòng ban lọc theo văn phòng đang chọn. Không lọc thì danh sách xổ ra cả
   * trăm phòng của mọi chi nhánh, và chọn một phòng không thuộc chi nhánh đang
   * lọc sẽ ra bảng rỗng mà không nói vì sao.
   */
  const departmentOptions = useMemo(() => {
    const list = (departments.data ?? []).filter(
      (item) => !filters.branchId || item.branchId === filters.branchId,
    );
    return toSelectOptions(list, 'Tất cả phòng ban');
  }, [departments.data, filters.branchId]);

  const periodOptions = useMemo(
    () => [
      { value: '', label: 'Kỳ đang mở' },
      ...(periods.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
    ],
    [periods.data],
  );

  const activeFilters = [filters.periodId, filters.branchId, filters.departmentId].filter(
    Boolean,
  ).length;

  return (
    <>
      <PageHeader
        title={`Tổng quan${roles.includes('HR_PAYROLL') ? ` ${ROLE_LABEL.HR_PAYROLL}` : ''}`}
        description={
          data?.period
            ? `${company?.name ?? 'Công ty'} · kỳ ${data.period.name}, số liệu tính tới ngày ${formatDay(data.asOf, timezone)}.`
            : `${company?.name ?? 'Công ty'} · chưa có kỳ công nào được mở.`
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => setFilters({})}
        extra={
          <>
            <span className="sf-body-sm sf-text-variant sf-dash-updated">
              <Icon name="schedule" size={16} />
              Cập nhật {formatTime(new Date(), timezone)}
            </span>
            <Button
              variant="secondary"
              icon="refresh"
              loading={recon.isFetching || summary.isFetching}
              onClick={() => {
                void recon.refetch();
                void summary.refetch();
                void activity.refetch();
              }}
            >
              Làm mới
            </Button>
          </>
        }
      >
        <FilterField label="Kỳ công" htmlFor="dash-period" width={200}>
          <Select
            id="dash-period"
            options={periodOptions}
            disabled={!canPickPeriod}
            value={filters.periodId ?? ''}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, periodId: event.target.value || undefined }))
            }
          />
        </FilterField>

        <FilterField label="Văn phòng" htmlFor="dash-branch" width={200}>
          <Select
            id="dash-branch"
            options={toSelectOptions(branches.data, 'Tất cả văn phòng')}
            value={filters.branchId ?? ''}
            onChange={(event) =>
              // Đổi văn phòng thì bỏ luôn phòng ban đang chọn — phòng ban cũ
              // gần như chắc chắn không thuộc văn phòng mới.
              setFilters((prev) => ({
                ...prev,
                branchId: event.target.value || undefined,
                departmentId: undefined,
              }))
            }
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="dash-department" width={220}>
          <Select
            id="dash-department"
            options={departmentOptions}
            value={filters.departmentId ?? ''}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, departmentId: event.target.value || undefined }))
            }
          />
        </FilterField>
      </FilterBar>

      {recon.error ? (
        <ApiErrorState error={recon.error} onRetry={() => void recon.refetch()} />
      ) : (
        /*
          `.sf-dash` ha thang chu cua ca trang xuong 13px. Dat o day chu khong
          sua `.sf-body-md` toan cuc: thang chu la tai san chung cua moi man
          hinh, con man hinh nay dac biet o cho no nhoi bay khoi so lieu vao
          mot khung nhin — thu ma cac man hinh khac khong lam.
        */
        <div className="sf-dash" style={{ display: 'grid', gap: 16 }}>
          <ReconcileStats data={data} loading={recon.isPending} timezone={timezone} />

          <div className="sf-dash-row sf-dash-row--top">
            <ProgressPanel data={data} loading={recon.isPending} timezone={timezone} />
            <QueuePanel data={data} loading={recon.isPending} />
            <PeriodPanel data={data} loading={recon.isPending} timezone={timezone} />
          </div>

          <div className="sf-dash-row sf-dash-row--bottom">
            <NeedsReviewPanel data={data} loading={recon.isPending} timezone={timezone} />
            <PayrollSchedulePanel data={data} loading={recon.isPending} timezone={timezone} />
            <OtLeavePanel data={data} loading={recon.isPending} />
          </div>

          {canViewAudit ? (
            <ActivityPanel
              items={activity.data?.items ?? []}
              loading={activity.isPending}
              timezone={timezone}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

// ===========================================================================
//  Khung chung
// ===========================================================================

/**
 * Thẻ có tiêu đề — khung của mọi khối trên trang này.
 *
 * Tách riêng thay vì lặp `<Card>` + `<h2>` ở tám chỗ: tiêu đề khối phải cùng
 * cỡ, cùng khoảng cách, cùng đường kẻ dưới ở mọi khối, và tám bản sao chép tay
 * là tám cơ hội để chúng lệch nhau.
 */
function Panel({
  title,
  extra,
  children,
  padding = 20,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  padding?: number;
}) {
  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">{title}</h2>
        {extra}
      </header>
      <div className="sf-panel__body" style={{ padding }}>
        {children}
      </div>
    </section>
  );
}

/** Tỷ lệ phần trăm an toàn với mẫu số 0 — dùng ở cả hàng thẻ lẫn thanh đo. */
function percentOf(part: number | undefined, total: number | undefined): number {
  if (!total || total <= 0) return 0;
  return Math.round(((part ?? 0) / total) * 1000) / 10;
}

// ===========================================================================
//  1. Hàng thẻ chỉ số
// ===========================================================================

const PERIOD_BADGE: Record<string, { label: string; tone: 'warning' | 'success' | 'teal' }> = {
  OPEN: { label: 'Đang tổng hợp', tone: 'teal' },
  CALCULATING: { label: 'Đang tính lại', tone: 'teal' },
  PENDING_APPROVAL: { label: 'Chờ duyệt chốt', tone: 'warning' },
  LOCKED: { label: 'Đã chốt', tone: 'success' },
  REOPENED: { label: 'Đã mở lại', tone: 'warning' },
};

function ReconcileStats({
  data,
  loading,
  timezone,
}: {
  data?: Reconciliation;
  loading: boolean;
  timezone: string;
}) {
  if (loading) {
    return (
      <div className="sf-stat-row sf-stat-row--five">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  const totals = data?.totals;
  const total = totals?.totalEmployees ?? 0;
  const period = data?.period;
  const badge = period ? (PERIOD_BADGE[period.status] ?? null) : null;

  return (
    <div className="sf-stat-row sf-stat-row--five">
      <StatCard
        icon="group"
        tone="primary"
        label="Tổng nhân viên"
        value={formatNumber(total)}
        hint="đang làm việc"
      />
      <StatCard
        icon="task_alt"
        tone="success"
        label="Đã tổng hợp"
        value={formatNumber(totals?.settled)}
        hint={`${percentOf(totals?.settled, total)}% số nhân viên`}
      />
      <StatCard
        icon="warning"
        tone="warning"
        label="Cần đối soát"
        value={formatNumber(totals?.needsReview)}
        hint={`${percentOf(totals?.needsReview, total)}% số nhân viên`}
        to="/attendance?filter=needs-review"
      />
      <StatCard
        icon="error"
        tone="error"
        label="Thiếu check-in/out"
        value={formatNumber(totals?.missingPunch)}
        hint={`${percentOf(totals?.missingPunch, total)}% số nhân viên`}
        to="/attendance?filter=missing-punch"
      />

      {/*
        Thẻ thứ năm không phải một phép đếm nên không dùng `<StatCard>`: nó nói
        ĐANG Ở BƯỚC NÀO của kỳ, và nhồi một chữ trạng thái vào chỗ vốn dành cho
        con số 30px sẽ tràn ở mọi nhãn dài hơn "Đã chốt".
      */}
      <div className="sf-stat-card sf-stat-card--period">
        <span className="sf-stat-medallion" style={{ background: 'var(--sf-success-50)' }}>
          <Icon name="calendar_month" size={24} color="var(--sf-success-700)" />
        </span>
        <span className="sf-stat-body">
          <span className="sf-label-md sf-text-variant">Kỳ công</span>
          <span className="sf-title-md">{period?.name ?? 'Chưa mở kỳ'}</span>
          {badge ? (
            <span>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </span>
          ) : (
            <span className="sf-body-sm sf-text-variant">Tạo kỳ ở màn hình Bảng công</span>
          )}
          {period ? (
            <span className="sf-body-sm sf-text-variant">
              {formatDay(period.startDate, timezone)} – {formatDay(period.endDate, timezone)}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

// ===========================================================================
//  2a. Tiến độ tổng hợp
// ===========================================================================

function ProgressPanel({
  data,
  loading,
  timezone,
}: {
  data?: Reconciliation;
  loading: boolean;
  timezone: string;
}) {
  if (loading) return <CardSkeleton height={300} />;

  const points = data?.progress ?? [];

  return (
    <Panel
      title="Tiến độ tổng hợp công trong kỳ"
      extra={
        <div className="sf-chart-legend">
          <span>
            <i style={{ background: 'var(--sf-success-600)' }} /> Đã tổng hợp
          </span>
          <span>
            <i className="sf-chart-legend__dashed" /> Mục tiêu
          </span>
        </div>
      }
    >
      {points.length === 0 ? (
        <EmptyState
          icon="monitoring"
          title="Chưa có ngày công nào được tính"
          description="Đường tiến độ xuất hiện sau lần tính công đầu tiên của kỳ."
        />
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-neutral-200)" vertical={false} />
              <XAxis
                dataKey="workDate"
                tickFormatter={(value: string) => `${value.slice(8)}/${value.slice(5, 7)}`}
                tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--sf-neutral-300)' }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip
                labelFormatter={(value: string) => `Đến hết ngày ${formatDay(value, timezone)}`}
                formatter={(value: number, name: string) => [formatNumber(value), name]}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid var(--sf-outline-variant)',
                  fontSize: 14,
                }}
              />
              {/*
                Đường mục tiêu vẽ NÉT ĐỨT và màu nhạt — nó là mốc tham chiếu,
                không phải một phép đo. Vẽ nét liền cùng độ đậm thì hai đường
                trông ngang hàng và người đọc mất vài giây mới biết đâu là thực.
              */}
              <Line
                type="monotone"
                dataKey="expected"
                name="Mục tiêu"
                stroke="var(--sf-neutral-400)"
                strokeDasharray="6 4"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="settled"
                name="Đã tổng hợp"
                stroke="var(--sf-success-600)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="sf-body-sm sf-text-variant" style={{ margin: '12px 0 0' }}>
        Cộng dồn bản ghi đã ổn định. Mục tiêu: mỗi người mỗi ngày một bản ghi.
      </p>
    </Panel>
  );
}

// ===========================================================================
//  2b. Cần xử lý
// ===========================================================================

const QUEUE_ITEMS: Array<{
  key: keyof Reconciliation['queue'];
  label: string;
  icon: string;
  tone: 'error' | 'warning' | 'primary' | 'success';
  to: string;
}> = [
  {
    key: 'missingCheckOut',
    label: 'Thiếu check-out',
    icon: 'logout',
    tone: 'error',
    to: '/attendance?filter=missing-punch',
  },
  {
    key: 'makeupPending',
    label: 'Đơn bổ sung công',
    icon: 'edit_calendar',
    tone: 'warning',
    to: '/requests?tab=pending&type=MAKEUP',
  },
  {
    key: 'otPending',
    label: 'Đơn OT chờ xử lý',
    icon: 'more_time',
    tone: 'primary',
    to: '/requests?tab=pending&type=OT_REGISTER',
  },
  {
    key: 'leaveApproved',
    label: 'Nghỉ phép đã duyệt trong kỳ',
    icon: 'event_available',
    tone: 'success',
    to: '/requests?tab=approved',
  },
];

type QueueTone = (typeof QUEUE_ITEMS)[number]['tone'];

const QUEUE_TONE: Record<QueueTone, { fg: string; bg: string }> = {
  error: { fg: 'var(--sf-error-700)', bg: 'var(--sf-error-50)' },
  warning: { fg: 'var(--sf-warning-700)', bg: 'var(--sf-warning-50)' },
  primary: { fg: 'var(--sf-blue-700)', bg: 'var(--sf-blue-50)' },
  success: { fg: 'var(--sf-success-700)', bg: 'var(--sf-success-50)' },
};

function QueuePanel({ data, loading }: { data?: Reconciliation; loading: boolean }) {
  if (loading) return <CardSkeleton height={300} />;

  const queue = data?.queue;

  return (
    <Panel title="Cần xử lý hôm nay" padding={0}>
      <ul className="sf-queue">
        {QUEUE_ITEMS.map((item) => {
          const count = queue?.[item.key] ?? 0;
          const palette = QUEUE_TONE[item.tone];
          return (
            <li key={item.key}>
              {/*
                Cả dòng là một liên kết, không chỉ con số. Vùng bấm 44px theo
                docs/16 mục 8, và người dùng nhắm vào chữ chứ không nhắm vào số.
              */}
              <Link to={item.to} className="sf-queue__row">
                <span className="sf-queue__icon" style={{ background: palette.bg }}>
                  <Icon name={item.icon} size={18} color={palette.fg} />
                </span>
                <span className="sf-body-md" style={{ flex: 1 }}>
                  {item.label}
                </span>
                <span
                  className="sf-title-sm"
                  style={{ color: count > 0 ? palette.fg : 'var(--sf-on-surface-muted)' }}
                >
                  {formatNumber(count)}
                </span>
                <Icon name="chevron_right" size={18} color="var(--sf-on-surface-muted)" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ===========================================================================
//  2c. Tình trạng kỳ công
// ===========================================================================

/** Máy trạng thái kỳ công — `docs/13` §5.4. Nhãn nói AI đang phải làm gì tiếp. */
const PERIOD_NEXT: Record<string, { label: string; tone: 'warning' | 'success' | 'teal' }> = {
  OPEN: { label: 'Kế toán đang tổng hợp công', tone: 'teal' },
  CALCULATING: { label: 'Hệ thống đang tính lại toàn kỳ', tone: 'teal' },
  PENDING_APPROVAL: { label: 'Chờ Giám đốc duyệt chốt', tone: 'warning' },
  LOCKED: { label: 'Đã chốt — số liệu không sửa được nữa', tone: 'success' },
  REOPENED: { label: 'Đã mở lại — Kế toán sửa rồi gửi duyệt lần nữa', tone: 'warning' },
};

function PeriodPanel({
  data,
  loading,
  timezone,
}: {
  data?: Reconciliation;
  loading: boolean;
  timezone: string;
}) {
  if (loading) return <CardSkeleton height={300} />;

  const period = data?.period;
  if (!period) {
    return (
      <Panel title="Tình trạng kỳ công">
        <EmptyState
          icon="calendar_month"
          title="Chưa có kỳ công"
          description="Tạo kỳ công đầu tiên ở màn hình Bảng công để bắt đầu tổng hợp."
        />
      </Panel>
    );
  }

  const total = data?.totals.totalEmployees ?? 0;
  const settled = data?.totals.settled ?? 0;
  const percent = total > 0 ? Math.round((settled / total) * 100) : 0;
  const next = PERIOD_NEXT[period.status] ?? { label: period.status, tone: 'teal' as const };

  return (
    <Panel title="Tình trạng kỳ công">
      <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
        <Donut percent={percent} />

        <div style={{ textAlign: 'center' }}>
          <div className="sf-title-sm">
            {formatNumber(settled)}
            <span className="sf-text-variant" style={{ fontWeight: 400 }}>
              {' / '}
              {formatNumber(total)} nhân viên
            </span>
          </div>
          <div className="sf-body-sm sf-text-variant">đã tổng hợp xong</div>
        </div>

        <div className="sf-period-deadline">
          <span className="sf-label-md sf-text-variant">Hạn chốt công</span>
          <span className="sf-title-sm">{formatDay(period.endDate, timezone)}</span>
        </div>

        <Badge tone={next.tone}>{next.label}</Badge>

        <LinkButton variant="primary" to="/attendance" iconAfter="arrow_forward" block>
          Vào bảng công
        </LinkButton>
      </div>
    </Panel>
  );
}

/**
 * Vòng tròn tiến độ vẽ bằng SVG thuần.
 *
 * Không dùng `RadialBarChart` của Recharts cho một con số duy nhất: nó kéo theo
 * cả bộ máy trục, tooltip và `ResponsiveContainer` để vẽ đúng một cung tròn, và
 * `ResponsiveContainer` cần chiều cao cố định của cha mới đo được — thứ hay hỏng
 * âm thầm khi bố cục đổi.
 */
function Donut({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(Math.max(percent, 0), 100) / 100) * circumference;

  return (
    <svg
      width={132}
      height={132}
      viewBox="0 0 132 132"
      role="img"
      aria-label={`Đã tổng hợp ${percent}%`}
    >
      <circle
        cx={66}
        cy={66}
        r={radius}
        fill="none"
        stroke="var(--sf-neutral-200)"
        strokeWidth={12}
      />
      <circle
        cx={66}
        cy={66}
        r={radius}
        fill="none"
        stroke="var(--sf-success-600)"
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        transform="rotate(-90 66 66)"
      />
      <text
        x={66}
        y={66}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: 28, fontWeight: 700, fill: 'var(--sf-on-surface)' }}
      >
        {percent}%
      </text>
    </svg>
  );
}

// ===========================================================================
//  3a. Bảng cần đối soát
// ===========================================================================

const ISSUE_LABEL: Record<ReconcileIssue, { text: string; tone: 'error' | 'warning' | 'neutral' }> =
  {
    MISSING_CHECK_OUT: { text: 'Thiếu check-out', tone: 'error' },
    MISSING_CHECK_IN: { text: 'Thiếu check-in', tone: 'error' },
    FRAUD_FLAG: { text: 'Có cờ nghi vấn', tone: 'warning' },
    INSUFFICIENT: { text: 'Thiếu công', tone: 'warning' },
    NO_RECORD: { text: 'Không có dữ liệu', tone: 'neutral' },
  };

/** "HCVP (08:00 - 17:30)" — đúng cách Kế toán gọi tên một ca trong bảng công. */
function shiftLabel(row: ReconciliationRow): string {
  const name = row.shiftCode ?? row.shiftName;
  if (!name) return '—';
  if (!row.shiftStartTime || !row.shiftEndTime) return name;
  return `${name} (${row.shiftStartTime} - ${row.shiftEndTime})`;
}

function NeedsReviewPanel({
  data,
  loading,
  timezone,
}: {
  data?: Reconciliation;
  loading: boolean;
  timezone: string;
}) {
  const rows = data?.needsReviewList ?? [];
  /*
   * Hạn xử lý = hạn chốt kỳ. Không có cột hạn riêng cho từng ngày công, và bịa
   * một hạn riêng cho mỗi dòng sẽ là con số duy nhất trên màn hình này không
   * truy được về đâu. Mọi dòng chung một hạn vì thực tế đúng như vậy: xong hết
   * trước ngày chốt thì mới chốt được kỳ.
   */
  const dueDate = data?.period?.endDate;

  const columns: ColumnsType<ReconciliationRow> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      width: 190,
      fixed: 'left',
      render: (_, row) => (
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            {row.fullName}
          </div>
          <div className="sf-body-sm sf-text-variant">
            {row.employeeCode}
            {row.department ? ` · ${row.department}` : ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Vấn đề',
      key: 'issue',
      width: 140,
      render: (_, row) => {
        const issue = ISSUE_LABEL[row.issue];
        return (
          <Badge tone={issue.tone} soft>
            {issue.text}
          </Badge>
        );
      },
    },
    {
      title: 'Ca làm việc',
      key: 'shift',
      width: 165,
      render: (_, row) => <span className="sf-body-sm">{shiftLabel(row)}</span>,
    },
    {
      title: 'Ngày công',
      key: 'workDate',
      width: 100,
      render: (_, row) => formatDay(row.workDate, timezone),
    },
    {
      title: 'Hạn xử lý',
      key: 'dueDate',
      width: 100,
      render: () => (
        <span className="sf-body-sm sf-text-variant">
          {dueDate ? formatDay(dueDate, timezone) : '—'}
        </span>
      ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 104,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        // `sf-nowrap`: cot dinh ben phai chi rong bang `width`, va khong co no
        // thi "Xem chi tiet" gay lam hai dong, keo cao moi dong cua ca bang.
        <Link
          className="sf-nowrap"
          to={`/attendance?employeeId=${row.employeeId}&date=${row.workDate}`}
        >
          Xem chi tiết
        </Link>
      ),
    },
  ];

  return (
    <Panel
      title="Nhân viên cần đối soát"
      padding={0}
      extra={
        rows.length > 0 ? (
          <Link to="/attendance?filter=needs-review" className="sf-body-sm">
            Xem tất cả
          </Link>
        ) : null
      }
    >
      {/*
        Cuộn CẢ HAI CHIỀU và cố định hai cột đầu/cuối. Sáu cột trong một ô rộng
        chưa tới nửa màn hình thì không có cách nào vừa: `x: max-content` cho
        phép kéo ngang mà không bóp chữ, `y` cố định giữ chiều cao khối bằng hai
        khối bên cạnh thay vì để nó kéo dài cả trang. Cột "Nhân viên" và "Thao
        tác" dính lại vì kéo ngang mà mất tên người thì không biết đang đọc dòng
        của ai, còn mất nút thì phải kéo ngược lại mới bấm được.
      */}
      <Table
        rowKey={(row) => `${row.employeeId}-${row.workDate}`}
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={
          rows.length > 6
            ? {
                pageSize: 6,
                size: 'small',
                showSizeChanger: true,
                pageSizeOptions: [6, 10, 20, 50],
                // 39 ket qua chia 6 dong la 7 nut trang — qua nhieu cho mot the
                // rong ~660px. `showLessItems` rut gon thanh "1 … 4 5 6 … 7".
                showLessItems: true,
                showTotal: (total, [from, to]) => `Hiển thị ${from}–${to} của ${total} kết quả`,
              }
            : false
        }
        scroll={{ x: 'max-content', y: 320 }}
        locale={{
          emptyText: (
            <EmptyState
              icon="verified"
              title="Không còn ai phải đối soát"
              description="Mọi ngày công trong kỳ đều đã có đủ dữ liệu và không vướng cờ nghi vấn."
            />
          ),
        }}
      />
    </Panel>
  );
}

// ===========================================================================
//  3b. Lịch trình chốt lương
// ===========================================================================

const MILESTONE_LABEL: Record<PayrollMilestone['key'], { label: string; icon: string }> = {
  CLOSE: { label: 'Chốt công', icon: 'lock_clock' },
  REVIEW: { label: 'Kiểm tra & đối soát', icon: 'fact_check' },
  CALCULATE: { label: 'Tính lương', icon: 'calculate' },
  PAYOUT: { label: 'Chi trả lương', icon: 'payments' },
};

function PayrollSchedulePanel({
  data,
  loading,
  timezone,
}: {
  data?: Reconciliation;
  loading: boolean;
  timezone: string;
}) {
  if (loading) return <CardSkeleton height={260} />;

  const milestones = data?.payrollSchedule ?? [];

  return (
    <Panel title="Lịch trình chốt lương sắp tới">
      {milestones.length === 0 ? (
        <EmptyState
          icon="event"
          title="Chưa có kỳ công"
          description="Lịch xuất hiện khi kỳ công đầu tiên được tạo."
        />
      ) : (
        <>
          <ol className="sf-timeline">
            {milestones.map((milestone) => {
              const meta = MILESTONE_LABEL[milestone.key];
              const range =
                milestone.fromDate === milestone.toDate
                  ? formatDay(milestone.fromDate, timezone)
                  : `${formatDay(milestone.fromDate, timezone)} – ${formatDay(milestone.toDate, timezone)}`;

              return (
                <li
                  key={milestone.key}
                  className={`sf-timeline__item sf-timeline__item--${milestone.state.toLowerCase()}`}
                >
                  <span className="sf-timeline__dot" aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div className="sf-body-md sf-timeline__label">
                      <Icon name={meta.icon} size={16} />
                      {meta.label}
                    </div>
                    <div className="sf-body-sm sf-text-variant sf-timeline__range">{range}</div>
                  </div>
                </li>
              );
            })}
          </ol>

          {/*
            Chữ "dự kiến" không phải để rào trước. Bốn ngày này suy ra từ chính
            sách chứ không phải việc đã xảy ra, và một ngày chi trả lương là thứ
            người dùng sẽ tin rồi lập kế hoạch theo — phải nói rõ nó đến từ đâu
            và sửa được ở đâu.
          */}
          <p className="sf-body-sm sf-text-variant" style={{ margin: '12px 0 0' }}>
            Lịch dự kiến, tính từ ngày cuối kỳ ·{' '}
            <Link to="/policy?tab=values" className="sf-nowrap">
              Đổi ở Chính sách
            </Link>
          </p>
        </>
      )}
    </Panel>
  );
}

// ===========================================================================
//  3c. OT & phép
// ===========================================================================

function OtLeavePanel({ data, loading }: { data?: Reconciliation; loading: boolean }) {
  if (loading) return <CardSkeleton height={260} />;

  const totals = data?.otLeave;
  const otMinutes = totals?.otMinutes ?? 0;
  const workedMinutes = totals?.workedMinutes ?? 0;
  const standardDays = totals?.standardDays ?? 0;
  const leaveDays = totals?.leaveDays ?? 0;

  return (
    <Panel title="Tình hình OT & phép">
      <ul className="sf-gauge-list">
        {/*
          Mỗi thanh phải có mẫu số nói được thành lời, nếu không nó chỉ là một
          vệt màu trang trí. OT so với tổng giờ làm, phép so với tổng công chuẩn
          — hai tỷ lệ này Kế toán đọc được ngay mà không cần chú thích. Dòng
          "Tổng công chuẩn" KHÔNG có thanh vì nó chính là mẫu số, không phải một
          phần của cái gì.
        */}
        <MeterRow
          icon="more_time"
          tone="primary"
          label="OT đã duyệt"
          value={formatMinutes(otMinutes)}
          percent={percentOf(otMinutes, workedMinutes)}
          hint="trên tổng giờ làm trong kỳ"
        />
        <MeterRow
          icon="event_available"
          tone="success"
          label="Phép đã dùng"
          value={`${formatNumber(leaveDays)} ngày`}
          percent={percentOf(leaveDays, standardDays)}
          hint="trên tổng công chuẩn của kỳ"
        />
        <MeterRow
          icon="fact_check"
          tone="neutral"
          label="Tổng công chuẩn"
          value={`${formatNumber(standardDays)} công`}
          hint="số công quy đổi của toàn bộ nhân viên"
        />
      </ul>
    </Panel>
  );
}

function MeterRow({
  icon,
  tone,
  label,
  value,
  hint,
  percent,
}: {
  icon: string;
  tone: 'primary' | 'success' | 'neutral';
  label: string;
  value: string;
  hint: string;
  /** Bỏ trống ở dòng KHÔNG có mẫu số thật — không thanh còn hơn thanh bịa. */
  percent?: number;
}) {
  const color = {
    primary: 'var(--sf-blue-700)',
    success: 'var(--sf-success-700)',
    neutral: 'var(--sf-on-surface-variant)',
  }[tone];

  const width = Math.min(Math.max(percent ?? 0, 0), 100);

  return (
    <li className="sf-gauge">
      <div className="sf-gauge__head">
        <Icon name={icon} size={16} color={color} />
        <span className="sf-body-md" style={{ minWidth: 0 }}>
          {label}
        </span>
        <span className="sf-title-sm sf-gauge__value" style={{ color }}>
          {value}
        </span>
      </div>

      {percent === undefined ? null : (
        <div
          className="sf-gauge__track"
          role="progressbar"
          aria-label={label}
          aria-valuenow={width}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="sf-gauge__fill" style={{ width: `${width}%`, background: color }} />
        </div>
      )}

      <div className="sf-gauge__foot sf-body-sm sf-text-variant">
        <span>{hint}</span>
        {percent === undefined ? null : (
          <span className="sf-gauge__percent" style={{ color }}>
            {percent}%
          </span>
        )}
      </div>
    </li>
  );
}

// ===========================================================================
//  4. Hoạt động gần đây
// ===========================================================================

function ActivityPanel({
  items,
  loading,
  timezone,
}: {
  items: Array<{
    id: string;
    action: string;
    actorName?: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  loading: boolean;
  timezone: string;
}) {
  if (loading) return <CardSkeleton height={180} />;

  return (
    <Panel
      title="Hoạt động gần đây"
      extra={
        <Link to="/policy?tab=audit" className="sf-body-sm">
          Xem tất cả
        </Link>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon="history"
          title="Chưa có thao tác nào được ghi nhận"
          description="Mọi thay đổi trên dữ liệu công đều xuất hiện ở đây kèm người thực hiện và lý do."
        />
      ) : (
        /*
          Hàng ngang chứ không phải danh sách dọc: khối này nằm cuối trang và
          chỉ là dấu vết để liếc qua. Xếp dọc thì sáu dòng chiếm trọn một màn
          hình cuộn cho thứ không ai đọc kỹ.
        */
        <ul className="sf-activity-grid">
          {items.slice(0, 3).map((entry) => (
            <li key={entry.id} className="sf-activity-card">
              <span className="sf-activity-card__icon">
                <Icon name="history" size={18} color="var(--sf-blue-700)" />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="sf-body-md sf-activity-card__title">
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </div>
                <div className="sf-body-sm sf-text-variant sf-activity-card__meta">
                  {entry.actorName ?? 'Hệ thống'}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </div>
                <div className="sf-body-sm sf-text-variant">
                  {formatTime(entry.createdAt, timezone)} · {formatDay(entry.createdAt, timezone)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
