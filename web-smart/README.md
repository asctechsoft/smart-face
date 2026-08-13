# web-smart — Web Quản lý chấm công

Giao diện quản trị của SmartFace, dành cho **Quản lý**, **Kế toán / HR** và **Admin công ty**.

Thi công theo:

- [`docs/04-nghiep-vu-web-quan-ly.md`](../docs/04-nghiep-vu-web-quan-ly.md) — nghiệp vụ
- [`docs/08-hop-dong-api.md`](../docs/08-hop-dong-api.md) + [`docs/15-danh-muc-api-backend.md`](../docs/15-danh-muc-api-backend.md) — hợp đồng API
- [`docs/16-quy-chuan-style-guide.md`](../docs/16-quy-chuan-style-guide.md) — thiết kế

> Ghi chú lịch sử: file README cũ mô tả thư mục này là *employee self-service portal*.
> Theo `docs/README.md` ("Thi công Web: `04` → `05`") và `ADR-03`, `web-smart` là **Web Quản lý**;
> phần tự phục vụ của nhân viên nằm ở App Flutter (`app-smart`), Web Admin nằm ở `admin-smart`.

---

## Chạy dự án

```bash
cp .env.example .env      # rồi điền cấu hình Firebase
npm install
npm run dev               # http://localhost:5173
```

Cần Backend chạy ở `http://localhost:3000` (đổi bằng `VITE_API_PROXY_TARGET`).
Vite proxy `/v1` sang Backend nên trình duyệt coi API là cùng origin — không dính CORS trong lúc phát triển.

> **Chưa có `.env` vẫn chạy được.** Ứng dụng khởi động bình thường và
> `/design-system` xem được đầy đủ; chỉ màn hình đăng nhập bị khoá kèm thông báo
> nói rõ thiếu biến nào. Sửa `.env` xong phải **khởi động lại** máy chủ phát triển —
> Vite chỉ đọc file này lúc khởi động.

| Lệnh | Việc |
|---|---|
| `npm run dev` | Máy chủ phát triển, hot reload |
| `npm run build` | Kiểm kiểu rồi build production vào `dist/` |
| `npm run typecheck` | Chỉ kiểm kiểu |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

---

## Technology stack

Chốt theo PA 7.3 (`docs/04` mục 12.3):

| Mục đích | Thư viện |
|---|---|
| Build | Vite 5 |
| UI | React 19 + TypeScript + Ant Design 5 |
| Dữ liệu & cache | TanStack Query 5 |
| Định tuyến | React Router 6 |
| Form & validation | React Hook Form + Zod |
| Biểu đồ | Recharts |
| Ngày giờ | date-fns + **date-fns-tz** (bắt buộc có timezone) |
| Xác thực | Firebase Authentication (client SDK) |
| Tiện ích CSS | Tailwind (preflight tắt, dùng chung với antd) |

---

## Cấu trúc thư mục

Theo `docs/04` mục 12.1:

```
src/
├── config/            # env (kiểm bằng Zod), hằng số, nhãn enum
├── lib/
│   ├── api/           # axios client + interceptor refresh, query client, khoá cache
│   ├── auth/          # Firebase, đổi token lấy phiên, AuthProvider
│   ├── rbac/          # ma trận quyền, <Can/>, useCan
│   ├── errors/        # ApiError, ánh xạ mã lỗi → thông điệp tiếng Việt
│   └── utils/         # date (timezone công ty), format, download, cầu nối dayjs
├── theme/             # cấu hình ConfigProvider của antd
├── components/
│   ├── ui/            # THƯ VIỆN COMPONENT DÙNG CHUNG — docs/16 mục 11
│   └── *.tsx          # component ghép sẵn cho nghiệp vụ (DataTable, FilterBar...)
├── routes/            # router, guard, layout, danh mục sidenav
└── features/
    ├── auth/          # đăng nhập, 2FA, đổi mật khẩu
    ├── dashboard/
    ├── attendance/    # danh sách, chi tiết, hiệu chỉnh, xuất Excel
    ├── requests/      # duyệt đơn lẻ và hàng loạt, cấu hình loại đơn & luồng duyệt
    ├── employees/     # danh sách, hồ sơ chi tiết, thiết bị, lịch sử, import Excel
    ├── shifts/        # lịch phân ca theo người × ngày, phân ca hàng loạt
    ├── makeup/        # công làm bù: nợ giờ, ghi nhận bù, gia hạn
    ├── payroll/       # kỳ lương, báo cáo tiền chốt, chốt/mở lại
    ├── policy/        # chính sách, ca, ngày lễ, phép năm, chi nhánh, phòng ban
    ├── reports/       # chuyên cần, vi phạm, OT, phép năm
    ├── fraud/         # cảnh báo gian lận và quyết định xử lý
    ├── access/        # phân quyền nội bộ + ma trận vai trò
    ├── notifications/
    └── audit/         # nhật ký kiểm toán
```

