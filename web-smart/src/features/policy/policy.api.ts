import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import type { Branch, Department } from '@/features/shared/org.api';

/** Hệ số ngày công đặt riêng cho một ngày lễ — chỉ liệt kê ngoại lệ. */
export interface ShiftHolidayFactor {
  holidayId: string;
  factor: number;
}

export interface Shift {
  id: string;
  name: string;
  /** Mã ca, duy nhất trong công ty. */
  code: string;
  /** Ký hiệu in trên bảng chấm công. */
  symbol: string | null;
  /** Phòng ban áp dụng. Rỗng = mọi phòng ban. */
  departmentIds: string[];
  type: 'FIXED' | 'ROTATING' | 'FLEXIBLE' | string;
  startTime: string | null;
  endTime: string | null;
  crossesMidnight: boolean;
  breakMinutes: number;
  breakStart: string | null;
  breakEnd: string | null;
  requireCheckIn: boolean;
  checkInFrom: string | null;
  checkInTo: string | null;
  requireCheckOut: boolean;
  checkOutFrom: string | null;
  checkOutTo: string | null;
  /**
   * Số phút công — Backend TÍNH RA từ giờ ca, không lưu và không nhận từ client.
   * Gửi trường này lên cũng bị bỏ qua.
   */
  workMinutes: number;
  workDayCredit: number;
  normalDayFactor: number;
  weeklyRestFactor: number;
  holidayFactor: number;
  holidayFactors: ShiftHolidayFactor[];
  requiredMinutes: number | null;
  lateToleranceMinutes: number;
  earlyLeaveToleranceMinutes: number;
  isDefault: boolean;
  weekdayMask: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  segments?: { order: number; startTime: string; endTime: string }[];
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  substituteDate: string | null;
  otMultiplier: string | number;
  branchIds: string[];
}

/** Giá trị chính sách, khoá theo danh mục `PolicyKeys` của Backend. */
export type PolicyValues = Record<string, unknown>;

export function usePolicies() {
  return useQuery({
    queryKey: qk.policies(),
    queryFn: () => api.get<PolicyValues>('/admin/policies'),
    staleTime: 5 * 60_000,
  });
}

