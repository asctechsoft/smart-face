# 08 — Hợp đồng API

> Suy dẫn từ nghiệp vụ trong tài liệu PA.
> API chuẩn hoá theo **OpenAPI/Swagger 3.1**, tự sinh tài liệu từ decorator NestJS (PA 7.4).
> Tài liệu này định nghĩa **hợp đồng giữa các thành phần** — App/Web gọi Backend, Backend gọi AI Server.

---

## 1. Quy ước chung

### 1.1. Base URL & phiên bản

```
Public API (App + Web):     https://api.smartface.vn/v1
AI Server (nội bộ):         http://ai-server:8000/v1     ← KHÔNG expose ra internet
WebSocket:                  wss://api.smartface.vn/ws
```

Phiên bản nằm trong đường dẫn (`/v1`). Thay đổi phá vỡ tương thích → tăng lên `/v2`, giữ `/v1` chạy song song tối thiểu 6 tháng (vì app mobile không cập nhật đồng loạt được).

### 1.2. Header chuẩn

| Header | Bắt buộc | Mô tả |
|---|---|---|
| `Authorization: Bearer <accessToken>` | ✓ (trừ endpoint auth) | JWT access token |
| `X-Device-Id` | ✓ (App) | ID thiết bị, phải khớp `deviceId` trong token (`AF-16`). **Thiếu header cũng bị chặn**, không chỉ sai giá trị — xem ghi chú dưới bảng |
| `X-App-Version` | ✓ (App) | Kiểm tra phiên bản tối thiểu |
| `X-Platform` | ✓ (App) | `ios` \| `android` \| `web` |
| `X-Signature` | ✓ (endpoint nhạy cảm) | HMAC-SHA256 (`AF-12`) |
| `X-Nonce` | ✓ (endpoint nhạy cảm) | Chuỗi ngẫu nhiên dùng một lần |
| `X-Timestamp` | ✓ (endpoint nhạy cảm) | Unix timestamp giây |
| `X-Body-Sha256` | ✓ (endpoint nhạy cảm dạng multipart) | Băm nội dung body — xem mục 1.2.1 |
| `X-Company-Id` | — | Chỉ dùng khi user thuộc nhiều công ty và chưa switch |
| `Accept-Language` | — | `vi` (mặc định) \| `en` |

> **`X-Device-Id` — quy tắc chính xác** (`AF-16`)
>
> | Loại token | Điều kiện | Xử lý |
> |---|---|---|
> | Token App (payload **có** `deviceId`) | Thiếu header, header rỗng, hoặc không khớp | `AUTH_DEVICE_MISMATCH` (401) |
> | Token Web (payload **không có** `deviceId`) | — | Bỏ qua kiểm tra |
>
> Hai web quản lý không có chức năng chấm công nên không cần ràng buộc thiết bị;
> chỉ App mới chấm công được.
>
> ⚠ **Chốt này KHÔNG chống được token bị đánh cắp.** Payload JWT chỉ được *ký*,
> không được *mã hoá* — ai cầm được token đều giải base64 ra đọc `deviceId` rồi
> tự đặt header cho khớp. Nó chỉ bảo đảm `deviceId` trong ngữ cảnh request luôn
> có thật, để rate limit theo thiết bị và chấm điểm gian lận không bị qua mặt
> bằng cách bỏ trống.
>
> Ràng buộc thiết bị **thật** là `X-Signature`: App ký request bằng
> `deviceSecret` — thứ chỉ cấp một lần lúc đăng nhập, nằm trong secure enclave,
> **không** có trong token. Endpoint nào cần ràng buộc thiết bị thật thì phải
> yêu cầu chữ ký.

### 1.2.1. `X-Body-Sha256` — ràng buộc nội dung của request multipart

Chữ ký `AF-12` gồm `bodyHash`. Với request JSON, server giữ được body thô nên tự
băm lấy. Với `multipart/form-data` thì không: thư viện parse đọc thẳng từ luồng
và không giữ byte gốc, còn buffer thêm một bản sao chỉ để băm nghĩa là mỗi ảnh
5 MB chiếm 10 MB RAM — giờ cao điểm 8h sáng là vài GB.

Vì vậy App khai báo hash qua header `X-Body-Sha256`, và server tính lại độc lập
sau khi parse xong để đối chiếu.

**Công thức — App và Backend phải khớp từng byte:**

```
bodyHash = sha256(
    "file:" + sha256_hex(bytes của file)                       ← dòng đầu, luôn có
  + "\n" + "<len(tên)>:<tên>=<len(giá trị)>:<giá trị>"          ← mỗi trường một dòng
  + ...                                                          sắp xếp theo TÊN
)
```

| Quy tắc | Chi tiết |
|---|---|
| Sắp xếp | Theo tên trường, tăng dần. Thứ tự trong multipart do thư viện HTTP từng nền tảng quyết định, không ổn định giữa iOS và Android |
| Độ dài | Tính bằng **byte UTF-8**, không phải số ký tự. Dart `utf8.encode(s).length` · Swift `s.utf8.count` · Kotlin `s.toByteArray(Charsets.UTF_8).size` |
| Không có file | Dòng đầu là `file:` (phần hash để trống) |
| Trường rỗng/null | Bỏ qua, không đưa vào |
| `sha256_hex` | Chữ thường, 64 ký tự |

**Ví dụ:**

```
file:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
10:authMethod=4:FACE
10:clientTime=24:2026-08-05T01:02:19.882Z
8:location=52:{"latitude":21.012345,"longitude":105.798765}
5:nonce=14:cm3x9k2-lz8f4a
```

> **Vì sao phải ghi kèm độ dài.** Nếu chỉ nối `tên=giá_trị` rồi ghép bằng `\n`
> thì `{a:"1", b:"2"}` và `{a:"1\nb=2"}` băm ra **giống hệt nhau**. Kẻ tấn công
> ký một request có đúng một trường chứa ký tự xuống dòng, rồi trình bày lại
> thành hai trường riêng: hash vẫn khớp, chữ ký vẫn hợp lệ, nhưng dữ liệu server
> đọc được đã khác hẳn.

**Cái này chặn được gì.** Kẻ chặn được request đã ký giữa đường (proxy độc hại,
CA giả) không tạo được request mới vì không có `deviceSecret`. Nhưng nếu chữ ký
không ràng buộc nội dung thì hắn **sửa được request đang bay**: tráo ảnh khuôn
mặt sang người khác, hoặc đổi toạ độ GPS.

Sai hash → `AUTH_SIGNATURE_INVALID` (401). Thiếu header khi
`ATTENDANCE_SIGNATURE_REQUIRED=true` → cũng 401.

