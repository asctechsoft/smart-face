# 09 — Yêu cầu phi chức năng (Non-Functional Requirements)

> Chuẩn hoá từ Chương VI của tài liệu PA, bổ sung **tiêu chí đo lường cụ thể** để nghiệm thu.
> Mỗi yêu cầu có mã `NFR-xx` để truy vết sang test case.

---

## Nguyên tắc

Yêu cầu phi chức năng chỉ có giá trị khi **đo được**. "Hệ thống phải nhanh" không nghiệm thu được; "p95 thời gian nhận diện < 2000ms dưới tải 100 req/s" thì đo được. Mọi mục dưới đây đều có ngưỡng số và cách đo.

---

## 1. Bảo mật (`NFR-SEC`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-SEC-01` | Mã hoá dữ liệu sinh trắc học khi lưu trữ (at-rest) | Ảnh trên S3 dùng SSE-KMS/AES-256; embedding lưu ở bảng có quyền hạn chế | Must |
| `NFR-SEC-02` | Mã hoá khi truyền tải | TLS 1.3 (tối thiểu 1.2), HSTS bật, không hỗ trợ cipher yếu — kiểm bằng SSL Labs đạt A+ | Must |
| `NFR-SEC-03` | Xác thực API bằng JWT | Access token TTL ≤ 15 phút, refresh token xoay vòng, thuật toán RS256 hoặc ES256 (không HS256 dùng chung secret) | Must |
| `NFR-SEC-04` | Phân quyền chi tiết theo vai trò (RBAC) | 100% endpoint có guard; test tự động xác nhận mỗi role chỉ truy cập đúng phạm vi | Must |
| `NFR-SEC-05` | Cách ly dữ liệu multi-tenant | Test quét toàn bộ endpoint: đăng nhập tenant A không đọc được bất kỳ dữ liệu nào của tenant B (`BR-09`) | Must |
| `NFR-SEC-06` | Tuân thủ pháp luật VN về bảo vệ dữ liệu cá nhân | Có chính sách bảo mật, cơ chế đồng ý riêng cho dữ liệu sinh trắc học, quy trình xoá theo yêu cầu (Nghị định 13/2023/NĐ-CP) | Must |
| `NFR-SEC-07` | Không lưu dữ liệu vân tay thực tế | Kiểm tra schema: chỉ có public key, không có template vân tay (`BR-05`) | Must |
| `NFR-SEC-08` | Chống các lỗ hổng OWASP Top 10 | Quét SAST/DAST trong CI, không có lỗ hổng mức High/Critical khi release | Must |
| `NFR-SEC-09` | Mật khẩu/secret không nằm trong mã nguồn | Quét secret trong CI (gitleaks/trufflehog), toàn bộ secret qua biến môi trường hoặc secret manager | Must |
| `NFR-SEC-10` | Audit log append-only | Thử UPDATE/DELETE trực tiếp trên DB bị chặn bởi rule (`BR-08`) | Must |
| `NFR-SEC-11` | 2FA cho tài khoản Admin hệ thống | Bắt buộc OTP qua SMS khi đăng nhập Web Admin | Should |
| `NFR-SEC-12` | Ảnh chấm công không truy cập được bằng URL công khai | Chỉ qua presigned URL TTL ≤ 5 phút | Must |

### 1.1. Cách kiểm chứng cách ly tenant (`NFR-SEC-05`)

```
Test tự động chạy trong CI:
  1. Seed 2 tenant: A (10 nhân viên) và B (10 nhân viên)
  2. Đăng nhập bằng tài khoản HR của tenant A
  3. Với MỌI endpoint GET trong OpenAPI spec:
       - Gọi với ID thuộc tenant B → phải trả 404 hoặc 403, KHÔNG BAO GIỜ 200
       - Gọi danh sách → kết quả không chứa bất kỳ record nào của tenant B
  4. Lặp lại với vai trò MANAGER, EMPLOYEE

→ Test này FAIL = chặn release. Đây là rủi ro nghiêm trọng nhất của mô hình SaaS.
```

---

