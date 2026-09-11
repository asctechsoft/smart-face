import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/PageHeader';
import { ApiErrorState } from '@/components/ApiErrorState';
import { formatDay } from '@/lib/utils/date';
import { formatNumber } from '@/lib/utils/format';
import {
  CardSkeleton,
  EmptyState,
  Icon,
  LinkButton,
  StatCard,
  StatCardSkeleton,
} from '@/components/ui';
import { usePlatformOverview, type PlatformOverview } from './platform.api';

/**
 * Tổng quan hệ thống — màn hình đầu tiên của Quản trị nền tảng.
 * Bố cục theo mockup Figma `72:7`.
 *
 * ## Ranh giới #2 của `docs/08` §1.1, thể hiện bằng chính nội dung màn hình
 *
 * Mọi con số ở đây đếm CÔNG TY và TÀI KHOẢN. Không có một con số nghiệp vụ nào
 * — không giờ công, không đơn từ, không cảnh báo gian lận — vì Quản trị nền
 * tảng không được nhìn vào dữ liệu bên trong tenant. Muốn nhìn thì phải mở
 * phiên hỗ trợ có mã phiếu và lý do, và việc đó có màn hình riêng.
 *
 * Đây cũng là lý do màn hình này KHÔNG dùng lại `DashboardPage`: hai màn hình
 * trông giống nhau nhưng trả lời hai câu hỏi thuộc hai tầng khác nhau, và gộp
 * chúng là mở một đường để số liệu tenant rò sang màn nền tảng.
 */
export function PlatformOverviewPage() {
  const overview = usePlatformOverview();

  if (overview.error) {
    return <ApiErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  }

  const data = overview.data;

  return (
    <>
      <PageHeader
        title="Tổng quan hệ thống"
        description="Theo dõi công ty, tài khoản quản trị và hoạt động nền tảng SmartFace."
        actions={
          <LinkButton to="/system/tenants/new" variant="primary" icon="add_business">
            Tạo công ty
          </LinkButton>
        }
      />

      <div style={{ display: 'grid', gap: 24 }}>
        <div className="sf-stat-row">
          {overview.isPending ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <StatCard
                icon="domain"
                tone="primary"
                label="Tổng số công ty"
                value={formatNumber(data?.totals.companies)}
                hint="chưa xoá"
                to="/system/tenants"
              />
              <StatCard
                icon="verified"
                tone="success"
                label="Đang hoạt động"
                value={formatNumber(data?.totals.active)}
                hint="đã kích hoạt dịch vụ"
              />
              <StatCard
                icon="hourglass_top"
                tone="warning"
                label="Đang dùng thử"
                value={formatNumber(data?.totals.trial)}
                hint="chưa chuyển sang trả phí"
              />
              <StatCard
                icon="pause_circle"
                tone="error"
                label="Tạm ngưng"
                value={formatNumber(data?.totals.suspended)}
                hint="không đăng nhập được, dữ liệu giữ nguyên"
              />
              <StatCard
                icon="group"
                tone="neutral"
                label="Tổng người dùng"
                value={formatNumber(data?.totals.users)}
                hint="tài khoản trên toàn nền tảng"
              />
            </>
          )}
        </div>

        <div className="sf-dash-row sf-dash-row--top">
          <CreatedChart data={data} loading={overview.isPending} />
          <StatusBreakdown data={data} loading={overview.isPending} />
          <PlanBreakdown data={data} loading={overview.isPending} />
        </div>
      </div>
    </>
  );
}

// ===========================================================================

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">{title}</h2>
      </header>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  );
}

