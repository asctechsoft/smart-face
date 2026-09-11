# 07 — Nghiệp vụ Web Quản trị nền tảng (Platform Admin)

> **Nguồn chuẩn:** Tài liệu nghiệp vụ SmartFace **v2.1**, Chương VII.
> Actor: `ACT-PAD` (Admin nền tảng) — phạm vi **toàn hệ thống SaaS, mọi tenant**.
> Nền tảng: React + TypeScript. **Nên tách deployment/domain riêng** khỏi Web Kế
> toán / Web Giám đốc để tăng bảo mật cho admin platform (`ADR-03`).

Web Quản trị nền tảng phục vụ **đội vận hành SmartFace**, tách khỏi quyền của
từng công ty. Mục tiêu: nắm được toàn bộ tenant đang sử dụng hệ thống, theo dõi
sức khoẻ dịch vụ, AI Server, bảo mật và **xử lý sự cố có kiểm soát**.

> ### Platform Admin ≠ Owner công ty
>
> Đây là ranh giới quan trọng nhất của phân hệ này. **Owner** là quyền cao nhất
> *trong một tenant* và quản lý doanh nghiệp của mình. **Platform Admin** vận
> hành hạ tầng SaaS và **không có quyền nghiệp vụ trong tenant** — trừ khi mở
> [Support Access Mode](#11-chế-độ-hỗ-trợ-tenant-có-kiểm-soát-fr-adm-sup) có mục
> đích, thời hạn và audit.

> ⚠ **LUỒNG XÁC THỰC.** Chương 2.2 của v2.1 mô tả đăng nhập SĐT + OTP và mã mời.
> Hệ thống đã thi công dùng **Firebase Authentication** — email + mật khẩu, đổi
> ID token lấy phiên Backend qua `POST /auth/session`. Mã mời và TOTP đã bỏ hẳn.
> **MFA bắt buộc** với mọi tài khoản Platform Admin.
>
> Mô tả đúng: [01 mục 11](./01-tong-quan-he-thong.md#11-cấp-tài-khoản-và-gia-nhập-công-ty) ·
> [15 mục 2](./15-hop-dong-api.md#2-api-xác-thực-auth)

---

## Cấu trúc menu

| Menu | Mục con |
|---|---|
| **Dashboard hệ thống** | Tenant active, user active, lượt chấm, lỗi, AI latency, incidents, subscription |
| **Công ty (Tenant)** | Danh sách, tạo mới, chi tiết, trạng thái, giới hạn, cấu hình hỗ trợ |
| **Gói dịch vụ** | Package, feature flags, giới hạn user/storage/AI, giá và chu kỳ |
| **Tài khoản & hỗ trợ** | Tìm tài khoản, trạng thái, reset có kiểm soát, case hỗ trợ |
| **AI Server** | Node/model, health, latency, error, liveness fail, version/rollout/rollback |
| **Sự cố** | Incident, severity, ảnh hưởng tenant, timeline, xử lý, hậu kiểm |
| **Bảo mật** | Login anomaly, brute force, token abuse, app attestation, root/jailbreak metrics |
| **Nhật ký hệ thống** | Application log, audit log, security log, truy vấn theo tenant/request ID |
| **Cấu hình chung** | OTP, SMS provider, push, retention, timeout, feature flags |
| **Hạ tầng** | Health check, database/storage, queue/cache, backup, monitoring |
| **Bảo trì & thông báo** | Maintenance window, thông báo toàn nền tảng hoặc theo tenant |

---

## Dashboard toàn hệ thống (`FR-ADM-DASH`)

| Mã | Khối | Nội dung |
|---|---|---|
| `FR-ADM-DASH-01` | **Tenant** | Số tenant đang hoạt động / thử nghiệm / tạm ngưng; người dùng hoạt động ngày/tháng |
| `FR-ADM-DASH-02` | **Lưu lượng chấm công** | Lượt chấm theo phút/giờ, peak traffic, tỷ lệ thành công/thất bại |
| `FR-ADM-DASH-03` | **AI Server** | Request rate, p50/p95 latency, GPU/CPU/RAM, error rate, liveness fail rate |
| `FR-ADM-DASH-04` | **Hạ tầng** | Backend / Database / Queue / Storage / SMS / Push health |
| `FR-ADM-DASH-05` | **Sự cố** | Incident đang mở theo Sev1/Sev2/Sev3; tenant bị ảnh hưởng |
| `FR-ADM-DASH-06` | **Subscription** | Tenant sắp hết hạn, vượt giới hạn gói, storage tăng nhanh |

---

## Nguyên tắc chi phối phân hệ Admin

| # | Nguyên tắc | Lý do |
|---|---|---|
| **A1** | Admin nền tảng có quyền **xem xuyên tenant**, nhưng mọi truy cập dữ liệu nghiệp vụ của một công ty cụ thể đều **ghi audit log** kèm lý do. | Admin là tài khoản quyền lực nhất — cũng là rủi ro lớn nhất. Không có "xem lén không dấu vết". |
| **A2** | Admin **không tự ý sửa dữ liệu chấm công/lương** của công ty. Chỉ can thiệp khi có sự cố kỹ thuật, có ticket, có ghi log. | Tránh trách nhiệm pháp lý khi tranh chấp lao động. |
| **A3** | Mọi thao tác nhạy cảm (xoá dữ liệu, reset sinh trắc học, đổi quyền, can thiệp công) **bắt buộc nhập lý do** trước khi thực thi. | `BR-08` |
| **A4** | **MFA bắt buộc** cho toàn bộ tài khoản Platform Admin; session ngắn hơn, có IP/device policy. | Chiếm được một tài khoản Admin = chiếm toàn bộ hệ thống. |
| **A5** | **Phân quyền platform riêng biệt**: Support · Security · AI Ops · Billing Ops · Super Admin. Hạn chế "một admin có mọi quyền". | Giảm bán kính thiệt hại khi một tài khoản bị chiếm. |
| **A6** | Mặc định **không xem raw biometric**. Truy cập sample ảnh/embedding phải theo chính sách dữ liệu, có masking/anonymization. | Nghị định 13/2023/NĐ-CP — dữ liệu cá nhân nhạy cảm. |

---

## 1. Quản lý tổ chức — Tenant Management (`FR-ADM-TEN`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-TEN-01` | Danh sách toàn bộ công ty (tenant) đang sử dụng hệ thống | Must |
| `FR-ADM-TEN-02` | Tạo tenant mới: tên công ty, **mã công ty** (bất biến), mã số thuế, timezone, admin đầu tiên | Must |
| `FR-ADM-TEN-03` | Quản lý gói dịch vụ: gói dùng thử, gói trả phí | Must (GĐ 2) |
| `FR-ADM-TEN-04` | Giới hạn theo gói: số nhân viên tối đa, tính năng được bật | Must (GĐ 2) |
| `FR-ADM-TEN-05` | Quản lý thanh toán và gia hạn | Should (GĐ 2) |
| `FR-ADM-TEN-06` | Tạm ngưng công ty vi phạm điều khoản hoặc quá hạn thanh toán | Must |
| `FR-ADM-TEN-07` | Xem thống kê sử dụng theo tenant (số nhân viên, lượt chấm công/tháng, dung lượng ảnh) | Should |

### 1.1. Vòng đời tenant

```
   ┌─────────┐  kích hoạt  ┌────────┐  quá hạn / vi phạm  ┌────────────┐
   │ TRIAL   │────────────►│ ACTIVE │────────────────────►│ SUSPENDED  │
   │(dùng thử)│            │        │◄────────────────────│ (tạm ngưng)│
   └────┬────┘             └───┬────┘     thanh toán      └─────┬──────┘
        │ hết hạn thử             │ huỷ hợp đồng                 │
        └────────────────────────►┴──────────────────────────────┘
                                  ▼
                          ┌────────────────┐
                          │  TERMINATED    │  → khoá truy cập, giữ dữ liệu
                          │  (chấm dứt)    │     N ngày rồi xoá theo chính sách
                          └────────────────┘
```

**Khi tenant ở trạng thái `SUSPENDED`:**

- Nhân viên **không đăng nhập / không chấm công được** → App hiển thị `INVITE_COMPANY_SUSPENDED`.
- Web Quản lý chỉ vào được màn hình thông báo và thanh toán.
- **Dữ liệu được giữ nguyên**, không xoá — khôi phục lại được ngay khi thanh toán.

**Khi tenant `TERMINATED`:**

- Cung cấp cơ chế **xuất toàn bộ dữ liệu** cho khách hàng trước khi xoá (nghĩa vụ với khách hàng và tuân thủ quyền chuyển dữ liệu).
- Sau thời gian giữ (cấu hình, ví dụ 90 ngày) → xoá dữ liệu sinh trắc học và ảnh, giữ log ẩn danh phục vụ đối soát.

### 1.2. Cấu hình gói dịch vụ

| Thuộc tính gói | Ví dụ |
|---|---|
| Số nhân viên tối đa | 50 / 200 / 1000 / không giới hạn |
| Số chi nhánh tối đa | 1 / 5 / không giới hạn |
| Số lượt nhận diện khuôn mặt/tháng | Có hạn mức → cần đếm và cảnh báo khi sắp vượt |
| Dung lượng lưu ảnh | 10GB / 100GB |
| Thời gian lưu ảnh chấm công | 30 / 90 / 365 ngày |
| Tính năng bật/tắt | Ca xoay, làm bù, OT nâng cao, đa chi nhánh, API tích hợp |
| Hỗ trợ | Email / Ưu tiên / Có SLA |

> **Yêu cầu thi công:** giới hạn gói phải được **enforce ở tầng Backend**, không chỉ ẩn nút ở UI. Ví dụ: tạo nhân viên thứ 51 trên gói 50 người phải bị chặn ở API với mã lỗi rõ ràng.

---

## 2. Quản lý người dùng toàn hệ thống (`FR-ADM-USR`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-USR-01` | Tìm kiếm tài khoản trên toàn hệ thống (theo SĐT, mã NV, tên, công ty) | Must |
| `FR-ADM-USR-02` | Khoá/mở khoá tài khoản bất kỳ | Must |
| `FR-ADM-USR-03` | Reset thủ công xác thực khuôn mặt/vân tay | Must |
| `FR-ADM-USR-04` | Thu hồi liên kết thiết bị (khi mất máy, đổi máy) | Must |
| `FR-ADM-USR-05` | Đổi số điện thoại của tài khoản (khi nhân viên đổi số) | Must |
| `FR-ADM-USR-06` | Xử lý khiếu nại chấm công/tài khoản mà Quản lý công ty không tự xử lý được | Must |
| `FR-ADM-USR-07` | Xem lịch sử hoạt động của một tài khoản (đăng nhập, chấm công, thiết bị) | Must |

### 2.1. Luồng reset sinh trắc học (thao tác nhạy cảm)

```
Admin nhận yêu cầu hỗ trợ (mất thiết bị / đổi SĐT / nhận diện sai liên tục)
  ▼
Tìm tài khoản, xem lịch sử hoạt động để đối chiếu
  ▼
BẮT BUỘC: nhập lý do + mã ticket hỗ trợ (A3)
  ▼
Chọn hành động:
   ☐ Xoá embedding khuôn mặt (nhân viên phải đăng ký lại)
   ☐ Thu hồi khoá vân tay (nhân viên phải đăng ký lại)
   ☐ Thu hồi liên kết thiết bị
   ☐ Thu hồi toàn bộ token đang hoạt động
  ▼
Xác nhận hai bước (nhập lại mã nhân viên để xác nhận đúng người)
  ▼
Thực thi + GHI AUDIT LOG (BR-08)
  ▼
Gửi thông báo tới: nhân viên + HR công ty
```

> **Đây là điểm tấn công nội bộ nguy hiểm nhất.** Một Admin có thể reset khuôn mặt của bất kỳ ai rồi đăng ký khuôn mặt khác. Vì vậy: bắt buộc lý do, xác nhận hai bước, audit log, và **thông báo tự động cho HR công ty** — để công ty biết ngay nếu có can thiệp bất thường.

---

## 3. Giám sát AI Server & hệ thống nhận diện (`FR-ADM-AI`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-AI-01` | Theo dõi log nhận diện: tỷ lệ thành công/thất bại | Must |
| `FR-ADM-AI-02` | Tỷ lệ nghi ngờ giả mạo (liveness fail) theo thời gian | Must |
| `FR-ADM-AI-03` | Giám sát hiệu năng: thời gian phản hồi p50/p95/p99, tình trạng quá tải | Must |
| `FR-ADM-AI-04` | Theo dõi chỉ số false positive / false negative | Should |
| `FR-ADM-AI-05` | Quản lý phiên bản model (model version) | Must |
| `FR-ADM-AI-06` | Triển khai cập nhật model mới, rollback khi cần | Must |
| `FR-ADM-AI-07` | Điều chỉnh ngưỡng nhận diện toàn cục và theo từng công ty | Must |

### 3.1. Dashboard giám sát AI

```
┌──────────────────────────────────────────────────────────────────┐
│  AI SERVER · Model: buffalo_l v2.1 · Uptime 14d 6h    [Health ✓] │
├──────────────────┬──────────────────┬────────────────────────────┤
│ Lượt xử lý/giờ   │ Tỷ lệ thành công │  Latency (p95)             │
│     1,247        │      94.2%       │     187ms   ✓ (< 2000ms)   │
├──────────────────┴──────────────────┴────────────────────────────┤
│  Phân loại thất bại (24h)                                        │
│  FACE_NOT_FOUND        ████████        312  (42%)                │
│  FACE_LOW_LIGHT        █████           189  (25%)                │
│  FACE_LIVENESS_FAILED  ███              98  (13%)  ⚠ theo dõi    │
│  FACE_BLURRY           ███              87  (12%)                │
│  SYS_AI_TIMEOUT        █                61  ( 8%)                │
├──────────────────────────────────────────────────────────────────┤
│  Tài nguyên: GPU 62%  ·  RAM 4.2/8GB  ·  Queue depth 3           │
├──────────────────────────────────────────────────────────────────┤
│  ⚠ Cảnh báo: Công ty XYZ có tỷ lệ liveness fail 31% (bình thường │
│     ~10%) trong 3 ngày liên tiếp → kiểm tra ngưỡng hoặc gian lận  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2. Quản lý phiên bản model

```
Model đang chạy:  buffalo_l  v2.1   (từ 15/07/2026)
Model dự phòng:   buffalo_l  v2.0   (rollback được ngay)

Quy trình cập nhật model:
  1. Upload model mới lên môi trường staging
  2. CHẠY BỘ ĐO CHUẨN trên tập dữ liệu kiểm định:
       - FAR (False Acceptance Rate) — nhận nhầm người khác
       - FRR (False Rejection Rate)  — từ chối đúng người
       - Latency p95
  3. So sánh với model hiện tại → chỉ triển khai nếu KHÔNG XẤU ĐI
  4. Triển khai canary: 10% traffic → theo dõi 24h → 100%
  5. Giữ model cũ sẵn sàng rollback trong tối thiểu 7 ngày
```

> **Bắt buộc:** đổi model làm **thay đổi phân bố điểm tương đồng** — ngưỡng cũ có thể không còn đúng. Phải hiệu chỉnh lại ngưỡng cùng lúc với đổi model, không được đổi riêng lẻ. Xem `00-kien-thuc-nen-tang.md` Phần 2.

### 3.3. Điều chỉnh ngưỡng

```
Ngưỡng toàn cục (mặc định cho tenant mới):
   face_match_threshold (1:1)  : 0.45   [────●──────]
   liveness_threshold          : 0.70   [──────●────]
   min_face_pixels             : 112

Ngưỡng riêng theo công ty:
   ┌──────────────┬──────────┬───────────┬─────────────────────────┐
   │ Công ty      │ Match    │ Liveness  │ Lý do điều chỉnh        │
   ├──────────────┼──────────┼───────────┼─────────────────────────┤
   │ AMOBI        │ 0.45     │ 0.70      │ mặc định                │
   │ XYZ Co.      │ 0.50     │ 0.75      │ nghi ngờ chấm hộ nhiều  │
   │ Nhà máy ABC  │ 0.42     │ 0.65      │ điều kiện ánh sáng kém  │
   └──────────────┴──────────┴───────────┴─────────────────────────┘

⚠ Hạ ngưỡng match → tăng FAR (dễ bị nhận nhầm/chấm hộ)
⚠ Tăng ngưỡng match → tăng FRR (nhân viên thật bị từ chối, gây phàn nàn)
```

Mỗi lần đổi ngưỡng đều ghi audit log kèm lý do và người thực hiện.

---

## 4. Giám sát hệ thống & bảo mật (`FR-ADM-SEC`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-SEC-01` | Nhật ký toàn bộ request hệ thống, lỗi hệ thống theo thời gian thực | Must |
| `FR-ADM-SEC-02` | Cảnh báo đăng nhập bất thường | Must |
| `FR-ADM-SEC-03` | Phát hiện và cảnh báo tấn công brute-force OTP | Must |
| `FR-ADM-SEC-04` | Cảnh báo truy cập trái phép (gọi API không đúng quyền, thăm dò endpoint) | Must |
| `FR-ADM-SEC-05` | Audit log: mọi thao tác nhạy cảm kèm người thực hiện, thời điểm, dữ liệu cũ/mới | Must |
| `FR-ADM-SEC-06` | Tra cứu audit log theo người dùng, công ty, loại thao tác, khoảng thời gian | Must |
| `FR-ADM-SEC-07` | Xuất audit log phục vụ kiểm toán | Should |

### 4.1. Danh mục thao tác bắt buộc ghi audit log

| Nhóm | Thao tác |
|---|---|
| Tài khoản | Tạo/khoá/mở khoá tài khoản, đổi SĐT, đổi vai trò, đổi phân quyền |
| Sinh trắc học | Đăng ký, đăng ký lại, reset, xoá embedding, thu hồi khoá vân tay |
| Thiết bị | Liên kết, thu hồi liên kết thiết bị |
| Chấm công | Hiệu chỉnh công thủ công, huỷ công nghi vấn, can thiệp kỹ thuật |
| Đơn từ | Duyệt, từ chối, huỷ đơn đã duyệt |
| Lương | Chốt kỳ, **mở lại kỳ đã chốt**, thay đổi công thức tính |
| Chính sách | Đổi cấu hình ca, hệ số OT, geofence, ngưỡng nhận diện |
| Tenant | Tạo, tạm ngưng, chấm dứt tenant, đổi gói dịch vụ |
| Dữ liệu | Xoá dữ liệu, export dữ liệu hàng loạt |
| Admin | Admin truy cập dữ liệu của một công ty cụ thể (`A1`) |

### 4.2. Cấu trúc bản ghi audit log

```json
{
  "id": "01J8XK...",
  "timestamp": "2026-08-03T08:15:22.431Z",
  "actor": {
    "userId": "usr_...", "name": "Nguyễn Quản Trị",
    "role": "SYSTEM_ADMIN", "ip": "113.161.x.x", "userAgent": "..."
  },
  "action": "BIOMETRIC_RESET",
  "targetType": "EMPLOYEE",
  "targetId": "emp_...",
  "companyId": "cmp_...",
  "reason": "Nhân viên báo mất điện thoại - ticket #4821",
  "before": { "faceProfileCount": 3, "deviceBound": "a3f9..." },
  "after":  { "faceProfileCount": 0, "deviceBound": null },
  "traceId": "01J8XK2M9P..."
}
```

**Yêu cầu:** audit log **chỉ ghi thêm (append-only)**, không cho sửa/xoá kể cả Admin. Lưu song song ở PostgreSQL (truy vấn nghiệp vụ) và Elasticsearch (tìm kiếm toàn văn, giữ lâu dài).

### 4.3. Cảnh báo bảo mật cần có

| Cảnh báo | Điều kiện kích hoạt | Mức độ |
|---|---|---|
| Brute-force OTP | > 20 lần nhập sai từ cùng IP trong 10 phút | Cao |
| Spam gửi OTP | > 10 yêu cầu OTP từ cùng IP/SĐT trong 10 phút | Trung bình |
| Đăng nhập từ vị trí lạ | IP khác quốc gia so với lịch sử của tài khoản | Trung bình |
| Nhiều thiết bị | Một tài khoản chấm công trên 2 thiết bị trong khoảng thời gian ngắn | Cao |
| Thăm dò endpoint | Nhiều request 401/403 liên tiếp từ cùng nguồn | Cao |
| Đột biến cờ gian lận | Số cờ nghi vấn > 3× trung bình 7 ngày | Cao |
| Admin truy cập bất thường | Admin xem dữ liệu > N công ty trong 1 giờ | Trung bình |
| Lỗi hệ thống tăng vọt | Tỷ lệ lỗi 5xx > 5% trong 5 phút | Cao |

---

## 5. Cấu hình chung của hệ thống (`FR-ADM-CFG`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-CFG-01` | Cấu hình nhà cung cấp SMS (SMS Gateway), chuyển đổi nhà cung cấp | Must |
| `FR-ADM-CFG-02` | Giới hạn số lần gửi OTP, thời gian hết hạn OTP | Must |
| `FR-ADM-CFG-03` | Cấu hình timeout kết nối AI Server, ngưỡng cảnh báo lỗi | Must |
| `FR-ADM-CFG-04` | Chính sách lưu trữ dữ liệu sinh trắc học: thời gian lưu, mã hoá, quy trình xoá | Must |
| `FR-ADM-CFG-05` | Cấu hình lifecycle tự động xoá ảnh chấm công quá hạn | Must |
| `FR-ADM-CFG-06` | Cấu hình FCM, email provider | Should |

### 5.1. Cấu hình SMS Gateway

```
Nhà cung cấp chính:  eSMS          [Trạng thái: Hoạt động ✓]
Nhà cung cấp dự phòng: Twilio      [Tự chuyển khi chính lỗi > 3 lần liên tiếp]

Cấu hình OTP:
  - Độ dài mã:              6 chữ số
  - Thời gian hết hạn:      5 phút          [3-10 phút]
  - Số lần nhập sai tối đa: 5 lần           [3-10 lần]
  - Khoá sau khi vượt:      15 phút
  - Khoảng cách gửi lại:    60 giây
  - Số lần gửi lại tối đa:  3 lần/giờ

Theo dõi: tỷ lệ gửi thành công, thời gian tới tay người dùng, chi phí/tháng
```

### 5.2. Chính sách dữ liệu sinh trắc học

Đây là cấu hình có **ràng buộc pháp lý** (Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân).

```
Ảnh khuôn mặt đăng ký (hồ sơ gốc):
  - Lưu trữ:    S3 mã hoá at-rest (AES-256)
  - Thời gian:  Suốt thời gian làm việc + N ngày sau khi nghỉ việc  [mặc định 90]
  - Xoá:        Tự động theo lifecycle + xoá thủ công khi có yêu cầu

Embedding khuôn mặt:
  - Lưu trữ:    PostgreSQL, cột mã hoá hoặc bảng có quyền hạn chế
  - Thời gian:  Như trên
  - Lưu ý:      Embedding KHÔNG tái tạo được ảnh gốc, nhưng vẫn là dữ liệu sinh trắc học

Ảnh mỗi lượt chấm công:
  - Lưu trữ:    S3 mã hoá at-rest
  - Thời gian:  Theo gói dịch vụ  [30 / 90 / 365 ngày]
  - Xoá:        S3 lifecycle policy tự động
  - Truy cập:   Chỉ qua presigned URL, hết hạn sau 5 phút

Khoá vân tay:
  - Lưu trữ:    Chỉ PUBLIC KEY trên server. Private key nằm trong secure enclave thiết bị.
  - Xoá:        Xoá public key khi thu hồi liên kết thiết bị

Quyền của người lao động:
  - Xem dữ liệu của mình
  - Yêu cầu xoá (right to be forgotten)  → xoá sinh trắc học, ẩn danh bản ghi chấm công
  - Rút lại sự đồng ý  → tài khoản chuyển sang chấm công bằng phương thức khác
```

---

## 6. Công cụ hỗ trợ vận hành (`FR-ADM-OPS`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-OPS-01` | Can thiệp thủ công vào dữ liệu chấm công/đơn từ khi có sự cố kỹ thuật | Must |
| `FR-ADM-OPS-02` | Gửi thông báo bảo trì/khẩn tới toàn bộ hoặc một nhóm công ty | Must |
| `FR-ADM-OPS-03` | Health check cho từng thành phần (Backend, AI Server, SMS Gateway, Database, Redis, S3) | Must |
| `FR-ADM-OPS-04` | Kích hoạt chạy lại job tính công cho một khoảng thời gian | Must |
| `FR-ADM-OPS-05` | Xem và quản lý hàng đợi (job đang chờ, job lỗi, retry thủ công) | Must |
| `FR-ADM-OPS-06` | Bật/tắt chế độ bảo trì (maintenance mode) | Should |

### 6.1. Health check dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  TÌNH TRẠNG HỆ THỐNG                        Cập nhật: 08:15:22   │
├─────────────────────┬────────┬───────────┬───────────────────────┤
│ Thành phần          │ T.thái │ Phản hồi  │ Ghi chú               │
├─────────────────────┼────────┼───────────┼───────────────────────┤
│ Backend Core        │  ✓     │   12ms    │ 4/4 pod khoẻ          │
│ AI Server           │  ✓     │  187ms    │ 2/2 pod · GPU 62%     │
│ PostgreSQL          │  ✓     │    3ms    │ Kết nối 45/100        │
│ Redis               │  ✓     │    1ms    │ RAM 1.2/4GB           │
│ Object Storage (S3) │  ✓     │   45ms    │ 234GB đã dùng         │
│ SMS Gateway (eSMS)  │  ⚠     │  2340ms   │ Chậm bất thường       │
│ FCM                 │  ✓     │   89ms    │                       │
│ Elasticsearch       │  ✓     │   23ms    │ 89GB · 12 index       │
├─────────────────────┴────────┴───────────┴───────────────────────┤
│  HÀNG ĐỢI                                                        │
│  payroll      : 12 chờ · 0 lỗi · 1,284 xong hôm nay             │
│  sms          : 3 chờ  · 5 lỗi ⚠ · 892 xong                     │
│  notification : 0 chờ  · 0 lỗi · 3,102 xong                     │
│  export       : 1 chờ  · 0 lỗi · 47 xong                        │
│  ai-batch     : 0 chờ  · 0 lỗi · 120 xong                       │
│                                          [Xem chi tiết job lỗi]  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2. Can thiệp dữ liệu — quy trình bắt buộc

```
Admin nhận báo cáo sự cố (VD: lỗi đồng bộ làm mất 200 bản ghi chấm công ngày 02/08)
  ▼
1. Xác nhận phạm vi ảnh hưởng (công ty nào, nhân viên nào, khoảng thời gian nào)
  ▼
2. TẠO BẢN GHI CAN THIỆP: mô tả sự cố, phạm vi, hành động dự kiến, người phê duyệt
  ▼
3. THÔNG BÁO TRƯỚC cho HR/Admin công ty bị ảnh hưởng
  ▼
4. Thực hiện can thiệp (khôi phục từ log / tạo lại bản ghi / chạy lại job)
  ▼
5. GHI AUDIT LOG chi tiết: dữ liệu trước, dữ liệu sau, câu lệnh đã chạy
  ▼
6. Chạy lại job tính công cho khoảng bị ảnh hưởng
  ▼
7. Báo cáo kết quả cho công ty, xác nhận đã đúng
```

> **A2 nhắc lại:** Admin không sửa dữ liệu chấm công theo yêu cầu miệng. Mọi can thiệp phải có ticket, có thông báo trước cho công ty, có audit log. Dữ liệu chấm công là chứng từ tính lương — sửa sai có hệ quả pháp lý.

### 6.3. Chế độ bảo trì

```
Bật chế độ bảo trì:
  ├─ Phạm vi:     [Toàn hệ thống ▾] / Một số công ty / Chỉ Web (App vẫn chấm công được)
  ├─ Thời gian:   Bắt đầu 02:00 · Kết thúc 04:00 (03/08/2026)
  ├─ Thông báo:   Gửi trước 24h + 1h qua push + email
  └─ Hành vi:     App hiển thị màn hình bảo trì, hàng đợi tạm dừng nhận job mới

⚠ TRÁNH bảo trì trong khung giờ cao điểm: 07:30–09:00 và 17:00–18:30
```

---

---

## 7. Gói dịch vụ & feature flags (`FR-ADM-PKG`)

> **Mới theo v2.1 §7.4.** Bản v1.0 chỉ nhắc "gói dùng thử / gói trả phí".

| Thành phần gói | Ví dụ |
|---|---|
| **Giới hạn nhân viên** | 50 / 200 / 1000 / custom |
| **Tính năng** | Face attendance, fingerprint, OT, advanced reports, multi-branch, API integration |
| **AI quota** | Số lượt nhận diện/ngày hoặc theo user |
| **Storage** | Dung lượng ảnh/file hoặc thời gian lưu |
| **Support SLA** | Standard / Priority / Enterprise |
| **Feature flag** | Bật tính năng beta cho **một tenant** mà không ảnh hưởng tenant khác |

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-PKG-01` | Định nghĩa package: giới hạn, tính năng, giá, chu kỳ thanh toán | Must (GĐ 2) |
| `FR-ADM-PKG-02` | Gán package cho tenant; đổi package có ngày hiệu lực | Must (GĐ 2) |
| `FR-ADM-PKG-03` | **Giới hạn cưỡng chế ở Backend**, không chỉ ẩn nút ở UI | Must |
| `FR-ADM-PKG-04` | Feature flag theo tenant/cohort, bật/tắt không cần deploy | Should |
| `FR-ADM-PKG-05` | Cảnh báo tenant sắp chạm/vượt giới hạn trước khi bị chặn | Must |
| `FR-ADM-PKG-06` | Báo cáo usage theo tenant: user active, attendance volume, storage, chi phí AI ước tính | Should |

---

## 8. Quản lý sự cố — Incident Management (`FR-ADM-INC`)

> **Mới theo v2.1 §7.7.**

| Trường | Nội dung |
|---|---|
| **Severity** | `Sev1`: toàn hệ thống/nghiêm trọng · `Sev2`: nhiều tenant · `Sev3`: tenant/feature đơn lẻ |
| **Phạm vi ảnh hưởng** | Service, tenant, khu vực, phiên bản app/web |
| **Timeline** | Phát hiện → xác nhận → mitigation → fix → recovery → close |
| **Owner xử lý** | Nhóm/nhân sự trực tiếp xử lý |
| **Workaround** | Hướng dẫn tạm thời cho tenant |
| **Postmortem** | Root cause, dữ liệu ảnh hưởng, hành động phòng ngừa tái diễn |

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-INC-01` | Tạo/cập nhật incident với đủ trường trên | Must |
| `FR-ADM-INC-02` | Từ incident **link tới log, trace, AI metric** và danh sách tenant ảnh hưởng | Must |
| `FR-ADM-INC-03` | Gửi thông báo bảo trì/khẩn **chỉ đến tenant bị ảnh hưởng**, không nhất thiết broadcast toàn hệ thống | Must |
| `FR-ADM-INC-04` | Sau incident dữ liệu chấm công: cung cấp công cụ **reconcile/replay an toàn** thay vì sửa thủ công hàng loạt | Must |
| `FR-ADM-INC-05` | Postmortem bắt buộc với Sev1/Sev2 trước khi đóng incident | Should |

> **Không sửa tay hàng loạt.** Đây là điểm khác biệt so với `FR-ADM-OPS-01`: can
> thiệp một vài bản ghi thì dùng quy trình ở mục 6.2; hỏng hàng nghìn bản ghi thì
> phải có công cụ replay có thể kiểm chứng và hoàn tác.

---

## 9. Log, Audit & truy vết (`FR-ADM-LOG`)

| Loại log | Mục đích |
|---|---|
| **Application log** | Lỗi backend/web/app service |
| **Access log** | Request, endpoint, response code, latency, tenant, request ID |
| **Security log** | Login fail, token invalid, anomaly, IP/device |
| **Audit log** | Thao tác nghiệp vụ nhạy cảm và thay đổi cấu hình |
| **AI log** | Model version, score, liveness result, latency, error code |
| **Incident log** | Timeline xử lý sự cố |

> ### Correlation ID
>
> Mỗi request phải có **request/correlation ID xuyên Backend → AI Server → Queue
> → Log**, để Admin truy vết một lượt chấm công hoặc một sự cố từ đầu đến cuối.
> Không có ID này thì việc điều tra một lượt chấm bất thường trở thành đoán mò.

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-LOG-01` | Truy vấn log theo tenant, request ID, employee, khoảng thời gian | Must |
| `FR-ADM-LOG-02` | **Audit log bất biến** — không sửa/xoá kể cả bởi Super Admin (`BR-08`) | Must |
| `FR-ADM-LOG-03` | Retention theo loại log và theo gói dịch vụ / yêu cầu pháp lý | Must |
| `FR-ADM-LOG-04` | Cảnh báo thao tác nhạy cảm: export dữ liệu lớn, support access, reset biometrics, thay model AI | Must |

---

## 10. Health, Backup & Disaster Recovery (`FR-ADM-DR`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-DR-01` | Health check riêng cho Backend, AI, Database, Redis/Queue, Object Storage, SMS, Push | Must |
| `FR-ADM-DR-02` | Backup database theo lịch, **và kiểm thử restore định kỳ** — không chỉ kiểm tra "backup đã chạy" | Must |
| `FR-ADM-DR-03` | RPO/RTO định nghĩa theo gói hoặc mục tiêu vận hành | Must |
| `FR-ADM-DR-04` | Dashboard dung lượng storage, database growth, queue backlog, cảnh báo **trước** khi chạm ngưỡng | Must |
| `FR-ADM-DR-05` | Runbook sự cố phổ biến: AI down, DB high latency, queue stuck, SMS provider lỗi, storage unavailable | Should |

> **"Backup đã chạy" không phải là backup.** Một bản backup chưa từng restore thử
> là một giả định, không phải một biện pháp. `FR-ADM-DR-02` yêu cầu restore test
> định kỳ và ghi lại kết quả.

---

## 11. Chế độ hỗ trợ tenant có kiểm soát (`FR-ADM-SUP`)

> **Mới theo v2.1 §7.12.** Đây là cách dung hoà giữa *"nắm được toàn bộ các công
> ty đang dùng hệ thống để còn xử lý khi gặp sự cố"* và **quyền riêng tư của
> khách hàng**.

Thay vì cho Admin nhìn toàn bộ dữ liệu bất kỳ lúc nào, hệ thống dùng
**Support Access Mode**:

```
1. Admin chọn:  tenant  +  ticket/incident  +  mục đích truy cập  +  thời hạn
        │
        ▼
2. Mặc định CHỈ XEM METADATA VẬN HÀNH
   (số lượt chấm, mã lỗi, trạng thái job, cấu hình — KHÔNG phải nội dung cá nhân)
        │
        ▼
3. Dữ liệu nhạy cảm (ảnh chấm công, embedding sinh trắc học)
   → ẩn, hoặc cần quyền nâng cao + phê duyệt riêng
        │
        ▼
4. MỌI lần mở dữ liệu tenant đều ghi audit
   → gói Enterprise: thông báo cho Owner tenant
        │
        ▼
5. Kết thúc phiên hỗ trợ → quyền tạm thời TỰ HẾT HẠN
```

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-ADM-SUP-01` | Mở phiên support phải khai: tenant, ticket, mục đích, thời hạn | Must |
| `FR-ADM-SUP-02` | Mặc định chỉ metadata vận hành; dữ liệu nhạy cảm cần quyền nâng cao | Must |
| `FR-ADM-SUP-03` | Ghi audit từng lần mở dữ liệu tenant, không chỉ lúc mở phiên | Must |
| `FR-ADM-SUP-04` | Thông báo Owner tenant khi có support access (gói Enterprise) | Should |
| `FR-ADM-SUP-05` | Quyền tạm thời tự hết hạn khi kết thúc phiên hoặc quá thời hạn khai báo | Must |
| `FR-ADM-SUP-06` | Support Action trên dữ liệu tenant (reset device binding, revoke session, yêu cầu đăng ký lại biometrics) đi qua quy trình ticket, **không phải thao tác thông thường** | Must |

---

## 12. Tiêu chí chấp nhận phân hệ Platform Admin

- [ ] Admin xem dữ liệu chấm công của một công ty → có bản ghi audit log ghi nhận việc truy cập đó (`A1`).
- [ ] Reset sinh trắc học không thực hiện được nếu không nhập lý do (`A3`).
- [ ] HR công ty nhận được thông báo tự động khi Admin reset sinh trắc học của nhân viên công ty đó.
- [ ] Tạm ngưng tenant → nhân viên công ty đó không chấm công được ngay, dữ liệu vẫn còn nguyên.
- [ ] Vượt giới hạn số nhân viên theo gói → API tạo nhân viên bị chặn, không chỉ ẩn nút ở UI.
- [ ] Audit log không sửa/xoá được, kể cả bởi tài khoản Admin hệ thống.
- [ ] Health check phát hiện AI Server ngừng hoạt động trong vòng 30 giây và cảnh báo.
- [ ] Rollback model AI về phiên bản trước hoàn tất trong dưới 5 phút.
- [ ] Support access không mở được nếu thiếu ticket, mục đích hoặc thời hạn (`FR-ADM-SUP-01`).
- [ ] Quyền support tự hết hạn đúng thời điểm khai báo, không cần thao tác tay.
- [ ] Raw biometric không hiển thị mặc định trong mọi màn hình Platform Admin (`A6`).
- [ ] Một request chấm công truy vết được xuyên Backend → AI Server → Queue bằng correlation ID.
- [ ] Backup đã được **restore thử** và ghi lại kết quả, không chỉ báo "đã chạy" (`FR-ADM-DR-02`).
- [ ] Vượt giới hạn gói bị chặn ở Backend, không chỉ ẩn nút (`FR-ADM-PKG-03`).
- [ ] Tài khoản Support không thực hiện được thao tác của AI Ops hoặc Billing Ops (`A5`).

---

**Tiếp theo:** [08 — Luồng xuyên phân hệ & Ma trận quyền](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md)
