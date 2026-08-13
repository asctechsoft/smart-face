import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';
import type { PageQuery } from '@/lib/api/types';
import type { AttendanceLog } from '@/features/attendance/attendance.api';

export interface FraudFlag {
  id: string;
  attendanceLogId: string | null;
  employeeId: string;
  employee: EmployeeRef | null;
  code: string;
  severity: string;
  score: number;
  details: Record<string, unknown> | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** "KEEP" | "VOID" | "ESCALATE" */
  reviewDecision: string | null;
  reviewReason: string | null;
  createdAt: string;
  attendanceLog?: AttendanceLog | null;
}

export interface FraudQuery extends PageQuery {
  from?: string;
  to?: string;
  code?: string;
  severity?: string;
  reviewed?: boolean;
  departmentId?: string;
}

/**
 * Hình dạng đúng theo `FraudStatsCounters` của backend
 * (`fraud.repository.ts` — `countStats`). Backend đếm sẵn `high` / `pending`
 * thay vì trả mảng `bySeverity` để màn hình tự tìm, nên đừng suy diễn thêm
 * trường ở đây: lệch một tên là màn hình vỡ ngay lúc render.
 */
export interface FraudStats {
  total: number;
  /** Số cờ mức độ HIGH trong kỳ. */
  high: number;
  /** Số cờ chưa ai quyết định — chặn chốt kỳ lương. */
  pending: number;
  reviewed: number;
  byCode: { code: string; count: number }[];
}

export function useFraudFlags(query: FraudQuery) {
  return useQuery({
    queryKey: qk.fraudFlags(query),
    queryFn: () => api.getPaginated<FraudFlag>('/admin/fraud/flags', { ...query }),
    placeholderData: (previous) => previous,
  });
}

export function useFraudStats(params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: qk.fraudStats(params),
    queryFn: () => api.get<FraudStats>('/admin/fraud/stats', params),
  });
}

export function useFraudFlag(id: string | null) {
  return useQuery({
    queryKey: qk.fraudDetail(id ?? ''),
    queryFn: () => api.get<FraudFlag>(`/admin/fraud/flags/${id}`),
    enabled: Boolean(id),
    staleTime: 4 * 60_000,
  });
}

/**
 * Quyết định giữ hay huỷ một lượt chấm công nghi vấn — AF-23.
 *
 * `VOID` không xoá bản ghi thô (BR-06) mà tạo bản ghi hiệu chỉnh loại bỏ lượt
 * đó khỏi phép tính công. Bản gốc vẫn còn để đối chiếu nếu nhân viên khiếu nại
 * — và họ sẽ khiếu nại, vì quyết định này trừ tiền của họ.
 */
export function useReviewFlag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: 'KEEP' | 'VOID' | 'ESCALATE';
      reason: string;
    }) => api.post<FraudFlag>(`/admin/fraud/flags/${id}/review`, { decision, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.fraud });
      void queryClient.invalidateQueries({ queryKey: qk.attendance });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
    },
  });
}
