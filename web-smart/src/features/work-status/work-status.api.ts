import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { PaginationMeta } from '@/lib/api/types';

// ---------------------------------------------------------------------------
//  Kiểu dữ liệu — khớp `work-status.service.ts` phía Backend
// ---------------------------------------------------------------------------

/**
 * Trạng thái làm việc — do BACKEND phân loại, client KHÔNG suy lại.
 *
 * Luật phân loại nằm ở `work-status.rules.ts` và có bộ test riêng. Dựng một bản
 * sao ở đây để "tiện" sẽ tạo ra hai luật, và ngày chúng lệch nhau thì con số
 * tổng ở đầu trang mâu thuẫn với chính những dòng ngay bên dưới.
 */
export type WorkState =
  | 'LATE_NOT_ARRIVED'
  | 'ABSENT'
  | 'MISSING_CHECKOUT'
  | 'OUTSIDE'
  | 'WORKING'
  | 'DONE'
  | 'NOT_ARRIVED'
  | 'BUSINESS_TRIP'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'NO_SHIFT';

/**
 * Mọi mốc thời gian là SỐ PHÚT tính từ 00:00 của ngày làm việc, theo giờ công ty.
 *
 * Backend đã quy đổi. Client tuyệt đối không nhận instant rồi tự cắt chuỗi ISO:
 * quy đổi đúng cần múi giờ công ty, và mỗi chỗ quên kéo theo nó là một lỗi lệch
 * ngày chỉ lộ ra ở máy người dùng đặt múi giờ khác (xem `lib/utils/date.ts`).
 *
 * Phút CÓ THỂ vượt 1440: ca đêm 22:00 → 06:00 gắn với ngày bắt đầu ca, nên giờ
 * tan ca của nó là 1800 (= 30:00).
 */
export interface WorkStatusMark {
  logId: string;
  type: 'CHECK_IN' | 'CHECK_OUT' | 'BREAK_OUT' | 'BREAK_IN' | 'RANDOM_CHECK' | string;
  atMinutes: number;
  authMethod: string;
  branchName: string | null;
}

export interface WorkStatusShift {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface MinuteRange {
  fromMinutes: number;
  toMinutes: number;
}

export interface WorkStatusShiftWindow extends MinuteRange {
  shiftId: string;
  lateToleranceMinutes: number;
}

/** `toMinutes === null` = vẫn đang ở ngoài, chưa quẹt về. */
export interface OutsideInterval {
  fromMinutes: number;
  toMinutes: number | null;
}

export interface WorkStatusRequest extends MinuteRange {
  id: string;
  code: string;
  status: string;
  wholeDay: boolean;
  typeName: string;
  reason: string;
}

export interface WorkStatusRow {
  employee: {
    id: string;
    fullName: string;
    employeeCode: string;
    department: { id: string; name: string } | null;
  };
  state: WorkState;
  stateLabel: string;
  firstCheckInMinutes: number | null;
  lastCheckOutMinutes: number | null;
  outsideSinceMinutes: number | null;
  expectedStartMinutes: number | null;
  expectedEndMinutes: number | null;
  hasPendingRequest: boolean;
  activeCoverIds: string[];

  shifts: WorkStatusShift[];
  shiftWindows: WorkStatusShiftWindow[];
  breakWindows: MinuteRange[];
  outsideIntervals: OutsideInterval[];
  marks: WorkStatusMark[];
  requests: WorkStatusRequest[];

  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otMinutes: number;
  hasFraudFlag: boolean;
  dailyStatus: string | null;
}

export interface WorkStatusBoard {
  workDate: string;
  timezone: string;
  isToday: boolean;
  isPastDay: boolean;
  /** Phút hiện tại của ngày làm việc — vạch "bây giờ" trên trục vẽ từ đây. */
  nowMinutes: number;
  holiday: { id: string; name: string } | null;
  /** Khoảng giờ trục thời gian phủ, dùng chung cho MỌI dòng của trang. */
  window: MinuteRange;
  summary: Record<WorkState, number>;
  /** Số CBNV phần tổng đã phủ — luôn là cả phạm vi lọc, không phải một trang. */
  summaryScope: number;
  /** Phạm vi vượt trần server và đã bị cắt. Phải nói ra cho người dùng. */
  scopeTruncated: boolean;
  scopeTotal: number;
  rows: WorkStatusRow[];
  meta: PaginationMeta;
}

export interface WorkStatusQuery {
  date?: string;
  departmentId?: string;
  q?: string;
  state?: WorkState;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
//  Hook
// ---------------------------------------------------------------------------

/** Nhịp tự làm mới khi đang xem HÔM NAY. Khớp với TTL cache 20s phía Backend. */
const LIVE_REFETCH_MS = 60_000;

/**
 * Lưới theo dõi công việc của một ngày.
 *
 * Chỉ tự làm mới khi đang xem hôm nay: dữ liệu của ngày đã qua không đổi nữa, và
 * gọi lại API mỗi phút cho một ngày cố định là tải thuần tuý — trong khi vẫn làm
 * bảng nháy và cuộn nhảy dưới tay người đang đọc.
 *
 * `placeholderData` giữ lưới cũ trong lúc tải lượt mới: không có nó thì mỗi phút
 * màn hình lại chớp về skeleton một nhịp, và một màn hình theo dõi mở suốt ngày
 * mà cứ chớp thì không ai để nó mở.
 */
export function useWorkStatusBoard(query: WorkStatusQuery, options?: { live?: boolean }) {
  return useQuery({
    queryKey: qk.workStatusBoard(query),
    queryFn: () => api.get<WorkStatusBoard>('/admin/work-status', { ...query }),
    placeholderData: (previous) => previous,
    refetchInterval: options?.live ? LIVE_REFETCH_MS : false,
    // Cửa sổ bị che rồi mở lại sau giờ nghỉ trưa phải thấy số mới ngay, không
    // phải chờ hết nhịp làm mới tiếp theo.
    refetchOnWindowFocus: options?.live ?? false,
  });
}

export interface RemindResult {
  sent: number;
  /** Bị bỏ qua vì nằm ngoài phạm vi phòng ban của người gửi. */
  skipped: number;
  workDate: string;
}

/**
 * Nhắc CBNV chưa chấm công.
 *
 * Không xoá cache lưới sau khi gửi: nhắc nhở không làm ai chấm công ngay lúc đó,
 * nên tải lại chỉ lấy về đúng những con số cũ. Nhịp làm mới định kỳ sẽ bắt được
 * thay đổi thật khi nó xảy ra.
 */
export function useRemindWorkStatus() {
  return useMutation({
    mutationFn: (payload: { employeeIds: string[]; date?: string; message?: string }) =>
      api.post<RemindResult>('/admin/work-status/remind', payload),
  });
}

export function useExportWorkStatus() {
  return useMutation({
    mutationFn: (payload: { date?: string; departmentIds?: string[] }) =>
      api.post<{ jobId: string; statusUrl: string }>('/admin/work-status/export', payload),
  });
}

/**
 * Làm mới lưới ngay lập tức — dùng sau khi duyệt đơn ngay trên màn hình này.
 *
 * Khác với nhắc nhở: duyệt một đơn xin ra ngoài ĐỔI NGAY trạng thái của người
 * đó trên lưới, nên để nguyên số cũ là hiện kết quả sai của chính thao tác vừa
 * làm.
 */
export function useInvalidateWorkStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.workStatus });
}