## 2. Hiệu năng (`NFR-PERF`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-PERF-01` | Thời gian xử lý nhận diện khuôn mặt | **p95 < 2000ms** từ lúc App gửi request tới lúc nhận kết quả (PA VI) | Must |
| `NFR-PERF-02` | AI Server xử lý thuần | p95 < 500ms (không tính thời gian mạng và upload ảnh) | Must |
| `NFR-PERF-03` | API đọc thông thường | p95 < 300ms |Must |
| `NFR-PERF-04` | API ghi thông thường | p95 < 500ms | Must |
| `NFR-PERF-05` | Dashboard Web Quản lý | Thời gian tải đầy đủ < 2s với 500 nhân viên | Must |
| `NFR-PERF-06` | Danh sách chấm công 1 tháng | < 1s cho 500 nhân viên × 31 ngày (phân trang server-side) | Must |
| `NFR-PERF-07` | Tính công toàn công ty | 500 nhân viên × 31 ngày hoàn thành < 5 phút | Must |
| `NFR-PERF-08` | Xuất Excel bảng công | 500 nhân viên × 31 ngày < 60 giây (bất đồng bộ qua queue) | Must |
| `NFR-PERF-09` | Khởi động App | Splash → Home < 3s trên thiết bị tầm trung | Should |
| `NFR-PERF-10` | Kích thước ảnh gửi lên | ≤ 800KB sau khi App tiền xử lý (crop/resize) | Should |

### 2.1. Chịu tải giờ cao điểm (`NFR-PERF-11`)

```
Khung giờ cao điểm: 07:30–09:00 và 17:00–18:30

Kịch bản kiểm thử tải:
  - 5.000 nhân viên chấm công trong 30 phút
  - Phân bố: 60% dồn vào 10 phút giữa khung giờ
  - Đỉnh ước tính: ~50 req/s cho endpoint chấm công

Tiêu chí PASS:
  ✓ p95 latency chấm công < 2000ms trong suốt thời gian test
  ✓ Tỷ lệ lỗi 5xx < 0.5%
  ✓ Không có request nào timeout
  ✓ AI Server tự scale và ổn định lại trong < 2 phút

Công cụ: k6 hoặc Gatling, chạy trên staging trước mỗi release lớn.
```

### 2.2. Điểm cần chú ý khi tối ưu

| Điểm nghẽn | Giải pháp |
|---|---|
| Nạp model AI mỗi request | Nạp một lần khi service start, giữ trong RAM (`ADR-01`) |
| Query dashboard mỗi lần tải | Cache Redis TTL 1–5 phút |
| Báo cáo query bảng `AttendanceLog` | Query trên `AttendanceDaily` hoặc materialized view |
| Upload ảnh chậm | App resize trước khi gửi; dùng WebP/JPEG chất lượng 80 |
| N+1 query trong Prisma | Dùng `include` hợp lý, kiểm tra bằng query logging trong dev |
| Bảng `AttendanceLog` quá lớn | Partition theo tháng (`07-mo-hinh-du-lieu.md` mục 4.1) |

---

## 3. Khả năng mở rộng (`NFR-SCALE`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-SCALE-01` | Kiến trúc multi-tenant | Thêm công ty mới không cần deploy, không ảnh hưởng công ty hiện có | Must |
| `NFR-SCALE-02` | AI Server scale độc lập | Tăng replica AI Server không cần restart Backend (`ADR-01`) | Must |
| `NFR-SCALE-03` | Backend scale ngang | Stateless — thêm pod là tăng năng lực xử lý, session/OTP nằm ở Redis | Must |
| `NFR-SCALE-04` | Quy mô mục tiêu giai đoạn 1 | 100 công ty · 10.000 nhân viên · 40.000 lượt chấm công/ngày | Must |
| `NFR-SCALE-05` | Quy mô mục tiêu giai đoạn 3 | 1.000 công ty · 100.000 nhân viên · 400.000 lượt/ngày | Should |
| `NFR-SCALE-06` | Auto-scaling theo tải | HPA theo CPU/GPU + scheduled scaling trước khung giờ cao điểm | Should |
| `NFR-SCALE-07` | Lưu trữ tăng trưởng | Ảnh có lifecycle tự xoá; dung lượng DB tăng tuyến tính, có kế hoạch partition | Must |

> **`NFR-SCALE-07` — đã thực thi.** `RetentionProcessor` chạy 05:00 mỗi ngày,
> xoá ảnh và tệp quá hạn theo chính sách **từng công ty**. Kèm lifecycle rule
> đặt thẳng trên bucket làm trần cứng, để job hỏng vài tháng mà không ai biết
> thì vẫn có thứ dọn.
>
> Bốn tiền tố bốn quy tắc khác nhau — `face-profile/` **không** xoá theo tuổi vì
> hồ sơ của nhân viên đang làm việc phải sống mãi. Chi tiết:
> [BackEnd/docs/r2-lifecycle.md](../BackEnd/docs/r2-lifecycle.md).