### Bản đồ màn hình → yêu cầu nghiệp vụ

| Đường dẫn | Màn hình | Mã yêu cầu (`docs/04`) |
|---|---|---|
| `/dashboard` | Tổng quan | `FR-WEB-DASH-01..06` |
| `/attendance` | Chấm công | `FR-WEB-ATT-01..07` |
| `/requests` | Duyệt đơn từ | `FR-WEB-REQ-01..08` |
| `/requests/settings` | Loại đơn & luồng duyệt | `FR-WEB-REQ-05` |
| `/makeup` | Công làm bù | `FR-WEB-MKUP-01..04` |
| `/fraud` | Cảnh báo gian lận | `docs/06` mục 7 |
| `/employees` · `/employees/:id` | Nhân sự, hồ sơ chi tiết | `FR-WEB-HR-01..12`, `FR-WEB-INV-06` |
| `/shifts` | Phân ca | `FR-WEB-HR-03`, `FR-WEB-HR-04` |
| `/payroll` | Kỳ lương | `FR-WEB-PAY-01..08` |
| `/reports` | Báo cáo & thống kê | `FR-WEB-REP-01..06` |
| `/policy` | Chính sách công ty | `FR-WEB-POL-01..11` |
| `/access` | Phân quyền nội bộ | `FR-WEB-NOT-04..06` |
| `/notifications` | Thông báo | `FR-WEB-NOT-01..03` |
| `/audit-logs` | Nhật ký kiểm toán | `BR-08` |

Mã mời (`FR-WEB-INV-01..03`) **đã bỏ** — danh tính do Firebase quản lý và HR cấp
tài khoản sẵn, xem banner đầu [`docs/04`](../docs/04-nghiep-vu-web-quan-ly.md).

---

## Thư viện component dùng chung

Dựng theo [`docs/16` mục 11](../docs/16-quy-chuan-style-guide.md), mỗi component đủ **5 trạng thái**
(`rest` · `hover` · `active` · `focus-visible` · `disabled`).

```tsx
import { Button, Field, TextInput, Badge, Modal, useToast } from '@/components/ui';
```

| Mục docs/16 | Component | Ghi chú |
|---|---|---|
| 11.1 | `Button`, `IconButton` | 6 biến thể × 3 size. `IconButton` bắt buộc có `label` ở tầng kiểu dữ liệu |
| 11.2 / 11.3 | `Checkbox`, `Radio`, `RadioGroup` | Input thật bị ẩn khỏi mắt nhưng giữ trong luồng tiêu điểm |
| 11.4 | `Select` | `<select>` thật — giữ bàn phím, tìm-theo-chữ, bánh xe chọn trên mobile |
| 11.5 | `Field`, `TextInput`, `TextArea` | `Field` tự sinh `id` và nối `aria-invalid` + `aria-describedby` |
| 11.6 | `FilterChip`, `FilterChipGroup` | `<button role="switch" aria-checked>` |
| 11.7 | `Badge` + `dailyStatusTone()`… | 5 tông, biến thể `soft` và `caps` |
| 11.8 | `Avatar` | 4 size, biến thể `rounded` cho header drawer |
| 11.9 | `Card`, `ClickableCard`, `StatCard` | Card bấm được là `<button>`/`<a>` thật |
| 11.11 | `TableSkeleton`, `CardSkeleton`, `StatCardSkeleton`, `ListSkeleton`, `SkeletonBlock` | Đều có `aria-busy` + `aria-live` |
| 11.12 | `ToastProvider`, `useToast` | Lỗi không tự đóng; dừng đếm giờ khi rê chuột; nút đóng 44×44 |
| 11.13 | `Modal`, `ConfirmDialog` | Bẫy focus, `Esc`, trả focus khi đóng |
| 11.14 / 11.19 | `Drawer`, `BottomSheet` | `Drawer` có biến thể header dải teal + avatar 96px |
| 11.16 | `Fab` | Tooltip hiện cả khi hover lẫn khi nhận tiêu điểm bàn phím |
| 11.17 | `BulkActionBar`, `BulkAction` | `aria-live="polite"` báo số dòng đã chọn |
| 11.18 | `EmptyState`, `ErrorState` | `description` bắt buộc — phải nói được làm gì tiếp theo |
| 11.20 | `NotificationItem` | Trạng thái chưa đọc đọc được, không chỉ nhìn thấy qua nền |
| mục 9 | `Icon` | `aria-hidden` mặc định; truyền `label` khi icon mang nghĩa |

