# SmartFace — Bộ tài liệu thi công

Hệ thống chấm công thông minh bằng nhận diện khuôn mặt và vân tay.
Bộ tài liệu này được sinh từ **Tài liệu mô tả nghiệp vụ (PA) phiên bản 1.0, ngày 01/08/2026**.

---

## Đọc theo thứ tự nào

**Người mới vào dự án:** `00` → `01` → `02` → `13` → `12` → phân hệ mình phụ trách
**Thi công Backend:** `02` → `07` → `08` → `13` → `12` → `06` → `04`
**Thi công App:** `03` → `11` → `13` → `12` → `08` → `06`
**Thi công Web:** `04` → `05` → `08`
**Thi công AI Server:** `00` (Phần 1–3) → `02` (mục 6) → `08` (mục 8) → `12`
**Quản lý dự án:** `01` → `10` → `09`

---

## Danh mục

| File | Nội dung | Chương PA |
|---|---|---|
| [00-kien-thuc-nen-tang.md](./00-kien-thuc-nen-tang.md) | Kiến thức nền: nhận diện khuôn mặt, ngưỡng FAR/FRR, liveness, engine tính công, chống gian lận, pháp lý VN | — |
| [01-tong-quan-he-thong.md](./01-tong-quan-he-thong.md) | Mục tiêu, actor, phạm vi, quy tắc nghiệp vụ nền tảng, thuật ngữ, câu hỏi mở | I |
| [02-kien-truc-he-thong.md](./02-kien-truc-he-thong.md) | Kiến trúc, technology stack, module map, bảo mật, triển khai, 9 ADR | I.3, VII |
| [03-nghiep-vu-app-nhan-vien.md](./03-nghiep-vu-app-nhan-vien.md) | Nghiệp vụ App Flutter: đăng nhập, sinh trắc học, chấm công, đơn từ, lịch sử, cá nhân | II |
| [04-nghiep-vu-web-quan-ly.md](./04-nghiep-vu-web-quan-ly.md) | Nghiệp vụ Web Quản lý/Kế toán/HR: phân quyền, chấm công, duyệt đơn, chính sách, tính công, nhân sự | III |
| [05-nghiep-vu-web-admin.md](./05-nghiep-vu-web-admin.md) | Nghiệp vụ Web Admin: tenant, người dùng, giám sát AI, bảo mật, vận hành | V |
| [06-anti-fraud.md](./06-anti-fraud.md) | 5 kịch bản gian lận, 23 biện pháp `AF-01`–`AF-23`, fraud scoring, thứ tự ưu tiên | IV |
| [07-mo-hinh-du-lieu.md](./07-mo-hinh-du-lieu.md) | ERD, schema Prisma đầy đủ, index, ràng buộc, partition, seed data | (suy dẫn) |
| [08-hop-dong-api.md](./08-hop-dong-api.md) | Hợp đồng API App/Web ↔ Backend ↔ AI Server, error contract, rate limit | (suy dẫn) |
| [09-yeu-cau-phi-chuc-nang.md](./09-yeu-cau-phi-chuc-nang.md) | NFR có tiêu chí đo được: bảo mật, hiệu năng, mở rộng, tin cậy, pháp lý + checklist go-live | VI |
| [10-lo-trinh-trien-khai.md](./10-lo-trinh-trien-khai.md) | 4 giai đoạn, epic backlog, ước lượng, rủi ro, chiến lược triển khai khách hàng đầu | VIII |
| [11-cach-hoat-dong-cham-cong-mat-va-van-tay.md](./11-cach-hoat-dong-cham-cong-mat-va-van-tay.md) | Cơ chế kỹ thuật của hai phương thức chấm công, vì sao vân tay khác hẳn khuôn mặt | (suy dẫn) |
| [12-luong-cham-cong-chi-tiet.md](./12-luong-cham-cong-chi-tiet.md) | Một lượt chấm công đi qua App → Backend → AI Server: payload thật ở từng chặng, thứ tự chốt kiểm, vì sao gọi AI sau cùng | (suy dẫn) |
| [13-luong-onboarding-va-dang-ky-khuon-mat.md](./13-luong-onboarding-va-dang-ky-khuon-mat.md) | Từ lúc được cấp tài khoản tới lúc chấm công được: OTP → mã mời → đăng ký khuôn mặt 4 góc → ghi DB. Kèm ranh giới đăng ký lần đầu vs đăng ký đè | (suy dẫn) |
| [14-so-do-quan-he-bang-du-lieu.md](./14-so-do-quan-he-bang-du-lieu.md) | Sơ đồ quan hệ giữa các bảng dữ liệu | (suy dẫn) |
| [15-danh-muc-api-backend.md](./15-danh-muc-api-backend.md) | **Danh mục API đã thi công**: ~100 endpoint đọc trực tiếp từ controller, mỗi endpoint có mô tả "làm gì / vì sao vậy" + ví dụ `curl` + mã lỗi. Kèm kịch bản đầu-cuối và bảng sai lầm thường gặp | (từ mã nguồn) |

