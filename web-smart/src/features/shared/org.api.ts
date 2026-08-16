import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';

export interface Department {
  id: string;
  name: string;
  branchId: string | null;
  parentId: string | null;
  managerId: string | null;
  /**
   * Số CBNV **xếp ca được** đứng trực tiếp ở phòng ban này (`ACTIVE` +
   * `PENDING_ACTIVATION`), KHÔNG cộng dồn phòng ban con — muốn cả nhánh thì tự
   * cộng theo `withDescendantDepartments`.
   */
  _count?: { employees: number };
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  wifiSsids: string[];
  wifiBssids: string[];
  beaconUuids: string[];
  allowedIpCidrs: string[];
  timezone: string | null;
}

/**
 * Danh mục phòng ban / chi nhánh dùng ở rất nhiều bộ lọc.
 *
 * `staleTime` 10 phút: đây là dữ liệu cấu hình, đổi vài lần một năm. Để mặc
 * định 30s nghĩa là mỗi lần mở màn hình lại nạp lại hai danh sách chỉ để nhận
 * về đúng nội dung cũ.
 */
export function useDepartments() {
  return useQuery({
    queryKey: qk.departments(),
    queryFn: () => api.get<Department[]>('/admin/departments'),
    staleTime: 10 * 60_000,
  });
}

export function useBranches() {
  return useQuery({
    queryKey: qk.branches(),
    queryFn: () => api.get<Branch[]>('/admin/branches'),
    staleTime: 10 * 60_000,
  });
}

/** Tuỳ chọn cho `<Select>` — thêm sẵn mục "Tất cả". */
export function toSelectOptions(
  items: { id: string; name: string }[] | undefined,
  allLabel = 'Tất cả',
) {
  return [
    { value: '', label: allLabel },
    ...(items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
}
