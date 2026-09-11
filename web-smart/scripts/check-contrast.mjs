/**
 * Kiểm tương phản WCAG cho thang màu SmartFace.
 *
 * ## Vì sao đây là script chứ không phải một dòng trong tài liệu
 *
 * Bản trước ghi trong docs/20 rằng đã kiểm 52 cặp màu, nhưng không có gì chạy
 * được để kiểm chứng lời đó. Khi đổi sang thang màu xanh dương, chính script này
 * bắt được **bốn cặp trượt AA**, trong đó có một cặp lấy thẳng từ mockup Figma:
 * chữ trắng trên `#16A34A` chỉ đạt 3.30. Không có nó thì cả bốn đã đi vào sản
 * phẩm và chỉ lộ ra khi có người khiếu nại.
 *
 * Chạy: `npm run check:contrast`. Thoát khác 0 khi có cặp trượt, nên gắn được
 * vào CI.
 *
 * ## Cách đọc kết quả
 *
 * Ngưỡng theo WCAG 2.1 AA:
 *   4.5  chữ thường
 *   3.0  chữ lớn (≥ 24px, hoặc ≥ 19px in đậm), viền control, đồ hoạ mang nghĩa
 *   1.3  đường phân cách thuần trang trí — không phải yêu cầu của WCAG, chỉ là
 *        sàn tự đặt để viền không biến mất hẳn
 */

/** Nguồn sự thật: phải khớp với `src/styles/tokens.css`. */
const RAMP = {
  'blue-50': '#EFF6FF',
  'blue-100': '#DBEAFE',
  'blue-300': '#93C5FD',
  'blue-400': '#60A5FA',
  'blue-500': '#3B82F6',
  'blue-600': '#2563EB',
  'blue-700': '#1D4ED8',
  'blue-800': '#1E40AF',
  navy: '#0B1B3A',
  /*
   * Chu phu tren sidenav/navy duoc ve bang `opacity: .78` tren nen navy. Ma mau
   * o day la KET QUA hoa, tinh bang dung phep hoa cua trinh duyet — kiem mau
   * goc (#FFFFFF) se cho ty so sai va sai ve phia an toan gia.
   */
  'navy-muted': '#C9CDD4',

  'green-50': '#F0FDF4',
  'green-100': '#DCFCE7',
  'green-600': '#16A34A',
  'green-700': '#15803D',
  'green-800': '#166534',

  'violet-50': '#F5F3FF',
  'violet-100': '#EDE9FE',
  'violet-700': '#6D28D9',
  'violet-800': '#5B21B6',

  'amber-50': '#FFFBEB',
  'amber-100': '#FEF3C7',
  'amber-700': '#B45309',
  'amber-800': '#92400E',

  'red-50': '#FEF2F2',
  'red-100': '#FEE2E2',
  'red-600': '#DC2626',
  /* `--sf-error-700` — mực đỏ THẬT SỰ được dùng cho số liệu và huy hiệu. */
  'red-700': '#B91C1C',
  'red-800': '#991B1B',

  white: '#FFFFFF',
  'n-50': '#F8FAFC',
  'n-100': '#F1F5F9',
  'n-200': '#E2E8F0',
  'n-300': '#CBD5E1',
  'n-400': '#94A3B8',
  'n-500': '#64748B',
  'n-600': '#475569',
  'n-700': '#334155',
  'n-800': '#1E293B',
  'n-900': '#0F172A',

  /** Nền chung của ứng dụng (`--sf-surface-bright`). */
  bg: '#F5F7FA',
};

