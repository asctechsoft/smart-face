import { forwardRef, type SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * Select — docs/16 mục 11.4.
 *
 * Cao `42px`, radius `8px`, viền `neutral-300` khi đóng và `teal-900` + ring
 * `3px teal-100` khi mở.
 *
 * Dùng `<select>` thật của trình duyệt, không phải dropdown tự vẽ. Đánh đổi có
 * chủ đích:
 *
 *   Mất: không tô được nền `teal-100` cho mục đang chọn trong danh sách xổ
 *        xuống (trình duyệt vẽ phần đó, CSS không với tới).
 *   Được: bàn phím, tìm-theo-chữ-cái, danh sách xổ dạng bánh xe trên mobile,
 *        và trình đọc màn hình — tất cả hoạt động đúng mà không phải viết dòng
 *        nào.
 *
 * Nơi nào cần chọn nhiều giá trị, tìm kiếm trong danh sách, hoặc nhãn có định
 * dạng (avatar, badge) thì dùng `<Select>` của Ant Design — nó đã được cấu hình
 * theo đúng token ở `theme/antd-theme.ts`.
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  /** Mục đầu danh sách khi chưa chọn gì. */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, style, ...rest },
  ref,
) {
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <select
        {...rest}
        ref={ref}
        className={['sf-input', 'sf-select', className ?? ''].filter(Boolean).join(' ')}
        style={{ appearance: 'none', paddingRight: 40, cursor: 'pointer', ...style }}
      >
        {placeholder ? (
          <option value="" disabled={rest.required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>

      <Icon
        name="expand_more"
        size={24}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--sf-on-surface-variant)',
        }}
      />
    </span>
  );
});
