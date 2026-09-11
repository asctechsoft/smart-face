# 01 — Tổng quan hệ thống SmartFace

> **Nguồn chuẩn:** *Tài liệu mô tả nghiệp vụ SmartFace — phiên bản 2.1, ngày 07/09/2026*
> (`SmartFace_Tai_lieu_nghiep_v2_1_bo_sung_App_Giam_doc.docx`), Chương I.
>
> Tài liệu này chuẩn hoá Chương I và bổ sung mã định danh (`BR-xx`, `ACT-xx`) để
> truy vết từ tài liệu → task → test case.

---

## Thay đổi so với v1.0

Bộ tài liệu trước đây sinh từ PA v1.0 và mô tả **ba phân hệ**: App Nhân viên,
Web Quản lý (gộp Quản lý + Kế toán + HR), Web Admin. Bản v2.1 tách lại thành
**năm nhóm vai trò trên sáu phân hệ giao diện**:

| Thay đổi | Chi tiết |
|---|---|
| Tách trải nghiệm mobile làm ba | App Nhân viên · App Quản lý · **App Giám đốc/Tổng Giám đốc (mới)**. Dùng chung một codebase Flutter, mở module theo `role + permission + scope`. |
| Tách Web Kế toán khỏi Web Giám đốc | Kế toán xử lý số liệu (hồ sơ, dữ liệu công, tính công, chốt kỳ, báo cáo). Kế toán **không mặc định** được sửa chính sách công ty. |
| Bổ sung App Giám đốc | Điều hành nhanh trên mobile: dashboard toàn công ty, phê duyệt cấp cao, kỳ công, cảnh báo. Cấu hình sâu vẫn ở Web Giám đốc. |
| Mở rộng Web Quản trị nền tảng | Thành trung tâm điều hành SaaS: tenant, gói dịch vụ, AI Server, sự cố, bảo mật, log, health check, hỗ trợ tenant có kiểm soát. |
| Chuẩn hoá RBAC + Data Scope | Quyền = vai trò × quyền module × phạm vi dữ liệu × điều kiện nghiệp vụ, thay vì suy quyền từ chức danh. |
| Bổ sung state machine | Trạng thái kỳ công (`OPEN → … → LOCKED → REOPENED`) và trạng thái đơn từ (`DRAFT → … → EFFECTIVE`) được định nghĩa tường minh. |

> **Nguyên tắc tài liệu:** chức năng được ghi *"đề xuất/mở rộng"* không bắt buộc
> nằm trong MVP. Quyền nhạy cảm phải kiểm soát bằng **log và phạm vi dữ liệu**,
> không chỉ bằng ẩn/hiện menu ở giao diện.

---

## 1. Mục tiêu

SmartFace là hệ thống chấm công thông minh theo mô hình **SaaS đa công ty
(multi-tenant)**, kết hợp nhận diện khuôn mặt, sinh trắc học trên thiết bị và
các lớp kiểm soát vị trí/thiết bị. Hệ thống không chỉ ghi nhận lượt vào–ra mà
còn quản lý đơn từ, bảng công, cơ cấu tổ chức, ca làm việc, phân quyền và vận
hành hạ tầng AI.

| Mục tiêu | Kết quả kỳ vọng |
|---|---|
| Một nguồn dữ liệu chấm công trung tâm | Giảm nhập liệu thủ công và sai lệch khi tổng hợp cuối kỳ |
| Phân tách trách nhiệm rõ ràng | Nhân viên thao tác cá nhân · Quản lý duyệt cấp đội nhóm · Giám đốc điều hành và phê duyệt cấp cao · Kế toán xử lý công · Web Giám đốc thiết lập chính sách/quyền · Admin nền tảng vận hành SaaS |
| Cấu hình linh hoạt, không sửa mã nguồn | Chi nhánh / phòng ban / ca làm việc / chính sách khai báo được theo từng tenant |
| Truy vết được mọi thay đổi | Chỉnh sửa công, duyệt đơn, đổi quyền, đổi chính sách đều có audit log |
| Chống gian lận nhiều lớp | Buddy punching, giả mạo GPS, gọi thẳng API, chỉnh giờ thiết bị |
| Mở rộng AI độc lập | AI Server tách riêng để tối ưu GPU và nâng cấp model mà không ảnh hưởng Backend nghiệp vụ |

---

## 2. Phạm vi hệ thống

### 2.1. Trong phạm vi

- **App Mobile (Flutter)** — một codebase phục vụ ba trải nghiệm: Nhân viên, Quản lý, Giám đốc/Tổng Giám đốc.
- **Web Kế toán** — nhân sự, dữ liệu công, tính công, kỳ công, báo cáo/xuất dữ liệu.
- **Web Giám đốc** — cấu hình tổ chức, chính sách, ca/phân ca, luồng duyệt, phân quyền, phê duyệt cấp cao.
- **Web Quản trị nền tảng** — tenant, gói dịch vụ, AI Server, bảo mật, log, sự cố, vận hành.
- **Backend Core** — API, xác thực, nghiệp vụ chấm công/đơn từ/tính công, RBAC + scope, multi-tenant, audit.
- **AI Server** — face detection, embedding, liveness/anti-spoofing, scoring, quản lý phiên bản model.
- **Chống gian lận** xuyên suốt App – Backend – AI Server.

