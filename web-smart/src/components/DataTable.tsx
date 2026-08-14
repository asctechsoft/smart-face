import { Table } from 'antd';
import type { TableProps } from 'antd';
import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { ApiErrorState } from './ApiErrorState';
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
      <ApiErrorState
        error={error}
        onRetry={onRetry}
        fallbackDescription="Không tải được dữ liệu cho bảng này."
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
    <>
      {/*
        Số dòng tìm được, đặt TRƯỚC bảng — docs/16 mục 14.2 điều 7 xếp "kết quả
        tìm kiếm" vào nhóm bắt buộc có `aria-live`.

        Người dùng sáng mắt đổi bộ lọc thì thấy bảng nhấp nháy rồi đọc lại; người
        dùng trình đọc màn hình thì không thấy gì cả — không có dòng này, họ đổi
        bộ lọc xong hoàn toàn không biết còn bao nhiêu dòng, hay có dòng nào không.

        Chú thích `showTotal` ở chân bảng KHÔNG thay thế được: nó nằm sau bảng,
        không có `aria-live`, và biến mất khi bảng không phân trang.
      */}
      <p
        role="status"
        aria-live="polite"
        className="sf-body-sm sf-text-variant"
        style={{ margin: '0 0 8px' }}
      >
        {meta ? `Tìm thấy ${meta.total} dòng` : `Hiển thị ${data.length} dòng`}
      </p>

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
    </>
  );
}
