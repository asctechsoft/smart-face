import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { PaginationMeta } from '@/lib/api/types';

export interface ShiftBoardEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  status: string;
  department: { id: string; name: string } | null;
}

export interface ShiftAssignmentCell {
  id: string;
  employeeId: string;
  shiftId: string;
  /** `YYYY-MM-DD` theo lịch công ty — Backend đã quy đổi, KHÔNG phải ISO datetime. */
  workDate: string;
}

export interface ShiftBoard {
  from: string;
  to: string;
  employees: ShiftBoardEmployee[];
  assignments: ShiftAssignmentCell[];
  holidays: { name: string; date: string }[];
  meta: PaginationMeta;
}

export interface ShiftBoardQuery {
  from: string;
  to: string;
  departmentId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface BulkAssignPayload {
  employeeIds: string[];
  shiftId: string;
  from: string;
  to: string;
  /** ⚠ SỐ THỨ TỰ (1=T2 … 7=CN), KHÁC bitmask `weekdayMask` của cấu hình ca. */
  weekdays?: number[];
}

export interface BulkAssignResult {
  assigned: number;
  employeeCount: number;
  dayCount: number;
  skippedEmployeeIds: string[];
}

/**
 * Bảng phân ca — `FR-WEB-HR-03`.
 *
 * Một lượt gọi trả về cả dòng (nhân viên), ô (phân ca) và ngày lễ. Tách thành
 * nhiều query thì có khoảnh khắc chỉ một phần về tới nơi, và lịch hiện ra trống
 * — người dùng đọc thành "cả phòng chưa xếp ca" rồi xếp đè lên lịch đang có.
 */
export function useShiftBoard(query: ShiftBoardQuery) {
  return useQuery({
    queryKey: qk.shiftBoard(query),
    queryFn: () => api.get<ShiftBoard>('/admin/shift-assignments', { ...query }),
    placeholderData: (previous) => previous,
  });
}

function useInvalidateBoard() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.policy });
}

export function useBulkAssignShifts() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (payload: BulkAssignPayload) =>
      api.post<BulkAssignResult>('/admin/shift-assignments/bulk', payload),
    onSuccess: () => void invalidate(),
  });
}

/**
 * Xoá phân ca một khoảng ngày.
 *
 * Là `POST` chứ không phải `DELETE` vì tham số đi trong body: nhiều proxy cắt
 * body của `DELETE`, và request tới nơi với `employeeIds` rỗng là một loại lỗi
 * không ai muốn gặp ở thao tác xoá.
 */
export function useClearShiftAssignments() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (payload: { employeeIds: string[]; from: string; to: string }) =>
      api.post<{ deleted: number; employeeCount: number }>(
        '/admin/shift-assignments/clear',
        payload,
      ),
    onSuccess: () => void invalidate(),
  });
}