**Endpoint yêu cầu header này:** `POST /attendance/check-in` · `check-out` ·
`POST /biometric/face/enroll/submit`.

### 1.3. Định dạng phản hồi

**Thành công:**

```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "pageSize": 20, "total": 156, "totalPages": 8 }
}
```

**Lỗi** (theo `02-kien-truc-he-thong.md` mục 9):

```json
{
  "success": false,
  "error": {
    "code": "FACE_LIVENESS_FAILED",
    "message": "Không xác nhận được người thật. Vui lòng nhìn thẳng vào camera và thử lại.",
    "messageEn": "Liveness check failed. Please look directly at the camera and try again.",
    "hint": "Đảm bảo đủ ánh sáng và không dùng ảnh/video",
    "retryable": true,
    "details": { "livenessScore": 0.42, "threshold": 0.70 },
    "traceId": "01J8XK2M9P4R7T"
  }
}
```

### 1.4. Mã HTTP

| Mã | Ý nghĩa |
|---|---|
| `200` | Thành công |
| `201` | Tạo mới thành công |
| `202` | Đã nhận, xử lý bất đồng bộ (export Excel lớn) |
| `400` | Dữ liệu đầu vào không hợp lệ |
| `401` | Chưa xác thực / token không hợp lệ / hết hạn |
| `403` | Không đủ quyền / vi phạm chính sách (ngoài geofence, thiết bị root) |
| `404` | Không tìm thấy |
| `409` | Xung đột (replay nonce, đơn trùng lịch, employee code trùng) |
| `422` | Vi phạm quy tắc nghiệp vụ (không đủ phép, kỳ lương đã chốt) |
| `429` | Vượt giới hạn tần suất |
| `500` | Lỗi hệ thống |
| `503` | Dịch vụ phụ thuộc không khả dụng (AI Server down) |

### 1.5. Phân trang, lọc, sắp xếp

```
GET /v1/attendance?page=1&pageSize=20&sort=-recordedAt
    &from=2026-08-01&to=2026-08-31
    &departmentId=dep_123&status=LATE&hasFraudFlag=true&q=ducnv
```

- `sort`: tiền tố `-` là giảm dần. Nhiều trường ngăn bằng dấu phẩy.
- `pageSize` tối đa 100. Vượt → trả về 100.
- Xuất dữ liệu lớn dùng endpoint `/export` riêng (bất đồng bộ), không phân trang khổng lồ.

---

## 2. API Xác thực (`/auth`)

> **Danh tính do Firebase Authentication quản lý.** Client đăng nhập với Firebase
> (email + mật khẩu qua SDK) rồi đổi ID token lấy phiên làm việc của Backend.
> Backend **không bao giờ nhận mật khẩu** và không lưu mật khẩu dưới bất kỳ dạng nào.
>
> Tài khoản do công ty cấp sẵn, nhân viên không tự đăng ký. Không còn mã mời.
>
> Xác thực 2 lớp là **tuỳ chọn**, dùng **OTP gửi qua SMS**, người dùng tự bật.

### Ai làm việc gì

| Việc | Firebase | Backend |
|---|:--:|:--:|
| Giữ email + mật khẩu, chống dò mật khẩu | ✔ | |
| Xác minh thông tin đăng nhập | ✔ | |
| Phiên làm việc (access + refresh token, xoay vòng) | | ✔ |
| Ràng buộc thiết bị (AF-16), thu hồi theo từng thiết bị | | ✔ |
| Xác thực 2 lớp (OTP) | | ✔ |
| Vai trò, công ty, phạm vi phòng ban | | ✔ |

Backend vẫn cấp token riêng thay vì dùng thẳng Firebase ID token vì ID token cấp
theo *người dùng* chứ không theo *phiên*: không đặt được `deviceId` cho từng máy,
không thu hồi được phiên của đúng một thiết bị, không phát hiện được việc dùng
lại refresh token, và đẩy vai trò sang custom claims thì thu hồi quyền phải chờ
tới một giờ thay vì 15 phút. Lý do đầy đủ ở đầu `src/modules/auth/auth.service.ts`.

### `POST /v1/auth/session`

Thay cho `POST /auth/login` cũ.

```jsonc
// Request
{
  "domain": "amobi.vn",              // tên miền công ty cấp; chấp nhận cả "https://amobi.vn/"
  "firebaseIdToken": "eyJ...",       // user.getIdToken() sau khi đăng nhập Firebase
  "deviceId": "a3f9c2e1-...",        // BẮT BUỘC với App; Web quản lý không cần
  "deviceInfo": { "model": "iPhone 14", "os": "iOS", "osVersion": "17.5", "appVersion": "1.0.0" }
}

// 200 — đăng nhập thành công
{
  "success": true,
  "data": {
    "accessToken": "eyJ...", "refreshToken": "eyJ...", "expiresIn": 900,
    "deviceSecret": "base64...",        // chỉ trả 1 lần, App lưu vào secure enclave
    "nextStep": "CHANGE_PASSWORD",      // TWO_FACTOR | CHANGE_PASSWORD | SETUP_BIOMETRIC | HOME
    "user": {
      "id": "usr_...", "fullName": "Nguyễn Văn Đức",
      "email": "duc@amobi.vn", "phone": "0901234567",
      "twoFactorEnabled": false
    },
    "employee": {
      "id": "emp_...", "employeeCode": "ducnv.amobi", "companyId": "cmp_1",
      "status": "PENDING_ACTIVATION", "roles": ["EMPLOYEE"]
    }
  }
}

// 200 — tài khoản đã bật xác thực 2 lớp: CHƯA cấp token, OTP vừa được gửi
{
  "success": true,
  "data": {
    "nextStep": "TWO_FACTOR",
    "twoFactorToken": "...", "expiresIn": 300,
    "maskedPhone": "090****567",        // KHÔNG bao giờ trả số đầy đủ
    "codeExpiresIn": 300, "resendAfter": 60
  }
}
```

Ví dụ phía client (Web):

```ts
const cred = await signInWithEmailAndPassword(auth, email, password);
const res  = await api.post('/v1/auth/session', {
  domain, firebaseIdToken: await cred.user.getIdToken(),
});
```

> ⚠ **Lỗi sai email/mật khẩu không còn do Backend trả về.** Client nhận thẳng từ
> Firebase SDK (`auth/wrong-password`, `auth/user-not-found`,
> `auth/too-many-requests`) và tự hiển thị. Việc khoá tạm sau nhiều lần sai cũng
> do Firebase làm — Backend không còn đếm nữa.
>
> ⚠ **Tên miền phải khớp công ty của tài khoản.** Firebase chỉ xác nhận danh
> tính, nó không biết gì về ranh giới công ty; đây là nơi DUY NHẤT kiểm điều đó.
> Tên miền không tồn tại và tên miền sai công ty trả **cùng** mã lỗi, để gõ bừa
> không dò ra được tên miền nào có thật.

