import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Nút — docs/16 mục 11.1.
 *
 * Sáu biến thể × ba kích thước, mọi ô đều đã kiểm chứng tương phản (mục 14.1).
 * Điểm phải nhớ: **nút amber SÁNG LÊN khi hover, không tối đi** — lập luận đầy
 * đủ ở mục 0.1 và ở `components.css`.
 *
 * `loading` giữ nguyên bề rộng nút và khoá tương tác. Nút co lại hay đổi chữ
 * lúc đang gửi làm con trỏ chuột trượt ra ngoài, và người dùng bấm tiếp vào chỗ
 * trống — với "duyệt đơn" hay "chốt kỳ" thì lần bấm thứ hai không vô hại.
 */
export type ButtonVariant =
  'primary' | 'teal' | 'secondary' | 'tertiary' | 'destructive' | 'destructive-ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon Material Symbols đặt trước chữ. */
  icon?: string;
  /** Icon đặt sau chữ — dùng cho "Tiếp tục →", "Mở rộng ▾". */
  iconAfter?: string;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconAfter,
    loading = false,
    block = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 18 : 20;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      // `aria-busy` để trình đọc màn hình biết nút đang xử lý, không phải hỏng.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={[
        'sf-btn',
        `sf-btn--${size}`,
        `sf-btn--${variant}`,
        loading ? 'sf-btn--loading' : '',
        block ? 'sf-btn--block' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? (
        <span className="sf-btn__spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}

      {children}

      {iconAfter && !loading ? <Icon name={iconAfter} size={iconSize} /> : null}
    </button>
  );
});

/**
 * Nút chỉ có icon.
 *
 * `label` là BẮT BUỘC, không phải tuỳ chọn: icon mang nghĩa mà thiếu nhãn thì
 * trình đọc màn hình chỉ đọc được "button" (mục 9, mục 14.2 điều 9). Bắt buộc ở
 * tầng kiểu dữ liệu là cách duy nhất khiến nó không bao giờ bị quên.
 */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconAfter'> {
  icon: string;
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', variant = 'tertiary', loading = false, className, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      disabled={rest.disabled || loading}
      className={[
        'sf-btn',
        `sf-btn--${size}`,
        `sf-btn--${variant}`,
        'sf-btn--icon-only',
        loading ? 'sf-btn--loading' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? (
        <span className="sf-btn__spinner" aria-hidden="true" />
      ) : (
        <Icon name={icon} size={size === 'sm' ? 18 : 24} />
      )}
    </button>
  );
});