### 2.2. Ngoài phạm vi giai đoạn hiện tại

- Tích hợp trực tiếp phần mềm lương (MISA, FAST) qua API — **giai đoạn 2/3**, hiện xuất Excel theo mẫu.
- Máy chấm công vật lý (kiosk cố định) — có chỗ trong thiết kế (`Device`) nhưng không thi công ở MVP.
- Tự huấn luyện model nhận diện — dùng model mã nguồn mở có sẵn (InsightFace/ArcFace).
- **Tính lương đầy đủ** — sản phẩm hiện dừng ở *tính công*; module Payroll tách riêng ở giai đoạn 3.

---

## 3. Năm nhóm vai trò & sáu phân hệ giao diện

| Mã | Nhóm | Kênh sử dụng | Phạm vi chính | Quyền trọng tâm |
|---|---|---|---|---|
| `ACT-EMP` | **Nhân viên** | App mobile | Cá nhân | Chấm công, gửi đơn, xem lịch sử/bảng công, lịch ca, hồ sơ cá nhân |
| `ACT-MGR` | **Quản lý** | App mobile | Đội nhóm được giao + cá nhân | Toàn bộ quyền nhân viên; duyệt đơn nhân viên; xem tình hình chấm công đội nhóm; có thể được uỷ quyền xếp ca |
| `ACT-ACC` | **Kế toán** | Web Kế toán | Toàn công ty hoặc phạm vi được cấp | Hồ sơ nhân sự, đối soát dữ liệu công, tính công, chốt kỳ, xuất báo cáo |
| `ACT-DIR` | **Giám đốc / Tổng Giám đốc / Owner** | App mobile **+** Web Giám đốc | Toàn công ty trong tenant | *App:* điều hành, theo dõi, phê duyệt cấp cao, cảnh báo, báo cáo nhanh. *Web:* bộ máy, thời gian/ca/phân ca, chính sách, workflow, phân quyền |
| `ACT-PAD` | **Admin nền tảng** | Web Quản trị nền tảng | Toàn hệ thống SaaS | Tenant, gói dịch vụ, AI Server, bảo mật, sự cố, log, vận hành, hỗ trợ |

**Năm vai trò nhưng sáu phân hệ** — vì nhóm Giám đốc dùng hai kênh khác nhau cho
hai mục đích khác nhau: App để *ra quyết định nhanh*, Web để *xác lập luật chơi*.

> **Phân biệt Owner với Admin nền tảng.** `Owner công ty` là quyền cao nhất
> **trong một tenant** và **không phải** Admin nền tảng. Admin nền tảng quản lý
> hệ thống SaaS; Owner chỉ quản lý doanh nghiệp của mình. Hai quyền này không
> bao giờ được gộp làm một trong mã nguồn.

> **Một người, nhiều vai trò.** Một tài khoản có thể đồng thời mang vai trò Nhân
> viên, Quản lý và/hoặc Giám đốc. App tự mở module theo quyền — **không cài ứng
> dụng riêng cho từng vai trò**.

---

## 4. Bản đồ phân hệ

