import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { ApiErrorState } from '@/components/ApiErrorState';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/date';
import { formatNumber } from '@/lib/utils/format';
import { Badge, Button, CardSkeleton, Icon, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useMutation } from '@tanstack/react-query';

interface HealthCheck {
  name: string;
  healthy: boolean;
  responseMs: number;
  error?: string;
}

interface HealthReport {
  status: 'healthy' | 'degraded';
  checks: HealthCheck[];
  checkedAt: string;
}

interface QueueRow {
  name: string;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
  error?: string;
}

/**
 * Giám sát hệ thống — mockup Figma `86:15`.
 *
 * ## Ba khối của mockup KHÔNG có ở đây, và vì sao
 *
 * | Mockup | Vì sao bỏ |
 * |---|---|
 * | "API uptime 99,98% (24h)" | Hệ thống không lưu chuỗi thời gian nào để tính ra con số này. Một tỉ lệ uptime bịa là thứ tệ nhất trên màn hình giám sát: nó khiến người trực tin rằng mọi thứ ổn. |
 * | "Email/SMS/OTP delivery 98,7%" | Tương tự — không có bảng thống kê gửi tin. |
 * | "Lịch sử sự cố" (INC-2025-…) | Không có model `Incident`. Bảng sự cố rỗng vĩnh viễn còn tệ hơn không có bảng. |
 *
 * Thay vào đó là hai thứ CÓ THẬT và hữu ích hơn cho người trực: kết quả thăm dò
 * từng thành phần kèm thời gian phản hồi thật, và số job đang tồn trong từng
 * hàng đợi. Hàng đợi tắc là nguyên nhân phổ biến nhất của "chấm công xong mà
 * bảng công không đổi", và nó không xuất hiện ở đâu khác trong sản phẩm.
 */
