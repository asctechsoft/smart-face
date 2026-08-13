/** Định dạng số theo quy ước Việt Nam: dấu chấm ngăn nghìn. */
export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${formatNumber(value, fractionDigits)}%`;
}

/**
 * Số công chuẩn — Backend trả `Decimal(5,3)`, tới tay client là chuỗi hoặc số.
 *
 * Hiển thị 2 chữ số thập phân: 0.5 công (nửa ngày) và 0.25 công (nghỉ 2 tiếng)
 * là hai giá trị có thật trong nghiệp vụ, làm tròn về số nguyên là mất thông tin.
 */
export function formatStandardDays(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numeric)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

/** Điểm AI 0–1 → `0.71`. Giữ nguyên 2 chữ số vì ngưỡng nghiệp vụ nằm ở hàng phần trăm. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(2);
}

/** `340m` hoặc `1.2km` — khoảng cách tới chi nhánh. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/** Che số điện thoại khi hiển thị ở nơi không cần đầy đủ: `0901***567`. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

/**
 * Chữ viết tắt cho avatar: "Nguyễn Văn Đức" → "ĐVN"? Không — "NĐ".
 *
 * Lấy chữ cái đầu của HỌ và chữ cái đầu của TÊN (từ cuối). Tên Việt Nam đặt họ
 * trước, nên hai chữ này là cặp phân biệt tốt nhất trong một danh sách.
 */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  const first = parts[0] as string;
  const last = parts[parts.length - 1] as string;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

/** Kích thước file cho màn hình import. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
