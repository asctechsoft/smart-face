import type { Permission } from '@/lib/rbac/permissions';

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  to: string;
  /**
   * Quyền tối thiểu để THẤY mục này.
   *
   * Một mảng nghĩa là "bất kỳ quyền nào trong đây", không phải "tất cả": một
   * màn hình gộp nhiều phần (như "Ca làm & Phân ca" gộp danh mục ca với lịch
   * phân ca) phải hiện ra với người chỉ có một trong các phần đó — bên trong nó
   * tự ẩn phần còn lại. Đòi đủ cả danh sách sẽ giấu cả màn hình khỏi người dùng
   * được nửa màn hình.
   */
  permission: Permission | Permission[];
}

/** Mục này có hiện với người đang đăng nhập không — xem `NavItem.permission`. */
export function canSeeNavItem(item: NavItem, has: (permission: Permission) => boolean): boolean {
  return Array.isArray(item.permission)
    ? item.permission.some((permission) => has(permission))
    : has(item.permission);
}

export interface NavGroup {
  key: string;
  label?: string;
  items: NavItem[];
}

/**
 * Ba bộ điều hướng cho ba nhóm công việc, trong CÙNG một ứng dụng.
 *
 * ## Vì sao một app chứ không ba
 *
 * `ADR-03` (`docs/11`) đã chốt đúng điều này: một ứng dụng React duy nhất, phân
 * quyền hiển thị module theo vai trò. Ba bộ nav ở đây là cách thi công quyết
 * định đó.
 *
 * ⚠ Có MỘT điểm không theo ADR-03: nó yêu cầu *"bundle splitting theo role để
 * không tải code Admin vào phiên của nhân viên"*. Ở đây các màn hình vẫn tách
 * chunk theo route (`React.lazy` trong `router.tsx`), nhưng KHÔNG tách theo vai
 * trò — người dùng nào cũng có thể tải chunk của màn Quản trị nền tảng nếu họ
 * cố tình.
 *
 * Hệ quả phải biết: **kiểm quyền ở Backend là tuyến duy nhất**. `docs/06` §13
 * nghiệm thu bằng "gọi thẳng API cũng không vào được", không phải bằng "không
 * thấy nút" — và điều đó vẫn đúng dù chunk có tách hay không. Thứ lọt ra khi
 * không tách bundle là *hình dạng của giao diện quản trị*, không phải dữ liệu.
 *
 * ## Vì sao chọn bộ nav bằng QUYỀN chứ không bằng vai trò
 *
 * Vai trò là thứ đổi được (tenant tự tạo vai trò riêng — `FR-GDW-ROLE-01`), còn
 * quyền thì gắn với việc làm được. Chọn theo vai trò thì một vai trò tuỳ biến
 * tên "Trưởng phòng Nhân sự" sẽ rơi vào nhánh mặc định và mất hết mục.
 *
 * ## Mục trong bộ vẫn được lọc tiếp
 *
 * Chọn bộ chỉ quyết định DANH SÁCH ỨNG VIÊN. Từng mục vẫn bị lọc theo
 * `item.permission`, nên một Trưởng phòng và một Kế toán cùng dùng bộ vận hành
 * nhưng thấy số mục khác nhau.
 */