---

## Bốn điều phải nhớ khi thi công

> **1. Backend không tin bất kỳ cờ xác thực nào từ client.**
> App gửi ảnh/bằng chứng thô, Backend tự gọi AI Server kiểm chứng. Nếu thấy `faceVerified: true` trong payload → lỗi nghiêm trọng. (`BR-02`, `AF-10`)

> **2. Giờ chấm công chính thức luôn là giờ Server.**
> Giờ thiết bị chỉ để đối chiếu phát hiện gian lận, không bao giờ dùng tính công. (`BR-01`, `AF-17`)

> **3. Bản ghi chấm công thô là bất biến.**
> Mọi hiệu chỉnh tạo bản ghi mới. Bảng công tính lại được bất cứ lúc nào từ bản ghi thô. (`BR-06`, `ADR-08`)

> **4. Mọi query đều lọc theo `companyId`.**
> Thiếu một chỗ là rò rỉ dữ liệu chéo khách hàng — sự cố nghiêm trọng nhất có thể xảy ra. (`BR-09`, `ADR-05`)

---

## Quy ước định danh

| Tiền tố | Ý nghĩa | Ví dụ |
|---|---|---|
| `FR-<PHÂN HỆ>-<NHÓM>-<SỐ>` | Yêu cầu chức năng | `FR-APP-AUTH-03` |
| `BR-xx` | Quy tắc nghiệp vụ | `BR-01` (giờ server) |
| `AF-xx` | Biện pháp chống gian lận | `AF-10` (backend tự kiểm chứng) |
| `NFR-xx` | Yêu cầu phi chức năng | `NFR-PERF-01` (nhận diện < 2s) |
| `ADR-xx` | Quyết định kiến trúc | `ADR-01` (tách AI Server) |
| `Exx.y` | Epic trong backlog | `E1.3` (chấm công cơ bản) |

---

## Technology Stack (chốt theo tài liệu PA)

| Thành phần | Công nghệ |
|---|---|
| App Nhân viên | Flutter (Dart) + Bloc + Dio |
| Web Quản lý & Admin | ReactJS (TypeScript) + Vite + Ant Design |
| Backend Core | Node.js — NestJS (TypeScript) |
| AI Server | Python — FastAPI + InsightFace (ArcFace) + ONNX Runtime |
| Database | PostgreSQL 16 (+ pgvector khi cần) |
| ORM | Prisma |
| Cache & Queue | Redis + BullMQ |
| Lưu trữ file | S3 / MinIO |
| Log & Audit | Elasticsearch + Kibana |
| Realtime | Socket.io / NestJS WebSocket Gateway |
| Hạ tầng | Docker + Kubernetes + Kong/Nginx |
| Giám sát | Prometheus + Grafana + Sentry |

> ⚠ **Lưu ý:** stack này khác với `00-kien-thuc-nen-tang.md` (mô tả Next.js 15). Xem `ADR-09` trong [02-kien-truc-he-thong.md](./02-kien-truc-he-thong.md) để biết phần nào của tài liệu 00 vẫn dùng được và phần nào cần chuyển thể.

---

## Việc cần chốt trước khi code

1. Bảy câu hỏi mở trong [01 mục 12](./01-tong-quan-he-thong.md#12-câu-hỏi-mở-cần-chốt-trước-khi-thi-công)
2. Cập nhật cấu hình agent thi công từ Next.js sang NestJS + ReactJS (`ADR-09`)
3. Xác nhận nguồn dữ liệu thật để hiệu chỉnh ngưỡng FAR/FRR
4. Hồ sơ pháp lý về xử lý dữ liệu sinh trắc học (Nghị định 13/2023/NĐ-CP)

Chi tiết ở [10 mục 10](./10-lo-trinh-trien-khai.md).
