import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Checkbox — docs/16 mục 11.2.
 *
 * `24 × 24`, radius `4px`, viền `2px`, khoảng cách tới nhãn `8px`.
 *
 * Input thật vẫn nằm trong DOM và trong luồng tiêu điểm, chỉ bị ẩn khỏi mắt
 * (xem `.sf-choice__input` trong components.css). Cách làm phổ biến hơn — vẽ
 * một `<div>` rồi bắt sự kiện click — mất sạch hỗ trợ bàn phím, mất trạng thái
 * `:checked` mà trình đọc màn hình dựa vào, và mất cả tự động điền của trình
 * duyệt.
 */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children?: ReactNode;
  /** Trạng thái "một phần" cho ô chọn-tất-cả ở đầu bảng. */
  indeterminate?: boolean;
  /** Biến thể 16px dùng trong dòng bảng dày đặc. */
  compact?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { children, indeterminate = false, compact = false, disabled, className, ...rest },
  forwardedRef,
) {
  const localRef = useRef<HTMLInputElement>(null);

  // `indeterminate` không có thuộc tính HTML tương ứng — chỉ đặt được qua DOM.
  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={[
        'sf-choice',
        compact ? 'sf-choice--table' : '',
        disabled ? 'sf-choice--disabled' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        {...rest}
        type="checkbox"
        disabled={disabled}
        className="sf-choice__input"
        ref={(node) => {
          (localRef as { current: HTMLInputElement | null }).current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
      />
      <span className="sf-choice__box sf-choice__box--checkbox" aria-hidden="true">
        <Icon name={indeterminate ? 'remove' : 'check'} size={compact ? 16 : 18} />
      </span>
      {children ? <span>{children}</span> : null}
    </label>
  );
});

/**
 * Radio — docs/16 mục 11.3.
 *
 * Giống checkbox, riêng trạng thái `checked` là viền teal + chấm tròn 12px ở
 * giữa, nền VẪN trong suốt.
 */
export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children?: ReactNode;
  /** Dòng mô tả dưới nhãn — dùng khi các lựa chọn cần giải thích hệ quả. */
  description?: ReactNode;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { children, description, disabled, className, ...rest },
  ref,
) {
  return (
    <label
      className={['sf-choice', disabled ? 'sf-choice--disabled' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <input {...rest} ref={ref} type="radio" disabled={disabled} className="sf-choice__input" />
      <span className="sf-choice__box sf-choice__box--radio" aria-hidden="true" />
      {children || description ? (
        <span>
          <span>{children}</span>
          {description ? (
            <span
              style={{
                display: 'block',
                fontSize: 14,
                lineHeight: '20px',
                color: 'var(--sf-on-surface-variant)',
              }}
            >
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
});

/**
 * Nhóm radio.
 *
 * Bọc trong `<fieldset>` + `<legend>` chứ không phải `<div>` + `<label>`: đây
 * là cách duy nhất trình đọc màn hình biết bốn lựa chọn rời rạc thuộc về cùng
 * MỘT câu hỏi, và đọc câu hỏi đó lên khi người dùng nhảy vào nhóm.
 */
export function RadioGroup({
  legend,
  children,
  direction = 'vertical',
}: {
  legend: string;
  children: ReactNode;
  direction?: 'vertical' | 'horizontal';
}) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="sf-field__label" style={{ padding: 0, marginBottom: 8 }}>
        {legend}
      </legend>
      <div
        style={{
          display: 'flex',
          flexDirection: direction === 'vertical' ? 'column' : 'row',
          gap: direction === 'vertical' ? 8 : 16,
          flexWrap: 'wrap',
        }}
      >
        {children}
      </div>
    </fieldset>
  );
}