export const OPERATIONS_NAV: NavGroup[] = [
  {
    key: 'main',
    items: [
      {
        key: 'dashboard',
        label: 'Tổng quan',
        icon: 'home',
        to: '/dashboard',
        permission: 'report.view',
      },
      {
        key: 'employees',
        label: 'Nhân sự',
        icon: 'group',
        to: '/employees',
        permission: 'employee.view',
      },
      /*
       * "Chấm công" là màn theo dõi TRONG NGÀY — "giờ này ai chưa đến", mở
       * nhiều lần mỗi ngày. Khác hẳn "Bảng công" ở dưới: bảng công là sổ của
       * cả kỳ, việc của cuối tháng.
       *
       * Dùng chung quyền `attendance.view` với Bảng công: đây là một CÁCH ĐỌC
       * dữ liệu chấm công, không mở thêm dữ liệu nào. Đặt một quyền riêng có
       * cùng danh sách vai trò chỉ thêm một thứ phải nhớ đồng bộ ở hai chỗ.
       */
      {
        key: 'work-status',
        label: 'Chấm công',
        icon: 'how_to_reg',
        to: '/work-status',
        permission: 'attendance.view',
      },
      /*
       * Màn này gộp DANH MỤC ca (khai ca của công ty) với LỊCH phân ca (xếp ai
       * làm ca nào). Danh mục ca trước đây là một tab của trang Thiết lập, nên
       * mục ở đây phải mở cho cả người chỉ đọc danh mục — Kế toán có
       * `shift_template.view` mà không có `shift.assign`, và họ vẫn cần tra giờ
       * ca khi đối chiếu bảng công. Tab lịch phân ca tự ẩn với họ.
       */
      {
        key: 'shifts',
        label: 'Ca làm & Phân ca',
        icon: 'event_repeat',
        to: '/shifts',
        permission: ['shift.assign', 'shift_template.view'],
      },
      {
        key: 'attendance',
        label: 'Bảng công',
        icon: 'table_chart',
        to: '/attendance',
        permission: 'attendance.view',
      },
      {
        key: 'requests',
        label: 'Yêu cầu',
        icon: 'assignment',
        to: '/requests',
        permission: 'request.view',
      },
      /*
       * Cùng màn hình với mục "Tiền lương" của Giám đốc, khác bộ nút.
       *
       * Quyền ở đây là `timesheet.view` chứ không phải `period.submit_lock`:
       * Quản lý xem được kỳ đang ở trạng thái nào (để biết còn kịp sửa gì
       * không) mà không gửi duyệt được. Gác bằng `period.submit_lock` sẽ giấu
       * cả thông tin trạng thái khỏi người chỉ cần đọc.
       */
      {
        key: 'periods',
        label: 'Tiền lương',
        icon: 'payments',
        to: '/exec/periods',
        permission: 'timesheet.view',
      },
      {
        key: 'reports',
        label: 'Báo cáo',
        icon: 'monitoring',
        to: '/reports',
        permission: 'report.view',
      },
      /*
       * "Thiết lập" trỏ thẳng vào Chính sách công ty — màn hình cấu hình được
       * mở nhiều nhất, và bản thân nó đã là một trang nhiều tab (ca, ngày lễ,
       * phép năm, chi nhánh, phòng ban).
       *
       * Ba màn cấu hình còn lại (Loại đơn, Phân quyền, Nhật ký) vẫn nằm trong
       * popover bánh răng ở thanh trên. Nhồi cả sáu vào sidenav sẽ đẩy danh
       * sách lên gấp rưỡi để phục vụ những việc làm vài lần một năm.
       */
      {
        key: 'policy',
        label: 'Thiết lập',
        icon: 'settings',
        to: '/policy',
        permission: 'policy.view',
      },
    ],
  },
];

/**
 * Bộ điều hướng của Tổng giám đốc (mockup Figma `67:75`, `69:254`).
 *
 * Cùng danh sách và cùng thứ tự với bộ vận hành — khác nhau ở QUYỀN của từng
 * mục, không ở tập mục. Giám đốc mở web để duyệt và xem, nên "Tiền lương" của
 * họ gác bằng `period.approve_lock` (duyệt chốt kỳ) thay vì `timesheet.view`
 * (chỉ đọc) như bên vận hành: cùng một màn hình, khác bộ nút.
 *
 * "Thiết lập ban đầu" chỉ hiện khi wizard chưa xong — xem `useSetupState()`;
 * để nó nằm mãi trên sidenav sau khi đã hoàn tất là một mục chết chiếm chỗ.
 */
export const EXECUTIVE_NAV: NavGroup[] = [
  {
    key: 'exec',
    items: [
      {
        key: 'exec-dashboard',
        label: 'Tổng quan',
        icon: 'home',
        to: '/dashboard',
        permission: 'report.view',
      },
      {
        key: 'exec-employees',
        label: 'Nhân sự',
        icon: 'group',
        to: '/employees',
        permission: 'employee.view',
      },
      {
        key: 'exec-work-status',
        label: 'Chấm công',
        icon: 'how_to_reg',
        to: '/work-status',
        permission: 'attendance.view',
      },
      {
        key: 'exec-shifts',
        label: 'Ca làm & Phân ca',
        icon: 'event_repeat',
        to: '/shifts',
        permission: ['shift.assign', 'shift_template.view'],
      },
      {
        key: 'exec-attendance',
        label: 'Bảng công',
        icon: 'table_chart',
        to: '/attendance',
        permission: 'attendance.view',
      },
      {
        key: 'exec-requests',
        label: 'Yêu cầu',
        icon: 'assignment',
        to: '/requests',
        permission: 'request.view',
      },
      {
        key: 'exec-periods',
        label: 'Tiền lương',
        icon: 'payments',
        to: '/exec/periods',
        permission: 'period.approve_lock',
      },
      {
        key: 'exec-reports',
        label: 'Báo cáo',
        icon: 'monitoring',
        to: '/reports',
        permission: 'report.view',
      },
      {
        key: 'exec-policy',
        label: 'Thiết lập',
        icon: 'settings',
        to: '/policy',
        permission: 'policy.view',
      },
    ],
  },
];

/**
 * Bộ điều hướng của Quản trị nền tảng (mockup Figma `96:4`, `81:2`).
 *
 * Không có mục nghiệp vụ nào của tenant. Đó là ranh giới của `docs/06` §13:
 * quản trị viên nền tảng vận hành hệ thống, và muốn xem dữ liệu của một công ty
 * thì phải mở **phiên hỗ trợ** có mã phiếu và lý do — không có đường tắt nào từ
 * sidenav vào thẳng bảng công của khách hàng.
 *
 * CHƯA CÓ ở đây: màn hình AI Server (`platform.ai`) và Sự cố
 * (`platform.incident`). Backend đã có endpoint (`/v1/system/ai/*`,
 * `/v1/system/queues`) nhưng chưa có màn hình, và một mục điều hướng dẫn tới
 * trang 404 còn tệ hơn không có mục.
 */
