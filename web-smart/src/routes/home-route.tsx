import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAccess } from '@/lib/rbac/access-context';
import { hasPermission, type Permission } from '@/lib/rbac/permissions';
import { useSetupState } from '@/features/provisioning/provisioning.api';
import { ErrorState } from '@/components/ui';

/**
 * Thứ tự ưu tiên khi chọn trang chủ. Dừng ở mục đầu tiên người này có quyền.
 *
 * Không phải "trang nào cũng được miễn vào được" — thứ tự này là câu trả lời cho
 * *"việc đầu tiên vai trò này làm khi mở web là gì"*:
 *
 *  • Quản trị nền tảng mở web để nhìn danh sách công ty, không phải dashboard
 *    chấm công của một công ty nào.
 *  • Giám đốc mở web để xem tổng quan rồi duyệt.
 *  • Kế toán và Quản lý cũng bắt đầu ở tổng quan.
 *  • Người chỉ có quyền xem đơn (hiếm, nhưng có) thì vào thẳng danh sách đơn.
 */
const HOME_BY_PERMISSION: Array<{ permission: Permission; to: string }> = [
  { permission: 'tenant.view', to: '/system/tenants' },
  { permission: 'report.view', to: '/dashboard' },
  { permission: 'attendance.view', to: '/attendance' },
  { permission: 'request.view', to: '/requests' },
];

/**
 * Trang chủ giải theo quyền, không cố định là `/dashboard`.
 *
 * ## Vì sao không điều hướng cứng
 *
 * Bản trước luôn đưa về `/dashboard`, vốn cần `report.view`. Quản trị nền tảng
 * không có quyền đó — họ đăng nhập xong và nhận ngay màn hình "Bạn không có
 * quyền xem mục này", cho một trang mà đúng ra họ không bao giờ cần tới. Đó là
 * cách tệ nhất để chào một người vừa đăng nhập thành công.
 *
 * ## Vì sao Giám đốc chưa thiết lập xong lại vào wizard
 *
 * Công ty mới tạo thì dashboard trống rỗng — chưa có nhân viên, chưa có ca, chưa
 * có dữ liệu chấm công nào. Đưa Tổng giám đốc vào đó là để họ tự đoán phải làm
 * gì tiếp. Wizard nói thẳng năm việc cần làm.
 */
export function HomeRoute() {
  const { access, isLoading, isError, refetch } = useAccess();

  const canRunSetup = hasPermission(access, 'setup.run');
  const setup = useSetupState(canRunSetup && !isLoading);

  if (isLoading) return <CenteredSpinner />;

  if (isError) {
    return (
      <ErrorState
        title="Chưa xác định được quyền của bạn"
        description="Không đọc được danh sách quyền từ máy chủ, nên chưa biết nên mở trang nào. Thử lại giúp tôi."
        onRetry={refetch}
      />
    );
  }

  // Chờ biết tiến độ wizard trước khi quyết định — điều hướng sang dashboard rồi
  // mới nhảy sang wizard là hai lần chuyển trang cho một quyết định.
  if (canRunSetup && setup.isPending) return <CenteredSpinner />;
  if (canRunSetup && setup.data && setup.data.completedAt === null) {
    return <Navigate to="/thiet-lap" replace />;
  }

  const target = HOME_BY_PERMISSION.find(({ permission }) => hasPermission(access, permission));
  if (target) return <Navigate to={target.to} replace />;

  return (
    <ErrorState
      title="Tài khoản chưa được cấp quyền nào"
      description="Bạn đăng nhập được nhưng chưa có quyền xem chức năng nào. Liên hệ Giám đốc hoặc người quản trị công ty để được cấp quyền."
      canRetry={false}
    />
  );
}

function CenteredSpinner() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 64 }} aria-busy="true">
      <Spin size="large" />
    </div>
  );
}
