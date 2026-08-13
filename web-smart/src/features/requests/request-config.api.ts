import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';

/**
 * Vai trò duyệt — phải khớp danh sách Backend chấp nhận (`APPROVER_ROLES`).
 *
 * Cấu hình một vai trò ngoài danh sách này sẽ tạo bước duyệt mà không ai xử lý
 * được và đơn treo vĩnh viễn, nên đây là `<Select>` cố định chứ không phải ô
 * nhập tự do.
 */
export const APPROVER_ROLE_LABEL: Record<string, string> = {
  DIRECT_MANAGER: 'Quản lý trực tiếp',
  DEPARTMENT_HEAD: 'Trưởng phòng ban',
  HR_PAYROLL: 'Kế toán / HR',
  COMPANY_ADMIN: 'Admin công ty',
};

export const DEDUCT_FROM_LABEL: Record<string, string> = {
  NONE: 'Không trừ quỹ nào',
  ANNUAL_LEAVE: 'Trừ phép năm',
  UNPAID: 'Nghỉ không lương',
  OT_CREDIT: 'Trừ quỹ OT',
  MAKEUP_CREDIT: 'Trừ quỹ giờ làm bù',
};

export const REQUEST_UNIT_LABEL: Record<string, string> = {
  DAY: 'Theo ngày',
  HALF_DAY: 'Theo buổi',
  HOUR: 'Theo giờ',
};

export interface ApprovalFlowStep {
  order: number;
  approverRole: string;
  isRequired: boolean;
  /** Ngưỡng kích hoạt bước. `null` cả hai = luôn áp dụng. */
  minDays: number | null;
  maxDays: number | null;
}

export interface RequestTypeConfig {
  id: string;
  code: string;
  name: string;
  deductFrom: string;
  unit: string;
  requiresAttachment: boolean;
  requiresPreApproval: boolean;
  maxDaysPerRequest: number | null;
  isActive: boolean;
  /** Số đơn đã phát sinh — quyết định có khoá ô sửa mã hay không. */
  requestCount: number;
  steps: ApprovalFlowStep[];
}

export interface UpsertRequestTypePayload {
  code: string;
  name: string;
  deductFrom?: string;
  unit?: string;
  requiresAttachment?: boolean;
  requiresPreApproval?: boolean;
  maxDaysPerRequest?: number;
  isActive?: boolean;
}

export function useRequestTypeConfigs() {
  return useQuery({
    queryKey: qk.requestConfigList(),
    queryFn: () => api.get<RequestTypeConfig[]>('/admin/request-types'),
    staleTime: 5 * 60_000,
  });
}

function useInvalidateConfig() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.requestConfig });
    // Danh mục dùng khi tạo đơn cũng đổi theo — bật/tắt một loại đơn ở đây phải
    // phản ánh ngay ở bộ lọc của màn hình đơn từ.
    void queryClient.invalidateQueries({ queryKey: qk.requests });
  };
}

export function useCreateRequestType() {
  const invalidate = useInvalidateConfig();
  return useMutation({
    mutationFn: (payload: UpsertRequestTypePayload) =>
      api.post<RequestTypeConfig>('/admin/request-types', payload),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateRequestType() {
  const invalidate = useInvalidateConfig();
  return useMutation({
    mutationFn: ({ id, ...payload }: UpsertRequestTypePayload & { id: string }) =>
      api.patch<RequestTypeConfig>(`/admin/request-types/${id}`, payload),
    onSuccess: () => invalidate(),
  });
}

/**
 * Thay TOÀN BỘ luồng duyệt của một loại đơn.
 *
 * Đơn đang chờ duyệt không bị ảnh hưởng — chúng đã có bước duyệt riêng sinh lúc
 * gửi. Giao diện phải nói điều này ra, vì kỳ vọng tự nhiên của người dùng là
 * "đổi luồng thì mọi đơn đi theo luồng mới".
 */
export function useReplaceApprovalFlow() {
  const invalidate = useInvalidateConfig();
  return useMutation({
    mutationFn: ({ id, steps }: { id: string; steps: ApprovalFlowStep[] }) =>
      api.put<RequestTypeConfig>(`/admin/request-types/${id}/approval-flow`, {
        steps: steps.map((step) => ({
          order: step.order,
          approverRole: step.approverRole,
          isRequired: step.isRequired,
          // Backend nhận `minDays`/`maxDays` rời chứ không nhận JSON `condition`:
          // khoá viết sai chính tả trong JSON bị bỏ qua im lặng và bước duyệt áp
          // dụng cho MỌI đơn — sai theo hướng khó phát hiện nhất.
          ...(step.minDays != null ? { minDays: step.minDays } : {}),
          ...(step.maxDays != null ? { maxDays: step.maxDays } : {}),
        })),
      }),
    onSuccess: () => invalidate(),
  });
}
