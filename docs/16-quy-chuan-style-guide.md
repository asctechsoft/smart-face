# 16 — Quy chuẩn Style Guide & Design System

> **Bản v2 — đã chốt quyết định thiết kế.**
> Nguồn gốc: Figma `Smart Face` (`COLgmXH63JZ2274UQhozCx`), node `233:120` + `234:430`, sửa lần cuối `2026-08-11T15:15:10Z`, đọc qua Figma REST API.
>
> Bản v1 chỉ *ghi lại* thiết kế và liệt kê 9 điểm mâu thuẫn. Bản v2 này **xử lý xong cả 9 điểm** và bổ sung những gì Figma còn thiếu (thang màu, trạng thái tương tác, chuyển động, chế độ tối). Đây là tài liệu để code theo — không còn câu hỏi mở.
>
> Mọi cặp màu trong tài liệu đã được **kiểm chứng WCAG bằng máy**: 52/52 cặp đạt ngưỡng, 0 lỗi.

---

## Nguyên tắc

Style guide chỉ có giá trị khi **không phải diễn giải lại**. Lập trình viên mở tài liệu này ra phải copy được token vào code mà không cần mở Figma, và không phải hỏi "hover màu gì".

Ba quy tắc chi phối toàn bộ bản v2:

1. **Không màu nào tồn tại ngoài thang màu.** Mọi màu phải là một bậc trong ramp ở mục 1. Đây là điều kiện để có hover/active/focus nhất quán — thiếu ramp thì mỗi màn hình lại chế ra một sắc thái mới, đúng như tình trạng của file Figma hiện tại.
2. **Không dùng màu có độ trong suốt (alpha) làm nền.** Nền `rgba()` đổi màu theo thứ nền phía sau, làm tương phản không dự đoán được. Thay bằng bậc đặc trong ramp.
3. **Mọi phần tử tương tác phải có đủ 5 trạng thái:** `rest` · `hover` · `active` · `focus-visible` · `disabled`. Thiếu một trạng thái là thiếu thiết kế.

Hệ này bám quy ước đặt tên của **Material Design 3** (`primary`, `on-surface`, `surface-container`). Giữ nguyên quy ước khi mở rộng.

---

## 0. Nhật ký quyết định — 9 vấn đề của bản v1 đã xử lý thế nào

| # | Vấn đề trong Figma | Quyết định | Lý do |
|---|---|---|---|
| 1 | `#BFC9C3` và `#BEC9C3` cùng làm màu viền | **Chốt `#BFC9C3`** = `neutral-300`. Xoá `#BEC9C3` | Dùng nhiều hơn (26 vs 16 lần) và là màu đã được đặt tên chính thức trong ô `bg-surface-container` |
| 2 | `#6F7974` và `#6F7A74` cùng làm màu chữ mờ | **Chốt `#6F7974`** = `neutral-500`. Xoá `#6F7A74` | Dùng nhiều hơn; rơi đúng bậc 500 của thang trung tính |
| 3 | Hai hệ nút mâu thuẫn (`#FFBD67`/r8/h36 vs `#FCAA33`/r12/h44+) | **Không phải hai hệ — là hai trạng thái của một nút.** `#FCAA33` = rest, `#FFBD67` = hover. Kích thước gộp thành 3 size `sm 36` / `md 44` / `lg 52` | Xem mục 0.1 — đây là quyết định quan trọng nhất của bản v2 |
| 4 | Ba sắc teal cùng vai trò (`#003B2C`, `#005440`, `#0F6E56`) | **`#005440` = nền khối teal** (`teal-700`); **`#003B2C` = chữ/viền teal** (`teal-900`). **Xoá `#0F6E56`** → dùng `teal-900` | `#0F6E56` xuất hiện đúng 1 lần ở 1 checkbox, trong khi checkbox nơi khác dùng `#003B2C` → lỗi vẽ |
| 5 | `#6B7280` (gray-500 của Tailwind) nằm ngoài hệ | **Đổi sang `neutral-500` `#6F7974`** | Đồng bộ hệ màu. Đánh đổi: 4.83:1 → 4.50:1, vẫn đạt AA |
| 6 | Plus Jakarta Sans được dùng nhưng không tài liệu hoá | **Giữ lại, chính thức hoá thành font hiển thị**, giới hạn đúng 3 vai trò ở mục 3.1 | Đã dùng có chủ đích cho tiêu đề trang và tên card; tạo tương phản phân cấp với Inter |
| 7 | Toast không có đổ bóng | **Thêm `shadow-lg`** | Toast là lớp nổi trên nội dung; mọi lớp nổi khác (drawer, modal, dropdown) đều đã có bóng |
| 8 | Badge "Present" chỉ đạt 3.91:1 — **không đạt WCAG AA** | **Đổi sang hệ badge dựa trên ramp**: nền bậc `100`, chữ bậc `800`. Badge success thành `#CAEFC9` + `#003F05` = **9.75:1** | Lỗi tiếp cận thật, hiện trên mọi dòng bảng nhân viên. Xem mục 11.7 |
| 9 | Thiếu focus ring, trạng thái input lỗi/disabled, breakpoint, chuyển động, z-index, chế độ tối | **Đã định nghĩa đầy đủ** ở các mục 5–8, 10, 12 | Không có thì mỗi lập trình viên tự chế |

### 0.1. Vì sao "hai hệ nút" thực ra là một

Bản v1 báo động rằng style guide và màn hình thật dùng hai hệ nút khác nhau. Đọc kỹ lại dữ liệu thì thấy:

- `#FCAA33` (amber-500) và `#FFBD67` (amber-400) **cách nhau đúng một bậc** trên thang màu.
- Chữ nâu `#6B4200` đặt trên amber-500 đạt **4.55:1** — vừa đủ AA.
- Cũng chữ đó đặt trên amber-400 đạt **5.29:1** — cao hơn.

Nghĩa là: nếu lấy amber-500 làm trạng thái nghỉ và amber-400 làm trạng thái hover thì **cả hai trạng thái đều đạt chuẩn**, và không phải phát minh thêm màu nào.

Đây cũng là cách duy nhất khả thi. Thử làm hover **tối đi** một bậc (amber-600 `#CF8922`) thì chữ nâu chỉ còn **3.02:1** — trượt AA. Muốn giữ hover tối thì phải đổi màu chữ sang `#3F2600`, tức là làm hỏng sắc nâu ấm của thương hiệu trên toàn bộ nút CTA.

> **Nút amber sáng lên khi rê chuột, không tối đi.** Trạng thái nhấn (`active`) không đổi màu mà dùng bóng lõm + dịch xuống 1px — chuyển động truyền đạt cú nhấn, không cần đến màu.

---

## 1. Thang màu (Tonal Ramp)

Nền tảng của toàn hệ. **16 màu gốc từ Figma được giữ nguyên tuyệt đối**, neo vào đúng bậc của nó (đánh dấu `▪`). Các bậc còn lại được nội suy trong không gian **OKLCH** để cách đều nhau về mặt thị giác — không phải trộn RGB thô.

### 1.1. Teal — màu thương hiệu

| Bậc | HEX | | Dùng cho |
|---|---|---|---|
| 50 | `#E4FEF4` | | Nền vùng nhấn rất nhẹ |
| 100 | `#D1F7E8` | | Nền badge teal, nền icon tròn |
| 200 | `#AEE5D1` | | Viền vùng nhấn, chữ teal trên nền tối |
| 300 | `#84CAB1` | | Nhấn trên nền tối (chế độ tối) |
| 400 | `#5EAD93` | | |
| 500 | `#398F75` | | |
| 600 | `#17725A` | | |
| **700** | **`#005440`** | ▪ | **Nền khối teal**, nút teal, thanh bulk action, header drawer, focus ring |
| 800 | `#004836` | | Hover của nút teal, chữ badge teal |
| **900** | **`#003B2C`** | ▪ | **Chữ và viền teal**, nút viền, checkbox đã chọn, active của nút teal |

### 1.2. Amber — màu hành động

| Bậc | HEX | | Dùng cho |
|---|---|---|---|
| 50 | `#FFF7DC` | | Nền vùng nhấn amber |
| 100 | `#FFF5CB` | | Nền badge amber |
| 200 | `#FFEAAD` | | |
| 300 | `#FFD284` | | |
| **400** | **`#FFBD67`** | ▪ | **Hover của nút amber** |
| **500** | **`#FCAA33`** | ▪ | **Nền nút CTA chính**, FAB, mục sidenav đang chọn |
| 600 | `#CF8922` | | ⚠ Không đặt chữ nâu lên bậc này (3.02:1) |
| 700 | `#A56600` | | |
| **800** | **`#774B00`** | ▪ | Chữ trên nền amber-400 |
| **900** | **`#6B4200`** | ▪ | **Chữ và icon trên mọi nền amber** |

### 1.3. Neutral — trung tính (ám xanh nhẹ)

| Bậc | HEX | | Dùng cho |
|---|---|---|---|
| **50** | **`#F8FAF9`** | ▪ | Nền trang, nền header modal, hover dòng bảng |
| **100** | **`#F2F4F3`** | ▪ | Nền sidenav, footer modal, thẻ chỉ số, hover nút phụ |
| **200** | **`#E1E3E2`** | ▪ | Nền nút disabled, active của nút phụ |
| **300** | **`#BFC9C3`** | ▪ | **Viền mặc định** của card, bảng, toast |
| 400 | `#99A09D` | | Icon mờ |
| **500** | **`#6F7974`** | ▪ | Chữ disabled, placeholder, **viền input** |
| 600 | `#59605D` | | |
| **700** | **`#3F4944`** | ▪ | **Chữ phụ** (màu dùng nhiều nhất trong hệ) |
| 800 | `#2D3230` | | Nền tooltip, nền nghịch đảo |
| **900** | **`#191C1C`** | ▪ | **Chữ chính** |

