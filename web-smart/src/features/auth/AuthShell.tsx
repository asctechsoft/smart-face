import type { ReactNode } from 'react';

/**
 * Khung cho các màn hình chưa đăng nhập.
 *
 * Nửa trái là dải teal-700 mang nhận diện thương hiệu, nửa phải là biểu mẫu trên
 * nền trắng. Dưới breakpoint `lg` bỏ hẳn nửa trái — trên tablet dọc nó chiếm chỗ
 * của bàn phím ảo mà không mang thêm thông tin nào.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--sf-surface)' }}>
      <aside
        className="sf-on-dark"
        style={{
          flex: '0 0 42%',
          background: 'var(--sf-teal-700)',
          color: '#FFFFFF',
          padding: 64,
          display: 'none',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
        // Nửa trang trí — trình đọc màn hình không cần đọc lại khẩu hiệu.
        aria-hidden="true"
      >
        <div>
          <div
            style={{
              fontFamily: '"Plus Jakarta Sans", Inter, sans-serif',
              fontWeight: 700,
              fontSize: 32,
              lineHeight: '40px',
              letterSpacing: '-0.64px',
            }}
          >
            SmartFace
          </div>
          <p style={{ fontSize: 18, lineHeight: '28px', marginTop: 16, opacity: 0.9 }}>
            Chấm công bằng nhận diện khuôn mặt và vân tay. Số liệu tính từ bản ghi thô, đối soát
            được tới từng lượt.
          </p>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <li>Giờ chấm công chính thức luôn là giờ máy chủ</li>
          <li>Bản ghi thô bất biến — mọi hiệu chỉnh đều để lại dấu vết</li>
          <li>Ảnh chấm công truy cập qua liên kết có thời hạn</li>
        </ul>
      </aside>

      <main
        style={{
          flex: 1,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div style={{ width: '100%', maxWidth: 420 }}>
          <h1 className="sf-display-lg" style={{ marginBottom: 8 }}>
            {title}
          </h1>
          {subtitle ? (
            <p className="sf-body-md sf-text-variant" style={{ marginTop: 0, marginBottom: 32 }}>
              {subtitle}
            </p>
          ) : null}

          {children}

          {footer ? <div style={{ marginTop: 32 }}>{footer}</div> : null}
        </div>
      </main>

      {/* Nửa trái chỉ xuất hiện từ `lg` trở lên — docs/16 mục 8. */}
      <style>{`@media (min-width: 1024px) { aside[aria-hidden="true"] { display: flex !important; } }`}</style>
    </div>
  );
}
