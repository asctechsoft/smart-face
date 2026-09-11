# 20 — Quy chuẩn Style Guide & Design System

> **Bản v2.1 — thang màu XANH DƯƠNG.**
>
> Bản v2 mô tả một hệ teal/amber. Bộ thiết kế mới trên Figma
> (`YGR1jGWuIykwhpEC9VYykY`, các section `68:242`, `69:234`, `69:60290`) dùng
> **xanh dương** làm màu thương hiệu, **navy** cho thanh điều hướng và **xanh lá**
> cho hành động xác nhận. Người dùng đã chốt: thiết kế thắng tài liệu.
>
> **Nguồn sự thật là mã nguồn, không phải tài liệu này.**
> `web-smart/src/styles/tokens.css` là bản khai duy nhất của thang màu;
> `tailwind.config.ts` và `src/theme/antd-theme.ts` phải khớp với nó. Tài liệu
> giải thích *vì sao*, mã nguồn quyết định *là gì* — bản v2 đã lệch khỏi mã nguồn
> đúng vì làm ngược lại.
>
> **Kiểm chứng tương phản chạy được:** `cd web-smart && npm run check:contrast`.
> 37 cặp màu, mọi cặp phải đạt WCAG AA, thoát khác 0 khi có cặp trượt. Bản v2 ghi
> "52/52 cặp đạt" nhưng không có gì chạy được để kiểm chứng câu đó.

---

## Nguyên tắc

Style guide chỉ có giá trị khi **không phải diễn giải lại**. Lập trình viên mở tài liệu này ra phải copy được token vào code mà không cần mở Figma, và không phải hỏi "hover màu gì".

Ba quy tắc chi phối toàn bộ bản v2:

1. **Không màu nào tồn tại ngoài thang màu.** Mọi màu phải là một bậc trong ramp ở mục 1. Đây là điều kiện để có hover/active/focus nhất quán — thiếu ramp thì mỗi màn hình lại chế ra một sắc thái mới, đúng như tình trạng của file Figma hiện tại.
2. **Không dùng màu có độ trong suốt (alpha) làm nền.** Nền `rgba()` đổi màu theo thứ nền phía sau, làm tương phản không dự đoán được. Thay bằng bậc đặc trong ramp.
3. **Mọi phần tử tương tác phải có đủ 5 trạng thái:** `rest` · `hover` · `active` · `focus-visible` · `disabled`. Thiếu một trạng thái là thiếu thiết kế.

Hệ này bám quy ước đặt tên của **Material Design 3** (`primary`, `on-surface`, `surface-container`). Giữ nguyên quy ước khi mở rộng.

---

## 0. Nhật ký quyết định — v2.1

Bản v2 giải quyết 9 mâu thuẫn của file Figma cũ. Những quyết định đó vẫn đúng về
**cấu trúc** (một thang màu duy nhất, năm trạng thái tương tác, token ngữ nghĩa)
và được giữ nguyên. Phần đổi là **giá trị màu**.

| # | Vấn đề | Quyết định | Lý do |
|---|---|---|---|
| 1 | Thiết kế mới dùng xanh dương, tài liệu ghi teal | **Xanh dương thắng.** Toàn bộ thang teal đổi sang thang xanh dương cùng bậc | Người dùng chốt: mockup Figma là thứ họ đã duyệt |
| 2 | Nút CTA amber không còn trong thiết kế mới | **Nút chính là xanh dương**, nút **xác nhận** là xanh lá | Xem mục 0.1 — kèm hệ quả về chiều hover |
| 3 | Chữ trắng trên `#16A34A` của mockup chỉ đạt **3.30:1** | **Nút xác nhận dùng `success-700` `#15803D`** (5.02:1). `#16A34A` chỉ dùng cho biểu tượng và mảng trang trí | Mockup là ảnh AI sinh, không qua kiểm tương phản. Khác biệt về mắt không đáng kể; khác biệt về việc đọc được thì có |
| 4 | `slate-500` làm chữ mờ trượt AA trên nền app | **Chữ mờ là `slate-600` `#475569`** | `#64748B` đạt trên nền trắng (4.76) nhưng trượt trên `#F5F7FA` (4.43) và `#E2E8F0` (3.86) |
| 5 | Chế độ tối chưa từng chạy | **Sửa.** Thuộc tính `data-sf-theme` luôn được đặt bởi một script nhỏ trong `index.html` | Bản trước viết `:root[data-sf-theme='auto']` nhưng thuộc tính đó không bao giờ được set ở đâu — mã chết trông như tính năng đã có |
| 6 | Trung tính ám lục không hợp nền xanh dương | **Đổi sang thang slate** (ám xanh) | Trung tính ám lục cạnh xanh dương trông ngả vàng |
| 7 | Thanh điều hướng nền sáng | **Sidenav nền navy `#0B1B3A`** với nhóm token `--sf-sidenav-*` riêng | Dùng `--sf-on-surface-*` trên nền navy cho chữ xám 1.4:1 — gần như không đọc được |
| 8 | Không có gì kiểm chứng được lời "đã kiểm 52 cặp" | **Bộ kiểm là script**: `npm run check:contrast` | Nó bắt được **4 cặp trượt** ngay lần đầu dựng thang màu này |