### 3.1. Ước tính tài nguyên

```
Giai đoạn 1 (10.000 nhân viên):
  Backend Core   : 3–4 pod  (2 vCPU, 4GB RAM mỗi pod)
  AI Server      : 2 pod GPU (NVIDIA T4) — đủ cho ~50 req/s
  Worker         : 2 pod    (2 vCPU, 4GB)
  PostgreSQL     : 4 vCPU, 16GB RAM, 500GB SSD
  Redis          : 2GB RAM
  Object Storage : ~200GB/năm (ảnh chấm công, lưu 90 ngày)
  Elasticsearch  : 3 node, 100GB

Ước tính lưu trữ ảnh:
  40.000 lượt/ngày × 150KB/ảnh × 90 ngày ≈ 540GB
  → Cần lifecycle policy nghiêm túc, hoặc giảm chất lượng ảnh lưu trữ
```

---

## 4. Độ tin cậy (`NFR-REL`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-REL-01` | Uptime hệ thống | ≥ 99.5%/tháng (tương đương ≤ 3.6 giờ downtime) | Must |
| `NFR-REL-02` | Uptime trong giờ cao điểm | ≥ 99.9% trong khung 07:30–09:00 và 17:00–18:30 | Must |
| `NFR-REL-03` | Sao lưu dữ liệu | Backup tự động hằng ngày, giữ 30 ngày; backup tuần giữ 12 tuần | Must |
| `NFR-REL-04` | Kiểm chứng khôi phục | Diễn tập restore mỗi quý, RTO < 4 giờ, RPO < 1 giờ | Must |
| `NFR-REL-05` | Xử lý AI Server không khả dụng | Backend trả lỗi rõ ràng (`SYS_AI_UNAVAILABLE`), không treo; có circuit breaker | Must |
| `NFR-REL-06` | Job tính công idempotent | Chạy lại nhiều lần cho cùng dữ liệu ra kết quả giống hệt | Must |
| `NFR-REL-07` | Job thất bại có retry | Retry với backoff mũ; sau N lần thất bại đưa vào dead-letter queue và cảnh báo | Must |
| `NFR-REL-08` | Đồng bộ offline | App lưu bản ghi cục bộ khi mất mạng, đồng bộ khi có kết nối, không mất dữ liệu | Should (GĐ 3) |
| `NFR-REL-09` | Không mất bản ghi chấm công | Bản ghi thô bất biến, có backup, có kiểm tra toàn vẹn định kỳ (`BR-06`) | Must |
| `NFR-REL-10` | Graceful degradation | AI Server down → nhân viên vẫn chấm công được bằng vân tay (nếu đã đăng ký) | Should |

### 4.1. Circuit breaker cho AI Server

```
Trạng thái CLOSED (bình thường):
  → Gọi AI Server bình thường

Nếu tỷ lệ lỗi > 50% trong 30 giây HOẶC timeout liên tiếp 5 lần:
  → Chuyển sang OPEN (30 giây)
  → Không gọi AI Server nữa, trả ngay SYS_AI_UNAVAILABLE
  → Cảnh báo Admin
  → App gợi ý nhân viên dùng vân tay thay thế (NFR-REL-10)

Sau 30 giây → HALF_OPEN: thử 1 request
  → Thành công: về CLOSED
  → Thất bại: quay lại OPEN
```

---

## 5. Khả năng theo dõi & vận hành (`NFR-OBS`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-OBS-01` | Ghi log đầy đủ | Mọi request có `traceId`, log dạng JSON có cấu trúc, đẩy vào Elasticsearch | Must |
| `NFR-OBS-02` | Dashboard giám sát cho Admin | Hiển thị chỉ số hạ tầng, ứng dụng, nghiệp vụ, AI theo thời gian thực (PA 5.3, 5.4) | Must |
| `NFR-OBS-03` | Cảnh báo chủ động | Cảnh báo tới kênh trực (Slack/Telegram/email) khi vượt ngưỡng, không đợi user báo | Must |
| `NFR-OBS-04` | Truy vết phân tán | `traceId` xuyên suốt App → Backend → AI Server → Worker | Should |
| `NFR-OBS-05` | Health check từng thành phần | Endpoint `/health` cho mỗi service, kiểm tra cả dependency | Must |
| `NFR-OBS-06` | Theo dõi lỗi runtime | Sentry cho Backend, Web và App; lỗi mới có thông báo | Must |
| `NFR-OBS-07` | Chỉ số nghiệp vụ | Tỷ lệ chấm công thành công, tỷ lệ liveness fail, số cờ gian lận/ngày | Must |
| `NFR-OBS-08` | Log không chứa dữ liệu nhạy cảm | Không log ảnh, embedding, token, OTP, số CMND | Must |

