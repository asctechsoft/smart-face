import { Table } from 'antd';
import type { TableProps } from 'antd';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState } from './EmptyState';
import { toUserMessage } from '@/lib/errors/api-error';
import { ApiError } from '@/lib/errors/api-error';
import type { PaginationMeta } from '@/lib/api/types';
import { TableSkeleton } from './Skeleton';

export interface DataTableProps<T> extends Omit<TableProps<T>, 'dataSource'> {
  data: T[] | undefined;
  /** Có `meta` = phân trang phía server. Bỏ trống + `pagination={false}` = bảng ngắn, hiện hết. */
  meta?: PaginationMeta;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onPageChange?: (page: number, pageSize: number) => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon?: string;
  emptyAction?: ReactNode;
}

/**
 * Bảng dữ liệu chuẩn của sản phẩm.
 *
 * Gom bốn trạng thái vào một chỗ vì docs/04 mục 12.4 và docs/16 mục 16 bắt buộc
 * cả bốn ở MỌI bảng, và trước sau gì cũng có màn hình quên một cái:
 *
 *   đang tải  → skeleton (không phải spinner toàn trang)
 *   lỗi       → thông báo tiếng Việt + nút thử lại
 *   rỗng      → empty state có hướng dẫn hành động
 *   có dữ liệu→ bảng
 *
 * Phân trang luôn ở phía server (`meta` do Backend trả): bảng chấm công của
 * công ty 500 người × 31 ngày là 15.500 dòng, tải hết về client rồi phân trang
 * tại chỗ sẽ treo trình duyệt.
 */
export function DataTable<T extends object>({
  data,
  meta,
  isLoading,
  error,
  onRetry,
  onPageChange,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  columns,
  pagination,
  ...rest
}: DataTableProps<T>) {
  if (isLoading && !data) {
    return <TableSkeleton columns={columns?.length ?? 5} />;
  }

  if (error) {
    return (
      <ErrorState
        description={toUserMessage(error)}
        traceId={error instanceof ApiError ? error.traceId : undefined}
        onRetry={onRetry}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <Table<T>
      {...rest}
      columns={columns}
      dataSource={data}
      loading={isLoading}
      // `scroll.x` để bảng nhiều cột cuộn ngang thay vì bóp chữ; trên tablet đây
      // là khác biệt giữa "đọc được" và "không đọc được".
      scroll={{ x: 'max-content', ...rest.scroll }}
      pagination={
        meta
          ? {
              current: meta.page,
              pageSize: meta.pageSize,
              total: meta.total,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100'],
              showTotal: (total, range) => `${range[0]}–${range[1]} trên ${total} dòng`,
              onChange: onPageChange,
            }
          : (pagination ?? false)
      }
    />
  );
}
