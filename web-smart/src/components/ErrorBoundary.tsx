import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './EmptyState';

interface State {
  error: Error | null;
}

/**
 * Chặn lỗi render để một component hỏng không làm trắng cả trang.
 *
 * Vẫn phải là class component: React chưa có API hook tương đương cho
 * `componentDidCatch`.
 *
 * "Tải lại trang" thay vì `setState({ error: null })`: lỗi render thường đến từ
 * dữ liệu không đúng hình dạng đang nằm trong cache. Render lại cùng dữ liệu đó
 * chỉ ném lại đúng lỗi cũ, và người dùng bấm nút thấy không có gì thay đổi.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nơi nối Sentry khi triển khai thật (docs/09 — NFR giám sát).
    console.error('[SmartFace] Lỗi render:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <ErrorState
            title="Giao diện gặp sự cố"
            description="Đã có lỗi ngoài dự kiến khi hiển thị màn hình này. Tải lại trang thường khắc phục được; nếu lặp lại, gửi ảnh chụp màn hình này cho bộ phận hỗ trợ."
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
