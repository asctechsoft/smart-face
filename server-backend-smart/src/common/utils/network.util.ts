/**
 * Chuẩn hoá định danh mạng cục bộ (AF-02).
 *
 * BSSID là địa chỉ MAC của bộ phát WiFi. Cùng một bộ phát nhưng mỗi nơi viết
 * một kiểu:
 *
 * ```
 * a4:2b:8c:11:9d:0e     ← Android, chữ thường, dấu hai chấm
 * A4-2B-8C-11-9D-0E     ← Windows, chữ hoa, dấu gạch
 * A42B8C119D0E          ← HR chép tay từ mặt sau bộ phát
 * a4:2b:8c:11:9d:e      ← thiếu số 0 ở đầu octet cuối
 * ```
 *
 * So chuỗi thô sẽ làm nhân viên bị từ chối chấm công chỉ vì HR gõ chữ hoa —
 * lỗi cực khó lần ra vì nhìn bằng mắt thì hai chuỗi "giống nhau".
 */

/** Chỉ giữ ký tự hex, viết hoa. Trả chuỗi rỗng nếu không phải MAC hợp lệ. */
export function normalizeBssid(raw: string | null | undefined): string {
  if (!raw) return '';

  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();

  // MAC-48 = 12 ký tự hex. Khác đi là dữ liệu hỏng, không phải BSSID.
  if (hex.length !== 12) return '';

  // Android trả `02:00:00:00:00:00` khi app thiếu quyền vị trí — đó là giá trị
  // giữ chỗ, không phải bộ phát nào cả. Coi như không đọc được.
  if (hex === '020000000000' || hex === '000000000000') return '';

  return hex;
}

/** Định dạng lại để hiển thị cho người đọc: A42B8C119D0E → a4:2b:8c:11:9d:0e */
export function formatBssid(normalized: string): string {
  if (normalized.length !== 12) return normalized;
  return (normalized.match(/.{2}/g) ?? []).join(':').toLowerCase();
}

export function isValidBssid(raw: string | null | undefined): boolean {
  return normalizeBssid(raw).length === 12;
}
