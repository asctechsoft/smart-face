import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Khung một trường form — docs/16 mục 11.5.
 *
 * Component này tồn tại vì ba yêu cầu tiếp cận ở mục 14.2 bị quên nhiều nhất
 * khi mỗi màn hình tự ghép `<label>` với `<input>`:
 *
 *   • Nhãn hiển thị THƯỜNG TRỰC — placeholder không thay thế được nhãn (điều 5)
 *   • Ô lỗi có `aria-invalid` + `aria-describedby` (điều bắt buộc ở mục 11.5)
 *   • Thông báo lỗi có `role="alert"` để trình đọc màn hình đọc ngay (điều 7)
 *
 * `Field` nhận `children` là một hàm để tự sinh và nối các `id` — nối tay thì
 * sớm muộn có màn hình đặt trùng `id`, và khi đó bấm vào nhãn này lại nhảy focus
 * sang ô khác.
 */
export interface FieldRenderProps {
  id: string;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Chỉ dùng khi phải nối vào một control có `id` cố định sẵn. */
  htmlFor?: string;
  children: ReactNode | ((props: FieldRenderProps) => ReactNode);
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  // Nối cả hint và error: trình đọc màn hình đọc lần lượt, người dùng nghe được
  // cả hướng dẫn lẫn lỗi thay vì chỉ một trong hai.
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="sf-field">
      <label className="sf-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="sf-field__required" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
        {required ? <span className="sf-visually-hidden"> (bắt buộc)</span> : null}
      </label>

      {typeof children === 'function'
        ? children({
            id,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': describedBy,
          })
        : children}

      {hint ? (
        <p id={hintId} className="sf-field__hint" style={{ margin: 0 }}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="sf-field__error" style={{ margin: 0 }}>
          <Icon name="error" size={16} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
