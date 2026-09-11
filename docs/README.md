# SmartFace — Bộ tài liệu thi công

Hệ thống chấm công thông minh bằng nhận diện khuôn mặt và vân tay, mô hình SaaS đa công ty.

Bộ tài liệu này được sinh từ **Tài liệu mô tả nghiệp vụ phiên bản 2.1, ngày 07/09/2026**
([`SmartFace_Tai_lieu_nghiep_v2_1_bo_sung_App_Giam_doc.docx`](./SmartFace_Tai_lieu_nghiep_v2_1_bo_sung_App_Giam_doc.docx)).

> **Tài liệu `01`–`12` phản chiếu đúng 12 chương của bản v2.1.**
> Tài liệu `13`–`22` là tài liệu thi công suy dẫn (mô hình dữ liệu, API, luồng
> chi tiết, style guide, deploy). Tài liệu `00` là kiến thức nền tham chiếu.

---

## Năm nhóm vai trò, sáu phân hệ giao diện

| Nhóm vai trò | Kênh | Tài liệu |
|---|---|---|
| **Nhân viên** | App mobile | [02](./02-nghiep-vu-app-nhan-vien.md) |
| **Quản lý** | App mobile | [03](./03-nghiep-vu-app-quan-ly.md) |
| **Kế toán** | Web | [05](./05-nghiep-vu-web-ke-toan.md) |
| **Giám đốc / TGĐ / Owner** | App mobile **+** Web | [04](./04-nghiep-vu-app-giam-doc.md) · [06](./06-nghiep-vu-web-giam-doc.md) |
| **Admin nền tảng** | Web | [07](./07-nghiep-vu-web-platform-admin.md) |

Ba trải nghiệm mobile dùng **chung một codebase Flutter**, mở module theo
`role + permission + scope`.

---

## Đọc theo thứ tự nào

| Vai trò | Lộ trình |
|---|---|
| **Người mới vào dự án** | `01` → `08` → `19` → `18` → phân hệ mình phụ trách |
| **Thi công Backend** | `11` → `13` → `15` → `08` → `19` → `18` → `09` |
| **Thi công App mobile** | `02` → `03` → `04` → `17` → `19` → `18` → `15` → `20` |
| **Thi công Web** | `05` → `06` → `07` → `08` → `16` → `20` |
| **Thi công AI Server** | `00` (Phần 1–3) → `11` (mục 6) → `15` (mục 8) → `18` |
| **Quản lý dự án** | `01` → `12` → `10` |
| **Vận hành / DevOps** | `22` → `07` → `10` |

---

## Danh mục

### Nghiệp vụ chuẩn — 12 chương v2.1

