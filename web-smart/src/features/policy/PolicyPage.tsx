import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { PolicyValuesTab } from './tabs/PolicyValuesTab';
import { ShiftsTab } from './tabs/ShiftsTab';
import { HolidaysTab } from './tabs/HolidaysTab';
import { LeavePolicyTab } from './tabs/LeavePolicyTab';
import { BranchesTab } from './tabs/BranchesTab';
import { DepartmentsTab } from './tabs/DepartmentsTab';

/**
 * Cấu hình chính sách công ty — docs/04 mục 6 (`FR-WEB-POL-01..11`).
 *
 * Sáu nhóm cấu hình gom vào một trang vì chúng liên quan chặt với nhau: đổi
 * geofence của chi nhánh mà không xem lại chính sách "ngoài vùng thì làm gì" là
 * đổi một nửa quyết định.
 *
 * Toàn bộ trang tuân thủ `BR-12`: chính sách cấu hình được, KHÔNG hard-code.
 * Mọi giá trị ở đây đều được engine tính công đọc lúc chạy.
 */
export function PolicyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'values');

  function changeTab(key: string) {
    setTab(key);
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Chính sách công ty"
        description="Quy tắc tính công, ca làm việc, ngày lễ và geofence. Engine tính công đọc trực tiếp các giá trị này — không có gì được viết cứng trong mã nguồn."
      />

      <Tabs
        activeKey={tab}
        onChange={changeTab}
        destroyInactiveTabPane
        items={[
          { key: 'values', label: 'Quy tắc tính công', children: <PolicyValuesTab /> },
          { key: 'shifts', label: 'Danh mục ca', children: <ShiftsTab /> },
          { key: 'holidays', label: 'Ngày nghỉ lễ', children: <HolidaysTab /> },
          { key: 'leave', label: 'Phép năm', children: <LeavePolicyTab /> },
          { key: 'branches', label: 'Chi nhánh & Geofence', children: <BranchesTab /> },
          { key: 'departments', label: 'Phòng ban', children: <DepartmentsTab /> },
        ]}
      />
    </>
  );
}
