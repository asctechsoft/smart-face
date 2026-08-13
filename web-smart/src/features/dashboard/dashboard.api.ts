import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';

export interface DashboardSummary {
  workDate: string;
  totalEmployees: number;
  checkedInToday: number;
  currentlyWorking: number;
  lateToday: number;
  pendingRequests: number;
  otMinutesThisMonth: number;
  unreviewedFraudFlags: number;
}

export interface DashboardAlert {
  id: string;
  code: string;
  severity: string;
  score: number;
  createdAt: string;
  employee: EmployeeRef | null;
}

export interface DashboardAlerts {
  total: number;
  items: DashboardAlert[];
}

export interface TrendPoint {
  workDate: string;
  onTime: number;
  late: number;
  absent: number;
  onLeave: number;
  [key: string]: string | number;
}

/**
 * Dashboard — docs/04 mục 2.
 *
 * Backend cache kết quả trong Redis (TTL 2 phút) vì đây là màn hình mở nhiều
 * nhất. Ở client `refetchInterval` 2 phút khớp với TTL đó: gọi dày hơn chỉ nhận
 * lại đúng bản cache cũ, gọi thưa hơn thì số liệu trên màn hình già hơn số liệu
 * server đang có.
 */
export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard(),
    queryFn: () => api.get<DashboardSummary>('/admin/dashboard'),
    refetchInterval: 120_000,
  });
}

export function useDashboardAlerts() {
  return useQuery({
    queryKey: qk.dashboardAlerts(),
    queryFn: () => api.get<DashboardAlerts>('/admin/dashboard/alerts'),
    refetchInterval: 120_000,
  });
}

export function useAttendanceTrend(from: string, to: string) {
  return useQuery({
    queryKey: qk.reportTrend({ from, to }),
    queryFn: () => api.get<TrendPoint[]>('/admin/reports/attendance-trend', { from, to }),
    enabled: Boolean(from && to),
  });
}
