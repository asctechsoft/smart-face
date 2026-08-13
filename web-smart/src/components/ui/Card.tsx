import type { ReactNode } from 'react';
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
}: {
  children: ReactNode;
  padding?: number;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  const Tag = as ?? 'div';
  return (
    <Tag className={['sf-card', className ?? ''].filter(Boolean).join(' ')} style={{ padding }}>
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
 * Thẻ chỉ số — docs/16 mục 11.9.
 *
 * Nền `neutral-100`, radius `12px`, padding `12px`. Giá trị dùng `teal-700`
 * (8.12:1) hoặc `warning-700` (5.82:1) — hai màu duy nhất đã kiểm chứng cho
 * vai trò này. Không mở cho màu tuỳ ý.
 */
export function StatCard({
  label,
  value,
  suffix,
  hint,
  tone = 'teal',
  icon,
  to,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  hint?: ReactNode;
  tone?: 'teal' | 'warning' | 'error' | 'neutral';
  icon?: string;
  to?: string;
  loading?: boolean;
}) {
  const valueColor = {
    teal: 'var(--sf-teal-700)',
    warning: 'var(--sf-warning-700)',
    error: 'var(--sf-error-700)',
    neutral: 'var(--sf-on-surface)',
  }[tone];

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon ? <Icon name={icon} size={16} color="var(--sf-on-surface-variant)" /> : null}
        <span className="sf-label-md">{label}</span>
      </div>

      {loading ? (
        <div className="sf-skeleton" style={{ width: 80, height: 40, marginTop: 4 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span
            style={{
              fontSize: 32,
              lineHeight: '40px',
              fontWeight: 700,
              letterSpacing: '-0.64px',
              color: valueColor,
            }}
          >
            {value}
          </span>
          {suffix ? (
            <span className="sf-text-variant" style={{ fontSize: 16 }}>
              {suffix}
            </span>
          ) : null}
        </div>
      )}

      {hint ? (
        <span className="sf-body-sm sf-text-variant" style={{ marginTop: 2 }}>
          {hint}
        </span>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="sf-stat-card" style={{ textDecoration: 'none' }}>
        {body}
        <span
          className="sf-body-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            fontWeight: 600,
            color: 'var(--sf-primary)',
          }}
        >
          Xem chi tiết <Icon name="arrow_forward" size={16} />
        </span>
      </Link>
    );
  }

  return <div className="sf-stat-card">{body}</div>;
}