function CreatedChart({ data, loading }: { data?: PlatformOverview; loading: boolean }) {
  if (loading) return <CardSkeleton height={300} />;

  const points = data?.createdPerDay ?? [];
  const total = points.reduce((sum, point) => sum + point.count, 0);

  return (
    <Panel title="Công ty khởi tạo 30 ngày gần đây">
      {total === 0 ? (
        <EmptyState
          icon="add_business"
          title="Chưa có công ty nào được tạo trong 30 ngày"
          description="Biểu đồ hiện lên ngay khi có công ty đầu tiên trong khoảng này."
        />
      ) : (
        <div style={{ height: 230 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="sf-created" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--sf-blue-600)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--sf-blue-600)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-neutral-200)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={(value: string) => value.slice(8)}
                tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--sf-neutral-300)' }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip
                labelFormatter={(value: string) => `Ngày ${formatDay(value)}`}
                formatter={(value: number) => [`${value} công ty`, 'Khởi tạo']}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid var(--sf-outline-variant)',
                  fontSize: 14,
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--sf-blue-600)"
                strokeWidth={2.5}
                fill="url(#sf-created)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/** Nhãn và tông của từng trạng thái công ty — `docs/05` §1.1. */
const STATUS_ROWS: Array<{ key: string; label: string; color: string }> = [
  { key: 'ACTIVE', label: 'Đang hoạt động', color: 'var(--sf-success-600)' },
  { key: 'TRIAL', label: 'Đang dùng thử', color: 'var(--sf-warning-600)' },
  { key: 'SUSPENDED', label: 'Tạm ngưng', color: 'var(--sf-error-600)' },
  { key: 'TERMINATED', label: 'Đã chấm dứt', color: 'var(--sf-neutral-400)' },
];

function StatusBreakdown({ data, loading }: { data?: PlatformOverview; loading: boolean }) {
  if (loading) return <CardSkeleton height={300} />;

  const total = data?.totals.companies ?? 0;

  return (
    <Panel title="Tình trạng công ty">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
        {STATUS_ROWS.map((row) => {
          const count = data?.byStatus[row.key] ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
          return (
            <li key={row.key}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: row.color,
                    flex: 'none',
                  }}
                />
                <span className="sf-body-md" style={{ flex: 1 }}>
                  {row.label}
                </span>
                <span className="sf-title-sm">{formatNumber(count)}</span>
                <span className="sf-body-sm sf-text-variant">{percent}%</span>
              </div>
              {/*
                Thanh tỉ lệ thay cho biểu đồ tròn của mockup.

                Bốn phần trên một hình tròn thì hai phần nhỏ (3% và 6%) trở thành
                hai vệt mỏng không so được với nhau. Thanh ngang giữ nguyên khả
                năng so sánh ở mọi tỉ lệ, và đọc được cả khi chỉ có một trạng thái.
              */}
              <div className="sf-meter" role="presentation">
                <span style={{ width: `${percent}%`, background: row.color }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function PlanBreakdown({ data, loading }: { data?: PlatformOverview; loading: boolean }) {
  if (loading) return <CardSkeleton height={300} />;

  const rows = [...(data?.byPlan ?? [])].sort((a, b) => b.count - a.count);

  return (
    <Panel title="Gói dịch vụ đang dùng">
      {rows.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title="Chưa có công ty nào"
          description="Phân bố gói dịch vụ hiện lên khi có công ty đầu tiên."
        />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((row) => (
            <li key={row.planId ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                className="sf-stat-medallion"
                style={{
                  width: 36,
                  height: 36,
                  background: row.planId ? 'var(--sf-blue-50)' : 'var(--sf-warning-50)',
                }}
              >
                <Icon
                  name={row.planId ? 'inventory_2' : 'help'}
                  size={20}
                  color={row.planId ? 'var(--sf-blue-700)' : 'var(--sf-warning-700)'}
                />
              </span>
              <span className="sf-body-md" style={{ flex: 1 }}>
                {row.name}
              </span>
              <span className="sf-title-sm">{formatNumber(row.count)}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 16 }}>
        <Link to="/system/packages" className="sf-body-sm">
          Quản lý gói dịch vụ
        </Link>
      </div>
    </Panel>
  );
}