| File | Nội dung | Chương |
|---|---|---|
| [01 — Tổng quan hệ thống](./01-tong-quan-he-thong.md) | Mục tiêu, 5 vai trò & 6 phân hệ, RBAC + Data Scope, 20 quy tắc nghiệp vụ `BR-01`–`BR-20`, thuật ngữ, **bảng khác biệt v2.1 ↔ hiện trạng** | I |
| [02 — App Nhân viên](./02-nghiep-vu-app-nhan-vien.md) | Đăng nhập, sinh trắc học, chấm công, đơn từ, lịch sử, **bảng công**, **lịch làm việc**, **thông báo**, ngoại lệ & UAT | II |
| [03 — App Quản lý](./03-nghiep-vu-app-quan-ly.md) | 🆕 Kế thừa quyền, dashboard đội nhóm, duyệt đơn, theo dõi chấm công, phân ca được uỷ quyền | III |
| [04 — App Giám đốc](./04-nghiep-vu-app-giam-doc.md) | 🆕 Dashboard điều hành, trung tâm phê duyệt, kỳ công, nhân sự, uỷ quyền nhanh, step-up auth | IV |
| [05 — Web Kế toán](./05-nghiep-vu-web-ke-toan.md) | Nhân sự, dữ liệu chấm công, tính công, **state machine kỳ công**, báo cáo, **yêu cầu cần Giám đốc duyệt**, audit | V |
| [06 — Web Giám đốc](./06-nghiep-vu-web-giam-doc.md) | 🆕 Tổ chức, thời gian làm việc, ca & phân ca, chính sách, geofence, luồng duyệt, phân quyền, Owner, nhật ký | VI |
| [07 — Web Quản trị nền tảng](./07-nghiep-vu-web-platform-admin.md) | Tenant, **gói dịch vụ & feature flags**, AI Server, **incident**, bảo mật, log, **backup/DR**, **Support Access Mode** | VII |
| [08 — Luồng xuyên phân hệ & Ma trận quyền](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md) | 🆕 Ma trận quyền tổng quan, mô hình Role × Permission × Scope, luồng đơn từ, bảng công, onboarding, cấp quyền | VIII |
| [09 — Chống gian lận](./09-anti-fraud.md) | 5 kịch bản, 23 biện pháp `AF-01`–`AF-23`, fraud scoring, dashboard nghi vấn & quy trình quyết định | IX |
| [10 — Yêu cầu phi chức năng](./10-yeu-cau-phi-chuc-nang.md) | NFR đo được, checklist go-live, **chính sách lưu trữ**, **quyền riêng tư**, **khả năng kiểm toán** | X |
| [11 — Kiến trúc & Technology Stack](./11-kien-truc-va-technology-stack.md) | Kiến trúc, stack theo 6 phân hệ, module map, bảo mật, 9 ADR | XI |
| [12 — Lộ trình & Nghiệm thu](./12-lo-trinh-va-nghiem-thu.md) | 3 giai đoạn, MVP theo phân hệ, epic backlog, **phần việc bổ sung do v2.1**, **UAT**, ưu tiên màn hình P0/P1/P2 | XII |

### Tài liệu thi công

| File | Nội dung |
|---|---|
| [13 — Mô hình dữ liệu](./13-mo-hinh-du-lieu.md) | ERD, schema Prisma đang chạy, index, ràng buộc, seed + **mục 5: schema cần bổ sung theo v2.1** |
| [14 — Sơ đồ quan hệ bảng](./14-so-do-quan-he-bang-du-lieu.md) | Quan hệ giữa các bảng, 35 khoá ngoại, `companyId`, partition |
| [15 — Hợp đồng API](./15-hop-dong-api.md) | Hợp đồng App/Web ↔ Backend ↔ AI Server, error contract, rate limit |
| [16 — Danh mục API Backend](./16-danh-muc-api-backend.md) | ~100 endpoint đọc từ controller, kèm `curl` và mã lỗi + **phụ lục C: API còn thiếu so với v2.1** |
| [17 — Cơ chế mặt & vân tay](./17-cach-hoat-dong-cham-cong-mat-va-van-tay.md) | Hai phương thức chấm công khác nhau về bản chất thế nào |
| [18 — Luồng chấm công chi tiết](./18-luong-cham-cong-chi-tiet.md) | Payload thật ở từng chặng App → Backend → AI Server, thứ tự chốt kiểm |
| [19 — Onboarding & đăng ký khuôn mặt](./19-luong-onboarding-va-dang-ky-khuon-mat.md) | Từ lúc được cấp tài khoản tới lúc chấm công được |
| [20 — Quy chuẩn Style Guide](./20-quy-chuan-style-guide.md) | Thang màu OKLCH, token, typography, 20 component, chế độ tối. 52/52 cặp màu đạt WCAG AA |
| [21 — Tài khoản test](./21-tai-khoan-test.md) | 5 tài khoản seed, ánh xạ vai trò ↔ 6 phân hệ, vai trò nào thấy được gì |
| [22 — Hướng dẫn deploy VPS](./22-huong-dan-deploy-vps.md) | Docker Compose trên Ubuntu sau Cloudflare + **§12 topology đích theo v2.1** |
| [00 — Kiến thức nền tảng](./00-kien-thuc-nen-tang.md) | Nhận diện khuôn mặt, ngưỡng FAR/FRR, liveness, engine tính công, pháp lý VN |

