import { Link } from 'react-router-dom';
import { Button } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { StatCardSkeleton, CardSkeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge, severityTone } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/lib/auth/auth-context';
import {
  formatMinutes,
  firstDayOfMonth,
  lastDayOfMonth,
  formatTime,
  formatDay,
} from '@/lib/utils/date';
import { formatNumber } from '@/lib/utils/format';
import { FRAUD_CODE_LABEL, FRAUD_SEVERITY_LABEL } from '@/config/constants';
import { useDashboard, useDashboardAlerts, useAttendanceTrend } from './dashboard.api';
import { ApiErrorState } from '@/components/ApiErrorState';

/**
 * Dashboard tổng quan — docs/04 mục 2 (`FR-WEB-DASH-01..06`).
 *
 * Bố cục bám sát sơ đồ ở mục 2.1: hàng thẻ chỉ số → khối cảnh báo bất thường →
 * biểu đồ chuyên cần. Thứ tự này không tuỳ tiện: cảnh báo đứng trên biểu đồ vì
 * nó là thứ cần HÀNH ĐỘNG trong ngày, còn biểu đồ chỉ để nắm xu hướng.
 */
export function DashboardPage() {
  const { company, timezone } = useAuth();
  const summary = useDashboard();
  const alerts = useDashboardAlerts();

  const from = firstDayOfMonth(timezone);
  const to = lastDayOfMonth(timezone);
  const trend = useAttendanceTrend(from, to);

  const data = summary.data;

  return (
    <>
      <PageHeader
        title="Tổng quan"
        description={
          company?.name
            ? `${company.name} · số liệu tính tới thời điểm hiện tại theo giờ ${timezone}.`
            : 'Số liệu chấm công của công ty theo thời gian thực.'
        }
        actions={
          <Button
            icon={<Icon name="refresh" size={20} />}
            onClick={() => {
              void summary.refetch();
              void alerts.refetch();
              void trend.refetch();
            }}
            loading={summary.isFetching || alerts.isFetching}
          >
            Làm mới
          </Button>
        }
      />

      {/* ── Thẻ chỉ số (FR-WEB-DASH-01..04) ───────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {summary.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Đang làm việc"
              icon="badge"
              value={formatNumber(data?.currentlyWorking)}
              suffix={`/ ${formatNumber(data?.totalEmployees)}`}
              hint="Đã chấm vào, chưa chấm ra"
            />
            <StatCard
              label="Đã chấm công hôm nay"
              icon="how_to_reg"
              value={formatNumber(data?.checkedInToday)}
              suffix={`/ ${formatNumber(data?.totalEmployees)}`}
              hint={data ? `Ngày ${formatDay(data.workDate, timezone)}` : undefined}
            />
            <StatCard
              label="Đi muộn hôm nay"
              icon="schedule"
              tone={data?.lateToday ? 'warning' : 'teal'}
              value={formatNumber(data?.lateToday)}
              to="/attendance?status=LATE"
            />
            <StatCard
              label="Đơn chờ duyệt"
              icon="assignment_late"
              tone={data?.pendingRequests ? 'warning' : 'teal'}
              value={formatNumber(data?.pendingRequests)}
              to="/requests?tab=pending"
            />
            <StatCard
              label="Tổng giờ OT trong tháng"
              icon="more_time"
              value={formatMinutes(data?.otMinutesThisMonth)}
              hint="Chỉ tính OT có đơn đã duyệt"
            />
          </>
        )}
      </div>

      {/* ── Cảnh báo bất thường (FR-WEB-DASH-05) ──────────────────────── */}
      <section style={{ marginBottom: 24 }}>
        <SectionTitle
          extra={
            <Link to="/fraud" className="sf-body-sm" style={{ fontWeight: 600 }}>
              Xem tất cả cảnh báo
            </Link>
          }
        >
          Cảnh báo bất thường hôm nay
          {alerts.data?.total ? ` (${alerts.data.total})` : ''}
        </SectionTitle>

        {alerts.isLoading ? (
          <CardSkeleton height={160} />
        ) : alerts.error ? (
          <ApiErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
        ) : !alerts.data || alerts.data.items.length === 0 ? (
          <EmptyState
            icon="verified_user"
            title="Không có cảnh báo nào hôm nay"
            description="Mọi lượt chấm công đều đạt các chốt kiểm về vị trí, thiết bị và nhận diện. Cảnh báo mới sẽ hiện ở đây ngay khi phát sinh."
          />
        ) : (
          <div
            className="sf-card"
            style={{ padding: 0, overflow: 'hidden' }}
            aria-label="Danh sách cảnh báo bất thường"
          >
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {alerts.data.items.slice(0, 6).map((alert, index) => (
                <li
                  key={alert.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: 16,
                    borderTop: index === 0 ? 'none' : '1px solid var(--sf-outline-variant)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9999,
                      background:
                        alert.severity === 'HIGH' ? 'var(--sf-error-100)' : 'var(--sf-warning-100)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon
                      name="warning"
                      size={18}
                      color={
                        alert.severity === 'HIGH' ? 'var(--sf-error-800)' : 'var(--sf-warning-800)'
                      }
                    />
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sf-body-md" style={{ fontWeight: 600 }}>
                      {FRAUD_CODE_LABEL[alert.code] ?? alert.code}
                    </div>
                    <div className="sf-body-sm sf-text-variant">
                      {alert.employee?.fullName ?? 'Không xác định'} ·{' '}
                      {formatTime(alert.createdAt, timezone)}
                    </div>
                  </div>

                  <StatusBadge tone={severityTone(alert.severity)}>
                    {FRAUD_SEVERITY_LABEL[alert.severity] ?? alert.severity}
                  </StatusBadge>

                  <Link
                    to={`/fraud?flagId=${alert.id}`}
                    className="sf-body-sm"
                    style={{ fontWeight: 700 }}
                  >
                    Xử lý
                  </Link>
                </li>
              ))}
            </ul>

            {alerts.data.total > 6 ? (
              <div
                style={{
                  padding: 12,
                  background: 'var(--sf-neutral-100)',
                  textAlign: 'center',
                }}
              >
                <Link to="/fraud" className="sf-body-sm" style={{ fontWeight: 600 }}>
                  Còn {alerts.data.total - 6} cảnh báo khác
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Chuyên cần theo ngày (FR-WEB-DASH-06) ─────────────────────── */}
      <section>
        <SectionTitle>Chuyên cần trong tháng</SectionTitle>

        {trend.isLoading ? (
          <CardSkeleton height={320} />
        ) : trend.error ? (
          <ApiErrorState error={trend.error} onRetry={() => void trend.refetch()} />
        ) : !trend.data || trend.data.length === 0 ? (
          <EmptyState
            icon="monitoring"
            title="Chưa có dữ liệu chuyên cần"
            description="Biểu đồ sẽ xuất hiện khi có ít nhất một ngày công được tính trong tháng này."
          />
        ) : (
          <div className="sf-card" style={{ height: 360, padding: 24 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend.data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--sf-neutral-200)"
                  vertical={false}
                />
                <XAxis
                  dataKey="workDate"
                  tickFormatter={(value: string) => value.slice(8)}
                  tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--sf-neutral-300)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(value: string) => `Ngày ${formatDay(value, timezone)}`}
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid var(--sf-outline-variant)',
                    fontSize: 14,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 14 }} />
                {/* Màu lấy từ ramp, không phải bảng mặc định của Recharts —
                    docs/16 nguyên tắc số 1. */}
                <Bar
                  dataKey="onTime"
                  name="Đúng giờ"
                  stackId="a"
                  fill="#17725A"
                  radius={[0, 0, 0, 0]}
                />
                <Bar dataKey="late" name="Đi muộn" stackId="a" fill="#D49D57" />
                <Bar dataKey="onLeave" name="Nghỉ phép" stackId="a" fill="#84CAB1" />
                <Bar
                  dataKey="absent"
                  name="Vắng mặt"
                  stackId="a"
                  fill="#FB6457"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </>
  );
}
