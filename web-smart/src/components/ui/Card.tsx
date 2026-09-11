import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

/**
 * Card — docs/16 mục 11.9.
 *
 * Nền `surface`, viền `1px outline-variant`, radius `12px`, padding `16px`,
 * `shadow-xs`.
 *
 * Card BẤM ĐƯỢC phải là `<button>` hoặc `<a>`, không phải `<div onClick>` —
 * tài liệu ghi rõ ở mục 11.9. Một `<div>` bấm được không nhận tiêu điểm bàn
 * phím, không kích hoạt bằng Enter, và trình đọc màn hình không báo là bấm được.
 * Vì vậy component tự đổi thẻ theo props thay vì để nơi gọi tự quyết.
 */
export function Card({
  children,
  padding = 16,
  className,
  as,
  style,
}: {
  children: ReactNode;
  padding?: number;
  className?: string;
  as?: 'div' | 'section' | 'article';
  /**
   * Cửa thoát cho trạng thái nhất thời — thẻ đang được tô sáng, thẻ đang kéo thả.
   *
   * KHÔNG dùng để đổi diện mạo cơ bản của thẻ: nền, viền, radius và bóng thuộc
   * về `.sf-card`, và sửa chúng tại chỗ gọi là cách để mười màn hình có mười
   * kiểu thẻ hơi khác nhau. `padding` đặt sau nên vẫn luôn thắng.
   */
  style?: CSSProperties;
}) {
  const Tag = as ?? 'div';
  return (
    <Tag
      className={['sf-card', className ?? ''].filter(Boolean).join(' ')}
      style={{ ...style, padding }}
    >
      {children}
    </Tag>
  );
}

export function ClickableCard({
  to,
  onClick,
  children,
  padding = 16,
}: {
  to?: string;
  onClick?: () => void;
  children: ReactNode;
  padding?: number;
}) {
  const style = {
    padding,
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    transition: 'box-shadow var(--sf-motion-fast), border-color var(--sf-motion-fast)',
  };

  if (to) {
    return (
      <Link to={to} className="sf-card" style={{ ...style, textDecoration: 'none' }}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className="sf-card" style={style}>
      {children}
    </button>
  );
}

/**
 * Thẻ chỉ số — docs/16 mục 11.9, bố cục theo mockup Figma `55:57`.
 *
 * ## Vì sao biểu tượng nằm trong huy hiệu tròn bên trái
 *
 * Bản cũ đặt biểu tượng 16px cạnh nhãn, cùng cỡ cùng màu với chữ — nó không
 * phân biệt được thẻ này với thẻ kia khi liếc mắt, mà liếc mắt chính là toàn
 * bộ công dụng của một hàng thẻ chỉ số. Huy hiệu 48px có nền tô nhạt cho mỗi
 * thẻ một hình bóng riêng, đọc được từ xa trước cả khi đọc chữ.
 *
 * Tông màu tô cả huy hiệu lẫn con số, nên nó phải mang nghĩa: `warning` là
 * "có việc cần làm", `error` là "đang sai", `success` là "đã xong". Đừng chọn
 * tông vì nó đẹp cạnh thẻ bên cạnh.
 */
export type StatTone = 'primary' | 'success' | 'warning' | 'error' | 'neutral' | 'teal';

const STAT_TONE: Record<StatTone, { value: string; icon: string; medallion: string }> = {
  // Con số dùng thang 700 — bốn màu đã qua kiểm tương phản trên nền trắng
  // (`npm run check:contrast`). Huy hiệu dùng thang 50 làm nền và 700 làm mực.
  primary: { value: 'var(--sf-blue-700)', icon: 'var(--sf-blue-700)', medallion: 'var(--sf-blue-50)' },
  success: {
    value: 'var(--sf-success-700)',
    icon: 'var(--sf-success-700)',
    medallion: 'var(--sf-success-50)',
  },
  warning: {
    value: 'var(--sf-warning-700)',
    icon: 'var(--sf-warning-700)',
    medallion: 'var(--sf-warning-50)',
  },
  error: { value: 'var(--sf-error-700)', icon: 'var(--sf-error-700)', medallion: 'var(--sf-error-50)' },
  neutral: {
    value: 'var(--sf-on-surface)',
    icon: 'var(--sf-on-surface-variant)',
    medallion: 'var(--sf-neutral-100)',
  },
  /** @deprecated Tên cũ từ thang teal. Dùng `primary`. */
  teal: { value: 'var(--sf-blue-700)', icon: 'var(--sf-blue-700)', medallion: 'var(--sf-blue-50)' },
};

export function StatCard({
  label,
  value,
  suffix,
  hint,
  tone = 'primary',
  icon,
  to,
  onClick,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  icon?: string;
  to?: string;
  /**
   * Thẻ bấm được nhưng KHÔNG điều hướng — nó bật một bộ lọc ngay tại chỗ.
   *
   * Có mặt vì thẻ "Cần đối soát" lọc chính bảng nằm ngay bên dưới nó. Dùng `to`
   * cho việc đó sẽ phải dựng lại toàn bộ query string đang có trên URL, và bỏ
   * sót một tham số nghĩa là bấm vào thẻ làm mất luôn tháng người dùng đang xem.
   *
   * `to` vẫn thắng khi cả hai cùng được truyền: một thẻ vừa là liên kết vừa là
   * nút thì bàn phím và trình đọc màn hình không có cách nào mô tả nó.
   */
  onClick?: () => void;
  loading?: boolean;
}) {
  const palette = STAT_TONE[tone];

  const body = (
    <>
      {icon ? (
        <span className="sf-stat-medallion" style={{ background: palette.medallion }}>
          <Icon name={icon} size={24} color={palette.icon} />
        </span>
      ) : null}

      <span className="sf-stat-body">
        <span className="sf-label-md sf-text-variant">{label}</span>

        {loading ? (
          <span className="sf-skeleton" style={{ width: 80, height: 36, marginTop: 4 }} />
        ) : (
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span
              style={{
                fontSize: 30,
                lineHeight: '38px',
                fontWeight: 700,
                letterSpacing: '-0.6px',
                color: palette.value,
              }}
            >
              {value}
            </span>
            {suffix ? (
              <span className="sf-text-variant" style={{ fontSize: 15 }}>
                {suffix}
              </span>
            ) : null}
          </span>
        )}

        {hint ? <span className="sf-body-sm sf-text-variant">{hint}</span> : null}
      </span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="sf-stat-card sf-stat-card--link">
        {body}
        <Icon name="chevron_right" size={20} color="var(--sf-on-surface-muted)" />
      </Link>
    );
  }

  // `<button>` chứ không `<div onClick>` — xem chú thích ở `ClickableCard`: một
  // div bấm được không nhận tiêu điểm bàn phím và trình đọc màn hình không báo
  // là bấm được.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="sf-stat-card sf-stat-card--link"
        style={{ font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
      >
        {body}
        <Icon name="chevron_right" size={20} color="var(--sf-on-surface-muted)" />
      </button>
    );
  }

  return <div className="sf-stat-card">{body}</div>;
}
