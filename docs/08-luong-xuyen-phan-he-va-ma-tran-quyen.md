# 08 — Luồng xuyên phân hệ & Ma trận quyền

> **Nguồn chuẩn:** Tài liệu nghiệp vụ SmartFace **v2.1**, Chương VIII.
> Đây là tài liệu **trọng tài**: khi hai phân hệ mô tả cùng một nghiệp vụ mà
> khác nhau, bảng ở đây là bản đúng.

---

Sáu phân hệ giao diện không phải sáu hệ thống. Chúng thao tác trên **cùng một bộ
dữ liệu**, và phần lớn lỗi nghiệp vụ nghiêm trọng nằm ở **chỗ giao nhau** —
người duyệt sai, số liệu đổi sau khi chốt, quyền không bị thu hồi đúng lúc.

## Mục lục

1. [Ma trận quyền tổng quan](#1-ma-trận-quyền-tổng-quan)
2. [Mô hình quyền: Role × Permission × Scope](#2-mô-hình-quyền-role--permission--scope)
3. [Luồng đơn từ chuẩn](#3-luồng-đơn-từ-chuẩn)
4. [Luồng bảng công cuối tháng](#4-luồng-bảng-công-cuối-tháng)
5. [Luồng onboarding nhân viên](#5-luồng-onboarding-nhân-viên)
6. [Luồng cấp quyền & uỷ quyền](#6-luồng-cấp-quyền--uỷ-quyền)
7. [Bảng đối chiếu "ai làm gì ở đâu"](#7-bảng-đối-chiếu-ai-làm-gì-ở-đâu)

---

## 1. Ma trận quyền tổng quan

| Chức năng | Nhân viên | Quản lý | Kế toán | Giám đốc/Owner | Platform Admin |
|---|---|---|---|---|---|
| Chấm công cá nhân | ✓ | ✓ | Theo tài khoản cá nhân | Theo tài khoản cá nhân | Không |
| Tạo đơn cá nhân | ✓ | ✓ → cấp trên | Theo tài khoản cá nhân | Theo workflow | Không |
| Duyệt đơn nhân viên | Không | ✓ theo scope | Có thể xác nhận số liệu nếu workflow | ✓ cấp cao | Không |
| Xem công cá nhân | ✓ | ✓ | ✓ | ✓ | Chỉ support có kiểm soát |
| Xem công đội nhóm | Không | ✓ theo scope | ✓ theo quyền | ✓ | Chỉ support |
| Quản lý nhân sự | Không | Không mặc định | ✓ | ✓ | Không nghiệp vụ tenant |
| Tính / chốt công | Không | Không | ✓ **gửi duyệt** | ✓ **duyệt / override** | Không |
| Thiết lập ca / chính sách | Không | Chỉ nếu uỷ quyền | Không mặc định | ✓ | Không |
| Phân quyền tenant | Không | Không | Không | ✓ | Không (trừ hỗ trợ đặc biệt) |
| Quản lý tenant / gói / AI | Không | Không | Không | Không | ✓ |

> **Đọc bảng này thế nào.** Ô "✓" chỉ nói *có quyền chức năng*. Dữ liệu thực tế
> nhìn thấy còn bị cắt thêm một lần nữa bởi **scope** ở mục 2. Một Quản lý có
> `request.approve` vẫn không duyệt được đơn của phòng ban khác.

### 1.1. Ba ranh giới không được vi phạm

| # | Ranh giới | Vì sao |
|---|---|---|
| 1 | **Kế toán gửi chốt, Giám đốc duyệt chốt** | Người tính số không được là người phê duyệt số của chính mình |
| 2 | **Owner ≠ Platform Admin** | Owner là đỉnh của một tenant; Platform Admin ở tầng SaaS và không có quyền nghiệp vụ trong tenant |
| 3 | **Không ai duyệt yêu cầu của chính mình** (`BR-14`) | Kể cả Owner — trừ khi tenant bật self-approval có policy, đánh dấu rõ và audit riêng |

---

## 2. Mô hình quyền: Role × Permission × Scope

```
   Người dùng
       │
       ├── Role       ──► nhóm quyền chức năng     (Nhân viên, Quản lý, Kế toán, …)
       │
       ├── Permission ──► hành động cụ thể         (request.approve, period.approve_lock, …)
       │
       ├── Scope      ──► phạm vi dữ liệu          (SELF → TEAM → DEPARTMENT → BRANCH → COMPANY → PLATFORM)
       │
       └── Điều kiện  ──► ràng buộc nghiệp vụ      (không tự duyệt, kỳ chưa khoá, …)
                              │
                              ▼
                    Backend quyết định CHO / KHÔNG CHO
                    (UI chỉ ẩn/hiện cho gọn mắt — BR-13)
```

### 2.1. Thang scope

| Scope | Phạm vi | Vai trò điển hình |
|---|---|---|
| `SELF` | Chỉ chính mình | Mọi tài khoản |
| `TEAM` | Nhóm được gán trực tiếp | Quản lý nhóm |
| `DEPARTMENT` | Một/nhiều phòng ban khai báo tường minh | Trưởng phòng |
| `BRANCH` | Toàn chi nhánh | Giám đốc chi nhánh |
| `COMPANY` | Toàn tenant | Kế toán, Tổng Giám đốc, Owner |
| `PLATFORM` | Toàn hệ thống SaaS | Platform Admin |

### 2.2. Quy tắc kiểm tra bắt buộc ở Backend

Mỗi API nghiệp vụ phải kiểm đủ **sáu** điều kiện trước khi thực hiện:

```
1. tenant_id      khớp phiên đăng nhập                    (BR-09)
2. permission     có quyền cho hành động này              (BR-13)
3. scope          đối tượng nằm trong phạm vi dữ liệu     (BR-13)
4. trạng thái     item đang ở trạng thái cho phép hành động
5. version        không ghi đè thay đổi của người khác
6. self-check     actor không phải là chủ thể của yêu cầu (BR-14)
```

Thiếu bất kỳ điều nào là một lỗ hổng, không phải một thiếu sót nhỏ.

### 2.3. Quyền có thời hạn

Quyền cấp qua uỷ quyền tạm thời có `validFrom` / `validTo`. Khi hết hạn:

- Permission **tự thu hồi**, không cần thao tác tay.
- Các quyết định đã thực hiện trước đó **vẫn giữ nguyên actor trong audit** — không truy hồi.
- Người được uỷ quyền nhận thông báo trước khi hết hạn.

---

## 3. Luồng đơn từ chuẩn

### 3.1. Luồng mặc định theo người gửi

| Người gửi | Loại | Luồng mặc định |
|---|---|---|
| Nhân viên | Nghỉ / ra ngoài / về sớm / công tác / OT | Nhân viên → **Quản lý trực tiếp** → cấp tiếp theo nếu policy yêu cầu |
| Nhân viên | Bổ sung công | Nhân viên → **Quản lý xác nhận** → **Kế toán đối soát** (hoặc thứ tự cấu hình) |
| Quản lý | Đơn cá nhân | Quản lý → **Giám đốc/Owner** |
| Kế toán | Mở lại kỳ / override | Kế toán → **Giám đốc/Owner** |
| Người được uỷ quyền | Thay đổi đặc biệt | Người gửi → **Giám đốc/Owner** nếu bật phê duyệt 2 bước |

### 3.2. State machine đơn từ

```
  ┌───────┐  gửi   ┌───────────┐      ┌──────────────────┐
  │ DRAFT │───────►│ SUBMITTED │─────►│ PENDING_LEVEL_1  │
  └───────┘        └───────────┘      └────────┬─────────┘
      ▲                                        │
      │ bổ sung                                │ duyệt cấp 1
      │                                        ▼
  ┌───┴────────────┐               ┌──────────────────────┐
  │ NEED_MORE_INFO │◄──────────────│ PENDING_NEXT_LEVEL   │
  └────────────────┘  yêu cầu bổ   └──────────┬───────────┘
                      sung                    │ duyệt cấp cuối
                                              ▼
                      ┌──────────┐      ┌──────────┐      ┌───────────┐
                      │ REJECTED │◄─────│ APPROVED │─────►│ EFFECTIVE │
                      └──────────┘      └──────────┘      └───────────┘

  Ngoài ra: CANCELLED (người tạo huỷ theo policy) · EXPIRED (quá hạn nếu policy cho phép)
```

| Trạng thái | Ý nghĩa |
|---|---|
| `DRAFT` | Đã lưu nháp, chưa gửi |
| `SUBMITTED` | Đã gửi; Backend **chốt snapshot workflow** tại thời điểm này (`BR-16`) |
| `PENDING_LEVEL_1` | Chờ cấp duyệt đầu tiên |
| `PENDING_NEXT_LEVEL` | Đã qua cấp 1, chờ cấp cao hơn |
| `NEED_MORE_INFO` | Người duyệt yêu cầu bổ sung; quay lại người tạo |
| `APPROVED` / `REJECTED` | Quyết định cuối. Từ chối **bắt buộc lý do** |
| `EFFECTIVE` | Đã áp dụng vào bảng công / lịch ca |
| `CANCELLED` / `EXPIRED` | Huỷ bởi người tạo / quá hạn theo policy |

### 3.3. Quy tắc bất biến của luồng đơn

| Mã | Quy tắc |
|---|---|
| `BR-14` | Người duyệt không bao giờ là người gửi |
| `BR-16` | Đơn đã gửi giữ **snapshot** cấp duyệt; đổi workflow không đổi người duyệt của item đang chờ |
| `BR-17` | Nhân viên đổi phòng ban giữa chừng → đơn đang chờ vẫn theo cơ cấu cũ |
| — | Người duyệt nghỉ việc/bị khoá → **fallback approver**, hoặc Giám đốc phân công lại. Đơn **không được kẹt vô thời hạn** |
| `BR-08` | Mọi duyệt/từ chối/thu hồi ghi audit: actor, thời điểm, cấp duyệt, lý do |
| — | Đơn liên quan **kỳ đã khoá** → không sửa trực tiếp, đi qua luồng điều chỉnh hậu kiểm (`BR-07`) |

---

## 4. Luồng bảng công cuối tháng

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. TRONG THÁNG — hệ thống liên tục tính provisional timesheet           │
│    Nguồn: attendance + lịch ca + đơn đã duyệt + chính sách (theo version)│
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. TRƯỚC NGÀY CHỐT                                                      │
│    App Nhân viên  → nhắc nhân viên xử lý thiếu công/đơn chưa duyệt      │
│    App Quản lý    → nhắc quản lý xử lý backlog đơn đội nhóm             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. KẾ TOÁN (Web Kế toán)                                                │
│    Recalculate toàn kỳ → xử lý Exception → đối soát                     │
│    Kỳ: OPEN → CALCULATING → OPEN                                        │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. KẾ TOÁN gửi "Đề nghị chốt kỳ"        Kỳ: → PENDING_APPROVAL          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. GIÁM ĐỐC duyệt (App hoặc Web)        Kỳ: → LOCKED                    │
│    Báo cáo/export từ đây dùng VERSION CỐ ĐỊNH                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. NẾU PHÁT HIỆN SAI SAU CHỐT                                           │
│    Kế toán tạo "Yêu cầu mở lại kỳ" → Giám đốc duyệt  → REOPENED         │
│    → sửa → re-calculate → chốt lại với VERSION MỚI    → LOCKED          │
│    Version cũ vẫn giữ để đối chiếu báo cáo đã phát hành                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**Ai chạm vào đâu:**

| Bước | Phân hệ | Vai trò |
|---|---|---|
| 1 | Backend (engine) | — |
| 2 | App Nhân viên · App Quản lý | Nhân viên, Quản lý |
| 3–4 | Web Kế toán | Kế toán |
| 5 | App Giám đốc **hoặc** Web Giám đốc | Giám đốc/Owner |
| 6 | Web Kế toán → App/Web Giám đốc | Kế toán đề nghị, Giám đốc duyệt |

Chi tiết: [05 mục 13](./05-nghiep-vu-web-ke-toan.md#13-kỳ-công--chốt-dữ-liệu-fr-web-period).

---

## 5. Luồng onboarding nhân viên

```
1. Kế toán tạo/import hồ sơ        → hệ thống kiểm tra gói dịch vụ và trùng dữ liệu
2. Hệ thống sinh employee code     → cấp tài khoản + mật khẩu tạm, gửi lời mời
3. Nhân viên đăng nhập             → bắt buộc đổi mật khẩu
                                   → đăng ký sinh trắc học / thiết bị
4. Tài khoản ACTIVE                → nhận lịch ca/phân ca → chấm công được
5. Khi nghỉ việc: Kế toán cập nhật ngày nghỉ
                                   → hệ thống thu hồi quyền theo hiệu lực
                                   → xử lý retention biometrics
                                   → GIỮ NGUYÊN dữ liệu công lịch sử
```

> **Bước 5 là chỗ hay sai.** Nghỉ việc **không** xoá dữ liệu bảng công lịch sử —
> đó là chứng từ. Chỉ thu hồi quyền đăng nhập và xử lý dữ liệu sinh trắc học
> theo chính sách retention. Xem [10 mục retention](./10-yeu-cau-phi-chuc-nang.md).

Chi tiết kèm payload thật:
[19 — Luồng onboarding & đăng ký khuôn mặt](./19-luong-onboarding-va-dang-ky-khuon-mat.md).

---

## 6. Luồng cấp quyền & uỷ quyền

```
1. Giám đốc/Owner chọn người
      → chọn role / module permissions
      → chọn SCOPE dữ liệu
      → chọn thời hạn (nếu uỷ quyền tạm thời)
      → xác nhận (step-up auth nếu là quyền nhạy cảm — BR-18)
              │
              ▼
2. Backend kiểm tra người cấp có quyền cao hơn hoặc đủ quyền grant
              │
              ▼
3. Lưu audit (before/after) + gửi thông báo cho người được cấp
              │
              ▼
4. Hết hạn → permission TỰ THU HỒI
             Các quyết định đã thực hiện vẫn giữ actor trong audit
              │
              ▼
5. Cấp/thu hồi OWNER — quy trình đặc biệt:
       • xác thực mạnh
       • kiểm tra không làm tenant mất Owner cuối cùng (BR-15)
       • thông báo tới các Owner còn lại
       • audit riêng
```

**Kênh thực hiện:**

| Thao tác | App Giám đốc | Web Giám đốc |
|---|---|---|
| Uỷ quyền duyệt tạm thời | ✓ | ✓ |
| Cấp role theo **template có sẵn** | ✓ | ✓ |
| Tạo role tuỳ biến / sửa permission chi tiết | ✗ | ✓ |
| Thu hồi quyền tạm thời | ✓ | ✓ |
| Cấp/chuyển Owner | ✓ (cần `owner.assign` + MFA) | ✓ |
| Gán fallback approver khẩn cấp | ✓ | ✓ |

---

## 7. Bảng đối chiếu "ai làm gì ở đâu"

Tra nhanh khi không chắc một nghiệp vụ thuộc phân hệ nào.

| Nghiệp vụ | App NV | App QL | App GĐ | Web KT | Web GĐ | Web PA |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Chấm công vào/ra | ✓ | ✓ | ✓ | | | |
| Đăng ký khuôn mặt | ✓ | ✓ | ✓ | | | |
| Tạo đơn cá nhân | ✓ | ✓ | ✓ | | | |
| Duyệt đơn nhân viên | | ✓ | ✓ | | ✓ | |
| Duyệt đơn của Quản lý | | | ✓ | | ✓ | |
| Xem bảng công cá nhân | ✓ | ✓ | ✓ | | | |
| Xem bảng công đội nhóm | | ✓ | ✓ | ✓ | ✓ | |
| Sửa dữ liệu công | | | | ✓ | ✓ | |
| Chạy tính công | | | | ✓ | | |
| Gửi duyệt chốt kỳ | | | | ✓ | | |
| Duyệt chốt / mở lại kỳ | | | ✓ | | ✓ | |
| Tạo/sửa hồ sơ nhân sự | | | | ✓ | ✓ | |
| Tra cứu nhân sự (chỉ đọc) | | | ✓ | ✓ | ✓ | |
| Định nghĩa mẫu ca | | | | | ✓ | |
| Phân ca | | ✓ nếu uỷ quyền | | | ✓ | |
| Cấu hình chính sách/geofence | | | | | ✓ | |
| Cấu hình luồng duyệt | | | | | ✓ | |
| Uỷ quyền tạm thời | | | ✓ | | ✓ | |
| Cấp/thu hồi Owner | | | ✓ | | ✓ | |
| Export Excel/PDF lớn | | | | ✓ | ✓ | |
| Xử lý cờ gian lận | | xem | xem | ✓ | ✓ | |
| Quản lý tenant / gói dịch vụ | | | | | | ✓ |
| Giám sát AI Server | | | | | | ✓ |
| Support access vào tenant | | | | | | ✓ có kiểm soát |

---

**Tiếp theo:** [09 — Chống gian lận chấm công](./09-anti-fraud.md)