export function SystemHealthPage() {
  const toast = useToast();
  const showError = useErrorToast();

  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<HealthReport>('/system/health'),
    // 30 giây: đủ nhanh để thấy sự cố khi đang trực, đủ chậm để mỗi lần thăm dò
    // không tự nó trở thành tải lên database, Redis, storage và AI server.
    refetchInterval: 30_000,
  });

  const queues = useQuery({
    queryKey: ['system', 'queues'],
    queryFn: () => api.get<QueueRow[]>('/system/queues'),
    refetchInterval: 30_000,
  });

  const retry = useMutation({
    mutationFn: (name: string) => api.post<{ retried: number }>(`/system/queues/${name}/retry`, {}),
    onSuccess: (result) => {
      toast.success(`Đã đưa ${formatNumber(result.retried)} job lỗi vào chạy lại`);
      void queues.refetch();
    },
    onError: showError,
  });

  if (health.error) {
    return <ApiErrorState error={health.error} onRetry={() => void health.refetch()} />;
  }

  const report = health.data;
  const degraded = report?.status === 'degraded';

  return (
    <>
      <PageHeader
        title="Giám sát hệ thống"
        description="Kết quả thăm dò trực tiếp từng thành phần và tình trạng các hàng đợi xử lý nền."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            loading={health.isFetching || queues.isFetching}
            onClick={() => {
              void health.refetch();
              void queues.refetch();
            }}
          >
            Thăm dò lại
          </Button>
        }
      />

      <div style={{ display: 'grid', gap: 24 }}>
        {health.isPending ? (
          <CardSkeleton height={120} />
        ) : (
          <section
            className="sf-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: 20,
              borderColor: degraded ? 'var(--sf-error-300)' : 'var(--sf-success-300)',
            }}
          >
            <span
              className="sf-stat-medallion"
              style={{ background: degraded ? 'var(--sf-error-50)' : 'var(--sf-success-50)' }}
            >
              <Icon
                name={degraded ? 'error' : 'check_circle'}
                size={24}
                color={degraded ? 'var(--sf-error-700)' : 'var(--sf-success-700)'}
              />
            </span>
            <div style={{ flex: 1 }}>
              <div
                className="sf-headline-md"
                style={{ color: degraded ? 'var(--sf-error-700)' : 'var(--sf-success-700)' }}
              >
                {degraded ? 'Có thành phần đang lỗi' : 'Toàn bộ dịch vụ hoạt động bình thường'}
              </div>
              <div className="sf-body-sm sf-text-variant">
                Thăm dò lúc {report ? formatDateTime(report.checkedAt) : '—'} · tự làm mới mỗi 30
                giây
              </div>
            </div>
          </section>
        )}

        <section className="sf-card sf-panel" style={{ padding: 0 }}>
          <header className="sf-panel__head">
            <h2 className="sf-title-md">Tình trạng dịch vụ</h2>
          </header>
          <div style={{ padding: 20 }}>
            {health.isPending ? (
              <CardSkeleton height={140} />
            ) : (
              <ul className="sf-service-grid">
                {(report?.checks ?? []).map((check) => (
                  <li key={check.name} className={check.healthy ? '' : 'is-down'}>
                    <span
                      aria-hidden="true"
                      className="sf-service-dot"
                      style={{
                        background: check.healthy
                          ? 'var(--sf-success-600)'
                          : 'var(--sf-error-600)',
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="sf-body-md" style={{ fontWeight: 600 }}>
                        {SERVICE_LABEL[check.name] ?? check.name}
                      </div>
                      <div className="sf-body-sm sf-text-variant">
                        {check.healthy
                          ? `Phản hồi ${check.responseMs} ms`
                          : (check.error ?? 'Không phản hồi')}
                      </div>
                    </div>
                    <Badge tone={check.healthy ? 'success' : 'error'}>
                      {check.healthy ? 'Hoạt động' : 'Lỗi'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="sf-card sf-panel" style={{ padding: 0 }}>
          <header className="sf-panel__head">
            <h2 className="sf-title-md">Hàng đợi xử lý nền</h2>
          </header>
          <div style={{ padding: 20, overflowX: 'auto' }}>
            {queues.isPending ? (
              <CardSkeleton height={200} />
            ) : (
              <table className="sf-plain-table">
                <thead>
                  <tr>
                    <th scope="col">Hàng đợi</th>
                    <th scope="col">Chờ</th>
                    <th scope="col">Đang chạy</th>
                    <th scope="col">Hoãn</th>
                    <th scope="col">Lỗi</th>
                    <th scope="col">Đã xong</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {(queues.data ?? []).map((row) => (
                    <tr key={row.name}>
                      <th scope="row">{QUEUE_LABEL[row.name] ?? row.name}</th>
                      {row.error ? (
                        <td colSpan={5} className="sf-text-variant">
                          Không đọc được: {row.error}
                        </td>
                      ) : (
                        <>
                          <td>{formatNumber(row.waiting ?? 0)}</td>
                          <td>{formatNumber(row.active ?? 0)}</td>
                          <td>{formatNumber(row.delayed ?? 0)}</td>
                          <td style={{ color: row.failed ? 'var(--sf-error-700)' : undefined }}>
                            {formatNumber(row.failed ?? 0)}
                          </td>
                          <td className="sf-text-variant">{formatNumber(row.completed ?? 0)}</td>
                        </>
                      )}
                      <td style={{ textAlign: 'right' }}>
                        {/*
                          Chỉ hiện khi CÓ job lỗi. Một nút "Chạy lại" luôn hiện
                          trên hàng đợi sạch mời người ta bấm thử, và với hàng
                          đợi tính công thì bấm thử là tính lại cả công ty.
                        */}
                        {row.failed ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={retry.isPending && retry.variables === row.name}
                            onClick={() => retry.mutate(row.name)}
                          >
                            Chạy lại {formatNumber(row.failed)} job lỗi
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

const SERVICE_LABEL: Record<string, string> = {
  database: 'Cơ sở dữ liệu',
  redis: 'Redis (cache & hàng đợi)',
  storage: 'Lưu trữ ảnh',
  'ai-server': 'AI Server (nhận diện khuôn mặt)',
};

const QUEUE_LABEL: Record<string, string> = {
  payroll: 'Tính công',
  sms: 'Gửi SMS',
  notification: 'Thông báo đẩy',
  export: 'Xuất báo cáo',
  'ai-batch': 'Xử lý AI theo lô',
  'fraud-scan': 'Quét gian lận',
};
