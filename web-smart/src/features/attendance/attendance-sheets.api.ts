import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { PaginationMeta } from '@/lib/api/types';
import type { AttendanceDaily } from './attendance.api';

// ---------------------------------------------------------------------------
//  Kiểu dữ liệu — khớp `AttendanceSheet` / `AttendanceSheetMember` trong schema
// ---------------------------------------------------------------------------

export interface AttendanceSheet {
  id: string;
  name: string;
  /** `YYYY-MM-DD`, luôn là ngày 01 của tháng lập bảng. */
  periodMonth: string;
  departmentIds: string[];
  /**
   * Các bảng phân ca đã cấp thành viên cho bảng này. Rỗng = thành viên lấy
   * thẳng từ danh sách CBNV của phòng ban vì tháng đó chưa lập phân ca.
   */
  shiftScheduleIds: string[];
  status: 'DRAFT' | 'CLOSED' | string;
  closedAt: string | null;
  closedBy: string | null;
  memberCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceSheetEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  status: string;
  department: { id: string; name: string } | null;
}

/** Một lượt phân ca đã xếp trong kỳ — nguồn của dòng trên cùng mỗi ô. */
export interface SheetAssignmentCell {
  id: string;
  employeeId: string;
  shiftId: string;
  /** `YYYY-MM-DD` theo lịch công ty — Backend đã quy đổi, KHÔNG phải ISO datetime. */
  workDate: string;
  scheduleId: string | null;
}

/**
 * Một đơn từ chạm vào kỳ của bảng.
 *
 * `startDate`/`endDate` là NGÀY LÀM VIỆC do Backend quy đổi theo timezone công
 * ty — dùng cái này để phủ đơn lên các ô, đừng cắt chuỗi từ `startAt`.
 */
export interface SheetRequest {
  id: string;
  employeeId: string;
  status: string;
  startAt: string;
  endAt: string;
  startDate: string;
  endDate: string;
  quantity: string | number;
  isHalfDay: boolean;
  reason: string;
  requestTypeId: string;
  requestTypeCode: string;
  requestTypeName: string;
  /** "DAY" | "HALF_DAY" | "HOUR" */
  unit: string;
  /** "ANNUAL_LEAVE" | "NONE" | "UNPAID" | "OT_CREDIT" | "MAKEUP_CREDIT" */
  deductFrom: string;
  /**
   * Nghỉ theo đơn này có được tính công không.
   *
   * KHÁC `deductFrom`: kia nói trừ vào quỹ nào, cờ này nói ngày đó có vào bảng
   * công không. Công tác không trừ quỹ nào nhưng vẫn đủ công.
   */
  isPaidLeave: boolean;
}

export interface AttendanceSheetBoard {
  from: string;
  to: string;
  employees: AttendanceSheetEmployee[];
  assignments: SheetAssignmentCell[];
  /** Công đã tính. Thiếu một ô nghĩa là ngày đó chưa có bản ghi công nào. */
  dailies: AttendanceDaily[];
  requests: SheetRequest[];
  holidays: { name: string; date: string }[];
  meta: PaginationMeta;
}

export interface AttendanceSheetBoardQuery {
  sheetId: string;
  from?: string;
  to?: string;
  departmentId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateSheetPayload {
  departmentIds: string[];
  periodMonth: string;
  name?: string;
}

// ---------------------------------------------------------------------------
//  Hook
// ---------------------------------------------------------------------------

export function useAttendanceSheets(query: {
  month?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: qk.attendanceSheets(query),
    queryFn: () => api.getPaginated<AttendanceSheet>('/admin/attendance-sheets', { ...query }),
    placeholderData: (previous) => previous,
  });
}

export function useAttendanceSheet(sheetId: string | undefined) {
  return useQuery({
    queryKey: qk.attendanceSheet(sheetId ?? ''),
    queryFn: () => api.get<AttendanceSheet>(`/admin/attendance-sheets/${sheetId}`),
    enabled: Boolean(sheetId),
  });
}

