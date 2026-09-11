import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from 'antd';
import { Button, EmptyState } from '@/components/ui';
import { useCan } from '@/lib/rbac/Can';
import { ShiftCatalogTab } from './ShiftCatalogTab';
import { ShiftScheduleTab } from './ShiftScheduleTab';

/**
 * Màn **Ca làm & Phân ca** — mục "Ca làm & Phân ca" trên sidenav.
 *
 * ## Vì sao hai tab chứ không hai màn hình
 *
 * Khai ca và xếp ca là một mạch việc: mở bảng phân ca ra mới phát hiện thiếu ca
 * đêm, khai xong lại quay về xếp tiếp. Trước đây danh mục ca nằm trong "Thiết
 * lập → Danh mục ca" còn bảng phân ca ở mục riêng, nên mạch đó là hai lần đổi
 * màn hình mỗi vòng. Giờ chúng là hai tab cạnh nhau, giữ nguyên hai bộ dữ liệu
 * và hai bộ quyền.
 *
 * ## Không có `PageHeader`
 *
 * Thanh trên cùng đã in tên màn hình đang mở (`resolvePageTitle`), nên một tiêu
 * đề "Ca làm & Phân ca" nữa ngay bên dưới là nói hai lần cùng một câu và đẩy
 * bảng xuống gần 100px — trên màn 1080 đó là hai dòng dữ liệu bị mất. Hàng tab
 * là thứ đầu tiên của trang, và nó tự nói người dùng đang ở đâu.
 *
 * ## Hành động của tab nằm ở đâu
 *
 * Mỗi tab tự mang bộ điều khiển của nó: danh mục ca dựng thanh công cụ bên
 * trong thẻ "Danh sách ca làm việc", còn lịch phân ca chỉ có một nút và nút đó
 * ở `tabBarExtraContent`. Không có bộ nào dùng chung — ô tìm ca không có nghĩa
 * gì khi người dùng đang xem lịch phân ca.
 *
 * ## Tab lọc theo quyền, không chỉ ẩn bằng CSS
 *
 * Hai tab gác bằng hai quyền khác nhau, đúng như khi chúng còn là hai màn hình:
 * danh mục là `shift_template.view` / `policy.view` (Kế toán đọc được), còn xếp
 * lịch là `shift.assign` (docs/05 §1: Kế toán KHÔNG mặc định có). Ai chỉ có một
 * trong hai thì thấy đúng một tab, không phải một tab bấm vào báo lỗi 403.
 */
export function ShiftsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Hai lời gọi riêng chứ không `useCan(a) || useCan(b)`: toán tử `||` cắt mạch,
  // và một hook bị bỏ qua tuỳ theo quyền của người đăng nhập là vi phạm quy tắc
  // hook — React sẽ lệch thứ tự hook giữa hai lần render.
  const canViewTemplate = useCan('shift_template.view');
  const canViewPolicy = useCan('policy.view');
  const canViewCatalog = canViewTemplate || canViewPolicy;
  const canAssign = useCan('shift.assign');

  const items = [
    ...(canViewCatalog
      ? [{ key: 'catalog', label: 'Danh mục Ca làm việc', children: <ShiftCatalogTab /> }]
      : []),
    ...(canAssign
      ? [{ key: 'schedule', label: 'Lịch phân ca', children: <ShiftScheduleTab /> }]
      : []),
  ];

  /*
   * Tab mặc định là tab ĐẦU TIÊN NGƯỜI NÀY ĐƯỢC XEM, không phải `'catalog'` cố
   * định: Giám đốc chỉ có `shift.assign` mà mặc định rơi vào một tab không tồn
   * tại sẽ thấy trang có thanh tab nhưng trống ruột.
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
    /*
     * Xoá bộ lọc của tab vừa rời đi. Hai tab dùng chung thanh địa chỉ, và một
     * `?q=đêm` còn sót lại từ danh mục sẽ không lọc gì ở lịch phân ca — nhưng
     * người dùng gửi đường dẫn đó cho đồng nghiệp thì bên kia mở ra thấy một bộ
     * lọc rỗng đang bật. `new` cũng phải xoá, nếu không đổi tab xong biểu mẫu
     * tạo mới của tab kia bật lên ngay.
     */
    ['q', 'branchId', 'month', 'departmentId', 'page', 'pageSize', 'new'].forEach((param) =>
      next.delete(param),
    );
    setSearchParams(next, { replace: true });
  }

  function openCreate() {
    const next = new URLSearchParams(searchParams);
    next.set('new', '1');
    setSearchParams(next, { replace: true });
  }

  return (
    <>
      {items.length === 0 ? (
        <EmptyState
          icon="lock"
          title="Bạn không có phần nào của màn hình này"
          description="Vai trò hiện tại của bạn không xem được danh mục ca và cũng không xếp được lịch. Liên hệ Admin công ty nếu bạn cho rằng đây là nhầm lẫn."
        />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={changeTab}
          destroyInactiveTabPane
          items={items}
          /*
           * Chỉ tab lịch phân ca còn dùng chỗ này. Thanh công cụ của danh mục ca
           * đã chuyển vào trong thẻ "Danh sách ca làm việc", ngang hàng với tiêu
           * đề của thẻ — ô tìm kiếm đứng ngay trên bảng mà nó lọc.
           */
          tabBarExtraContent={{
            right:
              tab === 'schedule' && canAssign ? (
                <Button variant="action" icon="add" onClick={openCreate}>
                  Lập bảng phân ca
                </Button>
              ) : null,
          }}
        />
      )}
    </>
  );
}
