import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, Modal, Select, Tabs } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { ApiErrorState } from '@/components/ApiErrorState';
import { Can } from '@/lib/rbac/Can';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeDay, formatDateTime } from '@/lib/utils/date';
import { useDepartments } from '@/features/shared/org.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, unknown>;
}

/**
 * Thông báo — docs/04 mục 10 (`FR-WEB-NOT-01..03`).
 *
 * Hai việc khác nhau nằm chung một trang: đọc thông báo gửi tới mình, và soạn
 * thông báo gửi cho công ty. Gộp vì cả hai đều là "hộp thư", và tách ra hai mục
 * sidenav sẽ làm menu dài thêm mà không rõ ràng hơn.
 */
export function NotificationsPage() {
  const { timezone } = useAuth();
  const queryClient = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);

  const notifications = useQuery({
    queryKey: [...qk.notifications, 'list'],
    queryFn: () => api.getPaginated<Notification>('/notifications', { pageSize: 50 }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post<Notification>(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const unreadCount = notifications.data?.items.filter((item) => !item.readAt).length ?? 0;

  return (
    <>
      <PageHeader
        title="Thông báo"
        description="Thông báo hệ thống gửi tới bạn, và công cụ soạn thông báo gửi tới nhân viên."
        actions={
          <>
            {unreadCount > 0 ? (
              <Button
                onClick={() => void markAllRead.mutateAsync()}
                loading={markAllRead.isPending}
              >
                Đánh dấu tất cả đã đọc
              </Button>
            ) : null}
            <Can do="notification.send">
              <Button
                type="primary"
                icon={<Icon name="campaign" size={20} />}
                onClick={() => setComposeOpen(true)}
              >
                Soạn thông báo
              </Button>
            </Can>
          </>
        }
      />

      <Tabs
        items={[
          {
            key: 'inbox',
            label: <span>Hộp thư{unreadCount > 0 ? ` (${unreadCount})` : ''}</span>,
            children: notifications.isLoading ? (
              <CardSkeleton height={240} />
            ) : notifications.error ? (
              <ApiErrorState
                error={notifications.error}
                onRetry={() => void notifications.refetch()}
                fallbackDescription="Không tải được hộp thư thông báo."
              />
            ) : !notifications.data || notifications.data.items.length === 0 ? (
              <EmptyState
                icon="notifications_off"
                title="Chưa có thông báo nào"
                description="Thông báo về đơn từ cần duyệt, cảnh báo gian lận và kết quả job xuất file sẽ xuất hiện ở đây."
              />
            ) : (
              /* docs/16 mục 11.20 — chưa đọc: nền teal-50 + viền trái teal-700. */
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {notifications.data.items.map((item) => {
                  const unread = !item.readAt;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => unread && markRead.mutate(item.id)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'flex',
                          gap: 16,
                          padding: 16,
                          border: 'none',
                          borderBottom: '1px solid var(--sf-outline-variant)',
                          borderLeft: unread ? '2px solid var(--sf-teal-700)' : '2px solid transparent',
                          background: unread ? 'var(--sf-teal-50)' : 'transparent',
                          cursor: unread ? 'pointer' : 'default',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 9999,
                            background:
                              item.type === 'WARNING'
                                ? 'var(--sf-warning-100)'
                                : 'var(--sf-teal-100)',
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon
                            name={item.type === 'WARNING' ? 'warning' : 'notifications'}
                            size={18}
                            color={
                              item.type === 'WARNING'
                                ? 'var(--sf-warning-800)'
                                : 'var(--sf-teal-800)'
                            }
                          />
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            className="sf-body-sm"
                            style={{ fontWeight: unread ? 700 : 600, marginBottom: 2 }}
                          >
                            {item.title}
                          </div>
                          <div className="sf-body-sm sf-text-variant">{item.body}</div>
                          <div className="sf-caption" title={formatDateTime(item.createdAt, timezone)}>
                            {formatRelativeDay(item.createdAt, timezone)}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ),
          },
        ]}
      />

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </>
  );
}

function ComposeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const departments = useDepartments();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);

  const broadcast = useMutation({
    mutationFn: (payload: { title: string; body: string; departmentIds?: string[] }) =>
      api.post<{ recipients: number }>('/admin/notifications/broadcast', payload),
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Soạn thông báo"
      okText="Gửi thông báo"
      cancelText="Huỷ bỏ"
      okButtonProps={{
        size: 'large',
        loading: broadcast.isPending,
        disabled: !title.trim() || !body.trim(),
      }}
      cancelButtonProps={{ size: 'large' }}
      width={600}
      destroyOnClose
      afterOpenChange={(isOpen) => {
        if (isOpen) {
          setTitle('');
          setBody('');
          setDepartmentIds([]);
        }
      }}
      onOk={async () => {
        try {
          const result = await broadcast.mutateAsync({
            title: title.trim(),
            body: body.trim(),
            departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
          });
          toast.success(`Đã gửi thông báo tới ${result.recipients} nhân viên`);
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Alert
          type="info"
          showIcon
          message="Thông báo được đẩy tới ứng dụng của nhân viên"
          description="Nhân viên nhận push notification ngay. Không gửi thông tin nhạy cảm qua kênh này."
        />

        <div>
          <label className="sf-field__label" htmlFor="n-title" style={{ display: 'block', marginBottom: 4 }}>
            Tiêu đề
          </label>
          <Input
            id="n-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            showCount
            placeholder="Nghỉ lễ Quốc khánh 2/9"
          />
        </div>

        <div>
          <label className="sf-field__label" htmlFor="n-body" style={{ display: 'block', marginBottom: 4 }}>
            Nội dung
          </label>
          <Input.TextArea
            id="n-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            maxLength={1000}
            showCount
            placeholder="Công ty nghỉ từ 02/09 đến hết 03/09. Nhân viên trực ca vui lòng đăng ký OT trước ngày 30/08."
          />
        </div>

        <div>
          <label className="sf-field__label" htmlFor="n-dept" style={{ display: 'block', marginBottom: 4 }}>
            Gửi tới
          </label>
          <Select
            id="n-dept"
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            value={departmentIds}
            onChange={setDepartmentIds}
            loading={departments.isLoading}
            placeholder="Bỏ trống = toàn bộ công ty"
            options={(departments.data ?? []).map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
        </div>
      </div>
    </Modal>
  );
}
