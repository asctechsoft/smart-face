import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DatePicker, Input, Select, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDateTime, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { DEFAULT_PAGE_SIZE } from '@/config/constants';
import { ACTION_LABEL, TARGET_LABEL, diffLines } from './audit-labels';

const { RangePicker } = DatePicker;

interface AuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string;
  actorName?: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

/**
 * Nhật ký kiểm toán — `BR-08`, `FR-WEB-NOT-06`.
 *
 * Đây là màn hình được mở khi có tranh chấp: "ai sửa giờ vào của tôi", "ai chốt
 * kỳ khi đơn tôi còn chờ". Vì vậy cột quan trọng nhất không phải hành động mà
 * là LÝ DO và cặp giá trị cũ → mới. Ẩn chúng sau một nút "xem chi tiết" là bắt
 * người ta bấm 50 lần để tìm một dòng.
 */
export function AuditLogPage() {
  const { timezone } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
      action: searchParams.get('action') ?? undefined,
      targetType: searchParams.get('targetType') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      q: searchParams.get('q') ?? undefined,
    }),
    [searchParams],
  );

  const logs = useQuery({
    queryKey: qk.auditLogs(query),
    queryFn: () => api.getPaginated<AuditLog>('/admin/audit-logs', { ...query }),
    placeholderData: (previous) => previous,
  });

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const columns: ColumnsType<AuditLog> = [
    {
      title: 'Thời điểm',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      fixed: 'left',
      render: (value: string) => formatDateTime(value, timezone),
    },
    {
      title: 'Hành động',
      dataIndex: 'action',
      key: 'action',
      width: 200,
      render: (value: string) => <Tag>{ACTION_LABEL[value] ?? value}</Tag>,
    },
    {
      title: 'Người thực hiện',
      key: 'actor',
      width: 180,
      render: (_, row) => row.actorName ?? row.actorUserId.slice(0, 12),
    },
    {
      title: 'Đối tượng',
      key: 'target',
      width: 200,
      render: (_, row) =>
        row.targetType ? (
          <div>
            <div className="sf-body-sm">{TARGET_LABEL[row.targetType] ?? row.targetType}</div>
            {row.targetId ? <div className="sf-caption">{row.targetId.slice(0, 12)}…</div> : null}
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: 'Lý do',
      dataIndex: 'reason',
      key: 'reason',
      width: 300,
      render: (value: string | null) =>
        value ? (
          <Typography.Paragraph ellipsis={{ rows: 2, tooltip: value }} style={{ marginBottom: 0 }}>
            {value}
          </Typography.Paragraph>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'Thay đổi',
      key: 'diff',
      width: 320,
      render: (_, row) =>
        row.before || row.after ? (
          <div className="sf-body-sm" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {diffLines(row.before, row.after).map((line) => (
              <div key={line.key}>
                <span className="sf-text-variant">{line.key}: </span>
                <span style={{ color: 'var(--sf-error-700)' }}>{line.before}</span>
                {' → '}
                <span style={{ color: 'var(--sf-success-800)' }}>{line.after}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'IP',
      dataIndex: 'ipAddress',
      key: 'ip',
      width: 140,
      render: (value: string | null) => value ?? '—',
    },
  ];

  const activeFilters = ['action', 'targetType', 'from', 'to', 'q'].filter((key) =>
    searchParams.get(key),
  ).length;

  return (
    <>
      <PageHeader
        title="Nhật ký kiểm toán"
        description="Mọi thao tác ảnh hưởng tới dữ liệu công và lương đều để lại dấu vết: ai làm, làm gì, giá trị cũ và mới, lý do."
      />

      <FilterBar activeCount={activeFilters} onClear={() => setSearchParams({}, { replace: true })}>
        <FilterField label="Khoảng ngày" width={260}>
          <RangePicker
            format="DD/MM/YYYY"
            value={[toDayjs(query.from), toDayjs(query.to)]}
            onChange={(dates) =>
              patchQuery({
                from: toWorkDate(dates?.[0]?.toDate()),
                to: toWorkDate(dates?.[1]?.toDate()),
              })
            }
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Hành động" htmlFor="a-action" width={240}>
          <Select
            id="a-action"
            value={query.action ?? ''}
            options={[
              { value: '', label: 'Tất cả hành động' },
              ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => patchQuery({ action: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Tìm kiếm" htmlFor="a-q" width={220}>
          <Input.Search
            id="a-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên người thực hiện, lý do"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      <DataTable<AuditLog>
        rowKey="id"
        data={logs.data?.items}
        meta={logs.data?.meta}
        isLoading={logs.isLoading}
        error={logs.error}
        onRetry={() => void logs.refetch()}
        onPageChange={(page, pageSize) =>
          patchQuery({ page: String(page), pageSize: String(pageSize) })
        }
        columns={columns}
        emptyIcon="history"
        emptyTitle="Không có bản ghi nào khớp bộ lọc"
        emptyDescription="Mở rộng khoảng ngày hoặc bỏ bớt bộ lọc hành động để xem thêm."
      />
    </>
  );
}

