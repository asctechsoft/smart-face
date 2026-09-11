# 04 — Nghiệp vụ App Giám đốc / Tổng Giám đốc

> **Nguồn chuẩn:** Tài liệu nghiệp vụ SmartFace **v2.1**, Chương IV — phân hệ bổ sung mới.
> Liên quan: [03 — Nghiệp vụ App Quản lý](./03-nghiep-vu-app-quan-ly.md) ·
> [06 — Nghiệp vụ Web Giám đốc](./06-nghiep-vu-web-giam-doc.md) ·
> [08 — Luồng xuyên phân hệ & Ma trận quyền](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md)
>
> ⚠ **Trạng thái thi công: CHƯA CÓ.** Toàn bộ phân hệ này là hạng mục cần làm.
> Xem [01 §13](./01-tong-quan-he-thong.md#13-khác-biệt-giữa-chuẩn-v21-và-hiện-trạng-thi-công).

---

App Giám đốc/Tổng Giám đốc là kênh **điều hành doanh nghiệp trên mobile** dành cho
Giám đốc, Tổng Giám đốc hoặc Owner công ty. Phân hệ ưu tiên thao tác cần **xem
nhanh và ra quyết định tức thời**: nắm tình hình đi làm toàn công ty, duyệt yêu
cầu cấp cao, theo dõi kỳ công, cảnh báo bất thường, tra cứu nhân sự.

Các cấu hình sâu — xây bộ máy, định nghĩa chính sách, workflow phức tạp, phân
quyền chi tiết — vẫn thực hiện đầy đủ trên
[Web Giám đốc](./06-nghiep-vu-web-giam-doc.md).

> ### Nguyên tắc Mobile Executive
>
> App Giám đốc **không phải một hệ thống quyền tách biệt** khỏi Web Giám đốc.
> Cùng một tài khoản / role / permission được Backend kiểm tra; mobile chỉ tối ưu
> trải nghiệm điều hành nhanh. **Quyền nào không được cấp trên Web/Backend thì
> App cũng không được thực hiện** (`BR-13`).

---

## Mục lục

1. [Vai trò & nguyên tắc sử dụng](#1-vai-trò--nguyên-tắc-sử-dụng-fr-dir-role)
2. [Cấu trúc menu](#2-cấu-trúc-menu-fr-dir-nav)
3. [Dashboard điều hành](#3-dashboard-điều-hành-fr-dir-dash)
4. [Chấm công & đơn cá nhân](#4-chấm-công--đơn-cá-nhân-fr-dir-self)
5. [Trung tâm phê duyệt](#5-trung-tâm-phê-duyệt-fr-dir-appr)
6. [Theo dõi chấm công toàn công ty](#6-theo-dõi-chấm-công-toàn-công-ty-fr-dir-att)
7. [Kỳ công & báo cáo nhanh](#7-kỳ-công--báo-cáo-nhanh-fr-dir-period)
8. [Nhân sự & bộ máy tổ chức](#8-nhân-sự--bộ-máy-tổ-chức-fr-dir-org)
9. [Uỷ quyền & phân quyền nhanh](#9-uỷ-quyền--phân-quyền-nhanh-fr-dir-grant)
10. [Thông báo & cảnh báo điều hành](#10-thông-báo--cảnh-báo-điều-hành-fr-dir-noti)
11. [Bảo mật thao tác nhạy cảm](#11-bảo-mật-thao-tác-nhạy-cảm-fr-dir-sec)
12. [Ngoại lệ & tiêu chí nghiệm thu](#12-ngoại-lệ--tiêu-chí-nghiệm-thu)

---

## 1. Vai trò & nguyên tắc sử dụng (`FR-DIR-ROLE`)

| Mã | Nguyên tắc | Chi tiết |
|---|---|---|
| `FR-DIR-ROLE-01` | **Kế thừa quyền cá nhân** | Nếu Giám đốc thuộc diện phải chấm công, tài khoản vẫn có chấm công, đơn cá nhân, lịch sử và bảng công như Nhân viên. Tenant có thể **tắt** yêu cầu chấm công cho chức danh đặc biệt theo policy |
| `FR-DIR-ROLE-02` | **Phạm vi điều hành** | Mặc định `COMPANY` với Giám đốc/Owner. Có thể thu hẹp `BRANCH`/`DEPARTMENT` nếu doanh nghiệp có nhiều cấp giám đốc |
| `FR-DIR-ROLE-03` | **Phê duyệt cấp cao** | Nhận đơn cá nhân của Quản lý, yêu cầu Kế toán, yêu cầu mở/chốt kỳ, override nhạy cảm và các bước cuối của approval workflow |
| `FR-DIR-ROLE-04` | **Không tự duyệt** | Không cho Giám đốc tự duyệt yêu cầu của chính mình nếu workflow còn cấp cao hơn hoặc có Owner khác. Mọi ngoại lệ phải có policy và audit (`BR-14`) |
| `FR-DIR-ROLE-05` | **Dữ liệu realtime** | Dashboard ưu tiên dữ liệu gần thời gian thực nhưng **phải hiển thị thời điểm cập nhật** và cảnh báo khi dữ liệu stale/mất kết nối |
| `FR-DIR-ROLE-06` | **Web là cấu hình sâu** | Tạo policy, thiết kế workflow, cấu hình ca/GPS chi tiết, role-permission phức tạp → thực hiện trên Web Giám đốc |

---

## 2. Cấu trúc menu (`FR-DIR-NAV`)

| Tab/Menu | Mục đích | Chức năng chính |
|---|---|---|
| **Tổng quan** | Điều hành trong ngày | KPI chấm công, nhân sự đi làm/nghỉ, đi muộn, OT, cảnh báo, trạng thái kỳ công, pending approvals |
| **Phê duyệt** | Ra quyết định nhanh | Đơn Quản lý, yêu cầu Kế toán, chốt/mở lại kỳ, điều chỉnh nhạy cảm, yêu cầu phân quyền/uỷ quyền |
| **Nhân sự** | Tra cứu tổ chức | Danh sách nhân viên/quản lý, bộ máy phòng ban, trạng thái đi làm, ca hiện tại, liên hệ theo quyền |
| **Báo cáo** | Theo dõi xu hướng | Chuyên cần, OT, phép, thiếu công, so sánh phòng ban/chi nhánh, báo cáo ngày/tuần/tháng |
| **Cá nhân** | Tài khoản Giám đốc | Chấm công/đơn cá nhân nếu áp dụng, lịch sử, bảng công cá nhân, thiết bị, bảo mật, tenant đang chọn |

Biểu tượng **Thông báo/Cảnh báo** đặt ở thanh trên cùng để truy cập nhanh từ mọi
tab.

> **Không trộn hai loại cảnh báo.** Cảnh báo vận hành nội bộ của công ty (phòng
> ban thiếu người, OT vượt ngưỡng) **không được trộn** với incident hạ tầng của
> [Platform Admin](./07-nghiep-vu-web-platform-admin.md) (Sev1/Sev2/Sev3). Hai
> nhóm này có người xử lý khác nhau và mức khẩn khác nhau.

---

## 3. Dashboard điều hành (`FR-DIR-DASH`)

| Mã | Khối | Nội dung |
|---|---|---|
| `FR-DIR-DASH-01` | **Nhân sự hôm nay** | Tổng dự kiến làm; đã check-in, chưa check-in, đi muộn, nghỉ có phép, công tác, thiếu ca/phân ca |
| `FR-DIR-DASH-02` | **Theo đơn vị** | Tổng hợp theo chi nhánh/phòng ban; drill-down tới danh sách nhân viên tương ứng |
| `FR-DIR-DASH-03` | **Pending approvals** | Số đơn cấp cao, yêu cầu Kế toán, yêu cầu chốt/mở lại kỳ, item sắp quá SLA |
| `FR-DIR-DASH-04` | **Kỳ công hiện tại** | Trạng thái `OPEN`/`CALCULATING`/`PENDING_APPROVAL`/`LOCKED`, tỷ lệ dữ liệu hoàn chỉnh, số exception chưa xử lý |
| `FR-DIR-DASH-05` | **OT & phép** | Giờ OT phát sinh/đã duyệt, phòng ban OT cao, số người nghỉ đồng thời, phép còn lại ở mức tổng hợp |
| `FR-DIR-DASH-06` | **Cảnh báo điều hành** | Tỷ lệ đi muộn tăng, nhiều lượt chấm nghi vấn, phòng ban thiếu người, ca chưa phân, backlog đơn tăng |
| `FR-DIR-DASH-07` | **Đổi phạm vi nhanh** | Toàn công ty → Chi nhánh → Phòng ban. Mọi drill-down vẫn bị ràng buộc bởi **data scope thực tế** |

### 3.1. Hành vi drill-down

| Khối KPI | Bấm vào sẽ mở |
|---|---|
| Đã đi làm / Chưa đi làm | Danh sách nhân viên theo trạng thái và ca hôm nay |
| Đi muộn / Về sớm | Danh sách vi phạm, số phút và xu hướng gần đây |
| Nghỉ / Công tác | Đơn đã duyệt có hiệu lực hôm nay |
| OT | Phòng ban/nhân viên có OT và trạng thái duyệt |
| Pending approval | Approval Center đã lọc theo mức ưu tiên |
| Exception kỳ công | Danh sách lỗi cần Kế toán xử lý hoặc cần Giám đốc quyết định |

> **KPI tổng và danh sách drill-down phải khớp nhau.** Nếu KPI nói 12 người đi
> muộn mà danh sách ra 9 dòng, Giám đốc mất niềm tin vào toàn bộ dashboard. Cả
> hai phải đọc từ cùng một truy vấn/cùng một thời điểm chốt số.

---

## 4. Chấm công & đơn cá nhân (`FR-DIR-SELF`)

| Mã | Yêu cầu |
|---|---|
| `FR-DIR-SELF-01` | Nếu công ty yêu cầu Giám đốc chấm công: luồng chấm vào/ra, Face ID/vân tay, GPS và anti-fraud **giống Nhân viên**. Quyền Giám đốc **không được bỏ qua** xác thực cá nhân |
| `FR-DIR-SELF-02` | Xem lịch sử, bảng công tuần/tháng/năm và lịch ca cá nhân nếu được áp dụng |
| `FR-DIR-SELF-03` | Đơn cá nhân của Giám đốc/TGĐ đi tới **Owner khác, Chủ tịch/HĐQT hoặc người duyệt được cấu hình**. Không mặc định tự duyệt |
| `FR-DIR-SELF-04` | Nếu Giám đốc đồng thời là **Owner cuối cùng** và tenant cho phép self-approval: hệ thống đánh dấu rõ **"Self-approved by policy"**, yêu cầu xác thực mạnh và ghi audit riêng |
| `FR-DIR-SELF-05` | Khi kỳ công cá nhân đã `LOCKED`, mọi điều chỉnh vẫn đi qua luồng hậu kiểm/mở lại kỳ như các vai trò khác (`BR-07`) |

---

## 5. Trung tâm phê duyệt (`FR-DIR-APPR`)

### 5.1. Các nhóm yêu cầu

| Nhóm yêu cầu | Nguồn gửi | Thông tin **phải xem** trước khi duyệt |
|---|---|---|
| Đơn cá nhân của Quản lý | App Quản lý | Người gửi, loại đơn, thời gian, lịch ca, phép/OT liên quan, cấp duyệt trước đó |
| Đề nghị chốt kỳ công | Web Kế toán | Kỳ, số nhân viên, tổng công/OT/phép, số exception còn lại, người gửi, version tính công |
| Yêu cầu mở lại kỳ | Web Kế toán | Lý do, phạm vi dữ liệu bị ảnh hưởng, kỳ/version hiện tại, rủi ro thay đổi báo cáo đã xuất |
| Override/điều chỉnh nhạy cảm | Kế toán / người được uỷ quyền | Before/after, lý do, chứng từ, nhân viên/ngày bị tác động, audit trước đó |
| Thay đổi quyền/uỷ quyền nhạy cảm | Web/App theo permission | Người được cấp, role/permission, scope, thời hạn, quyền hiện tại, người đề nghị |
| Cấp/thu hồi Owner | Owner hợp lệ | Danh tính người nhận, **số Owner còn lại**, xác thực mạnh, cảnh báo hậu quả |

### 5.2. Quy tắc hành động

| Mã | Quy tắc |
|---|---|
| `FR-DIR-APPR-01` | Hành động: **Duyệt · Từ chối · Yêu cầu bổ sung.** Từ chối bắt buộc lý do; yêu cầu bổ sung phải chỉ rõ trường/chứng từ cần bổ sung |
| `FR-DIR-APPR-02` | Yêu cầu rủi ro thấp có thể duyệt hàng loạt. **Không duyệt hàng loạt** với: mở lại kỳ, Owner, thay đổi quyền lớn, override công nhạy cảm |
| `FR-DIR-APPR-03` | Màn chi tiết phải hiển thị **impact summary trước nút xác nhận** — tránh Giám đốc chỉ nhìn tiêu đề rồi duyệt |
| `FR-DIR-APPR-04` | Sau khi duyệt, hệ thống trả trạng thái cuối, **version/audit ID** và gửi push cho người gửi |
| `FR-DIR-APPR-05` | Workflow đổi trong lúc item đang chờ → item cũ dùng **snapshot luồng duyệt tại lúc gửi**; không âm thầm đổi người duyệt (`BR-16`) |

---

## 6. Theo dõi chấm công toàn công ty (`FR-DIR-ATT`)

| Mã | Dạng xem | Nội dung |
|---|---|---|
| `FR-DIR-ATT-01` | **Hôm nay** | Theo chi nhánh/phòng ban: số phải làm, đã vào, chưa vào, đi muộn, nghỉ, công tác, thiếu dữ liệu |
| `FR-DIR-ATT-02` | **Theo ngày** | Danh sách nhân viên, ca, check-in/out, tổng giờ, trạng thái và cờ bất thường |
| `FR-DIR-ATT-03` | **Theo tuần/tháng** | Tỷ lệ chuyên cần, tổng giờ/công, OT, phép, trễ/sớm và xu hướng |
| `FR-DIR-ATT-04` | **Nhân viên** | Drill-down tới hồ sơ tóm tắt, lịch ca, bảng công và đơn đã duyệt theo quyền |
| `FR-DIR-ATT-05` | **Nghi vấn** | Danh sách risk flag **mức nghiệp vụ**; xem dữ liệu cần thiết để ra quyết định nhưng **không mặc định hiển thị raw biometric nhạy cảm** |

> **Phạm vi dữ liệu.** Tổng Giám đốc/Owner thường có scope `COMPANY`. Giám đốc
> chi nhánh hoặc Giám đốc khối có thể chỉ có `BRANCH`/`DEPARTMENT`. **Tên chức
> danh không tự động tạo quyền** — Backend kiểm tra scope trên từng API.

---

## 7. Kỳ công & báo cáo nhanh (`FR-DIR-PERIOD`)

| Mã | Yêu cầu |
|---|---|
| `FR-DIR-PERIOD-01` | Xem danh sách kỳ công và trạng thái; kỳ sắp chốt được ưu tiên trên Dashboard |
| `FR-DIR-PERIOD-02` | Xem **summary trước chốt**: headcount, tổng công chuẩn/thực tế, OT đã duyệt, phép, thiếu công, exception, thay đổi lớn so với tháng trước |
| `FR-DIR-PERIOD-03` | Duyệt chốt kỳ trên App nếu có `period.approve_lock`; sau duyệt kỳ chuyển `LOCKED` và tạo audit |
| `FR-DIR-PERIOD-04` | Duyệt mở lại kỳ nếu có `period.approve_reopen`; **bắt buộc xem lý do và phạm vi tác động** |
| `FR-DIR-PERIOD-05` | Báo cáo nhanh theo ngày/tuần/tháng: chuyên cần, OT, nghỉ phép, phòng ban vi phạm nhiều, phòng ban thiếu người |
| `FR-DIR-PERIOD-06` | App ưu tiên chart/KPI và drill-down. **Export Excel/PDF lớn thực hiện trên Web** để tránh trải nghiệm mobile nặng |

Chi tiết state machine kỳ công: [05 — Web Kế toán](./05-nghiep-vu-web-ke-toan.md).

---

## 8. Nhân sự & bộ máy tổ chức (`FR-DIR-ORG`)

| Mã | Yêu cầu |
|---|---|
| `FR-DIR-ORG-01` | Tra cứu nhân viên theo tên/mã/phòng ban/chức vụ/trạng thái; xem liên hệ **theo quyền và chính sách riêng tư** |
| `FR-DIR-ORG-02` | Xem sơ đồ tổ chức rút gọn: khối/phòng ban, người phụ trách, số nhân sự, quản lý trực tiếp |
| `FR-DIR-ORG-03` | Xem hồ sơ tóm tắt: chức vụ, đơn vị, quản lý, ngày vào làm, trạng thái tài khoản, ca hiện tại, trạng thái chấm công hôm nay |
| `FR-DIR-ORG-04` | **Không mặc định sửa hợp đồng/lương/hồ sơ nhân sự chi tiết** trên App. Các thay đổi này thuộc Web Kế toán hoặc Web Giám đốc theo permission |
| `FR-DIR-ORG-05` | Gọi/nhắn nhanh qua thông tin liên hệ nếu tenant cho phép; **không làm lộ dữ liệu cá nhân ngoài scope** |

---

## 9. Uỷ quyền & phân quyền nhanh (`FR-DIR-GRANT`)

Để Tổng Giám đốc điều hành được khi đi công tác, App hỗ trợ một lớp phân quyền/uỷ
quyền **rút gọn**. Đây **không thay thế** màn quản trị quyền đầy đủ trên Web.

| Thao tác mobile | Quy tắc |
|---|---|
| **Uỷ quyền duyệt tạm thời** | Chọn người nhận → loại duyệt → scope → thời gian bắt đầu/kết thúc → xác nhận mạnh → audit |
| **Cấp role theo mẫu** | Chỉ chọn **role template đã định nghĩa trên Web**. App không tự tạo permission tuỳ ý vì UI không đủ ngữ cảnh |
| **Thu hồi quyền tạm thời** | Cho thu hồi trước hạn; các quyết định cũ vẫn giữ actor/audit |
| **Cấp Owner** | Chỉ hiện nếu tài khoản có `owner.assign`. Yêu cầu MFA/biometric/OTP và kiểm tra **không làm tenant mất Owner cuối cùng** (`BR-15`) |
| **Thay người duyệt khẩn cấp** | Gán fallback approver khi người duyệt nghỉ/khoá; có thời hạn và lý do |

---

## 10. Thông báo & cảnh báo điều hành (`FR-DIR-NOTI`)

| Mức | Ví dụ | Hành động |
|---|---|---|
| **Khẩn** | Kỳ công chờ duyệt sát hạn; Owner bị thu hồi; nhiều lượt nghi vấn tăng đột biến | Push ưu tiên + deep link tới màn xử lý |
| **Quan trọng** | Đơn Quản lý chờ lâu; phòng ban thiếu người; OT vượt ngưỡng; nhiều nhân viên chưa check-in | Push + badge + nhắc lại theo SLA |
| **Thông tin** | Báo cáo ngày sẵn sàng; kỳ công đã chốt; uỷ quyền sắp hết hạn | Notification center |

| Mã | Quy tắc |
|---|---|
| `FR-DIR-NOTI-01` | Cho cấu hình loại push nhận trên mobile, **nhưng không được tắt cảnh báo bảo mật bắt buộc** |
| `FR-DIR-NOTI-02` | **Deep link phải kiểm tra lại quyền khi mở.** Không dựa vào việc người dùng đã nhận notification để cho truy cập |
| `FR-DIR-NOTI-03` | Notification cũ phải hiển thị **trạng thái mới nhất** của approval/item, tránh duyệt lại dữ liệu đã thay đổi |

---

## 11. Bảo mật thao tác nhạy cảm (`FR-DIR-SEC`)

| Mã | Yêu cầu |
|---|---|
| `FR-DIR-SEC-01` | Xem dashboard thông thường dùng phiên đăng nhập. Thao tác nhạy cảm (cấp Owner, duyệt mở lại kỳ, thay quyền lớn) **phải step-up authentication** (`BR-18`) |
| `FR-DIR-SEC-02` | Step-up = biometrics cục bộ + token phiên ngắn, hoặc OTP/MFA, hoặc phương thức mạnh theo policy tenant |
| `FR-DIR-SEC-03` | **Không cho phê duyệt/cấp quyền khi App offline.** Mọi quyết định phải xác nhận với Server và nhận transaction/audit ID |
| `FR-DIR-SEC-04` | Session Giám đốc có timeout khi không hoạt động. Đổi thiết bị hoặc attestation bất thường → revoke/re-auth |
| `FR-DIR-SEC-05` | Màn gần đây/notification **không hiển thị nội dung nhạy cảm chi tiết** khi thiết bị đang khoá; hỗ trợ che số liệu theo privacy setting |
| `FR-DIR-SEC-06` | Mọi API executive kiểm tra ở Backend: `tenant_id`, permission, scope, trạng thái item, version và **điều kiện chống tự duyệt** (`BR-13`, `BR-14`) |

---

## 12. Ngoại lệ & tiêu chí nghiệm thu

| Tình huống | Kỳ vọng hệ thống |
|---|---|
| **Giám đốc mất mạng** | Vẫn xem dữ liệu cache có nhãn *"Dữ liệu cũ"* nếu cho phép. **Không được duyệt/cấp quyền offline** |
| **Item đã được người khác xử lý** | Khi bấm duyệt phải nhận trạng thái mới nhất, **không tạo quyết định trùng**; UI chuyển sang *Đã xử lý* |
| **Quyền vừa bị thu hồi** | Token/permission kiểm tra lại ở Backend; hành động bị từ chối ngay cả khi màn vẫn đang mở |
| **Duyệt mở lại kỳ** | Bắt buộc lý do + step-up auth; ghi audit và push cho Kế toán |
| **Cấp Owner** | Không cho làm tenant mất Owner cuối; xác thực mạnh; audit đầy đủ; gửi cảnh báo tới các Owner liên quan |
| **Dashboard nhiều dữ liệu** | Phân trang/lazy load, cache có TTL, hiển thị timestamp cập nhật. **KPI tổng và danh sách drill-down phải khớp** |
| **Giám đốc có nhiều tenant** | Switch tenant rõ ràng; mọi cache/query tách tenant tuyệt đối, **không hiển thị dữ liệu chéo công ty** |

**Tiêu chí nghiệm thu (UAT):**

- Dashboard đúng scope — Giám đốc chi nhánh không thấy số liệu chi nhánh khác.
- Approval chống xử lý trùng và chống tự duyệt.
- Thao tác nhạy cảm yêu cầu step-up auth, không có đường vòng.
- **Mobile và Web cho cùng kết quả trạng thái** với cùng một item.
- Không có API executive nào bỏ qua kiểm tra `tenant_id` + scope ở Backend.

---

**Tiếp theo:** [05 — Nghiệp vụ Web Kế toán](./05-nghiep-vu-web-ke-toan.md)
