import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface PlatformOverview {
  totals: {
    companies: number;
    active: number;
    trial: number;
    suspended: number;
    terminated: number;
    users: number;
  };
  byStatus: Record<string, number>;
  byPlan: Array<{ planId: string | null; name: string; count: number }>;
  createdPerDay: Array<{ day: string; count: number }>;
}

/**
 * Số liệu tầng nền tảng — KHÔNG phải số liệu của một công ty.
 *
 * `staleTime` 5 phút vì nó đếm công ty và tài khoản, hai con số đổi theo ngày
 * chứ không theo phút. Làm mới dày hơn chỉ tốn một truy vấn `groupBy` toàn bảng
 * để nhận lại đúng con số cũ.
 */
export function usePlatformOverview() {
  return useQuery({
    queryKey: ['system', 'overview'],
    queryFn: () => api.get<PlatformOverview>('/system/overview'),
    staleTime: 5 * 60_000,
  });
}