### 1.4. Màu trạng thái

| Bậc | Success | Warning | Error |
|---|---|---|---|
| 50 | `#E2FBE1` | `#FFF3DD` | `#FFE8E0` |
| 100 | `#CAEFC9` | `#FFE7C5` | `#FFD4C9` |
| 200 | `#A5DAA4` | `#FCD2A2` | `#FFB3A5` |
| 300 | `#7BBC7A` | `#E9B77A` | `#FF8A7B` |
| 400 | `#549D55` | `#D49D57` | `#FB6457` |
| 500 | **`#2E7D32`** ▪ | `#BB8236` | `#DC3E36` |
| 600 | `#18691F` | `#A16B1D` | **`#BA1A1A`** ▪ |
| 700 | `#00530D` | **`#855400`** ▪ | `#980001` |
| 800 | `#003F05` | `#643D00` | `#740000` |
| 900 | `#002A01` | `#442600` | `#500000` |

**Quy tắc dùng màu trạng thái:** nền tint = bậc `100`, chữ/icon trên tint = bậc `800`, icon trên nền trắng = bậc `600`–`700`, nút đặc = bậc `600` với chữ trắng.

---

## 2. Token ngữ nghĩa

Component **không bao giờ tham chiếu trực tiếp vào ramp**. Chúng chỉ dùng token ngữ nghĩa dưới đây. Đây là lớp cho phép đổi cả chế độ tối bằng cách thay 1 khối CSS.

```css
:root {
  /* ── Thang màu ─────────────────────────────────────── */
  --sf-teal-50:#E4FEF4;  --sf-teal-100:#D1F7E8; --sf-teal-200:#AEE5D1;
  --sf-teal-300:#84CAB1; --sf-teal-400:#5EAD93; --sf-teal-500:#398F75;
  --sf-teal-600:#17725A; --sf-teal-700:#005440; --sf-teal-800:#004836;
  --sf-teal-900:#003B2C;

  --sf-amber-50:#FFF7DC;  --sf-amber-100:#FFF5CB; --sf-amber-200:#FFEAAD;
  --sf-amber-300:#FFD284; --sf-amber-400:#FFBD67; --sf-amber-500:#FCAA33;
  --sf-amber-600:#CF8922; --sf-amber-700:#A56600; --sf-amber-800:#774B00;
  --sf-amber-900:#6B4200;

  --sf-neutral-50:#F8FAF9;  --sf-neutral-100:#F2F4F3; --sf-neutral-200:#E1E3E2;
  --sf-neutral-300:#BFC9C3; --sf-neutral-400:#99A09D; --sf-neutral-500:#6F7974;
  --sf-neutral-600:#59605D; --sf-neutral-700:#3F4944; --sf-neutral-800:#2D3230;
  --sf-neutral-900:#191C1C;

  --sf-success-50:#E2FBE1; --sf-success-100:#CAEFC9; --sf-success-600:#18691F;
  --sf-success-700:#00530D; --sf-success-800:#003F05;
  --sf-warning-50:#FFF3DD; --sf-warning-100:#FFE7C5; --sf-warning-700:#855400;
  --sf-warning-800:#643D00;
  --sf-error-50:#FFE8E0;   --sf-error-100:#FFD4C9;   --sf-error-600:#BA1A1A;
  --sf-error-700:#980001;  --sf-error-800:#740000;

  /* ── Bề mặt ────────────────────────────────────────── */
  --sf-surface:              #FFFFFF;
  --sf-surface-bright:       var(--sf-neutral-50);
  --sf-surface-container-low:var(--sf-neutral-100);
  --sf-surface-container:    var(--sf-neutral-200);
  --sf-surface-inverse:      var(--sf-neutral-800);

  /* ── Chữ ───────────────────────────────────────────── */
  --sf-on-surface:          var(--sf-neutral-900);
  --sf-on-surface-variant:  var(--sf-neutral-700);
  --sf-on-surface-muted:    var(--sf-neutral-500);
  --sf-on-surface-inverse:  var(--sf-neutral-50);

  /* ── Viền ──────────────────────────────────────────── */
  --sf-outline:         var(--sf-neutral-500);   /* viền input */
  --sf-outline-variant: var(--sf-neutral-300);   /* viền card, bảng */

  /* ── Thương hiệu ───────────────────────────────────── */
  --sf-primary:            var(--sf-teal-900);   /* chữ, viền */
  --sf-primary-surface:    var(--sf-teal-700);   /* nền khối */
  --sf-primary-surface-hover: var(--sf-teal-800);
  --sf-primary-tint:       var(--sf-teal-100);
  --sf-on-primary-surface: #FFFFFF;

  /* ── Hành động ─────────────────────────────────────── */
  --sf-action:        var(--sf-amber-500);
  --sf-action-hover:  var(--sf-amber-400);
  --sf-on-action:     var(--sf-amber-900);

  /* ── Trạng thái tương tác dùng chung ───────────────── */
  --sf-state-hover:    var(--sf-neutral-100);
  --sf-state-active:   var(--sf-neutral-200);
  --sf-state-disabled-bg:   var(--sf-neutral-200);
  --sf-state-disabled-text: var(--sf-neutral-500);
  --sf-focus-ring:     var(--sf-teal-700);
}
```

---

## 3. Chữ (Typography)

### 3.1. Hai bộ chữ, ranh giới rõ ràng

| Bộ chữ | Weight cần nạp | Dùng cho — **chỉ đúng 3 vai trò** |
|---|---|---|
| **Plus Jakarta Sans** | 600, 700 | ① Tiêu đề trang (`display-lg`) · ② Tên card lớn (`title-lg`) · ③ Logo văn bản trong sidenav |
| **Inter** | 400, 500, 600, 700 | **Tất cả phần còn lại** |

