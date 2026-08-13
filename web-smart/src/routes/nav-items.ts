import type { Permission } from '@/lib/rbac/permissions';

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  to: string;
  permission: Permission;
}

export interface NavGroup {
  key: string;
  label?: string;
  items: NavItem[];
}

/**
 * Cấu trúc sidenav — icon lấy từ bảng ánh xạ ở docs/16 mục 9.
 *
 * Nhóm theo nhịp công việc thật của người dùng, không theo module kỹ thuật:
 * việc hằng ngày (chấm công, đơn từ) nằm trên; việc hằng tháng (tính công) và
 * việc cấu hình một lần (chính sách) nằm dưới.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'main',
    items: [
      {
        key: 'dashboard',
        label: 'Tổng quan',
        icon: 'home',
        to: '/dashboard',
        permission: 'dashboard.view',
      },
    ],
  },
  {
    key: 'daily',
    label: 'Hằng ngày',
    items: [
      {
        key: 'attendance',
        label: 'Chấm công',
        icon: 'event_available',
        to: '/attendance',
        permission: 'attendance.view',
      },
      {
        key: 'requests',
        label: 'Đơn từ',
        icon: 'assignment',
        to: '/requests',
        permission: 'request.view',
      },
      {
        key: 'fraud',
        label: 'Cảnh báo gian lận',
        icon: 'gpp_maybe',
        to: '/fraud',
        permission: 'fraud.view',
      },
    ],
  },
  {
    key: 'people',
    label: 'Nhân sự',
    items: [
      {
        key: 'employees',
        label: 'Nhân viên',
        icon: 'group',
        to: '/employees',
        permission: 'employee.view',
      },
      {
        key: 'shifts',
        label: 'Phân ca',
        icon: 'event_repeat',
        to: '/shifts',
        permission: 'shift.assign',
      },
      {
        key: 'makeup',
        label: 'Công làm bù',
        icon: 'more_time',
        to: '/makeup',
        permission: 'makeup.view',
      },
      {
        key: 'notifications',
        label: 'Thông báo',
        icon: 'campaign',
        to: '/notifications',
        permission: 'notification.send',
      },
    ],
  },
  {
    key: 'payroll',
    label: 'Tính công & Báo cáo',
    items: [
      {
        key: 'payroll',
        label: 'Kỳ lương',
        icon: 'receipt_long',
        to: '/payroll',
        permission: 'payroll.view',
      },
      {
        key: 'reports',
        label: 'Báo cáo',
        icon: 'monitoring',
        to: '/reports',
        permission: 'report.view',
      },
    ],
  },
  {
    key: 'settings',
    label: 'Thiết lập',
    items: [
      {
        key: 'policy',
        label: 'Chính sách công ty',
        icon: 'tune',
        to: '/policy',
        permission: 'policy.view',
      },
      {
        key: 'request-types',
        label: 'Loại đơn & duyệt',
        icon: 'account_tree',
        to: '/requests/settings',
        permission: 'request.configure',
      },
      {
        key: 'access',
        label: 'Phân quyền nội bộ',
        icon: 'admin_panel_settings',
        to: '/access',
        permission: 'role.manage',
      },
      {
        key: 'audit',
        label: 'Nhật ký kiểm toán',
        icon: 'history',
        to: '/audit-logs',
        permission: 'audit.view',
      },
    ],
  },
];
