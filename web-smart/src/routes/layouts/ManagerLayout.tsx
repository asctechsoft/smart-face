import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Drawer, Dropdown } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { EmployeeQuickSearch } from '@/components/EmployeeQuickSearch';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { SettingsMenu } from './SettingsMenu';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/rbac/permissions';
import { NAV_GROUPS, hasNestedNavDestination } from '@/routes/nav-items';
import { documentTitleFor, resolvePageTitle } from '@/routes/page-title';
import { ROLE_LABEL } from '@/config/constants';
import { initials } from '@/lib/utils/format';
import { formatDayLong } from '@/lib/utils/date';
import { api } from '@/lib/api/client';

/**
 * Bố cục Web Quản lý.
 *
 * Quy tắc chuyển đổi bố cục — docs/16 mục 8:
 *   < md (768px): sidenav ẩn hẳn, mở bằng hamburger dưới dạng drawer trượt
 *   ≥ md:         sidenav cố định 256px
 *   ≥ 2xl:        nội dung giới hạn bề rộng 1440px
 */
export function ManagerLayout() {
  const { company, roles, timezone, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);

  const pageTitle = resolvePageTitle(location.pathname);

  /**
   * Tiêu đề tab trình duyệt.
   *
   * Kế toán thường mở song song vài tab — bảng công, kỳ lương, đơn từ. Trước đây
   * cả ba tab đều tên "SmartFace · Quản lý chấm công" nên phải bấm vào từng cái
   * mới biết cái nào là cái nào.
   */
  useEffect(() => {
    document.title = documentTitleFor(location.pathname, company?.name);
  }, [location.pathname, company?.name]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Điều hướng xong thì đóng drawer — không đóng thì người dùng mobile bấm xong
  // vẫn nhìn thấy menu che kín trang vừa mở.
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  // Hồ sơ nhân viên gắn với tài khoản — `GET /auth/me` chỉ trả id và vai trò,
  // không có tên để hiện ở góc phải.
  const { data: profile } = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => api.get<{ fullName: string; employeeCode: string }>('/me/profile'),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const nav = (
    <nav className="sf-sidenav" aria-label="Điều hướng chính">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px' }}>
        <span className="sf-title-lg" style={{ color: 'var(--sf-teal-700)' }}>
          SmartFace
        </span>
        <span className="sf-label-md">{company?.name ?? 'Quản lý chấm công'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter((item) => hasPermission(roles, item.permission));
          if (visible.length === 0) return null;

          return (
            <div key={group.key}>
              {group.label ? <div className="sf-nav-group-label">{group.label}</div> : null}
              <ul className="sf-nav-list">
                {visible.map((item) => (
                  <li key={item.key}>
                    {/* NavLink tự đặt `aria-current="page"` khi khớp route. CSS ở
                        global.css bám vào chính thuộc tính đó để tô nền amber
                        (docs/16 mục 11.15) — trạng thái hiển thị và trạng thái
                        trình đọc màn hình đọc lên là MỘT, không thể lệch nhau.

                        `end` bật khi có lối vào khác nằm bên dưới mục này: nếu
                        không, `/requests` sáng lên cả lúc đang ở
                        `/requests/settings`, trong khi trang hiện ra lại là mục
                        của popover bánh răng. Trang chi tiết KHÔNG có lối vào
                        riêng (`/attendance/:id`, `/shifts/:id`) vẫn tô sáng mục
                        cha như cũ — xem `hasNestedNavDestination`. */}
                    <NavLink
                      to={item.to}
                      className="sf-nav-item"
                      end={hasNestedNavDestination(item.to)}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon name={item.icon} size={18} fill={isActive} />
                          <span style={{ flex: 1 }}>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--sf-surface-bright)' }}>
      {isDesktop ? (
        <aside
          style={{
            position: 'sticky',
            top: 0,
            height: '100vh',
            flexShrink: 0,
            borderRight: '1px solid var(--sf-outline-variant)',
          }}
        >
          {nav}
        </aside>
      ) : (
        <Drawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          placement="left"
          width={256}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          {nav}
        </Drawer>
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            height: 'var(--sf-topbar-height)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '0 24px',
            background: 'var(--sf-surface)',
            borderBottom: '1px solid var(--sf-outline-variant)',
            boxShadow: 'var(--sf-shadow-xs)',
          }}
        >
          {!isDesktop ? (
            <Button
              type="text"
              aria-label="Mở menu điều hướng"
              icon={<Icon name="menu" size={24} />}
              onClick={() => setMobileNavOpen(true)}
            />
          ) : null}

          {/*
            Tên trang đang xem, không phải chỉ ngày tháng.

            Trên desktop, mục nav đang chọn đã nói người dùng đang ở đâu — nhưng
            trên tablet và mobile thì sidenav ẩn hẳn, và trước đây dải ngang giá
            trị nhất của màn hình chỉ hiện đúng một dòng ngày tháng.
          */}
          <div style={{ minWidth: 0, flexShrink: 0 }}>
            <h2 className="sf-title-sm" style={{ margin: 0, whiteSpace: 'nowrap' }}>
              {pageTitle}
            </h2>
            <div className="sf-caption" style={{ whiteSpace: 'nowrap' }}>
              {formatDayLong(new Date(), timezone)}
            </div>
          </div>

          {/* Tìm nhanh nhân viên — thao tác lặp nhiều nhất của HR trong ngày. */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
            <EmployeeQuickSearch />
          </div>

          {/* Chuông rồi tới bánh răng — hai thứ "mở ra một lớp phủ" đứng cạnh
              nhau, tách khỏi menu tài khoản bên phải. */}
          <NotificationBell />
          <SettingsMenu />

          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'identity',
                  label: (
                    <div style={{ padding: '4px 0' }}>
                      <div className="sf-body-sm" style={{ fontWeight: 600 }}>
                        {profile?.fullName ?? 'Tài khoản của tôi'}
                      </div>
                      <div className="sf-caption">
                        {roles.map((role) => ROLE_LABEL[role]).join(' · ')}
                        {company?.name ? ` · ${company.name}` : ''}
                      </div>
                    </div>
                  ),
                  disabled: true,
                },
                { type: 'divider' },
                {
                  key: 'password',
                  label: 'Đổi mật khẩu',
                  icon: <Icon name="lock_reset" size={18} />,
                },
                {
                  key: 'logout',
                  label: 'Đăng xuất',
                  icon: <Icon name="logout" size={18} />,
                  danger: true,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'logout') void logout();
                if (key === 'password') navigate('/doi-mat-khau');
              },
            }}
          >
            <button
              type="button"
              aria-label="Menu tài khoản"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 9999,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9999,
                  background: 'var(--sf-teal-700)',
                  color: '#FFFFFF',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {initials(profile?.fullName)}
              </span>
              <Icon name="expand_more" size={16} color="var(--sf-on-surface-variant)" />
            </button>
          </Dropdown>
        </header>

        <main
          style={{
            flex: 1,
            padding: 24,
            width: '100%',
            maxWidth: 'var(--sf-content-max-width)',
            marginInline: 'auto',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