> Ranh giới này là quyết định của bản v2 (vấn đề #6). Trước đó Plus Jakarta Sans được dùng rải rác mà không có quy tắc. Ngoài 3 vai trò trên, **không dùng Plus Jakarta Sans**.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet">
```

> **Tiếng Việt:** cả hai bộ hỗ trợ đủ dấu. Khi self-host **bắt buộc nạp subset `vietnamese`**, nếu không dấu sẽ rơi về font hệ thống và lệch nét ngay giữa câu.

### 3.2. Thang chữ

| Token | Font | W | Size / LH | LS | Dùng cho |
|---|---|---|---|---|---|
| `display-lg` | Jakarta | 700 | 32 / 40 | −0.64 | Tiêu đề trang — màu `teal-700` |
| `headline-xl` | Inter | 700 | 40 / 48 | −0.8 | Tiêu đề lớn nhất (màn hình chào, báo cáo in) |
| `headline-md` | Inter | 600 | 24 / 32 | 0 | Tiêu đề section (H2), tiêu đề dialog xác nhận |
| `title-lg` | Jakarta | 600 | 20 / 28 | 0 | Tên card lớn |
| `title-md` | Inter | 600 | 20 / 28 | 0 | Tiêu đề modal, drawer, empty state |
| `title-sm` | Inter | 700 | 16 / 24 | 0 | Chữ nút `md`/`lg`, giá trị thẻ chỉ số |
| `body-lg` | Inter | 400 | 18 / 28 | 0 | Đoạn dẫn dưới tiêu đề trang |
| `body-md` | Inter | 400 | 16 / 24 | 0 | **Chữ chạy mặc định**, giá trị input |
| `body-sm` | Inter | 400 | 14 / 20 | 0 | Chữ phụ, mô tả, nhãn chip |
| `label-lg` | Inter | 600 | 14 / 20 | +0.7 | Chữ nút `sm`, tên người trong bảng |
| `label-lg-strong` | Inter | 700 | 14 / 20 | 0 | Tiêu đề toast, liên kết hành động |
| `field-label` | Inter | 600 | 13 / 18 | 0 | **Nhãn trường form và bộ lọc** (chữ thường) |
| `label-md` | Inter | 600 | 12 / 16 | +0.6 | Nhãn thẻ chỉ số, micro-label trong bảng (VIẾT HOA) |
| `label-md-caps` | Inter | 700 | 12 / 16 | +0.6 | Header bảng (VIẾT HOA) |
| `label-sm` | Inter | 500 | 12 / 16 | 0 | Chữ badge, nhãn nhỏ |
| `caption` | Inter | 400 | 10 / 15 | 0 | Dòng thời gian, chú thích |
| `badge` | Inter | 700 | 10 / 15 | +0.5 | Badge trạng thái (VIẾT HOA) |

### 3.3. Quy tắc

1. **Chữ càng to, giãn chữ càng âm.** 40px → −0.8 · 32px → −0.64 · ≤24px → 0 hoặc dương.
2. **Chữ nhỏ viết hoa bắt buộc giãn chữ dương.** 12px hoa → +0.6 · 10px hoa → +0.5. Viết hoa mà `letter-spacing: 0` là lỗi.
3. **Nhãn ô nhập KHÔNG viết hoa.** Tiếng Việt xếp dấu thanh và dấu mũ chồng lên nhau
   (`ữ`, `ắ`, `ề`); ở 12px viết hoa, phần dấu bị đẩy sát mép trên và chen vào dòng
   trước, đồng thời chữ in xoá mất hình dạng từ — thứ giúp mắt nhận ra "Phòng ban"
   mà không phải đọc từng chữ cái. Nhãn ô nhập là chỗ đọc sai thì điền sai, nên
   dùng `field-label` (13px chữ thường, màu `on-surface`).
   Chữ in vẫn giữ ở `label-md` cho **nhãn thẻ chỉ số** và **micro-label trong
   bảng**: chuỗi ngắn, đọc lướt, và ở đó chữ in giúp tách nhãn khỏi con số bên cạnh.
4. **Không có weight 800/900.** Thang dừng ở 700.
5. **Không tạo cỡ chữ mới.** Cần cỡ khác → dùng bậc gần nhất.
6. **Chữ mặc định `on-surface`, chữ phụ `on-surface-variant`.** `on-surface-muted` (`#6F7974`) **chỉ** dùng cho placeholder và chữ disabled — không dùng cho nội dung đọc được.

---

## 4. Khoảng cách, bo góc, viền

### 4.1. Khoảng cách — cơ sở 4px

| Token | Giá trị | Tần suất | Dùng cho |
|---|---|---|---|
| `space-1` | `4px` | 43 | Nhãn ↔ input, hai dòng chữ cùng khối |
| `space-2` | `8px` | 121 | Icon ↔ chữ, giữa các mục sidenav |
| `space-3` | `12px` | 61 | Padding input, giữa hai nút |
| `space-4` | `16px` | 106 | **Padding card / toast** |
| `space-6` | `24px` | 137 | **Padding modal / drawer / ô bảng** |
| `space-8` | `32px` | 15 | Giữa các nhóm trường trong panel |
| `space-10` | `40px` | 5 | |
| `space-12` | `48px` | 10 | Padding empty state |
| `space-16` | `64px` | 2 | Giữa các section cấp trang |

> Giá trị lẻ trong Figma (`20.5`, `23.25`, `28.5`…) là kết quả căn giữa của auto-layout, **không phải token** — không đưa vào code.

### 4.2. Bo góc

| Token | Giá trị | Dùng cho |
|---|---|---|
| `radius-xs` | `4px` | Checkbox, badge vuông, khối skeleton nhỏ |
| `radius-sm` | `8px` | Nút `sm`, select, dòng bảng dạng card, tooltip |
| `radius-md` | `12px` | **Card, input, toast, nút `md`/`lg`, thẻ chỉ số** |
| `radius-lg` | `16px` | Modal, drawer, panel lọc, FAB |
| `radius-full` | `9999px` | Avatar, chip/pill, radio, nút icon tròn |

Bo một phía: `8px 8px 0 0` (mặt trên) · `0 0 8px 8px` (mặt dưới) · `12px 12px 0 0` (bottom sheet mobile).

### 4.3. Độ dày viền

| Giá trị | Dùng cho |
|---|---|
| `1px` | **Mặc định** — card, input, bảng, toast, modal |
| `2px` | Nút viền, checkbox, radio, khung empty state, focus ring |
| `4px` | Vòng trắng quanh avatar trên nền teal của drawer |

---

## 5. Đổ bóng (Elevation)

Bốn cấp, trùng khớp thang `shadow-sm/md/lg/xl` mặc định của Tailwind.

| Token | CSS | Dùng cho |
|---|---|---|
| `shadow-xs` | `0 1px 2px 0 rgba(0,0,0,.05)` | Card có viền, nút hover, top bar |
| `shadow-md` | `0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)` | Nút nổi trên bản đồ, avatar drawer |
| `shadow-lg` | `0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)` | Drawer, panel lọc, bulk bar, bottom sheet, dropdown, **toast** |
| `shadow-xl` | `0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)` | Modal, FAB |

Modal còn dùng `backdrop-filter: blur(12px)` với nền `rgba(255,255,255,0.70)`.

> `shadow-lg` cho toast là bổ sung của bản v2 (vấn đề #7).

---

## 6. Chuyển động (Motion)

Figma không định nghĩa. Bản v2 chốt như sau:

| Token | Thời lượng | Đường cong | Dùng cho |
|---|---|---|---|
| `motion-instant` | `100ms` | `ease-out` | Đổi màu nền khi hover |
| `motion-fast` | `150ms` | `ease-out` | Hover, focus, đổi màu viền |
| `motion-base` | `200ms` | `cubic-bezier(.4,0,.2,1)` | Checkbox, radio, chip, mở dropdown |
| `motion-slow` | `250ms` | `cubic-bezier(.4,0,.2,1)` | Drawer trượt, modal mở, bottom sheet |
| `motion-skeleton` | `1500ms` | `ease-in-out`, lặp vô hạn | Shimmer của skeleton |

**Bắt buộc:** tôn trọng thiết lập giảm chuyển động của hệ điều hành.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 7. Thang z-index

Chỉ dùng các giá trị dưới đây. Không viết `z-index: 99999`.

| Token | Giá trị | Lớp |
|---|---|---|
| `z-base` | `0` | Nội dung trang |
| `z-sticky` | `100` | Header dính, header bảng |
| `z-dropdown` | `1000` | Select, menu, autocomplete |
| `z-overlay` | `1040` | Lớp phủ mờ sau modal/drawer |
| `z-modal` | `1050` | Modal, drawer, bottom sheet |
| `z-toast` | `1080` | Toast, thông báo |
| `z-tooltip` | `1100` | Tooltip, popover |

Bulk action bar dùng `z-sticky`; FAB dùng `z-sticky`.

---

## 8. Điểm ngắt (Breakpoint)

| Token | Từ | Bố cục |
|---|---|---|
| `sm` | `640px` | Mobile ngang |
| `md` | `768px` | Tablet dọc — sidenav thu thành icon |
| `lg` | `1024px` | Tablet ngang / laptop nhỏ — sidenav mở đầy đủ |
| `xl` | `1280px` | Desktop — bố cục chuẩn của thiết kế |
| `2xl` | `1536px` | Màn rộng — giới hạn bề rộng nội dung `1440px` |

**Quy tắc chuyển đổi bố cục:**
- `< md`: sidenav ẩn hoàn toàn, mở bằng nút hamburger dưới dạng drawer trượt.
- `< lg`: bảng chuyển sang dạng card xếp dọc (dùng "dòng bảng dạng card" ở mục 11.10), drawer chiếm toàn bộ bề rộng.
- `< md`: modal chiếm toàn màn hình, bo góc về `0`.

**Kích thước khung cố định** (token trong `tokens.css`):

| Token | Giá trị | Ghi chú |
|---|---|---|
| `--sf-sidenav-width` | `256px` | |
| `--sf-topbar-height` | `56px` | Chứa hai dòng: tên trang (`title-sm`) + ngày (`caption`) |
| `--sf-content-max-width` | `1440px` | Áp từ `2xl` |

⚠ Chiều cao thanh trên cùng đi theo nhịp control ở mục 11.1. Đổi `controlHeight`
thì xem lại con số này — thanh 64px trên nền control 32px trông rỗng ở giữa.

---

## 9. Biểu tượng (Icons)

Bộ **Material Symbols** (tên trong Figma là tên chuẩn của bộ này).

| Icon | Ý nghĩa trong SmartFace |
|---|---|
| `home` | Trang chủ / Dashboard |
| `event_available` | Chấm công / lịch làm việc |
| `assignment` | Đơn từ, biểu mẫu |
| `person` | Hồ sơ cá nhân |
| `group` | Danh sách nhân viên |
| `monitoring` | Báo cáo, biểu đồ |

| Size | Dùng ở đâu |
|---|---|
| `16px` | Icon trong chữ, mũi tên nhỏ |
| `18px` | Sidenav, FAB |
| `20px` | Toast, card mobile, icon trong nút |
| `24px` | Dropdown, icon trong input, nút icon độc lập |
| `32px` | Empty state (trong vòng tròn 64px) |

**Màu icon:** mặc định `on-surface-variant`; trên nền amber → `amber-900`; theo trạng thái → `success-600` / `warning-700` / `error-600`; mờ → `neutral-400`.

> Icon **chỉ trang trí** phải có `aria-hidden="true"`. Icon **mang nghĩa** (nút chỉ có icon) phải có `aria-label`.

---

## 10. Trạng thái tương tác — quy tắc dùng chung

Áp dụng cho **mọi** component, trừ khi mục 11 ghi đè.

| Trạng thái | Quy tắc |
|---|---|
| `hover` | Nền tối thêm một bậc, **trừ nút amber — sáng lên một bậc** (xem 0.1) |
| `active` | Nền tối thêm một bậc nữa; nút amber giữ nguyên màu + `inset 0 2px 4px rgba(0,0,0,.15)` + `translateY(1px)` |
| `focus-visible` | `outline: 2px solid var(--sf-focus-ring); outline-offset: 2px` |
| `disabled` | Nền `neutral-200`, chữ `neutral-500`, `cursor: not-allowed`, bỏ mọi bóng, `pointer-events: none` |

### 10.1. Focus ring

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--sf-focus-ring);   /* #005440 — 8.97:1 trên nền trắng */
  outline-offset: 2px;
  border-radius: inherit;
}
/* Trên nền teal hoặc nền tối, đổi sang vòng trắng */
.on-dark :where(a, button, input, [tabindex]):focus-visible {
  outline-color: #FFFFFF;
}
```

Dùng `:focus-visible` chứ **không** dùng `:focus` — tránh hiện vòng focus khi bấm chuột.
**Cấm tuyệt đối `outline: none`** nếu không thay bằng chỉ dấu focus khác rõ ràng hơn.

### 10.2. Vùng chạm

Mọi phần tử tương tác trên **thiết bị cảm ứng** phải có vùng chạm **≥ 44 × 44px**.

Ranh giới là **thiết bị trỏ**, không phải bề rộng màn hình: `@media (pointer: coarse)`
trong `components.css` nâng toàn bộ control lên `44px`, còn trên desktop chúng giữ
mật độ gọn ở mục 11.1. Một tablet 1024px nằm ngang rộng hơn cả laptop nhỏ nhưng
vẫn bấm bằng ngón tay, nên breakpoint bề rộng phân loại sai đúng nhóm thiết bị
cần được bảo vệ nhất.

Phần tử nhìn nhỏ hơn thì mở rộng bằng pseudo-element trong suốt:

```css
.sf-touch-target { position: relative; }
.sf-touch-target::after {
  content: ''; position: absolute; inset: 50% auto auto 50%;
  width: 44px; height: 44px; transform: translate(-50%, -50%);
}
```

Bắt buộc áp dụng cho: checkbox `24px`, radio `24px`, **nút đóng toast `8px`** (vi phạm nặng nhất trong thiết kế hiện tại), nút đóng modal.

---

## 11. Thư viện Component

### 11.1. Nút (Button) — hệ đã hợp nhất

**Ba kích thước:**

| Size | Cao (con trỏ) | Cao (cảm ứng) | Padding ngang | Radius | Chữ |
|---|---|---|---|---|---|
| `sm` | `28px` | `40px` | `12px` | `6px` | Inter 600/13, +0.5 |
| `md` | `32px` | `44px` | `16px` | `8px` | Inter 700/14 |
| `lg` | `40px` | `44px` | `20px` | `8px` | Inter 700/14 |

> `md` là mặc định — **kể cả nút trong modal và drawer**. `sm` chỉ dùng trong
> bảng và thanh công cụ. `lg` chỉ dùng cho nút CTA chiếm trọn chiều ngang ở màn
> xác thực; **không dùng ở cấp trang, không dùng trong hộp thoại**.
>
> Hộp thoại không cần nút to hơn để được chú ý — nó đã chiếm trọn màn hình rồi.
> Nút `40px` giữa một trang toàn control `32px` chỉ làm hộp thoại trông như thuộc
> về một sản phẩm khác, và đây lại đúng là chỗ người dùng đang nhìn.

**Hai cột chiều cao là có chủ đích.** Đây là công cụ quản trị dùng trên desktop,
màn hình đặc dữ liệu: một thanh lọc bốn ô cộng một bảng hai mươi dòng. Ở mật độ
đó, control `44px` đẩy nội dung thật xuống dưới nếp gấp.

Nhưng ngón tay không trỏ chính xác như chuột. Vì vậy `components.css` có khối
`@media (pointer: coarse)` nâng mọi control lên `44px` khi thiết bị nhập là ngón
tay — giữ đúng sàn vùng chạm ở mục 10.2 và yêu cầu dùng được trên tablet ở
docs/04 mục 12.4.

Dùng `pointer: coarse` chứ **không** dùng breakpoint bề rộng: một tablet 1024px
nằm ngang rộng hơn cả laptop nhỏ nhưng vẫn bấm bằng ngón tay. Bề rộng màn hình
không nói gì về thiết bị trỏ.

**Sáu biến thể** (mọi ô đều đã kiểm chứng tương phản):

| Biến thể | Rest | Hover | Active | Chữ | Disabled |
|---|---|---|---|---|---|
| **Primary** (amber) | `amber-500` | `amber-400` | `amber-500` + bóng lõm | `amber-900` — 4.55:1 | nền `neutral-200`, chữ `neutral-500` |
| **Primary teal** (đặc) | `teal-700` | `teal-800` | `teal-900` | `#FFFFFF` — 8.97:1 | như trên |
| **Secondary** (viền) | trong suốt, viền `2px teal-900` | nền `neutral-100` | nền `neutral-200` | `teal-900` — 12.64:1 | viền `neutral-300`, chữ `neutral-500` |
| **Tertiary** (chữ) | trong suốt | nền `neutral-100` | nền `neutral-200` | `teal-900` | chữ `neutral-500` |
| **Destructive** | `error-600` | `error-700` | `error-800` | `#FFFFFF` — 6.46:1 | như trên |
| **Destructive ghost** | trong suốt | nền `error-50` | nền `error-100` | `error-700` — 8.99:1 | chữ `neutral-500` |

