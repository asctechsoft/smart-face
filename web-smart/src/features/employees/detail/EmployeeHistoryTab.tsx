import { Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDateTime } from '@/lib/utils/date';
import { ACTION_LABEL, diffLines } from '@/features/audit/audit-labels';
import { useEmployeeHistory, type EmployeeHistoryEntry } from '../employees.api';

/**
 * Lịch sử thay đổi hồ sơ — `FR-WEB-HR-02`.
 *
 * Cùng nguồn dữ liệu với màn Nhật ký kiểm toán, nhưng đã lọc sẵn về một người và
 * bỏ các cột không có ý nghĩa ở đây (đối tượng luôn là chính nhân viên này).
 *
 * Cột giữ lại là cột người ta thật sự cần khi tra: đổi cái gì, từ giá trị nào
 * sang giá trị nào, ai làm, vì sao. Ẩn cặp giá trị cũ/mới sau một nút bấm là bắt
 * người dùng mở từng dòng để tìm đúng lần chuyển phòng ban họ đang hỏi.
 */
export function EmployeeHistoryTab({ employeeId }: { employeeId: string }) {
  const { timezone } = useAuth();
  const history = useEmployeeHistory(employeeId);

  const columns: ColumnsType<EmployeeHistoryEntry> = [
    {
      title: 'Thời điểm',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value: string) => formatDateTime(value, timezone),
    },
    {
      title: 'Thay đổi',
      dataIndex: 'action',
      key: 'action',
      width: 200,
      render: (value: string) => <Tag>{ACTION_LABEL[value] ?? value}</Tag>,
    },
    {
      title: 'Người thực hiện',
      key: 'actor',
      width: 180,
      render: (_, row) => row.actorName ?? <span className="sf-text-muted">Hệ thống</span>,
    },
    {
      title: 'Giá trị cũ → mới',
      key: 'diff',
      width: 340,
      render: (_, row) => {
        const lines = diffLines(row.before, row.after);
        if (lines.length === 0) return <span className="sf-text-muted">—</span>;

        return (
          <div className="sf-body-sm" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {lines.map((line) => (
              <div key={line.key}>
                <span className="sf-text-variant">{line.key}: </span>
                <span style={{ color: 'var(--sf-error-700)' }}>{line.before}</span>
                {' → '}
                <span style={{ color: 'var(--sf-success-800)' }}>{line.after}</span>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: 'Lý do',
      dataIndex: 'reason',
      key: 'reason',
      width: 280,
      render: (value: string | null) =>
        value ? (
          <Typography.Paragraph ellipsis={{ rows: 2, tooltip: value }} style={{ marginBottom: 0 }}>
            {value}
          </Typography.Paragraph>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
  ];

  return (
    <DataTable<EmployeeHistoryEntry>
      rowKey="id"
      data={history.data}
      isLoading={history.isLoading}
      error={history.error}
      onRetry={() => void history.refetch()}
      columns={columns}
      pagination={false}
      emptyIcon="history"
      emptyTitle="Chưa có thay đổi nào được ghi nhận"
      emptyDescription="Hồ sơ chưa được sửa lần nào kể từ lúc tạo. Mọi thao tác sửa, tạm ngưng, đổi vai trò về sau đều xuất hiện ở đây."
    />
  );
}
