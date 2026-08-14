import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * Toast — docs/16 mục 11.12.
 *
 * Tự viết thay vì dùng `message` của antd vì ba yêu cầu trong tài liệu mà antd
 * không làm, và cả ba đều là yêu cầu thật chứ không phải chi tiết thẩm mỹ:
 *
 *   1. **Lỗi KHÔNG tự đóng.** Success 4s, warning 6s, error không bao giờ.
 *      Thông báo lỗi biến mất sau 3 giây là thông báo chưa ai kịp đọc — và ở
 *      màn hình chốt kỳ lương thì đó là thông tin người dùng cần nhất.
 *   2. **Dừng đếm giờ khi rê chuột hoặc focus vào toast.** Người đang đọc dở
 *      không nên bị cướp mất câu văn.
 *   3. **Nút đóng có vùng chạm 44 × 44px.** Thiết kế cũ để 8px — vi phạm nặng
 *      nhất trong toàn bộ hệ (mục 14.2 điều 2).
 *
 * `role` cũng khác nhau theo loại: `alert` cho lỗi (trình đọc màn hình cắt
 * ngang để đọc), `status` cho phần còn lại (đọc khi rảnh).
 */
export type ToastTone = 'success' | 'warning' | 'error';

/**
 * Đường đi tiếp sau khi thao tác xong.
 *
 * "Đã tạo 195 nhân viên" là tin tốt, nhưng người dùng vừa làm xong việc đó gần
 * như luôn muốn xem kết quả — và họ phải tự tìm đường quay lại. Một nút ngay
 * trong thông báo tiết kiệm đúng bước đó.
 *
 * Cố ý chỉ MỘT hành động: hai nút trong một toast là bắt người ta ra quyết định
 * trong lúc thông báo đang đếm ngược để tự đóng.
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: ToastAction;
}

interface ToastApi {
  success: (title: string, body?: string, action?: ToastAction) => void;
  warning: (title: string, body?: string, action?: ToastAction) => void;
  error: (title: string, body?: string, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  success: 4000,
  warning: 6000,
  error: null,
};

const TONE_ICON: Record<ToastTone, { name: string; color: string }> = {
  success: { name: 'check_circle', color: 'var(--sf-success-600)' },
  warning: { name: 'warning', color: 'var(--sf-warning-700)' },
  error: { name: 'error', color: 'var(--sf-error-600)' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, body?: string, action?: ToastAction) => {
      setItems((prev) => {
        const item: ToastItem = { id: nextId.current++, tone, title, body, action };
        // Giữ tối đa 4 toast: chồng nhiều hơn thì cái cũ nhất bị đẩy khỏi màn hình
        // mà người dùng chưa đọc, và cả cột che mất nội dung phía dưới.
        return [...prev, item].slice(-4);
      });
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, body, action) => push('success', title, body, action),
      warning: (title, body, action) => push('warning', title, body, action),
      error: (title, body, action) => push('error', title, body, action),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="sf-toast-region">
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = AUTO_DISMISS_MS[item.tone];

  useEffect(() => {
    if (duration === null || paused) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
    // `paused` trong deps là chủ đích: rê chuột vào sẽ huỷ hẹn giờ, rời chuột ra
    // đặt lại hẹn giờ ĐẦY ĐỦ. Tiếp tục đếm từ chỗ dừng chính xác hơn về mặt kỹ
    // thuật nhưng tệ hơn khi dùng — người vừa đọc xong bị mất toast sau 200ms.
  }, [duration, paused, onDismiss]);

  const icon = TONE_ICON[item.tone];

  return (
    <div
      className={`sf-toast sf-toast--${item.tone}`}
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={icon.name} size={20} color={icon.color} fill />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sf-toast__title">{item.title}</div>
        {item.body ? <p className="sf-toast__body">{item.body}</p> : null}

        {item.action ? (
          <button
            type="button"
            className="sf-toast__action"
            onClick={() => {
              item.action?.onClick();
              // Đóng luôn sau khi bấm: người dùng đã rời khỏi ngữ cảnh của thông
              // báo, để nó nằm lại trên màn hình mới là rác.
              onDismiss();
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>

      <button type="button" className="sf-toast__close" onClick={onDismiss} aria-label="Đóng thông báo">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast phải nằm trong <ToastProvider>');
  return context;
}
