import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';

export interface PayrollPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'REVIEWING' | 'CLOSED' | string;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface PayrollSummaryRow {
  employeeId: string;
  employee: EmployeeRef | null;
  workedMinutes: number;
  standardDays: string | number;
  otMinutes: number;
  otPayMinutes?: number;
  lateCount: number;
  lateMinutesTotal: number;
  earlyLeaveCount: number;
  absentDays: number;
  leaveDays: number;
  makeupMinutes: number;
  penaltyAmount?: number | null;
}

export interface PayrollSummary {
  period: PayrollPeriod;
  rows: PayrollSummaryRow[];
  /** Kỳ đã chốt đọc từ snapshot bất biến; kỳ đang mở tính trực tiếp. */
  fromSnapshot: boolean;
}

/**
 * Báo cáo tiền chốt — docs/04 mục 7.2 bước 3.
 *
 * "Bước 3 không được bỏ qua. Chốt kỳ khi còn đơn chờ duyệt là nguyên nhân khiếu
 * nại lương phổ biến nhất."
 */
export interface PreCloseReport {
  missingRecords: { employee: EmployeeRef | null; workDate: string; issue: string }[];
  pendingRequests: { id: string; employee: EmployeeRef | null; requestTypeName: string; startAt: string }[];
  unreviewedFraudFlags: { id: string; employee: EmployeeRef | null; code: string; createdAt: string }[];
  abnormalEmployees: { employee: EmployeeRef | null; standardDays: number; reason: string }[];
  blockerCount: number;
}

export function usePayrollPeriods() {
  return useQuery({
    queryKey: qk.payrollPeriods(),
    queryFn: () => api.get<PayrollPeriod[]>('/admin/payroll/periods'),
  });
}

export function usePayrollSummary(periodId: string | null) {
  return useQuery({
    queryKey: qk.payrollSummary(periodId ?? ''),
    queryFn: () => api.get<PayrollSummary>(`/admin/payroll/periods/${periodId}/summary`),
    enabled: Boolean(periodId),
  });
}

export function usePreCloseReport(periodId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.payrollPreClose(periodId ?? ''),
    queryFn: () => api.get<PreCloseReport>(`/admin/payroll/periods/${periodId}/pre-close-report`),
    enabled: Boolean(periodId) && enabled,
    // Không cache: báo cáo này quyết định có được chốt kỳ hay không. Đọc lại bản
    // cũ 30 giây trước có thể bỏ sót một đơn vừa được gửi.
    staleTime: 0,
  });
}

function useInvalidatePayroll() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.payroll });
    // Kỳ chốt/mở lại đổi luôn quyền sửa bảng công (BR-07).
    void queryClient.invalidateQueries({ queryKey: qk.attendance });
  };
}

export function useCreatePeriod() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (payload: { name: string; startDate: string; endDate: string }) =>
      api.post<PayrollPeriod>('/admin/payroll/periods', payload),
    onSuccess: invalidate,
  });
}

export function useRecalculatePeriod() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (periodId: string) =>
      api.post<{ jobId?: string; queued: boolean }>(
        `/admin/payroll/periods/${periodId}/recalculate`,
      ),
    onSuccess: invalidate,
  });
}

export function useClosePeriod() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: ({ periodId, reason, force }: { periodId: string; reason: string; force?: boolean }) =>
      api.post<PayrollPeriod>(`/admin/payroll/periods/${periodId}/close`, { reason, force }),
    onSuccess: invalidate,
  });
}

export function useReopenPeriod() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: ({ periodId, reason }: { periodId: string; reason: string }) =>
      api.post<PayrollPeriod>(`/admin/payroll/periods/${periodId}/reopen`, { reason }),
    onSuccess: invalidate,
  });
}

export function useExportPayroll() {
  return useMutation({
    mutationFn: (payload: { periodId: string; format?: 'XLSX' | 'CSV' }) =>
      api.post<{ jobId: string; statusUrl: string }>('/admin/payroll/export', payload),
  });
}
