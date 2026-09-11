import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';

export interface DashboardSummary {
  workDate: string;
  totalEmployees: number;
  checkedInToday: number;
  currentlyWorking: number;
  lateToday: number;
  pendingRequests: number;
  otMinutesThisMonth: number;
  unreviewedFraudFlags: number;
}

export interface DashboardAlert {
  id: string;
  code: string;
  severity: string;
  score: number;
  createdAt: string;
  employee: EmployeeRef | null;
}

export interface DashboardAlerts {
  total: number;
  items: DashboardAlert[];
}

export interface TrendPoint {
  workDate: string;
  onTime: number;
  late: number;
  absent: number;
  onLeave: number;
  [key: string]: string | number;
}

/**
 * Dashboard — docs/04 mục 2.
 *
 * Backend cache kết quả trong Redis (TTL 2 phút) vì đây là màn hình mở nhiều
 * nhất. Ở client `refetchInterval` 2 phút khớp với TTL đó: gọi dày hơn chỉ nhận
 * lại đúng bản cache cũ, gọi thưa hơn thì số liệu trên màn hình già hơn số liệu
 * server đang có.
 */
export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard(),
    queryFn: () => api.get<DashboardSummary>('/admin/dashboard'),
    refetchInterval: 120_000,
  });
}

export function useDashboardAlerts() {
  return useQuery({
    queryKey: qk.dashboardAlerts(),
    queryFn: () => api.get<DashboardAlerts>('/admin/dashboard/alerts'),
    refetchInterval: 120_000,
  });
}

export function useAttendanceTrend(from: string, to: string) {
  return useQuery({
    queryKey: qk.reportTrend({ from, to }),
    queryFn: () => api.get<TrendPoint[]>('/admin/reports/attendance-trend', { from, to }),
    enabled: Boolean(from && to),
  });
}

// ===========================================================================
//  Doi soat ky cong (FR-WEB-DASH-07)
// ===========================================================================

export type ReconcileIssue =
  | 'MISSING_CHECK_IN'
  | 'MISSING_CHECK_OUT'
  | 'FRAUD_FLAG'
  | 'INSUFFICIENT'
  | 'NO_RECORD';

export interface ReconciliationRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  workDate: string;
  shiftId: string | null;
  /** Ma ca — "HCVP". Null khi ngay do khong gan duoc ca nao. */
  shiftCode: string | null;
  shiftName: string | null;
  /** Gio ca dang "HH:mm", theo timezone cong ty. */
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  issue: ReconcileIssue;
}

/**
 * Mot moc tren "Lich trinh chot luong sap toi".
 *
 * Ngay do Backend suy ra tu ngay cuoi ky va ba khoa chinh sach
 * `payroll.schedule.*` (Cai dat → Chinh sach → Lich chot luong). Day la lich DU
 * KIEN de len ke hoach, khong phai moc da xay ra: khong co job nao tu dong
 * chuyen trang thai ky theo nhung ngay nay.
 */
export interface PayrollMilestone {
  key: 'CLOSE' | 'REVIEW' | 'CALCULATE' | 'PAYOUT';
  fromDate: string;
  toDate: string;
  state: 'DONE' | 'CURRENT' | 'UPCOMING';
}

export interface Reconciliation {
  period: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: 'OPEN' | 'CALCULATING' | 'PENDING_APPROVAL' | 'LOCKED' | 'REOPENED';
    currentVersion: number;
  } | null;
  /** Ngay du lieu tinh den — luon <= hom nay, khong bao gio la cuoi ky. */
  asOf: string;
  totals: {
    totalEmployees: number;
    settled: number;
    needsReview: number;
    missingPunch: number;
  };
  progress: Array<{ workDate: string; settled: number; expected: number }>;
  queue: {
    missingCheckOut: number;
    makeupPending: number;
    otPending: number;
    leaveApproved: number;
  };
  needsReviewList: ReconciliationRow[];
  otLeave: {
    otMinutes: number;
    workedMinutes: number;
    standardDays: number;
    leaveDays: number;
  };
  payrollSchedule: PayrollMilestone[];
}

/** Ba dropdown tren dau man hinh Tong quan. Chuoi rong = khong loc. */
export interface ReconciliationFilters {
  periodId?: string;
  branchId?: string;
  departmentId?: string;
}

/**
 * Tien do doi soat cua ky cong dang mo.
 *
 * Cung nhip 2 phut voi `useDashboard()` — hai khoi so lieu nam canh nhau tren
 * cung mot man hinh, lech nhip thi chung cap nhat so le nhau va nguoi dung thay
 * hai con so mau thuan trong vai giay.
 */
export function useReconciliation(filters: ReconciliationFilters = {}) {
  const params = {
    periodId: filters.periodId || undefined,
    branchId: filters.branchId || undefined,
    departmentId: filters.departmentId || undefined,
  };

  return useQuery({
    // Bo loc nam trong queryKey, khong chi trong queryFn: thieu no thi doi
    // dropdown se hien lai dung ket qua da cache cua lua chon truoc.
    queryKey: [...qk.dashboard(), 'reconciliation', params] as const,
    queryFn: () => api.get<Reconciliation>('/admin/dashboard/reconciliation', params),
    refetchInterval: 120_000,
    // Giu so lieu cu tren man hinh trong luc nap bo loc moi. Khong co no thi
    // moi lan doi dropdown ca trang nhay ve khung xuong roi ve lai.
    placeholderData: (previous) => previous,
  });
}

export interface ActivityEntry {
  id: string;
  action: string;
  targetType: string | null;
  actorName?: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * Hoat dong gan day — doc tu nhat ky kiem toan.
 *
 * `enabled` do noi goi quyet dinh: Quan ly khong co `audit.view`, va goi cho ho
 * chi tao mot chuoi 403 trong nhat ky ma khong ai doc.
 */
export function useRecentActivity(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.dashboard(), 'activity'] as const,
    queryFn: () => api.getPaginated<ActivityEntry>('/admin/audit-logs', { pageSize: 6 }),
    enabled,
  });
}
