import { ErrorState } from '@/components/ui';
import { toUserError } from '@/lib/errors/api-error';

/**
 * Khối lỗi cho một lời gọi API hỏng.
 *
 * Tồn tại để nối `ErrorState` (thuần trình bày, nằm ở `components/ui/`) với tầng
 * dịch lỗi (`lib/errors`) mà không kéo tầng API vào thư viện component. Trước
 * đó 11 màn hình cùng viết lại một đoạn giống nhau, và mỗi nơi lỡ một chi tiết
 * khác nhau: chỗ quên `traceId`, chỗ vẫn hiện nút "Thử lại" cho lỗi 403.
 *
 * `title` chỉ truyền khi màn hình biết rõ hơn tầng dịch lỗi về việc gì vừa hỏng
 * — ví dụ "Không tải được biểu đồ chuyên cần" thay vì câu chung của Backend.
 */
export function ApiErrorState({
  error,
  onRetry,
  title,
  fallbackDescription = 'Không tải được dữ liệu cho mục này.',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  fallbackDescription?: string;
}) {
  const mapped = toUserError(error);

  return (
    <ErrorState
      title={title ?? mapped.title}
      description={mapped.body ?? fallbackDescription}
      traceId={mapped.traceId}
      canRetry={mapped.canRetry}
      onRetry={onRetry}
    />
  );
}
