import type { ReactNode } from 'react';
import { Button } from 'antd';
import { Icon } from './Icon';

/**
 * Thanh bộ lọc phía trên bảng.
 *
 * Nút "Xoá lọc" chỉ hiện khi thật sự có bộ lọc đang bật (`activeCount > 0`):
 * một nút luôn hiện mà bấm vào không thay đổi gì sẽ dạy người dùng bỏ qua nó.
 */
export function FilterBar({
  children,
  activeCount = 0,
  onClear,
  extra,
}: {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div
      role="search"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        marginBottom: 16,
        background: 'var(--sf-surface)',
        border: '1px solid var(--sf-outline-variant)',
        borderRadius: 12,
        boxShadow: 'var(--sf-shadow-xs)',
      }}
    >
      {children}

      {activeCount > 0 && onClear ? (
        <Button
          type="text"
          size="small"
          onClick={onClear}
          icon={<Icon name="filter_alt_off" size={16} />}
        >
          Xoá lọc ({activeCount})
        </Button>
      ) : null}

      {extra ? <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>{extra}</div> : null}
    </div>
  );
}

/** Một ô lọc có nhãn thường trực phía trên — docs/16 mục 14.2 điều 5. */
export function FilterField({
  label,
  htmlFor,
  width,
  children,
}: {
  label: string;
  htmlFor?: string;
  width?: number | string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width }}>
      <label className="sf-label-md" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
