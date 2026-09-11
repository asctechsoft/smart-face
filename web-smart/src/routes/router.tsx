import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { ManagerLayout } from './layouts/ManagerLayout';
import { RequireAnonymous, RequireAuth, RequirePermission } from './guards';
import { HomeRoute } from './home-route';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { PlatformBootstrapPage } from '@/features/provisioning/PlatformBootstrapPage';
import { EmptyState } from '@/components/ui';

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
const WorkStatusPage = lazy(() =>
  import('@/features/work-status/WorkStatusPage').then((m) => ({ default: m.WorkStatusPage })),
);
const AttendanceSheetListPage = lazy(() =>
  import('@/features/attendance/AttendanceSheetListPage').then((m) => ({
    default: m.AttendanceSheetListPage,
  })),
);
const AttendanceSheetPage = lazy(() =>
  import('@/features/attendance/AttendanceSheetPage').then((m) => ({
    default: m.AttendanceSheetPage,
  })),
);
const AttendanceSummaryPage = lazy(() =>
  import('@/features/attendance/AttendanceSummaryPage').then((m) => ({
    default: m.AttendanceSummaryPage,
  })),
);
const AttendanceEmployeeDetailPage = lazy(() =>
  import('@/features/attendance/AttendanceEmployeeDetailPage').then((m) => ({
    default: m.AttendanceEmployeeDetailPage,
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
const ShiftsPage = lazy(() =>
  import('@/features/shifts/ShiftsPage').then((m) => ({
    default: m.ShiftsPage,
  })),
);
const ShiftSchedulePage = lazy(() =>
  import('@/features/shifts/ShiftSchedulePage').then((m) => ({ default: m.ShiftSchedulePage })),
);
const RequestDetailPage = lazy(() =>
  import('@/features/requests/RequestDetailPage').then((m) => ({ default: m.RequestDetailPage })),
);
const ExecApprovalsPage = lazy(() =>
  import('@/features/exec/ExecApprovalsPage').then((m) => ({ default: m.ExecApprovalsPage })),
);
const PeriodsPage = lazy(() =>
  import('@/features/exec/PeriodsPage').then((m) => ({ default: m.PeriodsPage })),
);
const SetupStepPage = lazy(() =>
  import('@/features/provisioning/SetupStepPage').then((m) => ({ default: m.SetupStepPage })),
);
const SetupWizardPage = lazy(() =>
  import('@/features/provisioning/SetupWizardPage').then((m) => ({ default: m.SetupWizardPage })),
);
const SystemHealthPage = lazy(() =>
  import('@/features/provisioning/SystemHealthPage').then((m) => ({ default: m.SystemHealthPage })),
);
const PlatformOverviewPage = lazy(() =>
  import('@/features/provisioning/PlatformOverviewPage').then((m) => ({
    default: m.PlatformOverviewPage,
  })),
);
const TenantListPage = lazy(() =>
  import('@/features/provisioning/TenantListPage').then((m) => ({ default: m.TenantListPage })),
);
const CreateTenantPage = lazy(() =>
  import('@/features/provisioning/CreateTenantPage').then((m) => ({ default: m.CreateTenantPage })),
);
const PackagesPage = lazy(() =>
  import('@/features/provisioning/PackagesPage').then((m) => ({ default: m.PackagesPage })),
);
const SupportSessionsPage = lazy(() =>
  import('@/features/provisioning/SupportSessionsPage').then((m) => ({
    default: m.SupportSessionsPage,
  })),
);
const PolicyPage = lazy(() =>
  import('@/features/policy/PolicyPage').then((m) => ({ default: m.PolicyPage })),
);
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
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
          {/*
            Khởi tạo nền tảng nằm ngoài mọi guard đăng nhập vì chưa có ai để
            đăng nhập. Thứ giữ an toàn là điều kiện "hệ thống chưa có tài khoản
            nền tảng nào" ở Backend — xem docblock của `PlatformBootstrapPage`.
          */}
          <Route path="/khoi-tao-nen-tang" element={<PlatformBootstrapPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          {/* Ngoài layout: người dùng đang bị buộc đổi mật khẩu chưa được vào
              bất kỳ chức năng nào, nên cũng không cần thấy sidenav. */}
          <Route path="/doi-mat-khau" element={<ChangePasswordPage />} />

          <Route element={<ManagerLayout />}>
            {/* Trang chủ giải theo quyền — xem `HomeRoute`. Điều hướng cứng về
                `/dashboard` làm quản trị nền tảng đăng nhập xong nhận ngay màn
                "không có quyền", cho đúng một trang họ không bao giờ cần. */}
            <Route index element={<HomeRoute />} />

            <Route element={<RequirePermission permission="report.view" />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>

            <Route element={<RequirePermission permission="attendance.view" />}>
              {/* Theo dõi công việc: cùng dữ liệu chấm công nhưng trục GIỜ của
                  một ngày, không phải trục NGÀY của một tháng. Route riêng ở gốc
                  chứ không nằm dưới `/attendance`: nó không thuộc về bảng nào,
                  và `hasNestedNavDestination` sẽ làm mục "Chấm công" trên sidenav
                  ngừng sáng đúng lúc người dùng đang ở màn hình khác. */}
              <Route path="/work-status" element={<WorkStatusPage />} />

              {/* Cửa vào là TỔNG HỢP THEO THÁNG, không phải danh sách bảng.

                  Bảng chấm công vẫn là đơn vị tổ chức (nó giữ danh sách thành
                  viên và là thứ được chốt), nhưng người rà công hỏi "tháng 5
                  còn ai chưa xong" chứ không hỏi "bảng tháng 5 của Kho vận còn
                  ai chưa xong". Danh sách bảng lùi xuống `/attendance/sheets` —
                  nơi lập và xoá bảng. */}
              <Route path="/attendance" element={<AttendanceSummaryPage />} />
              <Route path="/attendance/sheets" element={<AttendanceSheetListPage />} />
              <Route path="/attendance/:id" element={<AttendanceSheetPage />} />
              {/* Chi tiết một CBNV nằm DƯỚI bảng, không ở gốc `/employees/:id`:
                  nó là công của người đó TRONG MỘT KỲ cụ thể, và kỳ đó do bảng
                  quyết định. Treo ở hồ sơ nhân sự thì không có gì nói tháng nào. */}
              <Route
                path="/attendance/:id/employees/:employeeId"
                element={<AttendanceEmployeeDetailPage />}
              />
            </Route>

            <Route element={<RequirePermission permission="request.view" />}>
              <Route path="/requests" element={<RequestListPage />} />
              {/* React Router xep doan tinh tren doan dong, nen `/requests/settings`
                  ben duoi van thang `/requests/:id` du khai sau. */}
              <Route path="/requests/:id" element={<RequestDetailPage />} />
            </Route>

            <Route element={<RequirePermission permission="employee.view" />}>
              <Route path="/employees" element={<EmployeeListPage />} />
              <Route path="/employees/:id" element={<EmployeeDetailPage />} />
            </Route>

            {/* `anyOf`: màn "Ca làm & Phân ca" gộp danh mục ca (Kế toán đọc
                được) với lịch phân ca (`shift.assign`). Gác cả trang bằng
                `shift.assign` sẽ khoá Kế toán khỏi chính danh mục ca mà họ vẫn
                mở được hôm qua ở trang Thiết lập. */}
            <Route
              element={
                <RequirePermission anyOf={['shift.assign', 'shift_template.view', 'policy.view']} />
              }
            >
              <Route path="/shifts" element={<ShiftsPage />} />
            </Route>

            {/* Lưới người × ngày thì vẫn CHỈ `shift.assign`: đọc được danh mục ca
                không có nghĩa là mở được bảng phân ca của một phòng ban. */}
            <Route element={<RequirePermission permission="shift.assign" />}>
              <Route path="/shifts/:id" element={<ShiftSchedulePage />} />
            </Route>

            {/*
              `/access`, `/audit-logs` và `/requests/settings` đã thành ba tab
              của trang Thiết lập. Giữ lại dưới dạng CHUYỂN HƯỚNG chứ không xoá
              route: những đường dẫn này nằm trong bookmark, trong email, và
              trong các bản chụp màn hình gửi cho nhau — xoá hẳn thì chúng thành
              404 mà không ai biết trang đã đi đâu.
            */}
            <Route path="/access" element={<Navigate to="/policy?tab=access" replace />} />
            <Route path="/audit-logs" element={<Navigate to="/policy?tab=audit" replace />} />
            <Route
              path="/requests/settings"
              element={<Navigate to="/policy?tab=request-types" replace />}
            />

            <Route element={<RequirePermission permission="report.view" />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            {/* `anyOf`: trang Thiết lập gộp bốn nhóm quyền, và người chỉ có
                một trong số đó vẫn phải vào được — tab nào không có quyền thì
                trang tự ẩn. */}
            <Route
              element={
                <RequirePermission
                  anyOf={['policy.view', 'request.configure_flow', 'role.assign', 'audit.view']}
                />
              }
            >
              <Route path="/policy" element={<PolicyPage />} />
            </Route>

            <Route element={<RequirePermission permission="audit.view" />}>
              {/* Cùng màn hình với tab "Nhật ký hoạt động", khác lối vào: quản
                  trị nền tảng gọi nó là "Nhật ký hệ thống" vì với họ nó xuyên
                  tenant, và họ KHÔNG có trang Thiết lập của một công ty. */}
              <Route path="/system/logs" element={<AuditLogPage />} />
            </Route>

            {/* --- Màn hình của Giám đốc ---
                `/exec/periods` cố ý mở cho CẢ Kế toán: cùng một danh sách kỳ,
                khác bộ nút. Xem docblock của `PeriodsPage` — tách hai trang thì
                câu "kỳ tháng 8 đang ở đâu" có hai câu trả lời tuỳ người hỏi. */}
            <Route element={<RequirePermission permission="request.approve" />}>
              <Route path="/exec/approvals" element={<ExecApprovalsPage />} />
            </Route>

            <Route element={<RequirePermission permission="timesheet.view" />}>
              <Route path="/exec/periods" element={<PeriodsPage />} />
            </Route>

            {/* --- Thiết lập ban đầu của Tổng giám đốc --- */}
            <Route element={<RequirePermission permission="setup.run" />}>
              <Route path="/thiet-lap" element={<SetupWizardPage />} />
              <Route path="/thiet-lap/:step" element={<SetupStepPage />} />
            </Route>

            {/* --- Quản trị nền tảng ---
                Cùng ứng dụng với web của tenant, đúng ADR-03. `RequirePermission`
                ở đây chỉ để người không có quyền khỏi thấy một trang lỗi — chặn
                thật nằm ở Backend, xem docblock của `nav-items.ts`. */}
            <Route element={<RequirePermission permission="tenant.view" />}>
              <Route path="/system" element={<PlatformOverviewPage />} />
              <Route path="/system/tenants" element={<TenantListPage />} />
            </Route>

            <Route element={<RequirePermission permission="tenant.manage" />}>
              <Route path="/system/tenants/new" element={<CreateTenantPage />} />
            </Route>

            <Route element={<RequirePermission permission="tenant.billing" />}>
              <Route path="/system/packages" element={<PackagesPage />} />
            </Route>

            <Route element={<RequirePermission permission="platform.support_access" />}>
              <Route path="/system/support" element={<SupportSessionsPage />} />
            </Route>

            <Route element={<RequirePermission permission="platform.config" />}>
              <Route path="/system/health" element={<SystemHealthPage />} />
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