```css
.sf-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: Inter, sans-serif; border: none; cursor: pointer;
  transition: background-color 150ms ease-out, box-shadow 150ms ease-out, transform 100ms ease-out;
}
.sf-btn--md { height: 44px; padding-inline: 24px; border-radius: 12px;
              font-size: 16px; font-weight: 700; line-height: 24px; }

.sf-btn--primary { background: var(--sf-amber-500); color: var(--sf-amber-900);
                   box-shadow: 0 1px 2px 0 rgba(0,0,0,.05); }
.sf-btn--primary:hover  { background: var(--sf-amber-400); }   /* SÁNG LÊN */
.sf-btn--primary:active { background: var(--sf-amber-500);
                          box-shadow: inset 0 2px 4px rgba(0,0,0,.15);
                          transform: translateY(1px); }
.sf-btn:disabled { background: var(--sf-neutral-200); color: var(--sf-neutral-500);
                   box-shadow: none; cursor: not-allowed; transform: none; }
```

**Nút có icon:** icon `20px`, khoảng cách icon ↔ chữ `8px`. **Nút chỉ có icon:** vuông theo chiều cao của size (`44 × 44` cho `md`), `radius-full`, bắt buộc có `aria-label`.

### 11.2. Checkbox

`24 × 24`, `radius-xs`, viền `2px`, khoảng cách tới nhãn `8px`. Nhãn `body-md`.

| Trạng thái | Nền | Viền | Icon |
|---|---|---|---|
| Rest | trong suốt | `neutral-500` | — |
| Hover | `neutral-100` | `neutral-700` | — |
| Checked | `teal-900` | `teal-900` | dấu tích trắng |
| Checked + hover | `teal-800` | `teal-800` | dấu tích trắng |
| Indeterminate | `teal-900` | `teal-900` | gạch ngang trắng |
| Disabled | `neutral-200` | `neutral-300` | — |
| Disabled + checked | `neutral-300` | `neutral-300` | dấu tích `neutral-500` |

Checkbox nhỏ trong bảng: `16 × 16`, viền `1px`, bọc vùng chạm `44 × 44`.

> Bản v1 ghi nhận một checkbox dùng `#0F6E56`. Đã xoá — mọi checkbox dùng `teal-900`.

### 11.3. Radio

`24 × 24`, `radius-full`, viền `2px`. Trạng thái giống checkbox, riêng `checked` là **viền `teal-900` + chấm tròn `teal-900` đường kính `12px` ở giữa**, nền vẫn trong suốt.

### 11.4. Select

| Trạng thái | Nền | Viền | Radius |
|---|---|---|---|
| Đóng | `#FFFFFF` | `1px neutral-300` | `8px` |
| Hover | `#FFFFFF` | `1px neutral-500` | `8px` |
| Mở / focus | `#FFFFFF` | `1px teal-900` + ring `3px teal-100` | `8px` |
| Disabled | `neutral-200` | `1px neutral-300` | `8px` |

Cao `42px`, padding `8px 12px`. Dropdown: nền trắng, viền `1px neutral-300`, `radius-sm`, `shadow-lg`, `z-dropdown`.
Mục trong dropdown: cao `40px`, hover `neutral-100`, mục đang chọn nền `teal-100` + chữ `teal-900`.

### 11.5. Input

| Trạng thái | Nền | Viền | Chữ |
|---|---|---|---|
| Rest | `#FFFFFF` | `1px neutral-500` | `on-surface` |
| Hover | `#FFFFFF` | `1px neutral-700` | `on-surface` |
| Focus | `#FFFFFF` | `1px teal-900` + `box-shadow: 0 0 0 3px var(--sf-teal-100)` | `on-surface` |
| **Lỗi** | `#FFFFFF` | `1px error-600` + ring `3px error-50` | `on-surface` |
| Disabled | `neutral-200` | `1px neutral-300` | `neutral-500` |
| Readonly | `neutral-100` | `1px neutral-300` | `on-surface-variant` |

Cao `32px` (cảm ứng: `44px`), radius `8px`, padding `4px 12px` (có icon: `4px 40px`). Chữ trong ô `14px` — chữ chạy `16px` của mục 3.2 là cho đoạn văn, nhét vào control `32px` chỉ còn 3px đệm.
Nhãn phía trên: `field-label` chữ thường `on-surface`, cách input `4px` — xem quy tắc 3 ở mục 3.3.
Placeholder: `body-md` `neutral-500`.
**Chữ báo lỗi:** `body-sm` màu `error-700` (8.99:1), đặt dưới input cách `4px`, kèm icon `error` `16px`.

```html
<div class="sf-field">
  <label class="sf-label" for="fullname">HỌ VÀ TÊN</label>
  <input id="fullname" class="sf-input sf-input--error"
         aria-invalid="true" aria-describedby="fullname-err">
  <p id="fullname-err" class="sf-error-text" role="alert">
    Họ và tên không được để trống.
  </p>
</div>
```

> `aria-invalid` và `aria-describedby` là **bắt buộc** — không có thì trình đọc màn hình không đọc được lỗi.

### 11.6. Chip / Pill lọc

`radius-full`, padding `6px 14px`, cao `32px` (cảm ứng: `44px`), chữ `body-sm`.

| Trạng thái | Nền | Viền | Chữ |
|---|---|---|---|
| Bỏ chọn | trong suốt | `1px neutral-500` | `on-surface` |
| Bỏ chọn + hover | `neutral-100` | `1px neutral-700` | `on-surface` |
| Đã chọn | `teal-700` | `1px teal-700` | `#FFFFFF` — 8.97:1 |
| Đã chọn + hover | `teal-800` | `1px teal-800` | `#FFFFFF` |
| Disabled | `neutral-200` | `1px neutral-300` | `neutral-500` |

Chip là nút chuyển trạng thái → dùng `<button role="switch" aria-checked>` hoặc `<input type="checkbox">` ẩn, **không dùng `<div>`**.

### 11.7. Badge trạng thái — đã sửa lỗi tiếp cận