Lỗi: `AUTH_FIREBASE_TOKEN_INVALID` (401) · `AUTH_FIREBASE_TOKEN_EXPIRED` (401) ·
`AUTH_ACCOUNT_NOT_PROVISIONED` (403, uid hợp lệ nhưng chưa được HR cấp hồ sơ) ·
`AUTH_DOMAIN_MISMATCH` (403) · `AUTH_ACCOUNT_SUSPENDED` (403) ·
`AUTH_COMPANY_INACTIVE` (403) · `SYS_RATE_LIMITED` (429)

**Quản trị viên nền tảng** không thuộc công ty nào nên gõ tên miền quy ước, mặc
định `system` (đặt qua `SYSTEM_ADMIN_DOMAIN`). Tên miền này bị cấm cấp cho công
ty — trùng thì công ty đó vĩnh viễn không đăng nhập được.

---

### `POST /v1/auth/2fa/verify` · `POST /v1/auth/2fa/resend`

Bước hai khi tài khoản đã bật xác thực 2 lớp. Mã OTP đã được gửi tự động ở bước
`/auth/session`, không cần gọi thêm gì để nhận mã.

```jsonc
// POST /v1/auth/2fa/verify
{ "twoFactorToken": "...", "code": "123456" }   // hoặc một mã dự phòng "abcd-efgh"
// 200 → trả về đúng cấu trúc như /auth/session thành công

// POST /v1/auth/2fa/resend  { "twoFactorToken": "..." } → 200
{ "maskedPhone": "090****567", "codeExpiresIn": 300, "resendAfter": 60 }
```

`twoFactorToken` sống 5 phút, **dùng một lần** — tiêu thụ ngay khi dùng thành
công, nên không thử được nhiều mã trên cùng một phiên.

Mã OTP **dùng một lần rồi xoá**. Nhập sai quá `OTP_MAX_ATTEMPTS` lần → khoá
`OTP_LOCK_SECONDS` giây. Phạm vi đếm theo **tài khoản**, không theo số điện
thoại: hai người khai chung một số mà đếm theo số thì người này nhập sai năm lần
là người kia bị khoá.

**Mã dự phòng được thử trước** khi tính là nhập sai OTP — ngược lại thì người mất
điện thoại, đúng đối tượng mà mã dự phòng sinh ra để cứu, sẽ tự khoá mình sau vài
lần thử.

Lỗi: `AUTH_2FA_INVALID` (401, phiên hết hạn) · `AUTH_2FA_NOT_ENABLED` (422) ·
`AUTH_OTP_INVALID` (401) · `AUTH_OTP_EXPIRED` (401) · `AUTH_OTP_MAX_ATTEMPTS` (429) ·
`AUTH_OTP_RESEND_TOO_SOON` (429) · `AUTH_OTP_SEND_LIMIT` (429)

---

### `POST /v1/auth/password/change`

**Bắt buộc sau khi đăng nhập lần đầu bằng mật khẩu tạm.**

Không còn trường `currentPassword`: Backend không giữ mật khẩu nên không đối
chiếu được. Client phải cho người dùng gõ lại mật khẩu cũ qua Firebase rồi gửi
lên ID token vừa làm mới — `auth_time` trong token chứng minh việc gõ lại vừa xảy
ra (ngưỡng đặt ở `FIREBASE_FRESH_AUTH_WINDOW_SECONDS`, mặc định 300 giây).

```ts
// Client phải làm bước này trước
await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, currentPassword));
const firebaseIdToken = await user.getIdToken(true);
```

```jsonc
// Request
{ "firebaseIdToken": "eyJ...", "newPassword": "..." }

// 200
{
  "success": true,
  "data": {
    "accessToken": "eyJ...", "refreshToken": "eyJ...", "expiresIn": 900,
    "nextStep": "SETUP_BIOMETRIC",
    "revokedSessions": 3
  }
}
```

> ⚠ **Cưỡng chế ở SERVER.** Token cấp ra khi còn mật khẩu tạm mang cờ
> `mustChangePassword`, và `PasswordChangeGuard` chặn **mọi** API khác ngoài ba
> endpoint: `password/change`, `me`, `logout`. Gọi endpoint khác → 403
> `AUTH_MUST_CHANGE_PASSWORD`.
>
> `POST /auth/refresh` **không** xoá cờ này — nếu không thì chỉ cần gọi refresh
> một lần là thoát được màn hình đổi mật khẩu.

**Chính sách mật khẩu:**

| Quy tắc | Giá trị |
|---|---|
| Độ dài tối thiểu | 12 ký tự |
| Nếu chỉ gồm chữ số | phải từ 16 ký tự |
| Tối đa | 128 ký tự |
| Cấm | chứa phần đầu email · nằm trong danh sách phổ biến · chỉ một ký tự lặp lại |

Cố tình **không** có quy tắc "phải có chữ hoa, số và ký tự đặc biệt". Quy tắc
kiểu đó đẩy người dùng tới đúng một khuôn `Matkhau@123` — thoả mọi điều kiện mà
nằm đầu mọi danh sách dò (NIST SP 800-63B đã bỏ khuyến nghị này).

> ⚠ **Chính sách này chỉ áp dụng cho những đường đi QUA Backend**: cấp tài khoản
> và endpoint này. Firebase bản chưa nâng cấp Identity Platform chỉ ép được tối
> thiểu 6 ký tự, nên nếu sau này bật màn hình "quên mật khẩu" mặc định của
> Firebase thì đường đó sẽ lách qua bảng trên. Muốn giữ chuẩn 12 ký tự thì luồng
> đặt lại mật khẩu cũng phải đi qua Backend.
>
> Quy tắc "không trùng mật khẩu hiện tại" đã **bỏ** — Backend không còn giữ mật
> khẩu cũ để so sánh, và Firebase cũng không kiểm điều này.

Đổi xong **thu hồi toàn bộ phiên khác ở CẢ HAI phía** (Backend và Firebase): bỏ
sót bên nào thì bên đó vẫn cho vào bằng mật khẩu cũ.

Lỗi: `AUTH_FIREBASE_TOKEN_INVALID` (401) · `AUTH_REAUTH_STALE` (401, token quá cũ) ·
`AUTH_PASSWORD_TOO_WEAK` (422, kèm `details.reasons`)

---

### `POST /v1/auth/2fa/setup` · `2fa/enable` · `2fa/disable`