### 0.1. Chiều hover đã ĐẢO so với bản v2

Đây là chỗ dễ chép nhầm nhất khi đọc lại tài liệu cũ.

Bản v2 quy định *"nút chính sáng lên khi hover, không tối đi"*. Quy tắc đó đúng
**cho nút amber**: chữ trên nút amber là nâu sẫm `#6B4200`, nên tối nền đi một
bậc làm tương phản **tụt** xuống 3.02:1 và trượt AA.

Nút xanh dương có chữ **trắng**, nên quan hệ ngược lại:

| Trạng thái | Nền | Chữ trắng trên nền đó |
|---|---|---|
| Nghỉ | `blue-700` `#1D4ED8` | **6.70:1** |
| Hover | `blue-800` `#1E40AF` | **8.72:1** |

Tối đi làm tương phản **tăng**. Vì vậy v2.1 dùng hành vi mặc định của Ant Design
thay vì ghi đè nó.

> **Nút chính tối đi khi rê chuột.** Trạng thái nhấn (`active`) vẫn không đổi màu
> mà dùng bóng lõm + dịch xuống 1px — chuyển động truyền đạt cú nhấn, không tốn
> thêm một bậc tương phản nào.

### 0.2. Ba màu, ba việc — đừng lẫn

| Vai trò | Token | Dùng cho |
|---|---|---|
| **Thương hiệu** | `--sf-primary*` (xanh dương) | Nút hành động chính, liên kết, mục nav đang chọn, vòng focus |
| **Xác nhận** | `--sf-action*` (xanh lá) | CHỈ thao tác chốt một quy trình: "Phê duyệt & cập nhật công", "Xác nhận chốt kỳ" |
| **Điều hướng** | `--sf-sidenav*` (navy) | Chỉ bên trong thanh điều hướng |

`--sf-action` là biến thể **hiếm**: một màn hình có nhiều lắm một nút xanh lá.
Bản v2 gán màu nhấn mạnh cho biến thể *mặc định*, nên mọi nút trên toàn ứng dụng
đều nhấn mạnh — và khi mọi nút đều nhấn mạnh thì không nút nào nhấn mạnh nữa.

---

## 1. Thang màu (Tonal Ramp)

Nền tảng của toàn hệ. Bốn thang màu lấy nguyên các bậc của Tailwind (blue, slate,
green, amber, red) — không phải vì tiện, mà vì chúng đã được hiệu chỉnh cho cách
đều về thị giác và được kiểm tương phản rộng rãi. Neo của thiết kế
(`#1D4ED8` = `blue-700`, `#16A34A` = `green-600`) rơi đúng vào bậc có sẵn.

### 1.1. Xanh dương — màu thương hiệu

| Bậc | Mã | Dùng cho |
|---|---|---|
| 50 | `#EFF6FF` | Nền vùng nhấn, dòng bảng đang chọn, thẻ bước đang làm |
| 100 | `#DBEAFE` | Nền badge, bóng focus của input |
| 200 | `#BFDBFE` | Viền vùng nhấn |
| 300 | `#93C5FD` | **Chữ và viền ở chế độ tối** |
| 400 | `#60A5FA` | Nền nút chính khi hover ở chế độ tối |
| 500 | `#3B82F6` | Dự phòng |
| **600** | **`#2563EB`** | **Mục nav đang chọn** (5.17:1 với chữ trắng) |
| **700** | **`#1D4ED8`** | **Nền nút chính, liên kết, vòng focus** |
| **800** | **`#1E40AF`** | **Hover của nút chính**, chữ trên nền tint |
| 900 | `#1E3A8A` | Trạng thái nhấn |

**Navy** `#0B1B3A` đứng ngoài thang: nó tối hơn `blue-900` một cách có chủ ý để
thanh điều hướng lùi ra sau nội dung thay vì tranh chú ý.

### 1.2. Xanh lá — xác nhận và trạng thái thành công

| Bậc | Mã | Dùng cho |
|---|---|---|
| 50 | `#F0FDF4` | Nền vùng thành công |
| 100 | `#DCFCE7` | Nền badge thành công |
| 600 | `#16A34A` | **Biểu tượng và mảng trang trí** — KHÔNG dùng làm nền có chữ trắng (3.30:1) |
| **700** | **`#15803D`** | **Nền nút xác nhận, chữ thành công** (5.02:1) |
| 800 | `#166534` | Hover của nút xác nhận, chữ trên nền tint |

### 1.3. Slate — trung tính (ám xanh)

`50 #F8FAFC` · `100 #F1F5F9` · `200 #E2E8F0` · `300 #CBD5E1` · `400 #94A3B8`
· `500 #64748B` · `600 #475569` · `700 #334155` · `800 #1E293B` · `900 #0F172A`

