import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Select,
  StatCard,
  StatCardSkeleton,
  TextInput,
} from '@/components/ui';
import { formatNumber } from '@/lib/utils/format';
import { usePlatformOverview } from './platform.api';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/date';

interface TenantRow {
  id: string;
  code: string;
  name: string;
  domain: string;
  status: string;
  employeeCount?: number;
  plan?: { code: string; name: string } | null;
  trialEndsAt?: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  ACTIVE: 'success',
  TRIAL: 'warning',
  SUSPENDED: 'error',
  TERMINATED: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Đang hoạt động',
  TRIAL: 'Dùng thử',
  SUSPENDED: 'Tạm ngưng',
  TERMINATED: 'Đã chấm dứt',
};

/**
 * Danh sách công ty — màn hình chính của Quản trị nền tảng.
 *
 * ## Không có lối vào dữ liệu công ty từ đây
 *
 * Bảng này chỉ hiện siêu dữ liệu: tên, mã, gói, trạng thái, số nhân viên. Muốn
 * nhìn vào dữ liệu chấm công hay bảng công của một công ty thì phải mở **phiên
 * hỗ trợ** ở màn hình riêng, có mã phiếu và lý do (`BR-08`). Đó là ranh giới mà
 * `docs/06` §13 nghiệm thu, và nó bắt đầu bằng việc màn hình này không có nút
 * "xem dữ liệu".
 */
export function TenantListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const overview = usePlatformOverview();

  const tenants = useQuery({
    queryKey: ['system', 'tenants', search, status],
    queryFn: () =>
      api.getPaginated<TenantRow>('/system/tenants', {
        q: search || undefined,
        status: status || undefined,
      }),
  });

  const columns: ColumnsType<TenantRow> = [
    {
      title: 'Công ty',
      key: 'name',
      render: (_, row) => (
        <div>
          <div className="sf-title-sm">{row.name}</div>
          <div className="sf-body-sm sf-text-muted">
            {row.code} · {row.domain}
          </div>
        </div>
      ),
    },
    {
      title: 'Gói',
      key: 'plan',
      width: 160,
      render: (_, row) => row.plan?.name ?? <span className="sf-text-muted">—</span>,
    },
    {
      title: 'Nhân viên',
      key: 'employeeCount',
      width: 120,
      align: 'right',
      render: (_, row) =>
        row.employeeCount === undefined ? (
          <span className="sf-text-muted">—</span>
        ) : (
          row.employeeCount.toLocaleString('vi-VN')
        ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 180,
      render: (_, row) => (
        <div>
          <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
            {STATUS_LABEL[row.status] ?? row.status}
          </Badge>
          {row.status === 'TRIAL' && row.trialEndsAt ? (
            <div className="sf-body-sm sf-text-muted">Hết {formatDateTime(row.trialEndsAt)}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 140,
      render: (_, row) => (
        <Link to={`/system/support?companyId=${row.id}`} className="sf-link">
          Mở phiên hỗ trợ
        </Link>
      ),
    },
  ];

  if (tenants.isError) {
    return (
      <ErrorState
        description="Không đọc được danh sách công ty từ máy chủ."
        onRetry={() => void tenants.refetch()}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Công ty"
        description="Các tenant đang có trên nền tảng."
        actions={
          <Button variant="primary" icon="add" onClick={() => navigate('/system/tenants/new')}>
            Tạo công ty
          </Button>
        }
      />

      {/*
        Hang the dung chung nguon voi man Tong quan (`/system/overview`), khong
        dem lai tu danh sach ben duoi: danh sach da bi phan trang va loc, nen
        dem tu no se ra "Tong cong ty: 10" khi thuc te co 128.
      */}
      <div className="sf-stat-row">
        {overview.isPending ? (
          <>
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
              label="Tổng công ty"
              value={formatNumber(overview.data?.totals.companies)}
            />
            <StatCard
              icon="verified"
              tone="success"
              label="Đang hoạt động"
              value={formatNumber(overview.data?.totals.active)}
            />
            <StatCard
              icon="hourglass_top"
              tone="warning"
              label="Đang dùng thử"
              value={formatNumber(overview.data?.totals.trial)}
            />
            <StatCard
              icon="pause_circle"
              tone="error"
              label="Tạm ngưng"
              value={formatNumber(overview.data?.totals.suspended)}
            />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', maxWidth: 420 }}>
          <TextInput
            icon="search"
            placeholder="Tìm theo tên, mã hoặc tên miền"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Tìm công ty"
          />
        </div>
        <div style={{ width: 220 }}>
          <Select
            aria-label="Lọc theo trạng thái"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: '', label: 'Tất cả trạng thái' },
              ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={tenants.isPending}
        dataSource={tenants.data?.items ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <EmptyState
              icon="apartment"
              title="Chưa có công ty nào"
              description="Tạo công ty đầu tiên để bắt đầu. Mỗi công ty đi kèm một tài khoản Tổng giám đốc."
            />
          ),
        }}
      />
    </div>
  );
}
