import type { ReactNode } from 'react';

/**
 * Badge trạng thái — docs/16 mục 11.7.
 *
 * Đây là component đã phải SỬA vì lỗi tiếp cận thật (vấn đề #8 của bản v2):
 * badge cũ dùng nền trong suốt `rgba(46,125,50,.20)` với chữ `#2E7D32`, chỉ đạt
 * **3.91:1** ở cỡ 12px — không đạt AA, và nó hiện trên MỌI dòng bảng nhân viên.
 *
 * Hệ mới dùng bậc ĐẶC của ramp: nền bậc `100`, chữ bậc `800`. Kết quả 7.92 đến
 * 13.30:1. Biến thể `soft` (nền `50`, chữ `700`) cho bảng dày đặc, vẫn đạt AA.
 *
 * Đây cũng là lý do component không nhận `color` tuỳ ý: mở cửa cho màu tự do là
 * mở đường cho đúng lỗi vừa sửa quay lại.
 */
export type BadgeTone = 'success' | 'warning' | 'error' | 'teal' | 'neutral';

const TONE: Record<BadgeTone, { bg: string; fg: string; softBg: string; softFg: string }> = {
  success: {
    bg: 'var(--sf-success-100)',
    fg: 'var(--sf-success-800)',
    softBg: 'var(--sf-success-50)',
    softFg: 'var(--sf-success-700)',
  },
  warning: {
    bg: 'var(--sf-warning-100)',
    fg: 'var(--sf-warning-800)',
    softBg: 'var(--sf-warning-50)',
    softFg: 'var(--sf-warning-700)',
  },
  error: {
    bg: 'var(--sf-error-100)',
    fg: 'var(--sf-error-800)',
    softBg: 'var(--sf-error-50)',
    softFg: 'var(--sf-error-700)',
  },
  teal: {
    bg: 'var(--sf-teal-100)',
    fg: 'var(--sf-teal-800)',
    softBg: 'var(--sf-teal-50)',
    softFg: 'var(--sf-teal-700)',
  },
  neutral: {
    bg: 'var(--sf-neutral-200)',
    fg: 'var(--sf-neutral-900)',
    softBg: 'var(--sf-neutral-100)',
    softFg: 'var(--sf-neutral-700)',
  },
};

export function Badge({
  tone = 'neutral',
  soft = false,
  caps = false,
  icon,
  title,
  children,
}: {
  tone?: BadgeTone;
  /** Biến thể mềm cho bảng dày đặc — nền bậc 50, chữ bậc 700. */
  soft?: boolean;
  /** Biến thể VIẾT HOA 10px, bo góc vuông (mục 11.7). */
  caps?: boolean;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const palette = TONE[tone];

  return (
    <span
      title={title}
      className={`sf-badge${caps ? ' sf-badge--caps' : ''}`}
      style={{
        background: soft ? palette.softBg : palette.bg,
        color: soft ? palette.softFg : palette.fg,
      }}
    >
      {icon}
      {/* Chữ luôn có mặt: mục 14.2 điều 1 — không dùng riêng màu để truyền đạt
          trạng thái. Badge chỉ có màu là vô nghĩa với người mù màu và với ảnh
          chụp màn hình in đen trắng. */}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Ánh xạ trạng thái nghiệp vụ → tông màu
//
//  Gom về đây để một trạng thái luôn cùng một màu ở mọi màn hình. Rải ra từng
//  trang thì "Đi muộn" là vàng ở bảng chấm công mà lại là đỏ ở báo cáo.
// ---------------------------------------------------------------------------

export function dailyStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ON_TIME':
    case 'OVERTIME':
      return 'success';
    case 'LATE':
    case 'EARLY_LEAVE':
    case 'LATE_AND_EARLY':
    case 'INSUFFICIENT':
      return 'warning';
    case 'ABSENT':
    case 'MISSING_RECORD':
      return 'error';
    case 'ON_LEAVE':
      return 'teal';
    default:
      return 'neutral';
  }
}

export function requestStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'REJECTED':
      return 'error';
    default:
      return 'neutral';
  }
}

export function employeeStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'PENDING_ACTIVATION':
      return 'warning';
    case 'TERMINATED':
      return 'error';
    default:
      return 'neutral';
  }
}

export function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case 'HIGH':
      return 'error';
    case 'MEDIUM':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function periodStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'OPEN':
      return 'success';
    case 'REVIEWING':
      return 'warning';
    default:
      return 'neutral';
  }
}
