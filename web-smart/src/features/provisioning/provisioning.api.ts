import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

// ===========================================================================
//  Khởi tạo nền tảng
// ===========================================================================

export interface BootstrapPayload {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export interface BootstrapResult {
  userId: string;
  email: string;
  fullName: string;
  /** `docs/07` §5 — tài khoản nền tảng bắt buộc bật MFA ngay sau bước này. */
  mfaRequired: boolean;
  loginDomain: string;
}

/**
 * Tạo tài khoản Quản trị nền tảng ĐẦU TIÊN.
 *
 * Chỉ chạy được đúng một lần trong đời hệ thống; sau đó Backend trả
 * `PLATFORM_ALREADY_BOOTSTRAPPED`. Không có `useQuery` đi kèm để hỏi "đã khởi
 * tạo chưa" — một endpoint công khai trả lời câu đó là một endpoint cho biết hệ
 * thống có đang ở trạng thái chưa ai làm chủ hay không.
 */
export function useBootstrapPlatform() {
  return useMutation({
    mutationFn: (payload: BootstrapPayload) =>
      api.post<BootstrapResult>('/platform/bootstrap', payload),
  });
}

// ===========================================================================
//  Khởi tạo tenant
// ===========================================================================

export interface ProvisionTenantPayload {
  company: {
    name: string;
    code: string;
    domain: string;
    taxCode?: string;
    timezone?: string;
    planCode?: string;
  };
  director: {
    fullName: string;
    email: string;
    phone: string;
  };
}

export interface ProvisionTenantResult {
  company: { id: string; code: string; domain: string; name: string; planCode: string | null };
  director: {
    userId: string;
    employeeId: string;
    employeeCode: string;
    email: string;
    fullName: string;
  };
  /** Hiện ĐÚNG MỘT LẦN. Không đọc lại được — mất thì phải dùng luồng đặt lại mật khẩu. */
  temporaryPassword: string;
  loginUrl: string;
}

export function useProvisionTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProvisionTenantPayload) =>
      api.post<ProvisionTenantResult>('/system/tenants/provision', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system', 'tenants'] });
    },
  });
}

// ===========================================================================
//  Gói dịch vụ
// ===========================================================================

export interface ServicePackage {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number | string | null;
  maxEmployees: number | null;
  maxDepartments: number | null;
  maxShifts: number | null;
  maxAdminAccounts: number | null;
  dataRetentionDays: number | null;
  features: Record<string, unknown> | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export function usePackages() {
  return useQuery({
    queryKey: ['system', 'packages'],
    queryFn: () => api.get<ServicePackage[]>('/system/packages'),
    staleTime: 10 * 60 * 1000,
  });
}

export interface TenantFeatures {
  planCode: string | null;
  planName: string | null;
  limits: Record<string, number | null>;
  features: Record<string, unknown>;
  overrides: Array<{
    key: string;
    value: unknown;
    reason: string | null;
    expiresAt: string | null;
    setBy: string;
  }>;
}

export function useTenantFeatures(tenantId: string | null) {
  return useQuery({
    queryKey: ['system', 'tenants', tenantId, 'features'],
    queryFn: () => api.get<TenantFeatures>(`/system/tenants/${tenantId}/features`),
    enabled: Boolean(tenantId),
  });
}

export function useSetTenantFeature(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      key: string;
      /** `null` = gỡ ghi đè và trả về giá trị của gói. KHÁC `0` — `0` là chặn hẳn. */
      value: unknown;
      reason: string;
      expiresAt?: string;
    }) => api.put<TenantFeatures>(`/system/tenants/${tenantId}/features`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system', 'tenants', tenantId, 'features'] });
    },
  });
}

// ===========================================================================
//  Phiên hỗ trợ tenant
// ===========================================================================

export interface SupportSession {
  id: string;
  adminUserId: string;
  companyId: string;
  ticketRef: string;
  purpose: string;
  readOnly: boolean;
  expiresAt: string;
  endedAt: string | null;
  createdAt: string;
  active: boolean;
  company?: { id: string; code: string; name: string };
}

