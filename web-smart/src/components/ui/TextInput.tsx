import { forwardRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * Ô nhập — docs/16 mục 11.5.
 *
 * Cao 42px, radius 12px, viền `neutral-500` (4.50:1 — vượt ngưỡng 3.0:1 mà
 * WCAG 1.4.11 đòi cho ranh giới phần tử tương tác). Trạng thái lỗi dùng
 * `aria-invalid` làm công tắc, nên CSS và trình đọc màn hình luôn khớp nhau —
 * không thể có ô nhìn thì đỏ mà máy đọc lại bảo hợp lệ.
 */
export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon Material Symbols đặt bên trái trong ô. */
  icon?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { icon, className, ...rest },
  ref,
) {
  const input = (
    <input
      {...rest}
      ref={ref}
      className={['sf-input', className ?? ''].filter(Boolean).join(' ')}
    />
  );

  if (!icon) return input;

  return (
    <span className="sf-input-wrap sf-input-wrap--has-icon">
      <Icon name={icon} size={20} className="sf-input-wrap__icon" />
      {input}
    </span>
  );
});

/**
 * Ô mật khẩu có nút hiện/ẩn.
 *
 * ⚠ Vì sao KHÔNG dùng `Input.Password` của Ant Design ở các form dùng
 * `react-hook-form`: antd trả về `InputRef` (`{ focus, blur, input }`) qua `ref`
 * chứ không phải thẻ `<input>` thật. `register()` của react-hook-form nhận đúng
 * cái `ref` đó để đọc `.value`, nên gặp `InputRef` là đọc ra `undefined` — form
 * luôn báo "chưa nhập" dù người dùng đã gõ đầy đủ.
 *
 * Lỗi này im lặng tuyệt đối: giao diện hiện đúng, chữ hiện trong ô, chỉ có giá
 * trị là không bao giờ tới nơi. Component ở đây chuyển tiếp `ref` thẳng tới thẻ
 * `<input>` nên không dính.
 */
export const PasswordInput = forwardRef<HTMLInputElement, TextInputProps>(function PasswordInput(
  { className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="sf-input-wrap" style={{ position: 'relative' }}>
      <input
        {...rest}
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={['sf-input', className ?? ''].filter(Boolean).join(' ')}
        style={{ paddingRight: 44 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        aria-pressed={visible}
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 36,
          height: 36,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          borderRadius: 9999,
          background: 'transparent',
          color: 'var(--sf-on-surface-variant)',
          cursor: 'pointer',
        }}
      >
        <Icon name={visible ? 'visibility_off' : 'visibility'} size={20} />
      </button>
    </span>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Hiện bộ đếm ký tự. Cần `maxLength` để biết mẫu số. */
  showCount?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { showCount = false, maxLength, value, className, ...rest },
  ref,
) {
  const length = typeof value === 'string' ? value.length : 0;

  return (
    <span style={{ display: 'block', position: 'relative' }}>
      <textarea
        {...rest}
        ref={ref}
        value={value}
        maxLength={maxLength}
        className={['sf-input', 'sf-input--textarea', className ?? ''].filter(Boolean).join(' ')}
      />
      {showCount && maxLength ? (
        /* `aria-hidden`: bộ đếm cập nhật theo từng ký tự gõ vào. Để trình đọc
           màn hình đọc lên thì mỗi phím bấm lại phát ra một câu, không dùng được. */
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 12,
            bottom: 8,
            fontSize: 12,
            lineHeight: '16px',
            color: 'var(--sf-on-surface-muted)',
          }}
        >
          {length}/{maxLength}
        </span>
      ) : null}
    </span>
  );
});
