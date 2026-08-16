import { useMemo, useState } from 'react';
import { Badge, Button, Popover } from 'antd';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { ApiErrorState } from '@/components/ApiErrorState';
import { NotificationItem } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDay, formatRelativeDay, formatTime } from '@/lib/utils/date';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
  type Notification,
} from './notifications.api';

/**
 * Chuông thông báo trên header — thay cho trang `/notifications` cũ.
 *
 * Đọc thông báo là việc XEN NGANG: người dùng đang dở bảng công thì thấy con số
 * trên chuông nhảy lên. Bắt họ rời trang đang làm để đọc một dòng thông báo rồi
 * bấm quay lại là mất bộ lọc và vị trí cuộn của bảng — popover trả lại đúng chỗ
 * cũ khi đóng.
 *
 * Danh sách gom theo NGÀY chứ không phải một dải phẳng: thông báo hầu hết là
 * việc trong ngày ("có 3 đơn chờ duyệt"), và cái đến hôm qua phần lớn đã hết
 * hạn hành động.
 */
export function NotificationBell() {
  const { timezone } = useAuth();
  const [open, setOpen] = useState(false);

  const unread = useUnreadCount();
  const list = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = list.data?.items;

  /**
   * Gom theo ngày lịch, giữ nguyên thứ tự API trả về (mới nhất trước).
   *
   * `Map` giữ thứ tự chèn nên không cần sắp xếp lại: ngày nào có bản ghi đầu
   * tiên xuất hiện trước thì nhóm của nó đứng trước.
   */
  const groups = useMemo(() => {
    const byDay = new Map<string, { day: string; label: string; entries: Notification[] }>();
    for (const item of items ?? []) {
      const day = formatDay(item.createdAt, timezone);
      const bucket = byDay.get(day);
      if (bucket) bucket.entries.push(item);
      else
        byDay.set(day, {
          day,
          label: formatRelativeDay(item.createdAt, timezone),
          entries: [item],
        });
    }
    return [...byDay.values()];
  }, [items, timezone]);

  const unreadCount = unread.data?.count ?? 0;

  const content = (
    <div style={{ width: 380, maxWidth: '90vw' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid var(--sf-outline-variant)',
        }}
      >
        <span className="sf-title-sm">
          Thông báo
          {unreadCount > 0 ? ` (${unreadCount})` : ''}
        </span>
        {unreadCount > 0 ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            loading={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Đánh dấu tất cả đã đọc
          </Button>
        ) : null}
      </div>

      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {list.isLoading ? (
          <div style={{ padding: 16 }}>
            <CardSkeleton height={200} />
          </div>
        ) : list.error ? (
          <div style={{ padding: 16 }}>
            <ApiErrorState
              error={list.error}
              onRetry={() => void list.refetch()}
              fallbackDescription="Không tải được danh sách thông báo."
            />
          </div>
        ) : groups.length === 0 ? (
          <div style={{ padding: 16 }}>
            <EmptyState
              icon="notifications_off"
              title="Chưa có thông báo nào"
              description="Thông báo về đơn từ cần duyệt và kết quả job xuất file sẽ xuất hiện ở đây."
            />
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.day} aria-label={`Thông báo ${group.label}`}>
              {/* Tiêu đề ngày dính lại khi cuộn: danh sách 30 dòng trong một ô
                  cao 60vh thì người dùng cuộn qua ranh giới ngày lúc nào không
                  hay nếu tiêu đề trôi mất. */}
              <h3
                className="sf-label-md"
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  margin: 0,
                  padding: '8px 16px',
                  background: 'var(--sf-surface-bright)',
                  borderBottom: '1px solid var(--sf-outline-variant)',
                }}
                title={group.day}
              >
                {group.label}
              </h3>

              {group.entries.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <NotificationItem
                    key={item.id}
                    title={item.title}
                    body={item.body}
                    time={formatTime(item.createdAt, timezone)}
                    unread={isUnread}
                    tone={item.type === 'WARNING' ? 'warning' : 'info'}
                    onClick={isUnread ? () => markRead.mutate(item.id) : undefined}
                  />
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayInnerStyle={{ padding: 0, overflow: 'hidden' }}
      content={content}
    >
      <Button
        type="text"
        shape="circle"
        aria-label={
          unreadCount > 0
            ? `Thông báo, ${unreadCount} chưa đọc`
            : 'Thông báo, không có thông báo mới'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Badge count={unreadCount} size="small">
          <Icon name="notifications" size={24} color="var(--sf-on-surface-variant)" />
        </Badge>
      </Button>
    </Popover>
  );
}
