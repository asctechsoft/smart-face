import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';

/**
 * Trạng thái rỗng — docs/16 mục 11.18, docs/04 mục 12.4.
 *
 * Yêu cầu nguyên văn: "Trạng thái rỗng **có hướng dẫn hành động**, không chỉ
 * hiện 'Không có dữ liệu'". Vì vậy `description` bắt buộc ở tầng kiểu dữ liệu —
 * không có cách nào dựng một empty state trống rỗng bằng component này.
 *
 * Khung: nền `neutral-100`, viền `2px outline-variant` NÉT LIỀN (không phải nét
 * đứt), radius `12px`, padding `48px`. Icon `32px` trong vòng tròn `64px`.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  /** Bắt buộc: nói rõ vì sao trống và làm gì tiếp theo. */
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="sf-empty">
      <div className="sf-empty-icon">
        <Icon name={icon} size={32} />
      </div>
      <h3 className="sf-title-md">{title}</h3>
      <p className="sf-body-md sf-text-variant" style={{ margin: 0, maxWidth: '48ch' }}>
        {description}
      </p>
      {action}
    </div>
  );
}

/**
 * Trạng thái lỗi — biến thể của empty state cho lời gọi API hỏng.
 *
 * Checklist mục 16 đòi "trạng thái lỗi cho mọi form và **mọi lời gọi API**".
 * `traceId` hiện dưới dạng chú thích nhỏ: nó là mã kỹ thuật nên không được làm
 * thông điệp chính (mục 14.2 điều 9), nhưng người dùng chụp màn hình gửi hỗ trợ
 * thì nó tiết kiệm hàng giờ dò log.
 */
export function ErrorState({
  title = 'Không tải được dữ liệu',
  description,
  traceId,
  onRetry,
}: {
  title?: string;
  description: string;
  traceId?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="sf-empty" role="alert">
      <div className="sf-empty-icon" style={{ background: 'var(--sf-error-50)' }}>
        <Icon name="error" size={32} color="var(--sf-error-600)" />
      </div>
      <h3 className="sf-title-md">{title}</h3>
      <p className="sf-body-md sf-text-variant" style={{ margin: 0, maxWidth: '48ch' }}>
        {description}
      </p>
      {onRetry ? <Button onClick={onRetry}>Thử lại</Button> : null}
      {traceId ? <span className="sf-caption">Mã truy vết: {traceId}</span> : null}
    </div>
  );
}
