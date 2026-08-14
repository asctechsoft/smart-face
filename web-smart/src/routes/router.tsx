import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { ManagerLayout } from './layouts/ManagerLayout';
import { RequireAnonymous, RequireAuth, RequirePermission } from './guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { EmptyState } from '@/components/EmptyState';

/**
 * Mỗi màn hình nghiệp vụ là một chunk riêng.
 *
 * Kế toán mở Kỳ lương không cần tải kèm mã của Chính sách và Báo cáo. Gộp tất cả
 * vào một bundle làm lần tải đầu chậm với mọi vai trò, trong khi phần lớn người
 * dùng chỉ đụng tới 2–3 màn hình.
 *
 * Đăng nhập và đổi mật khẩu KHÔNG lazy: chúng luôn là màn hình đầu tiên, tách ra
 * chỉ thêm một vòng chờ mạng ngay lúc mở ứng dụng.
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const AttendanceListPage = lazy(() =>
  import('@/features/attendance/AttendanceListPage').then((m) => ({
    default: m.AttendanceListPage,
  })),
);
const RequestListPage = lazy(() =>
  import('@/features/requests/RequestListPage').then((m) => ({ default: m.RequestListPage })),
);
const EmployeeListPage = lazy(() =>
  import('@/features/employees/EmployeeListPage').then((m) => ({ default: m.EmployeeListPage })),
);
const EmployeeDetailPage = lazy(() =>
  import('@/features/employees/EmployeeDetailPage').then((m) => ({
    default: m.EmployeeDetailPage,
  })),
);
const ShiftSchedulePage = lazy(() =>
  import('@/features/shifts/ShiftSchedulePage').then((m) => ({ default: m.ShiftSchedulePage })),
);
const MakeupPage = lazy(() =>
  import('@/features/makeup/MakeupPage').then((m) => ({ default: m.MakeupPage })),
);
const RequestTypesPage = lazy(() =>
  import('@/features/requests/RequestTypesPage').then((m) => ({ default: m.RequestTypesPage })),
);
const RolesPage = lazy(() =>
  import('@/features/access/RolesPage').then((m) => ({ default: m.RolesPage })),
);
const PayrollPage = lazy(() =>
  import('@/features/payroll/PayrollPage').then((m) => ({ default: m.PayrollPage })),
);
const PolicyPage = lazy(() =>
  import('@/features/policy/PolicyPage').then((m) => ({ default: m.PolicyPage })),
);
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const FraudPage = lazy(() =>
  import('@/features/fraud/FraudPage').then((m) => ({ default: m.FraudPage })),
);
const NotificationsPage = lazy(() =>
  import('@/features/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
);
const AuditLogPage = lazy(() =>
  import('@/features/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const DesignSystemPage = lazy(() =>
  import('@/features/design-system/DesignSystemPage').then((m) => ({
    default: m.DesignSystemPage,
  })),
);

function PageFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 320 }} aria-busy="true">
      <Spin size="large" />
    </div>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/*
          Trang trưng bày component — CỐ Ý nằm ngoài mọi guard.
          Nó không gọi API và không hiển thị dữ liệu nghiệp vụ nào, chỉ dựng
          component rỗng. Đặt sau lớp đăng nhập thì người thiết kế và QC phải xin
          tài khoản công ty chỉ để xem một cái nút — và họ sẽ không xem.
          Không có mục trong sidenav: mở bằng cách gõ thẳng đường dẫn.
        */}
        <Route path="/design-system" element={<DesignSystemPage />} />

        <Route element={<RequireAnonymous />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          {/* Ngoài layout: người dùng đang bị buộc đổi mật khẩu chưa được vào
              bất kỳ chức năng nào, nên cũng không cần thấy sidenav. */}
          <Route path="/doi-mat-khau" element={<ChangePasswordPage />} />

          <Route element={<ManagerLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />

            <Route element={<RequirePermission permission="dashboard.view" />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>

            <Route element={<RequirePermission permission="attendance.view" />}>
              <Route path="/attendance" element={<AttendanceListPage />} />
            </Route>

            <Route element={<RequirePermission permission="request.view" />}>
              <Route path="/requests" element={<RequestListPage />} />
            </Route>

            {/* Cấu hình loại đơn nằm dưới /requests nhưng cần quyền KHÁC: duyệt
                đơn là việc của Quản lý, còn đổi luồng duyệt là chính sách công ty. */}
            <Route element={<RequirePermission permission="request.configure" />}>
              <Route path="/requests/settings" element={<RequestTypesPage />} />
            </Route>

            <Route element={<RequirePermission permission="makeup.view" />}>
              <Route path="/makeup" element={<MakeupPage />} />
            </Route>

            <Route element={<RequirePermission permission="fraud.view" />}>
              <Route path="/fraud" element={<FraudPage />} />
            </Route>

            <Route element={<RequirePermission permission="employee.view" />}>
              <Route path="/employees" element={<EmployeeListPage />} />
              <Route path="/employees/:id" element={<EmployeeDetailPage />} />
            </Route>

            <Route element={<RequirePermission permission="shift.assign" />}>
              <Route path="/shifts" element={<ShiftSchedulePage />} />
            </Route>

            <Route element={<RequirePermission permission="role.manage" />}>
              <Route path="/access" element={<RolesPage />} />
            </Route>

            <Route element={<RequirePermission permission="payroll.view" />}>
              <Route path="/payroll" element={<PayrollPage />} />
            </Route>

            <Route element={<RequirePermission permission="report.view" />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            <Route element={<RequirePermission permission="policy.view" />}>
              <Route path="/policy" element={<PolicyPage />} />
            </Route>

            <Route element={<RequirePermission permission="notification.send" />}>
              <Route path="/notifications" element={<NotificationsPage />} />
            </Route>

            <Route element={<RequirePermission permission="audit.view" />}>
              <Route path="/audit-logs" element={<AuditLogPage />} />
            </Route>

            <Route
              path="*"
              element={
                <EmptyState
                  icon="explore_off"
                  title="Không tìm thấy trang"
                  description="Đường dẫn bạn mở không tồn tại hoặc đã đổi. Dùng menu bên trái để quay lại các chức năng chính."
                />
              }
            />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
