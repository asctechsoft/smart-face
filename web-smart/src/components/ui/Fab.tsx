import { useState } from 'react';
import { Icon } from './Icon';

/**
 * FAB — docs/16 mục 11.16.
 *
 * `64 × 64`, nền `amber-500`, radius `16px`, icon `18px` `amber-900`,
 * `shadow-xl`. Hover sáng lên `amber-400`, active thêm bóng lõm + dịch 1px —
 * cùng quy tắc với nút primary (mục 0.1).
 *
 * Tooltip hiện khi rê chuột HOẶC khi nhận tiêu điểm bàn phím. Chỉ bắt `hover`
 * là người dùng bàn phím không bao giờ biết nút tròn này làm gì.
 */
export function Fab({
  icon,
  label,
  onClick,
}: {
  icon: string;
  /** Vừa là `aria-label`, vừa là nội dung tooltip. */
  label: string;
  onClick: () => void;
}) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      {showTip ? (
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            right: 100,
            bottom: 44,
            zIndex: 1100,
            padding: '6px 12px',
            borderRadius: 8,
            background: 'var(--sf-surface-inverse)',
            color: 'var(--sf-on-surface-inverse)',
            fontSize: 14,
            lineHeight: '20px',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--sf-shadow-md)',
          }}
        >
          {label}
        </span>
      ) : null}

      <button
        type="button"
        className="sf-fab"
        aria-label={label}
        onClick={onClick}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
      >
        <Icon name={icon} size={18} />
      </button>
    </div>
  );
}