/** [mô tả, chữ, nền, ngưỡng] */
const PAIRS = [
  ['Chữ thường trên nền trắng', 'n-900', 'white', 4.5],
  ['Chữ thường trên nền app', 'n-900', 'bg', 4.5],
  ['Chữ phụ trên nền trắng', 'n-700', 'white', 4.5],
  ['Chữ mờ trên nền trắng', 'n-600', 'white', 4.5],
  ['Chữ mờ trên nền app', 'n-600', 'bg', 4.5],
  ['Chữ mờ trên nền xám nhạt', 'n-600', 'n-100', 4.5],
  ['Chữ mờ trên nền xám đậm nhất', 'n-600', 'n-200', 4.5],

  ['Chữ trắng trên nút chính', 'white', 'blue-700', 4.5],
  ['Chữ trắng trên nút chính khi hover', 'white', 'blue-800', 4.5],
  ['Liên kết trên nền trắng', 'blue-700', 'white', 4.5],
  ['Liên kết trên nền app', 'blue-700', 'bg', 4.5],
  ['Chữ xanh trên nền tint', 'blue-800', 'blue-50', 4.5],
  ['Chữ xanh trên nền tint đậm', 'blue-800', 'blue-100', 4.5],

  ['Chữ trắng trên sidenav', 'white', 'navy', 4.5],
  ['Mục nav chưa chọn trên sidenav', 'n-300', 'navy', 4.5],
  ['Nhãn nhóm trên sidenav', 'n-400', 'navy', 4.5],
  ['Chữ phụ trên nền navy (opacity .78)', 'navy-muted', 'navy', 4.5],
  // Huy hieu tron tren nen navy o man dang nhap — do hoa mang nghia, nguong 3.0.
  ['Huy hiệu xanh dương trên navy', 'blue-600', 'navy', 3.0],
  ['Huy hiệu xanh lá trên navy', 'green-600', 'navy', 3.0],
  /*
   * Huy hieu thu ba tren man dang nhap phai dat CA HAI chieu, va rat it mau lam
   * duoc: `blue-800` chim vao navy (1.95:1), con `blue-400` du noi tren navy
   * (6.70:1) nhung icon trang tren no chi con 2.54:1. `blue-500` la mau duy
   * nhat trong thang qua ca hai nguong.
   */
  ['Huy hiệu thứ ba trên navy', 'blue-500', 'navy', 3.0],
  ['Icon trắng trong huy hiệu thứ ba', 'white', 'blue-500', 3.0],
  ['Icon trắng trong huy hiệu xanh dương', 'white', 'blue-600', 3.0],
  ['Icon trắng trong huy hiệu xanh lá', 'white', 'green-600', 3.0],
  ['Mục nav đang chọn', 'white', 'blue-600', 4.5],
  ['Mục nav đang chọn khi hover', 'white', 'blue-700', 4.5],
  // Cặp này đã TRƯỢT (2.54:1) khi đổi sidenav sang navy mà quên đổi màu chữ
  // thương hiệu. Giữ lại để không ai khôi phục nó.
  ['Nhấn trên sidenav — KHÔNG dùng blue-700', 'blue-300', 'navy', 4.5],

  ['Chữ trắng trên nút xác nhận', 'white', 'green-700', 4.5],
  ['Chữ trắng trên nút xác nhận khi hover', 'white', 'green-800', 4.5],
  ['Chữ thành công trên nền trắng', 'green-700', 'white', 4.5],
  ['Biểu tượng thành công trên tint (đồ hoạ)', 'green-600', 'green-50', 3.0],
  ['Chữ thành công trên nền tint', 'green-800', 'green-50', 4.5],
  ['Chữ thành công trên tint đậm', 'green-800', 'green-100', 4.5],

  ['Chữ trắng trên nút nguy hiểm', 'white', 'red-600', 4.5],
  ['Chữ lỗi trên nền tint', 'red-800', 'red-50', 4.5],
  ['Chữ lỗi trên tint đậm', 'red-800', 'red-100', 4.5],

  // Tím: tông phân loại của chip ký hiệu ca (ca đêm), không phải màu trạng thái.
  ['Chữ tím trên nền tint', 'violet-800', 'violet-50', 4.5],
  ['Chữ tím trên tint đậm', 'violet-800', 'violet-100', 4.5],
  ['Chữ tím nhạt hơn trên nền tint', 'violet-700', 'violet-50', 4.5],

  ['Chữ cảnh báo trên nền trắng', 'amber-700', 'white', 4.5],
  ['Chữ cảnh báo trên nền tint', 'amber-800', 'amber-50', 4.5],
  ['Chữ cảnh báo trên tint đậm', 'amber-800', 'amber-100', 4.5],

  ['Viền input trên nền trắng', 'n-500', 'white', 3.0],
  ['Vòng focus trên nền trắng', 'blue-700', 'white', 3.0],
  ['Vòng focus trên nền app', 'blue-700', 'bg', 3.0],
  ['Viền card trên nền app', 'n-300', 'bg', 1.3],

  ['Header bảng', 'n-700', 'n-100', 4.5],
  ['Dòng bảng đang chọn', 'n-900', 'blue-50', 4.5],
  ['Chữ tooltip', 'white', 'n-800', 4.5],
  ['Badge mặc định', 'n-900', 'n-200', 4.5],

  // ── Thẻ chỉ số (mockup `55:57`) ──────────────────────────────────────────
  //
  // Huy hiệu tròn: mực thang 700 trên nền thang 50. Đây là ĐỒ HOẠ MANG NGHĨA
  // (biểu tượng phân biệt thẻ này với thẻ kia), nên ngưỡng là 3.0 theo WCAG
  // 1.4.11 chứ không phải 4.5 — nhưng con số ngay bên cạnh là chữ thường trên
  // nền TRẮNG, và bốn dòng dưới canh đúng ngưỡng 4.5 cho nó.
  ['Huy hiệu xanh dương', 'blue-700', 'blue-50', 3.0],
  ['Huy hiệu xanh lá', 'green-700', 'green-50', 3.0],
  ['Huy hiệu vàng', 'amber-700', 'amber-50', 3.0],
  ['Huy hiệu đỏ', 'red-700', 'red-50', 3.0],

  ['Số liệu xanh dương trên thẻ', 'blue-700', 'white', 4.5],
  ['Số liệu xanh lá trên thẻ', 'green-700', 'white', 4.5],
  ['Số liệu vàng trên thẻ', 'amber-700', 'white', 4.5],
  ['Số liệu đỏ trên thẻ', 'red-700', 'white', 4.5],

  // Đường "đã tổng hợp" trên biểu đồ tiến độ — đồ hoạ mang nghĩa, nền trắng.
  ['Đường biểu đồ xanh lá', 'green-600', 'white', 3.0],
  // Đường mục tiêu nét đứt: CỐ Ý nhạt hơn để nó lùi về sau. Vẫn phải nhìn thấy,
  // nên giữ ngưỡng 1.5 — dưới mức đó thì nó biến mất chứ không phải lùi lại.
  ['Đường mục tiêu nét đứt', 'n-400', 'white', 1.5],

  // WCAG 1.4.3 miễn trừ control ở trạng thái vô hiệu, và miễn trừ đó CÓ LÝ: chữ
  // disabled tương phản bằng chữ thường thì nút trông như vẫn bấm được. Ngưỡng
  // 3.0 ở đây để nó vẫn đọc được, không phải để lách.
  ['Chữ disabled (miễn trừ 1.4.3)', 'n-500', 'n-200', 3.0],
];

const toLinear = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const failures = [];
for (const [label, fg, bg, need] of PAIRS) {
  const fgHex = RAMP[fg];
  const bgHex = RAMP[bg];
  if (!fgHex || !bgHex) {
    throw new Error(`Thiếu màu trong RAMP: ${!fgHex ? fg : bg}`);
  }
  const ratio = contrast(fgHex, bgHex);
  const ok = ratio >= need;
  if (!ok) failures.push({ label, fg, bg, ratio, need });
  console.log(
    `${ok ? '  ok  ' : ' TRƯỢT'} ${ratio.toFixed(2).padStart(5)} / ${need}  ${label}  (${fg} trên ${bg})`,
  );
}

console.log(`\n${PAIRS.length - failures.length}/${PAIRS.length} cặp đạt.`);

if (failures.length > 0) {
  console.error('\nCác cặp KHÔNG đạt — sửa thang màu trước khi commit:');
  for (const f of failures) {
    console.error(
      `  ${f.label}: ${f.ratio.toFixed(2)} < ${f.need}  (${RAMP[f.fg]} trên ${RAMP[f.bg]})`,
    );
  }
  process.exit(1);
}