**Không có trong thư viện, và vì sao:**
`Bảng` (11.10) dùng `<Table>` của Ant Design qua [`components/DataTable.tsx`](src/components/DataTable.tsx) —
đã có sẵn phân trang server-side, cột dính, chọn dòng và `<th scope="col">` đúng chuẩn.
`Sidenav` (11.15) chỉ dùng một chỗ nên nằm trong [`ManagerLayout.tsx`](src/routes/layouts/ManagerLayout.tsx).

### Trang trưng bày

```
npm run dev  →  http://localhost:5173/design-system
```

Nằm **ngoài mọi guard** (không gọi API, không hiển thị dữ liệu nghiệp vụ) để người thiết kế và QC
xem được mà không cần tài khoản công ty, và **không cần cả file `.env`**. Dùng để chạy axe DevTools
một lượt, đối chiếu Figma, và thử `Tab` xuyên trang xem vòng focus có chỗ nào mất không.

### Kết quả đo trên trình duyệt

Đo bằng Chrome headless trên chính trang trưng bày:

| Hạng mục | Đo được | Yêu cầu docs/16 |
|---|---|---|
| Nút amber nghỉ → hover | `#FCAA33` → `#FFBD67` (**sáng lên**) | mục 0.1 |
| Tương phản chữ nút amber | 4.55:1 → 5.29:1 | ≥ 4.5 |
| Badge success | nền `#CAEFC9`, chữ `#003F05` | 9.75:1 |
| Focus ring | `2px solid #005440` | mục 10.1 |
| Checkbox / Radio | 24 × 24 | mục 11.2, 11.3 |
| Chip / Input / FAB / Bulk bar | 38 / 42 / 64 / 56 px | mục 11.6, 11.5, 11.16, 11.17 |
| Nút đóng toast | 44 × 44 | mục 10.2 |
| Toast lỗi sau 7 giây | vẫn hiện | mục 11.12 |
| Modal | `aria-modal`, `aria-labelledby`, focus bên trong, `Esc` đóng | mục 14.2 điều 6 |
| Nút chỉ-icon thiếu `aria-label` | 0 | mục 14.2 |

---

## Bốn nguyên tắc chi phối mã nguồn

**1. Backend là nguồn sự thật của quyền.**
`lib/rbac` chỉ ẩn/hiện nút cho gọn màn hình. Ẩn nút KHÔNG chặn được request — Backend kiểm tra lại
toàn bộ bằng `RolesGuard` + `ScopeGuard` (`docs/04` mục 12.2). Đừng bao giờ dựa vào nó như một chốt bảo mật.

**2. Mọi mốc thời gian đi qua `lib/utils/date.ts`.**
Backend lưu UTC, công ty ở `Asia/Ho_Chi_Minh`. Dùng `toLocaleString()` là hiển thị theo múi giờ
của **máy người dùng** — lượt chấm công 00:30 ngày 04 sẽ nhảy sang ngày 03 và cả bảng công lệch một ngày
(`docs/04` mục 6.4). ESLint chặn `Date.toLocaleString`.

**3. Bản ghi chấm công thô là bất biến.**
Màn hình hiệu chỉnh công không "sửa" gì cả — nó tạo bản ghi `AttendanceAdjustment` mới trỏ về bản gốc
(`BR-ADJ-01`). Giao diện nói rõ điều này với người thao tác, vì nhân viên cũng xem được lịch sử hiệu chỉnh
liên quan tới mình (`BR-ADJ-06`).

**4. Không màu nào nằm ngoài thang màu.**
Mọi màu lấy từ token ngữ nghĩa trong `src/styles/tokens.css`, chép nguyên văn từ `docs/16` mục 1–2.
52 cặp màu đã kiểm chứng WCAG AA. Sửa một giá trị là phải chạy lại kiểm chứng.

---

## Điểm dễ làm sai

| Việc | Cạm bẫy |
|---|---|
| Đăng nhập | Chỉ hỏi email + mật khẩu, **không hỏi tên miền** — quan hệ tài khoản–công ty là 1–1 nên Backend tự suy. `domain` trong `POST /auth/session` đã thành tuỳ chọn (vẫn nhận để App Flutter khỏi phải sửa) |
| Firebase | Luôn là nơi kiểm mật khẩu cho **mọi** tài khoản, không phải lớp thứ hai. Xác thực 2 lớp là OTP qua SMS do Backend điều phối, chạy **sau** khi Firebase xác nhận xong |
| Nút chính (amber) | Hover **SÁNG LÊN** (`amber-400`), không tối đi. Antd mặc định tối → 3.02:1, trượt AA (`docs/16` mục 0.1) |
| Refresh token | Xoay vòng — dùng lại token cũ làm Backend thu hồi **toàn bộ** phiên (AF-16). `lib/api/client.ts` gom các lệnh refresh song song vào một promise duy nhất |
| Ảnh chấm công | Presigned URL hết hạn sau **5 phút**. `staleTime` của query đã đặt ngắn hơn; đừng nâng lên |
| Xuất Excel | Luôn qua job ở Backend (`docs/04` mục 7.4). Không dựng file ở client cho bảng công/bảng lương |
| Chốt kỳ lương | Bắt buộc mở báo cáo tiền chốt trước. Còn tồn đọng thì phải tích ô xác nhận, `force: true` đi kèm lý do vào audit log |
| Ca đêm | `crossesMidnight` gắn ca với **ngày bắt đầu**, không phải ngày của timestamp chấm ra |
| Đổi giờ ca | Dùng `effectiveFrom`, không ghi đè — nếu không, bảng công đã tính của cả tháng bị đổi theo |

