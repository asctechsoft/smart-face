import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, unknown>;
}

/**
 * Số thông báo chưa đọc — chạy nền ở MỌI trang vì nó vẽ con số trên quả chuông.
 *
 * `retry: false`: endpoint này hỏng thì cùng lắm mất con số trên chuông. Cho nó
 * thử lại ba lần như mặc định chỉ tạo thêm ba request lỗi mỗi phút.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...qk.notifications, 'unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * Danh sách thông báo — CHỈ tải khi popover đang mở.
 *
 * Danh sách này chỉ nhìn thấy được bên trong popover chuông. Tải sẵn ở mọi trang
 * là 30 bản ghi mỗi lần chuyển trang cho một khối phần lớn thời gian đóng kín;
 * con số chưa đọc đã đủ để biết có nên bấm vào hay không.
 */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.notifications, 'list'],
    queryFn: () => api.getPaginated<Notification>('/notifications', { pageSize: 30 }),
    enabled,
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Notification>(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
}