```jsonc
// POST /v1/auth/2fa/setup  { "phone": "0912345678" } → 200
{
  "maskedPhone": "091****678",
  "codeExpiresIn": 300,      // mã OTP còn hiệu lực bao lâu
  "resendAfter": 60,         // phải chờ bao lâu mới gửi lại được
  "setupExpiresIn": 600      // hết hạn này phải gọi lại setup
}

// POST /v1/auth/2fa/enable  { "code": "123456" } → 200
{
  "enabled": true,
  "maskedPhone": "091****678",
  "recoveryCodes": ["abcd-efgh", "..."]     // hiển thị MỘT LẦN, server chỉ lưu bản băm
}

// POST /v1/auth/2fa/disable  { "firebaseIdToken": "eyJ..." } → 200
{ "enabled": false }
```

`setup` gửi mã tới số vừa khai nhưng **chưa ghi số vào tài khoản**. Chỉ khi nhập
đúng mã (`enable`) số mới được lưu — ghi trước rồi mới xác minh nghĩa là gõ nhầm
một chữ số cũng đủ khiến mọi mã OTP về sau bay tới máy người lạ, và người dùng
thì tự khoá mình ra ngoài.

Số nhận OTP lưu ở cột riêng `twoFactorPhone`, **tách khỏi** số liên lạc trong hồ
sơ nhân sự: đổi số liên lạc không được âm thầm chuyển hướng OTP.

`disable` đòi ID token vừa làm mới (người dùng gõ lại mật khẩu), thay cho trường
`password` trước đây.

Mã dự phòng dùng **một lần rồi mất**, dành cho trường hợp mất điện thoại.

> **Vì sao không dùng MFA của Firebase.** MFA qua SMS đòi nâng cấp Identity
> Platform (tính tiền theo MAU), và từ 09/2024 mọi tin nhắn của Firebase Phone
> Auth đòi gói Blaze có gắn thanh toán. Dự án đang ở gói Spark nên cả hai đường
> đều đóng. Đổi lại, toàn bộ ngưỡng chống lạm dụng (`OTP_*` trong `.env`) nằm
> trong tay mình.

---

### `POST /v1/auth/refresh` · `POST /v1/auth/logout`

Refresh token **xoay vòng**: mỗi lần refresh trả token mới, token cũ vô hiệu.
Phát hiện dùng lại token cũ → thu hồi toàn bộ phiên của tài khoản (`AF-16`).

---

### `POST /v1/auth/reauth/code` · `POST /v1/auth/reauth/verify`

Lấy `reauthToken` (dùng một lần, TTL 5 phút) cho thao tác nhạy cảm: đổi/xoá
khuôn mặt, đăng ký vân tay cho thiết bị khác.

```jsonc
// POST /v1/auth/reauth/code → 200   (chỉ cần gọi khi đã bật 2 lớp)
{ "maskedPhone": "090****567", "codeExpiresIn": 300, "resendAfter": 60 }

// POST /v1/auth/reauth/verify
{ "firebaseIdToken": "eyJ...", "twoFactorCode": "123456" }  // twoFactorCode bắt buộc nếu đã bật 2FA

// 200
{ "reauthToken": "...", "expiresIn": 300 }
```

> Neo vào **mật khẩu** (qua ID token vừa làm mới của Firebase) chứ không phải chỉ
> OTP. Kẻ cầm được điện thoại đang đăng nhập cũng nhận được SMS gửi tới chính máy
> đó — OTP một mình không phải rào cản trong đúng kịch bản mà chốt này sinh ra để
> chặn; mật khẩu thì hắn không có.

---

## 3. API Sinh trắc học (`/biometric`)

### `POST /v1/biometric/face/enroll/start`

Bắt đầu phiên đăng ký khuôn mặt, nhận danh sách bước cần thực hiện.

```jsonc
// Request — lần đầu (onboarding): body rỗng
{ }

// Request — đăng ký ĐÈ lên hồ sơ đang có: BẮT BUỘC reauthToken
{ "reauthToken": "..." }        // từ POST /v1/auth/reauth/verify, TTL 5 phút
```