**Nền chung của ứng dụng là `#F5F7FA`** — lấy đúng từ thiết kế, nằm giữa bậc 50
và 100 nên khai riêng thay vì ép về một bậc.

⚠ `slate-500` **không dùng làm chữ thường** trên nền app hay nền xám: 4.43:1 và
3.86:1, đều trượt AA. Chữ mờ là `slate-600`. `slate-500` chỉ còn dùng cho viền
input (ngưỡng 3.0) và chữ disabled (WCAG 1.4.3 miễn trừ).

### 1.4. Cảnh báo và lỗi

Amber `50 #FFFBEB` · `100 #FEF3C7` · `700 #B45309` · `800 #92400E`
Đỏ `50 #FEF2F2` · `100 #FEE2E2` · `600 #DC2626` · `700 #B91C1C` · `800 #991B1B`

Amber **không còn là màu hành động** — nó chỉ còn nghĩa cảnh báo.

---

## 2. Token ngữ nghĩa

Component **không bao giờ tham chiếu trực tiếp vào ramp**. Chúng chỉ dùng token
ngữ nghĩa. Đây là lớp cho phép đổi cả chế độ tối bằng cách thay một khối CSS.

Bản khai đầy đủ nằm ở **`web-smart/src/styles/tokens.css`** — đọc thẳng file đó
thay vì chép lại ở đây, vì hai bản chép sẽ lệch nhau. Cấu trúc:

| Nhóm | Token | Ghi chú |
|---|---|---|
| Bề mặt | `--sf-surface`, `--sf-surface-bright`, `--sf-surface-container-low`, `--sf-surface-container`, `--sf-surface-inverse` | `surface-bright` = `#F5F7FA`, nền chung của app |
| Chữ | `--sf-on-surface`, `--sf-on-surface-variant`, `--sf-on-surface-muted`, `--sf-on-surface-inverse` | `muted` là `slate-600`, không phải 500 |
| Viền | `--sf-outline`, `--sf-outline-variant` | input / card |
| Thương hiệu | `--sf-primary`, `--sf-primary-surface`, `--sf-primary-surface-hover`, `--sf-primary-tint`, `--sf-primary-tint-strong`, `--sf-on-primary-surface` | `primary` và `primary-surface` cùng là `blue-700` |
| Điều hướng | `--sf-sidenav-surface`, `--sf-sidenav-item`, `--sf-sidenav-item-hover`, `--sf-sidenav-item-selected`, `--sf-on-sidenav` | **Bắt buộc dùng nhóm này trong sidenav**, không dùng `--sf-on-surface-*` |
| Xác nhận | `--sf-action`, `--sf-action-hover`, `--sf-on-action` | `success-700` / `success-800` / trắng |
| Trạng thái | `--sf-success*`, `--sf-warning*`, `--sf-error*` kèm `-tint` và `on--tint` | |
| Tương tác | `--sf-state-hover`, `--sf-state-active`, `--sf-state-disabled-bg`, `--sf-state-disabled-text`, `--sf-focus-ring` | |

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
| `display-lg` | Jakarta | 700 | 32 / 40 | −0.64 | Tiêu đề trang — màu `blue-700` |
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
6. **Chữ mặc định `on-surface`, chữ phụ `on-surface-variant`.** `on-surface-muted` (`#64748B`) **chỉ** dùng cho placeholder và chữ disabled — không dùng cho nội dung đọc được.

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
| `4px` | Vòng trắng quanh avatar trên nền xanh dương của drawer |

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

**Màu icon:** mặc định `on-surface-variant`; trên nền đặc (xanh dương, xanh lá, đỏ) → trắng; theo trạng thái → `success-600` / `warning-700` / `error-600`; mờ → `neutral-400`.

> Icon **chỉ trang trí** phải có `aria-hidden="true"`. Icon **mang nghĩa** (nút chỉ có icon) phải có `aria-label`.

---

## 10. Trạng thái tương tác — quy tắc dùng chung

Áp dụng cho **mọi** component, trừ khi mục 11 ghi đè.

| Trạng thái | Quy tắc |
|---|---|
| `hover` | Nền tối thêm một bậc (xem 0.1 — chiều này đã ĐẢO so với bản v2) |
| `active` | Giữ nguyên màu + `inset 0 2px 4px rgba(0,0,0,.15)` + `translateY(1px)` — chuyển động truyền đạt cú nhấn, không tốn thêm bậc tương phản |
| `focus-visible` | `outline: 2px solid var(--sf-focus-ring); outline-offset: 2px` |
| `disabled` | Nền `neutral-200`, chữ `neutral-500`, `cursor: not-allowed`, bỏ mọi bóng, `pointer-events: none` |

### 10.1. Focus ring

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--sf-focus-ring);   /* #1D4ED8 — 8.97:1 trên nền trắng */
  outline-offset: 2px;
  border-radius: inherit;
}
/* Trên nền xanh dương hoặc nền tối, đổi sang vòng trắng */
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

