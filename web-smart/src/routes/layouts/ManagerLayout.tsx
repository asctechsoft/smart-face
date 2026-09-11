import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Drawer, Dropdown } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { EmployeeQuickSearch } from '@/components/EmployeeQuickSearch';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useAuth } from '@/lib/auth/auth-context';
import { useAccess } from '@/lib/rbac/access-context';
import { hasPermission } from '@/lib/rbac/permissions';
import { canSeeNavItem, hasNestedNavDestination, selectNavGroups } from '@/routes/nav-items';
import { useSetupState } from '@/features/provisioning/provisioning.api';
import { documentTitleFor, resolvePageTitle } from '@/routes/page-title';
import { ACCESS_ROLE_LABEL, ROLE_LABEL } from '@/config/constants';
import { initials } from '@/lib/utils/format';
import { formatDayLong } from '@/lib/utils/date';
import { api } from '@/lib/api/client';
import { Icon } from '@/components/ui';
import { BrandMark } from '@/components/BrandMark';
import { env } from '@/config/env';

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
  const {
    access,
    isLoading: accessLoading,
    isError: accessError,
    refetch: refetchAccess,
  } = useAccess();

  /*
   * Bộ điều hướng chọn theo QUYỀN, không theo vai trò — xem `selectNavGroups`.
   * `useMemo` vì `access` đổi hiếm nhưng `nav` được dựng lại ở mọi lần render
   * của layout, kể cả khi chỉ mở popover thông báo.
   */
  const canRunSetup = hasPermission(access, 'setup.run');

  /*
   * Wizard thiết lập ban đầu chỉ hỏi khi người này có quyền chạy nó. Gọi cho
   * người khác chỉ tạo ra một loạt 403 trong nhật ký mà không ai đọc.
   */
  const setup = useSetupState(canRunSetup);
  const setupPending = canRunSetup && setup.data !== undefined && setup.data.completedAt === null;

  const navGroups = useMemo(() => {
    const groups = selectNavGroups((permission) => hasPermission(access, permission));
    if (!setupPending) return groups;

    /*
     * "Thiết lập ban đầu" đứng ĐẦU và biến mất khi xong.
     *
     * Không khai nó trong `EXECUTIVE_NAV` tĩnh vì nó không phải một mục thường
     * trực: sau khi wizard hoàn tất, một mục dẫn tới màn hình "đã xong hết rồi"
     * là mục chết chiếm chỗ trên thanh điều hướng vĩnh viễn.
     */
    return [
      {
        key: 'setup',
        items: [
          {
            key: 'setup-wizard',
            label: 'Thiết lập ban đầu',
            icon: 'flag',
            to: '/thiet-lap',
            permission: 'setup.run' as const,
          },
        ],
      },
      ...groups,
    ];
  }, [access, setupPending]);
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);

  const pageTitle = resolvePageTitle(location.pathname);

  /*
   * Rơi về vai trò cũ trong token khi chưa có `/access/me` — trong lúc chờ, hiện
   * một nhãn gần đúng vẫn hơn là để trống chỗ danh tính của người dùng.
   */
  const roleLabels = (
    access?.roles.length
      ? access.roles.map((code) => ACCESS_ROLE_LABEL[code] ?? code)
      : roles.map((role) => ROLE_LABEL[role])
  ).join(' · ');

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

  /*
   * Menu tai khoan khai MOT lan, gan o hai cho.
   *
   * Tren desktop no nam o chan sidenav (theo ban ve); duoi 768px sidenav an
   * han sau hamburger nen cung menu do phai co mat o topbar, neu khong nguoi
   * dung dien thoai khong con loi nao de dang xuat. Chep thanh hai ban thi mot
   * ngay nao do chi mot ben co muc moi.
   */
  const accountMenu = {
    items: [
      {
        key: 'identity',
        label: (
          <div style={{ padding: '4px 0' }}>
            <div className="sf-body-sm" style={{ fontWeight: 600 }}>
              {profile?.fullName ?? 'Tài khoản của tôi'}
            </div>
            {/*
              Vai trò lấy từ `/access/me`, KHÔNG từ `roles` trong token.

              Token mang `SystemRole` cũ và chỉ làm mới khi hết hạn (900 giây),
              nên nó nói sai ngay sau khi ai đó đổi vai trò của người này. Nó
              cũng không biết `OWNER` — người chủ công ty sẽ hiện là "Admin
              công ty".
            */}
            <div className="sf-caption">
              {roleLabels}
              {company?.name ? ` · ${company.name}` : ''}
            </div>
          </div>
        ),
        disabled: true,
      },
      { type: 'divider' as const },
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
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') void logout();
      if (key === 'password') navigate('/doi-mat-khau');
    },
  };

  /** Bỏ trống `VITE_HELP_URL` thì ẩn mục — xem chú thích ở `config/env.ts`. */
  const helpUrl = env.VITE_HELP_URL?.trim() || null;

  const nav = (
    <nav className="sf-sidenav" aria-label="Điều hướng chính">
      {/*
        Màu ở đây phải lấy từ nhóm `--sf-sidenav-*`, KHÔNG lấy từ thang thương
        hiệu: `blue-700` trên nền navy chỉ đạt 2.54:1. Trên nền tối, chữ dùng
        sắc SÁNG — trắng cho tên sản phẩm (17.04:1), `neutral-300` cho mục
        thường (8.9:1), `neutral-400` cho dòng phụ (6.65:1).

        Tên công ty KHÔNG còn nằm ở đây: nó đã có mặt ở khối tài khoản dưới
        chân thanh, và in cùng một chuỗi hai lần trên một cột hẹp chỉ làm loãng
        phần trên cùng — chỗ đắt nhất của thanh điều hướng.
      */}
      <div className="sf-sidenav__brand">
        <BrandMark size={28} />
        <span className="sf-sidenav__wordmark">SmartFace</span>
      </div>

      {/*
        Chưa biết quyền thì KHÔNG vẽ menu rỗng.

        Vẽ rỗng rồi mới điền là nói với người dùng "bạn không có chức năng nào"
        trong nửa giây đầu — và với người đăng nhập lần đầu thì nửa giây đó đủ
        để họ tin là thật. Lỗi thì nói rõ có sự cố, kèm nút thử lại: giấu hết mà
        không giải thích cũng là một câu trả lời sai.
      */}
      {accessLoading ? (
        <div style={{ padding: '0 12px', display: 'grid', gap: 8 }} aria-busy="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <span
              key={row}
              style={{
                height: 36,
                borderRadius: 8,
                background: 'var(--sf-sidenav-item-hover)',
              }}
            />
          ))}
          <span className="sf-body-sm" style={{ color: 'var(--sf-sidenav-item)' }}>
            Đang tải quyền…
          </span>
        </div>
      ) : accessError ? (
        <div style={{ padding: '0 12px', display: 'grid', gap: 8 }} role="alert">
          <span className="sf-body-sm" style={{ color: 'var(--sf-on-sidenav)' }}>
            Chưa tải được danh sách chức năng.
          </span>
          <button type="button" className="sf-link" onClick={refetchAccess}>
            Thử lại
          </button>
        </div>
      ) : null}

      <div className="sf-sidenav__groups">
        {navGroups.map((group) => {
          const visible = group.items.filter((item) =>
            canSeeNavItem(item, (permission) => hasPermission(access, permission)),
          );
          if (visible.length === 0) return null;

          return (
            <div key={group.key}>
              {group.label ? <div className="sf-nav-group-label">{group.label}</div> : null}
              <ul className="sf-nav-list">
                {visible.map((item) => (
                  <li key={item.key}>
                    {/* NavLink tự đặt `aria-current="page"` khi khớp route. CSS ở
                        global.css bám vào chính thuộc tính đó để tô nền xanh —
                        trạng thái hiển thị và trạng thái trình đọc màn hình đọc
                        lên là MỘT, không thể lệch nhau.

                        `end` bật khi có lối vào khác nằm bên dưới mục này, để
                        mục cha thôi khớp tiền tố và nhường cho mục cụ thể hơn.
                        Trang chi tiết KHÔNG có lối vào riêng (`/attendance/:id`,
                        `/shifts/:id`) vẫn tô sáng mục cha như cũ — xem
                        `hasNestedNavDestination`. */}
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

      {/*
        Chân thanh: trợ giúp và tài khoản.

        Tách bằng một đường kẻ mờ chứ không bằng khoảng trắng — hai mục này
        KHÁC loại với danh sách bên trên. Danh sách trên là "đi tới đâu trong
        sản phẩm"; hai mục này là "thoát ra khỏi công việc đang làm", và người
        dùng tìm chúng bằng vị trí (dưới cùng) chứ không đọc lần lượt.
      */}
      <div className="sf-sidenav__footer">
        {helpUrl ? (
          <a
            className="sf-nav-item"
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Trợ giúp (mở tab mới)"
          >
            <Icon name="help" size={18} />
            <span style={{ flex: 1 }}>Trợ giúp</span>
            <Icon name="open_in_new" size={16} />
          </a>
        ) : null}

        <Dropdown trigger={['click']} menu={accountMenu} placement="topRight">
          <button type="button" className="sf-sidenav__account" aria-label="Menu tài khoản">
            <span className="sf-sidenav__avatar" aria-hidden="true">
              {initials(profile?.fullName)}
            </span>
            <span className="sf-sidenav__identity">
              <span className="sf-sidenav__name">{profile?.fullName ?? 'Tài khoản của tôi'}</span>
              <span className="sf-sidenav__org">{company?.name ?? 'Chưa gán công ty'}</span>
            </span>
            <Icon name="expand_more" size={16} />
          </button>
        </Dropdown>
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
            // Không cần viền: nền navy đã tự tách khỏi nền sáng của nội dung.
            // Giữ viền xám ở đây sẽ thành một vạch sáng chạy dọc cạnh tối.
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

          {/* Popover bánh răng đã bị gỡ: nội dung của nó (Loại đơn, Phân quyền,
              Nhật ký) giờ là ba tab của trang "Thiết lập" trên sidenav. Hai lối
              vào ở hai góc màn hình cho cùng một nhóm màn hình bắt người dùng
              phải nhớ cái nào ở đâu. */}
          <NotificationBell />

          {/*
            Tren desktop khoi tai khoan da nam o chan sidenav; giu them mot ban
            o day la hai loi vao cho cung mot menu, canh nhau tren cung mot man
            hinh. Duoi 768px sidenav an han nen day la loi vao DUY NHAT.
          */}
          {!isDesktop ? (
            <Dropdown trigger={['click']} menu={accountMenu}>
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
                    background: 'var(--sf-blue-700)',
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
          ) : null}
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
