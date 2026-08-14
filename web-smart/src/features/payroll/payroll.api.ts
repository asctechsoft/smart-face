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

/**
 * Một dòng bảng công tổng hợp.
 *
 * Backend chuẩn hoá cả hai nguồn (kỳ đang mở tính trực tiếp / kỳ đã chốt đọc
 * snapshot) về cùng hình dạng này, nên mọi trường số ở đây là `number` thật —
 * không còn chuỗi `Decimal` của Prisma như trước.
 */
export interface PayrollSummaryRow {
  employeeId: string;
  employee: EmployeeRef | null;
  workedMinutes: number;
  standardDays: number;
  /** Tổng ba loại OT — ba cột riêng bên dưới dành cho ai cần tách hệ số. */
  otMinutes: number;
  otMinutesNormal: number;
  otMinutesWeekend: number;
  otMinutesHoliday: number;
  lateCount: number;
  lateMinutesTotal: number;
  earlyLeaveCount: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  missingRecordDays: number;
  makeupMinutes: number;
  penaltyAmount: number | null;
  violationCount: number;
}

export interface PayrollSummary {
  period: PayrollPeriod;
  items: PayrollSummaryRow[];
  /** Kỳ đã chốt đọc từ snapshot bất biến; kỳ đang mở tính trực tiếp. */
  fromSnapshot: boolean;
}

/**
 * Báo cáo tiền chốt — docs/04 mục 7.2 bước 3.
 *
 * "Bước 3 không được bỏ qua. Chốt kỳ khi còn đơn chờ duyệt là nguyên nhân khiếu
 * nại lương phổ biến nhất."
 *
 * Ba mục đầu là ĐẾM, không phải danh sách — đúng như tài liệu mô tả ("Số nhân
 * viên có bản ghi thiếu", "Số đơn còn đang chờ duyệt", "Số lượt chấm công còn
 * gắn cờ"). Chỉ nhóm cuối là danh sách, vì để xử lý số công bất thường thì phải
 * biết bất thường ở AI.
 */
export interface PreCloseBlockers {
  missingRecords: number;
  pendingRequests: number;
  unreviewedFraudFlags: number;
}

export interface PreCloseAnomaly {
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  standardDays: number;
  issue: string;
}

export interface PreCloseReport {
  period: { id: string; name: string; startDate: string; endDate: string; status: string };
  blockers: PreCloseBlockers;
  anomalies: PreCloseAnomaly[];
  canClose: boolean;
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

/**
 * Chạy lại tính công cho kỳ.
 *
 * ⚠ KHÔNG `invalidate` ở `onSuccess`. Endpoint trả 202 ngay khi job được nhận,
 * chứ không phải khi tính xong — làm mới lúc này chỉ tải lại đúng số liệu cũ,
 * rồi bảng đứng im cho tới khi người dùng tự F5. Việc làm mới thuộc về màn hình:
 * nó theo dõi `jobId` và chỉ nạp lại khi job báo xong.
 */
export function useRecalculatePeriod() {
  return useMutation({
    mutationFn: (periodId: string) =>
      api.post<{ jobId: string; statusUrl: string; queued: boolean }>(
        `/admin/payroll/periods/${periodId}/recalculate`,
      ),
  });
}

export function useClosePeriod() {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: ({
      periodId,
      reason,
      force,
    }: {
      periodId: string;
      reason: string;
      force?: boolean;
    }) => api.post<PayrollPeriod>(`/admin/payroll/periods/${periodId}/close`, { reason, force }),
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
      api.post<{ jobId: string; statusUrl: string; queued: boolean }>(
        '/admin/payroll/export',
        payload,
      ),
  });
}