```
                            ┌───────────────────────────┐
                            │        SMARTFACE          │
                            └───────────────────────────┘
                                         │
   ┌──────────────────────────────────────┴─────────────────────────────────┐
   │                                                                        │
   ▼  APP MOBILE — một codebase Flutter, mở module theo permission          │
┌────────────────┬────────────────┬────────────────┐                        │
│ APP NHÂN VIÊN  │  APP QUẢN LÝ   │ APP GIÁM ĐỐC   │                        │
│  (Chương II)   │  (Chương III)  │  (Chương IV)   │                        │
├────────────────┼────────────────┼────────────────┤                        │
│ Trang chủ      │ ⊕ quyền NV     │ ⊕ quyền NV     │                        │
│ Chấm công      │ Dashboard đội  │ Dashboard công │                        │
│ Đơn từ         │ Duyệt đơn NV   │   ty toàn cảnh │                        │
│ Lịch sử        │ Theo dõi đội   │ Trung tâm PD   │                        │
│ Bảng công      │ Bảng công đội  │ Kỳ công        │                        │
│ Lịch làm việc  │ Phân ca (uỷ    │ Nhân sự        │                        │
│ Thông báo      │   quyền)       │ Uỷ quyền nhanh │                        │
│ Cá nhân        │ Nhật ký duyệt  │ Cảnh báo       │                        │
└────────────────┴────────────────┴────────────────┘                        │
                                                                            │
   ▼  WEB                                                                   │
┌────────────────┬────────────────┬───────────────────────┐                 │
│ WEB KẾ TOÁN    │ WEB GIÁM ĐỐC   │ WEB QUẢN TRỊ NỀN TẢNG │                 │
│  (Chương V)    │  (Chương VI)   │     (Chương VII)      │                 │
├────────────────┼────────────────┼───────────────────────┤                 │
│ Nhân sự        │ Tổ chức        │ Tenant                │                 │
│ Dữ liệu công   │ Thời gian làm  │ Gói dịch vụ           │                 │
│ Tính công      │ Ca & phân ca   │ Tài khoản & hỗ trợ    │                 │
│ Kỳ công        │ Chính sách     │ AI Server             │                 │
│ Báo cáo/Export │ Luồng duyệt    │ Sự cố · Bảo mật       │                 │
│ Yêu cầu ĐC     │ Phân quyền     │ Log/Audit             │                 │
│ Nhật ký        │ Owner · Log    │ Health · Backup       │                 │
└────────────────┴────────────────┴───────────────────────┘                 │
                                                                            │
   ▼  XUYÊN SUỐT                                                            │
┌────────────────────────────┬──────────────────────────────┐               │
│ LUỒNG XUYÊN PHÂN HỆ (VIII) │  CHỐNG GIAN LẬN (Chương IX)  │◄──────────────┘
│ Ma trận quyền · Đơn từ ·   │  GPS spoof · Buddy punching  │
│ Bảng công · Onboarding ·   │  Replay/API · Giờ thiết bị · │
│ Cấp quyền/uỷ quyền         │  Thiết bị lạ · Dashboard cờ  │
└────────────────────────────┴──────────────────────────────┘
```

---

## 5. Nguyên tắc phân quyền & phạm vi dữ liệu

Phân quyền triển khai theo mô hình **RBAC kết hợp Data Scope**. Một tài khoản có
thể có nhiều vai trò, và mỗi vai trò có phạm vi dữ liệu khác nhau.

| Lớp quyền | Ý nghĩa | Ví dụ |
|---|---|---|
| **Vai trò** (Role) | Nhóm quyền chức năng | Nhân viên, Quản lý, Kế toán, Giám đốc, Owner, Platform Admin |
| **Quyền module** (Permission) | Được xem/tạo/sửa/duyệt/xuất tại từng chức năng | `attendance.view`, `request.approve`, `payroll.lock`, `role.assign` |
| **Phạm vi dữ liệu** (Scope) | Giới hạn dữ liệu mà quyền đó áp dụng | `SELF`, `TEAM`, `DEPARTMENT`, `BRANCH`, `COMPANY`, `PLATFORM` |
| **Điều kiện nghiệp vụ** | Quyền chỉ có hiệu lực khi thoả điều kiện | Chỉ duyệt đơn của cấp dưới; chỉ sửa kỳ công chưa khoá |
| **Audit** | Ghi lại thao tác nhạy cảm | Ai cấp Owner, ai mở lại kỳ công, ai reset khuôn mặt |

Bốn hệ quả bắt buộc khi thi công:

1. **Kế toán không mặc định** được thay đổi ca / chính sách / phân quyền. Cần thì Giám đốc/Owner cấp thêm đúng permission.
2. Mọi quyền ảnh hưởng dữ liệu toàn công ty phải **kiểm tra ở Backend**, không chỉ dựa vào UI ẩn/hiện menu (`BR-13`).
3. Quyền Owner là quyền đặc biệt: **xác nhận mạnh + audit log**, và không cho tự hạ quyền Owner cuối cùng của tenant (`BR-15`).
4. Chức danh **không tự sinh quyền**. "Trưởng phòng" trong hồ sơ nhân sự không đồng nghĩa với quyền duyệt đơn — quyền phải gán qua role/permission.

Chi tiết ma trận quyền đầy đủ: [08 — Luồng xuyên phân hệ & Ma trận quyền](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md).

---

## 6. Kiến trúc tổng quan

| Thành phần | Vai trò |
|---|---|
| **App Mobile (Flutter)** | Một codebase phục vụ Nhân viên, Quản lý và Giám đốc; mở module theo permission. Chấm công, đơn từ, duyệt, dashboard điều hành, báo cáo nhanh, thông báo. |
| **Web Kế toán** | Nhân sự, dữ liệu công, tính công, kỳ công, báo cáo/xuất dữ liệu. |
| **Web Giám đốc** | Cấu hình tổ chức, chính sách, ca/phân ca, luồng duyệt, phân quyền, phê duyệt cấp cao. |
| **Web Admin nền tảng** | Quản trị tenant, gói dịch vụ, AI Server, bảo mật, log, sự cố, vận hành. |
| **Backend Core** | API, xác thực, nghiệp vụ chấm công/đơn từ/tính công, RBAC, multi-tenant, audit. |
| **AI Server** | Face detection, embedding, liveness/anti-spoofing, scoring, version model. |
| **Hạ tầng phụ trợ** | SMS OTP, Push Notification, Object Storage, Database, Cache/Queue, Monitoring. |

