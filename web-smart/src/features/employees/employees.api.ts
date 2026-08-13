import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { PageQuery } from '@/lib/api/types';
import type { SystemRole } from '@/config/constants';

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  branchId: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  branch?: { id: string; name: string } | null;
  position: string | null;
  contractType: string | null;
  joinedAt: string | null;
  terminatedAt: string | null;
  status: string;
  roles: SystemRole[];
  managedDepartmentIds: string[];
  codeLocked: boolean;
  createdAt: string;
}

export interface EmployeeQuery extends PageQuery {
  status?: string;
  departmentId?: string;
  branchId?: string;
}

export interface CreateEmployeePayload {
  fullName: string;
  phone: string;
  employeeCode?: string;
  email?: string;
  departmentId?: string;
  branchId?: string;
  position?: string;
  contractType?: string;
  joinedAt?: string;
  roles?: SystemRole[];
  managedDepartmentIds?: string[];
  sendInvite?: boolean;
}

export interface ImportRow {
  rowNumber: number;
  fullName: string;
  phone: string;
  departmentName?: string;
  position?: string;
  joinedAt?: string;
  contractType?: string;
}

export interface ImportValidationRow extends ImportRow {
  valid: boolean;
  generatedCode?: string | null;
  errors: string[];
}

export interface ImportValidationResult {
  rows: ImportValidationRow[];
  validCount: number;
  invalidCount: number;
}

export interface ImportExecuteResult {
  created: { rowNumber: number; employeeId: string; employeeCode: string }[];
  failed: { rowNumber: number; message: string }[];
  createdCount: number;
  failedCount: number;
}

export function useEmployeeList(query: EmployeeQuery) {
  return useQuery({
    queryKey: qk.employeeList(query),
    queryFn: () => api.getPaginated<Employee>('/admin/employees', { ...query }),
    placeholderData: (previous) => previous,
  });
}

/**
 * Hồ sơ chi tiết — nhiều hơn dòng trong danh sách.
 *
 * Kèm trạng thái đăng nhập và sinh trắc học vì màn hình hồ sơ trả lời đúng câu
 * hỏi "vì sao người này không chấm công được": chưa đăng ký khuôn mặt, tài khoản
 * bị khoá, hay chưa từng đăng nhập lần nào.
 */
export interface EmployeeDetail extends Employee {
  user?: { id: string; phone: string; lastLoginAt: string | null; isBlocked: boolean } | null;
  faceProfiles?: {
    id: string;
    angle: string;
    modelVersion: string | null;
    enrolledAt: string | null;
    qualityScore: number | null;
  }[];
  biometricKeys?: { id: string; deviceId: string; algorithm: string; createdAt: string }[];
}

export function useEmployee(id: string | null) {
  return useQuery({
    queryKey: qk.employeeDetail(id ?? ''),
    queryFn: () => api.get<EmployeeDetail>(`/admin/employees/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Xem trước mã nhân viên trước khi lưu — `FR-WEB-HR-06`.
 *
 * Backend sinh mã theo quy tắc công ty (`ducnv.amobi`) và HR được sửa TRƯỚC khi
 * nhân viên kích hoạt. Sau lần chấm công đầu tiên mã bị khoá vĩnh viễn (BR-04),
 * vì mã đó đã nằm trong các bản ghi chấm công đã ghi.
 */
export function usePreviewCode() {
  return useMutation({
    mutationFn: (fullName: string) =>
      api.post<{ employeeCode: string; suggestions?: string[] }>('/admin/employees/preview-code', {
        fullName,
      }),
  });
}

function useInvalidateEmployees() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.employees });
}

export function useCreateEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (payload: CreateEmployeePayload) => api.post<Employee>('/admin/employees', payload),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<CreateEmployeePayload> & { id: string }) =>
      api.patch<Employee>(`/admin/employees/${id}`, payload),
    onSuccess: () => void invalidate(),
  });
}

/** Chỉ xoá được hồ sơ `PENDING_ACTIVATION` — hồ sơ `ACTIVE` phải tạm ngưng hoặc chấm dứt. */
export function useDeleteEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/admin/employees/${id}`),
    onSuccess: () => void invalidate(),
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) => api.post<{ sent: true }>(`/admin/employees/${id}/resend-invite`),
  });
}

