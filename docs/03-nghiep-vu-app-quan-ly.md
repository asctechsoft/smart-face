# 03 — Nghiệp vụ App Quản lý

> **Nguồn chuẩn:** Tài liệu nghiệp vụ SmartFace **v2.1**, Chương III.
> Liên quan: [02 — Nghiệp vụ App Nhân viên](./02-nghiep-vu-app-nhan-vien.md) ·
> [04 — Nghiệp vụ App Giám đốc](./04-nghiep-vu-app-giam-doc.md) ·
> [08 — Luồng xuyên phân hệ & Ma trận quyền](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md)

---

Quản lý dùng **cùng một ứng dụng mobile** với nhân viên. Tài khoản vẫn chấm công
và quản lý thông tin cá nhân như bình thường, nhưng Backend mở thêm quyền quản lý
theo **phạm vi đội nhóm/phòng ban** được Giám đốc hoặc Owner cấp.

> **Không có "App Quản lý" riêng.** Đây là cùng một binary Flutter với App Nhân
> viên. Menu quản lý xuất hiện khi tài khoản có permission tương ứng, và **mọi
> API vẫn kiểm tra lại quyền + scope ở Backend** (`BR-13`). Ẩn menu không phải
> cơ chế bảo vệ.

---

## Mục lục

1. [Nguyên tắc kế thừa quyền](#1-nguyên-tắc-kế-thừa-quyền-fr-mgr-role)
2. [Dashboard quản lý](#2-dashboard-quản-lý-fr-mgr-dash)
3. [Chấm công & đơn cá nhân](#3-chấm-công--đơn-cá-nhân-fr-mgr-self)
4. [Duyệt đơn của nhân viên](#4-duyệt-đơn-của-nhân-viên-fr-mgr-appr)
5. [Theo dõi chấm công đội nhóm](#5-theo-dõi-chấm-công-đội-nhóm-fr-mgr-team)
6. [Bảng công đội nhóm](#6-bảng-công-đội-nhóm-fr-mgr-tsheet)
7. [Phân ca được uỷ quyền](#7-phân-ca-được-uỷ-quyền-fr-mgr-shift)
8. [Thông báo & nhật ký duyệt](#8-thông-báo--nhật-ký-duyệt-fr-mgr-noti)
9. [Ngoại lệ & tiêu chí nghiệm thu](#9-ngoại-lệ--tiêu-chí-nghiệm-thu)

---

## 1. Nguyên tắc kế thừa quyền (`FR-MGR-ROLE`)

| Mã | Nhóm chức năng | Quản lý có quyền |
|---|---|---|
| `FR-MGR-ROLE-01` | **Cá nhân** | Toàn bộ quyền của Nhân viên: chấm công, đơn từ cá nhân, lịch sử, bảng công, hồ sơ |
| `FR-MGR-ROLE-02` | **Duyệt đơn** | Duyệt / từ chối / yêu cầu bổ sung với nhân viên thuộc scope |
| `FR-MGR-ROLE-03` | **Đội nhóm** | Xem trạng thái chấm công hôm nay và tổng hợp công cơ bản của đội nhóm |
| `FR-MGR-ROLE-04` | **Ca làm việc** | Chỉ **xem** lịch ca. Có thể được cấp thêm `shift.assign` nếu Giám đốc uỷ quyền |
| `FR-MGR-ROLE-05` | **Cấu hình công ty** | **Không có mặc định.** Cấu hình chính thuộc [Web Giám đốc](./06-nghiep-vu-web-giam-doc.md) |

> **Đơn cá nhân của Quản lý.** Khi Quản lý tạo đơn cho chính mình, hệ thống
> **không** cho Quản lý tự duyệt (`BR-14`). Đơn chuyển lên Giám đốc/Owner hoặc
> cấp duyệt cao hơn theo workflow; yêu cầu xuất hiện trong Trung tâm phê duyệt
> trên [App Giám đốc](./04-nghiep-vu-app-giam-doc.md) và Web Giám đốc.

### 1.1. Phạm vi dữ liệu

Quản lý chỉ xem nhân viên **thuộc phạm vi được phân công**. Nếu quản lý chéo
nhiều phòng ban, scope phải được **khai báo rõ** — không suy luận quyền từ chức
danh văn bản trong hồ sơ nhân sự.

| Scope | Ý nghĩa với vai trò Quản lý |
|---|---|
| `SELF` | Chỉ dữ liệu của chính mình (mặc định của mọi tài khoản) |
| `TEAM` | Nhóm nhân viên được gán trực tiếp |
| `DEPARTMENT` | Một hoặc nhiều phòng ban khai báo tường minh |
| `BRANCH` | Toàn chi nhánh — thường dành cho Trưởng chi nhánh |

---

## 2. Dashboard quản lý (`FR-MGR-DASH`)

| Mã | Khối | Nội dung |
|---|---|---|
| `FR-MGR-DASH-01` | **Cá nhân** | Giống nhân viên: ca hôm nay, trạng thái chấm vào/ra, công tháng |
| `FR-MGR-DASH-02` | **Đội nhóm hôm nay** | Tổng nhân viên phải làm · đã chấm vào · chưa chấm · đi muộn · nghỉ có phép · thiếu dữ liệu |
| `FR-MGR-DASH-03` | **Badge chờ duyệt** | Số đơn đang chờ; ưu tiên đơn có ngày hiệu lực gần hoặc đơn bổ sung công trước kỳ chốt |
| `FR-MGR-DASH-04` | **Cảnh báo nhanh** | Nhân viên thiếu check-out, chấm ngoài vùng, cờ gian lận |

> **Cảnh báo gian lận ở mức thông tin.** Quản lý *thấy* cờ nghi vấn để nhắc nhân
> viên, nhưng **quyền xử lý/quyết định giữ hay huỷ công** thuộc Kế toán/Giám đốc.
> Xem [09 — Chống gian lận](./09-anti-fraud.md) mục 8.

---

## 3. Chấm công & đơn cá nhân (`FR-MGR-SELF`)

| Mã | Yêu cầu |
|---|---|
| `FR-MGR-SELF-01` | Quản lý chấm công theo **cùng quy tắc** với nhân viên. Quyền quản lý **không làm giảm** yêu cầu xác thực chấm công của tài khoản cá nhân |
| `FR-MGR-SELF-02` | Đơn nghỉ/ra ngoài/OT/công tác của Quản lý đi theo luồng **Quản lý → Giám đốc/Owner**. Giám đốc xử lý trên App hoặc Web |
| `FR-MGR-SELF-03` | Nếu Quản lý đồng thời là **Owner cuối cùng**, tenant phải cấu hình người duyệt thay thế. Khuyến nghị **không tự duyệt** để giữ kiểm soát chéo (`BR-14`, `BR-15`) |
| `FR-MGR-SELF-04` | Nếu đơn liên quan **kỳ công đã khoá**, tạo yêu cầu mở lại/điều chỉnh hậu kiểm thay vì sửa trực tiếp (`BR-07`) |

---

## 4. Duyệt đơn của nhân viên (`FR-MGR-APPR`)

| Mã | Màn/chức năng | Chi tiết |
|---|---|---|
| `FR-MGR-APPR-01` | **Danh sách chờ duyệt** | Lọc theo loại đơn, ngày hiệu lực, nhân viên, trạng thái. Mặc định **chỉ dữ liệu trong scope** |
| `FR-MGR-APPR-02` | **Chi tiết đơn** | Người gửi, lịch ca, phép còn lại, dữ liệu chấm công liên quan, file minh chứng, lịch sử duyệt |
| `FR-MGR-APPR-03` | **Duyệt** | Ghi người duyệt, thời điểm, cấp duyệt. Chuyển cấp tiếp theo nếu workflow nhiều cấp |
| `FR-MGR-APPR-04` | **Từ chối** | **Bắt buộc nhập lý do**; gửi push cho người tạo |
| `FR-MGR-APPR-05` | **Yêu cầu bổ sung** | Trả đơn về trạng thái `NEED_MORE_INFO`, chỉ rõ trường/chứng từ cần bổ sung rồi gửi lại |
| `FR-MGR-APPR-06` | **Duyệt hàng loạt** | Chỉ cho loại đơn an toàn và cùng điều kiện. **Không khuyến nghị** với bổ sung công hoặc đơn rủi ro cao |

**API tương ứng (đã có trong mã nguồn):**

| Chức năng | Endpoint |
|---|---|
| Danh sách chờ duyệt | `GET /v1/requests/pending-approval` |
| Chi tiết đơn | `GET /v1/requests/:id` |
| Duyệt | `POST /v1/requests/:id/approve` |
| Từ chối | `POST /v1/requests/:id/reject` |
| Duyệt hàng loạt | `POST /v1/requests/bulk-approve` |

Chi tiết payload: [16 — Danh mục API Backend](./16-danh-muc-api-backend.md) mục 7.

### 4.1. Quy tắc chống xung đột duyệt

| Mã | Quy tắc |
|---|---|
| `FR-MGR-APPR-07` | **Không cho người duyệt duyệt đơn của chính mình** (`BR-14`) |
| `FR-MGR-APPR-08` | Nhân viên chuyển phòng ban **sau khi đã gửi đơn** → workflow của đơn giữ nguyên **snapshot cấp duyệt** để đảm bảo truy vết (`BR-16`) |
| `FR-MGR-APPR-09` | Người duyệt nghỉ việc/bị khoá → hệ thống chuyển theo **rule fallback**, hoặc yêu cầu Giám đốc phân công người duyệt thay thế |
| `FR-MGR-APPR-10` | Mọi thao tác duyệt/từ chối/thu hồi **lưu audit trail** (`BR-08`) |

---

## 5. Theo dõi chấm công đội nhóm (`FR-MGR-TEAM`)

| Mã | Dạng xem | Nội dung |
|---|---|---|
| `FR-MGR-TEAM-01` | **Hôm nay** | Ai đã vào / chưa vào / đi muộn / nghỉ / công tác; thời điểm chấm gần nhất |
| `FR-MGR-TEAM-02` | **Theo ngày** | Danh sách ca, check-in/out, tổng giờ, trạng thái từng nhân viên |
| `FR-MGR-TEAM-03` | **Theo tuần** | Tổng giờ/công và các ngày bất thường, để quản lý nhắc nhân viên xử lý sớm |
| `FR-MGR-TEAM-04` | **Cảnh báo** | Thiếu check-out, chấm ngoài vùng, nghi vấn, đơn sắp hiệu lực chưa duyệt |

---

## 6. Bảng công đội nhóm (`FR-MGR-TSHEET`)

| Mã | Yêu cầu |
|---|---|
| `FR-MGR-TSHEET-01` | Xem bảng công tóm tắt theo tuần/tháng: công chuẩn, công thực tế, OT, phép, trễ/sớm, thiếu công |
| `FR-MGR-TSHEET-02` | Drill-down về ngày và lượt chấm, **nhưng không mặc định cho sửa dữ liệu công** |
| `FR-MGR-TSHEET-03` | Đánh dấu **"Cần Kế toán kiểm tra"** với một ngày công bất thường — tạo task/ticket nội bộ thay vì sửa trực tiếp |

> Ranh giới quan trọng: Quản lý **phát hiện** vấn đề, Kế toán **sửa** số liệu.
> Giữ ranh giới này là cách duy nhất để bảng công còn truy vết được.

---

## 7. Phân ca được uỷ quyền (`FR-MGR-SHIFT`) — tuỳ chọn

Chỉ khả dụng khi Giám đốc cấp permission `shift.assign` với scope
`TEAM`/`DEPARTMENT`.

| Mã | Yêu cầu |
|---|---|
| `FR-MGR-SHIFT-01` | Phân ca cho đội nhóm ngay trên App hoặc Web nhẹ |
| `FR-MGR-SHIFT-02` | **Chỉ dùng mẫu ca đã được Giám đốc thiết lập.** Không tự sửa định nghĩa ca |
| `FR-MGR-SHIFT-03` | Thay đổi lịch gần đến ngày làm → gửi thông báo cho nhân viên, ghi rõ người thay đổi và thời điểm |
| `FR-MGR-SHIFT-04` | Cảnh báo xung đột: hai ca trùng nhau, ca vượt giờ tối đa, phân ca vào ngày nghỉ đã duyệt |

---

## 8. Thông báo & nhật ký duyệt (`FR-MGR-NOTI`)

| Mã | Yêu cầu |
|---|---|
| `FR-MGR-NOTI-01` | Push khi có đơn mới, đơn sắp quá hạn, nhân viên thiếu chấm công, thay đổi ca |
| `FR-MGR-NOTI-02` | Trang **"Đã xử lý"** tra cứu các đơn đã duyệt/từ chối bởi chính quản lý |
| `FR-MGR-NOTI-03` | **Không cho sửa lịch sử duyệt.** Cần thu hồi quyết định → tạo hành động *"Thu hồi/điều chỉnh quyết định"* có lý do và audit |

---

## 9. Ngoại lệ & tiêu chí nghiệm thu

| Tình huống | Kỳ vọng hệ thống |
|---|---|
| Quản lý duyệt đơn ngoài scope | Backend từ chối kể cả khi UI hiển thị nhầm; trả lỗi phân quyền, ghi security log |
| Hai quản lý cùng duyệt một đơn | Chỉ quyết định đầu tiên có hiệu lực; người sau nhận trạng thái mới nhất, không tạo bản ghi trùng |
| Quản lý tự gửi đơn cho mình | Đơn **không** xuất hiện trong hàng chờ của chính mình; đẩy lên cấp trên theo workflow |
| Nhân viên đổi phòng ban giữa chừng | Đơn đang chờ giữ snapshot cấp duyệt cũ; đơn mới đi theo cơ cấu mới (`BR-16`, `BR-17`) |
| Người duyệt nghỉ việc | Fallback approver theo cấu hình, hoặc Giám đốc phân công lại. Đơn không được kẹt vô thời hạn |
| Quản lý phân ca hồi tố | Cảnh báo rõ vì có thể đổi kết quả timesheet; bắt buộc lý do + audit |
| Mất mạng | Xem được dữ liệu cache có nhãn "Dữ liệu cũ"; **không cho duyệt offline** |

**Tiêu chí nghiệm thu (UAT):**

- Quản lý chỉ thấy đúng nhân viên trong scope — thử đổi ID/URL/API không lấy được dữ liệu ngoài scope.
- Không có đường nào để Quản lý tự duyệt đơn của mình.
- Duyệt hàng loạt không áp dụng được cho bổ sung công.
- Mọi quyết định duyệt/từ chối có audit đủ actor, thời điểm, lý do, cấp duyệt.

---

**Tiếp theo:** [04 — Nghiệp vụ App Giám đốc](./04-nghiep-vu-app-giam-doc.md)