---

## Bảy điều phải nhớ khi thi công

> **1. Backend không tin bất kỳ cờ xác thực nào từ client.**
> App gửi bằng chứng thô, Backend tự gọi AI Server kiểm chứng. Thấy `faceVerified: true` trong payload → lỗi nghiêm trọng. (`BR-02`, `AF-10`)

> **2. Giờ chấm công chính thức luôn là giờ Server.**
> Giờ thiết bị chỉ để đối chiếu phát hiện gian lận, không bao giờ dùng tính công. (`BR-01`, `AF-17`)

> **3. Bản ghi chấm công thô là bất biến.**
> Mọi hiệu chỉnh tạo bản ghi mới. Bảng công tính lại được bất cứ lúc nào từ bản ghi thô. (`BR-06`, `ADR-08`)

> **4. Mọi query đều lọc theo `companyId`.**
> Thiếu một chỗ là rò rỉ dữ liệu chéo khách hàng — sự cố nghiêm trọng nhất có thể xảy ra. (`BR-09`, `ADR-05`)

> **5. Không ai duyệt yêu cầu của chính mình.**
> Đơn của Quản lý đi lên Giám đốc; đơn của Giám đốc đi tới Owner khác. Ngoại lệ phải có policy, đánh dấu rõ và audit riêng. (`BR-14`)

> **6. Quyền được kiểm ở Backend, không phải ở menu.**
> Mỗi API kiểm đủ sáu điều kiện: `tenant_id` · permission · scope · trạng thái · version · chống tự duyệt. Ẩn menu là để gọn mắt, không phải để bảo vệ. (`BR-13`)

> **7. Cấu hình có ngày hiệu lực.**
> Đổi ca/chính sách/cơ cấu không được làm thay đổi kết quả của kỳ đã chốt. Kỳ đã `LOCKED` chỉ sửa qua luồng mở lại có người duyệt. (`BR-07`, `BR-12`, `BR-17`)

---

## Quy ước định danh

| Tiền tố | Ý nghĩa | Ví dụ |
|---|---|---|
| `FR-APP-*` | Yêu cầu chức năng — App Nhân viên | `FR-APP-AUTH-03` |
| `FR-MGR-*` | App Quản lý | `FR-MGR-APPR-01` |
| `FR-DIR-*` | App Giám đốc | `FR-DIR-DASH-04` |
| `FR-WEB-*` | Web Kế toán *(giữ tiền tố cũ — đã tham chiếu rộng trong `web-smart/src`)* | `FR-WEB-PERIOD-01` |
| `FR-GDW-*` | Web Giám đốc | `FR-GDW-OWNER` |
| `FR-ADM-*` | Web Quản trị nền tảng | `FR-ADM-SUP-01` |
| `BR-xx` | Quy tắc nghiệp vụ | `BR-01` (giờ server) |
| `AF-xx` | Biện pháp chống gian lận | `AF-10` (backend tự kiểm chứng) |
| `NFR-xx` | Yêu cầu phi chức năng | `NFR-PERF-01` (nhận diện < 2s) |
| `ADR-xx` | Quyết định kiến trúc | `ADR-01` (tách AI Server) |
| `Exx.y` · `E-V21.x` | Epic trong backlog | `E1.3` · `E-V21.5` (App Giám đốc) |

---

## Technology Stack

