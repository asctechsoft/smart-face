import { useCallback } from 'react';
import { useToast } from '@/components/ui';
import { toUserError } from './api-error';

/**
 * Hiện một lỗi API dưới dạng toast, đã dịch sang câu người dùng đọc được.
 *
 * Tồn tại vì mọi màn hình đều cần đúng ba dòng giống nhau — dịch lỗi, tách tiêu
 * đề với hướng dẫn, đẩy vào toast — và trước đó 40 chỗ cùng viết
 * `message.error(toUserMessage(caught))`, nối tiêu đề với hướng dẫn thành một
 * câu dài rồi để nó tự biến mất sau 3 giây.
 *
 * ```tsx
 * const showError = useErrorToast();
 * try { await save(); } catch (caught) { showError(caught); }
 * ```
 *
 * Toast lỗi KHÔNG tự đóng (docs/16 mục 11.12) — người dùng phải chủ động tắt,
 * nên không có chuyện thông báo biến mất trước khi kịp đọc.
 */
export function useErrorToast(): (error: unknown) => void {
  const toast = useToast();

  return useCallback(
    (error: unknown) => {
      const { title, body } = toUserError(error);
      toast.error(title, body);
    },
    [toast],
  );
}
