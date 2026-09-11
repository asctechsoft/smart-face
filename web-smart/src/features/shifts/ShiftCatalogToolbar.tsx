import { Link, useSearchParams } from 'react-router-dom';
import { Button, Input, Select } from 'antd';
import { useCan } from '@/lib/rbac/Can';
import { useBranches } from '@/features/shared/org.api';
import { Button as SfButton, Icon } from '@/components/ui';

/**
 * Thanh công cụ của tab "Danh mục Ca làm việc", nằm CÙNG HÀNG với thanh tab.
 *
 * ## Vì sao nó không nằm trong `ShiftCatalogTab`
 *
 * Thiết kế đặt bốn điều khiển này ngang hàng với hai tab, tức bên ngoài vùng
 * nội dung của tab. Ant Design dựng chỗ đó bằng `tabBarExtraContent`, nên
 * component phải sống ở `ShiftsPage`.
 *
 * Cái giá là nó không chạm được vào state của tab. Nên cả bốn điều khiển đều
 * ghi vào THANH ĐỊA CHỈ (`?q=`, `?branchId=`, `?new=1`), và tab đọc lại từ đó.
 * Đổi lại được ba thứ: bộ lọc không mất khi tải lại trang, đường dẫn gửi cho
 * đồng nghiệp mở ra đúng cái đang xem, và không có cầu state chạy ngược từ
 * trang cha xuống tab con.
 */
export function ShiftCatalogToolbar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const branches = useBranches();

  const canEditTemplate = useCan('shift_template.update');
  const canEditPolicy = useCan('policy.update');
  const canEdit = canEditTemplate || canEditPolicy;
  const canSeeHolidays = useCan('policy.view');

  const query = searchParams.get('q') ?? '';
  const branchId = searchParams.get('branchId') ?? '';

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <Input
        allowClear
        value={query}
        onChange={(event) => patchQuery({ q: event.target.value })}
        placeholder="Tìm theo mã ca, tên ca..."
        prefix={<Icon name="search" size={18} />}
        style={{ width: 260 }}
        aria-label="Tìm ca làm việc"
      />

      <Select
        value={branchId}
        onChange={(value: string) => patchQuery({ branchId: value })}
        style={{ width: 190 }}
        aria-label="Lọc theo chi nhánh"
        title="Lọc theo phòng ban thuộc chi nhánh. Ca áp dụng cho mọi phòng ban luôn hiện."
        options={[
          { value: '', label: 'Tất cả chi nhánh' },
          ...(branches.data ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
        ]}
      />

      {canSeeHolidays ? (
        /*
         * Nút viền trung tính (`Button` của antd) chứ không phải `secondary` của
         * thư viện — `secondary` là viền XANH 2px, đậm ngang nút chính, còn
         * thiết kế vẽ một nút phụ viền xám. Bọc trong `Link` để giữ mở tab mới
         * bằng chuột giữa, giống nút "Mở bảng" ở tab lịch phân ca.
         */
        <Link to="/policy?tab=holidays">
          <Button icon={<Icon name="calendar_month" size={18} />}>Thiết lập ngày lễ</Button>
        </Link>
      ) : null}

      {canEdit ? (
        /*
         * Xanh lá (`action`) theo đúng thiết kế, nhưng là `green-700` của thang
         * màu chứ không phải `#16A34A` trong ảnh mockup: chữ trắng trên
         * `#16A34A` chỉ đạt 3.30:1 và trượt WCAG AA — `npm run check:contrast`
         * bắt đúng cặp này.
         */
        <SfButton variant="action" icon="add" onClick={() => patchQuery({ new: '1' })}>
          Thêm ca làm việc
        </SfButton>
      ) : null}
    </div>
  );
}
