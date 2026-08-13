import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { EmployeeRef } from '@/components/EmployeeCell';

export interface ViolationRow {
  employee: EmployeeRef | null;
  violationCount: number;
  lateMinutesTotal: number;
  earlyLeaveMinutesTotal: number;
}

export interface LeaveUsageRow {
  employee: EmployeeRef | null;
  entitledDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  usageRate: number;
}

export interface OvertimeReport {
  byEmployee: { employee: EmployeeRef | null; otMinutes: number }[];
  byDepartment: { departmentId: string; name: string; otMinutes: number; employeeCount: number }[];
  totalOtMinutes: number;
}

export function useViolations(from: string, to: string, minOccurrences = 3) {
  return useQuery({
    queryKey: qk.reportViolations({ from, to, minOccurrences }),
    queryFn: () =>
      api.get<ViolationRow[]>('/admin/reports/violations', { from, to, minOccurrences }),
    enabled: Boolean(from && to),
  });
}

export function useLeaveUsage(year: number) {
  return useQuery({
    queryKey: qk.reportLeaveUsage(year),
    queryFn: () => api.get<LeaveUsageRow[]>('/admin/reports/leave-usage', { year }),
  });
}

export function useOvertimeReport(from: string, to: string) {
  return useQuery({
    queryKey: qk.reportOvertime({ from, to }),
    queryFn: () => api.get<OvertimeReport>('/admin/reports/overtime', { from, to }),
    enabled: Boolean(from && to),
  });
}