---

## Checklist trước khi mở PR

Lấy từ `docs/16` mục 16:

- [ ] Không có mã HEX viết thẳng trong component — mọi màu qua token ngữ nghĩa
- [ ] Mọi phần tử tương tác đủ 5 trạng thái: rest / hover / active / focus-visible / disabled
- [ ] Không có `outline: none` trần
- [ ] Mỗi bảng và danh sách có đủ 4 trạng thái: skeleton / lỗi / rỗng / có dữ liệu
- [ ] Input lỗi có `aria-invalid` + `aria-describedby`
- [ ] Modal/drawer bẫy focus, đóng bằng `Esc`
- [ ] Thao tác nguy hiểm có xác nhận hai bước kèm lý do ≥ 10 ký tự
- [ ] Bảng dùng `<table>` thật với `<th scope="col">` (antd `Table` đã đảm bảo)
- [ ] `npm run typecheck` và `npm run lint` sạch

---

## Còn lại ở giai đoạn sau

Những mục trong `docs/04` chưa thi công ở bản này, xếp theo thứ tự ưu tiên:

| Mục | Yêu cầu | Ghi chú |
|---|---|---|
| Phân ca hàng loạt | `FR-WEB-HR-03`, `FR-WEB-HR-04` | Backend đã có `POST /admin/shift-assignments/bulk`; cần màn hình lịch phân ca theo tuần |
| Quản lý thiết bị liên kết | `FR-WEB-INV-06` | Backend có `GET /auth/devices` và `POST /system/users/:id/revoke-device` (Web Admin) |
| Cấu hình luồng duyệt đơn | `FR-WEB-REQ-05` | Cần API cấu hình `ApprovalFlowStep` — chưa có trong danh mục endpoint hiện tại |
| Thông báo realtime | `FR-WEB-REQ-08` | Hiện dùng polling 60s; chuyển sang socket.io khi Backend mở gateway |
| Chế độ tối | `docs/16` mục 12 | Token đã sẵn sàng, chỉ cần công tắc và lưu lựa chọn của người dùng |
| Chuyển 11 màn hình sang thư viện `ui/` | — | `StatusBadge`/`EmptyState`/`Skeleton`/`Icon`/`StatCard` đã trỏ sang `ui/` qua lớp re-export nên **đã dùng component mới**. Phần còn lại là `Button`/`Input`/`Modal` của antd — chúng đã ăn đúng token qua `ConfigProvider`, nên đây là dọn dẹp chứ không phải sửa lỗi. Làm dần theo từng màn hình để giới hạn phạm vi hồi quy |
| Đối chiếu 2 node Figma bạn gửi | — | Xem mục "Nguồn thiết kế" dưới đây |

---

## Nguồn thiết kế

Thư viện dựng từ **`docs/16` mục 11**, không phải đọc trực tiếp từ Figma. Lý do và việc cần làm:

| Vấn đề | Chi tiết |
|---|---|
| Không đọc được file Figma | `api.figma.com` trả **403** và trang design cần đăng nhập. Dự án không có `FIGMA_TOKEN` ở biến môi trường hay file cấu hình nào |
| Hai file Figma khác nhau | `docs/16` mục 17 ghi file key `COLgmXH63JZ2274UQhozCx`. Link được gửi trỏ tới `YGR1jGWuIykwhpEC9VYykY` — **file khác** |
| `docs/16` mới hơn Figma | Mục 15 của tài liệu liệt kê **8 điểm Figma cần sửa để khớp lại** (badge sai WCAG, hai hệ nút, màu viền trùng lặp…). Nên khi hai nguồn lệch nhau, `docs/16` thắng |

Muốn đối chiếu với hai node `1-7841` và `1-8572`:

```bash
export FIGMA_TOKEN=<personal access token>
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/YGR1jGWuIykwhpEC9VYykY/nodes?ids=1-7841,1-8572" -o nodes.json
```

Có `nodes.json` thì đối chiếu được từng component và báo cáo chênh lệch so với bản đã dựng.
