import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { PageQuery } from '@/lib/api/types';

/** Trạng thái một khoản nợ công — `MakeupWorkRecord.status` của Backend. */
export const MAKEUP_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Chưa bù',
  PARTIAL: 'Bù dở dang',
  COMPLETED: 'Đã bù đủ',
  EXPIRED: 'Hết hạn bù',
};

export interface MakeupRecord {
  id: string;
  employeeId: string;
  employee?: {
    id: string;
    fullName: string;
    employeeCode: string;
    department: { id: string; name: string } | null;
  };
  /** `YYYY-MM-DD` — Backend đã quy đổi theo lịch công ty. */
  debtWorkDate: string;
  debtMinutes: number;
  makeupWorkDate: string | null;
  makeupMinutes: number;
  remainingMinutes: number;
  dueDate: string | null;
  requestId: string | null;
  status: string;
  /** Quy đổi do Backend tính — client KHÔNG tự chia lại, xem `useMakeupSummary`. */
  debtStandardDays: number;
  remainingStandardDays: number;
  isOverdue: boolean;
  daysUntilDue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MakeupConversion {
  minutesPerStandardDay: number;
  roundingMinutes: number;
  roundingMode: string;
  dueDays: number;
  carrySurplusToNextMonth: boolean;
}

export interface MakeupSummary {
  openDebtMinutes: number;
  openRecords: number;
  madeUpMinutes: number;
  employeesWithDebt: number;
  openDebtStandardDays: number;
  madeUpStandardDays: number;
  overdueRecords: number;
  overdueMinutes: number;
  conversion: MakeupConversion;
}

export interface MakeupQuery extends PageQuery {
  status?: string;
  employeeId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
}

export function useMakeupList(query: MakeupQuery) {
  return useQuery({
    queryKey: qk.makeupList(query),
    queryFn: () => api.getPaginated<MakeupRecord>('/admin/makeup', { ...query }),
    placeholderData: (previous) => previous,
  });
}

/**
 * Tổng hợp nợ công.
 *
 * Trả kèm `conversion` — quy tắc quy đổi phút → công chuẩn của công ty. Giao
 * diện dùng nó để GIẢI THÍCH con số ("8 giờ = 1 công, làm tròn 15 phút"), chứ
 * không để tự tính lại: hai nơi cùng cài một công thức thì sớm muộn sẽ lệch, và
 * lúc đó số trên màn hình khác số trong bảng lương mà không biết bên nào đúng.
 */
export function useMakeupSummary(query: MakeupQuery) {
  return useQuery({
    queryKey: qk.makeupSummary(query),
    queryFn: () => api.get<MakeupSummary>('/admin/makeup/summary', { ...query }),
  });
}

function useInvalidateMakeup() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.makeup });
}

export function useCreateMakeupDebt() {
  const invalidate = useInvalidateMakeup();
  return useMutation({
    mutationFn: (payload: {
      employeeId: string;
      debtWorkDate: string;
      debtMinutes: number;
      dueDate?: string;
      reason: string;
    }) => api.post<MakeupRecord>('/admin/makeup', payload),
    onSuccess: () => void invalidate(),
  });
}

/**
 * Ghi nhận một lần làm bù.
 *
 * `carried` khác null nghĩa là bù chưa hết: Backend đã tách phần còn nợ sang một
 * dòng mới giữ nguyên ngày phát sinh và hạn. Giao diện phải nói rõ điều này —
 * người dùng vừa bấm "ghi nhận" mà thấy dòng cũ đóng lại sẽ tưởng đã xong.
 */
export function useRecordMakeup() {
  const invalidate = useInvalidateMakeup();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      makeupWorkDate: string;
      minutes: number;
      requestId?: string;
    }) =>
      api.post<{ record: MakeupRecord | null; carried: MakeupRecord | null }>(
        `/admin/makeup/${id}/record`,
        payload,
      ),
    onSuccess: () => void invalidate(),
  });
}

export function useExtendMakeup() {
  const invalidate = useInvalidateMakeup();
  return useMutation({
    mutationFn: ({ id, dueDate, reason }: { id: string; dueDate: string; reason: string }) =>
      api.post<MakeupRecord>(`/admin/makeup/${id}/extend`, { dueDate, reason }),
    onSuccess: () => void invalidate(),
  });
}

export function useCancelMakeup() {
  const invalidate = useInvalidateMakeup();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ cancelled: true }>(`/admin/makeup/${id}/cancel`, { reason }),
    onSuccess: () => void invalidate(),
  });
}
