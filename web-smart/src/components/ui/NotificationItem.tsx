import { Icon } from './Icon';

/**
 * Một dòng trong danh sách thông báo — docs/16 mục 11.20.
 *
 * Chưa đọc: nền `teal-50` + viền trái `2px teal-700`.
 * Đã đọc:  trong suốt + viền dưới `1px outline-variant`.
 *
 * Nền tint đổi từ `rgba(0,84,64,.05)` sang bậc đặc `teal-50` theo nguyên tắc số
 * 2 của tài liệu: nền có alpha đổi màu theo thứ nằm phía sau, nên tương phản
 * chữ trên nó không dự đoán được — dòng thông báo nằm trên nền trắng và nằm
 * chồng lên một card sẽ cho hai kết quả khác nhau.
 */
export function NotificationItem({
  title,
  body,
  time,
  unread,
  tone = 'info',
  onClick,
}: {
  title: string;
  body?: string;
  time: string;
  unread: boolean;
  tone?: 'info' | 'warning';
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`sf-notification${unread ? ' sf-notification--unread' : ''}`}
    >
      <span
        className="sf-notification__icon"
        aria-hidden="true"
        style={{
          background: tone === 'warning' ? 'var(--sf-warning-100)' : 'var(--sf-teal-100)',
        }}
      >
        <Icon
          name={tone === 'warning' ? 'warning' : 'notifications'}
          size={18}
          color={tone === 'warning' ? 'var(--sf-warning-800)' : 'var(--sf-teal-800)'}
        />
      </span>

      <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
        <span
          style={{
            display: 'block',
            fontSize: 14,
            lineHeight: '20px',
            fontWeight: unread ? 700 : 600,
            letterSpacing: unread ? 0 : '0.7px',
            color: 'var(--sf-on-surface)',
          }}
        >
          {title}
          {/* Trạng thái chưa đọc phải đọc được, không chỉ nhìn thấy qua nền —
              mục 14.2 điều 1. */}
          {unread ? <span className="sf-visually-hidden"> (chưa đọc)</span> : null}
        </span>

        {body ? (
          <span className="sf-body-sm sf-text-variant" style={{ display: 'block' }}>
            {body}
          </span>
        ) : null}

        <span className="sf-caption" style={{ display: 'block' }}>
          {time}
        </span>
      </span>
    </Tag>
  );
}