> **Nguyên tắc tách AI.** AI Server độc lập Backend Core để scale GPU riêng,
> quản lý phiên bản model và rollback khi cần. Backend chỉ nhận kết quả AI qua
> giao thức nội bộ có xác thực. (`ADR-01`)

Chi tiết: [11 — Kiến trúc & Technology Stack](./11-kien-truc-va-technology-stack.md).

---

## 7. Danh mục tài liệu

| File | Nội dung | Chương v2.1 |
|---|---|---|
| `01-tong-quan-he-thong.md` | Tổng quan, vai trò, phân quyền, thuật ngữ (tài liệu này) | I |
| `02-nghiep-vu-app-nhan-vien.md` | Nghiệp vụ App Nhân viên | II |
| `03-nghiep-vu-app-quan-ly.md` | Nghiệp vụ App Quản lý | III |
| `04-nghiep-vu-app-giam-doc.md` | Nghiệp vụ App Giám đốc / Tổng Giám đốc | IV |
| `05-nghiep-vu-web-ke-toan.md` | Nghiệp vụ Web Kế toán | V |
| `06-nghiep-vu-web-giam-doc.md` | Nghiệp vụ Web Giám đốc / Owner công ty | VI |
| `07-nghiep-vu-web-platform-admin.md` | Nghiệp vụ Web Quản trị nền tảng | VII |
| `08-luong-xuyen-phan-he-va-ma-tran-quyen.md` | Ma trận quyền & luồng xuyên phân hệ | VIII |
| `09-anti-fraud.md` | Kịch bản gian lận & biện pháp phòng chống | IX |
| `10-yeu-cau-phi-chuc-nang.md` | Yêu cầu phi chức năng & bảo vệ dữ liệu | X |
| `11-kien-truc-va-technology-stack.md` | Kiến trúc, technology stack, ADR | XI |
| `12-lo-trinh-va-nghiem-thu.md` | Lộ trình triển khai & tiêu chí nghiệm thu | XII |
| `13` – `22` | Tài liệu thi công: mô hình dữ liệu, API, luồng chi tiết, style guide, tài khoản test, deploy | (suy dẫn) |

---

## 8. Quy ước định danh yêu cầu

```
FR-<PHÂN HỆ>-<NHÓM>-<SỐ>
     │          │      └── số thứ tự trong nhóm
     │          └───────── nhóm chức năng (AUTH, ATT, REQ, ...)
     └──────────────────── APP | MGR | DIR | ACC | GDW | ADM
```

| Tiền tố phân hệ | Phân hệ | Ghi chú |
|---|---|---|
| `FR-APP-*` | App Nhân viên | |
| `FR-MGR-*` | App Quản lý | mới theo v2.1 |
| `FR-DIR-*` | App Giám đốc | mới theo v2.1 |
| `FR-WEB-*` | Web Kế toán | **giữ tiền tố cũ** — đã tham chiếu rộng trong `web-smart/src`, đổi sẽ kéo theo sửa mã nguồn không cần thiết |
| `FR-GDW-*` | Web Giám đốc | mới theo v2.1 |
| `FR-ADM-*` | Web Quản trị nền tảng | |

Các tiền tố khác: `BR-xx` (quy tắc nghiệp vụ), `AF-xx` (chống gian lận),
`NFR-xx` (phi chức năng), `ADR-xx` (quyết định kiến trúc), `Exx.y` (epic).

---

## 9. Quy tắc nghiệp vụ nền tảng (Business Rules)

Áp dụng **xuyên suốt mọi phân hệ**. Mọi module thi công đều phải tuân thủ.

