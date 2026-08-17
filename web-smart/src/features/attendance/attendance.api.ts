import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';
import type { PageQuery } from '@/lib/api/types';

// ---------------------------------------------------------------------------
//  Kiểu dữ liệu — khớp `AttendanceDaily` / `AttendanceLog` trong schema.prisma
// ---------------------------------------------------------------------------

export interface AttendanceDaily {
  id: string;
  employeeId: string;
  workDate: string;
  shiftId: string | null;
  firstCheckInAt: string | null;
  lastCheckOutAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otMinutes: number;
  /** Hệ số OT áp cho ngày — `Decimal(4,2)`, tới tay client là chuỗi hoặc số. */
  otMultiplier?: string | number | null;
  makeupMinutes: number;
  standardDays: string | number;
  status: string;
  hasFraudFlag: boolean;
  appliedRequestIds: string[];
  calculatedAt: string;
  breakdown?: Record<string, unknown> | null;
  /** Lưới bảng chấm công trả về dòng công KHÔNG kèm nhân viên — dòng đã mang tên rồi. */
  employee?: EmployeeRef | null;
}

export interface FraudFlagRef {
  id: string;
  code: string;
  severity: string;
  score: number;
  details?: Record<string, unknown> | null;
  reviewedAt?: string | null;
  reviewDecision?: string | null;
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  branchId: string | null;
  type: 'CHECK_IN' | 'CHECK_OUT' | string;
  authMethod: 'FACE' | 'FINGERPRINT' | 'MANUAL' | string;
  recordedAt: string;
  clientReportedAt: string | null;
  clockSkewSeconds: number | null;
  workDate: string;

  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  locationProvider: string | null;
  isMockLocation: boolean;
  distanceToBranchM: number | null;
  insideGeofence: boolean | null;
  wifiBssid: string | null;

  deviceId: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  isRootedDevice: boolean;
  attestationPassed: boolean | null;
  ipAddress: string | null;

  matchScore: number | null;
  livenessScore: number | null;
  livenessChallenge: string | null;
  aiModelVersion: string | null;
  aiProcessingMs: number | null;

  /** Presigned URL, hết hạn sau 5 phút (docs/04 mục 3.4). */
  photoUrl: string | null;
  photoHash: string | null;

  fraudScore: number;
  decision: string;
  isOffline: boolean;
  createdByUserId: string | null;

  fraudFlags?: FraudFlagRef[];
  employee?: EmployeeRef | null;
  branch?: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number;
  } | null;
}

export interface AttendanceAdjustment {
  id: string;
  attendanceLogId: string | null;
  adjustType: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  reason: string;
  createdByUserId: string;
  createdAt: string;
}

export interface AttendanceQuery extends PageQuery {
  from?: string;
  to?: string;
  departmentId?: string;
  branchId?: string;
  employeeId?: string;
  status?: string;
  hasFraudFlag?: boolean;
}

export interface AdjustPayload {
  employeeId: string;
  workDate: string;
  adjustType: 'ADD' | 'MODIFY_TIME' | 'VOID';
  attendanceLogId?: string;
  afterValue?: Record<string, unknown>;
  reason: string;
  requestId?: string;
}

export interface ExportJob {
  jobId: string;
  statusUrl: string;
}

/**
 * Trạng thái một job chạy nền — dùng chung cho xuất bảng công, xuất lương và
 * tính lại kỳ (docs/15, `GET /v1/jobs/:id`).
 *
 * `COMPLETED` là trạng thái cuối của hợp đồng API. Trong database cột `status`
 * ghi `DONE`; backend quy đổi tại biên nên phía này chỉ cần biết một từ vựng.
 */
export interface JobStatus {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;
  progress?: number;
  downloadUrl?: string | null;
  error?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
//  Hook
// ---------------------------------------------------------------------------

/** Bảng công theo ngày — đọc từ `AttendanceDaily` đã tính sẵn (NFR-PERF-06). */
export function useAttendanceList(query: AttendanceQuery) {
  return useQuery({
    queryKey: qk.attendanceList(query),
    queryFn: () => api.getPaginated<AttendanceDaily>('/admin/attendance', { ...query }),
    placeholderData: (previous) => previous,
  });
}

/** Các lượt chấm công thô của một nhân viên trong một ngày. */
export function useAttendanceLogs(employeeId: string | null, workDate: string | null) {
  return useQuery({
    queryKey: qk.attendanceLogs(employeeId ?? '', workDate ?? ''),
    queryFn: () => api.get<AttendanceLog[]>('/admin/attendance/logs', { employeeId, workDate }),
    enabled: Boolean(employeeId && workDate),
    // Ảnh trong phản hồi là presigned URL hết hạn sau 5 phút. Cache lâu hơn thế
    // là hiện ảnh hỏng: người dùng mở lại drawer sau 10 phút sẽ thấy ô trắng.
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  });
}

export function useAttendanceLogDetail(logId: string | null) {
  return useQuery({
    queryKey: qk.attendanceDetail(logId ?? ''),
    queryFn: () => api.get<AttendanceLog>(`/admin/attendance/${logId}`),
    enabled: Boolean(logId),
    staleTime: 4 * 60_000,
  });
}

export function useAttendanceAdjustments(employeeId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: [...qk.attendanceAdjustments(employeeId ?? ''), from, to],
    queryFn: () =>
      api.get<AttendanceAdjustment[]>('/attendance/adjustments', { employeeId, from, to }),
    enabled: Boolean(employeeId),
  });
}

/**
 * Hiệu chỉnh công thủ công.
 *
 * BR-ADJ-01: KHÔNG sửa đè bản ghi thô. Backend tạo `AttendanceAdjustment` riêng
 * rồi tự kích hoạt tính lại `AttendanceDaily` của ngày đó (BR-ADJ-04) — vì vậy
 * ở đây phải xoá cache cả danh sách lẫn chi tiết, không chỉ dòng vừa sửa.
 */
export function useAdjustAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AdjustPayload) =>
      api.post<{ adjustmentId: string }>('/admin/attendance/adjust', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendance });
      // Bảng công đổi thì dashboard và báo cáo cũng lệch theo.
      void queryClient.invalidateQueries({ queryKey: qk.dashboard() });
      void queryClient.invalidateQueries({ queryKey: qk.reports });
    },
  });
}

/**
 * Xuất bảng công.
 *
 * Trả 202 + `jobId` chứ không trả file: docs/04 mục 7.4 chốt xử lý ở Backend, và
 * tiêu chí chấp nhận ở mục 3.4 nói rõ "xuất Excel 5000 dòng không làm treo
 * trình duyệt".
 */
export function useExportAttendance() {
  return useMutation({
    mutationFn: (payload: {
      from?: string;
      to?: string;
      departmentIds?: string[];
      format?: 'XLSX' | 'CSV';
    }) => api.post<ExportJob>('/admin/attendance/export', payload),
  });
}

/** Theo dõi job export cho tới khi xong. */
export function useExportJob(jobId: string | null) {
  return useQuery({
    queryKey: qk.job(jobId ?? ''),
    queryFn: () => api.get<JobStatus>(`/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Dừng hỏi khi job đã kết thúc — nếu không sẽ gọi API mỗi 2 giây vô hạn
      // suốt thời gian tab còn mở.
      return status === 'COMPLETED' || status === 'FAILED' ? false : 2000;
    },
  });
}
