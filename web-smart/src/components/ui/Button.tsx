import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

/**
 * Nút.
 *
 * Mọi cặp màu đã qua `npm run check:contrast`.
 *
 * | Biến thể | Màu | Dùng khi |
 * |---|---|---|
 * | `primary` | xanh dương đặc | Hành động chính của màn hình: Lưu, Tạo mới, Tiếp tục |
 * | `action` | xanh lá đặc | CHỐT một quy trình: Phê duyệt, Xác nhận chốt kỳ |
 * | `secondary` | viền xanh | Hành động phụ đứng cạnh nút chính |
 * | `tertiary` | chữ trơn | Huỷ, Đóng, thao tác trong bảng |
 * | `destructive` | đỏ đặc | Xoá, thu hồi, khoá tài khoản |
 * | `destructive-ghost` | chữ đỏ | Từ chối, huỷ đơn — hành động ngược nhưng không phá huỷ |
 *
 * `action` là biến thể **hiếm**: một màn hình có nhiều lắm một nút xanh lá. Khi
 * mọi nút đều nhấn mạnh thì không nút nào nhấn mạnh nữa — đó là chỗ bản trước
 * đã sai khi lấy màu nhấn mạnh làm màu mặc định.
 *
 * `teal` là tên cũ, còn dùng được nhưng nay ra màu xanh dương như `primary`.
 *
 * `loading` giữ nguyên bề rộng nút và khoá tương tác. Nút co lại hay đổi chữ
 * lúc đang gửi làm con trỏ chuột trượt ra ngoài, và người dùng bấm tiếp vào chỗ
 * trống — với "duyệt đơn" hay "chốt kỳ" thì lần bấm thứ hai không vô hại.
 */
export type ButtonVariant =
  | 'primary'
  | 'action'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'destructive-ghost'
  /** @deprecated Tên cũ của `primary`. */
  | 'teal';

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
 * Nut DAN sang mot trang khac — the `<a>`, khong phai `<button>`.
 *
 * ## Vi sao khong dung `<Button onClick={() => navigate(to)}>`
 *
 * Mot `<button>` dieu huong lam hong ba thu ma nguoi dung mac nhien co:
 * bam giua de mo tab moi, Ctrl/Cmd+click, va menu chuot phai "Mo trong tab
 * moi". Ca ba deu la hanh vi cua trinh duyet tren the `<a href>`, khong co
 * cach nao mo phong lai bang JavaScript. Trinh doc man hinh cung doc sai vai
 * tro: "button" thay vi "link", nen nguoi dung khong biet minh sap roi trang.
 *
 * Dung `Button` cho HANH DONG (luu, duyet, xoa), `LinkButton` cho DIEU HUONG.
 */
export interface LinkButtonProps {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  iconAfter?: string;
  block?: boolean;
  children?: ReactNode;
  className?: string;
}

export function LinkButton({
  to,
  variant = 'primary',
  size = 'md',
  icon,
  iconAfter,
  block = false,
  children,
  className,
}: LinkButtonProps) {
  const iconSize = size === 'sm' ? 18 : 20;

  return (
    <Link
      to={to}
      className={[
        'sf-btn',
        `sf-btn--${size}`,
        `sf-btn--${variant}`,
        block ? 'sf-btn--block' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={iconSize} /> : null}
    </Link>
  );
}

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