> Đây là thay đổi bắt buộc (vấn đề #8). Badge cũ dùng nền trong suốt `rgba(46,125,50,0.20)` với chữ `#2E7D32` — chỉ **3.91:1**, không đạt AA ở cỡ 12px. Badge mới dùng **bậc đặc của ramp**, đạt 9.75:1.

| Loại | Nền | Chữ | Tương phản | Ví dụ |
|---|---|---|---|---|
| Success | `success-100` `#CAEFC9` | `success-800` `#003F05` | **9.75:1** | "Đúng giờ", "Present" |
| Warning | `warning-100` `#FFE7C5` | `warning-800` `#643D00` | **7.92:1** | "Đi muộn" |
| Error | `error-100` `#FFD4C9` | `error-800` `#740000` | **8.90:1** | "Vắng mặt" |
| Teal | `teal-100` `#D1F7E8` | `teal-800` `#004836` | **9.18:1** | "Đang xử lý" |
| Neutral | `neutral-200` `#E1E3E2` | `neutral-900` `#191C1C` | **13.30:1** | "ACTIVE", "Nháp" |

Radius `radius-full`, padding `4px 8px`, chữ `label-sm`. Biến thể vuông (`radius-xs`) dùng cho badge VIẾT HOA cỡ `badge` (10px).

**Biến thể mềm** cho bảng dày đặc — nền bậc `50`, chữ bậc `700`: success 8.52:1 · warning 5.85:1 · error 7.65:1. Vẫn đạt AA.

### 11.8. Avatar

| Size | Radius | Dùng ở đâu |
|---|---|---|
| `32px` | `full` | Trong dòng bảng — nền `teal-700`, chữ viết tắt **`#FFFFFF`** `label-lg` |
| `40px` | `full` | Danh sách, skeleton |
| `64px` | `full` | Icon tròn empty state — nền `neutral-200` |
| `96px` | `full` | Ô upload ảnh — nền `neutral-200`, viền `2px neutral-500` |
| `96px` | `16px` | Ảnh trong drawer — viền `4px #FFFFFF`, `shadow-md` |

> Chữ viết tắt đổi từ `#82C6AD` (4.54:1 — vừa sát ngưỡng) sang `#FFFFFF` (**8.97:1**). Biên an toàn lớn hơn nhiều mà không đổi màu nền.

### 11.9. Card

Nền `surface`, viền `1px outline-variant`, `radius-md`, padding `16px`, `shadow-xs`, gap trong `8px`.
Card bấm được: hover → `shadow-md` + viền `neutral-500`; phải là `<button>` hoặc `<a>`.

**Thẻ chỉ số:** nền `neutral-100`, `radius-md`, padding `12px`, gap `4px`; nhãn `label-md` `on-surface-variant`, giá trị `title-sm` màu `teal-700` (8.12:1) hoặc `warning-700` (5.82:1).

### 11.10. Bảng

| Phần | Thông số |
|---|---|
| Header | Nền `neutral-100`, cao `40px`, chữ `label-md-caps` `on-surface-variant`, `position: sticky`, `z-sticky` |
| Ô header | Padding `12px 24px` |
| Dòng | Cao `74px`, viền dưới `1px outline-variant` |
| Dòng hover | Nền `neutral-50` |
| Dòng đã chọn | Nền `teal-50`, viền trái `2px teal-700` |
| Ô | Padding ngang `24px` (cột số: `48px`, căn phải) |
| Cột checkbox | Rộng `64px` |

**Dòng dạng card** (dùng dưới breakpoint `lg`): nền `surface`, viền `1px outline-variant`, `radius-sm`, padding `8px`.

Bắt buộc dùng `<table>` thật với `<th scope="col">`, không dùng `<div>` giả bảng.

#### Bậc mật độ

| Bậc | Padding ô | Dùng khi |
|---|---|---|
| Mặc định | `16px 24px` | Bảng dữ liệu cấp trang — chấm công, nhân viên, đơn từ |
| `size="small"` | `8px 16px` | Bảng **tra cứu** (ma trận phân quyền) và bảng **xem trước** trong modal |

Bậc dày đặc siết theo **chiều dọc** là chính (`16px → 8px`). Đệm ngang chỉ hạ `24px → 16px` chứ không hạ sâu hơn: cột hẹp lại thì bảng buộc phải cuộn ngang, mà cuộn ngang mới là thứ giết khả năng đọc của một bảng tra cứu.

> ⚠ **Cả ba bậc phải khai đủ trong theme** (`cellPaddingInline`, `cellPaddingInlineMD`, `cellPaddingInlineSM` và ba token `Block` tương ứng). Ant Design **không** suy các bậc từ nhau: bỏ trống bậc nào thì bậc đó rơi về mặc định `8px` của thư viện, tức đệm ngang chỉ bằng **một phần ba** bảng bên cạnh. Lỗi này không hiện ở đâu cả cho tới khi có người đặt hai bảng khác `size` lên cùng một trang và nhìn thấy chúng lệch nhịp.
>
> Kèm theo: luật `padding-block` của header trong `global.css` dùng `!important` (để header 40px thay vì 48px) nên nó **đè cả bậc dày đặc**. Vì vậy có luật riêng cho `.ant-table-small`. Sửa một trong hai chỗ thì phải xem lại chỗ kia — nếu không, header sẽ dày hơn chính dòng dữ liệu bên dưới.

### 11.11. Skeleton

Dùng gradient chạy ngang, chu kỳ `motion-skeleton` (1500ms).

| Khối | Kích thước | Radius |
|---|---|---|
| Avatar | `40 × 40` | `full` |
| Dòng chữ | `80 × 16` | `xs` |
| Badge | `64 × 24` | `full` |
| Nút | `32 × 32` | `full` |

```css
.sf-skeleton {
  background: linear-gradient(90deg,
    var(--sf-neutral-200) 25%, var(--sf-neutral-100) 50%, var(--sf-neutral-200) 75%);
  background-size: 200% 100%;
  animation: sf-shimmer 1500ms ease-in-out infinite;
}
@keyframes sf-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
```

Vùng skeleton phải có `aria-busy="true"` và `aria-live="polite"`.

### 11.12. Toast

Khung chung: nền `surface`, `radius-md`, padding `16px`, gap `16px`, rộng `299px`, **`shadow-lg`**, `z-toast`.
Phân biệt bằng viền `1px` + màu icon:

| Loại | Viền + icon | Tự đóng |
|---|---|---|
| Success | `success-600` `#18691F` | `4s` |
| Warning | `warning-700` `#855400` | `6s` |
| Error | `error-600` `#BA1A1A` | **không tự đóng** |

Tiêu đề `label-lg-strong` `on-surface`; nội dung `body-sm` `on-surface-variant`; icon `20px`; nút đóng icon `16px` trong **vùng chạm `44 × 44`**.

Container toast phải có `role="status"` (success/warning) hoặc `role="alert"` (error). Dừng đếm giờ tự đóng khi người dùng rê chuột vào hoặc focus vào toast.

### 11.13. Modal / Dialog

| Phần | Thông số |
|---|---|
| Lớp phủ | `rgba(25,28,28,.45)`, `z-overlay` |
| Khung | Nền `rgba(255,255,255,.70)` + `backdrop-filter: blur(12px)`, viền `1px outline-variant`, `radius-lg`, `shadow-xl`, `z-modal` |
| Header | Nền `surface-bright`, viền dưới `1px outline-variant`, padding `16px 24px` |
| Tiêu đề | `title-md` |
| Mô tả | `body-sm` `on-surface-variant` |
| Nút đóng | `44 × 44`, `radius-full`, icon `20px`, hover nền `neutral-100` |
| Thân | Padding `24px` |
| Footer | Nền `neutral-100`, viền trên `1px outline-variant`, padding `16px 24px`, gap `12px`, nút căn phải, nút cỡ `md` |

> ⚠ **Khung phải có `padding: 0`; đệm thuộc về từng phần.** Mặc định của Ant
> Design là đặt padding trên `.ant-modal-content`, còn header và footer là con
> nằm bên trong lớp padding đó — nên nền của chúng không chạm được mép hộp
> thoại. Kết quả là dải nền xám của footer nổi lơ lửng giữa một viền trắng, bốn
> góc vuông chọi với bo góc `16px` của khung. Đây là lỗi thuần thị giác, không
> có cách nào phát hiện ngoài việc mở hộp thoại lên nhìn.

**Dialog xác nhận (nhỏ):** nền `surface` đặc (không blur), viền `1px outline-variant`, `radius-md`, padding `16px`, `shadow-lg`, tiêu đề `headline-md` `teal-900`.

Bắt buộc: `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, **bẫy focus** trong modal, `Esc` để đóng, trả focus về phần tử đã mở modal khi đóng.

#### Chiều cao: luôn vừa khung hình

| Phần | Cách co giãn |
|---|---|
| Khung | `max-height: calc(100vh - 48px)`, `max-width: calc(100vw - 32px)`, cách mép trên `24px` |
| Header | **đứng yên** (`flex: 0 0 auto`) |
| Thân | **cuộn** (`flex: 1 1 auto` + `min-height: 0` + `overflow-y: auto`) |
| Footer | **đứng yên** (`flex: 0 0 auto`) |

Hộp thoại **không bao giờ được làm trang phía sau cuộn**. Nội dung dài thì cuộn bên trong phần thân, còn tiêu đề và hàng nút phải luôn nhìn thấy được. Ba lý do, theo thứ tự nặng dần:

1. Tiêu đề trôi khỏi màn hình → mất ngữ cảnh đang làm gì
2. Nút chính nằm dưới nếp gấp → hộp thoại trông như **không có nút bấm**
3. Cuộn trong hộp thoại và cuộn trang lẫn vào nhau

> ⚠ **`min-height: 0` trên phần thân là mảnh không được bỏ.** Mục flex mặc định là `min-height: auto`, nghĩa là nó **từ chối** co nhỏ hơn nội dung bên trong. Thiếu dòng đó thì `overflow-y: auto` không bao giờ kích hoạt: thân cứ nở ra, phá `max-height` của khung, và mọi thứ quay lại y như chưa sửa gì. Đây là lỗi CSS im lặng điển hình — không cảnh báo, không lỗi, chỉ là luật của bạn dường như bị bỏ qua.
>
> Luật áp ở `global.css` cho **mọi** `Modal` của Ant Design, dùng đặc thù cao hơn (`.ant-modal-root ...`) chứ không dùng `!important`, để màn hình nào cần vẫn ghi đè được bằng `styles={{ body: ... }}`. `Modal` viết riêng ở `components/ui/Modal.tsx` đã theo đúng khuôn này sẵn.

### 11.14. Drawer

Rộng `299px` (dưới `lg`: `100%`), nền `surface`, viền `1px outline-variant`, `radius-lg`, `shadow-lg`, `z-modal`.
Trượt vào bằng `motion-slow`.

- **Header có ảnh:** dải nền `teal-700` cao `128px`, avatar `96 × 96` `radius-lg` viền `4px #FFFFFF` đè lên.
- **Header dạng chữ:** viền dưới `1px outline-variant`, padding `24px`, tiêu đề `title-md`.
- **Thân:** padding `24px`, gap giữa các nhóm `24px`.

Yêu cầu tiếp cận giống modal.

### 11.15. Sidenav

Rộng `256px`, nền `neutral-100`, padding `16px 12px`, cách nhau giữa các nhóm `16px`.
Logo `title-lg` (Jakarta 700/20) `teal-700`; phụ đề `label-md` `on-surface-variant`.

Mục nav: cao **`36px`** (cảm ứng: `44px`), `radius-sm`, padding `8px 12px`,
gap icon–chữ `10px`, cách nhau `2px` (cảm ứng: `4px`). Chữ `body-sm` (14px).

| Trạng thái | Nền | Chữ + icon |
|---|---|---|
| Thường | trong suốt | `on-surface-variant`, `body-sm` |
| Hover | `neutral-200` | `on-surface`, `body-sm` |
| **Active** | `amber-500` | `amber-900`, Inter 700/14 — 4.55:1 |
| Active + hover | `amber-400` | `amber-900` — 5.29:1 |

**Vì sao mục nav không cao 48px như control là 32px.** Mục đang chọn được tô nền
`amber-500` đặc, nên nó là **khối màu lớn nhất trên toàn màn hình**. Ở `48px` với
chữ 16px, khối đó nặng hơn cả tiêu đề trang và kéo mắt về phía thanh điều hướng —
trong khi điều hướng là thứ người dùng nhìn một lần rồi thôi, còn dữ liệu mới là
thứ họ ở lại với nó. `36px` giữ được sự hiện diện của mục đang chọn mà không
tranh chấp với nội dung.

⚠ **Vị trí khối `@media (pointer: coarse)` của sidenav.** Nó nằm ở cuối
`global.css`, KHÔNG nằm cùng các control khác trong `components.css`. Lý do:
`components.css` được `@import` ở đầu `global.css`, nên luật của nó đứng trước
trong thứ tự nguồn; media query không cộng thêm đặc thù, nên `.sf-nav-item` 36px
sẽ thắng và phần nâng vùng chạm im lặng vô tác dụng — lỗi chỉ lộ ra khi cầm
tablet lên thử.

Dùng `<nav>` + `<ul>`; mục đang mở có `aria-current="page"`.

**Menu thả xuống** (`Dropdown` của Ant Design, dùng cho menu thao tác trên dòng
bảng và menu tài khoản) theo nhịp control chứ không theo nhịp sidenav: cao
`32px`, chữ 14px, `radius-xs`.

### 11.16. FAB

`64 × 64`, nền `amber-500`, `radius-lg`, icon `18px` `amber-900`, `shadow-xl`.
Hover `amber-400` + `shadow-xl`; active thêm bóng lõm + `translateY(1px)`.
Tooltip: nền `surface-inverse` `#2D3230`, `radius-sm`, padding `6px 12px`, chữ `body-sm` `on-surface-inverse` `#F8FAF9` — 12.44:1.

### 11.17. Bulk Action Bar

Nền `teal-700`, `radius-sm`, cao `56px`, padding `12px 24px`, `shadow-lg`.
Chữ đếm `body-md` `#FFFFFF`; phân cách dọc `1 × 16px` `rgba(255,255,255,.20)`; nút hành động là chữ trần `label-lg` `#FFFFFF` (hover: gạch chân); nút phá huỷ nền `error-600`, `radius-sm`, `6px 16px`.

Thanh này xuất hiện/biến mất bằng `motion-base`; phải có `aria-live="polite"` thông báo số dòng đã chọn.

### 11.18. Empty State

Khung nền `neutral-100`, viền `2px outline-variant` **nét liền**, `radius-md`, padding `48px`.
Icon `32px` `neutral-400` trong vòng tròn `64px` nền `neutral-200`.
Tiêu đề `title-md`; mô tả `body-md` `on-surface-variant` tối đa 3 dòng; nút CTA `Primary md`.

### 11.19. Component mobile

| Component | Thông số |
|---|---|
| **Card thông báo** | Nền `surface`, viền `1px outline-variant`, `radius-md`, padding `16px`, gap `8px`; tiêu đề `label-lg`, icon trạng thái `20px` bên phải |
| **Bottom Sheet** | Radius trên `12px 12px 0 0`, `shadow-lg`, thanh kéo `32 × 4` `neutral-300` ở giữa mép trên, tiêu đề `title-md`, mục hành động cao `48px` có icon dẫn |

### 11.20. Danh sách thông báo

| Trạng thái | Nền | Dấu hiệu |
|---|---|---|
| Chưa đọc | `teal-50` | Viền trái `2px teal-700` |
| Đã đọc | trong suốt | Viền dưới `1px outline-variant` |
| Hover | `neutral-50` | |

Icon tròn `32px`: nền `teal-100` (thường) hoặc `warning-100` (cảnh báo), icon bậc `800`.
Nội dung `body-sm` `on-surface`; thời gian `caption` `on-surface-variant`.

> Nền tint đổi từ `rgba(0,84,64,.05)` sang bậc đặc `teal-50`, theo nguyên tắc số 2 ở đầu tài liệu.

---

## 12. Chế độ tối

Đã kiểm chứng tương phản (12/12 cặp đạt). **Chưa bắt buộc triển khai ở giai đoạn 1**, nhưng nếu code bằng token ngữ nghĩa ở mục 2 ngay từ đầu thì bật chế độ tối sau này chỉ là thêm khối CSS dưới đây — gần như miễn phí. Code bằng HEX cứng thì phải làm lại toàn bộ.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --sf-surface:               #121615;
    --sf-surface-bright:        var(--sf-neutral-900);
    --sf-surface-container-low: var(--sf-neutral-800);
    --sf-surface-container:     #363C39;
    --sf-surface-inverse:       var(--sf-neutral-100);

    --sf-on-surface:         var(--sf-neutral-50);    /* 17.40:1 */
    --sf-on-surface-variant: var(--sf-neutral-300);   /* 10.73:1 */
    --sf-on-surface-muted:   var(--sf-neutral-400);
    --sf-on-surface-inverse: var(--sf-neutral-900);

    --sf-outline:         var(--sf-neutral-500);      /*  4.05:1 */
    --sf-outline-variant: var(--sf-neutral-600);

    --sf-primary:            var(--sf-teal-300);      /*  9.61:1 */
    --sf-primary-surface:    var(--sf-teal-800);
    --sf-primary-surface-hover: var(--sf-teal-700);
    --sf-primary-tint:       #1A2E28;

    --sf-action:       var(--sf-amber-400);           /* 11.05:1 */
    --sf-action-hover: var(--sf-amber-300);
    --sf-on-action:    var(--sf-amber-900);           /*  5.29:1 */

    --sf-state-hover:  var(--sf-neutral-800);
    --sf-state-active: #363C39;
    --sf-focus-ring:   var(--sf-teal-300);
  }
}
```

**Màu trạng thái ở chế độ tối** dùng bậc `300`: success `#7BBC7A` (8.09:1) · warning `#E9B77A` (10.01:1) · error `#FF8A7B` (7.97:1).
Badge chế độ tối: nền bậc `900`, chữ bậc `200`.
**Đổ bóng gần như vô hình trên nền tối** — phân tầng bằng bậc nền sáng dần thay vì bằng bóng.

