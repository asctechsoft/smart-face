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
  /** Đúng một người — khác `q` (khớp `contains`) vốn còn kéo về mã trùng tiền tố. */
  employeeId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Một dòng của bảng TỔNG HỢP công — một người, cả kỳ gộp lại.
 *
 * Ba con số công đến từ ba nguồn khác nhau và không được lẫn:
 *
 *  - `standardDays` — số NGÀY người này được xếp ca trong kỳ (`ShiftAssignment`).
 *  - `actualDays`   — công engine đã tính (`AttendanceDaily.standardDays`).
 *  - `missingDays`  — hiệu hai số trên, kẹp ở 0. Server tính, client không tự
 *    trừ lại: hai công thức cùng nghĩa ở hai tầng là hai thứ phải giữ đồng bộ.
 */
export interface AttendanceSummaryRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: { id: string; name: string } | null;
  /**
   * Bảng chấm công đang giữ người này trong tháng.
   *
   * `null` = người rơi khỏi mọi bảng (bảng vừa bị xoá). Màn chi tiết của một
   * CBNV nằm DƯỚI bảng, nên không có id này thì không mở được chi tiết.
   */
  sheetId: string | null;
  standardDays: number;
  actualDays: number;
  missingDays: number;
  otMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** Số ngày `ON_LEAVE` trong kỳ — cùng định nghĩa với bảng lương. */
  leaveDays: number;
  status: AttendanceSummaryStatus;
}

/** Xem `rowStatus` ở Backend — thứ tự này là thứ tự ưu tiên, không phải bảng chữ cái. */
export type AttendanceSummaryStatus =
  | 'LOCKED'
  | 'MISSING_CHECK_OUT'
  | 'NEEDS_REVIEW'
  | 'VALID';

/** Một bảng chấm công của tháng, kèm việc còn phải làm — nguồn của hộp thoại chốt. */
export interface MonthSheetRef {
  id: string;
  name: string;
  status: string;
  departmentIds: string[];
  memberCount: number;
  /**
   * Số người của bảng này còn ít nhất một ngày phải rà.
   *
   * Đếm trên TOÀN bảng, KHÔNG theo bộ lọc đang bật trên màn hình: lọc "Kế toán"
   * rồi bấm Chốt mà hộp thoại ghi Kho vận "0 người cần đối soát" là dẫn thẳng
   * tới một lần chốt sai.
   */
  needsReviewCount: number;
}

export interface AttendanceSheetSummary {
  period: { month: string; from: string; to: string };
  /** Mọi bảng chấm công của tháng. Rỗng = tháng chưa lập bảng nào. */
  sheets: MonthSheetRef[];
  /** Lần tính công gần nhất chạm vào tháng. `null` = tháng chưa có bản ghi công nào. */
  lastCalculatedAt: string | null;
  /**
   * Tổng của CẢ KỲ, không phải tổng cột của trang đang mở — server gộp trên
   * toàn bộ người khớp bộ lọc rồi mới cắt trang.
   */
  totals: {
    employeeCount: number;
    standardDays: number;
    actualDays: number;
    otMinutes: number;
    needsReviewCount: number;
  };
  rows: AttendanceSummaryRow[];
  meta: PaginationMeta;
}

export interface AttendanceSummaryQuery {
  /** `YYYY-MM-DD` bất kỳ trong tháng — Backend tự chuẩn hoá về ngày 01. */
  month?: string;
  branchId?: string;
  departmentId?: string;
  /** Đúng một người — dùng cho màn chi tiết bảng công của từng CBNV. */
  employeeId?: string;
  q?: string;
  /**
   * Chỉ hiện người còn ngày cần đối soát.
   *
   * Lọc DÒNG, không đụng `totals`: cảnh báo "24 nhân viên cần đối soát" và danh
   * sách 24 người đó phải đếm cùng một tập, nên thẻ chỉ số vẫn nói về cả kỳ.
   */
  needsReviewOnly?: boolean;
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
 * Bảng tổng hợp công của cả THÁNG — cửa vào của màn "Bảng công".
 *
 * Truy vấn RIÊNG, không dẫn xuất từ `useAttendanceSheetBoard`: lưới trả dữ liệu
 * thô của 25 người trên trang đang mở, còn hàng thẻ chỉ số ở đây nói về cả
 * tháng. Cộng lưới ở client sẽ cho một con số nhỏ hơn thật và đổi mỗi lần lật
 * trang, trong khi nhãn vẫn ghi "Tổng".
 *
 * Không cần `sheetId`: một tháng gồm nhiều bảng, và Backend gộp hết. Các bảng
 * vẫn trả về trong `sheets` — chốt kỳ vẫn theo từng bảng.
 *
 * `placeholderData` giữ bảng cũ trên màn hình trong lúc đổi bộ lọc — bảng biến
 * mất rồi hiện lại làm mất vị trí cuộn của người đang rà tới dòng thứ 40.
 */
export function useAttendanceSummary(query: AttendanceSummaryQuery) {
  return useQuery({
    queryKey: qk.attendanceSheetSummary(query),
    queryFn: () => api.get<AttendanceSheetSummary>('/admin/attendance-sheets/summary', { ...query }),
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
