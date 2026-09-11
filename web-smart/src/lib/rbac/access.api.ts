import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface RoleCatalogEntry {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** `null` = vai trò hệ thống dùng chung mọi tenant. */
  companyId: string | null;
  permissions: string[];
}

/**
 * Danh mục vai trò và quyền của từng vai trò.
 *
 * Dùng cho màn hình tra cứu "ai làm được gì" — KHÔNG dùng để quyết định hiện hay
 * ẩn nút. Quyền của người đang đăng nhập nằm ở `useAccess()`: hai thứ khác nhau,
 * và lẫn lộn chúng là cách để một người có vai trò `MANAGER` nhìn thấy mọi nút
 * mà vai trò `MANAGER` nói chung được phép, kể cả những nút nằm ngoài phạm vi
 * phòng ban của họ.
 */
export function useRoleCatalog() {
  return useQuery({
    queryKey: ['access', 'roles'],
    queryFn: () => api.get<RoleCatalogEntry[]>('/access/roles'),
    // Danh mục vai trò gần như không đổi trong một phiên làm việc.
    staleTime: 30 * 60 * 1000,
  });
}