export function useSupportSessions(filter: { companyId?: string; activeOnly?: boolean } = {}) {
  return useQuery({
    queryKey: ['system', 'support-sessions', filter],
    queryFn: () =>
      api.get<SupportSession[]>('/system/support-sessions', {
        companyId: filter.companyId,
        activeOnly: filter.activeOnly ? 'true' : undefined,
      }),
    // Phiên hết hạn theo đồng hồ, nên danh sách "đang mở" cũ đi mà không có sự
    // kiện nào báo. Làm mới định kỳ để cột trạng thái không nói sai.
    refetchInterval: 60_000,
  });
}

export function useOpenSupportSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      companyId: string;
      ticketRef: string;
      purpose: string;
      durationMinutes?: number;
      readOnly?: boolean;
    }) => api.post<SupportSession & { reused: boolean }>('/system/support-sessions', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system', 'support-sessions'] });
    },
  });
}

export function useCloseSupportSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete<{ closed: boolean; alreadyClosed: boolean }>(
        `/system/support-sessions/${sessionId}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system', 'support-sessions'] });
    },
  });
}

// ===========================================================================
//  Wizard thiết lập ban đầu của tenant
// ===========================================================================

export const SETUP_STEP_KEYS = [
  'companyInfo',
  'departments',
  'shifts',
  'accountantAccount',
  'handover',
] as const;

export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export interface SetupStep {
  key: SetupStepKey;
  order: number;
  label: string;
  done: boolean;
  at: string | null;
  by: string | null;
}

export interface SetupState {
  companyId: string;
  steps: SetupStep[];
  doneCount: number;
  totalSteps: number;
  currentStep: number;
  completedAt: string | null;
  /** Bước tiếp theo chưa xong — màn hình tô sáng đúng thẻ này. */
  nextStep: SetupStepKey | null;
}

/**
 * Tiến độ wizard thiết lập ban đầu.
 *
 * `enabled` để gọi có điều kiện: chỉ người có `setup.run` mới đọc được, và gọi
 * cho người khác chỉ tạo ra một loạt 403 trong nhật ký mà không ai đọc.
 */
export function useSetupState(enabled = true) {
  return useQuery({
    queryKey: ['company', 'setup'],
    queryFn: () => api.get<SetupState>('/company/setup'),
    enabled,
  });
}

export function useCompleteSetupStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (step: SetupStepKey) => api.post<SetupState>('/company/setup/complete', { step }),
    onSuccess: (data) => {
      queryClient.setQueryData(['company', 'setup'], data);
    },
  });
}

export function useReopenSetupStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (step: SetupStepKey) => api.post<SetupState>(`/company/setup/reopen/${step}`),
    onSuccess: (data) => {
      queryClient.setQueryData(['company', 'setup'], data);
    },
  });
}

// ===========================================================================
//  Ho so cong ty — buoc 1 cua wizard
// ===========================================================================

export interface CompanyProfile {
  id: string;
  /** BAT BIEN — nam trong moi ma nhan vien da sinh (BR-04). Hien o dang chi doc. */
  code: string;
  name: string;
  domain: string;
  taxCode: string | null;
  timezone: string;
  status: string;
}

/**
 * Ho so cong ty o dang SUA DUOC.
 *
 * Khac `useAuth().company` (lay tu `/company/me`): endpoint do moi nhan vien
 * goi duoc va co tinh khong tra ma so thue lan ten mien. Endpoint nay yeu cau
 * `org.update`.
 */
export function useCompanyProfile(enabled = true) {
  return useQuery({
    queryKey: ['company', 'profile'],
    queryFn: () => api.get<CompanyProfile>('/company/profile'),
    enabled,
  });
}

export function useUpdateCompanyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name?: string;
      domain?: string;
      taxCode?: string;
      timezone?: string;
    }) => api.put<CompanyProfile>('/company/profile', payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['company', 'profile'], data);
    },
  });
}

/*
 * ⚠ Ten cong ty tren thanh tieu de KHONG tu doi theo mutation tren.
 *
 * `AuthProvider` giu no trong `useState` va nap bang mot loi goi truc tiep toi
 * `/company/me`, khong qua react-query — nen khong co cache nao de xoa. Noi goi
 * phai tu goi `refreshSession()` sau khi luu; `SetupCompanyStep` lam dung viec
 * do. Ghi ro o day de lan sau khong ai them mot dong `invalidateQueries` vo tac
 * dung roi tuong da xong.
 */
