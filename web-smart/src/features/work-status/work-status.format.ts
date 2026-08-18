/**
 * Định dạng dùng chung cho màn Theo dõi công việc.
 *
 * Ở một file riêng chứ không nằm cạnh component: React Fast Refresh chỉ làm mới
 * được state của một module khi module đó CHỈ export component. Một hàm thường
 * đứng lẫn vào là đủ để mỗi lần sửa dòng thời gian lại nạp lại cả module và xoá
 * sạch state đang gõ dở — Vite báo đúng điều này ("formatClock export is
 * incompatible").
 */

/**
 * Phút của ngày làm việc → "HH:mm".
 *
 * Phút ≥ 1440 (ca đêm tan sau nửa đêm) hiện "25:40" chứ KHÔNG quay về "01:40":
 * trên một trục đi từ trái sang phải, "01:40" đứng bên phải "22:00" đọc như thời
 * gian chạy ngược.
 */
export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
