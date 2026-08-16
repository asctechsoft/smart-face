import { NAV_GROUPS, SETTINGS_ITEMS } from './nav-items';

/**
 * Tên trang đang xem, suy ra từ đường dẫn.
 *
 * Nguồn chính là `NAV_GROUPS` + `SETTINGS_ITEMS` — đã có sẵn nhãn tiếng Việt cho
 * mọi lối vào (sidenav và popover bánh răng), nên khai lại một bảng thứ hai là
 * mời gọi hai chỗ lệch nhau khi đổi tên một mục.
 *
 * Chỉ những route KHÔNG có lối vào nào mới cần khai riêng ở đây.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/employees/': 'Hồ sơ nhân viên',
  '/doi-mat-khau': 'Đổi mật khẩu',
  '/design-system': 'Thư viện giao diện',
};

const NAV_ITEMS = [...NAV_GROUPS.flatMap((group) => group.items), ...SETTINGS_ITEMS];

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
