import type { ReactNode } from 'react';

/** Cặp nhãn — giá trị trong drawer/panel chi tiết. */
export function DetailField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="sf-label-md">{label}</span>
      <span className="sf-body-md">{children ?? '—'}</span>
      {hint ? <span className="sf-caption">{hint}</span> : null}
    </div>
  );
}

/** Lưới hai cột cho khối chi tiết; tự xếp dọc khi hẹp. */
export function DetailGrid({ children, columns = 2 }: { children: ReactNode; columns?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`,
        gap: 16,
        // `columns` chỉ là gợi ý bề rộng tối đa; `auto-fit` mới là thứ quyết
        // định số cột thực tế theo không gian còn lại.
        maxWidth: columns * 320,
      }}
    >
      {children}
    </div>
  );
}

/** Nhóm có tiêu đề trong drawer chi tiết. */
export function DetailSection({
  title,
  children,
  extra,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 className="sf-title-sm" style={{ margin: 0 }}>
          {title}
        </h3>
        {extra}
      </div>
      {children}
    </section>
  );
}
