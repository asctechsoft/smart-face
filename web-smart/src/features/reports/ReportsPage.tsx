import { useState } from 'react';
import { DatePicker, InputNumber, Progress, Select, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatCard } from '@/components/StatCard';
import { CardSkeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ApiErrorState } from '@/components/ApiErrorState';
import { useAuth } from '@/lib/auth/auth-context';
import {
  firstDayOfMonth,
  formatDay,
  formatMinutes,
  lastDayOfMonth,
  toWorkDate,
} from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { formatNumber, formatPercent } from '@/lib/utils/format';
import { useAttendanceTrend } from '@/features/dashboard/dashboard.api';
import {
  useLeaveUsage,
  useOvertimeReport,
  useViolations,
  type LeaveUsageRow,
  type OvertimeReport,
  type ViolationRow,
} from './reports.api';

const { RangePicker } = DatePicker;

/**
 * Báo cáo & thống kê — docs/04 mục 9 (`FR-WEB-REP-01..06`).
 *
 * Mọi báo cáo ở đây đọc từ `AttendanceDaily` (đã tính sẵn) chứ không phải
 * `AttendanceLog` — bảng lớn nhất hệ thống (mục 9.1). Đó là quyết định ở phía
 * Backend, nhưng nó giải thích vì sao giao diện không cho lọc tới từng lượt
 * chấm công ở đây: muốn xem lượt thì sang màn hình Chấm công.
 */
export function ReportsPage() {
  const { timezone } = useAuth();
  const [from, setFrom] = useState(firstDayOfMonth(timezone));
  const [to, setTo] = useState(lastDayOfMonth(timezone));

  return (
    <>
      <PageHeader
        title="Báo cáo & thống kê"
        description="Tổng hợp chuyên cần, vi phạm, phép năm và chi phí tăng ca. Số liệu lấy từ bảng công đã tính, cập nhật sau mỗi lần chạy engine."
      />

      <FilterBar>
        <FilterField label="Khoảng ngày" width={280}>
          <RangePicker
            format="DD/MM/YYYY"
            allowClear={false}
            value={[toDayjs(from), toDayjs(to)]}
            onChange={(dates) => {
              const nextFrom = toWorkDate(dates?.[0]?.toDate());
              const nextTo = toWorkDate(dates?.[1]?.toDate());
              if (nextFrom) setFrom(nextFrom);
              if (nextTo) setTo(nextTo);
            }}
            style={{ width: '100%' }}
          />
        </FilterField>
      </FilterBar>

      <Tabs
        destroyInactiveTabPane
        items={[
          { key: 'trend', label: 'Chuyên cần', children: <TrendTab from={from} to={to} /> },
          { key: 'violations', label: 'Vi phạm', children: <ViolationsTab from={from} to={to} /> },
          { key: 'overtime', label: 'Tăng ca', children: <OvertimeTab from={from} to={to} /> },
          { key: 'leave', label: 'Phép năm', children: <LeaveUsageTab /> },
        ]}
      />
    </>
  );
}

