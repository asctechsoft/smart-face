import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';
import type { PageQuery } from '@/lib/api/types';

export interface RequestType {
  id: string;
  code: string;
  name: string;
  /** "ANNUAL_LEAVE" | "NONE" | "UNPAID" | "OT_CREDIT" | "MAKEUP_CREDIT" */
  deductFrom: string;
  /** "DAY" | "HALF_DAY" | "HOUR" */
  unit: string;
  requiresAttachment: boolean;
}

export interface ApprovalStep {
  id: string;
  order: number;
  approverRole?: string | null;
  approverId?: string | null;
  approverName?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | string;
  comment?: string | null;
  decidedAt?: string | null;
}

export interface RequestAttachment {
  id: string;
  fileName: string;
  /** Presigned URL, có thời hạn. */
  url?: string | null;
  sizeBytes?: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee: EmployeeRef | null;
  requestType: RequestType | null;
  status: string;
  startAt: string;
  endAt: string;
  quantity: string | number;
  isHalfDay: boolean;
  reason: string;
  expectedReturnAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  approvalSteps?: ApprovalStep[];
  attachments?: RequestAttachment[];
  /**
   * Có giá trị khi đơn do HR/Quản lý nhập hộ, `null` khi nhân viên tự gửi.
   *
   * Backend đọc từ nhật ký kiểm toán, không phải một cột trên bảng đơn — nên
   * không ai sửa lại được dấu vết này.
   */
  createdOnBehalf?: {
    actorName: string | null;
    actorUserId: string | null;
    reason: string | null;
    createdAt: string;
  } | null;
}

export interface ApproverCandidate {
  id: string;
  fullName: string;
  employeeCode: string;
}

export interface ApprovalPreviewStep {
  order: number;
  approverRole: string;
  approverRoleLabel: string;
  /** Người hệ thống tự suy. `null` = bất kỳ ai giữ vai trò tương ứng. */
  suggestedApproverId: string | null;
  suggestedApproverName: string | null;
  candidates: ApproverCandidate[];
}

export interface ApprovalPreview {
  quantity: number;
  unit: string;
  steps: ApprovalPreviewStep[];
}

export interface CreateOnBehalfPayload {
  employeeId: string;
  requestTypeCode: string;
  startAt: string;
  endAt: string;
  isHalfDay?: boolean;
  reason: string;
  onBehalfReason: string;
  expectedReturnAt?: string;
  /** Chỉ đổi AI đứng ở mỗi bước, không đổi có những bước nào. */
  approvers?: { order: number; approverId: string }[];
}

/**
 * Xem trước luồng duyệt trước khi tạo đơn hộ.
 *
 * Hỏi lại mỗi khi đổi nhân viên, loại đơn hoặc khoảng ngày: số bước duyệt phụ
 * thuộc ĐỘ DÀI đơn (nghỉ 1 ngày chỉ cần trưởng phòng, từ 3 ngày mới thêm bước
 * HR), nên không cache được theo loại đơn.
 */
export function useApprovalPreview(params: {
  employeeId?: string;
  requestTypeCode?: string;
  startAt?: string;
  endAt?: string;
  isHalfDay?: boolean;
}) {
  const ready = Boolean(
    params.employeeId && params.requestTypeCode && params.startAt && params.endAt,
  );

  return useQuery({
    queryKey: qk.approvalPreview(params),
    queryFn: () => api.get<ApprovalPreview>('/admin/requests/approval-preview', { ...params }),
    enabled: ready,
    // Luồng duyệt là cấu hình, đổi rất ít. Giữ 5 phút để gõ lại ngày không bắn
    // thêm request cho cùng một tổ hợp.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface RequestQuery extends PageQuery {
  status?: string;
  requestTypeCode?: string;
  departmentId?: string;
  employeeId?: string;
  from?: string;
  to?: string;
}

export interface BulkApproveResult {
  approved: string[];
  failed: { requestId: string; code: string; message: string }[];
  approvedCount: number;
  failedCount: number;
}

export function useRequestTypes() {
  return useQuery({
    queryKey: qk.requestTypes(),
    queryFn: () => api.get<RequestType[]>('/request-types'),
    staleTime: 10 * 60_000,
  });
}

export function useRequestList(query: RequestQuery) {
  return useQuery({
    queryKey: qk.requestList(query),
    queryFn: () => api.getPaginated<LeaveRequest>('/requests', { ...query }),
    placeholderData: (previous) => previous,
  });
}

/**
 * Đơn đang chờ CHÍNH TÔI duyệt.
 *
 * Khác `/requests?status=PENDING` ở một điểm quyết định: endpoint này đã lọc
 * theo bước duyệt mà người đang đăng nhập phụ trách. Danh sách chung sẽ hiện cả
 * đơn đang nằm ở cấp duyệt khác — người dùng bấm vào rồi mới biết chưa tới lượt
 * mình, và đó là cách nhanh nhất để họ mất niềm tin vào màn hình này.
 */
export function usePendingApprovals(query: PageQuery) {
  return useQuery({
    queryKey: qk.requestPending(query),
    queryFn: () => api.getPaginated<LeaveRequest>('/requests/pending-approval', { ...query }),
    placeholderData: (previous) => previous,
  });
}

export function useRequestDetail(id: string | null) {
  return useQuery({
    queryKey: qk.requestDetail(id ?? ''),
    queryFn: () => api.get<LeaveRequest>(`/requests/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Sau mọi thao tác duyệt phải xoá cache rộng hơn danh sách đơn.
 *
 * `BR-APV-06`: duyệt xong hệ thống tự tính lại công cho khoảng thời gian của
 * đơn. Duyệt một đơn nghỉ ngày 01 vào ngày 20 làm bảng công ngày 01 đổi — không
 * xoá cache chấm công thì kế toán vẫn nhìn thấy số cũ và tưởng hệ thống không
 * chạy.
 */
function useInvalidateAfterDecision() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.requests });
    void queryClient.invalidateQueries({ queryKey: qk.attendance });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
  };
}

/**
 * Tạo đơn thay mặt nhân viên — `FR-WEB-REQ-09`.
 *
 * Đơn vào trạng thái CHỜ DUYỆT và đi qua đúng luồng duyệt của loại đơn đó, nên
 * phải xoá cache y như một quyết định duyệt: đơn mới xuất hiện ở hàng chờ của
 * người duyệt, và số phép khả dụng của nhân viên bị giữ chỗ ngay khi gửi.
 */
export function useCreateRequestOnBehalf() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: (payload: CreateOnBehalfPayload) =>
      api.post<LeaveRequest>('/admin/requests', payload),
    onSuccess: invalidate,
  });
}

export function useApproveRequest() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      api.post<LeaveRequest>(`/requests/${id}/approve`, { comment }),
    onSuccess: invalidate,
  });
}

export function useRejectRequest() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<LeaveRequest>(`/requests/${id}/reject`, { reason }),
    onSuccess: invalidate,
  });
}

/**
 * Duyệt hàng loạt.
 *
 * `BR-APV-05`: mỗi đơn vẫn được kiểm tra riêng về ràng buộc nghiệp vụ (số phép
 * còn lại, trùng lịch). Đơn nào hỏng thì báo riêng đơn đó, KHÔNG fail cả lô —
 * vì vậy phản hồi có cả `approved` lẫn `failed`, và giao diện phải hiển thị đủ
 * hai phần.
 */
export function useBulkApprove() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: ({ requestIds, comment }: { requestIds: string[]; comment?: string }) =>
      api.post<BulkApproveResult>('/requests/bulk-approve', { requestIds, comment }),
    onSuccess: invalidate,
  });
}