export function useUpdatePolicies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { policies: PolicyValues; reason?: string; effectiveFrom?: string }) =>
      api.put<PolicyValues>('/admin/policies', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

export function useShifts() {
  return useQuery({
    queryKey: qk.shifts(),
    queryFn: () => api.get<Shift[]>('/admin/shifts'),
  });
}

/**
 * Tạo / sửa ca làm việc.
 *
 * `effectiveFrom` là trường quan trọng nhất và dễ bị bỏ qua nhất. docs/04 mục
 * 6.4, bẫy "Đổi cấu hình ca giữa tháng": đổi giờ vào từ 08:00 sang 08:15 vào
 * ngày 15 mà GHI ĐÈ sẽ khiến bảng công của 14 ngày đầu tháng được tính lại theo
 * giờ mới. Backend giữ hiệu lực theo thời gian, nhưng chỉ khi client gửi đúng
 * `effectiveFrom` thay vì để trống.
 */
export function useUpsertShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Shift> & { id?: string }) =>
      id
        ? api.put<Shift>(`/admin/shifts/${id}`, payload)
        : api.post<Shift>('/admin/shifts', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/admin/shifts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

export function useHolidays(year: number) {
  return useQuery({
    queryKey: qk.holidays(year),
    queryFn: () => api.get<Holiday[]>('/admin/holidays', { year }),
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      date: string;
      substituteDate?: string;
      otMultiplier?: number;
      branchIds?: string[];
    }) => api.post<Holiday>('/admin/holidays', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: true }>(`/admin/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

/**
 * Chính sách phép năm — `FR-WEB-POL-07`, `FR-WEB-POL-08`.
 *
 * Mỗi loại hợp đồng một bản, cộng một bản `contractType = null` làm mặc định.
 * Danh sách gồm cả bản đã bị đóng (`effectiveTo` khác null): khi nhân viên thắc
 * mắc "sao năm ngoái tôi được 12 ngày mà năm nay 14", câu trả lời nằm ở đúng
 * những bản cũ đó.
 */
export interface LeavePolicy {
  id: string;
  contractType: string | null;
  baseDaysPerYear: number;
  seniorityBonusDays: number;
  seniorityEveryYears: number;
  allowCarryOver: boolean;
  maxCarryOverDays: number | null;
  carryOverExpireMonth: number | null;
  accrualMode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
}

export function useLeavePolicies() {
  return useQuery({
    queryKey: qk.leavePolicies(),
    queryFn: () => api.get<LeavePolicy[]>('/admin/leave-policies'),
    staleTime: 5 * 60_000,
  });
}

/**
 * Lưu chính sách phép.
 *
 * D6 — mỗi lần lưu là một PHIÊN BẢN MỚI, không sửa đè: số phép đã cấp cho nhân
 * viên hồi đầu năm phải giải thích được bằng chính sách lúc đó.
 */
export function useUpsertLeavePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      contractType?: string;
      baseDaysPerYear: number;
      seniorityBonusDays?: number;
      seniorityEveryYears?: number;
      allowCarryOver?: boolean;
      maxCarryOverDays?: number;
      carryOverExpireMonth?: number;
      accrualMode?: string;
      effectiveFrom?: string;
    }) => api.put<LeavePolicy>('/admin/leave-policies', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

export function useUpsertBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Branch> & { id?: string }) =>
      id
        ? api.patch<Branch>(`/admin/branches/${id}`, payload)
        : api.post<Branch>('/admin/branches', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

export function useUpsertDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Department> & { id?: string }) =>
      id
        ? api.patch<Department>(`/admin/departments/${id}`, payload)
        : api.post<Department>('/admin/departments', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.policy }),
  });
}

/**
 * Danh mục khoá chính sách hiển thị trên giao diện.
 *
 * Chỉ liệt kê những khoá HR/Admin thực sự chỉnh — Backend còn nhiều khoá kỹ
 * thuật (ngưỡng AI, tham số chống gian lận) mà đặt lên màn hình này sẽ mời gọi
 * người không đủ ngữ cảnh đi chỉnh ngưỡng nhận diện khuôn mặt.
 */
export const POLICY_FIELDS = [
  {
    group: 'Tính công',
    items: [
      {
        key: 'payroll.minutesPerStandardDay',
        label: 'Số phút bằng một công chuẩn',
        type: 'number' as const,
        suffix: 'phút',
        hint: 'Mặc định 480 phút (8 giờ). Đây là mẫu số của mọi phép quy đổi công.',
      },
      {
        key: 'payroll.roundingMinutes',
        label: 'Bước làm tròn',
        type: 'number' as const,
        suffix: 'phút',
        hint: 'VD 15 = làm tròn theo bội số 15 phút. Đặt 0 để không làm tròn.',
      },
      {
        key: 'payroll.roundingMode',
        label: 'Kiểu làm tròn',
        type: 'select' as const,
        options: [
          { value: 'NEAREST', label: 'Về giá trị gần nhất' },
          { value: 'DOWN', label: 'Làm tròn xuống (có lợi cho công ty)' },
          { value: 'UP', label: 'Làm tròn lên (có lợi cho nhân viên)' },
        ],
      },
      {
        key: 'payroll.countWeekendAsWorkday',
        label: 'Tính cuối tuần là ngày làm việc',
        type: 'boolean' as const,
      },
    ],
  },
  {
    group: 'Tăng ca (OT)',
    items: [
      {
        key: 'payroll.ot.requiresPreApproval',
        label: 'OT phải có đơn duyệt trước',
        type: 'boolean' as const,
        hint: 'Tắt thì mọi giờ làm ngoài ca đều tính OT — dễ phát sinh chi phí ngoài dự toán.',
      },
      {
        key: 'payroll.ot.multiplierNormal',
        label: 'Hệ số OT ngày thường',
        type: 'number' as const,
        step: 0.1,
        hint: 'Bộ luật Lao động Việt Nam: tối thiểu 150%.',
      },
      {
        key: 'payroll.ot.multiplierWeekend',
        label: 'Hệ số OT cuối tuần',
        type: 'number' as const,
        step: 0.1,
        hint: 'Tối thiểu 200%.',
      },
      {
        key: 'payroll.ot.multiplierHoliday',
        label: 'Hệ số OT ngày lễ',
        type: 'number' as const,
        step: 0.1,
        hint: 'Tối thiểu 300%.',
      },
      {
        key: 'payroll.ot.maxMinutesPerMonth',
        label: 'Trần OT mỗi tháng',
        type: 'number' as const,
        suffix: 'phút',
        hint: 'Luật giới hạn 40 giờ/tháng (2400 phút) trong điều kiện bình thường.',
      },
    ],
  },
  {
    group: 'Vị trí & chấm công',
    items: [
      {
        key: 'attendance.geofence.defaultRadiusMeters',
        label: 'Bán kính geofence mặc định',
        type: 'number' as const,
        suffix: 'mét',
        hint: 'GPS trong nhà sai số 20–50m. Dưới 50m gây rất nhiều báo động giả.',
      },
      {
        key: 'attendance.geofence.outOfRangeAction',
        label: 'Chấm công ngoài vùng thì làm gì',
        type: 'select' as const,
        options: [
          { value: 'BLOCK', label: 'Chặn — không cho chấm công' },
          { value: 'WARN', label: 'Cảnh báo — vẫn ghi nhận, gắn cờ' },
          { value: 'PENDING_REVIEW', label: 'Cho chấm và chờ duyệt' },
        ],
      },
      {
        key: 'attendance.gps.maxAccuracyMeters',
        label: 'Sai số GPS tối đa chấp nhận',
        type: 'number' as const,
        suffix: 'mét',
      },
      {
        key: 'attendance.gps.rejectMockLocation',
        label: 'Từ chối vị trí giả (mock location)',
        type: 'boolean' as const,
      },
      {
        key: 'attendance.device.rejectRooted',
        label: 'Từ chối thiết bị đã root / jailbreak',
        type: 'boolean' as const,
      },
    ],
  },
] as const;