### 5.1. Danh sách cảnh báo bắt buộc

| Cảnh báo | Điều kiện | Mức | Kênh |
|---|---|---|---|
| AI Server chậm | p95 > 2s trong 5 phút | Cao | Trực + Slack |
| AI Server down | Health check fail 3 lần liên tiếp | Nghiêm trọng | Gọi điện + Slack |
| Tỷ lệ chấm công thất bại cao | > 10% trong 10 phút | Cao | Trực + Slack |
| Lỗi 5xx tăng vọt | > 5% request trong 5 phút | Cao | Trực + Slack |
| Queue tồn đọng | `payroll` > 1000 job hoặc chờ > 30 phút | Trung bình | Slack |
| Đột biến cờ gian lận | > 3× trung bình 7 ngày | Cao | Slack + email HR |
| Brute-force OTP | > 20 lần sai từ 1 IP/10 phút | Cao | Slack |
| Dung lượng DB | > 80% | Trung bình | Slack |
| Backup thất bại | Job backup fail | Nghiêm trọng | Trực |
| Chứng chỉ TLS sắp hết hạn | Còn < 14 ngày | Trung bình | Slack |

---

## 6. Khả năng sử dụng (`NFR-UX`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-UX-01` | Chấm công trong tối đa 3 thao tác | Mở app → bấm chấm công → xác thực khuôn mặt | Must |
| `NFR-UX-02` | Mọi lỗi có hướng dẫn khắc phục cụ thể | Không hiển thị mã lỗi kỹ thuật cho người dùng cuối (PA 2.2) | Must |
| `NFR-UX-03` | Hỗ trợ tiếng Việt đầy đủ | Toàn bộ giao diện và thông báo, kể cả thông báo lỗi | Must |
| `NFR-UX-04` | Đa ngôn ngữ | Kiến trúc i18n sẵn sàng, tiếng Anh ở giai đoạn 2 | Should |
| `NFR-UX-05` | Web Quản lý dùng được trên tablet | Responsive từ 768px trở lên | Should |
| `NFR-UX-06` | Skeleton loading | Mọi màn hình có gọi API, không để màn hình trắng | Should |
| `NFR-UX-07` | Xác nhận hai bước cho thao tác nguy hiểm | Chốt kỳ lương, xoá nhân viên, huỷ công, reset sinh trắc học | Must |
| `NFR-UX-08` | Chế độ tối (dark mode) trên App | Theo cài đặt hệ thống + chọn thủ công | Could |
| `NFR-UX-09` | Khả năng tiếp cận (accessibility) | Độ tương phản đạt WCAG AA, hỗ trợ đọc màn hình cho chức năng chính | Could |

---

## 7. Khả năng bảo trì (`NFR-MAINT`)

| Mã | Yêu cầu | Tiêu chí đo | Ưu tiên |
|---|---|---|---|
| `NFR-MAINT-01` | Độ phủ unit test | ≥ 70% tổng thể; **≥ 90% cho module `payroll`** (engine tính công) | Must |
| `NFR-MAINT-02` | Integration test cho luồng chính | Chấm công, tạo/duyệt đơn, tính công, chốt kỳ | Must |
| `NFR-MAINT-03` | Không có lỗi typecheck/lint khi merge | CI chặn merge nếu fail | Must |
| `NFR-MAINT-04` | Tài liệu API tự sinh | Swagger cập nhật tự động từ code, luôn khớp thực tế | Must |
| `NFR-MAINT-05` | Cấu hình qua biến môi trường | Không hard-code URL, secret, ngưỡng vào mã nguồn | Must |
| `NFR-MAINT-06` | Migration có thể rollback | Mọi migration có kịch bản hoàn tác, test trên staging trước | Must |
| `NFR-MAINT-07` | Không dùng `any` trong TypeScript | ESLint rule `no-explicit-any` ở mức error | Should |
| `NFR-MAINT-08` | Chuẩn commit và review | Conventional Commits, mọi PR cần ≥ 1 review | Should |

### 7.1. Vì sao module `payroll` cần độ phủ 90%

Engine tính công là nơi **sai một dòng = sai lương hàng trăm người**. Các trường hợp bắt buộc có test:

```
✓ Ca hành chính bình thường                ✓ Ca đêm vắt qua nửa đêm
✓ Ca gãy (nhiều đoạn)                       ✓ Ca linh hoạt theo tổng giờ
✓ Đi muộn trong/ngoài ngưỡng cho phép      ✓ Về sớm
✓ Quên chấm ra                              ✓ Nhiều cặp vào/ra trong ngày
✓ OT ngày thường / cuối tuần / ngày lễ     ✓ OT không có đơn duyệt trước
✓ Nghỉ phép nguyên ngày / nửa ngày          ✓ Nghỉ không lương
✓ Ngày lễ trùng cuối tuần, có nghỉ bù      ✓ Đơn duyệt ngược về quá khứ
✓ Đổi cấu hình ca giữa tháng                ✓ Làm bù dở dang, gộp nhiều lần
✓ Nhân viên vào/nghỉ giữa tháng             ✓ Đổi múi giờ / DST (nếu có chi nhánh nước ngoài)
✓ Kỳ lương đã chốt (phải bị chặn)          ✓ Chạy lại job 2 lần (idempotent)
```

---

## 8. Tuân thủ pháp lý (`NFR-LEGAL`)

| Mã | Yêu cầu | Nguồn |
|---|---|---|
| `NFR-LEGAL-01` | Dữ liệu sinh trắc học được xử lý theo quy định về **dữ liệu cá nhân nhạy cảm**: cần sự đồng ý riêng biệt, rõ ràng, có thể rút lại | Nghị định 13/2023/NĐ-CP |
| `NFR-LEGAL-02` | Thông báo minh bạch cho người lao động: thu thập dữ liệu gì, mục đích, thời gian lưu, ai được truy cập | Nghị định 13/2023/NĐ-CP |
| `NFR-LEGAL-03` | Quyền của chủ thể dữ liệu: xem, sửa, xoá, rút lại sự đồng ý, phản đối xử lý | Nghị định 13/2023/NĐ-CP |
| `NFR-LEGAL-04` | Chính sách lưu trữ và xoá dữ liệu rõ ràng, thực thi tự động | Nghị định 13/2023/NĐ-CP |

> **`NFR-LEGAL-04` — đã thực thi.** Ba khoá chính sách
> (`privacy.attendancePhotoRetentionDays` mặc định 90 ngày,
> `privacy.deleteBiometricDelayDays`, `privacy.exportFileRetentionDays`) được
> `RetentionProcessor` áp dụng **tự động hằng đêm**, không phải làm tay.
>
> Mỗi lần xoá ghi một dòng audit `RETENTION_PURGE` kèm số lượng và mốc thời
> gian — đây là thứ dùng để giải trình với thanh tra rằng việc xoá là tự động
> và đúng hạn.
>
> **Nguyên tắc: giữ BẢN GHI, chỉ xoá ẢNH.** `NFR-LEGAL-08` yêu cầu lưu chứng từ
> chấm công phục vụ thanh tra lao động, còn mục này yêu cầu xoá dữ liệu sinh
> trắc học đúng hạn. Hai điều đó chỉ mâu thuẫn nếu coi ảnh và bản ghi là một:
> `AttendanceLog` (giờ, vị trí, quyết định) giữ vĩnh viễn vì đó là chứng từ;
> ảnh khuôn mặt là dữ liệu sinh trắc học và bị xoá sau thời hạn lưu.
>
> Ảnh quá hạn còn bị chặn ở tầng phục vụ: `GET /v1/attendance/{id}` trả
> `photoUrl: null` chứ không trả URL trỏ tới đối tượng đã xoá.
>
> ⚠ Tệp đính kèm đơn từ (`requests/`) **chưa** có chính sách — đó là hồ sơ lao
> động theo `NFR-LEGAL-08`, cần pháp chế chốt thời hạn trước khi thi công.
| `NFR-LEGAL-05` | Hệ số OT tuân thủ tối thiểu theo luật: ngày thường ≥ 150%, ngày nghỉ hằng tuần ≥ 200%, ngày lễ ≥ 300% | Bộ luật Lao động 2019, Điều 98 |
| `NFR-LEGAL-06` | Giới hạn giờ làm thêm: không quá 50% giờ làm bình thường/ngày, 40 giờ/tháng, 200 giờ/năm (một số ngành 300 giờ) | Bộ luật Lao động 2019, Điều 107 |
| `NFR-LEGAL-07` | Phép năm tối thiểu 12 ngày/năm với điều kiện làm việc bình thường | Bộ luật Lao động 2019, Điều 113 |
| `NFR-LEGAL-08` | Lưu trữ chứng từ chấm công phục vụ thanh tra lao động và tranh chấp | Quy định về lưu trữ chứng từ kế toán |
| `NFR-LEGAL-09` | Nếu khách hàng yêu cầu, dữ liệu đặt tại Việt Nam | Luật An ninh mạng |