**`Button` cho HÀNH ĐỘNG, `LinkButton` cho ĐIỀU HƯỚNG.** Hai component, cùng
kiểu dáng, khác thẻ HTML: `<button>` và `<a href>`.

Một `<button onClick={navigate(...)}>` làm hỏng ba thứ người dùng mặc nhiên có —
bấm giữa để mở tab mới, Ctrl/Cmd+click, và menu chuột phải "Mở trong tab mới".
Cả ba là hành vi của trình duyệt trên thẻ neo, không mô phỏng lại được bằng
JavaScript. Trình đọc màn hình cũng đọc sai vai trò: "button" thay vì "link",
nên người dùng không biết mình sắp rời trang.

**Hai cột chiều cao là có chủ đích.** Đây là công cụ quản trị dùng trên desktop,
màn hình đặc dữ liệu: một thanh lọc bốn ô cộng một bảng hai mươi dòng. Ở mật độ
đó, control `44px` đẩy nội dung thật xuống dưới nếp gấp.

Nhưng ngón tay không trỏ chính xác như chuột. Vì vậy `components.css` có khối
`@media (pointer: coarse)` nâng mọi control lên `44px` khi thiết bị nhập là ngón
tay — giữ đúng sàn vùng chạm ở mục 10.2 và yêu cầu dùng được trên tablet ở
docs/05 mục 12.4.

Dùng `pointer: coarse` chứ **không** dùng breakpoint bề rộng: một tablet 1024px
nằm ngang rộng hơn cả laptop nhỏ nhưng vẫn bấm bằng ngón tay. Bề rộng màn hình
không nói gì về thiết bị trỏ.

**Sáu biến thể** (mọi ô đều đã kiểm chứng tương phản):

| Biến thể | Rest | Hover | Active | Chữ | Disabled |
|---|---|---|---|---|---|
| **Primary** (xanh dương) | `blue-700` | `blue-800` | `blue-700` + bóng lõm | `#FFFFFF` — 6.70:1 | nền `neutral-200`, chữ `neutral-500` |
| **Action** (xanh lá) | `success-700` | `success-800` | `success-700` + bóng lõm | `#FFFFFF` — 5.02:1 | như trên |
| **Primary (xanh dương đặc)** (đặc) | `blue-700` | `blue-800` | `blue-900` | `#FFFFFF` — 8.97:1 | như trên |
| **Secondary** (viền) | trong suốt, viền `2px blue-900` | nền `neutral-100` | nền `neutral-200` | `blue-900` — 12.64:1 | viền `neutral-300`, chữ `neutral-500` |
| **Tertiary** (chữ) | trong suốt | nền `neutral-100` | nền `neutral-200` | `blue-900` | chữ `neutral-500` |
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

.sf-btn--primary { background: var(--sf-action); color: var(--sf-on-action);
                   box-shadow: 0 1px 2px 0 rgba(0,0,0,.05); }
