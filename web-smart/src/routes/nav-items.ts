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
 * Chỉ còn NĂM mục: đây là những việc người dùng làm lặp lại trong ngày và trong
 * tuần. Mọi thứ chỉ đụng tới khi cấu hình một lần đã chuyển sang popover bánh
 * răng trên thanh header (`SETTINGS_ITEMS`) — menu dọc dài 13 mục làm việc hằng
 * ngày phải cuộn qua những mục cả tháng không ai bấm.
 *
 * Vì chỉ còn một nhóm nên nhóm này KHÔNG có nhãn: một tiêu đề nhóm đứng trên
 * toàn bộ danh sách không phân biệt được gì với chính danh sách đó.
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
        key: 'shifts',
        label: 'Phân ca',
        icon: 'event_repeat',
        to: '/shifts',
        permission: 'shift.assign',
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
];

/**
 * Nội dung popover bánh răng trên header.
 *
 * Vẫn là NavItem và vẫn trỏ tới đúng những route cũ — popover chỉ đổi chỗ đứng
 * của lối vào, không đổi màn hình phía sau. Nhờ vậy `page-title.ts` lấy được
 * nhãn tiêu đề trang từ đây y như lấy từ sidenav.
 */
export const SETTINGS_ITEMS: NavItem[] = [
  {
    key: 'employees',
    label: 'Nhân viên',
    icon: 'group',
    to: '/employees',
    permission: 'employee.view',
  },
  {
    key: 'policy',
    label: 'Chính sách công ty',
    icon: 'tune',
    to: '/policy',
    permission: 'policy.view',
  },
  {
    key: 'request-types',
    label: 'Loại đơn và luồng duyệt',
    icon: 'account_tree',
    to: '/requests/settings',
    permission: 'request.configure',
  },
  {
    key: 'access',
    label: 'Phân quyền',
    icon: 'admin_panel_settings',
    to: '/access',
    permission: 'role.manage',
  },
  {
    key: 'audit',
    label: 'Nhật ký hoạt động',
    icon: 'history',
    to: '/audit-logs',
    permission: 'audit.view',
  },
];

/** Mọi đích điều hướng CÓ LỐI VÀO — sidenav cộng popover bánh răng. */
const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((group) => group.items), ...SETTINGS_ITEMS];

/**
 * Mục này có đích điều hướng nào khác nằm BÊN TRONG nó không.
 *
 * Dùng để quyết định `end` của `NavLink`. Mặc định `NavLink` khớp theo TIỀN TỐ,
 * nên `/requests` sáng lên cả khi đang ở `/requests/settings` — và người dùng
 * thấy "Đơn từ" trên sidenav được tô trong lúc màn hình hiện ra là "Loại đơn và
 * luồng duyệt". Hai chỗ nói hai điều khác nhau về cùng một trang.
 *
 * Không chuyển hết sang khớp TUYỆT ĐỐI: `/attendance/:id` và `/shifts/:id` là
 * trang chi tiết NẰM TRONG chính mục đó, và ở đó việc tô sáng mục cha là đúng.
 * Ranh giới thật sự là "bên dưới đây có một lối vào khác không" — có thì mục này
 * dừng khớp tiền tố, nhường cho mục cụ thể hơn.
 *
 * So sánh kèm dấu `/` chứ không `startsWith(to)` trần: nếu không thì một đường
 * dẫn tương lai kiểu `/requests-archive` cũng bị tính là nằm trong `/requests`.
 */
export function hasNestedNavDestination(to: string): boolean {
  return ALL_NAV_ITEMS.some((item) => item.to !== to && item.to.startsWith(`${to}/`));
}
