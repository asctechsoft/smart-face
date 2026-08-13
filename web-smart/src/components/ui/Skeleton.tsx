/**
 * Skeleton — docs/16 mục 11.11.
 *
 * Gradient chạy ngang, chu kỳ 1500ms (`motion-skeleton`). Vùng skeleton BẮT
 * BUỘC có `aria-busy="true"` và `aria-live="polite"` — nếu không, trình đọc màn
 * hình im lặng suốt lúc chờ rồi đột ngột đọc cả bảng dữ liệu.
 *
 * Checklist ở mục 16 nói rõ: "Có skeleton cho trạng thái tải, **không dùng
 * spinner toàn trang**". Spinner toàn trang xoá sạch bố cục đang có, nên khi dữ
 * liệu về thì cả trang nhảy một cái; skeleton giữ nguyên hình dạng nên mắt
 * người dùng không phải tìm lại vị trí cũ.
 */

const BLOCK_SIZES = {
  avatar: { width: 40, height: 40, radius: 9999 },
  text: { width: 80, height: 16, radius: 4 },
  badge: { width: 64, height: 24, radius: 9999 },
  button: { width: 32, height: 32, radius: 9999 },
} as const;

export function SkeletonBlock({
  variant,
  width,
  height,
  radius,
}: {
  variant?: keyof typeof BLOCK_SIZES;
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  const preset = variant ? BLOCK_SIZES[variant] : BLOCK_SIZES.text;

  return (
    <div
      className="sf-skeleton"
      style={{
        width: width ?? preset.width,
        height: height ?? preset.height,
        borderRadius: radius ?? preset.radius,
      }}
    />
  );
}

/** Khung chờ cho bảng — dựng đúng chiều cao dòng 74px của mục 11.10. */
export function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Đang tải dữ liệu"
      style={{
        border: '1px solid var(--sf-outline-variant)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--sf-surface)',
      }}
    >
      <div
        style={{
          height: 40,
          background: 'var(--sf-surface-container-low)',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '0 24px',
        }}
      >
        {Array.from({ length: columns }).map((_, index) => (
          <SkeletonBlock key={index} width={80} height={12} />
        ))}
      </div>

      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            height: 74,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            padding: '0 24px',
            borderBottom: '1px solid var(--sf-outline-variant)',
          }}
        >
          <SkeletonBlock variant="avatar" />
          {Array.from({ length: Math.max(columns - 1, 1) }).map((__, cellIndex) => (
            <SkeletonBlock key={cellIndex} width={cellIndex === 0 ? 140 : 80} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="sf-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <SkeletonBlock width={100} height={12} />
      <SkeletonBlock width="60%" height={32} />
      <SkeletonBlock width="100%" height={Math.max(height - 68, 24)} radius={8} />
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="sf-stat-card" aria-busy="true" aria-live="polite">
      <SkeletonBlock width={90} height={12} />
      <SkeletonBlock width={64} height={40} />
    </div>
  );
}

/** Khung chờ cho một danh sách dòng đơn giản (thông báo, cảnh báo). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" aria-label="Đang tải danh sách">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: 16,
            borderBottom: '1px solid var(--sf-outline-variant)',
          }}
        >
          <SkeletonBlock width={32} height={32} radius={9999} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SkeletonBlock width="40%" height={14} />
            <SkeletonBlock width="70%" height={12} />
          </div>
          <SkeletonBlock variant="badge" />
        </div>
      ))}
    </div>
  );
}
