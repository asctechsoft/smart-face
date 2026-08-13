import { initials } from '@/lib/utils/format';

/**
 * Avatar — docs/16 mục 11.8.
 *
 * Chữ viết tắt màu `#FFFFFF` trên nền `teal-700` = **8.97:1**. Bản Figma cũ
 * dùng `#82C6AD` — 4.54:1, sát ngưỡng tới mức chỉ cần trình duyệt áp một lớp
 * làm mượt phông khác là trượt. Đổi màu chữ giữ nguyên được nền thương hiệu mà
 * biên an toàn rộng gấp đôi.
 */
export type AvatarSize = 32 | 40 | 64 | 96;

export function Avatar({
  name,
  src,
  size = 32,
  shape = 'circle',
  tone = 'primary',
}: {
  /** Dùng để sinh chữ viết tắt và làm `alt` khi có ảnh. */
  name: string | null | undefined;
  src?: string | null;
  size?: AvatarSize;
  /** `rounded` = radius 16px, dùng cho ảnh lớn trong header drawer (mục 11.14). */
  shape?: 'circle' | 'rounded';
  /** `muted` = nền `neutral-200`, dùng cho ô upload ảnh và empty state. */
  tone?: 'primary' | 'muted';
}) {
  const fontSize = size <= 32 ? 14 : size <= 40 ? 16 : size <= 64 ? 24 : 32;

  return (
    <span
      className="sf-avatar"
      style={{
        width: size,
        height: size,
        fontSize,
        borderRadius: shape === 'rounded' ? 16 : 9999,
        background: tone === 'muted' ? 'var(--sf-neutral-200)' : 'var(--sf-primary-surface)',
        color: tone === 'muted' ? 'var(--sf-on-surface-variant)' : 'var(--sf-on-primary-surface)',
        ...(shape === 'rounded' && size === 96
          ? { border: '4px solid #FFFFFF', boxShadow: 'var(--sf-shadow-md)' }
          : {}),
      }}
    >
      {src ? (
        // `alt` rỗng khi tên đã hiện ngay bên cạnh — đọc lại tên hai lần là
        // nhiễu. Nơi nào avatar đứng một mình thì truyền `name` và không có ảnh.
        <img src={src} alt="" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
