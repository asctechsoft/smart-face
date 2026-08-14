import type { ReactNode } from 'react';

/**
 * Thanh hành động hàng loạt — docs/16 mục 11.17.
 *
 * Nền `teal-700`, radius `8px`, cao `56px`, `shadow-lg`, `z-sticky`.
 *
 * `aria-live="polite"` là bắt buộc (mục 11.17 và 14.2 điều 7): thanh này xuất
 * hiện khi người dùng tick checkbox ở nơi khác trên màn hình. Không thông báo
 * thì người dùng bàn phím tick 12 dòng mà không hề biết đã có một thanh công cụ
 * mới xuất hiện ở cuối trang.
 *
 * Bọc trong `.sf-on-dark` để vòng focus đổi sang trắng — vòng teal trên nền
 * teal là vô hình (mục 10.1).
 */
export function BulkActionBar({
  count,
  itemNoun = 'mục',
  onClear,
  children,
}: {
  count: number;
  /** Danh từ đếm được: "đơn", "nhân viên", "dòng". */
  itemNoun?: string;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="sf-bulk-bar sf-on-dark" role="region" aria-live="polite">
      <span className="sf-body-md">
        Đã chọn {count} {itemNoun}
      </span>
      <span className="sf-bulk-divider" aria-hidden="true" />
      {children}
      <button
        type="button"
        onClick={onClear}
        className="sf-bulk-btn"
        style={{ marginLeft: 'auto' }}
      >
        Bỏ chọn
      </button>
    </div>
  );
}

/**
 * Nút hành động trong thanh — chữ trần `label-lg` trắng, hover gạch chân.
 *
 * Nút PHÁ HUỶ dùng nền `error-600` đặc để tách hẳn khỏi các nút chữ trần: đây
 * là chỗ người dùng vừa chọn 50 dòng, bấm nhầm nút bên cạnh là hỏng cả lô.
 */
export function BulkAction({
  onClick,
  danger = false,
  disabled = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sf-bulk-btn"
      style={
        danger
          ? {
              background: 'var(--sf-error-600)',
              borderRadius: 8,
              padding: '6px 16px',
              textDecoration: 'none',
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}
