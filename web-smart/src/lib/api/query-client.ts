import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/errors/api-error';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dữ liệu chấm công/đơn từ thay đổi liên tục nhưng không theo giây. 30s là
      // điểm cân bằng: chuyển tab quay lại không nháy loading, mà cũng không
      // hiện số liệu của mười phút trước.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        // Lỗi nghiệp vụ (403, 404, 409, 422) thử lại bao nhiêu lần cũng vẫn hỏng
        // — chỉ tạo tải và làm người dùng chờ lâu hơn. Backend đã nói rõ qua cờ
        // `retryable`, dùng luôn thay vì tự đoán theo mã HTTP.
        if (error instanceof ApiError && !error.retryable) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // Mutation KHÔNG tự thử lại: "duyệt đơn" hay "chốt kỳ lương" chạy hai lần
      // là hai lần ghi thật vào sổ.
      retry: false,
    },
  },
});

/**
 * Khoá cache tập trung.
 *
 * Gom về một chỗ để lệnh `invalidateQueries` sau khi ghi dữ liệu không bao giờ
 * trượt vì gõ sai chuỗi. Quy ước: mảng đi từ chung tới riêng, nhờ vậy
 * `invalidate(['attendance'])` quét sạch mọi biến thể bộ lọc bên dưới.
 */
export const qk = {
  session: ['session'] as const,
  company: ['company'] as const,

  dashboard: () => ['dashboard'] as const,
  dashboardAlerts: () => ['dashboard', 'alerts'] as const,

  attendance: ['attendance'] as const,
  attendanceList: (params: unknown) => ['attendance', 'list', params] as const,
  attendanceLogs: (employeeId: string, workDate: string) =>
    ['attendance', 'logs', employeeId, workDate] as const,
  attendanceDetail: (id: string) => ['attendance', 'detail', id] as const,
  attendanceAdjustments: (employeeId: string) => ['attendance', 'adjustments', employeeId] as const,

  requests: ['requests'] as const,
  requestList: (params: unknown) => ['requests', 'list', params] as const,
  requestPending: (params: unknown) => ['requests', 'pending', params] as const,
  requestDetail: (id: string) => ['requests', 'detail', id] as const,
  requestTypes: () => ['requests', 'types'] as const,

  employees: ['employees'] as const,
  employeeList: (params: unknown) => ['employees', 'list', params] as const,
  employeeDetail: (id: string) => ['employees', 'detail', id] as const,
  employeeHistory: (id: string) => ['employees', 'history', id] as const,
  employeeDevices: (id: string) => ['employees', 'devices', id] as const,

  policy: ['policy'] as const,
  policies: () => ['policy', 'values'] as const,
  shifts: () => ['policy', 'shifts'] as const,
  holidays: (year: number) => ['policy', 'holidays', year] as const,
  branches: () => ['policy', 'branches'] as const,
  departments: () => ['policy', 'departments'] as const,
  leavePolicies: () => ['policy', 'leave-policies'] as const,

  // Bảng phân ca nằm dưới `policy` để lưu ca hoặc phân ca hàng loạt xong là cả
  // hai cùng được làm mới bằng một lệnh `invalidate(['policy'])`.
  shiftBoard: (params: unknown) => ['policy', 'shift-board', params] as const,

  makeup: ['makeup'] as const,
  makeupList: (params: unknown) => ['makeup', 'list', params] as const,
  makeupSummary: (params: unknown) => ['makeup', 'summary', params] as const,

  // Khác `requestTypes()` ở nhóm đơn từ: khoá đó là danh mục cho người TẠO đơn
  // (chỉ loại đang bật), còn khoá này là màn hình CẤU HÌNH (gồm cả loại đã tắt).
  requestConfig: ['request-config'] as const,
  requestConfigList: () => ['request-config', 'list'] as const,

  payroll: ['payroll'] as const,
  payrollPeriods: () => ['payroll', 'periods'] as const,
  payrollSummary: (id: string) => ['payroll', 'summary', id] as const,
  payrollPreClose: (id: string) => ['payroll', 'pre-close', id] as const,

  reports: ['reports'] as const,
  reportTrend: (params: unknown) => ['reports', 'trend', params] as const,
  reportViolations: (params: unknown) => ['reports', 'violations', params] as const,
  reportLeaveUsage: (year: number) => ['reports', 'leave-usage', year] as const,
  reportOvertime: (params: unknown) => ['reports', 'overtime', params] as const,

  fraud: ['fraud'] as const,
  fraudFlags: (params: unknown) => ['fraud', 'flags', params] as const,
  fraudStats: (params: unknown) => ['fraud', 'stats', params] as const,
  fraudDetail: (id: string) => ['fraud', 'detail', id] as const,

  notifications: ['notifications'] as const,
  auditLogs: (params: unknown) => ['audit-logs', params] as const,

  job: (id: string) => ['job', id] as const,
};
