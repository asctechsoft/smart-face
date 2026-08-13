import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { Avatar } from './Avatar';

/**
 * Drawer — docs/16 mục 11.14.
 *
 * Rộng `299px` theo tài liệu, nhưng ở đây cho phép ghi đè: bản thiết kế mô tả
 * drawer thông báo trên mobile, còn Web Quản lý dùng drawer để đối soát một lượt
 * chấm công — có ảnh, bản đồ và hai cột số liệu. Nhồi vào 299px là không đọc
 * được. Mặc định giữ 299, nơi nào cần thì khai rõ.
 *
 * Dưới breakpoint `lg` drawer chiếm toàn bộ bề rộng (mục 8).
 *
 * Yêu cầu tiếp cận giống modal: bẫy focus, `Esc`, trả focus khi đóng.
 */
export function Drawer({
  open,
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = 299,
  /** Header dạng dải teal cao 128px với avatar 96px đè lên (mục 11.14). */
  hero,
  extra,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  hero?: { name: string; src?: string | null };
  extra?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

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
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

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
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1040, background: 'rgba(25, 28, 28, 0.45)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 1050,
          width: `min(${width}px, 100vw)`,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--sf-surface)',
          borderLeft: '1px solid var(--sf-outline-variant)',
          boxShadow: 'var(--sf-shadow-lg)',
          animation: 'sf-drawer-in 250ms cubic-bezier(.4,0,.2,1)',
        }}
      >
        {hero ? (
          <div style={{ position: 'relative', marginBottom: 56 }}>
            <div style={{ height: 128, background: 'var(--sf-primary-surface)' }} />
            <div style={{ position: 'absolute', left: 24, bottom: -48 }}>
              <Avatar name={hero.name} src={hero.src} size={96} shape="rounded" />
            </div>
            <div style={{ position: 'absolute', top: 12, right: 12 }} className="sf-on-dark">
              <IconButton icon="close" label="Đóng bảng chi tiết" onClick={onClose} />
            </div>
          </div>
        ) : null}

        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
            padding: 24,
            borderBottom: '1px solid var(--sf-outline-variant)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="sf-title-md">
              {title}
            </h2>
            {subtitle ? (
              <div className="sf-body-sm sf-text-variant" style={{ marginTop: 4 }}>
                {subtitle}
              </div>
            ) : null}
          </div>

          {extra}
          {!hero ? <IconButton icon="close" label="Đóng bảng chi tiết" onClick={onClose} /> : null}
        </header>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {children}
        </div>

        {footer ? (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
              padding: 24,
              borderTop: '1px solid var(--sf-outline-variant)',
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>

      <style>{`@keyframes sf-drawer-in { from { transform: translateX(100%) } }`}</style>
    </div>,
    document.body,
  );
}

/**
 * Bottom sheet — docs/16 mục 11.19.
 *
 * Cùng cơ chế với drawer nhưng trượt từ dưới lên, bo góc trên `12px`, có thanh
 * kéo `32 × 4`. Dùng cho màn hình hẹp, nơi drawer bên phải chỉ còn một dải mỏng.
 */
export function BottomSheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1040,
        background: 'rgba(25, 28, 28, 0.45)',
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          zIndex: 1050,
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: 16,
          borderRadius: '12px 12px 0 0',
          background: 'var(--sf-surface)',
          boxShadow: 'var(--sf-shadow-lg)',
          animation: 'sf-sheet-in 250ms cubic-bezier(.4,0,.2,1)',
        }}
      >
        <div className="sf-sheet-handle" aria-hidden="true" />
        <h2 id={titleId} className="sf-title-md" style={{ marginBottom: 16 }}>
          {title}
        </h2>
        {children}
      </div>

      <style>{`@keyframes sf-sheet-in { from { transform: translateY(100%) } }`}</style>
    </div>,
    document.body,
  );
}
