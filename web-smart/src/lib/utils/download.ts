/**
 * Tải file từ link có thời hạn do Backend cấp.
 *
 * Không dùng `window.open`: trình duyệt chặn pop-up khi lệnh mở không phát sinh
 * trực tiếp từ cú click (ở đây link tới sau khi job export chạy xong). Thẻ `<a>`
 * tạm với `download` đi qua được chốt đó.
 */
export function downloadFromUrl(url: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Xuất một mảng object ra CSV ngay tại trình duyệt.
 *
 * ⚠ CHỈ dùng cho dữ liệu nhỏ đang hiển thị trên màn hình (VD: kết quả import,
 * danh sách cảnh báo). Bảng công và bảng lương BẮT BUỘC xuất ở Backend
 * (docs/04 mục 7.4) — dữ liệu phức tạp, và client không có đủ ngữ cảnh để tính
 * đúng.
 */
export function downloadCsv(
  rows: Record<string, unknown>[],
  filename: string,
  headers?: Record<string, string>,
): void {
  if (rows.length === 0) return;

  const keys = Object.keys(headers ?? (rows[0] as Record<string, unknown>));
  const headerLine = keys.map((key) => escapeCsv(headers?.[key] ?? key)).join(',');
  const lines = rows.map((row) => keys.map((key) => escapeCsv(row[key])).join(','));

  // BOM UTF-8 (U+FEFF) ở đầu file: thiếu nó thì Excel đọc file theo bảng mã
  // hệ thống và mọi dấu tiếng Việt biến thành ký tự lạ.
  const blob = new Blob([`\uFEFF${headerLine}\n${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, filename);
  // Thu hồi ở lần lặp sự kiện sau — thu hồi ngay có thể huỷ link trước khi
  // trình duyệt kịp đọc.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Dấu `=`, `+`, `-`, `@` ở đầu ô khiến Excel hiểu là công thức — một ô tên
  // nhân viên bắt đầu bằng `=` có thể trở thành lệnh chạy được (CSV injection).
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
