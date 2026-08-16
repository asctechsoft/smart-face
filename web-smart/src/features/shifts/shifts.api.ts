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
  /**
   * Bảng phân ca đã xếp lượt này. `null` = lịch có sẵn từ trước khi có bảng,
   * hoặc do API xếp thẳng — **không phải** việc bảng đang mở đã làm.
   */
  scheduleId: string | null;
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
  /** Giới hạn vào thành viên đã chốt của một bảng phân ca. */
  scheduleId?: string;
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
  /** Gắn lượt xếp vào bảng — Backend kiểm tra ca, kỳ và thành viên theo bảng đó. */
  scheduleId?: string;
}

// ---------------------------------------------------------------------------
//  Bảng phân ca — FR-WEB-HR-13
// ---------------------------------------------------------------------------

export interface ShiftSchedule {
  id: string;
  name: string;
  /** `YYYY-MM-DD`, luôn là ngày 01 của tháng lập bảng. */
  periodMonth: string;
  departmentIds: string[];
  shiftIds: string[];
  memberCount: number;
  assignmentCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSchedulePayload {
  departmentIds: string[];
  shiftIds: string[];
  periodMonth: string;
  name?: string;
}

export function useShiftSchedules(query: {
  month?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: qk.shiftSchedules(query),
    queryFn: () =>
      api.getPaginated<ShiftSchedule>('/admin/shift-schedules', { ...query }).then((page) => page),
    placeholderData: (previous) => previous,
  });
}

export function useShiftSchedule(scheduleId: string | undefined) {
  return useQuery({
    queryKey: qk.shiftSchedule(scheduleId ?? ''),
    queryFn: () => api.get<ShiftSchedule>(`/admin/shift-schedules/${scheduleId}`),
    enabled: Boolean(scheduleId),
  });
}

export function useCreateShiftSchedule() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (payload: CreateSchedulePayload) =>
      api.post<ShiftSchedule>('/admin/shift-schedules', payload),
    onSuccess: () => void invalidate(),
  });
}

// Cố ý KHÔNG có binding cho `PATCH /admin/shift-schedules/:id`. Endpoint vẫn
// tồn tại phía Backend, nhưng Web không cho sửa tham số của bảng đã lập: phạm vi
// đã chốt kéo theo danh sách thành viên và toàn bộ lịch đã xếp, nên sửa nó về
// sau chỉ đổi bộ lọc chứ không đổi dữ liệu — hai thứ lệch nhau đọc như một lỗi.

export function useDeleteShiftSchedule() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: true; removedAssignments: number; removedMembers: number }>(
        `/admin/shift-schedules/${id}`,
      ),
    onSuccess: () => void invalidate(),
  });
}

export function useAddScheduleMembers() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: ({ id, employeeIds }: { id: string; employeeIds: string[] }) =>
      api.post<{ added: number; skipped: number }>(`/admin/shift-schedules/${id}/members`, {
        employeeIds,
      }),
    onSuccess: () => void invalidate(),
  });
}

/** `POST .../remove` chứ không `DELETE`: danh sách id đi trong body — xem `useClearShiftAssignments`. */
export function useRemoveScheduleMembers() {
  const invalidate = useInvalidateBoard();
  return useMutation({
    mutationFn: ({ id, employeeIds }: { id: string; employeeIds: string[] }) =>
      api.post<{ removed: number; removedAssignments: number }>(
        `/admin/shift-schedules/${id}/members/remove`,
        { employeeIds },
      ),
    onSuccess: () => void invalidate(),
  });
}

export interface BulkAssignResult {
  assigned: number;
  employeeCount: number;
  dayCount: number;
  skippedEmployeeIds: string[];
  /**
   * Những ô không xếp được vì giờ ca giao với ca đã có. Tối đa 20 dòng đầu —
   * `conflictCount` mới là tổng thật.
   */
  conflicts: { employeeId: string; workDate: string; shiftName: string }[];
  conflictCount: number;
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
    mutationFn: (payload: {
      employeeIds: string[];
      from: string;
      to: string;
      /** Chỉ xoá đúng ca này. Bỏ trống = xoá mọi ca trong khoảng. */
      shiftId?: string;
    }) =>
      api.post<{ deleted: number; employeeCount: number }>(
        '/admin/shift-assignments/clear',
        payload,
      ),
    onSuccess: () => void invalidate(),
  });
}
