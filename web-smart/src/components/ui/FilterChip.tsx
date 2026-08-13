import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Chip lọc — docs/16 mục 11.6.
 *
 * Tài liệu chốt rõ: "Chip là nút chuyển trạng thái → dùng
 * `<button role="switch" aria-checked>` hoặc `<input type="checkbox">` ẩn,
 * **không dùng `<div>`**."
 *
 * Ở đây chọn `<button role="switch">` vì chip đứng một mình, không thuộc một
 * form nào — không cần `name`/`value` để gửi đi.
 */
export function FilterChip({
  selected,
  onToggle,
  children,
  icon,
  count,
  disabled = false,
}: {
  selected: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
  icon?: string;
  /** Số kết quả khớp — hiện trong ngoặc, giúp người dùng biết bấm vào có gì. */
  count?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onToggle(!selected)}
      className="sf-chip"
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {count !== undefined ? <span>({count})</span> : null}
      {/* Dấu tích chỉ là chỉ dấu phụ — trạng thái thật do `aria-checked` mang,
          và màu nền teal đã nói lên điều đó cho người nhìn được. */}
      {selected ? <Icon name="check" size={16} /> : null}
    </button>
  );
}

/** Hàng chip lọc. `label` mô tả cả nhóm cho trình đọc màn hình. */
export function FilterChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}
