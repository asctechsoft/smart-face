import type { CSSProperties } from 'react';

/**
 * Material Symbols — docs/16 mục 9.
 *
 * `aria-hidden` mặc định `true`: phần lớn icon trong sản phẩm đi kèm chữ nên
 * chỉ là trang trí, và để trình đọc màn hình đọc tên icon ("flag") ngay trước
 * chữ ("Có cờ nghi vấn") là lặp thừa gây nhiễu.
 *
 * Icon MANG NGHĨA phải truyền `label`; khi đó component đổi sang
 * `role="img"` + `aria-label`.
 */
export const ICON_SIZES = [16, 18, 20, 24, 32] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export function Icon({
  name,
  size = 20,
  color,
  fill = false,
  label,
  className,
  style,
}: {
  name: string;
  size?: IconSize | number;
  color?: string;
  /** Biến thể đặc — dùng cho mục nav đang chọn và icon trạng thái. */
  fill?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);

  return (
    <span
      {...a11y}
      className={`sf-icon${className ? ` ${className}` : ''}`}
      style={{
        fontSize: size,
        width: size,
        height: size,
        color: color ?? 'currentColor',
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}

/** Ánh xạ ý nghĩa → tên icon, theo bảng ở docs/16 mục 9. */
export const ICONS = {
  dashboard: 'home',
  attendance: 'event_available',
  request: 'assignment',
  profile: 'person',
  employees: 'group',
  reports: 'monitoring',
} as const;