| Thành phần | Công nghệ |
|---|---|
| App Nhân viên / Quản lý / Giám đốc | Flutter (Dart) — **một codebase**, mở module theo permission |
| Web Kế toán & Web Giám đốc | ReactJS (TypeScript) + Vite + Ant Design — chung monorepo, **route/permission tách rõ** |
| Web Platform Admin | ReactJS (TypeScript) — **nên tách deployment/domain riêng** |
| Backend Core | Node.js — NestJS (TypeScript) |
| AI Server | Python — FastAPI + InsightFace (ArcFace) + ONNX Runtime |
| Database | PostgreSQL 16 (+ pgvector khi cần) · ORM Prisma |
| Cache & Queue | Redis + BullMQ |
| Lưu trữ file | Cloud Storage for Firebase |
| Log & Audit | Elasticsearch/OpenSearch + Kibana |
| Realtime | Socket.io / NestJS WebSocket Gateway |
| Hạ tầng | Docker (+ Kubernetes khi cần scale) · Nginx/Kong |
| Giám sát | Prometheus + Grafana + Sentry |

> ⚠ Stack này khác với [`00-kien-thuc-nen-tang.md`](./00-kien-thuc-nen-tang.md) (mô tả Next.js 15).
> Xem `ADR-09` trong [11 — Kiến trúc & Technology Stack](./11-kien-truc-va-technology-stack.md)
> để biết phần nào của tài liệu 00 vẫn dùng được và phần nào cần chuyển thể.

---

## Khoảng cách giữa chuẩn v2.1 và hiện trạng

Bảy hạng mục dưới đây **đã đặc tả nhưng chưa thi công**. Chi tiết và ước lượng ở
[12 mục 12](./12-lo-trinh-va-nghiem-thu.md#12-phần-việc-bổ-sung-do-v21-chưa-có-trong-ước-lượng-mục-11).

| # | Hạng mục | Tài liệu |
|---|---|---|
| 1 | **App Giám đốc** — chưa có | [04](./04-nghiep-vu-app-giam-doc.md) |
| 2 | **App Quản lý** — duyệt đơn đang nằm trên Web | [03](./03-nghiep-vu-app-quan-ly.md) |
| 3 | **Tách Web Kế toán / Web Giám đốc** — hiện gộp chung `web-smart` | [05](./05-nghiep-vu-web-ke-toan.md) · [06](./06-nghiep-vu-web-giam-doc.md) |
| 4 | **RBAC + Data Scope 6 mức** — hiện chỉ có `managedDepartmentIds` | [13 mục 5.1](./13-mo-hinh-du-lieu.md) |
| 5 | **State machine kỳ công** — thiếu `PENDING_APPROVAL`, `REOPENED` | [05 mục 13](./05-nghiep-vu-web-ke-toan.md) |
| 6 | **Workflow snapshot & step-up auth** | [13 mục 5.3](./13-mo-hinh-du-lieu.md) · [13 mục 5.6](./13-mo-hinh-du-lieu.md) |
| 7 | **Platform: gói dịch vụ, incident, Support Access Mode** | [07 mục 7–11](./07-nghiep-vu-web-platform-admin.md) |

Ba khác biệt **có chủ đích** (cố ý làm khác v2.1, không phải thiếu sót) — đăng
nhập Firebase thay vì OTP, bỏ mã mời, mỗi công ty một tài khoản riêng — xem
[01 mục 13](./01-tong-quan-he-thong.md#13-khác-biệt-giữa-chuẩn-v21-và-hiện-trạng-thi-công).

---

## Việc cần chốt trước khi code

1. Tám câu hỏi mở trong [01 mục 15](./01-tong-quan-he-thong.md#15-câu-hỏi-mở-cần-chốt) — đặc biệt Q1 (Giám đốc nhiều tenant), Q3 (số cấp duyệt) và Q4 (Giám đốc có chấm công không).
2. Cập nhật cấu hình agent thi công từ Next.js sang NestJS + ReactJS (`ADR-09`).
3. Xác nhận nguồn dữ liệu thật để hiệu chỉnh ngưỡng FAR/FRR.
4. Hồ sơ pháp lý về xử lý dữ liệu sinh trắc học (Nghị định 13/2023/NĐ-CP).
5. Chốt chính sách retention ảnh chấm công theo gói dịch vụ ([10 mục 11](./10-yeu-cau-phi-chuc-nang.md)).

Chi tiết ở [12 mục 10](./12-lo-trinh-va-nghiem-thu.md).