.sf-btn--primary:hover  { background: var(--sf-action-hover); }   /* SÁNG LÊN */
.sf-btn--primary:active { background: var(--sf-action);
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
| Checked | `blue-900` | `blue-900` | dấu tích trắng |
| Checked + hover | `blue-800` | `blue-800` | dấu tích trắng |
| Indeterminate | `blue-900` | `blue-900` | gạch ngang trắng |
| Disabled | `neutral-200` | `neutral-300` | — |
| Disabled + checked | `neutral-300` | `neutral-300` | dấu tích `neutral-500` |

Checkbox nhỏ trong bảng: `16 × 16`, viền `1px`, bọc vùng chạm `44 × 44`.

> Bản v1 ghi nhận một checkbox dùng `#1D4ED8`. Đã xoá — mọi checkbox dùng `blue-900`.

### 11.3. Radio

`24 × 24`, `radius-full`, viền `2px`. Trạng thái giống checkbox, riêng `checked` là **viền `blue-900` + chấm tròn `blue-900` đường kính `12px` ở giữa**, nền vẫn trong suốt.

### 11.4. Select

| Trạng thái | Nền | Viền | Radius |
|---|---|---|---|
| Đóng | `#FFFFFF` | `1px neutral-300` | `8px` |
| Hover | `#FFFFFF` | `1px neutral-500` | `8px` |
| Mở / focus | `#FFFFFF` | `1px blue-900` + ring `3px blue-100` | `8px` |
| Disabled | `neutral-200` | `1px neutral-300` | `8px` |

Cao `42px`, padding `8px 12px`. Dropdown: nền trắng, viền `1px neutral-300`, `radius-sm`, `shadow-lg`, `z-dropdown`.
Mục trong dropdown: cao `40px`, hover `neutral-100`, mục đang chọn nền `blue-100` + chữ `blue-900`.

### 11.5. Input

| Trạng thái | Nền | Viền | Chữ |
|---|---|---|---|
| Rest | `#FFFFFF` | `1px neutral-500` | `on-surface` |
| Hover | `#FFFFFF` | `1px neutral-700` | `on-surface` |
| Focus | `#FFFFFF` | `1px blue-900` + `box-shadow: 0 0 0 3px var(--sf-blue-100)` | `on-surface` |
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
| Đã chọn | `blue-700` | `1px blue-700` | `#FFFFFF` — 8.97:1 |
| Đã chọn + hover | `blue-800` | `1px blue-800` | `#FFFFFF` |
| Disabled | `neutral-200` | `1px neutral-300` | `neutral-500` |

Chip là nút chuyển trạng thái → dùng `<button role="switch" aria-checked>` hoặc `<input type="checkbox">` ẩn, **không dùng `<div>`**.

### 11.7. Badge trạng thái — đã sửa lỗi tiếp cận

> Đây là thay đổi bắt buộc (vấn đề #8). Badge cũ dùng nền trong suốt `rgba(46,125,50,0.20)` với chữ `#15803D` — chỉ **3.91:1**, không đạt AA ở cỡ 12px. Badge mới dùng **bậc đặc của ramp**, đạt 9.75:1.

| Loại | Nền | Chữ | Tương phản | Ví dụ |
|---|---|---|---|---|
| Success | `success-100` `#DCFCE7` | `success-800` `#166534` | **9.75:1** | "Đúng giờ", "Present" |
| Warning | `warning-100` `#FFE7C5` | `warning-800` `#643D00` | **7.92:1** | "Đi muộn" |
| Error | `error-100` `#FFD4C9` | `error-800` `#740000` | **8.90:1** | "Vắng mặt" |
| Teal | `blue-100` `#DBEAFE` | `blue-800` `#1E40AF` | **9.18:1** | "Đang xử lý" |
| Neutral | `neutral-200` `#E2E8F0` | `neutral-900` `#0F172A` | **13.30:1** | "ACTIVE", "Nháp" |

Radius `radius-full`, padding `4px 8px`, chữ `label-sm`. Biến thể vuông (`radius-xs`) dùng cho badge VIẾT HOA cỡ `badge` (10px).

**Biến thể mềm** cho bảng dày đặc — nền bậc `50`, chữ bậc `700`: success 8.52:1 · warning 5.85:1 · error 7.65:1. Vẫn đạt AA.

### 11.8. Avatar

| Size | Radius | Dùng ở đâu |
|---|---|---|
| `32px` | `full` | Trong dòng bảng — nền `blue-700`, chữ viết tắt **`#FFFFFF`** `label-lg` |
| `40px` | `full` | Danh sách, skeleton |
| `64px` | `full` | Icon tròn empty state — nền `neutral-200` |
| `96px` | `full` | Ô upload ảnh — nền `neutral-200`, viền `2px neutral-500` |
| `96px` | `16px` | Ảnh trong drawer — viền `4px #FFFFFF`, `shadow-md` |

> Chữ viết tắt đổi từ `#82C6AD` (4.54:1 — vừa sát ngưỡng) sang `#FFFFFF` (**8.97:1**). Biên an toàn lớn hơn nhiều mà không đổi màu nền.

### 11.9. Card

Nền `surface`, viền `1px outline-variant`, `radius-md`, padding `16px`, `shadow-xs`, gap trong `8px`.
Card bấm được: hover → `shadow-md` + viền `neutral-500`; phải là `<button>` hoặc `<a>`.

**Thẻ chỉ số** — bố cục ngang, theo mockup `55:57`:

| Phần | Thông số |
|---|---|
| Thẻ | Nền `surface`, viền `1px outline-variant`, `radius-md`, padding `16px`, `shadow-xs`, gap `14px` |
| Huy hiệu | Tròn `48px`, nền thang `50` của tông, biểu tượng `24px` thang `700` |
| Nhãn | `label-md` `on-surface-variant` |
| Giá trị | 30px/38px, 700, `letter-spacing -0.6px`, màu thang `700` của tông |
| Gợi ý | `body-sm` `on-surface-variant` |

Năm tông, và tông **mang nghĩa** chứ không phải để phối màu: `primary` (trung
tính, số đếm), `success` (đã xong), `warning` (có việc cần làm), `error` (đang
sai), `neutral` (không có trạng thái). Hàng thẻ dùng lớp `.sf-stat-row`.

> **Đổi từ bản trước:** thẻ cũ tô `neutral-100` và xếp dọc. Nền trang v2.1 là
> `surface-bright` (#f5f7fa), và `neutral-100` trên nền đó chỉ cách nhau vài
> phần trăm độ sáng — cả hàng thẻ đọc thành một dải xám liền. Thẻ trắng có viền
> tách được từng ô; huy hiệu tròn cho mỗi thẻ một hình bóng riêng, nhận ra được
> trước cả khi đọc chữ.
>
> Bốn cặp huy hiệu (mực `700` trên nền `50`) và bốn cặp số liệu (mực `700` trên
> nền trắng) đều nằm trong `npm run check:contrast`.

### 11.10. Bảng

| Phần | Thông số |
|---|---|
| Header | Nền `neutral-100`, cao `40px`, chữ `label-md-caps` `on-surface-variant`, `position: sticky`, `z-sticky` |
| Ô header | Padding `12px 24px` |
| Dòng | Cao `74px`, viền dưới `1px outline-variant` |
| Dòng hover | Nền `neutral-50` |
| Dòng đã chọn | Nền `blue-50`, viền trái `2px blue-700` |
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
| Warning | `warning-700` `#B45309` | `6s` |
| Error | `error-600` `#DC2626` | **không tự đóng** |

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

**Dialog xác nhận (nhỏ):** nền `surface` đặc (không blur), viền `1px outline-variant`, `radius-md`, padding `16px`, `shadow-lg`, tiêu đề `headline-md` `blue-900`.

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

- **Header có ảnh:** dải nền `blue-700` cao `128px`, avatar `96 × 96` `radius-lg` viền `4px #FFFFFF` đè lên.
- **Header dạng chữ:** viền dưới `1px outline-variant`, padding `24px`, tiêu đề `title-md`.
- **Thân:** padding `24px`, gap giữa các nhóm `24px`.

Yêu cầu tiếp cận giống modal.

### 11.15. Sidenav

Rộng `256px`, nền `neutral-100`, padding `16px 12px`, cách nhau giữa các nhóm `16px`.
Logo `title-lg` (Jakarta 700/20) `blue-700`; phụ đề `label-md` `on-surface-variant`.

Mục nav: cao **`36px`** (cảm ứng: `44px`), `radius-sm`, padding `8px 12px`,
gap icon–chữ `10px`, cách nhau `2px` (cảm ứng: `4px`). Chữ `body-sm` (14px).

| Trạng thái | Nền | Chữ + icon |
|---|---|---|
| Thường | trong suốt | `on-surface-variant`, `body-sm` |
| Hover | `neutral-200` | `on-surface`, `body-sm` |
| **Active** | `blue-600` | `#FFFFFF`, Inter 600/14 — 5.17:1 |
| Active + hover | `blue-700` | `#FFFFFF` — 6.70:1 |

**Vì sao mục nav không cao 48px như control là 32px.** Mục đang chọn được tô nền
`blue-600` đặc, nên nó là **khối màu lớn nhất trên toàn màn hình**. Ở `48px` với
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

`64 × 64`, nền `--sf-action` (xanh lá), `radius-lg`, icon `18px` trắng, `shadow-xl`.
Hover `--sf-action-hover` + `shadow-xl`; active thêm bóng lõm + `translateY(1px)`.
Tooltip: nền `surface-inverse` `#1E293B`, `radius-sm`, padding `6px 12px`, chữ `body-sm` `on-surface-inverse` `#F8FAFC` — 12.44:1.

### 11.17. Bulk Action Bar

Nền `blue-700`, `radius-sm`, cao `56px`, padding `12px 24px`, `shadow-lg`.
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
| Chưa đọc | `blue-50` | Viền trái `2px blue-700` |
| Đã đọc | trong suốt | Viền dưới `1px outline-variant` |
| Hover | `neutral-50` | |

Icon tròn `32px`: nền `blue-100` (thường) hoặc `warning-100` (cảnh báo), icon bậc `800`.
Nội dung `body-sm` `on-surface`; thời gian `caption` `on-surface-variant`.

> Nền tint đổi từ `rgba(0,84,64,.05)` sang bậc đặc `blue-50`, theo nguyên tắc số 2 ở đầu tài liệu.

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

    --sf-primary:            var(--sf-blue-300);      /*  9.61:1 */
    --sf-primary-surface:    var(--sf-blue-800);
    --sf-primary-surface-hover: var(--sf-blue-700);
    --sf-primary-tint:       #1A2E28;

    --sf-action:       var(--sf-success-600);
    --sf-action-hover: var(--sf-success-500);
    --sf-on-action:    #052E16;

    --sf-state-hover:  var(--sf-neutral-800);
    --sf-state-active: #363C39;
    --sf-focus-ring:   var(--sf-blue-300);
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
    colorPrimary: '#1D4ED8',
    colorSuccess: '#15803D',
    colorWarning: '#B45309',
    colorError:   '#DC2626',
    colorInfo:    '#1D4ED8',

    colorText:          '#0F172A',
    colorTextSecondary: '#334155',
    colorTextTertiary:  '#64748B',
    colorTextDisabled:  '#64748B',
    colorTextPlaceholder: '#64748B',

    colorBgBase:        '#FFFFFF',
    colorBgLayout:      '#F8FAFC',
    colorBgContainer:   '#FFFFFF',
    colorFillSecondary: '#F1F5F9',
    colorFillTertiary:  '#E2E8F0',

    colorBorder:          '#64748B',
    colorBorderSecondary: '#CBD5E1',

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
      // Nút `type="primary"` là nút XANH DƯƠNG. Nút xác nhận xanh lá là lớp
      // `.sf-btn--action`, dùng cho đúng thao tác chốt — xem mục 0.2.
      colorPrimary:       '#15803D',
      colorPrimaryHover:  '#166534',
      colorPrimaryActive: '#15803D',
      primaryColor:       '#FFFFFF',
      borderRadius: 12, fontWeight: 700, paddingInline: 24,
      dangerColor: '#FFFFFF', colorError: '#DC2626', colorErrorHover: '#B91C1C',
    },
    Input:  { borderRadius: 12, paddingBlock: 8, paddingInline: 12,
              colorBorder: '#64748B', activeBorderColor: '#1D4ED8',
              activeShadow: '0 0 0 3px #DBEAFE' },
    Select: { borderRadius: 8, colorBorder: '#CBD5E1', optionSelectedBg: '#DBEAFE' },
    Table:  { headerBg: '#F1F5F9', headerColor: '#334155',
              rowHoverBg: '#F8FAFC', rowSelectedBg: '#EFF6FF', borderColor: '#CBD5E1' },
    Modal:  { borderRadiusLG: 16, headerBg: '#F8FAFC', footerBg: '#F1F5F9' },
    Menu:   { itemSelectedBg: '#15803D', itemSelectedColor: '#FFFFFF',
              itemHoverBg: '#E2E8F0', itemBorderRadius: 8, itemHeight: 48 },
    Card:   { borderRadiusLG: 12, colorBorderSecondary: '#CBD5E1', paddingLG: 16 },
    Tag:    { borderRadiusSM: 9999, defaultBg: '#E2E8F0', defaultColor: '#0F172A' },
    Checkbox: { colorPrimary: '#1D4ED8', borderRadiusSM: 4 },
    Radio:    { colorPrimary: '#1D4ED8' },
  },
};
```

> Ant Design mặc định **tối** màu nút khi hover, và với nút xanh dương chữ trắng thì đó là hướng ĐÚNG (6.70:1 → 8.72:1). Bản v2 phải ghi đè hành vi này vì nút amber có chữ nâu; v2.1 thì không cần — xem mục 0.1.

### 13.2. Tailwind CSS

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        blue:    { 50:'#EFF6FF',100:'#DBEAFE',200:'#BFDBFE',300:'#93C5FD',400:'#60A5FA',
                   500:'#3B82F6',600:'#2563EB',700:'#1D4ED8',800:'#1E40AF',900:'#1E3A8A' },
        navy:    { DEFAULT:'#0B1B3A', hover:'#16294D', deep:'#060D1D' },
        neutral: { 50:'#F8FAFC',100:'#F1F5F9',200:'#E2E8F0',300:'#CBD5E1',400:'#94A3B8',
                   500:'#64748B',600:'#475569',700:'#334155',800:'#1E293B',900:'#0F172A' },
        success: { 50:'#F0FDF4',100:'#DCFCE7',200:'#BBF7D0',300:'#86EFAC',400:'#4ADE80',
                   500:'#22C55E',600:'#16A34A',700:'#15803D',800:'#166534',900:'#14532D' },
        warning: { 50:'#FFFBEB',100:'#FEF3C7',200:'#FDE68A',300:'#FCD34D',400:'#FBBF24',
                   500:'#F59E0B',600:'#D97706',700:'#B45309',800:'#92400E',900:'#78350F' },
        error:   { 50:'#FEF2F2',100:'#FEE2E2',200:'#FECACA',300:'#FCA5A5',400:'#F87171',
                   500:'#EF4444',600:'#DC2626',700:'#B91C1C',800:'#991B1B',900:'#7F1D1D' },
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
  // Xanh dương — thương hiệu
  static const blue100 = Color(0xFFDBEAFE);
  static const blue600 = Color(0xFF2563EB);
  static const blue700 = Color(0xFF1D4ED8);
  static const blue800 = Color(0xFF1E40AF);
  static const navy    = Color(0xFF0B1B3A);
  // Xanh lá — xác nhận
  static const green600 = Color(0xFF16A34A);
  static const green700 = Color(0xFF15803D);
  static const green800 = Color(0xFF166534);
  // Slate — trung tính
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
    primary: SF.blue700,        onPrimary: Colors.white,
    primaryContainer: SF.blue700, onPrimaryContainer: Colors.white,
    secondary: SF.green700,     onSecondary: Colors.white,
    secondaryContainer: SF.green800, onSecondaryContainer: Colors.white,
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
        : s.contains(WidgetState.hovered)  ? SF.green800   // SÁNG LÊN
        : SF.green700),
      foregroundColor: WidgetStateProperty.resolveWith((s) =>
          s.contains(WidgetState.disabled) ? SF.n500 : Colors.white),
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

> **Ghi chú về viền.** Viền input `neutral-500` đạt 4.76:1 — vượt ngưỡng 3.0:1 mà WCAG 1.4.11 yêu cầu cho ranh giới của phần tử tương tác. Viền card `neutral-300` chỉ đạt 1.70:1, nhưng đây là **viền trang trí**: card đã được nhận biết qua nền trắng và đổ bóng, không phải qua viền, nên không thuộc phạm vi 1.4.11. Nếu sau này bỏ đổ bóng của card thì phải nâng viền lên `neutral-500`.

Ba cặp sát ngưỡng nhất — khi sửa bảng màu **phải chạy lại kiểm tra**:

| Cặp | Tỉ lệ | Ngưỡng |
|---|---|---|
| `#FFFFFF` trên `success-700` (nút xác nhận) | 5.02:1 | 4.5 |
| `#FFFFFF` trên `blue-600` (mục nav đang chọn) | 5.17:1 | 4.5 |
| `neutral-500` trên `neutral-200` (nút disabled) | 3.86:1 | 3.0 (miễn trừ 1.4.3) |