---

## 13. Cấu hình theo stack

Stack của `web-smart` và `admin-smart` hiện ghi *"To be defined"*. Tài liệu PA chốt **ReactJS + Vite + Ant Design**. Cung cấp cả ba mapping.

### 13.1. Ant Design — `ConfigProvider`

```ts
import type { ThemeConfig } from 'antd';

export const smartFaceTheme: ThemeConfig = {
  token: {
    colorPrimary: '#003B2C',
    colorSuccess: '#2E7D32',
    colorWarning: '#855400',
    colorError:   '#BA1A1A',
    colorInfo:    '#005440',

    colorText:          '#191C1C',
    colorTextSecondary: '#3F4944',
    colorTextTertiary:  '#6F7974',
    colorTextDisabled:  '#6F7974',
    colorTextPlaceholder: '#6F7974',

    colorBgBase:        '#FFFFFF',
    colorBgLayout:      '#F8FAF9',
    colorBgContainer:   '#FFFFFF',
    colorFillSecondary: '#F2F4F3',
    colorFillTertiary:  '#E1E3E2',

    colorBorder:          '#6F7974',
    colorBorderSecondary: '#BFC9C3',

    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 16, fontSizeSM: 14, fontSizeLG: 18,
    fontSizeHeading1: 40, fontSizeHeading2: 32, fontSizeHeading3: 24,
    fontSizeHeading4: 20, fontSizeHeading5: 16,

    borderRadiusXS: 4, borderRadiusSM: 8, borderRadius: 12, borderRadiusLG: 16,
    controlHeightSM: 36, controlHeight: 44, controlHeightLG: 52,

    motionDurationFast: '0.15s',
    motionDurationMid:  '0.2s',
    motionDurationSlow: '0.25s',

    boxShadow:           '0 1px 2px 0 rgba(0,0,0,.05)',
    boxShadowSecondary:  '0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)',
  },
  components: {
    Button: {
      // Nút "primary" của SmartFace là amber, không phải teal.
      // Hover SÁNG lên (amber-400) — xem mục 0.1.
      colorPrimary:       '#FCAA33',
      colorPrimaryHover:  '#FFBD67',
      colorPrimaryActive: '#FCAA33',
      primaryColor:       '#6B4200',
      borderRadius: 12, fontWeight: 700, paddingInline: 24,
      dangerColor: '#FFFFFF', colorError: '#BA1A1A', colorErrorHover: '#980001',
    },
    Input:  { borderRadius: 12, paddingBlock: 8, paddingInline: 12,
              colorBorder: '#6F7974', activeBorderColor: '#003B2C',
              activeShadow: '0 0 0 3px #D1F7E8' },
    Select: { borderRadius: 8, colorBorder: '#BFC9C3', optionSelectedBg: '#D1F7E8' },
    Table:  { headerBg: '#F2F4F3', headerColor: '#3F4944',
              rowHoverBg: '#F8FAF9', rowSelectedBg: '#E4FEF4', borderColor: '#BFC9C3' },
    Modal:  { borderRadiusLG: 16, headerBg: '#F8FAF9', footerBg: '#F2F4F3' },
    Menu:   { itemSelectedBg: '#FCAA33', itemSelectedColor: '#6B4200',
              itemHoverBg: '#E1E3E2', itemBorderRadius: 8, itemHeight: 48 },
    Card:   { borderRadiusLG: 12, colorBorderSecondary: '#BFC9C3', paddingLG: 16 },
    Tag:    { borderRadiusSM: 9999, defaultBg: '#E1E3E2', defaultColor: '#191C1C' },
    Checkbox: { colorPrimary: '#003B2C', borderRadiusSM: 4 },
    Radio:    { colorPrimary: '#003B2C' },
  },
};
```