/** FR-WEB-REP-01 — biểu đồ chuyên cần theo thời gian. */
function TrendTab({ from, to }: { from: string; to: string }) {
  const { timezone } = useAuth();
  const trend = useAttendanceTrend(from, to);

  if (trend.isLoading) return <CardSkeleton height={400} />;
  if (trend.error) {
    return <ApiErrorState error={trend.error} onRetry={() => void trend.refetch()} />;
  }
  if (!trend.data || trend.data.length === 0) {
    return (
      <EmptyState
        icon="monitoring"
        title="Chưa có dữ liệu chuyên cần"
        description="Không có ngày công nào được tính trong khoảng đã chọn. Thử mở rộng khoảng ngày hoặc chạy lại engine tính công."
      />
    );
  }

  return (
    <div className="sf-card" style={{ height: 420, padding: 24 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend.data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-neutral-200)" vertical={false} />
          <XAxis
            dataKey="workDate"
            tickFormatter={(value: string) => value.slice(8)}
            tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(value: string) => `Ngày ${formatDay(value, timezone)}`}
            contentStyle={{ borderRadius: 8, border: '1px solid var(--sf-outline-variant)' }}
          />
          <Legend wrapperStyle={{ fontSize: 14 }} />
          <Line
            type="monotone"
            dataKey="onTime"
            name="Đúng giờ"
            stroke="#17725A"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="late"
            name="Đi muộn"
            stroke="#D49D57"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="absent"
            name="Vắng mặt"
            stroke="#FB6457"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="onLeave"
            name="Nghỉ phép"
            stroke="#84CAB1"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** FR-WEB-REP-02 — nhân viên vi phạm nhiều lần. */
function ViolationsTab({ from, to }: { from: string; to: string }) {
  const [minOccurrences, setMinOccurrences] = useState(3);
  const violations = useViolations(from, to, minOccurrences);

  const columns: ColumnsType<ViolationRow> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      width: 260,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Số lần vi phạm',
      dataIndex: 'violationCount',
      key: 'count',
      width: 150,
      align: 'right',
      sorter: (a, b) => a.violationCount - b.violationCount,
      defaultSortOrder: 'descend',
      render: (value: number) => (
        <span style={{ fontWeight: 700, color: 'var(--sf-warning-800)' }}>{value}</span>
      ),
    },
    {
      title: 'Tổng phút muộn',
      dataIndex: 'lateMinutesTotal',
      key: 'late',
      width: 160,
      align: 'right',
      render: (value: number) => formatMinutes(value),
    },
    {
      title: 'Tổng phút về sớm',
      dataIndex: 'earlyLeaveMinutesTotal',
      key: 'early',
      width: 160,
      align: 'right',
      render: (value: number) => formatMinutes(value),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label className="sf-field__label" htmlFor="min-occ">
          Ngưỡng số lần vi phạm
        </label>
        <InputNumber
          id="min-occ"
          min={1}
          max={31}
          value={minOccurrences}
          onChange={(value) => setMinOccurrences(value ?? 3)}
        />
        <span className="sf-body-sm sf-text-variant">
          Chỉ hiện nhân viên vi phạm từ {minOccurrences} lần trở lên trong khoảng đã chọn.
        </span>
      </div>

      <DataTable<ViolationRow>
        rowKey={(row) => row.employee?.id ?? Math.random().toString()}
        data={violations.data}
        isLoading={violations.isLoading}
        error={violations.error}
        onRetry={() => void violations.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="thumb_up"
        emptyTitle="Không có nhân viên nào vượt ngưỡng vi phạm"
        emptyDescription={`Không ai vi phạm từ ${minOccurrences} lần trở lên trong khoảng này. Hạ ngưỡng xuống nếu muốn xem danh sách rộng hơn.`}
      />
    </div>
  );
}

/** FR-WEB-REP-05 — tổng hợp OT theo nhân viên và phòng ban. */
function OvertimeTab({ from, to }: { from: string; to: string }) {
  const overtime = useOvertimeReport(from, to);

  if (overtime.isLoading) return <CardSkeleton height={400} />;
  if (overtime.error) {
    return <ApiErrorState error={overtime.error} onRetry={() => void overtime.refetch()} />;
  }
  if (!overtime.data || overtime.data.totalOtMinutes === 0) {
    return (
      <EmptyState
        icon="more_time"
        title="Không có giờ tăng ca trong khoảng này"
        description="Chỉ giờ làm ngoài ca CÓ ĐƠN OT ĐÃ DUYỆT mới được tính là tăng ca. Kiểm tra lại chính sách nếu bạn cho rằng con số này không đúng."
      />
    );
  }

  const data: OvertimeReport = overtime.data;

  const employeeColumns: ColumnsType<OvertimeReport['byEmployee'][number]> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      width: 280,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Giờ OT',
      dataIndex: 'otMinutes',
      key: 'ot',
      width: 140,
      align: 'right',
      render: (value: number) => <span style={{ fontWeight: 600 }}>{formatMinutes(value)}</span>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        <StatCard label="Tổng giờ OT" value={formatMinutes(data.totalOtMinutes)} icon="more_time" />
        <StatCard
          label="Số nhân viên có OT"
          value={formatNumber(data.byEmployee.length)}
          icon="group"
        />
        <StatCard
          label="Phòng ban có OT cao nhất"
          value={data.byDepartment[0]?.name ?? '—'}
          tone="warning"
          icon="apartment"
          hint={data.byDepartment[0] ? formatMinutes(data.byDepartment[0].otMinutes) : undefined}
        />
      </div>

      <section>
        <SectionTitle>OT theo phòng ban</SectionTitle>
        <div className="sf-card" style={{ height: 320, padding: 24 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.byDepartment.map((row) => ({ ...row, otHours: row.otMinutes / 60 }))}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 24, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--sf-neutral-200)"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fill: 'var(--sf-neutral-700)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number) => [`${value.toFixed(1)} giờ`, 'Tổng OT']}
                contentStyle={{ borderRadius: 8, border: '1px solid var(--sf-outline-variant)' }}
              />
              <Bar dataKey="otHours" radius={[0, 4, 4, 0]}>
                {/* Tô đậm dần theo thứ hạng để mắt bắt được phòng ban tốn OT
                    nhất mà không cần đọc số. */}
                {data.byDepartment.map((_, index) => (
                  <Cell
                    key={index}
                    fill={index === 0 ? '#005440' : index < 3 ? '#398F75' : '#84CAB1'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <SectionTitle>OT theo nhân viên</SectionTitle>
        <DataTable
          rowKey={(row) => row.employee?.id ?? Math.random().toString()}
          data={data.byEmployee.slice(0, 50)}
          isLoading={false}
          columns={employeeColumns}
          pagination={false}
          emptyTitle="Không có dữ liệu"
          emptyDescription="Không có nhân viên nào phát sinh OT trong khoảng này."
        />
      </section>
    </div>
  );
}

/** FR-WEB-REP-03 — báo cáo sử dụng phép năm. */
function LeaveUsageTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const usage = useLeaveUsage(year);

  const columns: ColumnsType<LeaveUsageRow> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      width: 260,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Được hưởng',
      dataIndex: 'entitledDays',
      key: 'entitled',
      width: 130,
      align: 'right',
      render: (value: number) => `${formatNumber(value, 1)} ngày`,
    },
    {
      title: 'Đã dùng',
      dataIndex: 'usedDays',
      key: 'used',
      width: 120,
      align: 'right',
      render: (value: number) => `${formatNumber(value, 1)} ngày`,
    },
    {
      title: 'Đang chờ duyệt',
      dataIndex: 'pendingDays',
      key: 'pending',
      width: 150,
      align: 'right',
      render: (value: number) =>
        value > 0 ? (
          <span style={{ color: 'var(--sf-warning-800)' }}>{formatNumber(value, 1)} ngày</span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'Còn lại',
      dataIndex: 'remainingDays',
      key: 'remaining',
      width: 120,
      align: 'right',
      render: (value: number) => (
        <span style={{ fontWeight: 700, color: 'var(--sf-teal-700)' }}>
          {formatNumber(value, 1)} ngày
        </span>
      ),
    },
    {
      title: 'Tỷ lệ sử dụng',
      dataIndex: 'usageRate',
      key: 'rate',
      width: 200,
      render: (value: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            percent={Math.min(value, 100)}
            size="small"
            showInfo={false}
            strokeColor={value > 90 ? 'var(--sf-warning-700)' : 'var(--sf-teal-700)'}
            style={{ flex: 1, margin: 0 }}
          />
          <span className="sf-body-sm" style={{ minWidth: 40 }}>
            {formatPercent(value)}
          </span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Select
          value={year}
          onChange={setYear}
          style={{ width: 140 }}
          aria-label="Chọn năm"
          options={Array.from({ length: 4 }, (_, index) => {
            const value = new Date().getFullYear() - index;
            return { value, label: `Năm ${value}` };
          })}
        />
      </div>

      <DataTable<LeaveUsageRow>
        rowKey={(row) => row.employee?.id ?? Math.random().toString()}
        data={usage.data}
        isLoading={usage.isLoading}
        error={usage.error}
        onRetry={() => void usage.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="beach_access"
        emptyTitle={`Chưa có dữ liệu phép năm ${year}`}
        emptyDescription="Số phép năm được cấp phát theo chính sách công ty. Kiểm tra lại cấu hình phép năm nếu bảng này trống bất thường."
      />
    </div>
  );
}
