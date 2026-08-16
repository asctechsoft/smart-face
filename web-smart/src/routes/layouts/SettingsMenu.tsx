import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Button, Popover } from 'antd';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/rbac/permissions';
import { SETTINGS_ITEMS } from '@/routes/nav-items';

/**
 * Popover "Thiết lập" — bánh răng đứng ngay cạnh chuông thông báo.
 *
 * Năm màn hình trong này đều là việc CẤU HÌNH MỘT LẦN: khai báo nhân viên, đặt
 * chính sách, dựng luồng duyệt, trao quyền, tra nhật ký. Chúng từng chiếm gần
 * một nửa sidenav dù người dùng hằng ngày không đụng tới — đẩy sang popover trả
 * lại thanh điều hướng cho năm việc làm mỗi ngày.
 *
 * Mục vẫn là `NavLink` chứ không phải nút gọi `navigate()`: nhờ vậy người dùng
 * mở tab mới bằng chuột giữa hoặc Ctrl+Click được, và mục đang mở tự có
 * `aria-current="page"` để CSS tô nền như trên sidenav.
 */
export function SettingsMenu() {
  const { roles } = useAuth();
  const [open, setOpen] = useState(false);

  const visible = SETTINGS_ITEMS.filter((item) => hasPermission(roles, item.permission));

  // Quản lý cấp phòng không có quyền nào trong nhóm này. Hiện bánh răng rỗng chỉ
  // để bấm vào thấy một ô trắng thì thà không hiện.
  if (visible.length === 0) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayInnerStyle={{ padding: 8 }}
      content={
        <div style={{ width: 240 }}>
          <div className="sf-nav-group-label" style={{ padding: '4px 12px' }}>
            Thiết lập
          </div>
          <ul className="sf-nav-list">
            {visible.map((item) => (
              <li key={item.key}>
                <NavLink to={item.to} className="sf-nav-item" onClick={() => setOpen(false)}>
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
      }
    >
      <Button
        type="text"
        shape="circle"
        aria-label="Thiết lập"
        aria-haspopup="menu"
        aria-expanded={open}
        icon={<Icon name="settings" size={24} color="var(--sf-on-surface-variant)" />}
      />
    </Popover>
  );
}