| Mã | Quy tắc | Nguồn v2.1 |
|---|---|---|
| `BR-01` | **Thời gian chấm công chính thức luôn lấy theo giờ Server** tại thời điểm nhận request. Giờ thiết bị chỉ để hiển thị và phát hiện sai lệch, không bao giờ dùng tính công. | 2.4, 9.4 |
| `BR-02` | **Backend không tin bất kỳ cờ xác thực nào do client tự khai** (ví dụ `faceVerified: true`). Mọi kết quả xác thực phải do Backend tự kiểm chứng với AI Server hoặc secure enclave. | 9.3 |
| `BR-03` | Nhân viên phải đăng ký **ít nhất 1 phương thức xác thực** (khuôn mặt hoặc sinh trắc học thiết bị) trước khi vào Trang chủ và chấm công. Tenant có thể quy định bắt buộc 2 lớp. | 2.3 |
| `BR-04` | **Mã nhân viên bất biến** sau khi đã dùng để chấm công. Muốn đổi phải có quyền đặc biệt và audit log. | 2.2 |
| `BR-05` | **Hệ thống không lưu dữ liệu vân tay thực.** Vân tay/Face ID hệ điều hành xác thực cục bộ; hệ thống chỉ nhận khoá/attestation gắn với thiết bị. | 2.3.2 |
| `BR-06` | Bản ghi chấm công thô **bất biến (immutable)**. Mọi hiệu chỉnh tạo bản ghi điều chỉnh riêng kèm người thực hiện + lý do, không sửa đè. | 5.4 |
| `BR-07` | **Kỳ công đã `LOCKED` bị khoá sửa trực tiếp.** Muốn sửa phải đi qua luồng mở lại kỳ / điều chỉnh hậu kiểm, có lý do và người duyệt. | 5.6, 8.3 |
| `BR-08` | Mọi thao tác nhạy cảm (xoá dữ liệu, reset sinh trắc học, đổi phân quyền, sửa công, chốt/mở kỳ, cấp Owner, support access) đều **ghi audit log** kèm actor, thời điểm và before/after. | 1.3, 6.12 |
| `BR-09` | **Mọi truy vấn dữ liệu nghiệp vụ đều lọc theo `company_id`** của phiên đăng nhập. Không API nào trả dữ liệu chéo tenant, trừ Admin nền tảng qua Support Access Mode có kiểm soát. | 10 |
| `BR-10` | Một khuôn mặt chỉ được đăng ký cho **duy nhất một nhân viên** trong cùng tenant. Trùng khớp với người khác → chặn đăng ký, cảnh báo gian lận danh tính. | 2.3.1 |
| `BR-11` | **Device binding:** mỗi tài khoản chỉ kích hoạt sinh trắc học trên số thiết bị do policy tenant quy định. Đổi thiết bị phải revoke khoá cũ và đăng ký lại. | 2.3.2, 9.5 |
| `BR-12` | Chính sách công ty (giờ ca, grace period, hệ số OT, quy tắc phạt) **cấu hình được, không hard-code**, và **có ngày hiệu lực**. Không sửa ngược cấu hình cũ làm đổi kết quả kỳ đã chốt. | 6.5, 6.8 |
| `BR-13` | **Quyền và phạm vi dữ liệu phải kiểm tra ở Backend trên từng API** (`tenant_id` + `permission` + `scope` + trạng thái item + version). Ẩn/hiện menu ở UI không phải là cơ chế bảo vệ. | 1.3, 4.11 |
| `BR-14` | **Không ai được duyệt yêu cầu của chính mình.** Đơn cá nhân của Quản lý đi lên Giám đốc/Owner; đơn của Giám đốc đi tới Owner khác hoặc người duyệt được cấu hình. Ngoại lệ self-approval phải có policy, đánh dấu rõ và audit riêng. | 3.1, 3.4, 4.4 |
| `BR-15` | **Không thao tác nào được làm tenant mất Owner cuối cùng.** Cấp/thu hồi/chuyển Owner cần xác thực mạnh, audit đầy đủ và thông báo tới các Owner liên quan. | 4.9, 6.11 |
| `BR-16` | **Đơn đã gửi dùng snapshot luồng duyệt tại thời điểm gửi.** Workflow đổi giữa chừng không được âm thầm đổi người duyệt của item đang chờ. | 2.5, 3.4, 4.5 |
| `BR-17` | **Dữ liệu tổ chức có hiệu lực theo thời gian.** Phòng ban, chức vụ, quản lý trực tiếp, phân ca và chính sách lưu lịch sử hiệu lực; xem bảng công tháng trước phải dùng cơ cấu tại thời điểm đó, không dùng cơ cấu hiện tại. | 5.3, 6.4 |
| `BR-18` | **Thao tác nhạy cảm yêu cầu step-up authentication** (biometrics cục bộ + token ngắn, hoặc OTP/MFA): cấp Owner, duyệt mở lại kỳ, thay quyền lớn, override công. Không được thực hiện khi App offline. | 4.11 |
| `BR-19` | **Chấm công phải idempotent.** Backend dùng nonce/idempotency key + cửa sổ thời gian server để chống double punch và replay. | 2.4, 9.3 |
| `BR-20` | **Ca qua đêm quy về ngày bắt đầu ca**, không tách sai ở mốc 00:00. Attendance gắn theo *ngày ca*, không chỉ ngày lịch. | 2.4, 5.5 |

---

## 10. Quy tắc sinh mã nhân viên (Employee Code)

Sau khi nhân viên tham gia công ty thành công, hệ thống tự sinh một mã định danh
**duy nhất trong phạm vi tenant**.

**Định dạng:** `<viết tắt họ tên>.<mã công ty>`

```
Nguyễn Văn Đức  +  công ty AMOBI   →   ducnv.amobi
                                        │    │
                                        │    └── mã công ty (bất biến, khai báo khi khởi tạo tenant)
                                        └─────── tên chính + viết tắt họ và tên lót
```

