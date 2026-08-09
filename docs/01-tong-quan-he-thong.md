# 01 — Tổng quan hệ thống SmartFace

> Nguồn gốc: *Tài liệu mô tả nghiệp vụ — Ứng dụng chấm công thông minh SmartFace, phiên bản 1.0 (PA), ngày 01/08/2026.*
> Tài liệu này là bản chuẩn hoá của Chương I trong PA, bổ sung phần định danh (ID) cho từng yêu cầu để phục vụ thi công và truy vết.

---

## 1. Mục tiêu

SmartFace là ứng dụng chấm công thông minh dùng **nhận diện khuôn mặt (Face ID)** kết hợp **vân tay thiết bị (Fingerprint)**, giúp doanh nghiệp:

| Mục tiêu | Kết quả kỳ vọng |
|---|---|
| Tự động hoá chấm công | Nhân viên chấm vào/ra bằng khuôn mặt hoặc vân tay, không cần máy chấm công vật lý |
| Chống gian lận | Chặn chấm công hộ (buddy punching), giả mạo GPS, gọi thẳng API, chỉnh giờ thiết bị |
| Số hoá đơn từ | Nghỉ phép, ra ngoài, làm bù, OT, công tác… gửi và duyệt trên hệ thống |
| Tính công – tính lương | Tự động quy đổi công chuẩn, OT, phạt đi muộn theo chính sách cấu hình được |
| Vận hành đa tổ chức | Mô hình SaaS multi-tenant: nhiều công ty dùng chung hạ tầng, dữ liệu tách biệt |

---

## 2. Phạm vi hệ thống

### 2.1. Trong phạm vi (In scope)

- **App Nhân viên** (iOS/Android): chấm công, đơn từ, lịch sử, hồ sơ cá nhân.
- **Web Quản lý** (Quản lý / Kế toán / HR): duyệt đơn, quản lý nhân sự, chấm công, tính công – lương, báo cáo.
- **Web Admin** (Quản trị hệ thống): quản lý tenant, người dùng toàn hệ thống, AI Server, bảo mật, vận hành.
- **Backend Core**: API nghiệp vụ, engine tính công, phân quyền, audit.
- **AI Server**: face detection, embedding, so khớp, liveness / anti-spoofing.
- **Cơ chế chống gian lận** xuyên suốt App – Backend – AI Server.

### 2.2. Ngoài phạm vi giai đoạn hiện tại (Out of scope)

- Tích hợp trực tiếp với phần mềm kế toán/lương (MISA, Fast) qua API — **giai đoạn 3**, hiện chỉ xuất Excel theo mẫu.
- Máy chấm công vật lý (kiosk cố định tại văn phòng) — có chỗ trong thiết kế (`Device`) nhưng không thi công ở MVP.
- Tự huấn luyện model nhận diện khuôn mặt — dùng model mã nguồn mở có sẵn (InsightFace/ArcFace).

---

## 3. Các nhóm đối tượng sử dụng (Actors)

| Mã | Actor | Kênh | Phạm vi dữ liệu | Quyền chính |
|---|---|---|---|---|
| `ACT-EMP` | Nhân viên | App Mobile | Cá nhân | Chấm công, gửi đơn, xem lịch sử cá nhân |
| `ACT-MGR` | Quản lý / Trưởng phòng | Web Quản lý | Phòng ban mình quản lý | Duyệt đơn, xem chấm công, xếp ca nhân viên thuộc phòng |
| `ACT-HR` | Kế toán / HR (Payroll) | Web Quản lý | Toàn công ty (chỉ số liệu) | Tính công, tính lương, xuất Excel, quản lý ngày phép, tạo hồ sơ nhân viên |
| `ACT-CADM` | Admin công ty | Web Quản lý | 1 công ty | Cấu hình chính sách công ty, phân quyền nội bộ, quản lý mã mời |
| `ACT-SADM` | Admin hệ thống | Web Admin | Toàn hệ thống, mọi tenant | Quản lý tenant, gói dịch vụ, AI Server, bảo mật, can thiệp kỹ thuật |