> ⚠ Ant Design mặc định **tối** màu nút khi hover. Phải ghi đè `colorPrimaryHover` thành `#FFBD67` như trên, nếu không nút amber sẽ trượt tương phản (3.02:1).

### 13.2. Tailwind CSS

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        teal:    { 50:'#E4FEF4',100:'#D1F7E8',200:'#AEE5D1',300:'#84CAB1',400:'#5EAD93',
                   500:'#398F75',600:'#17725A',700:'#005440',800:'#004836',900:'#003B2C' },
        amber:   { 50:'#FFF7DC',100:'#FFF5CB',200:'#FFEAAD',300:'#FFD284',400:'#FFBD67',
                   500:'#FCAA33',600:'#CF8922',700:'#A56600',800:'#774B00',900:'#6B4200' },
        neutral: { 50:'#F8FAF9',100:'#F2F4F3',200:'#E1E3E2',300:'#BFC9C3',400:'#99A09D',
                   500:'#6F7974',600:'#59605D',700:'#3F4944',800:'#2D3230',900:'#191C1C' },
        success: { 50:'#E2FBE1',100:'#CAEFC9',200:'#A5DAA4',300:'#7BBC7A',400:'#549D55',
                   500:'#2E7D32',600:'#18691F',700:'#00530D',800:'#003F05',900:'#002A01' },
        warning: { 50:'#FFF3DD',100:'#FFE7C5',200:'#FCD2A2',300:'#E9B77A',400:'#D49D57',
                   500:'#BB8236',600:'#A16B1D',700:'#855400',800:'#643D00',900:'#442600' },
        error:   { 50:'#FFE8E0',100:'#FFD4C9',200:'#FFB3A5',300:'#FF8A7B',400:'#FB6457',
                   500:'#DC3E36',600:'#BA1A1A',700:'#980001',800:'#740000',900:'#500000' },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      fontSize: {
        'display-lg':  ['32px',{lineHeight:'40px',letterSpacing:'-0.64px',fontWeight:'700'}],
        'headline-xl': ['40px',{lineHeight:'48px',letterSpacing:'-0.8px', fontWeight:'700'}],
        'headline-md': ['24px',{lineHeight:'32px',fontWeight:'600'}],
        'title-lg':    ['20px',{lineHeight:'28px',fontWeight:'600'}],
        'title-sm':    ['16px',{lineHeight:'24px',fontWeight:'700'}],
        'body-lg':     ['18px',{lineHeight:'28px'}],
        'body-md':     ['16px',{lineHeight:'24px'}],
        'body-sm':     ['14px',{lineHeight:'20px'}],
        'label-lg':    ['14px',{lineHeight:'20px',letterSpacing:'0.7px',fontWeight:'600'}],
        'label-md':    ['12px',{lineHeight:'16px',letterSpacing:'0.6px',fontWeight:'600'}],
        'label-sm':    ['12px',{lineHeight:'16px',fontWeight:'500'}],
        caption:       ['10px',{lineHeight:'15px'}],
        badge:         ['10px',{lineHeight:'15px',letterSpacing:'0.5px',fontWeight:'700'}],
      },
      borderRadius: { xs:'4px', sm:'8px', md:'12px', lg:'16px' },
      spacing: { '18':'72px' },
      height:  { btn:'44px', 'btn-sm':'36px', 'btn-lg':'52px' },
      zIndex:  { sticky:'100', dropdown:'1000', overlay:'1040',
                 modal:'1050', toast:'1080', tooltip:'1100' },
      transitionDuration: { instant:'100ms', fast:'150ms', base:'200ms', slow:'250ms' },
      keyframes: { shimmer: { from:{backgroundPosition:'200% 0'},
                              to:{backgroundPosition:'-200% 0'} } },
      animation: { shimmer: 'shimmer 1500ms ease-in-out infinite' },
    },
  },
} satisfies Config;
```

> Thang `boxShadow` mặc định của Tailwind (`shadow-sm/md/lg/xl`) **trùng khớp chính xác** với mục 5 — dùng luôn, không cần khai báo lại.

### 13.3. Flutter — `app-smart`

```dart
class SF {
  // Teal
  static const teal100 = Color(0xFFD1F7E8);
  static const teal700 = Color(0xFF005440);
  static const teal800 = Color(0xFF004836);
  static const teal900 = Color(0xFF003B2C);
  // Amber
  static const amber400 = Color(0xFFFFBD67);
  static const amber500 = Color(0xFFFCAA33);
  static const amber900 = Color(0xFF6B4200);
  // Neutral
  static const n50  = Color(0xFFF8FAF9);
  static const n100 = Color(0xFFF2F4F3);
  static const n200 = Color(0xFFE1E3E2);
  static const n300 = Color(0xFFBFC9C3);
  static const n500 = Color(0xFF6F7974);
  static const n700 = Color(0xFF3F4944);
  static const n900 = Color(0xFF191C1C);
  // Trạng thái
  static const success100 = Color(0xFFCAEFC9);
  static const success800 = Color(0xFF003F05);
  static const warning100 = Color(0xFFFFE7C5);
  static const warning800 = Color(0xFF643D00);
  static const error100   = Color(0xFFFFD4C9);
  static const error600   = Color(0xFFBA1A1A);
  static const error800   = Color(0xFF740000);
}