**Thuật toán:**

1. Bỏ dấu tiếng Việt, chuyển chữ thường, loại bỏ khoảng trắng và ký tự đặc biệt.
2. Lấy **tên chính** (từ cuối) + **chữ cái đầu của họ và các tên lót** theo thứ tự xuất hiện.
   `Nguyễn Văn Đức` → tên chính `duc`, họ `n`, tên lót `v` → `ducnv`.
3. Ghép với mã công ty bằng dấu chấm: `ducnv.amobi`.
4. **Nếu trùng trong cùng tenant**, thêm số thứ tự: `ducnv2.amobi`, `ducnv3.amobi`.

**Ràng buộc:**

- Mã công ty do Admin/Kế toán khai báo lúc khởi tạo, **không đổi trong vòng đời công ty**.
- Kế toán được **chỉnh mã thủ công trước khi kích hoạt tài khoản**, miễn đảm bảo duy nhất trong tenant.
- Sau khi đã có dữ liệu chấm công thì **bất biến** (`BR-04`).
- Đây là **mã nghiệp vụ** để con người tra cứu; khoá chính kỹ thuật vẫn là ID hệ thống/UUID.

---

## 11. Cấp tài khoản và gia nhập công ty

> **Khác biệt có chủ đích so với v2.1.** Chương 2.2 của v2.1 mô tả đăng nhập
> bằng **SĐT + OTP** và hai luồng tham gia (nhân viên tự nhập *mã mời* / Kế toán
> tạo hồ sơ trước). Hệ thống đã thi công **bỏ hẳn mã mời** và chuyển sang
> **Firebase email + mật khẩu**, giữ OTP làm lớp xác thực thứ hai tuỳ chọn.
> Xem [§13 — Khác biệt giữa chuẩn v2.1 và hiện trạng](#13-khác-biệt-giữa-chuẩn-v21-và-hiện-trạng-thi-công).

### Đường duy nhất — Kế toán cấp tài khoản

```
Kế toán nhập hồ sơ trên Web Kế toán
   (họ tên, EMAIL, SĐT, phòng ban, chức vụ, ngày vào, loại HĐ)
      ↓
hệ thống sinh employee code (Kế toán sửa được trước khi lưu)
      + cấp tài khoản đăng nhập: email + MẬT KHẨU TẠM
      ↓
Kế toán đọc lại mật khẩu tạm cho nhân viên (hiển thị MỘT LẦN)
      ↓
nhân viên mở App, đăng nhập: TÊN MIỀN + EMAIL + MẬT KHẨU
      ↓
BẮT BUỘC đổi mật khẩu       ← token bị chặn ở mọi API khác cho tới khi đổi
      ↓
Thiết lập bảo mật (khuôn mặt hoặc vân tay) → Home
```

**Mật khẩu tạm chỉ để đổi mật khẩu, không mở được gì khác.** Nó đi qua nhiều tay
— đọc qua điện thoại, ghi ra giấy, gửi qua tin nhắn. Chốt này cưỡng chế ở server
chứ không phải chỉ điều hướng ở App.

**Trạng thái hồ sơ:**

| Trạng thái | Ý nghĩa | Kế toán được làm gì |
|---|---|---|
| `PENDING_ACTIVATION` | Đã cấp tài khoản, chưa hoàn tất thiết lập bảo mật | Sửa hồ sơ, cấp lại mật khẩu, xoá hồ sơ nếu tạo nhầm |
| `ACTIVE` | Đã đăng ký ít nhất một phương thức sinh trắc học | Sửa hồ sơ (có log), không xoá được — chỉ tạm ngưng/chấm dứt |

Hỗ trợ **import hàng loạt bằng Excel**; hệ thống tự sinh mã và mật khẩu tạm cho
từng dòng, **báo lỗi theo từng dòng** thay vì fail cả file.

### Một người làm ở hai công ty

Mỗi công ty cấp một **tài khoản riêng, mật khẩu riêng**. Không có màn hình chọn
công ty, không chuyển công ty giữa phiên.

Nhất quán với việc tài khoản do công ty cấp: công ty A không được biết nhân viên
còn làm ở đâu, và mật khẩu do A cấp không mở được dữ liệu của B.

> Với vai trò **Giám đốc quản lý nhiều tenant**, v2.1 §4.12 yêu cầu switch tenant
> rõ ràng và cache/query tách tenant tuyệt đối. Đây là hạng mục **giai đoạn 2**;
> khi thi công phải giữ nguyên nguyên tắc "mỗi tenant một tài khoản" ở tầng dữ
> liệu, chỉ gộp ở tầng trải nghiệm.

### Xác thực 2 lớp

Lớp thứ nhất do **Firebase Authentication** đảm nhiệm: client đăng nhập với
Firebase bằng email + mật khẩu, rồi đổi ID token lấy phiên của Backend. Backend
không bao giờ nhận và không lưu mật khẩu.

**Xác thực 2 lớp** là tuỳ chọn, dùng **OTP gửi qua SMS**. Với vai trò Giám đốc
và Admin nền tảng, 2FA/step-up là **bắt buộc** cho thao tác nhạy cảm (`BR-18`).

---

## 12. Từ điển thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| **Tenant** | Một công ty/doanh nghiệp sử dụng SmartFace; dữ liệu tách biệt theo `company_id`. |
| **Attendance Event** | Một sự kiện chấm vào/ra kèm giờ server, vị trí, thiết bị, phương thức xác thực và kết quả kiểm soát gian lận. |
| **Timesheet / Bảng công** | Dữ liệu công đã tổng hợp theo ngày/tuần/tháng từ attendance + lịch ca + đơn đã duyệt + chính sách. Khác với *lượt chấm công* (raw event). |
| **Shift / Ca** | Mẫu giờ làm việc: giờ vào/ra, nghỉ giữa ca, quy tắc trễ/sớm, hệ số OT. |
| **Shift Assignment / Phân ca** | Gán ca cho nhân viên theo ngày/chu kỳ. |
| **Request / Đơn từ** | Yêu cầu nghỉ, ra ngoài, về sớm, công tác, bổ sung công, OT, đổi ca, làm bù. |
| **Approval Flow** | Chuỗi cấp duyệt theo vai trò/cấp quản lý/phòng ban/loại đơn. |
| **Data Scope** | Phạm vi dữ liệu một quyền được áp dụng: `SELF`, `TEAM`, `DEPARTMENT`, `BRANCH`, `COMPANY`, `PLATFORM`. |
| **Owner công ty** | Quyền cao nhất trong tenant; cấu hình và cấp quyền nội bộ. **Không có quyền platform.** |
| **Platform Admin** | Tài khoản vận hành SmartFace trên phạm vi toàn nền tảng. |
| **Step-up authentication** | Xác thực bổ sung ngay trước thao tác nhạy cảm, dù phiên đăng nhập vẫn còn hiệu lực. |
| **Support Access Mode** | Chế độ Admin nền tảng truy cập dữ liệu tenant có mục đích, thời hạn và audit — thay cho quyền xem mọi lúc. |
| **Face embedding** | Vector đặc trưng (512 chiều) trích từ khuôn mặt để so khớp. Không tái tạo được ảnh gốc từ embedding. |
| **Liveness detection** | Kiểm tra người trước camera là người thật, không phải ảnh in / video / mặt nạ. |
| **Geofencing** | Vùng địa lý (tâm + bán kính) mà trong đó nhân viên được phép chấm công. |
| **Impossible travel** | Hai lượt chấm liên tiếp suy ra tốc độ di chuyển vượt khả năng thực tế → dấu hiệu gian lận. |
| **Device binding** | Ràng buộc tài khoản với thiết bị cụ thể; đổi thiết bị phải xác thực lại. |
| **App Attestation** | Cơ chế OS (Play Integrity / Apple App Attest) chứng minh request đến từ bản app gốc chưa bị chỉnh sửa. |
| **Replay attack** | Ghi lại request hợp lệ rồi gửi lại nhiều lần. Chống bằng nonce + timestamp server. |
| **Công chuẩn** | Đơn vị quy đổi, ví dụ đủ 8 giờ = 1 công. Quy tắc cấu hình theo tenant. |
| **OT (Overtime)** | Giờ làm thêm ngoài ca chuẩn, hệ số theo ngày thường/cuối tuần/lễ. Chỉ *Approved OT* vào kết quả chính thức. |
| **Kỳ công** | Khoảng thời gian tính công (thường theo tháng), có state machine riêng — xem [05 mục Kỳ công](./05-nghiep-vu-web-ke-toan.md). |
| **Correlation ID** | ID xuyên Backend → AI Server → Queue → Log để truy vết một lượt chấm công/sự cố từ đầu đến cuối. |
| **RBAC** | Role-Based Access Control — phân quyền theo vai trò, ở đây luôn đi kèm Data Scope. |

---

## 13. Khác biệt giữa chuẩn v2.1 và hiện trạng thi công

Tài liệu v2.1 là **chuẩn đích**. Một số điểm hệ thống đã thi công khác với v2.1,
do quyết định kỹ thuật có chủ đích sau khi v2.0 ra đời. Bảng này để đội thi công
không nhầm giữa "chưa làm" và "cố ý làm khác".

| Chủ đề | Chuẩn v2.1 | Hiện trạng | Xử lý |
|---|---|---|---|
| Đăng nhập | SĐT + OTP | Firebase email + mật khẩu; OTP là lớp 2 tuỳ chọn | **Giữ hiện trạng.** OTP-only kém an toàn hơn và Firebase Phone Auth đòi gói Blaze. |
| Tham gia công ty | Có mã mời (Luồng A) | Đã bỏ mã mời, chỉ còn Kế toán cấp tài khoản | **Giữ hiện trạng.** Mã mời bị chụp màn hình là ai cũng vào được tenant. |
| Nhiều tenant / một SĐT | Chọn công ty sau đăng nhập, switch trong Cá nhân | Mỗi công ty một tài khoản riêng | **Giữ hiện trạng** ở tầng dữ liệu. Switch tenant cho vai trò Giám đốc là hạng mục giai đoạn 2. |
| App Quản lý | Quản lý duyệt đơn trên **App mobile** | Duyệt đơn đang nằm trên **Web Quản lý** | **Cần thi công** — xem [03](./03-nghiep-vu-app-quan-ly.md). |
| App Giám đốc | Phân hệ đầy đủ trên mobile | **Chưa có** | **Cần thi công** — xem [04](./04-nghiep-vu-app-giam-doc.md). |
| Web Kế toán / Web Giám đốc | Hai phân hệ tách biệt | Một `web-smart` gộp chung, phân quyền theo role | **Cần tách route/permission** — xem [05](./05-nghiep-vu-web-ke-toan.md) và [06](./06-nghiep-vu-web-giam-doc.md). |
| Kỳ công | 5 trạng thái, có `PENDING_APPROVAL` và `REOPENED` | Chốt/mở kỳ đơn giản, chưa có bước Giám đốc duyệt | **Cần thi công** — xem [05](./05-nghiep-vu-web-ke-toan.md). |
| Data Scope | 6 mức `SELF…PLATFORM` | `managedDepartmentIds` cho vai trò `MANAGER` | **Cần mở rộng** — xem [13](./13-mo-hinh-du-lieu.md). |

---

## 14. Giả định và ràng buộc

**Giả định:**

- Nhân viên có smartphone cá nhân đủ mạnh để chạy camera + xử lý ảnh cơ bản. Vị trí không có smartphone cần máy chấm công vật lý (ngoài phạm vi MVP).
- Công ty chấp nhận thu thập và xử lý dữ liệu sinh trắc học, có văn bản đồng ý của người lao động.
- Có Internet ổn định tại nơi chấm công; chế độ offline chỉ là dự phòng (giai đoạn 3).

**Ràng buộc:**

- Tuân thủ **Nghị định 13/2023/NĐ-CP** — dữ liệu sinh trắc học thuộc nhóm **dữ liệu cá nhân nhạy cảm**, yêu cầu sự đồng ý riêng và có chính sách vòng đời rõ ràng.
- Nếu khách hàng yêu cầu dữ liệu đặt tại Việt Nam, phải chọn cloud trong nước hoặc on-premise.
- Thời gian nhận diện khuôn mặt phải **dưới 2 giây** ở tải bình thường (`NFR-PERF-01`).
- AI Server cần GPU → chi phí hạ tầng cao hơn backend thông thường, phải scale độc lập.

---

## 15. Câu hỏi mở cần chốt

| # | Câu hỏi | Ảnh hưởng |
|---|---|---|
| Q1 | Giám đốc quản lý nhiều tenant: gộp một tài khoản có switch, hay giữ mỗi tenant một tài khoản? | Mô hình `UserAccount ↔ Employee ↔ Company`, cache tách tenant (v2.1 §4.12) |
| Q2 | Chấm công ngoài geofence: **cảnh báo** hay **chặn cứng**? Cấu hình theo tenant hay theo văn phòng? | Logic chấm công, chính sách công ty |
| Q3 | Duyệt đơn tối đa mấy cấp ở MVP? Có bật phê duyệt 2 bước cho thay đổi cấu hình không? | Thiết kế `ApprovalFlow` state machine |
| Q4 | Giám đốc có thuộc diện bắt buộc chấm công không? Có cho self-approval khi là Owner cuối cùng? | v2.1 §4.1, §4.4 — ảnh hưởng workflow và audit |
| Q5 | Liveness tự triển khai hay SDK eKYC thương mại (FPT.AI, VNPT)? | Chi phí, thời gian, độ chính xác, ràng buộc pháp lý |
| Q6 | Quy mô tối đa mỗi tenant? | Có cần pgvector/Milvus không; chiến lược so khớp |
| Q7 | Chính sách lưu ảnh chấm công: lưu bao lâu, lưu ảnh gốc hay chỉ embedding, hay chỉ lưu trường hợp nghi vấn? | Chi phí lưu trữ, tuân thủ pháp lý, khả năng đối soát khiếu nại |
| Q8 | Retention audit log và ngưỡng SLA duyệt theo gói dịch vụ? | v2.1 §7.4, §10.1 |

---

**Tiếp theo:** [02 — Nghiệp vụ App Nhân viên](./02-nghiep-vu-app-nhan-vien.md)