/**
 * Lưới người × ngày.
 *
 * Một lượt gọi trả về cả dòng, lịch ca, công đã tính và đơn từ. Tách thành
 * nhiều query thì có khoảnh khắc chỉ một phần về tới nơi — trên bảng công, "ô
 * trống" và "chưa tải xong" trông giống hệt nhau, mà một cái nghĩa là vắng mặt.
 */
export function useAttendanceSheetBoard({ sheetId, ...query }: AttendanceSheetBoardQuery) {
  return useQuery({
    queryKey: qk.attendanceSheetBoard({ sheetId, ...query }),
    queryFn: () =>
      api.get<AttendanceSheetBoard>(`/admin/attendance-sheets/${sheetId}/board`, { ...query }),
    enabled: Boolean(sheetId),
    placeholderData: (previous) => previous,
  });
}

/**
 * Làm mới mọi thứ liên quan tới bảng chấm công.
 *
 * Quét cả nhánh `attendance` chứ không chỉ khoá của bảng vừa sửa: lưới đọc
 * `AttendanceDaily` — cùng nguồn với danh sách và với hiệu chỉnh công — nên bỏ
 * sót một nhánh là để lại số cũ trên màn hình cạnh số mới.
 */
function useInvalidateSheets() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.attendance });
}

export function useCreateAttendanceSheet() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: (payload: CreateSheetPayload) =>
      api.post<AttendanceSheet>('/admin/attendance-sheets', payload),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteAttendanceSheet() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: true; removedMembers: number }>(`/admin/attendance-sheets/${id}`),
    onSuccess: () => void invalidate(),
  });
}

export function useAddSheetMembers() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: ({ id, employeeIds }: { id: string; employeeIds: string[] }) =>
      api.post<{ added: number; skipped: number }>(`/admin/attendance-sheets/${id}/members`, {
        employeeIds,
      }),
    onSuccess: () => void invalidate(),
  });
}

/** `POST .../remove` chứ không `DELETE`: danh sách id đi trong body. */
export function useRemoveSheetMembers() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: ({ id, employeeIds }: { id: string; employeeIds: string[] }) =>
      api.post<{ removed: number }>(`/admin/attendance-sheets/${id}/members/remove`, {
        employeeIds,
      }),
    onSuccess: () => void invalidate(),
  });
}

/**
 * Cập nhật bảng công — tính lại công cả kỳ cho thành viên trong bảng.
 *
 * Cần thiết vì `AttendanceDaily` là bảng ĐÃ TÍNH: đơn duyệt ngược cho ngày đã
 * qua, sửa cấu hình ca, hay xếp lại phân ca đều KHÔNG tự kích hoạt tính lại.
 *
 * Trả `202` + `jobId` chứ không đợi: một bảng 50 người × 31 ngày là 1550 lượt
 * tính, giữ kết nối HTTP suốt thời gian đó sẽ chạm timeout của proxy trước khi
 * xong. Theo dõi bằng `useExportJob(jobId)` — cùng endpoint `GET /jobs/:id` với
 * mọi việc chạy nền khác.
 *
 * KHÔNG `invalidate` ở đây: lúc request trả về, job mới chỉ vừa được nhận và số
 * liệu chưa đổi. Làm mới ngay chỉ tải lại đúng những con số cũ rồi đứng im.
 * Việc đó thuộc về lúc job báo `COMPLETED`.
 */
export function useRecalculateAttendanceSheet() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ jobId: string; statusUrl: string; employeeCount: number }>(
        `/admin/attendance-sheets/${id}/recalculate`,
        {},
      ),
  });
}

export function useCloseAttendanceSheet() {
  const invalidate = useInvalidateSheets();
  return useMutation({
    mutationFn: ({ id, reopen }: { id: string; reopen?: boolean }) =>
      api.post<AttendanceSheet>(`/admin/attendance-sheets/${id}/${reopen ? 'reopen' : 'close'}`, {}),
    onSuccess: () => void invalidate(),
  });
}