> **Lưu ý thiết kế:** một tài khoản (một số điện thoại) có thể thuộc **nhiều công ty** và chuyển đổi (switch company) trong phần Cá nhân — phục vụ nhân sự làm part-time nhiều nơi. Vì vậy quan hệ `UserAccount ↔ Company` là **nhiều–nhiều** thông qua bản ghi `Employee`, không phải một–một.

---

## 4. Bản đồ phân hệ

```
                        ┌─────────────────────────────┐
                        │        SMARTFACE            │
                        └─────────────────────────────┘
                                     │
        ┌────────────────────┬───────┴────────┬────────────────────┐
        ▼                    ▼                ▼                    ▼
┌───────────────┐   ┌────────────────┐  ┌──────────────┐  ┌────────────────┐
│ APP NHÂN VIÊN │   │  WEB QUẢN LÝ   │  │  WEB ADMIN   │  │  ANTI-FRAUD    │
│  (Chương II)  │   │  (Chương III)  │  │  (Chương V)  │  │  (Chương IV)   │
├───────────────┤   ├────────────────┤  ├──────────────┤  ├────────────────┤
│ Đăng nhập OTP │   │ Dashboard      │  │ Tenant       │  │ GPS spoofing   │
│ Đăng ký mặt   │   │ Chấm công      │  │ User toàn HT │  │ Buddy punching │
│ Đăng ký vân   │   │ Duyệt đơn      │  │ Giám sát AI  │  │ API abuse      │
│ Trang chủ     │   │ Công làm bù    │  │ Bảo mật/Log  │  │ Đổi giờ máy    │
│ Đơn từ        │   │ Chính sách     │  │ Cấu hình HT  │  │ Chấm rồi đi    │
│ Lịch sử       │   │ Tính công/lương│  │ Vận hành     │  │ Dashboard cờ   │
│ Cá nhân       │   │ Nhân sự        │  └──────────────┘  └────────────────┘
│ Thống kê      │   │ Báo cáo        │
└───────────────┘   │ Thông báo/Quyền│         ← Anti-fraud là nghiệp vụ
                    │ Mã mời/Thiết bị│           XUYÊN SUỐT cả 4 phân hệ
                    └────────────────┘
```

---

## 5. Danh mục tài liệu

| File | Nội dung | Tương ứng chương PA |
|---|---|---|
| `01-tong-quan-he-thong.md` | Tổng quan, actor, phạm vi, thuật ngữ (tài liệu này) | I |
| `02-kien-truc-he-thong.md` | Kiến trúc, technology stack, triển khai, ADR | I.3, VII |
| `03-nghiep-vu-app-nhan-vien.md` | Nghiệp vụ App Nhân viên | II |
| `04-nghiep-vu-web-quan-ly.md` | Nghiệp vụ Web Quản lý / Kế toán / HR | III |
| `05-nghiep-vu-web-admin.md` | Nghiệp vụ Web Admin | V |
| `06-anti-fraud.md` | Kịch bản gian lận & biện pháp phòng chống | IV |
| `07-mo-hinh-du-lieu.md` | Mô hình dữ liệu, ERD, bảng, ràng buộc | (suy dẫn) |
| `08-hop-dong-api.md` | Hợp đồng API giữa App / Web / Backend / AI Server | (suy dẫn) |
| `09-yeu-cau-phi-chuc-nang.md` | Yêu cầu phi chức năng + tiêu chí chấp nhận | VI |
| `10-lo-trinh-trien-khai.md` | Lộ trình, epic backlog, ước lượng | VIII |
| `00-kien-thuc-nen-tang.md` | Kiến thức nền (face recognition, ngưỡng, liveness, engine tính công) | — (tài liệu tham chiếu kỹ thuật có sẵn) |

---

## 6. Quy ước định danh yêu cầu

Mọi yêu cầu chức năng đều được gắn mã để truy vết từ tài liệu → task → test case:

```
FR-<PHÂN HỆ>-<NHÓM>-<SỐ>
     │          │      └── số thứ tự trong nhóm
     │          └───────── nhóm chức năng (AUTH, ATT, REQ, ...)
     └──────────────────── APP | WEB | ADM | SYS
```

Ví dụ: `FR-APP-AUTH-03` = yêu cầu thứ 3 thuộc nhóm Đăng nhập của App Nhân viên.

Các tiền tố khác:
- `AF-xx` — biện pháp chống gian lận (Anti-Fraud).
- `NFR-xx` — yêu cầu phi chức năng.
- `BR-xx` — quy tắc nghiệp vụ (Business Rule) áp dụng xuyên suốt.
- `ADR-xx` — quyết định kiến trúc (Architecture Decision Record).

---

## 7. Quy tắc nghiệp vụ nền tảng (Business Rules)

Đây là các quy tắc **xuyên suốt mọi phân hệ**, mọi module thi công đều phải tuân thủ.

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-01` | **Thời gian chấm công chính thức luôn lấy theo giờ Server** tại thời điểm nhận request. Giờ trên thiết bị chỉ để hiển thị tham khảo, không bao giờ dùng để tính công. | PA 4.4 |
| `BR-02` | **Backend không tin bất kỳ cờ trạng thái xác thực nào do client tự khai** (ví dụ `faceVerified: true`). Mọi kết quả xác thực phải do Backend tự kiểm chứng lại với AI Server hoặc secure enclave. | PA 4.3 |
| `BR-03` | Nhân viên phải đăng ký **ít nhất 1 phương thức xác thực** (khuôn mặt hoặc vân tay) trước khi được vào Trang chủ và chấm công. | PA 2.1 |
| `BR-04` | **Mã nhân viên là bất biến** sau khi đã dùng để chấm công. Muốn đổi phải qua duyệt của Admin/Kế toán và ghi log. | PA 2.1 |
| `BR-05` | **Ứng dụng không lưu trữ dữ liệu vân tay thực tế.** Vân tay được xác thực cục bộ trên thiết bị; hệ thống chỉ nhận khoá xác nhận (cryptographic key/token). | PA 2.3 |
| `BR-06` | Bản ghi chấm công thô là **bất biến (immutable)**. Mọi hiệu chỉnh phải tạo bản ghi điều chỉnh riêng kèm người thực hiện + lý do, không sửa đè. | PA 3.2, 4.6 |
| `BR-07` | Dữ liệu **kỳ lương đã chốt bị khoá**, không cho sửa chấm công của kỳ đó. Muốn sửa phải mở lại kỳ, có log. | PA 3.6 |
| `BR-08` | Mọi thao tác nhạy cảm (xoá dữ liệu, reset sinh trắc học, đổi phân quyền, sửa công, chốt/mở kỳ lương) đều **ghi audit log** kèm người thực hiện và thời điểm. | PA 5.4 |
| `BR-09` | **Mọi truy vấn dữ liệu nghiệp vụ đều phải lọc theo `company_id`** của phiên đăng nhập. Không có API nào trả dữ liệu chéo tenant, trừ vai trò Admin hệ thống. | PA 5.1, 7.6 |
| `BR-10` | Một khuôn mặt chỉ được đăng ký cho **duy nhất một nhân viên** trong cùng công ty. Trùng khớp với nhân viên khác → chặn đăng ký, cảnh báo gian lận danh tính. | PA 2.2 |
| `BR-11` | **Device binding:** mỗi tài khoản chỉ kích hoạt sinh trắc học trên 1 thiết bị tại 1 thời điểm. Đổi thiết bị phải xác thực lại, có thể cần HR/Admin duyệt. | PA 4.2 |
| `BR-12` | Chính sách công ty (giờ ca, phút trễ cho phép, hệ số OT, quy tắc phạt) **cấu hình được, không hard-code**. | PA 3.5, 3.6 |

---

## 8. Quy tắc sinh mã nhân viên (Employee Code)

Ngay sau khi nhân viên tham gia công ty thành công — dù qua luồng tự nhập mã mời hay do Kế toán/HR tạo sẵn — hệ thống tự sinh một mã định danh **duy nhất trong phạm vi công ty**.

**Định dạng:** `<viết tắt họ tên>.<mã công ty>`

```
Nguyễn Văn Đức  +  công ty AMOBI   →   ducnv.amobi
                                        │    │
                                        │    └── mã công ty (bất biến, do Admin/Kế toán khai báo khi khởi tạo)
                                        └─────── tên chính + viết tắt họ và tên lót
