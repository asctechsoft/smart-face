import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission, type Permission } from '@/lib/rbac/permissions';
import { EmptyState } from '@/components/EmptyState';

function FullPageLoading() {
  return (
    <div
      style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}
      aria-busy="true"
      aria-live="polite"
    >
      {/* `tip` của antd chỉ hoạt động ở dạng bọc nội dung hoặc toàn màn hình —
          dùng ở đây sẽ bị bỏ qua kèm cảnh báo. Đặt chữ ra ngoài. */}
      <div style={{ display: 'grid', justifyItems: 'center', gap: 16 }}>
        <Spin size="large" />
        <span className="sf-body-sm sf-text-variant">Đang tải phiên làm việc…</span>
      </div>
    </div>
  );
}

/**
 * Chặn ở tầng routing — docs/04 mục 12.2.
 *
 * Thứ tự kiểm tra có ý nghĩa: `mustChangePassword` phải đứng TRƯỚC mọi thứ
 * khác. Backend cũng chặn ở phía nó (`PasswordChangeGuard`), nên vào được trang
 * khác cũng chỉ nhận 403 hàng loạt — đưa thẳng tới màn đổi mật khẩu là lối ra
 * duy nhất.
 */
export function RequireAuth() {
  const { status, mustChangePassword } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoading />;

  if (status === 'anonymous') {
    // Nhớ đường dẫn đang dở để sau khi đăng nhập quay lại đúng chỗ.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (mustChangePassword && location.pathname !== '/doi-mat-khau') {
    return <Navigate to="/doi-mat-khau" replace />;
  }

  return <Outlet />;
}

/** Đã đăng nhập rồi thì không cho quay lại màn đăng nhập. */
export function RequireAnonymous() {
  const { status, mustChangePassword } = useAuth();

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'authenticated') {
    return <Navigate to={mustChangePassword ? '/doi-mat-khau' : '/dashboard'} replace />;
  }

  return <Outlet />;
}

/**
 * Chặn theo quyền.
 *
 * ⚠ Đây là trải nghiệm, không phải bảo mật: người dùng gõ thẳng URL sẽ thấy màn
 * hình "không có quyền", nhưng dữ liệu thật vẫn do Backend gác. Xem docs/04 mục 12.2.
 */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { roles } = useAuth();

  if (!hasPermission(roles, permission)) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState
          icon="lock"
          title="Bạn không có quyền xem mục này"
          description="Vai trò hiện tại của bạn không bao gồm chức năng này. Liên hệ Admin công ty nếu bạn cho rằng đây là nhầm lẫn."
        />
      </div>
    );
  }

  return <Outlet />;
}