Bốn cặp **đã trượt và đã được sửa** khi dựng thang màu này — giữ lại để lần sau
không ai vô tình khôi phục chúng:

| Cặp | Tỉ lệ | Đã đổi thành |
|---|---|---|
| `#FFFFFF` trên `#16A34A` (nút xác nhận trong mockup) | **3.30:1** | nền `success-700` |
| `slate-500` trên `#F5F7FA` (chữ mờ trên nền app) | **4.43:1** | chữ mờ là `slate-600` |
| `slate-500` trên `#F1F5F9` (chữ mờ trên nền xám) | **4.34:1** | như trên |
| `slate-500` trên `#E2E8F0` (chữ disabled) | 3.86:1 | giữ nguyên — WCAG 1.4.3 miễn trừ control vô hiệu |

### 14.2. Ràng buộc bắt buộc

1. **Không dùng riêng màu để truyền đạt trạng thái.** Badge phải có chữ, toast phải có icon.
2. **Vùng chạm ≥ 44 × 44px** — xem mục 10.2. Nút đóng toast hiện là `8px`, bắt buộc sửa.
3. **Focus ring bắt buộc trên mọi phần tử tương tác** — xem mục 10.1. Cấm `outline: none` trần.
4. **`neutral-500` chỉ dành cho viền input và chữ disabled**, không dùng cho nội dung đọc được — nó trượt AA trên nền app. Chữ mờ là `neutral-600`.
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
| 1 | Thay mọi `#BEC9C3` → `#CBD5E1` | 16 vị trí |
| 2 | Thay mọi `#6F7A74` → `#64748B` | 3 vị trí |
| 3 | Thay `#1D4ED8` → `#1D4ED8` | Checkbox trong *Advanced Filter Panel* |
| 4 | Thay `#6B7280` → `#64748B` | Placeholder của *Input* và *Search* |
| 5 | **Badge "Present": nền → `#DCFCE7`, chữ → `#166534`** | *Web Table Row Mockup* — lỗi WCAG |
| 6 | Avatar bảng: chữ viết tắt `#82C6AD` → `#FFFFFF` | *Web Table Row Mockup* |
| 7 | Thêm `shadow-lg` cho cả 3 Toast | *Toast Collection* |
| 8 | Gộp hai hệ nút thành 3 size × 6 biến thể, ghi rõ hover = `#166534` | *Section - Buttons* |