```

**Thuật toán:**

1. Bỏ dấu tiếng Việt, chuyển về chữ thường, loại bỏ khoảng trắng và ký tự đặc biệt.
2. Lấy **tên chính** (từ cuối cùng) + **chữ cái đầu của họ và các tên lót** theo thứ tự xuất hiện.
   `Nguyễn Văn Đức` → tên chính `duc`, họ `n`, tên lót `v` → `ducnv`.
3. Ghép với mã công ty bằng dấu chấm: `ducnv.amobi`.
4. **Nếu trùng trong cùng công ty**, thêm số thứ tự vào sau phần tên viết tắt: `ducnv2.amobi`, `ducnv3.amobi`.

**Ràng buộc:**

- Mã công ty (ví dụ `amobi`) do Admin/Kế toán khai báo lúc khởi tạo công ty, **không đổi trong suốt vòng đời công ty**.
- Kế toán/HR/Admin công ty được **chỉnh sửa mã thủ công trước khi kích hoạt tài khoản**, miễn đảm bảo duy nhất trong công ty.
- Sau khi mã đã được dùng để chấm công thì **bất biến** (`BR-04`).
- Đây là **mã hiển thị nội bộ**, khác với ID hệ thống (UUID) dùng làm khoá chính trong database. Mã này phục vụ con người tra cứu và có thể dùng để đăng nhập thay cho máy chấm công vật lý.

---

## 9. Cấp tài khoản và gia nhập công ty

> **Đã đổi so với bản đầu.** Trước đây có hai luồng song song: nhân viên tự nhập
> mã mời (Luồng A) và HR tạo hồ sơ trước (Luồng B). Nay chỉ còn **một đường
> duy nhất** — HR cấp tài khoản. Mã mời đã bỏ hẳn.
>
> Một đường vào thì ít trường hợp biên và ít lỗ hổng hơn hai. Quan trọng hơn:
> khi nhân viên tự tham gia bằng mã mời, bất kỳ ai có mã cũng vào được công ty —
> mã bị chụp màn hình gửi ra ngoài là chuyện thường.
>
> Đường đi chi tiết kèm payload thật:
> [13 — Từ lúc được cấp tài khoản tới lúc chấm công được](./13-luong-onboarding-va-dang-ky-khuon-mat.md).

### Đường duy nhất — HR cấp tài khoản

```
HR nhập hồ sơ trên Web Quản lý
   (họ tên, EMAIL, SĐT, phòng ban, chức vụ, ngày vào, loại HĐ)
      ↓
hệ thống sinh employee code (HR sửa được trước khi lưu)
      + cấp tài khoản đăng nhập: email + MẬT KHẨU TẠM
      ↓
HR đọc lại mật khẩu tạm cho nhân viên (hiển thị MỘT LẦN)
      ↓
nhân viên mở App, đăng nhập: TÊN MIỀN + EMAIL + MẬT KHẨU
      ↓
BẮT BUỘC đổi mật khẩu       ← token bị chặn ở mọi API khác cho tới khi đổi
      ↓
