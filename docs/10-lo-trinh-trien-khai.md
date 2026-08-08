# 10 — Lộ trình triển khai & Backlog

> Chuẩn hoá từ Chương VIII của tài liệu PA, mở rộng thành **epic backlog có thể giao việc**.
> Ước lượng tính theo **người-tuần (person-week)**, giả định đội 5–7 người.


> ⚠ **LUỒNG XÁC THỰC ĐÃ ĐỔI.** Tài liệu này còn mô tả cách đăng nhập bằng OTP và
> mã mời. Cách làm hiện tại: **tên miền + email + mật khẩu**, tài khoản do HR cấp
> sẵn, đăng nhập lần đầu bắt buộc đổi mật khẩu; xác thực 2 lớp là tuỳ chọn dùng
> TOTP. Mã mời đã bỏ hẳn.
>
> Mô tả đúng: [01 mục 9](./01-tong-quan-he-thong.md#9-cấp-tài-khoản-và-gia-nhập-công-ty) ·
> [08 mục 2](./08-hop-dong-api.md#2-api-xác-thực-auth) ·
> [13](./13-luong-onboarding-va-dang-ky-khuon-mat.md)
>
> Phần nghiệp vụ còn lại trong tài liệu này vẫn đúng.

---

## 1. Ba giai đoạn theo PA

| Giai đoạn | Mục tiêu | Nội dung theo PA |
|---|---|---|
| **GĐ 1 — MVP** | Chạy được vòng nghiệp vụ khép kín cho 1 công ty | Đăng nhập OTP, đăng ký khuôn mặt/vân tay, chấm công cơ bản, đơn từ cơ bản (nghỉ phép, ra ngoài), Web Quản lý duyệt đơn + xem chấm công, xuất Excel tính công cơ bản |
| **GĐ 2 — Hoàn thiện** | Đáp ứng công ty có nghiệp vụ phức tạp | Đầy đủ các loại đơn từ, thống kê nâng cao, cấu hình chính sách linh hoạt, quản lý ca xoay, Admin quản lý tenant/gói dịch vụ |
| **GĐ 3 — Nâng cao** | Mở rộng quy mô và chống gian lận nâng cao | AI Server nâng cao (chống giả mạo tốt hơn), chế độ offline, widget chấm công nhanh, tích hợp phần mềm kế toán/lương, đa ngôn ngữ, đa chi nhánh với geofencing riêng |

---

## 2. Giai đoạn 0 — Nền tảng (trước MVP)

Không có trong PA nhưng **bắt buộc phải làm trước**, nếu bỏ qua thì GĐ 1 sẽ phải làm lại.

| Epic | Nội dung | Ước lượng | Phụ thuộc |
|---|---|---:|---|
| `E0.1` Khởi tạo dự án | Monorepo/multi-repo, Docker Compose local, ESLint/Prettier, CI cơ bản | 1 tuần | — |
| `E0.2` Schema CSDL nền | Prisma schema: Company, Branch, Department, Employee, UserAccount + migration | 1.5 tuần | `E0.1` |
| `E0.3` Khung Backend NestJS | Module structure, guards (Jwt/Tenant/Roles), error contract, logger, Swagger | 1.5 tuần | `E0.1` |
| `E0.4` Khung Web React | Vite + AntD, routing + RBAC guard, API client, layout | 1 tuần | `E0.1` |
| `E0.5` Khung App Flutter | Clean architecture, Bloc, Dio + interceptor, secure storage, i18n | 1.5 tuần | `E0.1` |
| `E0.6` AI Server khung | FastAPI + InsightFace + ONNX, endpoint `/health`, `/enroll`, `/verify`, Docker GPU | 2 tuần | `E0.1` |
| `E0.7` Hạ tầng dev | PostgreSQL, Redis, MinIO, seed data, script khởi tạo tenant demo | 1 tuần | `E0.1` |

**Tổng GĐ 0: ~6–8 tuần** (chạy song song được nhiều phần)

> ⚠ **Không bỏ qua `E0.2` và `E0.3`.** Multi-tenant và error contract phải đúng từ đầu — thêm vào sau nghĩa là sửa lại toàn bộ query và toàn bộ endpoint.

---

## 3. Giai đoạn 1 — MVP

### 3.1. Backlog

| Epic | Task chính | Agent/Vai trò | Ước lượng | Phụ thuộc |
|---|---|---|---:|---|
| **`E1.1` Xác thực & Onboarding** | | | **3 tuần** | `E0.2` `E0.3` |
| | Đăng nhập OTP (gửi, verify, rate limit, khoá) | BE | 1 tuần | |
| | JWT + refresh rotation + device binding | BE | 0.5 tuần | |
| | Mã mời + tham gia công ty (Luồng A) | BE | 0.5 tuần | |
| | Sinh employee code (kể cả xử lý trùng) | BE | 0.5 tuần | |
| | Màn hình Splash/SĐT/OTP/Mã mời | FE-App | 1 tuần | |
| **`E1.2` Sinh trắc học** | | | **4 tuần** | `E0.6` `E1.1` |
| | Pipeline AI: detect → quality → liveness → embed | AI | 2 tuần | |
| | API enroll/verify + lưu FaceProfile | BE | 1 tuần | |
| | Chống trùng danh tính (`BR-10`) | BE + AI | 0.5 tuần | |
| | Vân tay: challenge–response, lưu public key | BE + FE-App | 1 tuần | |
| | Màn hình đăng ký khuôn mặt (đa góc, liveness) | FE-App | 1.5 tuần | |
| | Bảng mã lỗi tập trung + hiển thị hướng dẫn | BE + FE-App | 0.5 tuần | |
| **`E1.3` Chấm công cơ bản** | | | **4 tuần** | `E1.2` |
| | Endpoint `/challenge` (nonce + liveness action + server time) | BE | 0.5 tuần | |
| | Endpoint check-in/check-out đầy đủ pipeline kiểm tra | BE | 1.5 tuần | |
| | Geofence + tính khoảng cách | BE | 0.5 tuần | |
| | Lưu `AttendanceLog` bất biến + upload ảnh S3 | BE | 0.5 tuần | |
| | Màn hình Home + nút chấm công + GPS realtime | FE-App | 1.5 tuần | |
| | Màn hình Lịch sử cá nhân + chi tiết lượt chấm công | FE-App | 1 tuần | |
| **`E1.4` Anti-fraud lớp 1** | | | **2 tuần** | `E1.3` |
| | `AF-10` Backend tự kiểm chứng (**cốt lõi**) | BE | (nằm trong `E1.3`) | |
| | `AF-17` `AF-18` Giờ server + đối chiếu lệch giờ | BE | 0.5 tuần | |
| | `AF-12` HMAC + nonce + timestamp | BE + FE-App | 0.5 tuần | |
| | `AF-01` `AF-04` Mock location + GPS accuracy | BE + FE-App | 0.5 tuần | |
| | `AF-13` Rate limiting | BE + DevOps | 0.5 tuần | |
| | `AF-22` Audit log chi tiết lượt chấm công | BE | (trong `E1.3`) | |
| **`E1.5` Đơn từ cơ bản** | | | **3 tuần** | `E1.1` |
| | Model RequestType/ApprovalFlow + seed 2 loại đơn | BE | 0.5 tuần | |
| | CRUD đơn + state machine + ràng buộc nghiệp vụ | BE | 1 tuần | |
| | Duyệt 1 cấp + push notification | BE | 0.5 tuần | |
| | Màn hình tạo/theo dõi đơn trên App | FE-App | 1 tuần | |
| | Màn hình duyệt đơn trên Web | FE-Web | 1 tuần | |
| **`E1.6` Web Quản lý cơ bản** | | | **3 tuần** | `E1.3` `E1.5` |
| | Dashboard cơ bản (4 số liệu + cảnh báo) | FE-Web + BE | 1 tuần | |
| | Danh sách + chi tiết chấm công (ảnh, bản đồ, AI score) | FE-Web + BE | 1.5 tuần | |
| | Quản lý nhân viên (CRUD, Luồng B, gửi SMS mời) | FE-Web + BE | 1.5 tuần | |
| **`E1.7` Engine tính công cơ bản** | | | **4 tuần** | `E1.3` `E1.5` |
| | Model `AttendanceDaily` + job idempotent | BE | 1 tuần | |
| | Tính ca hành chính: đi muộn, về sớm, thiếu công | BE | 1.5 tuần | |
| | Áp dụng đơn nghỉ vào bảng công | BE | 0.5 tuần | |
| | Kỳ lương: tạo, chốt, khoá | BE | 1 tuần | |
| | **Unit test phủ 90%** (`NFR-MAINT-01`) | BE | 1 tuần | |
| **`E1.8` Xuất Excel cơ bản** | | | **1.5 tuần** | `E1.7` |
| | Queue export + ExcelJS + upload S3 + link tải | BE | 1 tuần | |
| | Màn hình xuất báo cáo với bộ lọc | FE-Web | 0.5 tuần | |
| **`E1.9` Hạ tầng & nghiệm thu** | | | **3 tuần** | tất cả |
| | CI/CD, deploy staging + production | DevOps | 1 tuần | |
| | Giám sát: Prometheus/Grafana/Sentry + cảnh báo | DevOps | 1 tuần | |
| | **Hiệu chỉnh ngưỡng FAR/FRR trên dữ liệu thật** | AI | 1 tuần | |
| | Load test giờ cao điểm | QC | 0.5 tuần | |
| | Test cách ly tenant | QC | 0.5 tuần | |

### 3.2. Tổng kết GĐ 1

```
Tổng ước lượng: ~28 person-week công việc
Với đội 6 người làm song song:  ~10–12 tuần lịch (2.5–3 tháng)

Đường găng (critical path):
  E0.2 → E0.6 → E1.2 (sinh trắc học) → E1.3 (chấm công) → E1.7 (tính công) → E1.9
  ≈ 14 tuần nếu không chồng lấn được
```

### 3.3. Định nghĩa hoàn thành (Definition of Done) cho MVP

Một công ty thật dùng được toàn bộ vòng nghiệp vụ:

- [ ] Nhân viên đăng nhập bằng OTP, đăng ký khuôn mặt và vân tay
- [ ] Chấm công vào/ra bằng khuôn mặt, có kiểm tra geofence
- [ ] Gửi đơn nghỉ phép và xin ra ngoài; quản lý duyệt trên Web
- [ ] Bảng công tháng tính đúng cho ca hành chính
- [ ] Kế toán xuất được Excel bảng công
- [ ] Chốt được kỳ lương và khoá dữ liệu
- [ ] Các biện pháp anti-fraud lớp 1 hoạt động (`AF-10` `AF-12` `AF-17` `AF-01` `AF-13`)
- [ ] Ngưỡng AI đã hiệu chỉnh trên dữ liệu thật, không dùng mặc định
- [ ] Test cách ly tenant PASS
- [ ] Đã chạy thử 2 tuần với một công ty pilot (~30–50 người)

---

## 4. Giai đoạn 2 — Hoàn thiện

| Epic | Nội dung | Ước lượng |
|---|---|---:|
| `E2.1` Đầy đủ loại đơn từ | 8 loại đơn còn lại + đính kèm minh chứng + quy tắc riêng từng loại | 3 tuần |
| `E2.2` Duyệt nhiều cấp | ApprovalFlow cấu hình được, người duyệt thay thế, duyệt hàng loạt | 2 tuần |
| `E2.3` Ca xoay & phân ca | Ca kíp, ca gãy, **ca đêm vắt nửa đêm**, lịch phân ca, phân ca hàng loạt | 4 tuần |
| `E2.4` Ca linh hoạt | Chấm công theo tổng giờ, không tính đi muộn | 1 tuần |
| `E2.5` Cấu hình chính sách nâng cao | Ngày lễ, phép năm (cộng dồn/hết hạn), hệ số OT, quy tắc phạt | 3 tuần |
| `E2.6` Làm bù | Quy đổi giờ bù thành công chuẩn, gộp nhiều lần, hạn làm bù | 2 tuần |
| `E2.7` OT đầy đủ | Đăng ký OT trước, hệ số theo loại ngày, giới hạn giờ OT theo luật | 2 tuần |
| `E2.8` Import nhân viên Excel | Validate theo dòng, preview, import hàng loạt, gửi SMS hàng loạt | 1.5 tuần |
| `E2.9` Thống kê & báo cáo | Biểu đồ chuyên cần, vi phạm, phép năm, OT; thống kê trên App | 3 tuần |
| `E2.10` Anti-fraud lớp 2 | `AF-05` `AF-07` `AF-09` `AF-11` `AF-14` `AF-03` `AF-19` + fraud scoring | 3 tuần |
| `E2.11` Dashboard cảnh báo gian lận | `AF-21` `AF-23` — danh sách cờ, chi tiết bằng chứng, quyết định giữ/huỷ | 2 tuần |
| `E2.12` Web Admin — Tenant | Quản lý tenant, gói dịch vụ, giới hạn theo gói, tạm ngưng | 3 tuần |
| `E2.13` Web Admin — Giám sát | Giám sát AI, quản lý model version, audit log, health check, quản lý queue | 3 tuần |
| `E2.14` Thông báo & phân quyền | Gửi thông báo công ty/phòng ban, phân quyền nội bộ chi tiết | 2 tuần |
| `E2.15` Xuất Excel nâng cao | Template tuỳ biến, mẫu chuẩn MISA/Fast | 2 tuần |

**Tổng GĐ 2: ~36 person-week → ~12–14 tuần lịch với đội 6 người**

---

## 5. Giai đoạn 3 — Nâng cao

| Epic | Nội dung | Ước lượng |
|---|---|---:|
| `E3.1` AI nâng cao | Model liveness tốt hơn, hoặc tích hợp SDK eKYC thương mại; random audit `AF-08` | 4 tuần |
| `E3.2` App Attestation | `AF-15` Play Integrity + App Attest, verify với Google/Apple | 2 tuần |
| `E3.3` WiFi/Beacon | `AF-02` Xác thực lớp 2 tại chỗ | 2 tuần |
| `E3.4` Chế độ offline | Lưu cục bộ, đồng bộ, luồng duyệt riêng cho bản ghi offline | 3 tuần |
| `E3.5` Widget chấm công nhanh | Widget màn hình khoá iOS/Android | 2 tuần |
| `E3.6` Đa chi nhánh | Geofence riêng từng chi nhánh, chính sách theo chi nhánh, đa múi giờ | 2 tuần |
| `E3.7` Đa ngôn ngữ | Tiếng Anh đầy đủ trên App + Web | 1.5 tuần |
| `E3.8` Tích hợp kế toán/lương | API/file chuẩn xuất sang MISA, Fast | 3 tuần |
| `E3.9` Random check-in giữa ca | `AF-20` (opt-in theo công ty) | 1.5 tuần |
| `E3.10` Kiosk 1:N | Chế độ máy chấm công cố định — **cần xử lý bẫy 1:N** | 4 tuần |
| `E3.11` Tối ưu quy mô lớn | pgvector/Milvus, partition bảng, materialized view, cache nâng cao | 3 tuần |

**Tổng GĐ 3: ~28 person-week → ~10–12 tuần lịch**

---

## 6. Sơ đồ phụ thuộc giữa các epic

```
GĐ 0
  E0.1 Khởi tạo
    ├─► E0.2 Schema ──┬─► E0.3 Backend ─┬──────────────────┐
    ├─► E0.4 Web      │                  │                  │
    ├─► E0.5 App      │                  │                  │
    ├─► E0.6 AI ──────┼──────────────┐   │                  │
    └─► E0.7 Hạ tầng  │              │   │                  │
                      ▼              ▼   ▼                  ▼
GĐ 1              E1.1 Auth ────► E1.2 Sinh trắc học ──► E1.3 Chấm công
                      │                                     │
                      │                                     ├─► E1.4 Anti-fraud L1
                      ├─► E1.5 Đơn từ ──────────────────────┤
                      │                                     ├─► E1.6 Web QL
                      │                                     └─► E1.7 Tính công
                      │                                            │
                      └────────────────────────────────────────────┴─► E1.8 Excel
                                                                        │
                                                                        ▼
                                                                   E1.9 Nghiệm thu
GĐ 2
   E2.3 Ca xoay ◄── phụ thuộc E1.7 (engine tính công phải xong trước)
   E2.10 Anti-fraud L2 ◄── phụ thuộc E1.4
   E2.12/E2.13 Admin ◄── phụ thuộc E1.6

GĐ 3
   E3.10 Kiosk 1:N ◄── phụ thuộc E3.1 (AI nâng cao)
   E3.11 Tối ưu quy mô ◄── chỉ làm khi dữ liệu đã lớn thật
```

---

## 7. Rủi ro và biện pháp giảm thiểu

| # | Rủi ro | Xác suất | Ảnh hưởng | Biện pháp |
|---|---|---|---|---|
| R1 | **Ngưỡng AI không phù hợp thực tế** → nhân viên thật bị từ chối liên tục, hoặc chấm hộ lọt qua | Cao | Nghiêm trọng | Dành hẳn 1 tuần trong `E1.9` để đo FAR/FRR trên dữ liệu thật của công ty pilot. Không go-live với ngưỡng mặc định. |
| R2 | **Engine tính công sai** → sai lương hàng loạt | Trung bình | Nghiêm trọng | Độ phủ test 90%, phủ đủ trường hợp biên (`09` mục 7.1). Chạy song song với cách tính thủ công trong 1 tháng đầu để đối chiếu. |
| R3 | **Rò rỉ dữ liệu chéo tenant** | Thấp | Thảm khốc | Test cách ly tenant tự động trong CI, chặn merge nếu fail. Row-Level Security làm lớp thứ hai. |
| R4 | **Ca đêm/ca gãy tính sai** | Cao | Cao | Thiết kế `workDate` tách khỏi `recordedAt` ngay từ `E0.2`. Test riêng cho ca đêm. |
| R5 | **AI Server không chịu nổi giờ cao điểm** | Trung bình | Cao | Load test trong `E1.9`. Scheduled scaling trước giờ cao điểm. Circuit breaker + fallback vân tay. |
| R6 | **Chi phí GPU vượt dự toán** | Trung bình | Trung bình | Đo throughput thực tế trên 1 GPU T4 sớm trong `E0.6`. Cân nhắc CPU-only cho tenant nhỏ (ONNX trên CPU vẫn chạy được, chậm hơn). |
| R7 | **Nhân viên phản đối vì lo ngại quyền riêng tư** | Trung bình | Cao | Minh bạch chính sách dữ liệu, cho phép chọn vân tay thay khuôn mặt, không lưu ảnh quá thời hạn cần thiết. Chuẩn bị tài liệu truyền thông cho HR. |
| R8 | **Yêu cầu phát sinh về tính lương** (thuế, BHXH, phụ cấp) | Cao | Trung bình | Xác định rõ ngay từ đầu: SmartFace tính **CÔNG**, không tính **LƯƠNG** đầy đủ. Xuất Excel cho phần mềm lương chuyên dụng xử lý tiếp. |
| R9 | **Lệch pha stack với agent đang cấu hình** (`ADR-09`) | Đã xảy ra | Trung bình | Cập nhật `BE_NextAgent`/`FE_NextAgent` sang NestJS/ReactJS trước khi bắt đầu `E0.3`. |
| R10 | **App bị từ chối trên App Store** vì lý do quyền riêng tư sinh trắc học | Thấp | Cao | Chuẩn bị đầy đủ privacy manifest, mô tả rõ mục đích dùng camera/vị trí/sinh trắc học. Nộp sớm bản beta để phát hiện vấn đề. |

---

## 8. Chiến lược triển khai cho khách hàng đầu tiên

```
Tuần 1–2   Khảo sát: cơ cấu phòng ban, loại ca, chính sách phép/OT hiện tại,
           mẫu bảng công đang dùng, điều kiện ánh sáng nơi chấm công
Tuần 3     Khởi tạo tenant, cấu hình chính sách, import nhân viên
Tuần 4     Đăng ký sinh trắc học cho toàn bộ nhân viên (cần hỗ trợ tại chỗ)
           → ĐÂY LÀ LÚC THU DỮ LIỆU ĐỂ HIỆU CHỈNH NGƯỠNG
Tuần 5–8   CHẠY SONG SONG: dùng SmartFace + vẫn giữ cách chấm công cũ
           → Cuối mỗi tuần đối chiếu bảng công 2 bên, tìm chênh lệch
Tuần 9     Đánh giá: tỷ lệ nhận diện thành công, số khiếu nại, chênh lệch bảng công
Tuần 10    Nếu đạt → chuyển hẳn sang SmartFace, tắt cách cũ
```

> **Đừng bỏ giai đoạn chạy song song.** Đây là cách duy nhất phát hiện sai lệch engine tính công trước khi nó ảnh hưởng tới lương thật của người lao động.

---

## 9. Chỉ số theo dõi sau khi go-live

| Chỉ số | Ngưỡng khoẻ mạnh | Hành động khi vượt ngưỡng |
|---|---|---|
| Tỷ lệ chấm công thành công lần đầu | > 90% | < 85% → xem lại ngưỡng, chất lượng camera, hướng dẫn người dùng |
| Tỷ lệ liveness fail | < 10% | > 20% → ngưỡng liveness quá chặt hoặc có gian lận thật |
| Số khiếu nại chấm công/tuần | < 2% số nhân viên | Cao → rà soát geofence, ngưỡng, chất lượng đăng ký khuôn mặt |
| Số cờ gian lận/ngày | Ổn định | Đột biến → điều tra ngay |
| Thời gian nhận diện p95 | < 2000ms | Vượt → scale AI Server |
| Chênh lệch bảng công so với thủ công | 0 | Bất kỳ chênh lệch nào → dừng lại, tìm nguyên nhân |
| Tỷ lệ nhân viên dùng app hằng ngày | > 95% | Thấp → có người vẫn dùng cách cũ, tìm hiểu rào cản |

---

## 10. Việc cần làm ngay trước khi viết dòng code đầu tiên

1. **Chốt các câu hỏi mở** trong `01-tong-quan-he-thong.md` mục 12 (Q1–Q7) — đặc biệt Q3 (duyệt 1 cấp hay nhiều cấp) và Q4 (liveness tự làm hay dùng SDK), vì hai câu này ảnh hưởng kiến trúc.
2. **Cập nhật cấu hình agent thi công** từ Next.js sang NestJS + ReactJS (`ADR-09`, `R9`).
3. **Xác nhận nguồn dữ liệu để hiệu chỉnh ngưỡng AI** — cần công ty pilot đồng ý cung cấp dữ liệu thật.
4. **Xác định rõ ranh giới sản phẩm:** SmartFace tính **công**, không tính **lương** (thuế, BHXH, phụ cấp) — tránh phình phạm vi (`R8`).
5. **Chuẩn bị hồ sơ pháp lý** về xử lý dữ liệu sinh trắc học trước khi thu thập dữ liệu thật (`NFR-LEGAL-01`).

---

## 11. Bảng tóm tắt

| | GĐ 0 | GĐ 1 (MVP) | GĐ 2 | GĐ 3 |
|---|---|---|---|---|
| Thời lượng | 6–8 tuần | 10–12 tuần | 12–14 tuần | 10–12 tuần |
| Công sức | ~9 pw | ~28 pw | ~36 pw | ~28 pw |
| Kết quả | Khung chạy được | 1 công ty dùng thật | Nhiều công ty, nghiệp vụ đầy đủ | Quy mô lớn, chống gian lận nâng cao |
| Rủi ro chính | Thiết kế sai nền tảng | Ngưỡng AI, engine tính công | Ca xoay, đa dạng chính sách | Chi phí hạ tầng, bẫy 1:N |

**Tổng thời gian ước tính từ đầu tới hết GĐ 3: khoảng 10–12 tháng** với đội 6 người.

---

**Quay lại:** [README — Danh mục tài liệu](./README.md)
