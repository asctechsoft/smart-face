import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';

/**
 * Modal — docs/16 mục 11.13.
 *
 * Bốn yêu cầu tiếp cận bắt buộc (mục 14.2 điều 6), đều được thi hành ở đây một
 * lần cho tất cả màn hình:
 *
 *   • `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
 *   • **Bẫy focus** — Tab không thoát ra được nội dung phía sau
 *   • `Esc` để đóng
 *   • **Trả focus** về phần tử đã mở modal khi đóng
 *
 * Điều cuối cùng là thứ hay bị bỏ nhất và khó chịu nhất: đóng modal xong mà
 * focus rơi về `<body>` thì người dùng bàn phím phải Tab lại từ đầu trang.
 */
export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  width = 560,
  /** Hộp thoại xác nhận nhỏ: nền đặc, không làm mờ nền sau (mục 11.13). */
  compact = false,
  closable = true,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  compact?: boolean;
  closable?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Ghi nhớ nơi focus đang đứng TRƯỚC khi modal chiếm lấy nó.
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && closable) {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      // Bẫy focus: từ phần tử cuối Tab tiếp quay về đầu, và ngược lại với
      // Shift+Tab. Không có đoạn này thì Tab đi thẳng ra thanh địa chỉ trình
      // duyệt rồi vào nội dung phía sau lớp phủ — nội dung mà người dùng đang
      // nhìn thấy là bị khoá.
      const items = focusables();
      if (items.length === 0) return;

      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose, closable]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1040,
        background: 'rgba(25, 28, 28, 0.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
      onMouseDown={(event) => {
        // Chỉ đóng khi cú bấm BẮT ĐẦU trên lớp phủ. Dùng `onClick` sẽ đóng nhầm
        // khi người dùng bôi đen chữ trong modal rồi nhả chuột ra ngoài.
        if (closable && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        style={{
          zIndex: 1050,
          width: '100%',
          maxWidth: width,
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: compact ? 12 : 16,
          border: '1px solid var(--sf-outline-variant)',
          boxShadow: compact ? 'var(--sf-shadow-lg)' : 'var(--sf-shadow-xl)',
          background: compact ? 'var(--sf-surface)' : 'rgba(255, 255, 255, 0.7)',
          backdropFilter: compact ? undefined : 'blur(12px)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
            padding: compact ? 16 : 24,
            background: compact ? 'transparent' : 'var(--sf-surface-bright)',
            borderBottom: compact ? 'none' : '1px solid var(--sf-outline-variant)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              id={titleId}
              className={compact ? 'sf-headline-md' : 'sf-title-md'}
              style={compact ? { color: 'var(--sf-primary)' } : undefined}
            >
              {title}
            </h2>
            {description ? (
              <p id={descId} className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
                {description}
              </p>
            ) : null}
          </div>

          {closable ? <IconButton icon="close" label="Đóng hộp thoại" onClick={onClose} /> : null}
        </header>

        <div style={{ padding: compact ? 16 : 24, overflowY: 'auto', flex: 1 }}>{children}</div>

        {footer ? (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
              padding: compact ? 16 : 24,
              background: compact ? 'transparent' : 'var(--sf-surface-container-low)',
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Hộp thoại xác nhận — "xác nhận hai bước" cho thao tác nguy hiểm
 * (docs/04 mục 12.4).
 *
 * Áp dụng cho: chốt kỳ lương, xoá nhân viên, thu hồi thiết bị, huỷ công.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Huỷ bỏ',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      compact
      width={480}
      closable={!loading}
      footer={
        <>
          <Button variant="tertiary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={danger ? 'destructive' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="sf-body-md" style={{ margin: 0 }}>
        {message}
      </p>
    </Modal>
  );
}