Thiết lập bảo mật (khuôn mặt hoặc vân tay) → Home
```

**Mật khẩu tạm chỉ để đổi mật khẩu, không mở được gì khác.** Nó đi qua nhiều
tay — HR đọc qua điện thoại, ghi ra giấy, có khi gửi qua tin nhắn. Chốt này
cưỡng chế ở server chứ không phải chỉ điều hướng ở App.

**Trạng thái hồ sơ:**

| Trạng thái | Ý nghĩa | HR được làm gì |
|---|---|---|
| `PENDING_ACTIVATION` | Đã cấp tài khoản, nhân viên chưa hoàn tất thiết lập bảo mật | Sửa hồ sơ, cấp lại mật khẩu, xoá hồ sơ nếu tạo nhầm |
| `ACTIVE` | Đã đăng ký ít nhất một phương thức sinh trắc học | Sửa hồ sơ (có log), không xoá được — chỉ tạm ngưng/chấm dứt |

Vẫn hỗ trợ **import hàng loạt bằng file Excel** (họ tên, **email**, SĐT, phòng
ban, chức vụ); hệ thống tự sinh mã và mật khẩu tạm cho từng dòng, **báo lỗi theo
từng dòng** thay vì fail cả file.

### Một người làm ở hai công ty

Mỗi công ty cấp một **tài khoản riêng, mật khẩu riêng**. Không còn màn hình chọn
công ty, không còn chuyển công ty giữa phiên.

Nhất quán với việc tài khoản do công ty cấp: công ty A không được biết nhân viên
còn làm ở đâu, và mật khẩu do A cấp không được mở dữ liệu của B.

### Đăng nhập bằng OTP

Không còn là cách đăng nhập. Lớp thứ nhất do **Firebase Authentication** đảm
nhiệm: client đăng nhập với Firebase bằng email + mật khẩu, rồi đổi ID token lấy
phiên của Backend. Backend không bao giờ nhận và không lưu mật khẩu.

**Xác thực 2 lớp** là tuỳ chọn, người dùng tự bật, dùng **OTP gửi qua SMS** tới
số điện thoại đã xác minh riêng cho mục đích này.

Không dùng TOTP (Google Authenticator) nữa, và cũng không dùng MFA của Firebase —
MFA đó đòi nâng cấp Identity Platform, còn Firebase Phone Auth thì từ 09/2024 đòi
gói Blaze có gắn thanh toán. Backend tự điều phối thử thách lớp hai, nhờ vậy giữ
được toàn quyền với các ngưỡng chống lạm dụng.

## 10. Từ điển thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| **Tenant** | Một công ty/tổ chức sử dụng hệ thống. Mô hình SaaS đa khách hàng, dữ liệu tách biệt theo `company_id`. |
| **Face embedding** | Vector đặc trưng (thường 512 chiều) trích xuất từ khuôn mặt, dùng để so khớp. Không thể tái tạo lại ảnh gốc từ embedding. |
| **Liveness detection** | Kiểm tra người trước camera là người thật, không phải ảnh in / video phát lại / mặt nạ. |
| **Anti-spoofing** | Tập kỹ thuật chống giả mạo sinh trắc học, bao gồm liveness detection. |
| **Geofencing** | Vùng địa lý (toạ độ tâm + bán kính) mà trong đó nhân viên được phép chấm công. |
| **Mock location** | Vị trí giả do app giả lập GPS cung cấp thay vì cảm biến thật. |
| **Impossible travel** | Hai lượt chấm công liên tiếp mà tốc độ di chuyển suy ra vượt khả năng thực tế → dấu hiệu gian lận. |
| **Device binding** | Ràng buộc tài khoản với một thiết bị cụ thể; đổi thiết bị phải xác thực lại. |
| **App Attestation** | Cơ chế của OS (Play Integrity API / Apple App Attest) chứng minh request đến từ bản app gốc chưa bị chỉnh sửa. |
| **Replay attack** | Ghi lại một request hợp lệ rồi gửi lại nhiều lần để gian lận. Chống bằng nonce + timestamp. |
| **Nonce** | Chuỗi ngẫu nhiên dùng một lần, gắn vào request để chống replay. |
| **Công chuẩn** | Đơn vị quy đổi công việc, ví dụ đủ 8 giờ = 1 công. Quy tắc quy đổi cấu hình được theo công ty. |
| **OT (Overtime)** | Giờ làm thêm ngoài ca chuẩn, tính theo hệ số ngày thường / cuối tuần / lễ. |
| **Kỳ công / Kỳ lương** | Khoảng thời gian tính công (thường theo tháng). Sau khi chốt thì khoá dữ liệu. |
| **Audit trail** | Chuỗi bản ghi lịch sử thao tác nhạy cảm, phục vụ đối soát và kiểm toán. |
| **Confidence score** | Điểm tin cậy AI Server trả về khi so khớp khuôn mặt. |
| **RBAC** | Role-Based Access Control — phân quyền theo vai trò. |

---

## 11. Giả định và ràng buộc

**Giả định:**

- Nhân viên có smartphone cá nhân đủ mạnh để chạy camera + xử lý ảnh cơ bản. Với vị trí không có smartphone, cần bổ sung máy chấm công vật lý (ngoài phạm vi MVP).
- Công ty chấp nhận thu thập và xử lý dữ liệu sinh trắc học, có văn bản đồng ý của người lao động.
- Có kết nối Internet ổn định tại nơi chấm công; chế độ offline chỉ là phương án dự phòng tạm thời (giai đoạn 3).

**Ràng buộc:**

- Tuân thủ quy định pháp luật Việt Nam về bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP) — dữ liệu sinh trắc học thuộc nhóm **dữ liệu cá nhân nhạy cảm**, yêu cầu sự đồng ý riêng và có chính sách vòng đời rõ ràng.
- Nếu khách hàng yêu cầu dữ liệu đặt tại Việt Nam, phải chọn cloud trong nước (Viettel Cloud, VNG Cloud, FPT Cloud) hoặc on-premise.
- Thời gian nhận diện khuôn mặt phải **dưới 2 giây** (`NFR-PERF-01`).
- AI Server cần GPU → chi phí hạ tầng cao hơn backend thông thường, phải scale độc lập.

---

## 12. Câu hỏi mở cần chốt trước khi thi công

| # | Câu hỏi | Ảnh hưởng |
|---|---|---|
| Q1 | Một tài khoản có được thuộc nhiều công ty cùng lúc không? (PA đề xuất "có") | Mô hình dữ liệu `UserAccount ↔ Employee ↔ Company`, luồng switch company |
| Q2 | Chấm công ngoài vùng geofence: **cảnh báo** hay **chặn cứng**? | Logic chấm công, cấu hình chính sách công ty |
| Q3 | Duyệt đơn 1 cấp hay nhiều cấp? Cấu hình theo từng loại đơn? | Thiết kế `ApprovalFlow` — nếu nhiều cấp phải làm state machine ngay từ đầu |
| Q4 | Dùng liveness tự triển khai (Silent-Face-Anti-Spoofing) hay SDK eKYC thương mại (FPT.AI, VNPT)? | Chi phí, thời gian phát triển, độ chính xác, ràng buộc pháp lý |
| Q5 | Quy mô tối đa mỗi tenant? (ảnh hưởng có cần pgvector/Milvus hay không) | Kiến trúc lưu trữ embedding, chiến lược so khớp |
| Q6 | Chấm công theo mô hình 1:1 (đã đăng nhập, biết là ai) hay 1:N (kiosk phải tự tìm ra ai)? | PA mô tả App cá nhân → **1:1**. Nếu sau này thêm kiosk phải xử lý bẫy 1:N (xem `00-kien-thuc-nen-tang.md` Phần 2) |
| Q7 | Chính sách lưu ảnh chấm công: lưu bao lâu, có lưu ảnh gốc hay chỉ embedding? | Chi phí lưu trữ, tuân thủ pháp lý, khả năng đối soát khiếu nại |

---

**Tiếp theo:** [02 — Kiến trúc hệ thống](./02-kien-truc-he-thong.md)
