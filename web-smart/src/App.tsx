import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { queryClient } from '@/lib/api/query-client';
import { AuthProvider } from '@/lib/auth/auth-context';
import { smartFaceTheme } from '@/theme/antd-theme';
import { AppRouter } from '@/routes/router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ui';

export default function App() {
  return (
    <ConfigProvider theme={smartFaceTheme} locale={viVN}>
      {/*
        `<AntApp>` phải bọc ngoài mọi thứ dùng `AntApp.useApp()` (message,
        modal, notification). Không có nó thì các API tĩnh của antd chạy ngoài
        cây React và KHÔNG nhận theme ở trên — toast sẽ hiện màu mặc định của
        antd thay vì bảng màu SmartFace.
      */}
      <AntApp>
        {/*
          `ToastProvider` là toast của SmartFace (docs/16 mục 11.12) — lỗi không
          tự đóng, dừng đếm giờ khi rê chuột, nút đóng có vùng chạm 44px. Ba điều
          đó `message` của antd không làm được, nên hai hệ cùng tồn tại: màn hình
          mới dùng `useToast()`, màn hình cũ vẫn dùng `AntApp.useApp()`.
        */}
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AuthProvider>
                <ErrorBoundary>
                  <AppRouter />
                </ErrorBoundary>
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </ToastProvider>
      </AntApp>
    </ConfigProvider>
  );
}
