import { EXECUTIVE_NAV, OPERATIONS_NAV, PLATFORM_NAV } from './nav-items';

/**
 * Tên trang đang xem, suy ra từ đường dẫn.
 *
 * Nguồn chính là ba bộ sidenav — đã có sẵn nhãn tiếng Việt cho
 * mọi lối vào (sidenav và popover bánh răng), nên khai lại một bảng thứ hai là
 * mời gọi hai chỗ lệch nhau khi đổi tên một mục.
 *
 * Chỉ những route KHÔNG có lối vào nào mới cần khai riêng ở đây.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/employees/': 'Hồ sơ nhân viên',
  /*
   * Bốn route dưới đây KHÔNG còn lối vào trên sidenav.
   *
   * Ba cái đầu đã thành tab của trang Thiết lập và giờ chỉ là chuyển hướng —
   * người dùng vẫn tới được bằng link cũ, và trong khoảnh khắc trước khi
   * chuyển hướng chạy thì tiêu đề tab phải nói đúng nơi họ đang tới.
   * `/exec/approvals` thì vẫn là một màn hình thật, chỉ là vào từ mục "Yêu cầu"
   * chứ không có mục riêng nữa.
   */
  '/access': 'Phân quyền',
  '/audit-logs': 'Nhật ký hoạt động',
  '/requests/settings': 'Loại đơn và luồng duyệt',
  '/exec/approvals': 'Cần duyệt',
  '/doi-mat-khau': 'Đổi mật khẩu',
  '/design-system': 'Thư viện giao diện',
  '/thiet-lap': 'Thiết lập ban đầu',
  '/thiet-lap/companyInfo': 'Thiết lập thông tin công ty',
  '/thiet-lap/departments': 'Danh mục phòng ban',
  '/thiet-lap/shifts': 'Thiết lập ca làm việc',
  '/thiet-lap/accountantAccount': 'Tạo tài khoản Kế toán/HR',
  '/thiet-lap/handover': 'Bàn giao vận hành',
  '/requests/': 'Chi tiết đơn',
  '/khoi-tao-nen-tang': 'Khởi tạo nền tảng',
  '/system/tenants/new': 'Tạo công ty',
  '/system': 'Tổng quan hệ thống',
};

/*
 * Gộp CẢ BA bộ nav, không chỉ bộ đang hiện.
 *
 * Tiêu đề trang là thuộc tính của URL, không phải của người đang xem. Chỉ lấy
 * bộ vận hành thì Giám đốc mở `/exec/approvals` sẽ thấy tab tên "SmartFace" —
 * đúng cái vấn đề mà hàm này sinh ra để giải.
 */
const NAV_ITEMS = [
  ...[...OPERATIONS_NAV, ...EXECUTIVE_NAV, ...PLATFORM_NAV].flatMap((group) => group.items),
];

/**
 * Khớp theo TIỀN TỐ DÀI NHẤT, không phải khớp tuyệt đối.
 *
 * `/employees/abc123` phải ra "Hồ sơ nhân viên" chứ không phải rỗng, và
 * `/requests/settings` phải ra "Loại đơn và luồng duyệt" chứ không phải "Đơn từ"
 * — dù `/requests` cũng là một tiền tố khớp.
 */
export function resolvePageTitle(pathname: string): string {
  const candidates: { path: string; label: string }[] = [
    ...NAV_ITEMS.map((item) => ({ path: item.to, label: item.label })),
    ...Object.entries(EXTRA_TITLES).map(([path, label]) => ({ path, label })),
  ];

  const matched = candidates
    .filter(({ path }) => pathname === path || pathname.startsWith(path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  return matched?.label ?? 'SmartFace';
}

/** Tiêu đề tab trình duyệt — người dùng mở nhiều tab cần phân biệt được chúng. */
export function documentTitleFor(pathname: string, companyName?: string): string {
  const page = resolvePageTitle(pathname);
  return companyName ? `${page} · ${companyName}` : `${page} · SmartFace`;
}
