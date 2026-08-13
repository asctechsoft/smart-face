import type { ReactNode } from 'react';

/**
 * Tiêu đề trang — docs/16 mục 3.2 (`display-lg`, Plus Jakarta Sans 700/32, teal-700).
 *
 * Một trong đúng 3 vai trò được phép dùng Plus Jakarta Sans (mục 3.1).
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {breadcrumb ? <div style={{ marginBottom: 8 }}>{breadcrumb}</div> : null}
        <h1 className="sf-display-lg">{title}</h1>
        {description ? (
          <p
            className="sf-text-variant"
            style={{ fontSize: 18, lineHeight: '28px', margin: '8px 0 0', maxWidth: '72ch' }}
          >
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** Tiêu đề nhóm bên trong trang — `headline-md`, không dùng Jakarta. */
export function SectionTitle({
  children,
  extra,
}: {
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 16,
      }}
    >
      <h2 className="sf-headline-md">{children}</h2>
      {extra}
    </div>
  );
}