export function useSuspendEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ status: string }>(`/admin/employees/${id}/suspend`, { reason }),
    onSuccess: () => void invalidate(),
  });
}

export function useReactivateEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ status: string }>(`/admin/employees/${id}/reactivate`, { reason }),
    onSuccess: () => void invalidate(),
  });
}

/**
 * Chấm dứt hợp đồng — `FR-WEB-HR-12`.
 *
 * Backend thu hồi token, vô hiệu device binding, và xử lý dữ liệu sinh trắc học
 * theo chính sách công ty (xoá ngay hoặc khoá rồi xoá sau N ngày). Bản ghi chấm
 * công và bảng công đã chốt được GIỮ LẠI — nghĩa vụ lưu trữ chứng từ.
 */
export function useTerminateEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ id, reason, effectiveDate }: { id: string; reason: string; effectiveDate?: string }) =>
      api.post<{ status: string; biometricDeleted: boolean }>(`/admin/employees/${id}/terminate`, {
        reason,
        effectiveDate,
      }),
    onSuccess: () => void invalidate(),
  });
}

/**
 * Lịch sử thay đổi hồ sơ — `FR-WEB-HR-02`.
 *
 * Backend dựng từ audit log của chính nhân viên này, nên mỗi dòng có sẵn cặp
 * giá trị trước/sau và lý do. Không có bảng lịch sử riêng — hai nguồn chép lại
 * cùng một thông tin thì sớm muộn sẽ lệch nhau.
 */
export function useEmployeeHistory(id: string | null) {
  return useQuery({
    queryKey: qk.employeeHistory(id ?? ''),
    queryFn: () => api.get<EmployeeHistoryEntry[]>(`/admin/employees/${id}/history`),
    enabled: Boolean(id),
  });
}

export interface EmployeeHistoryEntry {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeviceBinding {
  id: string;
  deviceId: string;
  deviceModel: string | null;
  osName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  isRooted: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
}

/**
 * Thiết bị đã liên kết — `FR-WEB-INV-06`, docs/04 mục 11.2.
 *
 * `activeCount` lớn hơn 1 là trạng thái KHÔNG được phép tồn tại (BR-11: mỗi tài
 * khoản một thiết bị). Gặp thì đó là dấu hiệu chốt thiết bị đang bị vô hiệu, và
 * màn hình phải cảnh báo chứ không lặng lẽ hiển thị hai dòng.
 */
export function useEmployeeDevices(id: string | null) {
  return useQuery({
    queryKey: qk.employeeDevices(id ?? ''),
    queryFn: () =>
      api.get<{ devices: DeviceBinding[]; activeCount: number }>(
        `/admin/employees/${id}/devices`,
      ),
    enabled: Boolean(id),
  });
}

export function useRevokeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      employeeId,
      bindingId,
      reason,
    }: {
      employeeId: string;
      bindingId: string;
      reason: string;
    }) =>
      api.post<{ revoked: true }>(`/admin/employees/${employeeId}/devices/${bindingId}/revoke`, {
        reason,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.employees }),
  });
}

/**
 * Đặt lại sinh trắc học để nhân viên đăng ký lại khuôn mặt.
 *
 * Dữ liệu cũ bị VÔ HIỆU HOÁ chứ không xoá — embedding cũ là bằng chứng đối chiếu
 * cho các lượt chấm công đã ghi trước đó.
 */
export function useResetBiometric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ faceProfilesRevoked: number; biometricKeysRevoked: number }>(
        `/admin/employees/${id}/reset-biometric`,
        { reason },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.employees }),
  });
}

export function useValidateImport() {
  return useMutation({
    mutationFn: (rows: ImportRow[]) =>
      api.post<ImportValidationResult>('/admin/employees/import/validate', { rows }),
  });
}

export function useExecuteImport() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ rows, sendInvite }: { rows: ImportRow[]; sendInvite: boolean }) =>
      api.post<ImportExecuteResult>('/admin/employees/import/execute', { rows, sendInvite }),
    onSuccess: () => void invalidate(),
  });
}