Ngoài ra nên **tạo mới trong Figma**: bộ Color Styles đầy đủ theo ramp ở mục 1 (60 màu), bộ Text Styles theo mục 3.2 (16 kiểu), và trang tài liệu trạng thái tương tác theo mục 10.

---

## 16. Checklist nghiệm thu giao diện

Dùng khi review PR frontend hoặc QC màn hình mới.

**Token**
- [ ] Không có mã HEX viết thẳng trong component — mọi màu qua token ngữ nghĩa ở mục 2
- [ ] Không có màu nào nằm ngoài ramp ở mục 1
- [ ] Không dùng màu `rgba()` làm nền (trừ lớp phủ modal và đường phân cách trên nền xanh dương)
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

> 🔒 `FIGMA_TOKEN` phải nằm trong biến môi trường hoặc secret manager, **không commit vào repo** (`NFR-SEC-09` trong [10-yeu-cau-phi-chuc-nang.md](./10-yeu-cau-phi-chuc-nang.md)).

---

## Liên quan

- [11-kien-truc-va-technology-stack.md](./11-kien-truc-va-technology-stack.md) — technology stack và `ADR-09` về framework frontend
- [02-nghiep-vu-app-nhan-vien.md](./02-nghiep-vu-app-nhan-vien.md) — App Flutter, áp dụng mục 13.3
- [05-nghiep-vu-web-ke-toan.md](./05-nghiep-vu-web-ke-toan.md) — Web Quản lý, áp dụng mục 13.1
- [07-nghiep-vu-web-platform-admin.md](./07-nghiep-vu-web-platform-admin.md) — Web Admin, áp dụng mục 13.1
- [10-yeu-cau-phi-chuc-nang.md](./10-yeu-cau-phi-chuc-nang.md) — NFR, gồm bảo mật secret
