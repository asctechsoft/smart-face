import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** `docs/13` §5.4 — năm trạng thái, không còn `CLOSED`/`REVIEWING` của bản cũ. */
export type PayrollPeriodStatus =
  | 'OPEN'
  | 'CALCULATING'
  | 'PENDING_APPROVAL'
  | 'LOCKED'
  | 'REOPENED';

export interface PayrollPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: PayrollPeriodStatus;
  currentVersion: number;
  rowVersion: number;
  closedAt: string | null;
  createdAt: string;
}

export interface PeriodVersion {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  summary: Record<string, unknown> | null;
  note: string | null;
}

export interface PeriodTransition {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}

const PERIODS_KEY = ['payroll', 'periods'] as const;

/**
 * Danh sach ky luong.
 *
 * `enabled` de noi goi quyet dinh: endpoint doi quyen `timesheet.view`, ma man
 * hinh Tong quan con mo cho Quan ly — goi thay ho chi tao mot chuoi 403 trong
 * nhat ky ma khong ai doc.
 */
export function usePeriods(enabled = true) {
  return useQuery({
    queryKey: PERIODS_KEY,
    queryFn: () => api.getPaginated<PayrollPeriod>('/admin/payroll/periods', { pageSize: 50 }),
    enabled,
  });
}

export function usePeriodVersions(periodId: string | null) {
  return useQuery({
    queryKey: ['payroll', 'periods', periodId, 'versions'],
    queryFn: () => api.get<PeriodVersion[]>(`/admin/payroll/periods/${periodId}/versions`),
    enabled: Boolean(periodId),
  });
}

export function usePeriodTransitions(periodId: string | null) {
  return useQuery({
    queryKey: ['payroll', 'periods', periodId, 'transitions'],
    queryFn: () => api.get<PeriodTransition[]>(`/admin/payroll/periods/${periodId}/transitions`),
    enabled: Boolean(periodId),
  });
}

/**
 * Mọi thao tác trên kỳ đều làm mới danh sách kỳ VÀ dữ liệu chấm công.
 *
 * Chốt kỳ khoá luôn việc sửa công của khoảng thời gian đó (`BR-07`), nên bảng
 * công đang mở ở tab khác vẫn hiện nút "Hiệu chỉnh" nếu không xoá cache — người
 * dùng bấm vào và nhận `ATT_PERIOD_LOCKED` mà không hiểu vì sao.
 */
function useInvalidatePeriods() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: PERIODS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
  };
}

// ===========================================================================
//  Kế toán — GỬI đề nghị
// ===========================================================================

export function useSubmitLock() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.post<PayrollPeriod>(`/admin/payroll/periods/${id}/submit-lock`, { note }),
    onSuccess: invalidate,
  });
}

export function useRequestReopen() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<unknown>(`/admin/payroll/periods/${id}/request-reopen`, { reason }),
    onSuccess: invalidate,
  });
}

// ===========================================================================
//  Giám đốc — DUYỆT
// ===========================================================================

/**
 * Duyệt chốt kỳ. Cần step-up (`BR-18`) — Backend trả `STEPUP_REQUIRED` nếu
 * thiếu header `X-Step-Up-Token`, và giao diện phải dẫn người dùng xác thực lại
 * chứ không hiện một lỗi đỏ khó hiểu.
 */
export function useApproveLock() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: ({ id, stepUpToken }: { id: string; stepUpToken?: string }) =>
      api.post<PayrollPeriod>(
        `/exec/periods/${id}/approve-lock`,
        {},
        stepUpToken ? { headers: { 'X-Step-Up-Token': stepUpToken } } : undefined,
      ),
    onSuccess: invalidate,
  });
}

export function useRejectLock() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<PayrollPeriod>(`/exec/periods/${id}/reject-lock`, { reason }),
    onSuccess: invalidate,
  });
}

export function useApproveReopen() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: ({ id, reason, stepUpToken }: { id: string; reason: string; stepUpToken?: string }) =>
      api.post<PayrollPeriod>(
        `/exec/periods/${id}/approve-reopen`,
        { reason },
        stepUpToken ? { headers: { 'X-Step-Up-Token': stepUpToken } } : undefined,
      ),
    onSuccess: invalidate,
  });
}