final sfTheme = ThemeData(
  useMaterial3: true,
  fontFamily: 'Inter',
  scaffoldBackgroundColor: SF.n50,
  colorScheme: const ColorScheme.light(
    primary: SF.teal900,        onPrimary: Colors.white,
    primaryContainer: SF.teal700, onPrimaryContainer: Colors.white,
    secondary: SF.amber500,     onSecondary: SF.amber900,
    secondaryContainer: SF.amber400, onSecondaryContainer: SF.amber900,
    error: SF.error600,         onError: Colors.white,
    surface: Colors.white,      onSurface: SF.n900,
    outline: SF.n500,           outlineVariant: SF.n300,
  ),
  textTheme: const TextTheme(
    displayLarge:   TextStyle(fontFamily:'PlusJakartaSans', fontSize:32, height:1.25,
                              letterSpacing:-0.64, fontWeight:FontWeight.w700),
    headlineMedium: TextStyle(fontSize:24, height:1.33, fontWeight:FontWeight.w600),
    titleLarge:     TextStyle(fontFamily:'PlusJakartaSans', fontSize:20, height:1.4,
                              fontWeight:FontWeight.w600),
    titleMedium:    TextStyle(fontSize:20, height:1.4,  fontWeight:FontWeight.w600),
    titleSmall:     TextStyle(fontSize:16, height:1.5,  fontWeight:FontWeight.w700),
    bodyLarge:      TextStyle(fontSize:16, height:1.5),
    bodyMedium:     TextStyle(fontSize:14, height:1.43),
    labelLarge:     TextStyle(fontSize:14, height:1.43, letterSpacing:0.7,
                              fontWeight:FontWeight.w600),
    labelMedium:    TextStyle(fontSize:12, height:1.33, letterSpacing:0.6,
                              fontWeight:FontWeight.w600),
    labelSmall:     TextStyle(fontSize:10, height:1.5,  letterSpacing:0.5,
                              fontWeight:FontWeight.w700),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith((s) =>
          s.contains(WidgetState.disabled) ? SF.n200
        : s.contains(WidgetState.hovered)  ? SF.amber400   // SÁNG LÊN
        : SF.amber500),
      foregroundColor: WidgetStateProperty.resolveWith((s) =>
          s.contains(WidgetState.disabled) ? SF.n500 : SF.amber900),
      minimumSize: WidgetStateProperty.all(const Size(0, 44)),
      shape: WidgetStateProperty.all(
        RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
    ),
  ),
);
```

---

## 14. Khả năng tiếp cận

### 14.1. Kết quả kiểm chứng

Toàn bộ **52 cặp màu** sẽ xuất hiện trong sản phẩm đã được tính bằng công thức WCAG 2.1 (màu alpha đã trộn xuống nền trước khi tính).

| Nhóm | Số cặp | Ngưỡng | Kết quả |
|---|---|---|---|
| Chữ trên bề mặt | 5 | 4.5 | ✅ 4.50 – 17.15:1 |
| Viền | 2 | xem ghi chú | ✅ 1.70 – 4.50:1 |
| Nút (6 biến thể × trạng thái) | 10 | 4.5 / 3.0 | ✅ 3.49 – 12.64:1 |
| Badge (5 loại + 3 biến thể mềm) | 8 | 4.5 | ✅ 5.85 – 13.30:1 |
| Toast, input lỗi, focus ring | 6 | 4.5 / 3.0 | ✅ 6.43 – 8.99:1 |
| Sidenav, bảng, chỉ số, tooltip | 9 | 4.5 | ✅ 4.55 – 12.44:1 |
| Chế độ tối | 12 | 4.5 / 3.0 | ✅ 4.05 – 17.40:1 |
| **Tổng** | **52** | | **✅ 0 lỗi** |

> **Ghi chú về viền.** Viền input `neutral-500` đạt 4.50:1 — vượt ngưỡng 3.0:1 mà WCAG 1.4.11 yêu cầu cho ranh giới của phần tử tương tác. Viền card `neutral-300` chỉ đạt 1.70:1, nhưng đây là **viền trang trí**: card đã được nhận biết qua nền trắng và đổ bóng, không phải qua viền, nên không thuộc phạm vi 1.4.11. Nếu sau này bỏ đổ bóng của card thì phải nâng viền lên `neutral-500`.

Ba cặp sát ngưỡng nhất — khi sửa bảng màu **phải chạy lại kiểm tra**:

| Cặp | Tỉ lệ | Ngưỡng |
|---|---|---|
| `amber-900` trên `amber-500` (nút CTA nghỉ) | 4.55:1 | 4.5 |
| `neutral-500` trên `#FFFFFF` (placeholder) | 4.50:1 | 4.5 |
| `neutral-500` trên `neutral-200` (nút disabled) | 3.49:1 | 3.0 |

### 14.2. Ràng buộc bắt buộc

1. **Không dùng riêng màu để truyền đạt trạng thái.** Badge phải có chữ, toast phải có icon.
2. **Vùng chạm ≥ 44 × 44px** — xem mục 10.2. Nút đóng toast hiện là `8px`, bắt buộc sửa.
3. **Focus ring bắt buộc trên mọi phần tử tương tác** — xem mục 10.1. Cấm `outline: none` trần.
4. **`neutral-500` chỉ dành cho placeholder và chữ disabled**, không dùng cho nội dung đọc được.
5. **Placeholder không thay thế label.** Mọi input phải có nhãn hiển thị thường trực.
6. **Modal/drawer phải bẫy focus**, đóng bằng `Esc`, trả focus về nơi đã mở.
7. **Thông báo động phải có `aria-live`**: toast, bulk action bar, kết quả tìm kiếm, lỗi form.
8. **Kiểm tra tự động trong CI** — `axe-core` hoặc `pa11y` trên các màn hình chính, chặn merge nếu có lỗi `serious`/`critical`.
9. **Thông báo lỗi bằng tiếng Việt**, nói rõ cách khắc phục, không hiện mã lỗi kỹ thuật cho người dùng cuối.

---

## 15. Việc cần cập nhật ngược vào Figma

Tài liệu này là nguồn chuẩn hiện tại. Để Figma khớp lại, người thiết kế cần sửa 8 điểm:

| # | Sửa gì | Ở đâu |
|---|---|---|
| 1 | Thay mọi `#BEC9C3` → `#BFC9C3` | 16 vị trí |
| 2 | Thay mọi `#6F7A74` → `#6F7974` | 3 vị trí |
| 3 | Thay `#0F6E56` → `#003B2C` | Checkbox trong *Advanced Filter Panel* |
| 4 | Thay `#6B7280` → `#6F7974` | Placeholder của *Input* và *Search* |
| 5 | **Badge "Present": nền → `#CAEFC9`, chữ → `#003F05`** | *Web Table Row Mockup* — lỗi WCAG |
| 6 | Avatar bảng: chữ viết tắt `#82C6AD` → `#FFFFFF` | *Web Table Row Mockup* |
| 7 | Thêm `shadow-lg` cho cả 3 Toast | *Toast Collection* |
| 8 | Gộp hai hệ nút thành 3 size × 6 biến thể, ghi rõ hover = `#FFBD67` | *Section - Buttons* |

Ngoài ra nên **tạo mới trong Figma**: bộ Color Styles đầy đủ theo ramp ở mục 1 (60 màu), bộ Text Styles theo mục 3.2 (16 kiểu), và trang tài liệu trạng thái tương tác theo mục 10.

---

## 16. Checklist nghiệm thu giao diện

Dùng khi review PR frontend hoặc QC màn hình mới.

**Token**
- [ ] Không có mã HEX viết thẳng trong component — mọi màu qua token ngữ nghĩa ở mục 2
- [ ] Không có màu nào nằm ngoài ramp ở mục 1
- [ ] Không dùng màu `rgba()` làm nền (trừ lớp phủ modal và đường phân cách trên nền teal)
- [ ] Khoảng cách thuộc thang `4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64`
- [ ] Bo góc thuộc `4 / 8 / 12 / 16 / 9999`
- [ ] Cỡ chữ dùng đúng token mục 3.2, không tự đặt cỡ mới
- [ ] Chữ nhỏ viết hoa có giãn chữ dương
- [ ] `z-index` lấy từ thang mục 7

**Trạng thái**
- [ ] Mọi phần tử tương tác có đủ 5 trạng thái: rest / hover / active / focus-visible / disabled
- [ ] Nút amber **sáng lên** khi hover, không tối đi
- [ ] Focus ring hiện rõ khi `Tab`, không bị `outline: none`
- [ ] Vùng chạm mobile ≥ 44 × 44px
- [ ] Có skeleton cho trạng thái tải, không dùng spinner toàn trang
- [ ] Có empty state cho mọi danh sách và bảng
- [ ] Có trạng thái lỗi cho mọi form và mọi lời gọi API

**Tiếp cận**
- [ ] Tương phản chữ ≥ 4.5:1 (kiểm bằng axe DevTools)
- [ ] Không dùng riêng màu để truyền đạt trạng thái
- [ ] Input lỗi có `aria-invalid` + `aria-describedby`
- [ ] Modal/drawer bẫy focus, đóng bằng `Esc`, trả focus khi đóng
- [ ] Thông báo động có `aria-live`
- [ ] Ảnh có `alt`; icon trang trí có `aria-hidden="true"`; nút chỉ icon có `aria-label`
- [ ] Bảng dùng `<table>` thật với `<th scope="col">`
- [ ] Tôn trọng `prefers-reduced-motion`

---

## 17. Truy vết nguồn

| Thông tin | Giá trị |
|---|---|
| Figma file key | `COLgmXH63JZ2274UQhozCx` |
| Node style guide | `233:120` — *SmartFace Design System & Style Guide* |
| Node component library | `234:430` — *Component Library* |
| File sửa lần cuối | `2026-08-11T15:15:10Z` |
| Cách trích xuất | `GET https://api.figma.com/v1/files/{key}/nodes?ids=233:120,234:430` |
| Màu gốc giữ nguyên | 16/16 màu, neo đúng bậc trong ramp (đánh dấu `▪` ở mục 1) |
| Bậc màu suy ra | 44 bậc, nội suy OKLCH |
| Kiểm chứng WCAG | 52 cặp, 0 lỗi |

**Cập nhật khi Figma đổi:**

```bash
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/COLgmXH63JZ2274UQhozCx/nodes?ids=233:120,234:430" \
  -o nodes.json
```

Nếu `lastModified` khác giá trị ở bảng trên thì thiết kế đã thay đổi — đối chiếu lại mục 1–11.

> 🔒 `FIGMA_TOKEN` phải nằm trong biến môi trường hoặc secret manager, **không commit vào repo** (`NFR-SEC-09` trong [09-yeu-cau-phi-chuc-nang.md](./09-yeu-cau-phi-chuc-nang.md)).

---

## Liên quan

- [02-kien-truc-he-thong.md](./02-kien-truc-he-thong.md) — technology stack và `ADR-09` về framework frontend
- [03-nghiep-vu-app-nhan-vien.md](./03-nghiep-vu-app-nhan-vien.md) — App Flutter, áp dụng mục 13.3
- [04-nghiep-vu-web-quan-ly.md](./04-nghiep-vu-web-quan-ly.md) — Web Quản lý, áp dụng mục 13.1
- [05-nghiep-vu-web-admin.md](./05-nghiep-vu-web-admin.md) — Web Admin, áp dụng mục 13.1
- [09-yeu-cau-phi-chuc-nang.md](./09-yeu-cau-phi-chuc-nang.md) — NFR, gồm bảo mật secret