> **Cảnh báo thi công:** hệ thống nên **cảnh báo khi cấu hình vi phạm luật** — ví dụ công ty đặt hệ số OT ngày lễ là 200% (dưới mức 300% luật định) thì hiển thị cảnh báo, hoặc chặn nếu chính sách sản phẩm quyết định như vậy. Đây là giá trị gia tăng thật cho khách hàng.

---

## 9. Ma trận NFR × Thành phần

| NFR | App | Web | Backend | AI Server | Hạ tầng |
|---|:---:|:---:|:---:|:---:|:---:|
| `NFR-SEC-01` Mã hoá at-rest | | | ✓ | | ✓ |
| `NFR-SEC-02` TLS | ✓ | ✓ | ✓ | ✓ | ✓ |
| `NFR-SEC-05` Cách ly tenant | | | ✓ | | ✓ |
| `NFR-SEC-07` Không lưu vân tay | ✓ | | ✓ | | |
| `NFR-PERF-01` Nhận diện < 2s | ✓ | | ✓ | ✓ | ✓ |
| `NFR-PERF-07` Tính công < 5 phút | | | ✓ | | ✓ |
| `NFR-SCALE-02` AI scale độc lập | | | | ✓ | ✓ |
| `NFR-REL-05` Xử lý AI down | ✓ | | ✓ | | |
| `NFR-REL-06` Job idempotent | | | ✓ | | |
| `NFR-OBS-01` Log có traceId | ✓ | ✓ | ✓ | ✓ | ✓ |
| `NFR-UX-02` Lỗi có hướng dẫn | ✓ | ✓ | ✓ | | |
| `NFR-MAINT-01` Độ phủ test | ✓ | ✓ | ✓ | ✓ | |
| `NFR-LEGAL-01` Dữ liệu sinh trắc học | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 10. Checklist nghiệm thu trước go-live

### Bảo mật
- [ ] Quét lỗ hổng không còn mức High/Critical
- [ ] Test cách ly tenant PASS 100%
- [ ] SSL Labs đạt A+
- [ ] Không có secret trong mã nguồn
- [ ] Rule chặn UPDATE/DELETE trên `audit_log` và `attendance_log` hoạt động
- [ ] Presigned URL cho ảnh hết hạn đúng thời gian

### Hiệu năng
- [ ] Load test giờ cao điểm PASS (`NFR-PERF-11`)
- [ ] p95 nhận diện khuôn mặt < 2000ms
- [ ] Tính công 500 nhân viên < 5 phút
- [ ] Dashboard tải < 2s

### Độ chính xác AI
- [ ] Đã đo FAR/FRR trên **dữ liệu thật của khách hàng** (không dùng ngưỡng mặc định)
- [ ] Ngưỡng đã hiệu chỉnh và ghi lại lý do
- [ ] Test liveness với ảnh in, video màn hình, mặt nạ giấy đều bị từ chối

### Nghiệp vụ
- [ ] Toàn bộ test case engine tính công PASS (mục 7.1)
- [ ] Luồng chốt kỳ lương có báo cáo tiền chốt hoạt động đúng
- [ ] Đơn duyệt ngược quá khứ tính lại đúng

### Vận hành
- [ ] Backup tự động chạy và đã diễn tập restore thành công
- [ ] Toàn bộ cảnh báo ở mục 5.1 đã cấu hình và test kích hoạt
- [ ] Runbook xử lý sự cố đã viết cho: AI Server down, DB đầy, queue tồn đọng
- [ ] Health check phát hiện được từng thành phần down

### Pháp lý
- [ ] Chính sách bảo mật dữ liệu sinh trắc học đã có và hiển thị trong App
- [ ] Cơ chế đồng ý riêng cho dữ liệu sinh trắc học đã triển khai
- [ ] Quy trình xoá dữ liệu theo yêu cầu đã test
- [ ] Cấu hình OT mặc định tuân thủ Bộ luật Lao động

---

**Tiếp theo:** [10 — Lộ trình triển khai](./10-lo-trinh-trien-khai.md)