> ⚠ **Đăng ký lần đầu khác đăng ký đè.** Chưa có hồ sơ `ACTIVE` nào thì đi thẳng —
> lúc đó người dùng chưa có phương thức sinh trắc học nào để xác thực lại. Đã có
> hồ sơ thì thiếu `reauthToken` sẽ trả `AUTH_REAUTH_REQUIRED` (401).
>
> Không có chốt này thì ai cầm được điện thoại đang đăng nhập chỉ cần chụp 4 tấm
> ảnh của chính mình là chiếm được danh tính chấm công của nạn nhân — và không
> cần đụng tới `DELETE /biometric/face` (nơi đã có chốt xác thực lại).
> Xem [13 mục 7](./13-luong-onboarding-va-dang-ky-khuon-mat.md#7-đăng-ký-lại--nơi-từng-có-lỗ-hổng).

```jsonc
// 200
{
  "success": true,
  "data": {
    "sessionId": "enr_...",
    "expiresIn": 300,
    "isReEnrollment": false,       // true = hồ sơ cũ sẽ bị thay thế, App nên cảnh báo
    "steps": [
      { "order": 1, "angle": "FRONT",      "action": null },
      { "order": 2, "angle": "LEFT",       "action": "TURN_LEFT" },
      { "order": 3, "angle": "RIGHT",      "action": "TURN_RIGHT" },
      { "order": 4, "angle": "FRONT",      "action": "NOD" }       // ← ngẫu nhiên (AF-05)
    ],
    "guidance": { "minFacePixels": 112, "maxFileSizeKb": 800 }
  }
}
```

### `POST /v1/biometric/face/enroll/submit`

`multipart/form-data`

| Field | Kiểu | Mô tả |
|---|---|---|
| `sessionId` | string | Từ bước start |
| `order` | int | Bước thứ mấy |
| `image` | binary | Ảnh JPEG |

```jsonc
// 200 — còn bước tiếp theo
{ "success": true, "data": { "accepted": true, "nextOrder": 2, "quality": { "blur": 142.3, "brightness": 128 } } }

// 200 — hoàn tất
{ "success": true, "data": { "accepted": true, "completed": true, "profileCount": 4,
                             "modelVersion": "buffalo_l@2.1", "isReEnrollment": false } }
```

> Hoàn tất với `isReEnrollment: true` sẽ **thông báo cho HR** và ghi audit với
> action `BIOMETRIC_FACE_REENROLL`. Đăng ký lần đầu không báo — báo mỗi lần
> onboarding chỉ tạo nhiễu khiến HR bỏ qua cảnh báo thật.

Lỗi: toàn bộ nhóm `FACE_*` (xem `03-nghiep-vu-app-nhan-vien.md` mục 3.3), đặc biệt `FACE_DUPLICATE_IDENTITY` (409) khi trùng nhân viên khác (`BR-10`).

---

### `POST /v1/biometric/fingerprint/register`

Cần `X-Signature` (`AF-12`).

```jsonc
// Request
{
  "deviceId": "a3f9c2e1-...",       // ← PHẢI trùng deviceId trong token
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
  "algorithm": "ES256",
  "attestation": { "platform": "android", "token": "..." },  // Play Integrity / App Attest
  "reauthToken": "..."              // ← BẮT BUỘC khi deviceId khác token
}
// 201 { "success": true, "data": { "keyId": "bio_...", "registeredAt": "..." } }
```

> Server **chỉ lưu public key** (`BR-05`). Private key nằm trong secure enclave, không rời khỏi thiết bị.

> ⚠ **`deviceId` phải trùng thiết bị trong token.** Lệch mà không có `reauthToken`
> → `AUTH_REAUTH_REQUIRED` (401). Chặn kịch bản: kẻ lấy được access token đăng ký
> khoá của **máy hắn** rồi chấm công thay nạn nhân — không cần cầm điện thoại.
>
> App luôn đăng ký cho chính máy nó đang chạy nên chốt này không gây ma sát: đổi
> điện thoại thì đăng nhập lại, token mới mang `deviceId` mới, hai bên khớp nhau.
>
> Thay khoá trên thiết bị đã có khoá thì vẫn cho, nhưng **báo HR** + audit
> `BIOMETRIC_FINGERPRINT_REPLACE`.
>
> Chi tiết: [13 mục 9](./13-luong-onboarding-va-dang-ky-khuon-mat.md#9-vân-tay--luồng-thay-thế).

---

### `DELETE /v1/biometric/face` · `DELETE /v1/biometric/fingerprint`

Đăng ký lại/reset. **Bắt buộc xác thực lại danh tính trước** — request phải kèm `reauthToken` lấy từ `POST /v1/auth/reauth` (OTP hoặc sinh trắc học còn lại).

---

## 4. API Chấm công (`/attendance`)

### `GET /v1/attendance/challenge`

Lấy nonce + thao tác liveness ngẫu nhiên + giờ server. **Bắt buộc gọi trước mỗi lần chấm công.**

```jsonc
// 200
{
  "success": true,
  "data": {
    "nonce": "9f2a...",
    "serverTime": "2026-08-03T01:05:12.431Z",   // ← App đối chiếu giờ máy (AF-18)
    "expiresIn": 60,
    "livenessAction": "TURN_LEFT",               // ← NGẪU NHIÊN, do SERVER chọn (AF-05)
                                                 //   TURN_LEFT | TURN_RIGHT | SMILE | NOD
    "expectedType": "CHECK_IN",                  // gợi ý dựa trên trạng thái hiện tại
    "requiresPhoto": true
  }
}
```

---

### `POST /v1/attendance/check-in` · `POST /v1/attendance/check-out`

**Endpoint quan trọng nhất hệ thống.** `multipart/form-data`.

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|:---:|---|
| `nonce` | string | ✓ | Từ `/challenge`, dùng một lần |
| `clientTime` | ISO8601 | ✓ | Giờ máy — chỉ để đối chiếu, không tính công (`BR-01`) |
| `authMethod` | enum | ✓ | `FACE` \| `FINGERPRINT` |
| `image` | binary | ✓ nếu `FACE` | Ảnh khuôn mặt (bằng chứng thô) |
| `signedChallenge` | string | ✓ nếu `FINGERPRINT` | Chữ ký nonce từ secure enclave |
| `location` | JSON | ✓ | Xem bên dưới |
| `deviceContext` | JSON | ✓ | Xem bên dưới |
| `branchId` | string | — | Chi nhánh dự kiến |

```jsonc
// location
{
  "latitude": 21.012345, "longitude": 105.798765,
  "accuracy": 8.2, "provider": "gps", "isMocked": false,
  "altitude": 12.4, "speed": 0.0, "capturedAt": "2026-08-03T01:05:10.000Z"
}

// deviceContext
{
  "deviceId": "a3f9c2e1-...", "model": "iPhone 14", "osVersion": "17.5", "appVersion": "1.0.0",
  "isRooted": false,
  "attestationToken": "eyJ...",        // Play Integrity / App Attest (AF-15)
  "wifiBssid": "a4:2b:8c:...",         // AF-02
  "beaconUuid": null
}
```

> ⚠ **Tuyệt đối KHÔNG có trường `faceVerified` hay `biometricOk` trong payload.** Backend tự kiểm chứng với AI Server (`AF-10`, `BR-02`). Nếu thấy trường như vậy trong code, đó là lỗi nghiêm trọng cần sửa ngay.

```jsonc
// 200 — chấp nhận
{
  "success": true,
  "data": {
    "attendanceId": "att_...",
    "type": "CHECK_IN",
    "recordedAt": "2026-08-03T01:05:12.431Z",    // ← GIỜ SERVER, hiển thị giờ này
    "workDate": "2026-08-03",
    "decision": "ACCEPTED",
    "shift": { "name": "Hành chính", "startTime": "08:00", "endTime": "17:30" },
    "lateMinutes": 0,
    "distanceToBranchM": 45.2,
    "insideGeofence": true,
    "photoUrl": "https://.../presigned?...",      // hết hạn 5 phút
    "flags": []
  }
}

// 200 — chấp nhận nhưng gắn cờ
{
  "success": true,
  "data": {
    "...": "...",
    "decision": "FLAGGED",
    "flags": [{ "code": "OUT_OF_GEOFENCE", "severity": "MEDIUM",
                "message": "Bạn đang ở ngoài vùng cho phép (340m). Lượt chấm công này sẽ được quản lý xem xét." }]
  }
}

// 403 — từ chối
{
  "success": false,
  "error": {
    "code": "FRAUD_MOCK_LOCATION",
    "message": "Phát hiện ứng dụng giả lập vị trí. Vui lòng tắt và thử lại.",
    "retryable": true, "traceId": "..."
  }
}
```

**Bảng mã lỗi endpoint chấm công:**

| Mã HTTP | Error code | Nguyên nhân |
|---|---|---|
| 400 | `ATT_INVALID_NONCE` | Nonce sai định dạng hoặc hết hạn |
| 401 | `AUTH_DEVICE_MISMATCH` | `X-Device-Id` không khớp token (`AF-16`) |
| 401 | `AUTH_SIGNATURE_INVALID` | Chữ ký HMAC sai (`AF-12`) |
| 403 | `FRAUD_MOCK_LOCATION` | Phát hiện GPS giả (`AF-01`) |
| 403 | `FRAUD_ROOTED_DEVICE` | Thiết bị root/jailbreak (`AF-14`) |
| 403 | `FRAUD_ATTESTATION_FAILED` | App Attestation thất bại (`AF-15`) |
| 403 | `ATT_OUT_OF_GEOFENCE` | Ngoài vùng, chính sách = chặn |
| 400 | `FRAUD_CLOCK_SKEW` | Lệch giờ vượt ngưỡng (`AF-18`) |
| 400 | `FRAUD_LOW_GPS_ACCURACY` | Độ chính xác GPS quá thấp (`AF-04`) |
| 409 | `FRAUD_REPLAY_DETECTED` | Nonce đã dùng (`AF-12`) |
| 422 | `FACE_LIVENESS_FAILED` | Liveness dưới ngưỡng |
| 422 | `FACE_NOT_MATCHED` | Điểm tương đồng dưới ngưỡng |
| 422 | `ATT_ALREADY_CHECKED_IN` | Đã chấm vào, chưa chấm ra |
| 422 | `ATT_NO_SHIFT_TODAY` | Không có ca làm việc hôm nay |
| 422 | `ATT_PERIOD_LOCKED` | Kỳ lương đã chốt (`BR-07`) |
| 429 | `SYS_RATE_LIMITED` | Vượt giới hạn tần suất (`AF-13`) |
| 503 | `SYS_AI_UNAVAILABLE` | AI Server không phản hồi |

---

### `GET /v1/attendance/today` · `GET /v1/attendance/history` · `GET /v1/attendance/{id}`

```jsonc
// GET /v1/attendance/today → 200
{
  "success": true,
  "data": {
    "workDate": "2026-08-03",
    "shift": { "name": "Hành chính", "startTime": "08:00", "endTime": "17:30", "breakMinutes": 60 },
    "status": "CHECKED_IN",
    "logs": [{ "id": "att_...", "type": "CHECK_IN", "recordedAt": "...", "authMethod": "FACE" }],
    "workedMinutes": 154,
    "branch": { "id": "brc_1", "name": "VP Hà Nội", "latitude": 21.0123, "longitude": 105.7987, "radiusMeters": 100 }
  }
}
```

---

### `POST /v1/attendance/sync-offline`

Đồng bộ bản ghi chấm công offline (`FR-APP-STAT-06`, giai đoạn 3).

```jsonc
{ "records": [ { "localId": "...", "type": "CHECK_IN", "capturedAt": "...", "location": {...}, "imageBase64": "..." } ] }
```

Bản ghi offline luôn được ghi với `isOffline = true` và `decision = PENDING_REVIEW` — **không tự động vào bảng công**, cần Quản lý/HR duyệt.

---

## 5. API Đơn từ (`/requests`)

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/v1/request-types` | Danh sách loại đơn của công ty + luồng duyệt |
| `POST` | `/v1/requests` | Tạo đơn (nháp hoặc gửi luôn) |
| `GET` | `/v1/requests` | Danh sách đơn (lọc theo status, type, khoảng ngày) |
| `GET` | `/v1/requests/{id}` | Chi tiết đơn + lịch sử duyệt |
| `PATCH` | `/v1/requests/{id}` | Sửa đơn nháp |
| `POST` | `/v1/requests/{id}/submit` | Gửi đơn nháp |
| `POST` | `/v1/requests/{id}/cancel` | Huỷ đơn |
| `POST` | `/v1/requests/{id}/attachments` | Upload minh chứng |
| `GET` | `/v1/requests/pending-approval` | Đơn tôi cần duyệt (vai trò quản lý) |
| `POST` | `/v1/requests/{id}/approve` | Duyệt |
| `POST` | `/v1/requests/{id}/reject` | Từ chối (bắt buộc lý do) |
| `POST` | `/v1/requests/bulk-approve` | Duyệt hàng loạt |
| `GET` | `/v1/requests/reference` | Thông tin tham chiếu: phép còn lại, giờ nợ/dư |

```jsonc
// POST /v1/requests
{
  "requestTypeCode": "ANNUAL_LEAVE",
  "startAt": "2026-08-10T00:00:00+07:00",
  "endAt": "2026-08-12T23:59:59+07:00",
  "isHalfDay": false,
  "reason": "Việc gia đình",
  "submitNow": true
}

// 201
{
  "success": true,
  "data": {
    "id": "req_...", "status": "PENDING", "quantity": 3,
    "approvalSteps": [
      { "order": 1, "approverRole": "DIRECT_MANAGER", "approverName": "Trần Văn B", "status": "PENDING" },
      { "order": 2, "approverRole": "HR_PAYROLL", "approverName": null, "status": "PENDING" }
    ],
    "leaveBalanceAfter": 5.5
  }
}
```

Lỗi: `REQ_INSUFFICIENT_LEAVE` (422) · `REQ_OVERLAP` (409) · `REQ_ATTACHMENT_REQUIRED` (422) · `REQ_PERIOD_LOCKED` (422) · `REQ_CANNOT_APPROVE_OWN` (403, `BR-APV-03`)

```jsonc
// POST /v1/requests/bulk-approve
{ "requestIds": ["req_1", "req_2", "req_3"], "comment": "Đồng ý" }

// 200 — KHÔNG fail cả lô khi một đơn lỗi (BR-APV-05)
{
  "success": true,
  "data": {
    "approved": ["req_1", "req_3"],
    "failed": [{ "id": "req_2", "code": "REQ_INSUFFICIENT_LEAVE", "message": "Nhân viên không đủ phép" }]
  }
}
```

---

## 6. API Web Quản lý

### 6.1. Chấm công

| Method | Endpoint | Quyền |
|---|---|---|
| `GET` | `/v1/admin/attendance` | MANAGER (phòng ban) · HR · COMPANY_ADMIN |
| `GET` | `/v1/admin/attendance/{id}` | như trên |
| `POST` | `/v1/admin/attendance/adjust` | HR · COMPANY_ADMIN |
| `POST` | `/v1/admin/attendance/export` | HR · COMPANY_ADMIN · MANAGER |

```jsonc
// POST /v1/admin/attendance/adjust — KHÔNG sửa đè, tạo bản ghi điều chỉnh (BR-ADJ-01)
{
  "employeeId": "emp_...",
  "workDate": "2026-08-02",
  "adjustType": "MODIFY_TIME",
  "attendanceLogId": "att_...",
  "afterValue": { "recordedAt": "2026-08-02T01:00:00Z" },
  "reason": "Nhân viên quên chấm công, có xác nhận của quản lý phòng"
}
// 201 → tự động kích hoạt tính lại AttendanceDaily (BR-ADJ-04)
```

```jsonc
// POST /v1/admin/attendance/export — bất đồng bộ
{ "from": "2026-08-01", "to": "2026-08-31", "departmentIds": ["dep_1"], "format": "XLSX", "template": "default" }
// 202
{ "success": true, "data": { "jobId": "exp_...", "statusUrl": "/v1/jobs/exp_..." } }
```

### 6.2. Nhân sự

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/v1/admin/employees` | Danh sách nhân viên |
| `POST` | `/v1/admin/employees/preview-code` | Xem trước employee code sinh ra |
| `POST` | `/v1/admin/employees` | Tạo nhân viên (Luồng B), gửi SMS mời |
| `PATCH` | `/v1/admin/employees/{id}` | Sửa hồ sơ |
| `DELETE` | `/v1/admin/employees/{id}` | Xoá hồ sơ (chỉ khi `PENDING_ACTIVATION`) |
| `POST` | `/v1/admin/employees/{id}/resend-invite` | Gửi lại lời mời |
| `POST` | `/v1/admin/employees/{id}/suspend` | Tạm ngưng |
| `POST` | `/v1/admin/employees/{id}/terminate` | Chấm dứt hợp đồng |
| `POST` | `/v1/admin/employees/import/validate` | Kiểm tra file Excel, trả kết quả theo từng dòng |
| `POST` | `/v1/admin/employees/import/execute` | Thực hiện import các dòng hợp lệ |

```jsonc
// POST /v1/admin/employees/preview-code
{ "fullName": "Nguyễn Văn Đức" }
// 200 { "success": true, "data": { "employeeCode": "ducnv.amobi", "isAvailable": true } }

// POST /v1/admin/employees/import/validate → 200
{
  "success": true,
  "data": {
    "totalRows": 200, "validRows": 195, "invalidRows": 5,
    "rows": [
      { "row": 2, "fullName": "Nguyễn Văn Đức", "phone": "0901234567",
        "generatedCode": "ducnv.amobi", "valid": true, "errors": [] },
      { "row": 3, "fullName": "Trần Thị M", "phone": "090123456",
        "generatedCode": null, "valid": false,
        "errors": [{ "field": "phone", "code": "INVALID_PHONE", "message": "Số điện thoại không đúng định dạng" }] }
    ]
  }
}
```

### 6.3. Chính sách, tính công, báo cáo

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET/PUT` | `/v1/admin/policies` | Cấu hình chính sách công ty (`BR-12`) |
| `GET/POST/PUT` | `/v1/admin/shifts` | Ca làm việc |
| `POST` | `/v1/admin/shift-assignments/bulk` | Phân ca hàng loạt |
| `GET/POST` | `/v1/admin/holidays` | Danh mục ngày lễ |
| `GET` | `/v1/admin/payroll/periods` | Danh sách kỳ lương |
| `POST` | `/v1/admin/payroll/periods/{id}/recalculate` | Chạy lại tính công cho kỳ |
| `GET` | `/v1/admin/payroll/periods/{id}/pre-close-report` | Báo cáo tiền chốt |
| `POST` | `/v1/admin/payroll/periods/{id}/close` | Chốt kỳ |
| `POST` | `/v1/admin/payroll/periods/{id}/reopen` | Mở lại kỳ (bắt buộc lý do, audit) |
| `POST` | `/v1/admin/payroll/export` | Xuất bảng công/lương |
| `GET` | `/v1/admin/reports/attendance-trend` | Biểu đồ chuyên cần |
| `GET` | `/v1/admin/reports/violations` | Nhân viên vi phạm nhiều lần |
| `GET` | `/v1/admin/reports/leave-usage` | Sử dụng phép năm |
| `GET` | `/v1/admin/reports/overtime` | Tổng hợp OT |

```jsonc
// GET /v1/admin/payroll/periods/{id}/pre-close-report → 200
{
  "success": true,
  "data": {
    "period": { "name": "Tháng 08/2026", "startDate": "2026-08-01", "endDate": "2026-08-31" },
    "blockers": {
      "missingRecords": 12,          // chấm vào không chấm ra
      "pendingRequests": 3,          // đơn còn chờ duyệt ảnh hưởng kỳ
      "unreviewedFraudFlags": 5      // cờ nghi vấn chưa xử lý
    },
    "anomalies": [
      { "employeeId": "emp_...", "employeeCode": "hulv.amobi", "issue": "Số công bất thường: 4.5 (trung bình 22)" }
    ],
    "canClose": false
  }
}
```

### 6.4. Chống gian lận

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/v1/admin/fraud/flags` | Danh sách cờ nghi vấn (`AF-21`) |
| `GET` | `/v1/admin/fraud/flags/{id}` | Chi tiết cờ + bằng chứng |
| `POST` | `/v1/admin/fraud/flags/{id}/review` | Quyết định giữ/huỷ công (`AF-23`) |
| `GET` | `/v1/admin/fraud/stats` | Thống kê cờ theo thời gian |

```jsonc
// POST /v1/admin/fraud/flags/{id}/review
{ "decision": "VOID", "reason": "Nhân viên xác nhận đã dùng app fake GPS" }
// → tạo AttendanceAdjustment (VOID), tính lại công, ghi audit, thông báo nhân viên
```

---

## 7. API Web Admin (`/system`)

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET/POST` | `/v1/system/tenants` | Quản lý tenant |
| `POST` | `/v1/system/tenants/{id}/suspend` | Tạm ngưng công ty |
| `GET/PUT` | `/v1/system/plans` | Gói dịch vụ |
| `GET` | `/v1/system/users` | Tìm kiếm tài khoản toàn hệ thống |
| `POST` | `/v1/system/users/{id}/block` | Khoá/mở khoá |
| `POST` | `/v1/system/users/{id}/reset-biometric` | Reset sinh trắc học (bắt buộc lý do) |
| `POST` | `/v1/system/users/{id}/revoke-device` | Thu hồi liên kết thiết bị |
| `GET` | `/v1/system/ai/metrics` | Chỉ số AI Server |
| `GET/POST` | `/v1/system/ai/models` | Quản lý phiên bản model |
| `POST` | `/v1/system/ai/models/{id}/deploy` | Triển khai model |
| `POST` | `/v1/system/ai/models/{id}/rollback` | Rollback |
| `GET/PUT` | `/v1/system/config` | Cấu hình chung (SMS, OTP, timeout AI, lưu trữ) |
| `GET` | `/v1/system/audit-logs` | Tra cứu audit log |
| `GET` | `/v1/system/health` | Health check toàn hệ thống |
| `GET` | `/v1/system/queues` | Trạng thái hàng đợi |
| `POST` | `/v1/system/queues/{name}/retry` | Retry job lỗi |
| `POST` | `/v1/system/maintenance` | Bật/tắt chế độ bảo trì |

```jsonc
// POST /v1/system/users/{id}/reset-biometric — thao tác nhạy cảm (A3)
{
  "resetFace": true, "resetFingerprint": true, "revokeDevices": true,
  "reason": "Nhân viên báo mất điện thoại - ticket #4821",
  "confirmEmployeeCode": "ducnv.amobi"      // xác nhận hai bước
}
// → thực thi + audit log + thông báo nhân viên và HR công ty
```

---

## 8. API AI Server (nội bộ)

> **Không expose ra internet.** Chỉ nhận request từ Backend Core trong mạng nội bộ.
> Xác thực: header `X-Internal-Key: <secret>`.
> **AI Server trả số liệu, KHÔNG ra quyết định** (`P3`).

### `POST /v1/enroll`

```jsonc
// multipart/form-data: image (binary), require_liveness (bool), liveness_action (string|null)
// 200
{
  "face_found": true,
  "quality": { "blur": 142.3, "brightness": 128, "yaw": -4.2, "pitch": 2.1, "face_px": 218 },
  "liveness": { "score": 0.91, "action_verified": true },
  "embedding": [0.0123, -0.0456, "...512 số float..."],
  "model_version": "buffalo_l@2.1",
  "processing_ms": 187
}
// 200 — không tìm thấy khuôn mặt
{ "face_found": false, "error_code": "FACE_NOT_FOUND", "processing_ms": 42 }
```

### `POST /v1/verify` — so khớp 1:1 (dùng cho chấm công qua App)

```jsonc
// Request
{
  "image_base64": "...",
  "embeddings": [[...], [...], [...]],       // các embedding đã đăng ký của ĐÚNG nhân viên đó
  "require_liveness": true,
  "liveness_action": "TURN_LEFT"
}
// 200
{
  "face_found": true,
  "quality": { "blur": 138.1, "brightness": 131, "yaw": 1.8, "face_px": 224 },
  "liveness": { "score": 0.88, "action_verified": true },
  "match": { "best_score": 0.7213, "scores": [0.7213, 0.6891, 0.6544] },
  "model_version": "buffalo_l@2.1",
  "processing_ms": 176
}
```

> Backend nhận `best_score` và `liveness.score`, so với ngưỡng cấu hình theo công ty rồi tự quyết định. AI Server **không biết** ngưỡng là bao nhiêu.

### `POST /v1/identify` — so khớp 1:N (kiosk, giai đoạn sau)

```jsonc
// Request
{ "image_base64": "...", "scope_ids": ["emp_1", "emp_2", "..."], "top_k": 5, "require_liveness": true }
// 200
{
  "face_found": true,
  "liveness": { "score": 0.90 },
  "matches": [
    { "employee_id": "emp_45", "score": 0.7213 },
    { "employee_id": "emp_78", "score": 0.3104 }
  ],
  "margin": 0.4109,                          // ← khoảng cách top1 - top2, QUAN TRỌNG với 1:N
  "processing_ms": 243
}
```

> Với 1:N, ngoài ngưỡng điểm còn phải kiểm tra `margin` đủ lớn. Điểm cao nhưng margin nhỏ = hai người giống nhau, không được tin. Xem `00-kien-thuc-nen-tang.md` Phần 2.

### `POST /v1/liveness` · `POST /v1/batch/audit` · `GET /health` · `GET /metrics`

```jsonc
// GET /health
{
  "status": "healthy",
  "model": { "name": "buffalo_l", "version": "2.1", "loaded_at": "2026-07-20T03:00:00Z" },
  "gpu": { "available": true, "utilization": 0.62, "memory_used_mb": 3420 },
  "uptime_seconds": 1234567
}
```

---

## 9. WebSocket

```
wss://api.smartface.vn/ws?token=<accessToken>
```

| Sự kiện | Hướng | Người nhận | Nội dung |
|---|---|---|---|
| `request.decided` | server → client | Nhân viên gửi đơn | Đơn được duyệt/từ chối |
| `request.pending` | server → client | Người duyệt | Có đơn mới cần duyệt |
| `attendance.recorded` | server → client | Web Quản lý | Cập nhật dashboard realtime |
| `fraud.flagged` | server → client | HR / Admin công ty | Cờ nghi vấn mức cao |
| `notification.new` | server → client | Người nhận | Thông báo mới |
| `system.maintenance` | server → client | Tất cả | Sắp bảo trì |

---

## 10. Rate limit

| Nhóm endpoint | Giới hạn | Phạm vi |
|---|---|---|
| `/auth/otp/request` | 5 req/giờ | Theo SĐT + IP |
| `/auth/otp/verify` | 10 req/15 phút, 5 lần sai → khoá | Theo SĐT |
| `/attendance/check-in|out` | 10 req/giờ | Theo tài khoản + thiết bị |
| `/biometric/face/enroll/*` | 20 req/giờ | Theo tài khoản |
| API đọc thông thường | 300 req/phút | Theo tài khoản |
| API ghi thông thường | 60 req/phút | Theo tài khoản |
| Export | 5 req/giờ | Theo tài khoản |
| Toàn cục theo IP | 600 req/phút | Theo IP |

Vượt giới hạn → `429` kèm header `Retry-After` và `X-RateLimit-Remaining`.

---

## 11. Checklist khi thêm endpoint mới

- [ ] Có `TenantGuard` — mọi query lọc theo `companyId` (`BR-09`).
- [ ] Có `RolesGuard` (+ `ScopeGuard` nếu vai trò MANAGER được truy cập).
- [ ] DTO validate đầy đủ, không dùng `any`.
- [ ] Không nhận cờ trạng thái xác thực từ client (`BR-02`).
- [ ] Thao tác nhạy cảm có `@Audit()` và bắt buộc trường `reason` (`BR-08`).
- [ ] Thao tác ghi kiểm tra kỳ lương đã chốt chưa (`BR-07`).
- [ ] Trả lỗi theo error contract chuẩn, mã lỗi khai báo trong bảng tập trung.
- [ ] Có decorator OpenAPI đầy đủ (mô tả, ví dụ, mã lỗi có thể xảy ra).
- [ ] Có integration test kiểm tra cách ly tenant (đăng nhập tenant A không đọc được dữ liệu tenant B).

---

**Tiếp theo:** [09 — Yêu cầu phi chức năng](./09-yeu-cau-phi-chuc-nang.md)