export const PLATFORM_NAV: NavGroup[] = [
  {
    key: 'platform',
    items: [
      {
        // Mục đầu tiên vì nó là màn hình duy nhất trả lời "nền tảng đang thế
        // nào" — bốn mục còn lại đều là danh sách để đi làm một việc cụ thể.
        key: 'platform-overview',
        label: 'Tổng quan',
        icon: 'home',
        to: '/system',
        permission: 'tenant.view',
      },
      {
        key: 'platform-tenants',
        label: 'Công ty',
        icon: 'apartment',
        to: '/system/tenants',
        permission: 'tenant.view',
      },
      {
        key: 'platform-packages',
        label: 'Gói dịch vụ',
        icon: 'sell',
        to: '/system/packages',
        permission: 'tenant.billing',
      },
      {
        key: 'platform-support',
        label: 'Phiên hỗ trợ',
        icon: 'support_agent',
        to: '/system/support',
        permission: 'platform.support_access',
      },
      {
        // Dat TRUOC nhat ky: khi co su co, cau hoi dau tien la "thanh phan nao
        // dang loi", con nhat ky la thu doc sau de biet ai da lam gi.
        key: 'platform-health',
        label: 'Giám sát hệ thống',
        icon: 'monitor_heart',
        to: '/system/health',
        permission: 'platform.config',
      },
      {
        key: 'platform-logs',
        label: 'Nhật ký hệ thống',
        icon: 'history',
        to: '/system/logs',
        permission: 'audit.view',
      },
    ],
  },
];

/** Giữ tên cũ để `page-title.ts` và các chỗ khác không phải sửa cùng lúc. */
export const NAV_GROUPS = OPERATIONS_NAV;

/**
 * Chọn bộ điều hướng theo quyền của người đang đăng nhập.
 *
 * Thứ tự kiểm là thứ tự ƯU TIÊN, và nó quan trọng: một người vừa là quản trị
 * nền tảng vừa được gán vai trò trong một công ty thì phải thấy bộ nền tảng —
 * đó là vai họ đăng nhập để làm. Ngược lại thì họ vào hệ thống và thấy giao diện
 * của một công ty cụ thể, không hiểu vì sao.
 *
 * Mặc định là bộ vận hành: người không có quyền đặc biệt nào vẫn phải có một
 * sidenav dùng được, kể cả khi rốt cuộc chỉ còn một mục sau khi lọc.
 */
export function selectNavGroups(has: (permission: Permission) => boolean): NavGroup[] {
  if (has('platform.config') || has('tenant.manage') || has('tenant.view')) {
    return PLATFORM_NAV;
  }
  // Duyệt chốt kỳ và chỉ định Owner là hai việc chỉ Giám đốc/Owner làm được —
  // dùng chúng làm dấu hiệu thay vì hỏi tên vai trò.
  if (has('period.approve_lock') || has('owner.assign')) {
    return EXECUTIVE_NAV;
  }
  return OPERATIONS_NAV;
}

/**
 * Các tab của trang "Thiết lập" (`/policy`).
 *
 * Trước đây ba mục cuối nằm trong popover bánh răng ở thanh trên. Popover đã bị
 * gỡ: nó là một lối vào thứ hai, nằm ở một góc màn hình khác, cho những màn
 * hình cùng loại với "Chính sách" vốn đã có mục riêng trên sidenav. Người dùng
 * phải nhớ chức năng nào ở bánh răng, chức năng nào ở thanh trái — một câu hỏi
 * không ai nên phải trả lời.
 *
 * Vẫn là `NavItem` và vẫn trỏ tới đúng những route cũ, nên `page-title.ts` lấy
 * được nhãn tiêu đề y như trước.
 */
export const SETTINGS_TABS: NavItem[] = [
  {
    key: 'request-types',
    label: 'Loại đơn và luồng duyệt',
    icon: 'account_tree',
    to: '/policy?tab=request-types',
    permission: 'request.configure_flow',
  },
  {
    key: 'access',
    label: 'Phân quyền',
    icon: 'admin_panel_settings',
    to: '/policy?tab=access',
    permission: 'role.assign',
  },
  {
    key: 'audit',
    label: 'Nhật ký hoạt động',
    icon: 'history',
    to: '/policy?tab=audit',
    permission: 'audit.view',
  },
];

/**
 * Mọi đích điều hướng CÓ LỐI VÀO — cả ba bộ sidenav cộng popover bánh răng.
 *
 * Phải gộp cả ba: `hasNestedNavDestination` quyết định một mục có khớp tiền tố
 * hay không, và câu trả lời đó không được đổi theo việc người đang xem là ai.
 * Chỉ tính bộ đang hiện thì `/attendance` sẽ khớp tiền tố với người này và
 * không khớp với người kia, cho cùng một URL.
 */
const ALL_NAV_ITEMS: NavItem[] = [...OPERATIONS_NAV, ...EXECUTIVE_NAV, ...PLATFORM_NAV].flatMap(
  (group) => group.items,
);

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
