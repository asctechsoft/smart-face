import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Tabs } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { useCan } from '@/lib/rbac/Can';
import { EmptyState } from '@/components/ui';
import { RequestTypesPage } from '@/features/requests/RequestTypesPage';
import { RolesPage } from '@/features/access/RolesPage';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { PolicyValuesTab } from './tabs/PolicyValuesTab';
import { HolidaysTab } from './tabs/HolidaysTab';
import { LeavePolicyTab } from './tabs/LeavePolicyTab';
import { BranchesTab } from './tabs/BranchesTab';
import { DepartmentsTab } from './tabs/DepartmentsTab';

/**
 * Thiết lập — mục cuối trên thanh điều hướng.
 *
 * ## Vì sao tám tab chứ không tám màn hình
 *
 * Năm tab đầu là cấu hình chính sách (`docs/04` mục 6, `FR-WEB-POL-01..11`) và
 * chúng liên quan chặt với nhau: đổi geofence của chi nhánh mà không xem lại
 * chính sách "ngoài vùng thì làm gì" là đổi một nửa quyết định.
 *
 * ## Danh mục ca KHÔNG còn ở đây
 *
 * Nó đã chuyển sang màn "Ca làm & Phân ca" (`/shifts`), nằm cạnh tab lịch phân
 * ca. Lý do ở docblock của `ShiftCatalogTab`: khai ca và xếp ca là một mạch
 * việc, tách ra hai mục sidenav là bắt người dùng đi đi lại lại. Đường dẫn cũ
 * `/policy?tab=shifts` được chuyển hướng chứ không bỏ — nó nằm trong bookmark và
 * trong ảnh chụp màn hình gửi cho nhau.
 *
 * Ba tab cuối trước đây nằm trong một popover bánh răng ở thanh trên. Popover
 * đó đã bị gỡ. Nó là lối vào thứ hai, ở một góc màn hình khác, cho những màn
 * hình cùng loại với "Chính sách" — vốn đã có mục riêng trên sidenav. Người
 * dùng phải nhớ chức năng nào nằm ở bánh răng và chức năng nào nằm ở thanh
 * trái, một câu hỏi không ai nên phải trả lời.
 *
 * ## Tab lọc theo quyền, không chỉ ẩn bằng CSS
 *
 * Mỗi tab gác bằng đúng quyền mà route cũ của nó gác. Kế toán có `audit.view`
 * nhưng không có `role.assign` sẽ thấy tab Nhật ký mà không thấy tab Phân
 * quyền — y như khi ba màn này còn là ba route riêng.
 *
 * Toàn bộ trang tuân thủ `BR-12`: chính sách cấu hình được, KHÔNG hard-code.
 * Mọi giá trị ở đây đều được engine tính công đọc lúc chạy.
 */
export function PolicyPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const canPolicy = useCan('policy.view');
  const canRequestFlow = useCan('request.configure_flow');
  const canRoles = useCan('role.assign');
  const canAudit = useCan('audit.view');

  const items = [
    ...(canPolicy
      ? [
          { key: 'values', label: 'Quy tắc tính công', children: <PolicyValuesTab /> },
          { key: 'holidays', label: 'Ngày nghỉ lễ', children: <HolidaysTab /> },
          { key: 'leave', label: 'Phép năm', children: <LeavePolicyTab /> },
          { key: 'branches', label: 'Chi nhánh & Geofence', children: <BranchesTab /> },
          { key: 'departments', label: 'Phòng ban', children: <DepartmentsTab /> },
        ]
      : []),
    ...(canRequestFlow
      ? [
          {
            key: 'request-types',
            label: 'Loại đơn & luồng duyệt',
            children: <RequestTypesPage embedded />,
          },
        ]
      : []),
    ...(canRoles ? [{ key: 'access', label: 'Phân quyền', children: <RolesPage embedded /> }] : []),
    ...(canAudit
      ? [{ key: 'audit', label: 'Nhật ký hoạt động', children: <AuditLogPage embedded /> }]
      : []),
  ];

  /*
   * Tab mặc định là tab ĐẦU TIÊN NGƯỜI NÀY ĐƯỢC XEM, không phải `'values'` cố
   * định. Ai đó chỉ có `audit.view` mà mặc định rơi vào một tab không tồn tại
   * sẽ thấy một trang có thanh tab nhưng trống ruột.
   */
  const requested = searchParams.get('tab');
  const fallback = items[0]?.key ?? '';
  const [tab, setTab] = useState(
    requested && items.some((item) => item.key === requested) ? requested : fallback,
  );

  function changeTab(key: string) {
    setTab(key);
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  }

  /*
   * Đường dẫn cũ của danh mục ca. `Navigate` chứ không phải một tab rỗng: người
   * mở bookmark `?tab=shifts` phải tới được nơi màn hình đó đang ở, không phải
   * tới trang Thiết lập rồi tự đoán.
   */
  if (requested === 'shifts') return <Navigate to="/shifts?tab=catalog" replace />;

  return (
    <>
      <PageHeader
        title="Thiết lập"
        description="Quy tắc tính công, ngày lễ, phép năm, geofence, phòng ban, luồng duyệt đơn, phân quyền và nhật ký hoạt động. Engine tính công đọc trực tiếp các giá trị này — không có gì được viết cứng trong mã nguồn. Danh mục ca làm việc đã chuyển sang màn Ca làm & Phân ca."
      />

      {items.length === 0 ? (
        <EmptyState
          icon="lock"
          title="Bạn không có phần thiết lập nào"
          description="Vai trò hiện tại của bạn không bao gồm quyền cấu hình nào. Liên hệ Admin công ty nếu bạn cho rằng đây là nhầm lẫn."
        />
      ) : (
        <Tabs activeKey={tab} onChange={changeTab} destroyInactiveTabPane items={items} />
      )}
    </>
  );
}
