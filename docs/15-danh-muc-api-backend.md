# 15 — Danh mục API Backend (thực tế đang có trong mã nguồn)

> **Nguồn:** đọc trực tiếp từ `server-backend-smart/src/modules/**/*.controller.ts` tại thời điểm 09/08/2026.
> Tài liệu này mô tả **API đã thi công**, khác với [08-hop-dong-api.md](./08-hop-dong-api.md) là **hợp đồng thiết kế**.
> Khi hai tài liệu lệch nhau, mã nguồn (và Swagger sinh từ mã nguồn) là nguồn đúng.

**Swagger sống:** `http://localhost:3000/v1/docs` — luôn khớp code vì sinh từ decorator (NFR-MAINT-04).

---

## Mục lục

| # | Nhóm | Tiền tố | Client dùng |
|---|---|---|---|
| [1](#1-quy-ước-chung) | Quy ước chung | — | tất cả |
| [2](#2-hệ-thống--công-khai) | Hệ thống (không cần token) | `/health`, `/v1/time`, `/v1/meta` | tất cả |
| [3](#3-xác-thực--auth) | Xác thực | `/v1/auth` | App, Web |
| [4](#4-sinh-trắc-học--biometric) | Sinh trắc học | `/v1/biometric` | App |
| [5](#5-chấm-công--app) | Chấm công (App) | `/v1/attendance` | App |
| [6](#6-cá-nhân--công-ty) | Cá nhân & Công ty | `/v1/me`, `/v1/company` | App |
| [7](#7-đơn-từ) | Đơn từ | `/v1/requests` | App + Web |
| [8](#8-thông-báo) | Thông báo | `/v1/notifications` | App + Web |
| [9](#9-web-quản-lý--chấm-công) | Chấm công (Quản lý) | `/v1/admin/attendance`, `/v1/admin/attendance-sheets`, `/v1/jobs` | Web Quản lý |
| [10](#10-web-quản-lý--nhân-sự) | Nhân sự | `/v1/admin/employees` | Web Quản lý |
| [11](#11-web-quản-lý--chính-sách) | Chính sách, ca, lễ, chi nhánh, phòng ban | `/v1/admin` | Web Quản lý |
| [12](#12-web-quản-lý--tính-công--lương) | Tính công & Lương | `/v1/admin/payroll` | Web Quản lý |
| [13](#13-web-quản-lý--dashboard--báo-cáo) | Dashboard & Báo cáo | `/v1/admin` | Web Quản lý |
| [14](#14-web-quản-lý--chống-gian-lận) | Chống gian lận | `/v1/admin/fraud` | Web Quản lý |
| [15](#15-web-quản-lý--audit-log) | Audit log | `/v1/admin/audit-logs` | Web Quản lý |
| [16](#16-web-admin--quản-trị-nền-tảng) | Quản trị nền tảng | `/v1/system` | Web Admin |
| [17](#17-bảng-tra-nhanh-toàn-bộ-endpoint) | Bảng tra nhanh toàn bộ endpoint | — | — |

---

## 1. Quy ước chung

### 1.1 Base URL và tiền tố

```
http://localhost:3000/v1        ← mọi API nghiệp vụ
http://localhost:3000/health    ← NGOÀI tiền tố (readiness probe của K8s)
```

Tiền tố cấu hình bằng `API_PREFIX` (mặc định `v1`). `main.ts` loại trừ `health` và `metrics` khỏi tiền tố để probe của K8s không phải đổi đường dẫn mỗi lần nâng phiên bản API.

### 1.2 Định dạng phản hồi — luôn được bọc

`TransformInterceptor` bọc mọi phản hồi thành công. **Controller trả dữ liệu trần**, không tự bọc (tự bọc sẽ thành `data.data` lồng hai lớp).

Thành công:
```json
{
  "success": true,
  "data": { "...": "..." }
}
```

Thành công có phân trang:
```json
{
  "success": true,
  "data": [ { "...": "..." } ],
  "meta": { "page": 1, "pageSize": 20, "total": 156, "totalPages": 8 }
}
```

Lỗi (`AllExceptionsFilter`):
```json
{
  "success": false,
  "error": {
    "code": "FACE_LIVENESS_FAILED",
    "message": "Không xác nhận được người thật. Vui lòng thử lại.",
    "messageEn": "Liveness check failed. Please try again.",
    "hint": "Đảm bảo đủ ánh sáng và không dùng ảnh/video",
    "retryable": true,
    "details": { "livenessScore": 0.42, "threshold": 0.7 },
    "traceId": "01J8XK2M9P4R7T"
  }
}
```

> **Client TUYỆT ĐỐI không so khớp `message`.** Chỉ dùng `code` — chuỗi thông báo có thể đổi bất cứ lúc nào. Tải toàn bộ bảng mã lỗi bằng `GET /v1/meta/error-codes` lúc khởi động app.

### 1.3 Header

| Header | Bắt buộc khi | Ý nghĩa |
|---|---|---|
| `Authorization: Bearer <accessToken>` | mọi endpoint trừ `@Public()` | Access token JWT, TTL 900s |
| `X-Device-Id` | App | Phải khớp `deviceId` trong token (AF-16) |
| `X-Platform` | khuyến nghị | `ios` \| `android` \| `web` |
| `X-Signature` | endpoint có `@RequireSignature()` | HMAC của request (AF-12) |
| `X-Nonce` | cùng bộ với `X-Signature` | Nonce dùng một lần, TTL 300s |
| `X-Timestamp` | cùng bộ với `X-Signature` | Epoch giây, lệch tối đa 120s |
| `X-Body-Sha256` | request **multipart** có ký | SHA-256 của body; `VerifyBodyHashInterceptor` đối chiếu lại |

**Cách tính chữ ký** (`SignatureGuard` + `computeRequestSignature`):

```
signature = HMAC-SHA256(
    key  = sha256(deviceSecret),
    data = METHOD + "\n" + PATH_KHÔNG_QUERY + "\n" + bodyHash + "\n" + nonce + "\n" + timestamp
)
```

- `deviceSecret` chỉ được trả **một lần duy nhất** trong phản hồi đăng nhập khi liên kết thiết bị mới → App lưu vào secure enclave/keystore.
- Với JSON: `bodyHash = sha256(rawBody)` — server tự băm body thô, không tin client.
- Với multipart: client khai `X-Body-Sha256`, chữ ký cam kết vào hash đó, rồi interceptor đối chiếu hash với nội dung thật. **Cần cả hai mắt xích**; thiếu một là chữ ký mất tác dụng.
- Bật/tắt bằng `ATTENDANCE_SIGNATURE_REQUIRED`. Ở dev có thể tắt, nhưng gửi *một phần* bộ ba header luôn bị từ chối.

Ba lỗi theo đúng thứ tự kiểm tra:
1. Lệch giờ > 120s → `FRAUD_CLOCK_SKEW`
2. Nonce đã dùng → `FRAUD_REPLAY_DETECTED`
3. Chữ ký sai → `AUTH_SIGNATURE_INVALID`

### 1.4 Phân trang, lọc, sắp xếp

Mọi endpoint danh sách kế thừa `PaginationQueryDto`:

| Tham số | Mặc định | Ghi chú |
|---|---|---|
| `page` | 1 | Đếm từ 1 |
| `pageSize` | 20 | **Trần cứng 100**, vượt bị ép về 100 |
| `sort` | — | Tiền tố `-` = giảm dần, nhiều trường ngăn bằng dấu phẩy: `-recordedAt,employeeCode` |
| `q` | — | Từ khoá tìm kiếm tự do |

### 1.5 Chuỗi guard toàn cục (thứ tự KHÔNG được đổi)

```
JwtAuthGuard → PasswordChangeGuard → TenantGuard → RolesGuard
             → ScopeGuard → SignatureGuard → RateLimitGuard
```

| Decorator | Bỏ qua guard | Dùng ở đâu |
|---|---|---|
| `@Public()` | JwtAuthGuard | login, refresh, health, time, error-codes |
| `@SkipTenant()` | TenantGuard | thao tác trên **tài khoản** (chưa gắn công ty) + toàn bộ `/v1/system` |
| `@AllowPendingPassword()` | PasswordChangeGuard | **chỉ** `password/change`, `logout`, `me` |
| `@Roles(...)` | — | bật RolesGuard |
| `@DepartmentScoped()` | — | bật ScopeGuard: MANAGER chỉ thấy phòng ban mình quản lý |
| `@RequireSignature()` | — | bật SignatureGuard |

> `@AllowPendingPassword()` đặt nhầm ở endpoint khác là **vô hiệu hoá luôn** cơ chế buộc đổi mật khẩu lần đầu.

### 1.6 Vai trò

| Vai trò | Phạm vi |
|---|---|
| `EMPLOYEE` | chính mình |
| `MANAGER` | **đọc** dữ liệu phòng ban được giao (`managedDepartmentIds`) |
| `HR_PAYROLL` | ghi dữ liệu nhân sự, chấm công, lương của cả công ty |
| `COMPANY_ADMIN` | toàn quyền trong công ty |
| `SYSTEM_ADMIN` | quản trị nền tảng, xuyên công ty (`/v1/system`) |

### 1.7 Rate limit

Trả `429` kèm `SYS_RATE_LIMITED` và header `Retry-After`, `X-RateLimit-Remaining`.

| Bucket | Giới hạn | Tính theo | Endpoint |
|---|---|---|---|
| `session` | 20 / 15 phút | IP | `POST /auth/session` |
| `login-2fa` | 10 / 15 phút | IP | `POST /auth/2fa/verify` |
| `login-2fa-resend` | 5 / 15 phút | IP | `POST /auth/2fa/resend` |
| `2fa-setup` | 10 / giờ | tài khoản | `POST /auth/2fa/setup` |
| `reauth-code` | 5 / 15 phút | tài khoản | `POST /auth/reauth/code` |
| `reauth` | 10 / 15 phút | tài khoản | `POST /auth/reauth/verify` |
| `attendance` | **10 / giờ** | tài khoản + thiết bị | `check-in`, `check-out` |
| `face-enroll` | 20 / giờ | tài khoản | đăng ký khuôn mặt |
| `export` | 5 / giờ | tài khoản | xuất Excel |

---

## 2. Hệ thống — công khai

Ba endpoint `@Public()`, gọi được trước khi đăng nhập.

### `GET /health`

**Làm gì:** readiness probe cho K8s. Kiểm tra thật cả PostgreSQL và Redis, không trả 200 rỗng.
Cố ý **không bao giờ ném lỗi**: hỏng thì vẫn trả 200 kèm `status: "degraded"` để người trực biết chính xác thành phần nào chết (trả 500 thì K8s chỉ biết "hỏng gì đó").

```bash
curl http://localhost:3000/health
```
```json
{ "status": "healthy", "dependencies": { "database": true, "redis": true },
  "timestamp": "2026-08-09T03:15:00.000Z" }
```

### `GET /v1/time`

**Làm gì:** trả giờ chuẩn của server. **App phải lấy giờ hiển thị từ đây**, không dùng `DateTime.now()` của máy cho bất cứ thứ gì liên quan tới chấm công (BR-01, AF-17).

```bash
curl http://localhost:3000/v1/time
```
```json
{ "serverTime": "2026-08-09T03:15:00.000Z", "epochSeconds": 1786000500 }
```

### `GET /v1/meta/error-codes`

**Làm gì:** trả **toàn bộ** bảng mã lỗi. Nguồn duy nhất cho App và Web — client tải về lúc khởi động rồi ánh xạ sang i18n của mình, thay vì hard-code chuỗi tiếng Việt rải rác trong Flutter/React.

```bash
curl http://localhost:3000/v1/meta/error-codes
```
```json
[ { "code": "ATT_OUT_OF_GEOFENCE", "httpStatus": 422,
    "message": "Bạn đang ở ngoài phạm vi cho phép.",
    "messageEn": "You are outside the allowed area.",
    "hint": "Di chuyển tới gần văn phòng rồi thử lại.", "retryable": true } ]
```

---

## 3. Xác thực — `/v1/auth`

> **Backend KHÔNG BAO GIỜ nhận mật khẩu.** Client đăng nhập với Firebase trước (email + mật khẩu qua Firebase SDK), rồi gửi **ID token** lên Backend để đổi lấy phiên làm việc.

### Luồng đăng nhập đầy đủ

```
Firebase SDK: signInWithEmailAndPassword() → idToken
   │
   ▼
POST /v1/auth/session  { domain, firebaseIdToken, deviceId, deviceInfo }
   │
   ├── nextStep = TWO_FACTOR       → POST /v1/auth/2fa/verify  { twoFactorToken, code }
   ├── nextStep = CHANGE_PASSWORD  → POST /v1/auth/password/change
   ├── nextStep = SETUP_BIOMETRIC  → luồng đăng ký khuôn mặt (mục 4)
   └── nextStep = HOME             → vào màn hình chính
```

---

### `POST /v1/auth/session` — Đổi Firebase ID token lấy phiên `@Public()`

**Làm gì:** xác minh ID token với Firebase, tra hồ sơ nhân viên tương ứng, kiểm tra tên miền công ty, rồi cấp cặp access/refresh token của Backend.

Vì sao vẫn phải gửi `domain`: Firebase chỉ xác nhận **danh tính**, nó không biết gì về ranh giới công ty. Gõ sai tên miền → `AUTH_DOMAIN_MISMATCH`.

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `domain` | ✔ | `amobi.vn` — chấp nhận cả `https://` và `/` cuối |
| `firebaseIdToken` | ✔ | `user.getIdToken()`, tối đa 4096 ký tự |
| `deviceId` | App: ✔ | Web quản lý không cần |
| `deviceInfo` | ✖ | `{ model, os, osVersion, appVersion, isRooted, pushToken }` |

```bash
curl -X POST http://localhost:3000/v1/auth/session \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "amobi.vn",
    "firebaseIdToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
    "deviceId": "A1B2C3D4-5E6F-7890-ABCD-EF1234567890",
    "deviceInfo": {
      "model": "iPhone 14", "os": "iOS", "osVersion": "17.5",
      "appVersion": "1.0.0", "isRooted": false, "pushToken": "fcm_token_xyz"
    }
  }'
```

Phản hồi — đăng nhập thành công:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "9f2c1b7a4e8d3f6a...",
    "expiresIn": 900,
    "deviceSecret": "c4f8a1e93b7d2...",
    "nextStep": "HOME",
    "user": { "id": "usr_01J...", "fullName": "Nguyễn Văn Đức",
              "email": "duc@amobi.vn", "phone": "0901234567",
              "avatarUrl": null, "twoFactorEnabled": false },
    "employee": { "id": "emp_01J...", "employeeCode": "ducnv.amobi",
                  "companyId": "cmp_01J...", "status": "ACTIVE",
                  "roles": ["EMPLOYEE"] }
  }
}
```

> ⚠ **`deviceSecret` chỉ xuất hiện MỘT LẦN**, khi liên kết thiết bị mới. Lưu ngay vào secure enclave — không có API nào cấp lại. Mất nó thì không ký được request chấm công (AF-12).

Phản hồi — tài khoản đã bật 2FA:
```json
{
  "success": true,
  "data": {
    "nextStep": "TWO_FACTOR",
    "twoFactorToken": "b7e2c9a1f4d8...",
    "expiresIn": 300,
    "maskedPhone": "090****567",
    "codeExpiresIn": 300,
    "resendAfter": 60
  }
}
```

**Lỗi:** `AUTH_FIREBASE_TOKEN_INVALID`, `AUTH_FIREBASE_TOKEN_EXPIRED`, `AUTH_ACCOUNT_NOT_PROVISIONED`, `AUTH_DOMAIN_MISMATCH`, `AUTH_ACCOUNT_SUSPENDED`, `AUTH_COMPANY_INACTIVE`, `SYS_RATE_LIMITED`

---

### `POST /v1/auth/2fa/verify` — Bước hai của đăng nhập `@Public()`

**Làm gì:** nhận mã 6 số vừa gửi qua SMS **hoặc** một mã dự phòng (dùng một lần rồi mất), trả về cặp token đầy đủ giống `POST /auth/session`.

```bash
curl -X POST http://localhost:3000/v1/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d '{ "twoFactorToken": "b7e2c9a1f4d8...", "code": "482913" }'
```

**Lỗi:** `AUTH_2FA_INVALID`, `AUTH_2FA_NOT_ENABLED`, `AUTH_OTP_INVALID`, `AUTH_OTP_EXPIRED`, `AUTH_OTP_MAX_ATTEMPTS`

---

### `POST /v1/auth/2fa/resend` — Gửi lại mã OTP `@Public()`

**Làm gì:** gửi lại mã cho một thử thách đang mở. Giãn cách giữa hai lần gửi và trần số lần gửi mỗi giờ do `OtpService` cưỡng chế; rate limit theo IP chỉ là lớp chặn thêm.

```bash
curl -X POST http://localhost:3000/v1/auth/2fa/resend \
  -H "Content-Type: application/json" \
  -d '{ "twoFactorToken": "b7e2c9a1f4d8..." }'
```
```json
{ "success": true,
  "data": { "maskedPhone": "090****567", "codeExpiresIn": 300, "resendAfter": 60 } }
```

**Lỗi:** `AUTH_OTP_RESEND_TOO_SOON`, `AUTH_OTP_SEND_LIMIT`

---

### `POST /v1/auth/password/change` — Đổi mật khẩu 🔒

**Làm gì:** bắt buộc sau khi đăng nhập lần đầu bằng mật khẩu tạm. Đây là **lối ra** duy nhất của trạng thái `mustChangePassword`.

Không có trường `currentPassword` vì Backend không giữ mật khẩu để đối chiếu. Thay vào đó:
1. Client gọi `reauthenticateWithCredential()` của Firebase (người dùng gõ lại mật khẩu cũ)
2. Lấy ID token vừa làm mới → gửi lên đây
3. Trường `auth_time` trong token chứng minh việc gõ lại vừa xảy ra

**Đổi xong sẽ THU HỒI toàn bộ phiên khác ở cả hai phía** (Backend + Firebase) rồi cấp phiên mới. Nếu mật khẩu đã lộ và kẻ tấn công đang giữ phiên mở, đổi mật khẩu mà không thu hồi thì phiên của hắn vẫn sống.

```bash
curl -X POST http://localhost:3000/v1/auth/password/change \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseIdToken": "eyJhbGciOiJSUzI1NiI...",
    "newPassword": "mat-khau-moi-dai-va-de-nho"
  }'
```

**Lỗi:** `AUTH_FIREBASE_TOKEN_INVALID`, `AUTH_REAUTH_STALE` (token quá hạn `FIREBASE_FRESH_AUTH_WINDOW_SECONDS`), `AUTH_PASSWORD_TOO_WEAK`

---

### `POST /v1/auth/2fa/setup` — Bước 1: khai số điện thoại 🔒

**Làm gì:** gửi OTP tới số vừa khai. **Chưa ghi số vào tài khoản ở bước này** — số chỉ được lưu sau khi chứng minh người dùng nhận được tin nhắn tới đúng số đó (bước `enable`).

Ghi trước rồi mới xác minh nghĩa là gõ nhầm một chữ số cũng đủ khiến mọi OTP về sau bay tới máy người lạ, còn người dùng thì tự khoá mình ra ngoài.

```bash
curl -X POST http://localhost:3000/v1/auth/2fa/setup \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "phone": "0912345678" }'
```
Nhận cả dạng `+84912345678`, hệ thống tự chuẩn hoá về `0…`.

**Lỗi:** `AUTH_2FA_ALREADY_ENABLED`, `AUTH_PHONE_INVALID`, `AUTH_OTP_RESEND_TOO_SOON`, `AUTH_OTP_SEND_LIMIT`

---

### `POST /v1/auth/2fa/enable` — Bước 2: xác nhận và bật 🔒

**Làm gì:** đối chiếu mã, ghi số điện thoại, bật 2FA và trả về **mã dự phòng — hiển thị một lần duy nhất**. Server chỉ lưu bản băm nên không cấp lại được.

```bash
curl -X POST http://localhost:3000/v1/auth/2fa/enable \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "code": "482913" }'
```
```json
{ "success": true,
  "data": { "enabled": true,
            "backupCodes": ["8fj2-k91d", "2mc9-p04x", "7yq1-b53z", "..." ] } }
```

---

### `POST /v1/auth/2fa/disable` — Tắt xác thực 2 lớp 🔒

**Làm gì:** tắt 2FA. Bắt buộc ID token vừa làm mới (người dùng gõ lại mật khẩu) thay cho trường `password` trước đây.

```bash
curl -X POST http://localhost:3000/v1/auth/2fa/disable \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "firebaseIdToken": "eyJhbGciOiJSUzI1NiI..." }'
```

---

### `POST /v1/auth/refresh` — Làm mới phiên `@Public()`

**Làm gì:** đổi refresh token lấy cặp token mới.

`@Public()` vì access token đã hết hạn thì `JwtAuthGuard` sẽ chặn — mà hết hạn chính là lý do người ta gọi endpoint này. Chốt an toàn nằm ở bản thân refresh token: chuỗi ngẫu nhiên lưu trong DB.

**Refresh token XOAY VÒNG:** mỗi lần dùng cấp token mới, token cũ vô hiệu ngay. Dùng lại token đã bị thay thế → hệ thống hiểu là token đã bị đánh cắp và **thu hồi toàn bộ phiên** của tài khoản (AF-16).

```bash
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "9f2c1b7a4e8d3f6a..." }'
```

**Lỗi:** `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_REUSE_DETECTED`, `AUTH_ACCOUNT_SUSPENDED`

---

### `POST /v1/auth/logout` — Đăng xuất 🔒

**Làm gì:** thu hồi refresh token. **Bỏ trống `refreshToken` = thu hồi MỌI phiên** của tài khoản (dùng cho nút "Đăng xuất khỏi tất cả thiết bị").

```bash
# Đăng xuất thiết bị hiện tại
curl -X POST http://localhost:3000/v1/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "9f2c1b7a4e8d3f6a..." }'

# Đăng xuất tất cả thiết bị
curl -X POST http://localhost:3000/v1/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

---

### `GET /v1/auth/me` — Thông tin phiên hiện tại 🔒

**Làm gì:** trả nội dung đã giải mã từ JWT. **KHÔNG truy vấn database** — App gọi endpoint này mỗi lần mở lên, thêm một vòng đọc DB cho dữ liệu vốn đã nằm trong token là tải vô ích ở đường nóng nhất.

> **Hệ quả cần biết:** dữ liệu ở đây cũ tối đa bằng TTL của access token (900s). Vai trò vừa bị thu hồi vẫn hiện ở đây cho tới khi token hết hạn. **Quyền thực tế do guard quyết định ở từng request**, không phải theo phản hồi này.

```bash
curl http://localhost:3000/v1/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true,
  "data": { "userId": "usr_01J...", "employeeId": "emp_01J...",
            "companyId": "cmp_01J...", "roles": ["EMPLOYEE"],
            "deviceId": "A1B2C3D4-...", "isSystemAdmin": false,
            "mustChangePassword": false } }
```

---

### `GET /v1/auth/devices` — Thiết bị đã liên kết 🔒

**Làm gì:** liệt kê các thiết bị gắn với tài khoản (BR-11). Dùng cho màn hình "Quản lý thiết bị" trong App.

```bash
curl http://localhost:3000/v1/auth/devices -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `POST /v1/auth/reauth/code` — Gửi OTP cho bước xác thực lại 🔒

**Làm gì:** gửi mã OTP phục vụ `reauth/verify`. Chỉ cần gọi khi tài khoản **đã bật 2FA**.

Tách khỏi `reauth/verify` vì thứ tự bắt buộc là: gửi mã → người dùng đọc tin nhắn → gọi verify kèm mã.

```bash
curl -X POST http://localhost:3000/v1/auth/reauth/code \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `POST /v1/auth/reauth/verify` — Lấy `reauthToken` 🔒

**Làm gì:** xác thực lại danh tính và cấp `reauthToken` — **dùng một lần, TTL 5 phút**.

Bắt buộc trước các thao tác nhạy cảm:
- Đăng ký **đè** khuôn mặt (`POST /biometric/face/enroll/start`)
- Xoá khuôn mặt (`DELETE /biometric/face`)
- Xoá vân tay (`DELETE /biometric/fingerprint`)
- Đăng ký vân tay cho **thiết bị khác** (`POST /biometric/fingerprint/register`)

Vì sao neo vào **mật khẩu** (qua Firebase ID token) chứ không chỉ OTP: kẻ cầm được điện thoại đang đăng nhập cũng nhận được SMS gửi tới chính máy đó — OTP một mình không phải rào cản trong đúng kịch bản mà chốt này sinh ra để chặn.

```bash
curl -X POST http://localhost:3000/v1/auth/reauth/verify \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseIdToken": "eyJhbGciOiJSUzI1NiI...",
    "twoFactorCode": "482913"
  }'
```
```json
{ "success": true, "data": { "reauthToken": "rt_9a2f7c...", "expiresIn": 300 } }
```
`twoFactorCode` chỉ bắt buộc khi tài khoản đã bật 2FA (nhận cả mã dự phòng).

**Lỗi:** `AUTH_FIREBASE_TOKEN_INVALID`, `AUTH_REAUTH_STALE`, `AUTH_2FA_REQUIRED`

---

## 4. Sinh trắc học — `/v1/biometric`

> **Nguyên tắc xuyên suốt:** thao tác nào **thay đổi thứ dùng để xác minh danh tính** đều đòi `reauthToken`. Lý do: access token nằm sẵn trên máy đang mở khoá, còn mật khẩu thì không. Đây là lớp duy nhất chặn được người mượn được điện thoại.
>
> ⚠ Server lưu **embedding (vector số)**, KHÔNG lưu ảnh khuôn mặt gốc. Và không bao giờ nhận private key của vân tay.

---

### `GET /v1/biometric/status` — Trạng thái đăng ký 🔒

**Làm gì:** cho App biết đã đăng ký gì rồi. `satisfiesMinimum = false` thì **App phải chặn vào Home** và điều hướng sang luồng đăng ký (BR-03).

```bash
curl http://localhost:3000/v1/biometric/status -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true,
  "data": { "face": { "enrolled": true, "profileCount": 4, "enrolledAt": "2026-08-01T02:10:00.000Z" },
            "fingerprint": { "enrolled": true, "deviceCount": 1 },
            "satisfiesMinimum": true } }
```

---

### `POST /v1/biometric/face/enroll/start` — Mở phiên đăng ký khuôn mặt 🔒✍

**Làm gì:** mở phiên đăng ký đa góc, trả danh sách bước phải chụp. Bước cuối kèm **hành động liveness ngẫu nhiên do server chọn** (AF-05) — kẻ gian không quay sẵn video được vì không biết trước sẽ bị yêu cầu làm gì.

| Tình huống | `reauthToken` |
|---|---|
| Đăng ký **lần đầu** (onboarding) | không cần — chưa có gì để đè |
| Đăng ký **đè** lên hồ sơ đang có | **BẮT BUỘC**, thiếu → `AUTH_REAUTH_REQUIRED` |

Đây là kịch bản tấn công nguy hiểm nhất: kẻ mượn được điện thoại đang mở khoá chỉ cần đăng ký lại mặt mình là chấm công thay người khác mãi mãi.

```bash
curl -X POST http://localhost:3000/v1/biometric/face/enroll/start \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" \
  -H "Content-Type: application/json" \
  -d '{ "reauthToken": "rt_9a2f7c..." }'
```
```json
{ "success": true,
  "data": {
    "sessionId": "fes_01J...",
    "expiresIn": 600,
    "steps": [
      { "order": 1, "pose": "FRONT",       "hint": "Nhìn thẳng vào camera" },
      { "order": 2, "pose": "TURN_LEFT",   "hint": "Quay mặt sang trái" },
      { "order": 3, "pose": "TURN_RIGHT",  "hint": "Quay mặt sang phải" },
      { "order": 4, "pose": "LIVENESS", "livenessAction": "NOD", "hint": "Gật đầu một cái" }
    ]
  } }
```

---

### `POST /v1/biometric/face/enroll/submit` — Nộp ảnh từng bước 🔒✍

**Làm gì:** nộp **từng ảnh một** (multipart), mỗi ảnh qua kiểm tra chất lượng và phản hồi ngay.

Vì sao nộp lần lượt chứ không gửi cả loạt: gửi cả loạt rồi mới báo "ảnh thứ 3 bị mờ" là bắt người dùng làm lại từ đầu.

**Hoàn tất bước cuối** → đối chiếu với **toàn bộ embedding trong công ty** (BR-10). Trùng với nhân viên khác thì CHẶN và bắn cảnh báo gian lận danh tính.

```bash
curl -X POST http://localhost:3000/v1/biometric/face/enroll/submit \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" \
  -H "X-Body-Sha256: $BODY_HASH" \
  -F "sessionId=fes_01J..." \
  -F "order=1" \
  -F "image=@/duong/dan/anh_goc_1.jpg;type=image/jpeg"
```
```json
{ "success": true,
  "data": { "order": 1, "accepted": true, "quality": { "brightness": 0.72, "blur": 0.12, "faceRatio": 0.38 },
            "nextOrder": 2, "completed": false } }
```

**Lỗi:** `FACE_ENROLL_SESSION_INVALID`, `FACE_NOT_FOUND`, `FACE_MULTIPLE`, `FACE_LOW_LIGHT`, `FACE_BLURRY`, `FACE_TOO_SMALL`, `FACE_MASK_DETECTED`, `FACE_LIVENESS_FAILED`, `FACE_DUPLICATE_IDENTITY`, `SYS_AI_UNAVAILABLE`

---

### `DELETE /v1/biometric/face` — Đặt lại khuôn mặt 🔒✍

**Làm gì:** xoá hồ sơ khuôn mặt để đăng ký lại. **Bắt buộc `reauthToken`** (FR-APP-PRO-02). Luôn ghi audit và thông báo cho HR.

```bash
curl -X DELETE http://localhost:3000/v1/biometric/face \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" \
  -H "Content-Type: application/json" \
  -d '{ "reauthToken": "rt_9a2f7c...",
        "reason": "Đổi kiểu tóc và đeo kính mới nên nhận diện hay trượt" }'
```
`reason` tối thiểu 10 ký tự.

---

### `POST /v1/biometric/fingerprint/register` — Đăng ký vân tay 🔒✍

**Làm gì:** đăng ký **khoá công khai** của thiết bị. Server không bao giờ thấy vân tay: hệ điều hành giữ private key trong secure enclave và chỉ mở khoá sau khi người dùng chạm vân tay; server chỉ giữ public key để xác minh chữ ký. Dữ liệu sinh trắc không thể rò rỉ từ server — nó chưa từng ở đó (BR-05, NFR-SEC-07).

`deviceId` phải **trùng** thiết bị trong token. Muốn đăng ký cho thiết bị khác thì bắt buộc `reauthToken` — chặn kẻ lấy được token đăng ký khoá của máy mình rồi chấm công thay người khác.

```bash
curl -X POST http://localhost:3000/v1/biometric/fingerprint/register \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "A1B2C3D4-5E6F-7890-ABCD-EF1234567890",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\n-----END PUBLIC KEY-----",
    "algorithm": "ES256",
    "attestation": { "verdict": "MEETS_DEVICE_INTEGRITY", "provider": "PlayIntegrity" }
  }'
```

**Lỗi:** `AUTH_DEVICE_MISMATCH`, `AUTH_REAUTH_REQUIRED`, `AUTH_SIGNATURE_INVALID`

---

### `DELETE /v1/biometric/fingerprint` — Thu hồi khoá vân tay 🔒✍

```bash
curl -X DELETE http://localhost:3000/v1/biometric/fingerprint \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" \
  -H "Content-Type: application/json" \
  -d '{ "reauthToken": "rt_9a2f7c...", "reason": "Đổi điện thoại mới, thu hồi khoá máy cũ" }'
```

---

### `GET /v1/biometric/challenge` — Giờ server trước khi mở prompt sinh trắc 🔒

**Làm gì:** trả giờ server để App đối chiếu trước khi mở prompt vân tay của hệ điều hành.

> ⚠ **Nonce dùng để ký khi chấm công KHÔNG lấy từ đây** mà lấy từ `GET /v1/attendance/challenge`.

```bash
curl http://localhost:3000/v1/biometric/challenge -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true, "data": { "serverTime": "2026-08-09T01:22:03.000Z", "userId": "usr_01J..." } }
```

---

## 5. Chấm công — App `/v1/attendance`

> Mọi endpoint ở đây thao tác trên **chính người đang đăng nhập**, lấy từ JWT. **Không endpoint nào nhận `employeeId` từ client** — nhận là mở đường cho việc chấm công hộ chỉ bằng cách đổi một tham số.

### Luồng một lượt chấm công

```
GET  /v1/attendance/challenge     → nonce + livenessAction + serverTime + expectedType
     ↓  App chụp ảnh / xin chữ ký vân tay từ secure enclave
POST /v1/attendance/check-in      → multipart: nonce, clientTime, authMethod, location, deviceContext, image
     ↓  Backend: nonce → geofence/WiFi/IP → gọi AI Server → chấm điểm rủi ro → ghi log
     ← attendanceId, recordedAt (GIỜ SERVER), decision, lateMinutes, fraudScore
```

---

### `GET /v1/attendance/challenge` — Lấy nonce + thao tác liveness 🔒

**Làm gì:** **BẮT BUỘC gọi trước mỗi lần chấm công.**

Vì sao phải có bước riêng thay vì chấm công một phát:
- Server phát **nonce dùng một lần** → chặn phát lại gói tin cũ (AF-12)
- Server chọn **hành động liveness ngẫu nhiên** → kẻ gian không chuẩn bị sẵn video nháy mắt được (AF-05)
- Server trả **giờ chuẩn** → App phát hiện máy bị chỉnh giờ (AF-18)
- Server suy ra **lượt tiếp theo là VÀO hay RA** → nếu để App tự đoán, hai thiết bị của cùng một người có thể cùng nghĩ đang cần check-in và tạo bản ghi trùng

```bash
curl http://localhost:3000/v1/attendance/challenge \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Device-Id: A1B2C3D4-5E6F-7890-ABCD-EF1234567890"
```
```json
{ "success": true,
  "data": { "nonce": "n_7f3a92c1e8b4d6...", "serverTime": "2026-08-09T01:22:03.000Z",
            "expiresIn": 60, "livenessAction": "TURN_LEFT",
            "expectedType": "CHECK_IN", "requiresPhoto": true,
            "workDate": "2026-08-09" } }
```

---

### `POST /v1/attendance/check-in` — Chấm vào 🔒✍ `multipart/form-data`

**Endpoint quan trọng nhất hệ thống.**

> ⚠ Payload **TUYỆT ĐỐI KHÔNG** chứa `faceVerified` / `biometricOk` / `livenessPassed`. Backend tự gọi AI Server kiểm chứng rồi tự so ngưỡng cấu hình theo công ty (BR-02, AF-10). Thấy trường như vậy trong payload là **lỗi nghiêm trọng cần sửa ngay**.
>
> ⚠ Thời gian ghi nhận là **GIỜ SERVER** (BR-01). `clientTime` chỉ để đối chiếu phát hiện gian lận — dùng nó tính công thì ai cũng "đi làm đúng giờ" chỉ bằng cách vặn đồng hồ điện thoại.

Trả `200` chứ không phải `201`: chấm công không "tạo tài nguyên" theo nghĩa REST mà ghi nhận một sự kiện.

**Trường trong body (multipart):**

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `nonce` | string | từ `GET /attendance/challenge`, dùng một lần |
| `clientTime` | ISO date | giờ máy — CHỈ để đối chiếu |
| `authMethod` | `FACE` \| `FINGERPRINT` | |
| `signedChallenge` | string | **bắt buộc khi `FINGERPRINT`** — chữ ký nonce từ secure enclave |
| `location` | JSON **dạng chuỗi** | xem bảng dưới |
| `deviceContext` | JSON **dạng chuỗi** | xem bảng dưới |
| `branchId` | string | bỏ trống = tự chọn chi nhánh gần nhất |
| `image` | file ≤ 5MB | bắt buộc khi `authMethod=FACE` |

> Với `multipart/form-data`, object lồng nhau tới server dưới dạng **chuỗi JSON**. DTO có `@Transform` để parse — client phải `JSON.stringify()` trước khi gán vào form field.

`location`:

| Trường | Ghi chú |
|---|---|
| `latitude`, `longitude` | bắt buộc, -90..90 / -180..180 |
| `accuracy` | bán kính sai số (m). Quan trọng: ngoài geofence 30m nhưng accuracy 50m thì có thể vẫn đang trong văn phòng |
| `provider` | `gps` \| `network` \| `fused` \| `mock` |
| `isMocked` | cờ mock location (AF-01) — Backend **không tin tuyệt đối**, chỉ là một tín hiệu |
| `altitude`, `speed` | chấm công lúc đang chạy 60 km/h là dấu hiệu rõ ràng |
| `capturedAt` | thời điểm **lấy được** toạ độ, khác thời điểm gửi request |

`deviceContext`:

| Trường | Ghi chú |
|---|---|
| `deviceId` | bắt buộc, phải khớp token (AF-16) |
| `isRooted` | AF-14. `true` là bằng chứng đáng tin; `false` **không chứng minh được gì** (máy root sửa được cờ này) |
| `attestationToken` | AF-15 — thứ **duy nhất không giả được**, vì Google/Apple ký |
| `wifiBssid` | AF-02 — bằng chứng vị trí **mạnh hơn GPS**: muốn thấy BSSID phải ở trong tầm sóng thật |
| `beaconUuid` | AF-02 — cho nhà xưởng, tầng hầm nơi GPS vô dụng |

```bash
curl -X POST http://localhost:3000/v1/attendance/check-in \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Device-Id: A1B2C3D4-5E6F-7890-ABCD-EF1234567890" \
  -H "X-Platform: ios" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" \
  -H "X-Body-Sha256: $BODY_HASH" \
  -F "nonce=n_7f3a92c1e8b4d6..." \
  -F "clientTime=2026-08-09T08:22:10+07:00" \
  -F "authMethod=FACE" \
  -F 'location={"latitude":21.012345,"longitude":105.798765,"accuracy":8.2,"provider":"gps","isMocked":false,"capturedAt":"2026-08-09T08:22:08+07:00"}' \
  -F 'deviceContext={"deviceId":"A1B2C3D4-5E6F-7890-ABCD-EF1234567890","model":"iPhone 14","osVersion":"17.5","appVersion":"1.0.0","isRooted":false,"wifiBssid":"a4:2b:8c:11:9f:03","attestationToken":"eyJhbGciOi..."}' \
  -F "image=@/duong/dan/selfie.jpg;type=image/jpeg"
```

Phản hồi:
```json
{ "success": true,
  "data": {
    "attendanceId": "att_01J...",
    "type": "CHECK_IN",
    "recordedAt": "2026-08-09T01:22:11.482Z",
    "workDate": "2026-08-09",
    "decision": "ACCEPTED",
    "shift": { "name": "Hành chính", "startTime": "08:00", "endTime": "17:30", "breakMinutes": 60 },
    "lateMinutes": 0,
    "distanceToBranchM": 24.7,
    "insideGeofence": true,
    "photoUrl": "https://s3.../att_01J....jpg?X-Amz-Expires=300&...",
    "fraudScore": 5,
    "flags": []
  } }
```

`photoUrl` là presigned URL **hết hạn sau 5 phút** (NFR-SEC-12).

**Lỗi (đầy đủ):** `ATT_INVALID_NONCE`, `AUTH_DEVICE_MISMATCH`, `AUTH_SIGNATURE_INVALID`, `FRAUD_MOCK_LOCATION`, `FRAUD_ROOTED_DEVICE`, `FRAUD_ATTESTATION_FAILED`, `FRAUD_REPLAY_DETECTED`, `FRAUD_CLOCK_SKEW`, `FRAUD_LOW_GPS_ACCURACY`, `FRAUD_RISK_TOO_HIGH`, `ATT_OUT_OF_GEOFENCE`, `ATT_WIFI_REQUIRED`, `ATT_WIFI_NOT_CONFIGURED`, `ATT_IP_NOT_ALLOWED`, `ATT_IP_NOT_CONFIGURED`, `ATT_ALREADY_CHECKED_IN`, `ATT_NO_SHIFT_TODAY`, `ATT_PERIOD_LOCKED`, `FACE_LIVENESS_FAILED`, `FACE_NOT_MATCHED`, `FACE_NOT_ENROLLED`, `SYS_RATE_LIMITED`, `SYS_AI_UNAVAILABLE`

---

### `POST /v1/attendance/check-out` — Chấm ra 🔒✍ `multipart/form-data`

**Làm gì:** giống hệt `check-in`, chỉ khác `AttendanceType`. Dùng chung hàm `punch()` — viết hai bản là bảo đảm sớm muộn có một bên thiếu chốt.

Body và header y hệt `check-in`.

> Danh sách lỗi **ngắn hơn** `check-in` là **đúng, không phải sót**: các chốt về thiết bị, geofence, gian lận đã chạy và đã chặn ở lượt vào. Người đã vào được thì đang ở đúng chỗ; lượt ra chỉ cần xác nhận đúng người và đúng phiên.

**Lỗi:** `ATT_INVALID_NONCE`, `FRAUD_REPLAY_DETECTED`, `ATT_NOT_CHECKED_IN`, `ATT_PERIOD_LOCKED`, `FACE_LIVENESS_FAILED`, `FACE_NOT_MATCHED`, `SYS_AI_UNAVAILABLE`

---

### `GET /v1/attendance/today` — Trạng thái hôm nay 🔒

**Làm gì:** dựng màn hình Home của App. Trả kèm `serverTime` để đồng hồ đếm giờ khớp giờ server, không lệch khi đổi múi giờ máy (FR-APP-HOME-04).

```bash
curl http://localhost:3000/v1/attendance/today -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true,
  "data": {
    "workDate": "2026-08-09",
    "serverTime": "2026-08-09T04:35:00.000Z",
    "shift": { "id": "sft_01J...", "name": "Hành chính", "type": "FIXED",
               "startTime": "08:00", "endTime": "17:30",
               "breakMinutes": 60, "crossesMidnight": false, "segments": [] },
    "status": "CHECKED_IN",
    "logs": [ { "id": "att_01J...", "type": "CHECK_IN",
                "recordedAt": "2026-08-09T01:22:11.482Z", "authMethod": "FACE",
                "decision": "ACCEPTED", "insideGeofence": true, "distanceToBranchM": 24.7 } ],
    "workedMinutes": 193,
    "daily": null,
    "branch": { "id": "brc_01J...", "name": "Văn phòng Hà Nội",
                "latitude": 21.0123, "longitude": 105.7987, "radiusMeters": 100 }
  } }
```

---

### `GET /v1/attendance/history` — Lịch sử chấm công 🔒

**Làm gì:** truy vấn trên `AttendanceDaily` (đã tính sẵn), **không quét bảng thô**.

Hai điều kiện `companyId` + `employeeId` lấy từ JWT là **chốt an toàn**, không phải bộ lọc tiện dụng.

| Query | Ghi chú |
|---|---|
| `from`, `to` | `YYYY-MM-DD` |
| `status` | enum `DailyStatus` |
| `page`, `pageSize` | phân trang chuẩn |

```bash
curl "http://localhost:3000/v1/attendance/history?from=2026-08-01&to=2026-08-31&pageSize=31" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true,
  "data": [ { "workDate": "2026-08-09", "status": "PRESENT",
              "workedMinutes": 480, "lateMinutes": 0, "earlyLeaveMinutes": 0,
              "otMinutes": 0, "firstCheckIn": "2026-08-09T01:22:11.482Z",
              "lastCheckOut": "2026-08-09T10:31:44.900Z" } ],
  "meta": { "page": 1, "pageSize": 31, "total": 9, "totalPages": 1 } }
```

> `workDate` trả về là chuỗi `YYYY-MM-DD`, không phải ISO datetime. Trả Date thô thì `2026-08-02` của Việt Nam hiện thành `"2026-08-01T17:00:00Z"` trên App — **lệch hẳn một ngày**.

---

### `GET /v1/attendance/adjustments` — Lịch sử hiệu chỉnh công của tôi 🔒

**Làm gì:** cho nhân viên xem HR đã sửa công của mình những gì (BR-ADJ-06) — minh bạch với người lao động, giảm khiếu nại.

```bash
curl "http://localhost:3000/v1/attendance/adjustments?from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `GET /v1/attendance/:id` — Chi tiết một lượt chấm công 🔒

**Làm gì:** chi tiết một lượt của **chính mình**. Ảnh trả qua presigned URL hết hạn sau 5 phút (NFR-SEC-12).

```bash
curl http://localhost:3000/v1/attendance/att_01J... -H "Authorization: Bearer $ACCESS_TOKEN"
```

> ⚠ **Ghi chú thi công:** route này phải là `@Get` khai **cuối cùng** trong controller. Nest so khớp theo thứ tự khai báo — đặt trước `challenge`/`today`/`history` sẽ nuốt hết, `GET /attendance/today` bị hiểu thành `id = 'today'` và luôn 404.

**Lỗi:** `ATT_NOT_FOUND`

---

## 6. Cá nhân & Công ty

### `GET /v1/me/profile` — Hồ sơ cá nhân 🔒

**Làm gì:** hồ sơ của chính mình (FR-APP-PRO-01). **Không có `@Roles`** — mọi nhân viên gọi được, nhưng `employeeId` lấy từ JWT nên chỉ đọc được chính mình.

```bash
curl http://localhost:3000/v1/me/profile -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `GET /v1/me/stats` — Thống kê cá nhân 🔒

**Làm gì:** thống kê chuyên cần & đơn từ của tôi (FR-APP-STAT). `from` và `to` **bắt buộc**.

```bash
curl "http://localhost:3000/v1/me/stats?from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `GET /v1/company/me` — Thông tin công ty 🔒

**Làm gì:** thông tin công ty đang hoạt động — dùng chung App và Web. Chỉ ĐỌC, và chỉ đọc công ty của chính mình (`companyId` từ JWT).

Trường được **chọn tay từng cái**, không trả nguyên bản ghi `Company`: bản ghi đó còn chứa thông tin hợp đồng, hạn thanh toán, ghi chú nội bộ. Thêm cột mới vào bảng cũng không vô tình rò rỉ.

```bash
curl http://localhost:3000/v1/company/me -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true,
  "data": { "id": "cmp_01J...", "code": "amobi", "name": "Công ty AMOBI",
            "timezone": "Asia/Ho_Chi_Minh", "status": "ACTIVE",
            "plan": { "name": "Pro",
                      "features": { "rotatingShift": true, "ot": true, "multiBranch": false } } } }
```

> `features` để client ẩn/hiện menu — nhưng đó **chỉ là trải nghiệm**. Chốt thật nằm ở guard phía server; client sửa cờ này trong bộ nhớ vẫn không gọi được API ngoài gói.

---

## 7. Đơn từ

Controller **duy nhất phục vụ cả App và Web Quản lý**, vì cùng một con người vừa là người nộp đơn vừa có thể là người duyệt đơn của cấp dưới. Quyền không dựa vào loại client mà dựa vào **quan hệ với từng đơn**.

> ⚠ **BR-APV-03: không ai được duyệt đơn của chính mình, kể cả COMPANY_ADMIN.**

### Vòng đời một đơn

```
POST /requests (submitNow=false)  → DRAFT
       │ POST /requests/:id/submit
       ▼
    PENDING ──── POST /requests/:id/approve (đủ mọi cấp) ──► APPROVED ──► tính lại công
       │     └── POST /requests/:id/reject  (một cấp là đủ) ─► REJECTED
       │
       └── POST /requests/:id/cancel ──► CANCELLED
```

---

### `GET /v1/request-types` — Danh mục loại đơn 🔒

**Làm gì:** trả danh mục loại đơn của công ty kèm luồng duyệt. App gọi để dựng dropdown.

```bash
curl http://localhost:3000/v1/request-types -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true,
  "data": [ { "code": "ANNUAL_LEAVE", "name": "Nghỉ phép năm",
              "requiresAttachment": false, "deductsLeaveBalance": true,
              "approvalSteps": [ { "order": 1, "type": "DIRECT_MANAGER", "required": true },
                                 { "order": 2, "type": "HR", "required": true } ] } ] }
```

---

### `GET /v1/requests/reference` — Thông tin tham chiếu trước khi tạo đơn 🔒

**Làm gì:** phép năm còn lại, giờ nợ/dư, số đơn đang chờ duyệt (FR-APP-REQ-02). App gọi trước khi mở form để hiển thị "Bạn còn 8.5 ngày phép".

```bash
curl http://localhost:3000/v1/requests/reference -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `GET /v1/requests/pending-approval` — Đơn tôi cần duyệt 🔒

**Làm gì:** hàng chờ duyệt của người đang đăng nhập. **Không bao giờ hiển thị đơn của chính mình** (BR-APV-03).

```bash
curl "http://localhost:3000/v1/requests/pending-approval?page=1&pageSize=20" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

> ⚠ Route tĩnh (`reference`, `pending-approval`) phải khai **trước** `requests/:id`. Đảo lại thì `:id` nuốt hết.

---

### `GET /v1/requests` — Danh sách đơn 🔒

| Query | Ghi chú |
|---|---|
| `mineOnly` | `true` = chỉ đơn của tôi (App luôn truyền cờ này) |
| `status` | enum `RequestStatus` |
| `requestTypeCode` | `ANNUAL_LEAVE`, ... |
| `from`, `to` | khoảng ngày |
| `departmentId`, `employeeId` | Web Quản lý |
| `page`, `pageSize`, `sort`, `q` | chuẩn |

MANAGER chỉ thấy đơn của phòng ban mình quản lý (ScopeGuard). Bộ lọc chỉ **thu hẹp** tập dữ liệu người gọi vốn đã được phép xem, **không bao giờ nới rộng**.

```bash
curl "http://localhost:3000/v1/requests?mineOnly=true&status=PENDING" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `POST /v1/requests` — Tạo đơn 🔒

**Làm gì:** tạo đơn nháp hoặc gửi luôn đi duyệt.

Bốn chốt chạy **trong một transaction** cùng với việc ghi đơn:
1. Chặn đơn trùng khoảng thời gian (BR-REQ-02)
2. Kiểm tra số dư phép (FR-APP-REQ-10)
3. Chặn đơn rơi vào kỳ lương đã chốt (BR-REQ-04)
4. Kiểm tra đính kèm bắt buộc

Kiểm tra số dư rồi mới ghi ở lệnh riêng thì hai đơn gửi cùng lúc đều thấy "còn 1 ngày phép" và cùng được duyệt — nhân viên nghỉ 2 ngày trong khi chỉ còn 1.

> ⚠ `startAt`/`endAt` **phải kèm offset múi giờ** (`+07:00`). Gửi `2026-08-10T00:00:00` trần thì Node hiểu là UTC, thành 07:00 sáng giờ Việt Nam — đơn nghỉ cả ngày biến thành nghỉ từ 7 giờ, ngày cuối lệch sang hôm sau. Trừ oan một ngày phép vì thiếu 6 ký tự.

```bash
curl -X POST http://localhost:3000/v1/requests \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "requestTypeCode": "ANNUAL_LEAVE",
    "startAt": "2026-08-10T00:00:00+07:00",
    "endAt":   "2026-08-12T23:59:59+07:00",
    "isHalfDay": false,
    "reason": "Việc gia đình",
    "submitNow": true
  }'
```

`submitNow: false` = lưu nháp (FR-APP-REQ-03). Đơn nháp **không khoá ngày phép** và không hiện ở hàng chờ của quản lý.

**Lỗi:** `REQ_TYPE_NOT_FOUND`, `REQ_INSUFFICIENT_LEAVE`, `REQ_OVERLAP`, `REQ_ATTACHMENT_REQUIRED`, `REQ_PERIOD_LOCKED`

---

### `GET /v1/admin/requests/approval-preview` — Xem trước luồng duyệt 🔒

**Vai trò:** `MANAGER`, `HR_PAYROLL`, `COMPANY_ADMIN` · `@DepartmentScoped()`

**Làm gì:** trả về **đúng những bước duyệt sẽ được sinh ra** cho đơn sắp tạo, kèm người duyệt hệ thống tự suy và danh sách ứng viên thay thế cho từng bước.

| Query | Ghi chú |
|---|---|
| `employeeId` | nhân viên sẽ đứng tên đơn |
| `requestTypeCode` | mã loại đơn |
| `startAt`, `endAt` | kèm offset múi giờ |
| `isHalfDay` | mặc định `false` |

```json
{ "success": true,
  "data": { "quantity": 3, "unit": "DAY",
            "steps": [
              { "order": 1, "approverRole": "DIRECT_MANAGER", "approverRoleLabel": "Quản lý trực tiếp",
                "suggestedApproverId": null, "suggestedApproverName": null,
                "candidates": [ { "id": "emp_01J...", "fullName": "Trần Văn Bình", "employeeCode": "binhtv" } ] },
              { "order": 2, "approverRole": "HR_PAYROLL", "approverRoleLabel": "Kế toán / HR",
                "suggestedApproverId": null, "suggestedApproverName": null,
                "candidates": [ { "id": "emp_02K...", "fullName": "Lê Thị Hoa", "employeeCode": "hoalt" } ] } ] } }
```

> **Phải hỏi lại mỗi khi đổi loại đơn hoặc khoảng ngày.** Số bước duyệt phụ thuộc **độ dài đơn**: nghỉ 1 ngày chỉ cần trưởng phòng, từ 3 ngày trở lên mới thêm bước HR (`ApprovalFlowStep.condition`, docs/04 mục 4.1). Người nhập hộ không đoán được điều đó.
>
> `suggestedApproverId: null` **không phải lỗi** mà là "để ngỏ": ai giữ vai trò tương ứng cũng duyệt được. Đó là mặc định an toàn — chỉ định đích danh một người thì người đó nghỉ phép là mọi đơn treo lại chờ họ về.
>
> `candidates` gồm cả nhân viên `PENDING_ACTIVATION`. Loại họ ra sẽ cho danh sách **rỗng** ở đúng những công ty mới triển khai — nơi chưa ai kịp đăng nhập, kể cả trưởng phòng.

---

### `POST /v1/admin/requests` — Tạo đơn THAY MẶT nhân viên 🔒 📝audit

**Vai trò:** `MANAGER`, `HR_PAYROLL`, `COMPANY_ADMIN` · `@DepartmentScoped()`

**Làm gì:** `FR-WEB-REQ-09` — nhập đơn cho nhân viên nộp đơn giấy, nghỉ ốm đột xuất, hoặc chưa cài ứng dụng.

Chạy **đúng bốn chốt** như `POST /v1/requests` ở trên, chỉ khác ở người được ghi tên trên đơn.

| Trường thêm | Ghi chú |
|---|---|
| `employeeId` | nhân viên được tạo đơn hộ |
| `onBehalfReason` | **bắt buộc**, 10–500 ký tự |
| `approvers` | tuỳ chọn — `[{ order, approverId }]`, chỉ định người đứng ở từng bước |

```bash
curl -X POST http://localhost:3000/v1/admin/requests \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "emp_01J...",
    "requestTypeCode": "SICK_LEAVE",
    "startAt": "2026-08-10T00:00:00+07:00",
    "endAt":   "2026-08-11T23:59:59+07:00",
    "reason": "Sốt cao, có giấy khám bệnh",
    "onBehalfReason": "Nhân viên nộp đơn giấy ngày 12/08, chưa cài ứng dụng."
  }'
```

> **Đây là endpoint RIÊNG, không phải thêm `employeeId?` tuỳ chọn vào `POST /v1/requests`.** Endpoint tự phục vụ mở cho mọi tài khoản; chỉ cần thêm một trường tuỳ chọn ở đó là bất kỳ nhân viên nào cũng gửi kèm `employeeId` của người khác để tạo đơn nghỉ phép cho họ. Tách endpoint thì đường tạo hộ chỉ tồn tại ở chỗ có `@Roles` và `@DepartmentScoped()`.
>
> **`onBehalfReason` khác `reason`.** `reason` là lời khai của nhân viên ("Sốt cao"). `onBehalfReason` trả lời câu hỏi mà người đọc audit sáu tháng sau sẽ hỏi: vì sao đơn này không do chính nhân viên gửi? Gộp làm một thì thông tin mất đi luôn là cái thứ hai — cái duy nhất giải thích được vì sao có một đơn không ai ký.
>
> Đơn vào trạng thái `PENDING` và **đi qua đúng luồng duyệt** — người nhập hộ không duyệt hộ. Ghi audit `REQUEST_CREATE_ON_BEHALF`, và `GET /v1/requests/:id` trả kèm `createdOnBehalf` để màn duyệt hiện cảnh báo.
>
> **`approvers` chỉ đổi được AI đứng ở mỗi bước, KHÔNG đổi được CÓ NHỮNG BƯỚC NÀO.** `order` phải khớp một bước có thật trong luồng đã cấu hình **ở đúng độ dài đơn đó**; gửi `order` lạ bị từ chối chứ không tạo thêm bước. Đây là ranh giới quan trọng nhất của tính năng: cho phép thêm/bớt bước là vô hiệu hoá `FR-WEB-REQ-05` — công ty cấu hình "nghỉ trên 3 ngày phải qua HR" rồi người nhập đơn tự bỏ bước đó đi.
>
> Mỗi người được chỉ định phải **thực sự giữ vai trò** hợp lệ cho bước đó, và không được là chính người xin nghỉ (`BR-APV-03`). Bỏ trống một bước = để ngỏ cho mọi người giữ vai trò tương ứng.

**Lỗi:** `EMP_NOT_FOUND`, `AUTH_FORBIDDEN`, `REQ_TYPE_NOT_FOUND`, `REQ_INSUFFICIENT_LEAVE`, `REQ_OVERLAP`, `REQ_ATTACHMENT_REQUIRED`, `REQ_PERIOD_LOCKED`

---

### `GET /v1/requests/:id` — Chi tiết đơn 🔒

**Làm gì:** chi tiết đơn + **lịch sử duyệt** đầy đủ (FR-WEB-REQ-06): ai duyệt, lúc nào, ghi chú gì.

```bash
curl http://localhost:3000/v1/requests/req_01J... -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

### `PATCH /v1/requests/:id` — Sửa đơn nháp 🔒

**Làm gì:** sửa đơn còn ở trạng thái nháp/chờ duyệt. Chỉ người tạo sửa được.

**Không có `requestTypeCode`** — đổi loại đơn giữa chừng làm luồng duyệt đã chạy dở trở nên vô nghĩa (đơn nghỉ 1 ngày chỉ cần trưởng phòng; đổi thành 5 ngày lại cần thêm HR). Muốn đổi loại thì huỷ và tạo đơn mới.

```bash
curl -X PATCH http://localhost:3000/v1/requests/req_01J... \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "endAt": "2026-08-11T23:59:59+07:00", "reason": "Rút ngắn còn 2 ngày" }'
```

---

### `POST /v1/requests/:id/submit` — Gửi đơn nháp đi duyệt 🔒

```bash
curl -X POST http://localhost:3000/v1/requests/req_01J.../submit \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Lỗi:** `REQ_INVALID_STATUS`, `REQ_ATTACHMENT_REQUIRED`, `REQ_OVERLAP`

---

### `POST /v1/requests/:id/cancel` — Huỷ đơn 🔒

**Làm gì:** người tạo tự huỷ đơn của mình (khác `reject` — đó là quản lý từ chối).

Đơn **đã duyệt** chỉ huỷ được nếu chính sách cho phép **và** chưa tới ngày áp dụng (FR-APP-REQ-06). Huỷ đơn đã duyệt sẽ kích hoạt **tính lại công**.

```bash
curl -X POST http://localhost:3000/v1/requests/req_01J.../cancel \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Đổi lịch, không nghỉ nữa" }'
```

---

### `POST /v1/requests/:id/attachments` — Upload minh chứng 🔒 `multipart/form-data`

**Làm gì:** đính kèm giấy khám bệnh, giấy mời... BR-REQ-06: `jpg`/`png`/`pdf`, **≤ 10MB mỗi file**, ≤ 5 file mỗi đơn (cấu hình được).

Trần 10MB gấp đôi ảnh chấm công vì đính kèm thường là ảnh chụp giấy tờ hoặc PDF nhiều trang, không phải selfie.

```bash
curl -X POST http://localhost:3000/v1/requests/req_01J.../attachments \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@/duong/dan/giay-kham-benh.pdf;type=application/pdf"
```

**Lỗi:** `REQ_ATTACHMENT_INVALID`

---

### `POST /v1/requests/:id/approve` — Duyệt đơn 🔒 📝audit

**Làm gì:** duyệt một cấp trong luồng.

- BR-APV-01: đơn chỉ chuyển `APPROVED` khi **tất cả cấp bắt buộc** đã duyệt
- BR-APV-06: tự kích hoạt tính lại công, **kể cả đơn duyệt ngược về quá khứ** (BR-REQ-03)

`comment` không bắt buộc — đồng ý thì không cần giải thích.

```bash
curl -X POST http://localhost:3000/v1/requests/req_01J.../approve \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "comment": "Đồng ý, đã sắp xếp người thay ca" }'
```

**Lỗi:** `REQ_ALREADY_DECIDED`, `REQ_CANNOT_APPROVE_OWN`, `REQ_NOT_YOUR_TURN`, `REQ_PERIOD_LOCKED`

---

### `POST /v1/requests/:id/reject` — Từ chối đơn 🔒 📝audit

**Làm gì:** từ chối. **Lý do BẮT BUỘC** (FR-WEB-REQ-04) — đối xứng có chủ đích với `approve`: duyệt thì không cần nói gì, từ chối thì phải nói. Người bị từ chối có quyền biết vì sao, và đây cũng là bằng chứng khi có khiếu nại.

BR-APV-02: **một cấp từ chối là đơn chuyển `REJECTED` ngay**, các cấp sau không xử lý nữa.

```bash
curl -X POST http://localhost:3000/v1/requests/req_01J.../reject \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Trùng lịch bàn giao dự án, đề nghị dời sang tuần sau" }'
```

---

### `POST /v1/requests/bulk-approve` — Duyệt hàng loạt 🔒 📝audit

**Làm gì:** quản lý tick nhiều đơn rồi duyệt một lượt.

BR-APV-05: **vẫn kiểm tra ràng buộc từng đơn**. Đơn không hợp lệ bị bỏ qua kèm lý do riêng, **không fail cả lô**.

> ⚠ Chỉ có duyệt hàng loạt, **không có từ chối hàng loạt** — từ chối cần lý do riêng cho từng đơn; gộp lại thì tất cả cùng nhận một lý do chung vô nghĩa.

```bash
curl -X POST http://localhost:3000/v1/requests/bulk-approve \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "requestIds": ["req_01J...a", "req_01J...b", "req_01J...c"],
        "comment": "Duyệt lô đơn nghỉ lễ" }'
```
```json
{ "success": true,
  "data": { "approved": 2, "skipped": 1,
            "results": [ { "requestId": "req_01J...a", "ok": true },
                         { "requestId": "req_01J...c", "ok": false,
                           "code": "REQ_CANNOT_APPROVE_OWN",
                           "reason": "Không được duyệt đơn của chính mình" } ] } }
```

---

## 8. Thông báo

Gộp cả phía **nhận** (App, `/notifications/*`) và phía **gửi** (Web Quản lý, `/admin/notifications/*`).

### `GET /v1/notifications` — Danh sách thông báo của tôi 🔒

```bash
curl "http://localhost:3000/v1/notifications?page=1&pageSize=20" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### `GET /v1/notifications/unread-count` — Số chưa đọc 🔒

**Làm gì:** vẽ badge đỏ trên icon chuông (FR-APP-HOME-02).

```bash
curl http://localhost:3000/v1/notifications/unread-count -H "Authorization: Bearer $ACCESS_TOKEN"
```
```json
{ "success": true, "data": { "count": 3 } }
```

### `POST /v1/notifications/:id/read` — Đánh dấu đã đọc 🔒

```bash
curl -X POST http://localhost:3000/v1/notifications/ntf_01J.../read \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### `POST /v1/notifications/read-all` — Đánh dấu đã đọc tất cả 🔒

```bash
curl -X POST http://localhost:3000/v1/notifications/read-all \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### `POST /v1/admin/notifications/broadcast` — Gửi thông báo 🔒 📝audit

**Vai trò:** `COMPANY_ADMIN`, `HR_PAYROLL`, `MANAGER`

**Làm gì:** gửi thông báo toàn công ty hoặc theo phòng ban (FR-WEB-NOT-01). Có audit vì đây là thao tác chạm tới **tất cả nhân viên cùng lúc**. MANAGER cũng gửi được nhưng `ScopeGuard` giới hạn trong phòng ban họ quản lý.

| Trường | Ghi chú |
|---|---|
| `title` | ≤ 200 ký tự |
| `body` | ≤ 2000 ký tự |
| `departmentId` | **một** phòng ban, bỏ trống = toàn công ty |
| `channel` | `PUSH` (mặc định) \| `IN_APP` \| `SMS` \| `EMAIL` |
| `scheduledAt` | lên lịch gửi (FR-WEB-NOT-02) |

> ⚠ Trường là `departmentId` số ít, **không phải** `departmentIds`. Một lần gửi tạo đúng **một** bản ghi `notification`, mà bản ghi đó chỉ có một cột `departmentId` — đúng như `FR-WEB-NOT-01` viết "toàn công ty **hoặc** theo phòng ban". Gửi lên một mảng thì `ValidationPipe` lặng lẽ bỏ qua và thông báo phát ra **toàn công ty**, không có lỗi nào báo. Muốn gửi cho nhiều phòng ban thì gọi nhiều lần.

```bash
curl -X POST http://localhost:3000/v1/admin/notifications/broadcast \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Thông báo nghỉ lễ 02/09",
    "body": "Công ty nghỉ lễ Quốc khánh từ 02/09 đến hết 03/09/2026.",
    "channel": "PUSH",
    "scheduledAt": "2026-08-28T09:00:00+07:00"
  }'
```
```json
{ "success": true, "data": { "notificationId": "ntf_01J...", "recipients": 128 } }
```

> `recipients` là số **NGƯỜI** trong phạm vi gửi (nhân viên `ACTIVE`), không phải số **THIẾT BỊ** nhận push. Nhân viên chưa cài ứng dụng vẫn thấy thông báo ở lần mở app kế tiếp, vì danh sách trong app đọc thẳng từ bảng `notification`. Đếm theo thiết bị sẽ ra con số nhỏ hơn thực tế và người gửi tưởng thông báo không tới được ai.

---

## 9. Web Quản lý — Chấm công `/v1/admin/attendance`

Khác `/v1/attendance` (App) ở chỗ mọi endpoint đều thao tác trên **người khác**, nên đều qua `@Roles` + `@DepartmentScoped()`.

**Hai nguồn dữ liệu, hai mục đích:**

| Bảng | Dùng cho |
|---|---|
| `AttendanceDaily` | đã tính sẵn theo ngày — bảng công và báo cáo. Nhanh vì không phải gộp lại từ bản ghi thô mỗi lần xem (NFR-PERF-06) |
| `AttendanceLog` | bản ghi thô từng lượt quẹt, **BẤT BIẾN**. Chỉ mở ra khi cần đối soát khiếu nại |

---

### `GET /v1/admin/attendance` — Bảng công theo ngày 🔒

**Vai trò:** `MANAGER`, `HR_PAYROLL`, `COMPANY_ADMIN` (MANAGER chỉ thấy phòng ban mình quản lý)

| Query | Ghi chú |
|---|---|
| `from`, `to` | `YYYY-MM-DD` |
| `departmentId`, `branchId`, `employeeId` | lọc |
| `status` | enum `DailyStatus` |
| `hasFraudFlag` | `true` = chỉ ngày có cờ nghi vấn |
| `page`, `pageSize`, `sort`, `q` | chuẩn |

```bash
curl "http://localhost:3000/v1/admin/attendance?from=2026-08-01&to=2026-08-09&departmentId=dep_01J...&status=LATE&pageSize=50" \
  -H "Authorization: Bearer $HR_TOKEN"
```

---

### `GET /v1/admin/attendance/logs` — Lượt chấm công thô của một người trong một ngày 🔒

```bash
curl "http://localhost:3000/v1/admin/attendance/logs?employeeId=emp_01J...&workDate=2026-08-09" \
  -H "Authorization: Bearer $HR_TOKEN"
```

---

### `GET /v1/admin/attendance/:id` — Chi tiết một lượt 🔒

**Làm gì:** kèm ảnh (presigned URL 5 phút), toạ độ, thông tin thiết bị, điểm AI và cờ nghi vấn — phục vụ đối soát khiếu nại (AF-22).

```bash
curl http://localhost:3000/v1/admin/attendance/att_01J... -H "Authorization: Bearer $HR_TOKEN"
```

---

### `POST /v1/admin/attendance/adjust` — Hiệu chỉnh công thủ công 🔒 📝audit

**Vai trò:** `HR_PAYROLL`, `COMPANY_ADMIN` — **MANAGER KHÔNG có quyền này**.

**Làm gì:** BR-ADJ-01 — **KHÔNG sửa đè bản ghi thô**, mà tạo một `AttendanceAdjustment` trỏ về bản ghi gốc.

Bản ghi gốc là bằng chứng: nó ghi lại đúng những gì thiết bị thu được. Cho phép sửa đè nghĩa là quản lý lặng lẽ đổi được giờ vào của nhân viên mà không để lại dấu vết — mất sạch giá trị đối chứng khi tranh chấp lao động.

Chuỗi ràng buộc:
- BR-ADJ-02: lý do ≥ 10 ký tự (chặn thói quen gõ "ok", "sửa", ".")
- BR-ADJ-03: ghi audit
- BR-ADJ-04: tự kích hoạt tính lại
- BR-ADJ-05: chặn nếu kỳ lương đã chốt
- BR-ADJ-06: thông báo cho nhân viên

| `adjustType` | Nghĩa | `attendanceLogId` |
|---|---|---|
| `ADD` | thêm lượt còn thiếu (quên chấm công, máy hỏng) | không cần |
| `MODIFY_TIME` | chỉnh giờ của một lượt đã có | **bắt buộc** |
| `VOID` | vô hiệu một lượt sai (chấm nhầm, chấm trùng) — **không xoá**, chỉ đánh dấu không tính | **bắt buộc** |

```bash
# Thêm lượt check-in bị thiếu
curl -X POST http://localhost:3000/v1/admin/attendance/adjust \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "emp_01J...",
    "workDate": "2026-08-02",
    "adjustType": "ADD",
    "afterValue": { "recordedAt": "2026-08-02T01:00:00Z", "type": "CHECK_IN" },
    "reason": "Nhân viên quên chấm vào do điện thoại hết pin, có xác nhận của trưởng phòng"
  }'

# Sửa giờ một lượt đã có
curl -X POST http://localhost:3000/v1/admin/attendance/adjust \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "emp_01J...", "workDate": "2026-08-02",
    "adjustType": "MODIFY_TIME", "attendanceLogId": "att_01J...",
    "afterValue": { "recordedAt": "2026-08-02T01:05:00Z" },
    "reason": "Lệch giờ do thiết bị mất đồng bộ, đối chiếu camera cửa ra vào"
  }'
```

**Lỗi:** `EMP_NOT_FOUND`, `ATT_NOT_FOUND`, `ATT_PERIOD_LOCKED`, `PAY_REASON_REQUIRED`

---

### `POST /v1/admin/attendance/export` — Xuất Excel (bất đồng bộ) 🔒 → `202`

**Làm gì:** trả `202` kèm `jobId`. File dựng ở Backend rồi lưu S3, tải qua link có thời hạn — **không xuất ở client**.

Chạy nền vì công ty 500 người × 31 ngày là hơn 15.000 dòng, dựng file mất hàng chục giây, vượt timeout HTTP.

```bash
curl -X POST http://localhost:3000/v1/admin/attendance/export \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "from": "2026-08-01", "to": "2026-08-31",
        "departmentIds": ["dep_01J...", "dep_02K..."],
        "format": "XLSX", "template": "default" }'
```
```json
{ "success": true, "data": { "jobId": "job_01J...", "status": "QUEUED" } }
```

---

### Bảng chấm công `/v1/admin/attendance-sheets` (`FR-WEB-ATT-08`, `FR-WEB-ATT-09`)

Song sinh với `/v1/admin/shift-schedules`: danh sách bảng theo tháng × phòng ban là cửa vào, mở một bảng ra mới tới lưới người × ngày.

Bảng **không sở hữu số liệu nào**. Công vẫn ở `attendance_daily`, lịch ca vẫn ở `shift_assignment`, đơn từ vẫn ở `leave_request` — bảng chỉ khai báo phạm vi rồi đọc ba nguồn đó. Vì vậy `DELETE` một bảng không mất bản ghi công nào.

#### `GET /v1/admin/attendance-sheets` — Danh sách 🔒

Lọc `month` (`YYYY-MM-DD`, tự chuẩn hoá về ngày 01) và `departmentId`. Lọc theo một tổ ra cả bảng lập cho khối chứa tổ đó, và ngược lại.

#### `POST /v1/admin/attendance-sheets` — Lập bảng 🔒 📝audit

**Làm gì:** chốt danh sách CBNV của kỳ. Nguồn theo thứ tự ưu tiên: (1) thành viên các **bảng phân ca** cùng tháng chạm tới phòng ban đã chọn; (2) CBNV đang làm việc của các phòng ban đó, khi tháng chưa lập phân ca nào.

Cả hai nguồn đều giao lại với phòng ban đã chọn (kèm cấp dưới) và với phạm vi quyền của người lập.

```bash
curl -X POST http://localhost:3000/v1/admin/attendance-sheets \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "departmentIds": ["dep_01J..."], "periodMonth": "2026-08-01",
        "name": "Bảng chấm công Tháng 08/2026" }'
```
```json
{ "success": true,
  "data": { "id": "ash_01J...", "name": "Bảng chấm công Tháng 08/2026",
            "periodMonth": "2026-08-01", "departmentIds": ["dep_01J..."],
            "shiftScheduleIds": ["sch_01J..."], "status": "DRAFT",
            "memberCount": 24 } }
```

`shiftScheduleIds` rỗng nghĩa là bảng dựng từ danh sách phòng ban, không từ phân ca — Web hiển thị khác nhau vì hai nguồn có mức tin cậy khác nhau.

Lỗi: `ATT_SHEET_NO_MEMBERS` (422), `ATT_SHEET_EMPLOYEE_TAKEN` (409, kèm tên người và tên bảng đang giữ họ).

#### `GET /v1/admin/attendance-sheets/:id/board` — Lưới người × ngày 🔒

**Làm gì:** trả **bốn nguồn trong một lượt gọi** — thành viên, lịch ca đã xếp, công đã tính, đơn từ chạm vào kỳ — cộng ngày lễ. Tách thành bốn endpoint thì có khoảnh khắc chỉ vài phần về tới nơi, mà trên bảng công "ô trống" và "chưa tải xong" trông giống hệt nhau.

Phân trang theo **NGƯỜI**, không theo bản ghi. Bỏ trống `from`/`to` = trọn kỳ của bảng.

```bash
curl "http://localhost:3000/v1/admin/attendance-sheets/ash_01J.../board?from=2026-08-01&to=2026-08-31&pageSize=25" \
  -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": { "from": "2026-08-01", "to": "2026-08-31",
            "employees": [{ "id": "emp_01J...", "fullName": "Nguyễn Văn Đức",
                            "employeeCode": "ducnv.amobi", "status": "ACTIVE",
                            "department": { "id": "dep_01J...", "name": "Kho" } }],
            "assignments": [{ "employeeId": "emp_01J...", "shiftId": "shf_01J...",
                              "workDate": "2026-08-03", "scheduleId": "sch_01J..." }],
            "dailies": [{ "employeeId": "emp_01J...", "workDate": "2026-08-03",
                          "firstCheckInAt": "2026-08-03T01:02:00Z",
                          "lastCheckOutAt": "2026-08-03T10:35:00Z",
                          "workedMinutes": 513, "lateMinutes": 0, "otMinutes": 0,
                          "standardDays": "1.000", "status": "ON_TIME",
                          "appliedRequestIds": [] }],
            "requests": [{ "id": "req_01J...", "employeeId": "emp_01J...",
                           "status": "APPROVED", "startDate": "2026-08-06",
                           "endDate": "2026-08-06", "quantity": "1.00",
                           "requestTypeCode": "ANNUAL_LEAVE",
                           "requestTypeName": "Nghỉ phép năm",
                           "unit": "DAY", "deductFrom": "ANNUAL_LEAVE" }],
            "holidays": [{ "name": "Quốc khánh", "date": "2026-09-02" }] },
  "meta": { "page": 1, "pageSize": 25, "total": 24 } }
```

`requests` gồm cả `PENDING` — đơn chờ duyệt CHƯA vào công, nhưng người rà bảng cần thấy nó trước khi chốt. `startDate`/`endDate` là **ngày làm việc** đã quy đổi theo timezone công ty; đừng cắt chuỗi từ `startAt`.

Lỗi: `ATT_SHEET_NOT_FOUND` (404), `ATT_SHEET_OUT_OF_PERIOD` (422).

#### `POST /v1/admin/attendance-sheets/:id/members` — Thêm CBNV 🔒 📝audit
#### `POST /v1/admin/attendance-sheets/:id/members/remove` — Bỏ CBNV 🔒 📝audit

`POST .../remove` chứ không `DELETE`: danh sách id nằm trong body, mà body của `DELETE` bị nhiều proxy cắt bỏ âm thầm. Bỏ CBNV chỉ bỏ khỏi phạm vi rà soát — công của họ không bị đụng tới.

Lỗi: `ATT_SHEET_CLOSED` (422) khi bảng đã chốt.

#### `POST /v1/admin/attendance-sheets/:id/recalculate` — Cập nhật bảng công 🔒 📝audit → `202`

**Làm gì:** tính lại `attendance_daily` cho **đúng thành viên** của bảng và **đúng
kỳ** của bảng. Cần thiết vì đó là bảng đã tính: đơn duyệt ngược, sửa cấu hình ca,
hay xếp lại phân ca đều KHÔNG tự kích hoạt tính lại.

```bash
curl -X POST http://localhost:3000/v1/admin/attendance-sheets/ash_01J.../recalculate \
  -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": { "jobId": "job_01J...", "statusUrl": "/v1/jobs/job_01J...", "employeeCount": 24 } }
```

Hỏi tiến độ qua `GET /v1/jobs/:id` (`kind = ATTENDANCE_SHEET_RECALCULATE`) cho tới
khi `status` là `COMPLETED` hoặc `FAILED`.

Job **idempotent** (`NFR-REL-06`). Ngày thuộc kỳ lương đã chốt bị **bỏ qua, không
ghi đè** (`BR-07`). Bảng rỗng vẫn trả về một job đã ở trạng thái kết thúc, không
phải lỗi — client đang chờ một `jobId` để hỏi tiến độ.

⚠ Không có Redis (`REDIS_ENABLED=false`) thì job vẫn chạy, **nội tuyến và tách
khỏi request**, vẫn ghi tiến độ vào bản ghi job — khác hẳn xuất Excel (đánh hỏng
ngay). Một nút bấm vô dụng ở mọi môi trường chưa bật dịch vụ nền thì không đáng có.

#### `POST /v1/admin/attendance-sheets/:id/close` — Chốt bảng 🔒 📝audit
#### `POST /v1/admin/attendance-sheets/:id/reopen` — Mở lại 🔒 📝audit

Chốt khoá việc **sửa thành viên**, không khoá số liệu — kỳ lương mới làm việc đó (`BR-07`). `reopen` bị từ chối với `PAY_PERIOD_CLOSED` nếu kỳ lương phủ lên tháng của bảng đã chốt.

#### `DELETE /v1/admin/attendance-sheets/:id` 🔒 📝audit

Xoá mềm khung rà soát. Không đụng `attendance_daily`, `attendance_log` hay đơn từ.

---

### `GET /v1/jobs/:id` — Trạng thái job chạy nền 🔒

**Làm gì:** hỏi tiến độ job và lấy link tải khi xong. Dùng chung cho **mọi** loại job dài, phân biệt bằng `kind`: `ATTENDANCE`, `PAYROLL`, `PAYROLL_RECALCULATE`, `ATTENDANCE_SHEET_RECALCULATE`.

```bash
curl http://localhost:3000/v1/jobs/job_01J... -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": { "id": "job_01J...", "kind": "PAYROLL", "status": "COMPLETED", "progress": 100,
            "downloadUrl": "https://s3.../bang-cong-08-2026.xlsx?X-Amz-Expires=900&...",
            "error": null } }
```

| `status` | Nghĩa |
|---|---|
| `QUEUED` | đã nhận, chưa tới lượt chạy |
| `PROCESSING` | đang chạy — đọc `progress` (0–100) |
| `COMPLETED` | xong. Job xuất file có `downloadUrl`; job tính lại thì `null` |
| `FAILED` | hỏng — câu giải thích nằm ở `error` |

> ⚠ **Trạng thái cuối của API là `COMPLETED`, còn cột `status` trong database ghi `DONE`.** Endpoint quy đổi tại biên, nên client chỉ cần biết một từ vựng. Đừng đọc thẳng giá trị DB: đã từng có lần client dừng hỏi ở `status === 'COMPLETED'` trong khi API trả `DONE`, khiến giao diện hỏi lại mỗi 2 giây vô hạn và file dựng xong không bao giờ được tải về.
>
> Chỉ hai trạng thái `COMPLETED` và `FAILED` là **kết thúc**. Vòng lặp hỏi tiến độ phải dừng ở cả hai — dừng ở mỗi `COMPLETED` thì job hỏng sẽ quay mãi.

---

## 10. Web Quản lý — Nhân sự `/v1/admin/employees`

Phân quyền nhất quán trong cả nhóm:
- **MANAGER** chỉ **ĐỌC** (`list`, `detail`), và chỉ trong phòng ban mình quản lý
- **HR_PAYROLL / COMPANY_ADMIN** mới **GHI** được

Mọi thao tác ghi đều có `@Audit` — hồ sơ nhân sự quyết định quyền hạn, tiền lương và khả năng đăng nhập, không thay đổi nào được phép mất dấu vết.

---

### `GET /v1/admin/employees` — Danh sách nhân viên 🔒

| Query | Ghi chú |
|---|---|
| `status` | enum `EmployeeStatus`, **nhận nhiều giá trị** ngăn bằng dấu phẩy: `?status=ACTIVE,PENDING_ACTIVATION` |
| `departmentId` | lọc — **bao gồm cả phòng ban cấp dưới** của id truyền lên |
| `branchId` | lọc |
| `q` | tìm theo tên / mã / SĐT |
| `page`, `pageSize`, `sort` | chuẩn |

```bash
curl "http://localhost:3000/v1/admin/employees?status=ACTIVE,PENDING_ACTIVATION&departmentId=dep_01J...&q=đức&pageSize=50" \
  -H "Authorization: Bearer $HR_TOKEN"
```

> ⚠ **Ô chọn nhân viên đừng lọc `status=ACTIVE`.** `PENDING_ACTIVATION` là hồ sơ HR đã tạo nhưng người đó **chưa đăng nhập lần nào** — vẫn là nhân viên thật, vẫn đi làm, vẫn xin nghỉ được. Công ty **mới triển khai** thì toàn bộ nhân sự nằm ở trạng thái này, nên lọc `ACTIVE` cho ra ô chọn **rỗng trơn mà không có lỗi nào báo** — không phải 400, không phải danh sách trống có thông báo, chỉ là một ô gõ vào không ra gì.
>
> Dùng `?status=ACTIVE,PENDING_ACTIVATION` (phía Web là hằng `EMPLOYABLE_STATUSES`). `SUSPENDED` và `TERMINATED` cố ý nằm ngoài: tạm ngưng thì không phát sinh công, đã nghỉ việc thì không tạo chứng từ mới.

> `departmentId` mở rộng xuống **toàn bộ cấp dưới** (`withDescendantDepartments`). Nhân viên gắn ở lá của cây phòng ban, nút cha thường không có ai đứng trực tiếp — khớp đúng một id thì chọn khối cha ra danh sách rỗng, và không có lỗi nào báo. Phạm vi của MANAGER **giao** với bộ lọc này chứ không ghi đè, nên bộ lọc vẫn chỉ thu hẹp, không bao giờ nới rộng.

---

### `POST /v1/admin/employees/preview-code` — Xem trước mã nhân viên 🔒 → `200`

**Làm gì:** tính thử mã nhân viên **trước khi bấm lưu**. Không tạo gì cả.

Có endpoint riêng vì mã nhân viên **bị khoá sau lần chấm công đầu tiên** (BR-04). HR cần nhìn thấy `ducnv.amobi` và kịp đổi ngay lúc tạo, thay vì phát hiện sai khi đã quá muộn.

Quy tắc: `<tên chính><viết tắt họ và tên lót>.<mã công ty>`. Trùng thì thêm số: `ducnv2.amobi`.

Dùng POST thay vì GET vì họ tên đi trong body: tên tiếng Việt có dấu nằm trên URL sẽ bị mã hoá lằng nhằng và lọt vào log truy cập.

```bash
curl -X POST http://localhost:3000/v1/admin/employees/preview-code \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fullName": "Nguyễn Văn Đức" }'
```
```json
{ "success": true, "data": { "employeeCode": "ducnv.amobi", "isTaken": false } }
```

---

### `POST /v1/admin/employees` — Tạo hồ sơ nhân viên 🔒 📝audit

**Làm gì:** tạo hồ sơ (Luồng B) và gửi SMS mời.

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `fullName` | ✔ | 2–100 ký tự |
| `phone` | ✔ | regex dễ dãi: nhận `+84`, khoảng trắng, dấu chấm/gạch — HR nhập từ nhiều nguồn |
| `employeeCode` | ✖ | bỏ trống = tự sinh; đặt tay để khớp hệ thống nhân sự cũ |
| `email` | ✖ | định danh đăng nhập |
| `departmentId`, `branchId`, `position`, `contractType`, `joinedAt` | ✖ | |
| `roles` | ✖ | mặc định `["EMPLOYEE"]` |
| `managedDepartmentIds` | ✖ | **phạm vi dữ liệu của MANAGER** |
| `sendInvite` | ✖ | mặc định `true` |

> `managedDepartmentIds`: vai trò nói được **làm gì**, trường này nói được làm **trên ai**. MANAGER mà để trống thì `ScopeGuard` không có phòng ban nào để cho phép — người đó đăng nhập vào sẽ không thấy nhân viên nào. Ngược lại, khai thừa một phòng ban là trao quyền xem lương của cả phòng đó.

```bash
curl -X POST http://localhost:3000/v1/admin/employees \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Nguyễn Văn Đức",
    "phone": "0901234567",
    "email": "duc@amobi.vn",
    "departmentId": "dep_01J...",
    "branchId": "brc_01J...",
    "position": "Nhân viên",
    "contractType": "Chính thức",
    "joinedAt": "2026-08-01",
    "roles": ["EMPLOYEE"],
    "sendInvite": true
  }'
```

**Lỗi:** `AUTH_PHONE_INVALID`, `EMP_PHONE_TAKEN`, `EMP_CODE_TAKEN`, `PLAN_EMPLOYEE_LIMIT_REACHED`

---

### `GET /v1/admin/employees/:id` — Chi tiết hồ sơ 🔒

```bash
curl http://localhost:3000/v1/admin/employees/emp_01J... -H "Authorization: Bearer $HR_TOKEN"
```

---

### `PATCH /v1/admin/employees/:id` — Sửa hồ sơ 🔒 📝audit

**Làm gì:** sửa hồ sơ. **BR-04: mã nhân viên bị khoá sau lần chấm công đầu tiên**, sau đó không sửa được nữa.

> **Không có trường `phone`** một cách có chủ đích: số điện thoại là định danh nhận OTP, đổi tuỳ ý nghĩa là chiếm được tài khoản. Đổi số phải qua `POST /v1/system/users/:id/change-phone` với quyền cao hơn và audit riêng.

```bash
curl -X PATCH http://localhost:3000/v1/admin/employees/emp_01J... \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "position": "Trưởng nhóm", "roles": ["EMPLOYEE","MANAGER"],
        "managedDepartmentIds": ["dep_01J..."] }'
```

**Lỗi:** `EMP_NOT_FOUND`, `EMP_CODE_LOCKED`, `EMP_CODE_TAKEN`

---

### `DELETE /v1/admin/employees/:id` — Xoá hồ sơ 🔒 📝audit

**Làm gì:** xoá **thật**, và vì thế **chỉ cho phép với hồ sơ `PENDING_ACTIVATION`** — hồ sơ HR vừa gõ nhầm, chưa ai đăng nhập, chưa có bản ghi chấm công nào.

Hồ sơ đã kích hoạt gắn với dữ liệu chấm công và bảng lương là chứng từ phải lưu theo luật (NFR-LEGAL-08); với họ, đường đúng là `terminate`.

```bash
curl -X DELETE http://localhost:3000/v1/admin/employees/emp_01J... \
  -H "Authorization: Bearer $HR_TOKEN"
```

**Lỗi:** `EMP_DELETE_NOT_ALLOWED`

---

### `POST /v1/admin/employees/:id/resend-invite` — Gửi lại SMS mời 🔒 → `200`

```bash
curl -X POST http://localhost:3000/v1/admin/employees/emp_01J.../resend-invite \
  -H "Authorization: Bearer $HR_TOKEN"
```

---

### `POST /v1/admin/employees/:id/suspend` — Tạm ngưng 🔒 📝audit → `200`

**Làm gì:** thu hồi phiên **ngay lập tức**, không cho đăng nhập/chấm công. `reason` ≥ 10 ký tự (BR-08).

```bash
curl -X POST http://localhost:3000/v1/admin/employees/emp_01J.../suspend \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Nghỉ không phép 5 ngày liên tiếp, chờ giải trình" }'
```

---

### `POST /v1/admin/employees/:id/reactivate` — Kích hoạt lại 🔒 📝audit → `200`

```bash
curl -X POST http://localhost:3000/v1/admin/employees/emp_01J.../reactivate \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Đã giải trình và được chấp thuận quay lại làm việc" }'
```

---

### `POST /v1/admin/employees/:id/terminate` — Chấm dứt hợp đồng 🔒 📝audit → `200`

**Làm gì:** thu hồi token + device binding, vô hiệu dữ liệu sinh trắc (xoá hẳn nếu chính sách bật), **nhưng GIỮ** bản ghi chấm công và bảng công đã chốt để làm chứng từ (NFR-LEGAL-08).

`effectiveDate` tách khỏi ngày bấm nút: HR thường nhập trước vài ngày. Lấy luôn thời điểm bấm nút làm ngày nghỉ việc thì những ngày còn đi làm thật sẽ bị cắt khỏi bảng lương cuối cùng.

```bash
curl -X POST http://localhost:3000/v1/admin/employees/emp_01J.../terminate \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Nhân viên xin nghỉ việc, đã bàn giao xong ngày 15/08",
        "effectiveDate": "2026-08-15" }'
```

---

### `POST /v1/admin/employees/import/validate` — Kiểm tra file import 🔒 → `200`

**Làm gì:** **không ghi gì vào database** — chỉ kiểm tra rồi trả kết quả **theo từng dòng**.

Tách hai bước vì file Excel gõ tay gần như luôn có lỗi. Ghi thẳng thì import 200 dòng chết ở dòng 137, để lại 136 nhân viên tạo dở dang mà HR phải dọn tay.

**Import không bao giờ fail toàn bộ file vì một dòng lỗi.** Mã nhân viên sinh ra duy nhất kể cả khi hai người trùng tên trong cùng file.

Web parse Excel ở client rồi gửi mảng `rows` lên đây.

```bash
curl -X POST http://localhost:3000/v1/admin/employees/import/validate \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      { "fullName": "Nguyễn Văn Đức", "email": "duc@amobi.vn", "phone": "0901234567",
        "departmentName": "Phòng Kỹ thuật", "position": "Nhân viên",
        "joinedAt": "2026-08-01", "contractType": "Chính thức" },
      { "fullName": "Trần Thị Lan", "email": "duc@amobi.vn", "phone": "0907654321" }
    ]
  }'
```
```json
{ "success": true,
  "data": { "total": 2, "valid": 1, "invalid": 1,
            "rows": [
              { "index": 0, "ok": true, "employeeCode": "ducnv.amobi" },
              { "index": 1, "ok": false,
                "errors": [ { "field": "email", "code": "EMP_EMAIL_TAKEN",
                              "message": "Email trùng với dòng 1" } ] } ] } }
```

---

### `POST /v1/admin/employees/import/execute` — Thực hiện import 🔒 📝audit

**Làm gì:** tạo nhân viên từ các dòng hợp lệ + gửi SMS mời hàng loạt.

> ⚠ Client gửi lại các dòng, nên service **KHÔNG được tin** là chúng đã qua bước validate — người gọi API có thể bỏ qua bước 1 hoàn toàn. Bước validate là để phục vụ trải nghiệm người dùng, **không phải chốt an toàn**.

`sendInvite: false` khi nhập hàng loạt đầu kỳ — 500 tin SMS bay đi cùng lúc trong lúc dữ liệu còn đang rà soát sẽ khiến cả công ty nhận lời mời rồi lại phải huỷ.

```bash
curl -X POST http://localhost:3000/v1/admin/employees/import/execute \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [ { "fullName": "Nguyễn Văn Đức", "email": "duc@amobi.vn",
                "phone": "0901234567", "departmentName": "Phòng Kỹ thuật" } ],
    "sendInvite": false
  }'
```

**Lỗi:** `PLAN_EMPLOYEE_LIMIT_REACHED`

---

## 11. Web Quản lý — Chính sách `/v1/admin`

Gom vào một chỗ **mọi thứ công ty tự cấu hình được** (BR-12): ngưỡng chính sách, ca làm việc, ngày lễ, chi nhánh, phòng ban. Đây là nơi định nghĩa "luật chơi" mà module chấm công và tính lương chỉ việc áp dụng.

**MANAGER ĐỌC được** chính sách (cần biết luật để giải thích cho cấp dưới) **nhưng không SỬA được** — mọi endpoint ghi chỉ mở cho `COMPANY_ADMIN` / `HR_PAYROLL` và đều có `@Audit`. **Đổi ngưỡng đi muộn là đổi tiền lương của cả công ty.**

---

### `GET /v1/admin/policies` — Toàn bộ chính sách đang hiệu lực 🔒

**Vai trò:** `COMPANY_ADMIN`, `HR_PAYROLL`, `MANAGER`

**Làm gì:** trả giá trị đã trộn giữa `CompanyPolicy` và giá trị mặc định, **kèm danh mục khoá hợp lệ** để UI dựng form **động** — thêm một chính sách mới ở backend là giao diện tự có thêm ô nhập, không phải build lại frontend.

```bash
curl http://localhost:3000/v1/admin/policies -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": {
    "policies": { "attendance.geofence.outOfRangeAction": "PENDING_REVIEW",
                  "ai.face.matchThreshold": 0.5,
                  "attendance.lateToleranceMinutes": 5 },
    "availableKeys": ["attendance.geofence.outOfRangeAction", "ai.face.matchThreshold", "..."],
    "defaults":     { "attendance.geofence.outOfRangeAction": "BLOCK",
                      "ai.face.matchThreshold": 0.45 }
  } }
```

---

### `PUT /v1/admin/policies` — Cập nhật chính sách 🔒 📝audit

**Vai trò:** `COMPANY_ADMIN`, `HR_PAYROLL`

**Làm gì:** **KHÔNG ghi đè** (D6) — đóng bản cũ bằng `effectiveTo` và tạo bản mới, để tính lại công quá khứ vẫn ra đúng số.

Đổi ngưỡng đi muộn hôm nay không được phép tính lại bảng công tháng trước: nhân viên đã bị trừ lương theo luật cũ mà tự dưng đổi ngược lại là sai, và ngược lại cũng vậy.

NFR-LEGAL-05: chặn hệ số OT dưới mức luật định.

```bash
curl -X PUT http://localhost:3000/v1/admin/policies \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policies": {
      "attendance.geofence.outOfRangeAction": "PENDING_REVIEW",
      "ai.face.matchThreshold": 0.5,
      "attendance.lateToleranceMinutes": 5
    },
    "effectiveFrom": "2026-09-01T00:00:00+07:00",
    "reason": "Nới ngưỡng geofence theo phản hồi chi nhánh nhà xưởng"
  }'
```
```json
{ "success": true, "data": { "updated": 3 } }
```

**Lỗi:** `POL_VIOLATES_LABOR_LAW`

---

### Ca làm việc

#### `GET /v1/admin/shifts` — Danh sách ca 🔒
```bash
curl http://localhost:3000/v1/admin/shifts -H "Authorization: Bearer $HR_TOKEN"
```

#### `POST /v1/admin/shifts` — Tạo ca 🔒 📝audit

Một DTO phục vụ nhiều loại ca: ca cố định cần `startTime`/`endTime`, ca linh hoạt chỉ cần `requiredMinutes`, ca gãy dùng `segments`.

| Trường | Ghi chú |
|---|---|
| `name` | bắt buộc |
| `code` | **bắt buộc**, duy nhất trong công ty. Tự chuẩn hoá về CHỮ HOA |
| `symbol` | ký hiệu in trên bảng chấm công (`"X"`, `"Đ"`). Không cần duy nhất |
| `departmentIds` | phòng ban áp dụng. Rỗng = mọi phòng ban. **Chỉ lọc gợi ý khi phân ca, không chặn** |
| `type` | enum `ShiftType`, mặc định `FIXED` |
| `startTime`, `endTime` | `'HH:mm'` theo **giờ địa phương** của công ty, không phải UTC |
| `crossesMidnight` | **`true` nếu ca kết thúc NGÀY HÔM SAU** (ca đêm 22:00→06:00) |
| `breakMinutes` | phút nghỉ giữa ca. **Bị bỏ qua nếu gửi kèm `breakStart`/`breakEnd`** |
| `breakStart`, `breakEnd` | khoảng nghỉ cụ thể. Phải nằm **trong** giờ ca |
| `requireCheckIn` | **luôn phải là `true`** — gửi `false` trả `POL_SHIFT_CHECKIN_REQUIRED` |
| `checkInFrom`, `checkInTo` | khung giờ chấm vào được chấp nhận. Bỏ trống = không giới hạn |
| `requireCheckOut` | tắt cho ca chỉ điểm danh đầu giờ |
| `checkOutFrom`, `checkOutTo` | khung giờ chấm ra |
| `workDayCredit` | số ngày công của ca (nửa buổi = `0.5`) |
| `normalDayFactor`, `weeklyRestFactor`, `holidayFactor` | hệ số ngày công. **Chưa nối vào máy tính công** |
| `holidayFactors` | ngoại lệ theo từng ngày lễ: `[{ holidayId, factor }]`. Gửi mảng = **thay toàn bộ**; `[]` = xoá hết ngoại lệ; không gửi = giữ nguyên |
| `requiredMinutes` | ca linh hoạt: tổng phút phải làm |
| `lateToleranceMinutes` | biên độ dung thứ — **không phải "giờ vào mới"** |
| `earlyLeaveToleranceMinutes` | |
| `isDefault` | ca mặc định khi không phân ca cụ thể |
| `weekdayMask` | **BITMASK**: 1=T2, 2=T3, 4=T4, 8=T5, 16=T6, 32=T7, 64=CN. `31` = T2–T6. `0` = mọi ngày |
| `effectiveFrom`, `effectiveTo` | hiệu lực theo thời gian (D6) |
| `segments` | ca gãy: `[{ order, startTime, endTime }]` |

Phản hồi kèm thêm **`workMinutes`** — số phút công, do Backend **tính ra** từ giờ ca trừ giờ nghỉ. Đây là trường chỉ đọc: gửi lên cũng bị bỏ qua, và không có cột tương ứng trong database.

| Loại ca | `workMinutes` tính thế nào |
|---|---|
| `FLEXIBLE` | `requiredMinutes` |
| có `segments` | tổng độ dài các đoạn — **không** trừ `breakMinutes` (các đoạn đã loại giờ nghỉ) |
| còn lại | `endTime − startTime − breakMinutes`, tự cộng 24h khi hiệu số ≤ 0 |

> ⚠ `crossesMidnight` là trường nhỏ nhưng sai là hỏng cả bảng công: không có cờ này thì `06:00 < 22:00` sẽ tính ra giờ công **âm**, hoặc bị hiểu thành ca 16 tiếng. Cờ này cũng quyết định lượt chấm lúc 02:00 sáng thuộc về **ngày làm việc nào**.
>
> ⚠ `lateToleranceMinutes` là biên độ dung thứ: đến 08:04 với biên độ 5 phút thì **không** bị ghi đi muộn, nhưng giờ vào **vẫn lưu là 08:04** — báo cáo phải phản ánh sự thật, chỉ phần xử phạt mới được nới.
>
> ⚠ Ràng buộc duy nhất của `code` là **partial unique index** `WHERE "effectiveTo" IS NULL`, không phải unique thường. Phải như vậy vì D6: đổi giờ một ca đã phân sẽ **đóng** bản hiện tại rồi mở bản kế nhiệm mang **cùng mã**. Ca xoá mềm vẫn giữ mã (`effectiveTo` vẫn null) — mã đã in trên bảng công không được mang nghĩa khác.
>
> ⚠ Hệ số ngày công hiện **chỉ được lưu và hiển thị**. Máy tính công chưa đọc tới, nên sửa chúng không làm đổi số liệu kỳ lương — xem `docs/04` mục 6.5.

```bash
# Ca hành chính có nghỉ trưa (ca gãy)
curl -X POST http://localhost:3000/v1/admin/shifts \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hành chính", "code": "HC", "symbol": "X",
    "type": "FIXED",
    "startTime": "08:00", "endTime": "17:30",
    "breakStart": "12:00", "breakEnd": "13:00",
    "checkInFrom": "06:00", "checkInTo": "10:00",
    "checkOutFrom": "16:00", "checkOutTo": "22:00",
    "workDayCredit": 1,
    "lateToleranceMinutes": 5,
    "weekdayMask": 31,
    "isDefault": true,
    "segments": [ { "order": 1, "startTime": "08:00", "endTime": "12:00" },
                  { "order": 2, "startTime": "13:00", "endTime": "17:30" } ]
  }'

# Ca đêm vắt qua nửa đêm — khoảng nghỉ phải nằm TRONG ca, không phải nghỉ trưa
curl -X POST http://localhost:3000/v1/admin/shifts \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Ca đêm", "code": "CD", "symbol": "Đ",
        "startTime": "22:00", "endTime": "06:00",
        "crossesMidnight": true,
        "breakStart": "00:30", "breakEnd": "01:00",
        "weekdayMask": 0 }'

# Ca nửa buổi cho riêng phòng Kho, có hệ số riêng cho Tết
curl -X POST http://localhost:3000/v1/admin/shifts \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Nửa buổi sáng", "code": "NB1",
        "startTime": "08:00", "endTime": "12:00",
        "departmentIds": ["dept_kho"],
        "workDayCredit": 0.5,
        "requireCheckOut": false,
        "holidayFactor": 3,
        "holidayFactors": [ { "holidayId": "hol_tet_2026", "factor": 4 } ] }'
```

**Lỗi:** `POL_INVALID_TIME_FORMAT`, `POL_SHIFT_CODE_TAKEN`, `POL_SHIFT_CHECKIN_REQUIRED`, `POL_SHIFT_INVALID_WINDOW`

#### `PUT /v1/admin/shifts/:id` — Cập nhật ca 🔒 📝audit

**Làm gì:** đổi giờ ca **đã được phân** → tạo phiên bản mới theo hiệu lực thời gian, **không sửa đè** (bẫy "đổi cấu hình ca giữa tháng").

```bash
curl -X PUT http://localhost:3000/v1/admin/shifts/sft_01J... \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Hành chính", "startTime": "08:30", "endTime": "18:00",
        "breakMinutes": 60, "effectiveFrom": "2026-09-01" }'
```

#### `DELETE /v1/admin/shifts/:id` — Xoá ca (soft delete) 🔒 📝audit
```bash
curl -X DELETE http://localhost:3000/v1/admin/shifts/sft_01J... -H "Authorization: Bearer $HR_TOKEN"
```

#### `POST /v1/admin/shift-assignments/bulk` — Phân ca hàng loạt 🔒 📝audit

**Vai trò:** `COMPANY_ADMIN`, `HR_PAYROLL`, `MANAGER`

**Làm gì:** xếp một ca cho nhiều người trong một khoảng ngày (FR-WEB-HR-04). Có endpoint riêng vì thao tác thật là "xếp ca tháng 8 cho cả phòng 40 người" — gọi 40×31 request đơn lẻ vừa chậm vừa hỏng dở chừng.

> ⚠ `weekdays` ở đây là **SỐ THỨ TỰ** (1=T2 … 7=CN), **KHÁC** `weekdayMask` của `UpsertShiftDto` vốn là **bitmask**. Cùng dãy số hiểu theo hai cách sẽ ra kết quả hoàn toàn khác mà vẫn chạy trơn tru.

```bash
curl -X POST http://localhost:3000/v1/admin/shift-assignments/bulk \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeIds": ["emp_01J...", "emp_02K...", "emp_03L..."],
    "shiftId": "sft_01J...",
    "from": "2026-09-01", "to": "2026-09-30",
    "weekdays": [1,2,3,4,5],
    "scheduleId": "sch_01J..."
  }'
```

`scheduleId` là tuỳ chọn. Có nó thì Backend kiểm tra thêm **ba** điều mà bảng đã chốt lúc lập, và lượt xếp được gắn vào bảng để sau này xoá bảng còn biết phải xoá những gì:

| Kiểm tra | Lỗi khi vi phạm |
|---|---|
| `shiftId` nằm trong `shiftIds` của bảng | `POL_SCHEDULE_OUT_OF_SCOPE` |
| `from`–`to` nằm trong tháng của bảng | `POL_SCHEDULE_OUT_OF_PERIOD` |
| nhân viên là thành viên của bảng | lọc bỏ, trả về trong `skippedEmployeeIds` |

##### Nhiều ca một ngày

Một `(nhân viên, ngày)` mang được **nhiều ca**, điều kiện duy nhất là **khung giờ không giao nhau**. Endpoint này **THÊM** ca chứ không thay ca cũ; xếp lại đúng ca đang có là ghi đè bình thường, không tính là tự đè lên chính nó.

Ô nào trùng giờ thì **bỏ qua đúng ô đó** và báo về trong `conflicts` (tối đa 20 dòng đầu, `conflictCount` là tổng thật) — không huỷ cả lượt xếp, vì một ngày vướng không phải lý do để bỏ cả tháng:

```json
{ "assigned": 20, "employeeCount": 1, "dayCount": 22, "skippedEmployeeIds": [],
  "conflicts": [{ "employeeId": "emp_01J...", "workDate": "2026-09-07", "shiftName": "Hành chính" }],
  "conflictCount": 2 }
```

Phép so soi **cả ngày trước và ngày sau**: ca đêm 22:00–06:00 của hôm trước còn chạy tới 6 giờ sáng hôm nay. Ca **linh hoạt** không khai giờ nên bị coi là chiếm trọn ngày. Chạm đầu–cuối (12:00 và 12:00) **không** tính là giao. Logic nằm ở `shift-overlap.util.ts` — database không diễn đạt được ràng buộc này vì phải đọc khung giờ bên bảng `shift` và ca qua đêm còn tràn sang ngày sau; khoá duy nhất `(employeeId, workDate, shiftId)` chỉ chặn xếp trùng đúng một ca hai lần.

> ⚠ **Máy tính công và chấm công vẫn chỉ đọc MỘT ca mỗi ngày** — `resolveShiftForDate` lấy ca có `startTime` **sớm nhất** (thứ tự tiền định, `NULL` xuống cuối nên ca linh hoạt chỉ được chọn khi không còn ca nào khác). Các ca sau chưa cộng vào giờ công. Web hiện cảnh báo đếm số ngày có nhiều hơn một ca.

`POST /shift-assignments/clear` nhận thêm `shiftId` tuỳ chọn: chỉ xoá đúng ca đó, bỏ trống = xoá mọi ca trong khoảng. Cần từ khi một ngày mang nhiều ca — bỏ ca chiều mà kéo theo cả ca sáng là xoá mất phần việc người dùng không hề động tới.

---

### Bảng phân ca (`FR-WEB-HR-13`)

Bảng phân ca là **đơn vị công việc** của người xếp lịch ("bảng phân ca tháng 8 phòng Kho"), đứng trên `shift_assignment` vốn chỉ là từng ô lịch rời rạc.

#### `GET /v1/admin/shift-schedules` — Danh sách 🔒

Lọc theo `month` (`YYYY-MM-DD`, tự chuẩn hoá về ngày 01) và `departmentId`. MANAGER chỉ thấy bảng có chạm tới phòng ban mình quản lý.

> `departmentId` ở đây mở rộng **cả hai chiều** trên cây phòng ban (`relatedDepartmentIds`): lọc theo một khối ra cả bảng lập riêng cho từng tổ bên dưới, lọc theo một tổ ra cả bảng lập cho khối chứa tổ đó — bảng ấy có người của tổ trong đó. Đây là bộ lọc *tìm*, nên rộng là đúng; các endpoint *áp dụng* phạm vi (lập bảng, lưới chi tiết) chỉ đi xuống.

#### `POST /v1/admin/shift-schedules` — Lập bảng 🔒 📝audit

| Trường | Ghi chú |
|---|---|
| `departmentIds` | bắt buộc, ≥1. **Toàn bộ CBNV đang làm việc** của các phòng này **và cấp dưới của chúng** được đưa vào bảng, chưa xếp ca |
| `shiftIds` | bắt buộc, ≥1. Phạm vi ca dùng được trong bảng |
| `periodMonth` | ngày bất kỳ trong tháng, service chuẩn hoá về ngày 01 |
| `name` | bỏ trống = `Bảng phân ca Tháng MM/YYYY` |

```bash
curl -X POST http://localhost:3000/v1/admin/shift-schedules \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "departmentIds": ["dept_kho"], "shiftIds": ["sft_hc", "sft_dem"],
        "periodMonth": "2026-09-01" }'
```

> ⚠ **Một người, một tháng, một bảng.** Ràng buộc nằm ở tầng database
> (`shift_schedule_member_employeeId_periodMonth_key`), không chỉ ở service: hai
> request lập bảng chạy song song đều thấy "chưa ai giữ" rồi cùng ghi. Vi phạm →
> `POL_SCHEDULE_EMPLOYEE_TAKEN`, kèm tên người và tên bảng đang giữ họ.
>
> Cần vậy vì `shift_assignment` chỉ cho phép **một ca mỗi người mỗi ngày**. Hai
> bảng cùng tháng sẽ tranh nhau ghi vào cùng ô, bảng lưu sau đè bảng lưu trước —
> và màn chi tiết của bảng kia hiển thị ca mà nó không hề xếp.

> ⚠ **Không lập được bảng rỗng** (docs/04 mục 8.5). Phòng ban đã chọn — kể cả cấp dưới — không có CBNV `ACTIVE`/`PENDING_ACTIVATION` nào → `POL_SCHEDULE_NO_MEMBERS`, kèm tên các phòng ban trong `details.departments`. Bảng rỗng vẫn **giữ chỗ** cho tháng đó, nên người lập sau thấy "đã có bảng" mà lưới chi tiết trống trơn và không có gì giải thích.
>
> Web đếm trước bằng `_count.employees` của `GET /admin/departments` (đã lọc sẵn theo hai trạng thái trên, **chỉ đếm người đứng trực tiếp** ở phòng ban đó — muốn cả nhánh thì cộng theo cây) và khoá nút Lưu trước khi gọi API.

#### `DELETE /v1/admin/shift-schedules/:id` 🔒 📝audit

Xoá bảng **và toàn bộ lịch ca do nó xếp**, trong một transaction. Trả về `{ deleted, removedAssignments, removedMembers }`.

- **BR-07**: chặn khi tháng của bảng thuộc kỳ lương đã chốt → `PAY_PERIOD_CLOSED`.
- Bảng bị xoá **mềm** (còn tra được trong audit log); thành viên bị xoá **hẳn** — ràng buộc "một người một tháng một bảng" không lọc `deletedAt`, giữ lại dòng thành viên nghĩa là những người đó vĩnh viễn không lập được bảng mới cho tháng đó.
- Lịch ca bị xoá tường minh bởi service, **không** để database cascade: `ON DELETE SET NULL` ở khoá ngoại là cố ý, vì đây là dữ liệu đi thẳng vào bảng công và việc xoá nó phải qua kiểm tra BR-07 ở trên.

#### `POST /v1/admin/shift-schedules/:id/members` — Thêm CBNV 🔒 📝audit
#### `POST /v1/admin/shift-schedules/:id/members/remove` — Bỏ CBNV 🔒 📝audit

Cả hai nhận `{ "employeeIds": [...] }`. Bỏ CBNV **xoá luôn lịch ca của họ trong bảng này** — nếu không, bảng công cuối tháng vẫn tính theo ca cũ dù họ không còn nằm trong bảng nào.

> Dùng `POST .../remove` chứ không `DELETE`: danh sách id đi trong body, mà body của `DELETE` bị nhiều proxy và thư viện HTTP cắt bỏ âm thầm — request tới nơi với body rỗng sẽ bỏ nhầm không ai, hoặc tuỳ cách viết, bỏ hết cả bảng.

`GET /v1/admin/shift-assignments` nhận thêm `scheduleId`: dòng của bảng khi đó là **thành viên đã chốt** của bảng, không phải "ai đang thuộc phòng ban này" — hai thứ đó lệch nhau ngay khi có người chuyển phòng giữa tháng.

> Có `scheduleId` thì lịch trả về **chỉ gồm lượt do đúng bảng đó xếp** — bảng vừa lập luôn cho lưới trắng. Không lọc thì một tháng đã có lịch cũ (dựng trước khi có phân hệ này, hoặc do API ghi thẳng — dữ liệu thật có 88 lượt `scheduleId = null`) sẽ làm bảng chưa xếp gì hiện ra đầy ca, đọc thành "hệ thống tự ý phân ca". Bỏ trống `scheduleId` = xem lịch thật của cả khoảng ngày, không lọc.
>
> ⚠ Lịch cũ **vẫn tồn tại và vẫn tính vào bảng công**, chỉ là không hiện trong lưới của bảng. Xếp ca vào ngày đã có lịch cũ sẽ **thay** ca thật của ngày đó — `upsert` theo cặp (nhân viên, ngày), không sinh dòng thứ hai. Mỗi ô vẫn kèm `scheduleId` trong phản hồi để client kiểm chứng.
>
> `POST /shift-assignments/bulk` **luôn phải gửi `scheduleId`** khi thao tác từ trong một bảng, kể cả khi chỉ sửa một ô: thiếu nó thì lượt vừa xếp không thuộc bảng nào, xoá bảng không dọn được nó, và lần mở sau nó hiện lên như ca có sẵn.

---

### Ngày lễ

#### `GET /v1/admin/holidays` — Danh mục ngày lễ 🔒
```bash
curl "http://localhost:3000/v1/admin/holidays?year=2026" -H "Authorization: Bearer $HR_TOKEN"
```

#### `POST /v1/admin/holidays` — Thêm/cập nhật ngày lễ 🔒 📝audit

Lễ rơi vào T7/CN thì luật lao động cho nghỉ bù ngày kế tiếp → dùng `substituteDate`.
`otMultiplier`: NFR-LEGAL-05 — ngày lễ tối thiểu 300%.

```bash
curl -X POST http://localhost:3000/v1/admin/holidays \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Quốc khánh", "date": "2026-09-02",
        "substituteDate": "2026-09-03", "otMultiplier": 3.0 }'
```

#### `DELETE /v1/admin/holidays/:id` 🔒 📝audit
```bash
curl -X DELETE http://localhost:3000/v1/admin/holidays/hol_01J... -H "Authorization: Bearer $HR_TOKEN"
```

---

### Chi nhánh

#### `GET /v1/admin/branches` — Danh sách kèm cấu hình geofence 🔒
```bash
curl http://localhost:3000/v1/admin/branches -H "Authorization: Bearer $HR_TOKEN"
```

#### `POST /v1/admin/branches` — Tạo chi nhánh 🔒 📝audit — **chỉ `COMPANY_ADMIN`**

**Làm gì:** định nghĩa **"ở công ty" nghĩa là ở đâu**. Toạ độ, bán kính, WiFi, beacon ở đây chính là dữ liệu mà chốt chống chấm công hộ dựa vào (AF-02).

> **`radiusMeters` sai theo cả hai hướng đều hỏng:**
> - Quá **nhỏ** → GPS trong nhà lệch 20–50m, nhân viên ngồi đúng bàn mình vẫn bị báo ngoài vùng. Đây là lỗi bị than phiền nhiều nhất khi triển khai.
> - Quá **lớn** → bán kính 5km phủ cả khu dân cư, chấm công từ nhà vẫn qua.
>
> Ràng buộc `20 ≤ radiusMeters ≤ 5000`, **khuyến nghị ≥ 100**.

`wifiBssids` là lớp xác thực vị trí **thứ hai, mạnh hơn GPS**: GPS giả được bằng app fake location trên máy root, còn BSSID là địa chỉ MAC của thiết bị phát WiFi thật — muốn giả phải ở gần đủ để bắt sóng.

```bash
curl -X POST http://localhost:3000/v1/admin/branches \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Văn phòng Hà Nội",
    "address": "Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội",
    "latitude": 21.0123, "longitude": 105.7987,
    "radiusMeters": 120,
    "wifiBssids": ["a4:2b:8c:11:9f:03", "a4:2b:8c:11:9f:04"],
    "beaconUuids": ["f7826da6-4fa2-4e98-8024-bc5b71e0893e"],
    "timezone": "Asia/Ho_Chi_Minh"
  }'
```

**Lỗi:** `PLAN_BRANCH_LIMIT_REACHED`

#### `PATCH /v1/admin/branches/:id` 🔒 📝audit — **chỉ `COMPANY_ADMIN`**
```bash
curl -X PATCH http://localhost:3000/v1/admin/branches/brc_01J... \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Văn phòng Hà Nội", "radiusMeters": 150 }'
```

---

### Phòng ban

#### `GET /v1/admin/departments` 🔒
```bash
curl http://localhost:3000/v1/admin/departments -H "Authorization: Bearer $HR_TOKEN"
```

#### `POST /v1/admin/departments` — Tạo phòng ban 🔒 📝audit

Cấu trúc **cây**, quyết định luồng duyệt đơn.

> ⚠ Bước `DIRECT_MANAGER` trong luồng duyệt phân giải qua `managerId`. Phòng ban chưa có trưởng phòng thì đơn của nhân viên phòng đó sẽ **treo không ai duyệt được** — service phải leo lên phòng ban cha để tìm người thay thế.

```bash
curl -X POST http://localhost:3000/v1/admin/departments \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Phòng Kỹ thuật", "branchId": "brc_01J...",
        "parentId": null, "managerId": "emp_05N..." }'
```

#### `PATCH /v1/admin/departments/:id` 🔒 📝audit
```bash
curl -X PATCH http://localhost:3000/v1/admin/departments/dep_01J... \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Phòng Kỹ thuật", "managerId": "emp_09Q..." }'
```

---

## 12. Web Quản lý — Tính công & Lương `/v1/admin/payroll`

**Chỉ `HR_PAYROLL` và `COMPANY_ADMIN`. Không có MANAGER ở bất kỳ endpoint nào**, kể cả endpoint chỉ đọc — bảng công tổng hợp cho thấy giờ làm, OT, ngày nghỉ của từng người, đủ để suy ra thu nhập. Trưởng phòng không có nhu cầu nghiệp vụ nào cần dữ liệu ở mức chi tiết này.

### Vòng đời một kỳ lương

```
tạo kỳ → tính công → BÁO CÁO TIỀN CHỐT → CHỐT (khoá dữ liệu) → [mở lại]
```

Bước "báo cáo tiền chốt" tồn tại để kế toán nhìn thấy vướng mắc **trước khi** khoá, thay vì phát hiện sau rồi phải mở lại — thao tác vốn đã gây lệch sổ sách.

---

### `GET /v1/admin/payroll/periods` — Danh sách kỳ lương 🔒
```bash
curl http://localhost:3000/v1/admin/payroll/periods -H "Authorization: Bearer $HR_TOKEN"
```

### `POST /v1/admin/payroll/periods` — Tạo kỳ lương 🔒 📝audit
```bash
curl -X POST http://localhost:3000/v1/admin/payroll/periods \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Tháng 08/2026", "startDate": "2026-08-01", "endDate": "2026-08-31" }'
```
**Lỗi:** `PAY_PERIOD_OVERLAP`

### `GET /v1/admin/payroll/periods/:id/summary` — Bảng công tổng hợp 🔒

**Làm gì:** kỳ **đã chốt** → đọc snapshot `PayrollSummary` (bất biến). Kỳ **đang mở** → tính trực tiếp từ `AttendanceDaily`.

```bash
curl http://localhost:3000/v1/admin/payroll/periods/pay_01J.../summary \
  -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": { "period": { "id": "pay_01J...", "name": "Tháng 08/2026", "status": "OPEN" },
            "fromSnapshot": false,
            "items": [
              { "employeeId": "emp_01J...", "employee": { "employeeCode": "NV001", "fullName": "Trần Văn A" },
                "standardDays": 21.5, "workedMinutes": 10320,
                "otMinutes": 480, "otMinutesNormal": 300, "otMinutesWeekend": 180, "otMinutesHoliday": 0,
                "lateCount": 3, "lateMinutesTotal": 47, "earlyLeaveCount": 1,
                "leaveDays": 2, "unpaidLeaveDays": 0, "absentDays": 1, "missingRecordDays": 0,
                "makeupMinutes": 120, "penaltyAmount": 150000, "violationCount": 4 } ] } }
```

> **Danh sách nằm ở `items`, không phải `rows`.** Hai nhánh (kỳ mở / kỳ chốt) đọc từ hai nguồn khác nhau nhưng được chuẩn hoá về **cùng một hình dạng**: mọi trường số là `number`, kể cả những cột lưu `Decimal` trong database (`standardDays`, `leaveDays`, `penaltyAmount`) — client không phải đoán kiểu theo trạng thái kỳ.
>
> `otMinutes` là **tổng** ba loại OT; `absentDays` và `missingRecordDays` suy từ `breakdown.statusCounts` nên đúng cho cả kỳ đã chốt.

### `POST /v1/admin/payroll/periods/:id/recalculate` — Chạy lại tính công 🔒 📝audit → `202`

**Làm gì:** job **idempotent** — chạy 2 lần cho cùng dữ liệu ra kết quả **giống hệt** (NFR-REL-06).

```bash
curl -X POST http://localhost:3000/v1/admin/payroll/periods/pay_01J.../recalculate \
  -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": { "jobId": "job_01J...", "statusUrl": "/v1/jobs/job_01J...", "queued": true,
            "periodId": "pay_01J..." } }
```

> **Theo dõi tiến độ qua `GET /v1/jobs/:id`** cho tới khi `status` là `COMPLETED` hoặc `FAILED`. Đây là điểm khác so với bản cũ: trước đây endpoint chỉ trả `{ queued: true }`, giao diện không có gì để hỏi nên chỉ báo được "đã đưa vào hàng đợi" rồi im lặng vĩnh viễn.
>
> Khi chạy với `REDIS_ENABLED=false`, job **chạy nội tuyến** trong tiến trình API thay vì bị queue giả vứt bỏ — chậm hơn và không thử lại được, nhưng kết quả có thật và tiến độ vẫn hỏi qua đúng đường trên.

**Lỗi:** `PAY_PERIOD_CLOSED`

### `GET /v1/admin/payroll/periods/:id/pre-close-report` — Báo cáo tiền chốt 🔒

**BẮT BUỘC xem trước khi chốt.** Liệt kê bản ghi thiếu, đơn còn chờ duyệt, cờ nghi vấn chưa xử lý và nhân viên có số công bất thường.

**Chốt kỳ khi còn đơn chờ duyệt là nguyên nhân khiếu nại lương phổ biến nhất.**

```bash
curl http://localhost:3000/v1/admin/payroll/periods/pay_01J.../pre-close-report \
  -H "Authorization: Bearer $HR_TOKEN"
```
```json
{ "success": true,
  "data": { "blockers": [
              { "type": "PENDING_REQUESTS", "count": 3,
                "detail": "3 đơn nghỉ phép chưa duyệt trong kỳ" },
              { "type": "UNREVIEWED_FRAUD_FLAGS", "count": 1 } ],
            "warnings": [ { "type": "ABNORMAL_HOURS", "employeeId": "emp_07P...",
                            "workedMinutes": 15600 } ],
            "canClose": false } }
```

### `POST /v1/admin/payroll/periods/:id/close` — Chốt kỳ lương 🔒 📝audit → `200`

**Thao tác KHÓ HOÀN TÁC nhất trong hệ thống.**

Snapshot bảng công vào `PayrollSummary` rồi **KHOÁ kỳ** (BR-07): không chấm công, không sửa công, không duyệt đơn vào kỳ. Đây là điều kiện cần để bảng lương đã gửi đi không âm thầm đổi số phía sau lưng.

`force: true` — chốt dù còn blocker. Đây là **cửa thoát có kiểm soát**: chặn cứng thì đến hạn trả lương mà một trưởng phòng đi vắng chưa duyệt đơn là cả công ty không nhận được lương. Lý do vào audit log và người bấm chịu trách nhiệm.

```bash
curl -X POST http://localhost:3000/v1/admin/payroll/periods/pay_01J.../close \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Chốt kỳ tháng 08/2026 theo lịch trả lương ngày 05/09",
        "force": false }'
```

**Lỗi:** `PAY_PERIOD_CLOSED`, `PAY_PERIOD_HAS_BLOCKERS`, `PAY_REASON_REQUIRED`

### `POST /v1/admin/payroll/periods/:id/reopen` — Mở lại kỳ đã chốt 🔒 📝audit → `200`

**Thao tác ĐẶC QUYỀN.** Nguy hiểm vì bảng lương có thể đã gửi cho kế toán, thậm chí đã chi tiền. Mở lại rồi tính ra con số khác nghĩa là sổ sách và thực chi lệch nhau. `reason` bắt buộc, toàn bộ vào audit log (BR-07).

```bash
curl -X POST http://localhost:3000/v1/admin/payroll/periods/pay_01J.../reopen \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Phát hiện thiếu 12 bản ghi chấm công do sự cố mạng ngày 20/08" }'
```

### `POST /v1/admin/payroll/recalculate` — Tính lại theo khoảng thời gian 🔒 📝audit → `202`

**Làm gì:** FR-ADM-OPS-04. Ngày thuộc kỳ **đã chốt** sẽ bị **BỎ QUA kèm cảnh báo**, không ghi đè (BR-07).

```bash
curl -X POST http://localhost:3000/v1/admin/payroll/recalculate \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "from": "2026-08-01", "to": "2026-08-31",
        "employeeIds": ["emp_01J...", "emp_02K..."] }'
```
`employeeIds` bỏ trống = toàn bộ nhân viên.

### `POST /v1/admin/payroll/export` — Xuất bảng công/lương 🔒 → `202`

```bash
curl -X POST http://localhost:3000/v1/admin/payroll/export \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "periodId": "pay_01J...", "format": "XLSX" }'
```
Theo dõi bằng `GET /v1/jobs/:id`.

---

## 13. Web Quản lý — Dashboard & Báo cáo `/v1/admin`

Toàn bộ là truy vấn **tổng hợp trên khoảng thời gian dài**, nên hai điểm chi phối thiết kế:

1. **Bắt buộc có khoảng thời gian.** Thiếu `from`/`to` → `SYS_VALIDATION_ERROR`. Thiếu là quét toàn bộ lịch sử chấm công của công ty — đủ sức làm chậm cả hệ thống trong giờ cao điểm.
2. **Cache Redis.** Dashboard là màn hình mở nhiều nhất; mỗi lần tải mà tính lại từ bảng thô thì database gánh không nổi.

MANAGER xem được nhưng `ScopeGuard` thu hẹp về phòng ban họ quản lý — **con số tổng trên dashboard của mỗi người là khác nhau, đúng như vậy**.

---

### `GET /v1/admin/dashboard` — Dashboard tổng quan 🔒

Cache Redis **TTL 2 phút**.

```bash
curl http://localhost:3000/v1/admin/dashboard -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/dashboard/alerts` — Cảnh báo bất thường hôm nay 🔒
```bash
curl http://localhost:3000/v1/admin/dashboard/alerts -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/reports/attendance-trend` — Biểu đồ chuyên cần 🔒
```bash
curl "http://localhost:3000/v1/admin/reports/attendance-trend?from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/reports/violations` — Nhân viên vi phạm nhiều lần 🔒

`minOccurrences` mặc định `3`.

```bash
curl "http://localhost:3000/v1/admin/reports/violations?from=2026-08-01&to=2026-08-31&minOccurrences=5" \
  -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/reports/leave-usage` — Sử dụng phép năm 🔒

`year` mặc định năm hiện tại.

```bash
curl "http://localhost:3000/v1/admin/reports/leave-usage?year=2026" \
  -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/reports/overtime` — Tổng hợp OT 🔒
```bash
curl "http://localhost:3000/v1/admin/reports/overtime?from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $HR_TOKEN"
```

---

## 14. Web Quản lý — Chống gian lận `/v1/admin/fraud`

> **Hệ thống chỉ ĐÁNH DẤU nghi vấn, không bao giờ tự huỷ công.** Mọi tín hiệu gian lận đều có tỷ lệ báo nhầm: GPS trong nhà xưởng lệch vài trăm mét, điểm khuôn mặt tụt vì đeo khẩu trang, thiết bị "root" thật ra là máy dev. Tự động cắt công dựa trên tín hiệu như vậy sẽ trừ lương oan người làm thật.

---

### `GET /v1/admin/fraud/flags` — Danh sách cờ nghi vấn 🔒

**Vai trò:** `MANAGER`, `HR_PAYROLL`, `COMPANY_ADMIN` (MANAGER chỉ thấy phòng ban mình)

| Query | Ghi chú |
|---|---|
| `severity` | `LOW` \| `MEDIUM` \| `HIGH` |
| `code` | `MOCK_LOCATION`, ... |
| `reviewed` | **chuỗi** `'true'`/`'false'`. `'false'` = chỉ cờ **chưa xử lý** — truy vấn nóng nhất của dashboard |
| `employeeId`, `departmentId` | lọc |
| `from`, `to` | khoảng ngày |

> `reviewed` để kiểu **string** chứ không phải boolean là cố ý: boolean trong query string có **ba** trạng thái (`'true'`, `'false'`, **không gửi**). Ép sang boolean thì "không gửi" và "gửi false" nhập làm một, mất khả năng phân biệt "lấy tất cả" với "chỉ lấy cờ đã xử lý".

```bash
curl "http://localhost:3000/v1/admin/fraud/flags?severity=HIGH&reviewed=false&from=2026-08-01&to=2026-08-09" \
  -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/fraud/stats` — Thống kê cờ 🔒
```bash
curl "http://localhost:3000/v1/admin/fraud/stats?from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $HR_TOKEN"
```

### `GET /v1/admin/fraud/flags/:id` — Chi tiết cờ + bằng chứng 🔒

Kèm ảnh, vị trí, thiết bị, điểm AI.

```bash
curl http://localhost:3000/v1/admin/fraud/flags/flg_01J... -H "Authorization: Bearer $HR_TOKEN"
```

### `POST /v1/admin/fraud/flags/:id/review` — Quyết định giữ / huỷ công 🔒 📝audit → `200`

**Vai trò:** `HR_PAYROLL`, `COMPANY_ADMIN` — **MANAGER XEM được cờ nhưng KHÔNG quyết được**.

Vì sao hẹp hơn ba endpoint trên: quyết định huỷ công là **cắt tiền lương**; để trưởng phòng trực tiếp làm điều đó với cấp dưới của mình là đặt họ vào thế xung đột lợi ích.

| `decision` | Hệ quả |
|---|---|
| `KEEP` | giữ công — chỉ đổi trạng thái xử lý của cờ |
| `VOID` | **huỷ công**: tạo `AttendanceAdjustment` → tính lại công → ghi audit → **THÔNG BÁO cho nhân viên kèm lý do** |
| `ESCALATE` | chuyển lên Admin hệ thống |

`VOID` đi qua đúng `attendanceAdmin.adjust()` như mọi hiệu chỉnh khác — nên nó cũng bị chặn nếu kỳ lương đã chốt. Cờ chỉ được đánh dấu "đã xử lý" **sau khi** huỷ công thành công; đảo thứ tự thì lỗi kỳ khoá sẽ để lại cờ "đã xử lý" trong khi công vẫn còn nguyên.

> **Huỷ công âm thầm là nguồn tranh chấp lao động** — `reason` được **hiển thị cho nhân viên**.

```bash
curl -X POST http://localhost:3000/v1/admin/fraud/flags/flg_01J.../review \
  -H "Authorization: Bearer $HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "decision": "VOID",
        "reason": "Xác minh camera: thời điểm chấm công nhân viên không có mặt tại văn phòng" }'
```

**Lỗi:** `SYS_NOT_FOUND`, `PAY_REASON_REQUIRED`, `ATT_PERIOD_LOCKED`

---

## 15. Web Quản lý — Audit log `/v1/admin/audit-logs`

### `GET /v1/admin/audit-logs` 🔒

**Vai trò:** `COMPANY_ADMIN`, `HR_PAYROLL`

**Chỉ có ĐỌC. Không có POST/PATCH/DELETE một cách có chủ đích** — nhật ký sửa được thì mất sạch giá trị đối chứng khi có tranh chấp lao động. Bản ghi do `AuditInterceptor` tạo tự động, không controller nào tạo tay.

`companyId` **LUÔN lấy từ JWT**, bỏ qua giá trị client gửi lên (BR-09). Nếu nhận từ query thì bất kỳ admin nào cũng chỉ cần đổi một tham số trên URL là đọc được nhật ký của công ty khác.

| Query | Ghi chú |
|---|---|
| `actorUserId` | ai thực hiện |
| `action` | `PAYROLL_REOPEN`, `EMPLOYEE_UPDATE`, ... |
| `targetType`, `targetId` | `EMPLOYEE`, `ATTENDANCE_LOG`, ... |
| `from`, `to` | khoảng ngày |

```bash
curl "http://localhost:3000/v1/admin/audit-logs?action=PAYROLL_REOPEN&from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 16. Web Admin — Quản trị nền tảng `/v1/system`

> Toàn bộ nhóm này yêu cầu **`SYSTEM_ADMIN`** và **`@SkipTenant()` ở cấp class** — đây là nơi **duy nhất** được phép nhìn xuyên qua ranh giới công ty.
>
> Đặt `@Roles` + `@SkipTenant` ở **cấp class** chứ không từng phương thức là quyết định an toàn quan trọng nhất của file: với 40+ endpoint, chỉ cần một lần quên `@Roles` là mở một endpoint xuyên tenant cho bất kỳ ai đăng nhập. Đặt ở class thì endpoint thêm sau này mặc định đã khoá.
>
> **A1:** mọi truy cập dữ liệu công ty cụ thể đều ghi audit.
> **A3:** mọi thao tác quản trị đều **bắt buộc `reason` ≥ 10 ký tự** (`ReasonDto` là lớp cơ sở, không endpoint nào lỡ quên được).

---

### Tenant

#### `GET /v1/system/tenants` — Danh sách công ty
```bash
curl "http://localhost:3000/v1/system/tenants?status=ACTIVE&page=1&pageSize=50" \
  -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `POST /v1/system/tenants` — Tạo tenant 📝audit

> ⚠ **`code` BẤT BIẾN suốt vòng đời công ty. Không có endpoint nào đổi được.**
> Mã này nằm trong mọi mã nhân viên (`ducnv.amobi`), mà mã nhân viên bị khoá sau lần chấm công đầu tiên (BR-04). Đổi mã công ty nghĩa là hoặc phải đổi mã của toàn bộ nhân viên — thứ đã tuyên bố là không đổi được — hoặc để mã cũ và mã mới tồn tại song song, không ai còn hiểu mã nào thuộc về đâu.

```bash
curl -X POST http://localhost:3000/v1/system/tenants \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Công ty AMOBI", "code": "amobi",
        "taxCode": "0101234567", "timezone": "Asia/Ho_Chi_Minh",
        "planId": "pln_pro" }'
```
**Lỗi:** `TEN_CODE_TAKEN`

#### `GET /v1/system/tenants/:id` — Chi tiết tenant

Ghi `recordCrossTenantAccess` trước khi trả dữ liệu (A1).

```bash
curl http://localhost:3000/v1/system/tenants/cmp_01J... -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `GET /v1/system/tenants/:id/usage` — Thống kê sử dụng

`from`/`to` bỏ trống = 30 ngày gần nhất.

```bash
curl "http://localhost:3000/v1/system/tenants/cmp_01J.../usage?from=2026-07-01&to=2026-08-01" \
  -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `POST /v1/system/tenants/:id/suspend` — Tạm ngưng công ty 📝audit → `200`

Nhân viên không đăng nhập/chấm công được ngay, **nhưng DỮ LIỆU GIỮ NGUYÊN** — khôi phục được khi thanh toán.

```bash
curl -X POST http://localhost:3000/v1/system/tenants/cmp_01J.../suspend \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Quá hạn thanh toán 45 ngày, đã gửi 3 lần nhắc" }'
```

#### `POST /v1/system/tenants/:id/activate` 📝audit → `200`
```bash
curl -X POST http://localhost:3000/v1/system/tenants/cmp_01J.../activate \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Khách hàng đã thanh toán đầy đủ ngày 08/08/2026" }'
```

#### `POST /v1/system/tenants/:id/plan` — Gán gói dịch vụ 📝audit → `200`
```bash
curl -X POST http://localhost:3000/v1/system/tenants/cmp_01J.../plan \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "planId": "pln_enterprise", "reason": "Nâng gói theo hợp đồng mới ký 01/08/2026" }'
```

---

### Gói dịch vụ

#### `GET /v1/system/plans`
```bash
curl http://localhost:3000/v1/system/plans -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `PUT /v1/system/plans` — Tạo/cập nhật gói 📝audit

Giới hạn gói được **enforce ở tầng Backend**, không chỉ ẩn nút ở UI (FR-ADM-TEN-04).

```bash
curl -X PUT http://localhost:3000/v1/system/plans \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pro",
    "maxEmployees": 500, "maxBranches": 10,
    "maxRecognitionsPerMonth": 100000,
    "storageGb": 200, "photoRetentionDays": 90,
    "features": { "rotatingShift": true, "ot": true, "multiBranch": true },
    "pricePerMonth": 4900000
  }'
```
`maxEmployees` bỏ trống = không giới hạn.

---

### Người dùng

#### `GET /v1/system/users` — Tìm kiếm tài khoản toàn hệ thống

> ⚠ Đây là **trường hợp DUY NHẤT** trong hệ thống mà `companyId` được nhận **từ client**. Chấp nhận được vì endpoint đã khoá cứng cho `SYSTEM_ADMIN` — người vốn đã có quyền xem mọi công ty, nên tham số này chỉ để **lọc cho gọn**, không mở thêm quyền.

```bash
curl "http://localhost:3000/v1/system/users?q=0901234567&companyId=cmp_01J..." \
  -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `GET /v1/system/users/:id/activity` — Lịch sử hoạt động của một tài khoản
```bash
curl http://localhost:3000/v1/system/users/usr_01J.../activity -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `POST /v1/system/users/:id/block` — Khoá / mở khoá tài khoản 📝audit → `200`
```bash
curl -X POST http://localhost:3000/v1/system/users/usr_01J.../block \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "blocked": true, "reason": "Phát hiện chia sẻ tài khoản cho người khác chấm công hộ" }'
```

#### `POST /v1/system/users/:id/reset-biometric` — Reset sinh trắc học 📝audit → `200`

> **Điểm tấn công NỘI BỘ nguy hiểm nhất của hệ thống** — Admin có thể reset khuôn mặt của bất kỳ ai rồi đăng ký khuôn mặt khác.
>
> Vì vậy bốn lớp chặn cùng lúc:
> 1. Bắt buộc `reason`
> 2. **XÁC NHẬN HAI BƯỚC** — `confirmEmployeeCode` phải khớp mã nhân viên của tài khoản
> 3. Ghi audit
> 4. Tự động **thông báo cho nhân viên + HR công ty**

```bash
curl -X POST http://localhost:3000/v1/system/users/usr_01J.../reset-biometric \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "resetFace": true, "resetFingerprint": true, "revokeDevices": true,
    "confirmEmployeeCode": "ducnv.amobi",
    "reason": "Nhân viên báo mất điện thoại, HR gửi yêu cầu chính thức số HR-2026-0812"
  }'
```

**Lỗi:** `SYS_VALIDATION_ERROR` (mã xác nhận không khớp), `EMP_NOT_FOUND`, `PAY_REASON_REQUIRED`

#### `POST /v1/system/users/:id/revoke-device` — Thu hồi liên kết thiết bị 📝audit → `200`
```bash
curl -X POST http://localhost:3000/v1/system/users/usr_01J.../revoke-device \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "deviceId": "A1B2C3D4-...", "reason": "Thiết bị bị mất, khách hàng yêu cầu thu hồi" }'
```

#### `POST /v1/system/users/:id/change-phone` — Đổi số điện thoại 📝audit → `200`
```bash
curl -X POST http://localhost:3000/v1/system/users/usr_01J.../change-phone \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newPhone": "0909999999", "reason": "Nhân viên đổi số, HR xác nhận qua email chính thức" }'
```
**Lỗi:** `EMP_PHONE_TAKEN`

---

### AI Server

#### `GET /v1/system/ai/metrics` — Chỉ số AI Server + thống kê nhận diện 24h
```bash
curl http://localhost:3000/v1/system/ai/metrics -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `GET /v1/system/ai/models` — Danh sách phiên bản model
```bash
curl http://localhost:3000/v1/system/ai/models -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `POST /v1/system/ai/models` — Đăng ký phiên bản model 📝audit

Chỉ triển khai model nếu **FAR/FRR không xấu đi** so với model hiện tại.

```bash
curl -X POST http://localhost:3000/v1/system/ai/models \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "buffalo_l", "version": "2.1",
    "farMeasured": 0.00008, "frrMeasured": 0.021,
    "latencyP95Ms": 340,
    "defaultMatchThreshold": 0.48, "defaultLivenessThreshold": 0.7,
    "notes": "Đo trên tập kiểm định 12.000 ảnh nội bộ"
  }'
```

#### `POST /v1/system/ai/models/:id/deploy` — Triển khai model 📝audit → `200`

> ⚠ **Đổi model làm THAY ĐỔI phân bố điểm tương đồng** — phải hiệu chỉnh lại ngưỡng **cùng lúc**, không đổi riêng lẻ.

```bash
curl -X POST http://localhost:3000/v1/system/ai/models/mdl_01J.../deploy \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Nâng cấp buffalo_l 2.1, FAR giảm 40% so với 2.0 trên tập kiểm định" }'
```

#### `POST /v1/system/ai/models/:id/rollback` 📝audit → `200`
```bash
curl -X POST http://localhost:3000/v1/system/ai/models/mdl_01J.../rollback \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "FRR thực tế cao bất thường sau 6 giờ chạy, quay lại 2.0" }'
```

---

### Cấu hình & vận hành

#### `GET /v1/system/config` — Cấu hình chung
```bash
curl http://localhost:3000/v1/system/config -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `PUT /v1/system/config` — Cập nhật cấu hình chung 📝audit
```bash
curl -X PUT http://localhost:3000/v1/system/config \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "config": { "otp.ttlSeconds": 300, "ai.timeoutMs": 2000 },
        "reason": "Tăng timeout AI do độ trễ mạng tăng ở giờ cao điểm" }'
```

#### `GET /v1/system/health` — Health check từng thành phần
```bash
curl http://localhost:3000/v1/system/health -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `GET /v1/system/queues` — Trạng thái hàng đợi
```bash
curl http://localhost:3000/v1/system/queues -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `POST /v1/system/queues/:name/retry` — Retry job lỗi 📝audit → `200`

`limit` mặc định `100`.

```bash
curl -X POST "http://localhost:3000/v1/system/queues/attendance-recalc/retry?limit=50" \
  -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `POST /v1/system/maintenance` — Bật/tắt chế độ bảo trì 📝audit → `200`

> ⚠ **TRÁNH bảo trì trong khung giờ cao điểm 07:30–09:00 và 17:00–18:30** — đúng lúc cả công ty đang chấm công.

```bash
curl -X POST http://localhost:3000/v1/system/maintenance \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "message": "Hệ thống bảo trì từ 23:00 đến 01:00. Vui lòng chấm công trước 22:45.",
    "startAt": "2026-08-15T23:00:00+07:00",
    "endAt":   "2026-08-16T01:00:00+07:00",
    "reason": "Nâng cấp PostgreSQL 16.3 và migrate partition tháng 09"
  }'
```

#### `POST /v1/system/recalculate` — Can thiệp tính lại công cho một công ty 📝audit → `202`

> **A2 — Admin KHÔNG tự ý sửa dữ liệu chấm công.** Thao tác này chỉ **TÍNH LẠI từ bản ghi thô**, không thay đổi bản ghi gốc, và luôn có audit log + `recordCrossTenantAccess`.

```bash
curl -X POST http://localhost:3000/v1/system/recalculate \
  -H "Authorization: Bearer $SYSADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "companyId": "cmp_01J...", "from": "2026-08-01", "to": "2026-08-31",
        "reason": "Sự cố worker ngày 20/08 làm 12 ngày công chưa được tổng hợp" }'
```

---

### Bảo mật & audit

#### `GET /v1/system/security/alerts` — Cảnh báo bảo mật 24h gần nhất
```bash
curl http://localhost:3000/v1/system/security/alerts -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

#### `GET /v1/system/audit-logs` — Tra cứu audit log xuyên tenant

Bảng `audit_log` là **APPEND-ONLY**, không sửa/xoá được **kể cả bởi Admin hệ thống**.

Khác `/v1/admin/audit-logs`: ở đây **không ép scope `companyId`** — admin hệ thống được tra cứu xuyên tenant, và có thể lọc bằng `?companyId=`.

```bash
curl "http://localhost:3000/v1/system/audit-logs?action=BIOMETRIC_RESET&from=2026-08-01&to=2026-08-31" \
  -H "Authorization: Bearer $SYSADMIN_TOKEN"
```

---

## 17. Bảng tra nhanh toàn bộ endpoint

**Ký hiệu:** 🔒 cần token · ✍ cần chữ ký (AF-12) · 📝 ghi audit log

### Công khai
| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/health` | Health check (ngoài prefix `/v1`) |
| GET | `/v1/time` | Giờ server |
| GET | `/v1/meta/error-codes` | Bảng mã lỗi |

### Xác thực — `/v1/auth`
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| POST | `/session` | công khai | Đổi Firebase ID token lấy phiên |
| POST | `/2fa/verify` | công khai | Bước hai đăng nhập (OTP) |
| POST | `/2fa/resend` | công khai | Gửi lại OTP |
| POST | `/password/change` | 🔒 | Đổi mật khẩu (lối ra của `mustChangePassword`) |
| POST | `/2fa/setup` | 🔒 | Bước 1 — khai SĐT, nhận OTP |
| POST | `/2fa/enable` | 🔒 | Bước 2 — bật + trả mã dự phòng |
| POST | `/2fa/disable` | 🔒 | Tắt 2FA |
| POST | `/refresh` | công khai | Làm mới phiên (token xoay vòng) |
| POST | `/logout` | 🔒 | Đăng xuất (bỏ trống = mọi phiên) |
| GET | `/me` | 🔒 | Thông tin phiên (từ JWT, không đọc DB) |
| GET | `/devices` | 🔒 | Thiết bị đã liên kết |
| POST | `/reauth/code` | 🔒 | Gửi OTP cho xác thực lại |
| POST | `/reauth/verify` | 🔒 | Lấy `reauthToken` (1 lần, 5 phút) |

### Sinh trắc học — `/v1/biometric`
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/status` | 🔒 | Trạng thái đăng ký |
| POST | `/face/enroll/start` | 🔒✍ | Mở phiên đăng ký khuôn mặt |
| POST | `/face/enroll/submit` | 🔒✍ | Nộp ảnh từng bước |
| DELETE | `/face` | 🔒✍ | Đặt lại khuôn mặt (cần `reauthToken`) |
| POST | `/fingerprint/register` | 🔒✍ | Đăng ký public key vân tay |
| DELETE | `/fingerprint` | 🔒✍ | Thu hồi khoá vân tay |
| GET | `/challenge` | 🔒 | Giờ server trước prompt sinh trắc |

### Chấm công App — `/v1/attendance`
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/challenge` | 🔒 | Nonce + liveness ngẫu nhiên + giờ server |
| POST | `/check-in` | 🔒✍ | Chấm vào (multipart) |
| POST | `/check-out` | 🔒✍ | Chấm ra (multipart) |
| GET | `/today` | 🔒 | Trạng thái hôm nay |
| GET | `/history` | 🔒 | Lịch sử theo ngày |
| GET | `/adjustments` | 🔒 | Hiệu chỉnh công của tôi |
| GET | `/:id` | 🔒 | Chi tiết một lượt |

### Cá nhân & Công ty
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/v1/me/profile` | 🔒 | Hồ sơ cá nhân |
| GET | `/v1/me/stats` | 🔒 | Thống kê cá nhân (`from`,`to` bắt buộc) |
| GET | `/v1/company/me` | 🔒 | Thông tin công ty |

### Đơn từ
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/v1/request-types` | 🔒 | Danh mục loại đơn |
| GET | `/v1/requests/reference` | 🔒 | Phép còn lại, giờ nợ/dư |
| GET | `/v1/requests/pending-approval` | 🔒 | Đơn tôi cần duyệt |
| GET | `/v1/requests` | 🔒 | Danh sách đơn |
| POST | `/v1/requests` | 🔒 | Tạo đơn |
| GET | `/v1/admin/requests/approval-preview` | MGR/HR/ADMIN | Xem trước luồng duyệt |
| POST | `/v1/admin/requests` | MGR/HR/ADMIN 📝 | Tạo đơn thay mặt nhân viên |
| GET | `/v1/requests/:id` | 🔒 | Chi tiết + lịch sử duyệt |
| PATCH | `/v1/requests/:id` | 🔒 | Sửa đơn nháp |
| POST | `/v1/requests/:id/submit` | 🔒 | Gửi đơn nháp |
| POST | `/v1/requests/:id/cancel` | 🔒 | Huỷ đơn |
| POST | `/v1/requests/:id/attachments` | 🔒 | Upload minh chứng (≤10MB) |
| POST | `/v1/requests/:id/approve` | 🔒📝 | Duyệt đơn |
| POST | `/v1/requests/:id/reject` | 🔒📝 | Từ chối (bắt buộc lý do) |
| POST | `/v1/requests/bulk-approve` | 🔒📝 | Duyệt hàng loạt |

### Thông báo
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/v1/notifications` | 🔒 | Danh sách của tôi |
| GET | `/v1/notifications/unread-count` | 🔒 | Số chưa đọc |
| POST | `/v1/notifications/:id/read` | 🔒 | Đánh dấu đã đọc |
| POST | `/v1/notifications/read-all` | 🔒 | Đọc tất cả |
| POST | `/v1/admin/notifications/broadcast` | ADMIN/HR/MGR 📝 | Gửi thông báo |

### Web Quản lý — Chấm công
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/v1/admin/attendance` | MGR/HR/ADMIN | Bảng công theo ngày |
| GET | `/v1/admin/attendance/logs` | MGR/HR/ADMIN | Lượt thô của 1 người / 1 ngày |
| GET | `/v1/admin/attendance/:id` | MGR/HR/ADMIN | Chi tiết một lượt |
| POST | `/v1/admin/attendance/adjust` | HR/ADMIN 📝 | Hiệu chỉnh công |
| POST | `/v1/admin/attendance/export` | MGR/HR/ADMIN | Xuất Excel → `202` |
| GET | `/v1/admin/attendance-sheets` | MGR/HR/ADMIN | Danh sách bảng chấm công (`FR-WEB-ATT-08`) |
| GET | `/v1/admin/attendance-sheets/:id` | MGR/HR/ADMIN | Chi tiết một bảng |
| GET | `/v1/admin/attendance-sheets/:id/board` | MGR/HR/ADMIN | Lưới người × ngày (`FR-WEB-ATT-09`) |
| POST | `/v1/admin/attendance-sheets` | MGR/HR/ADMIN 📝 | Lập bảng — lấy CBNV từ bảng phân ca cùng tháng |
| DELETE | `/v1/admin/attendance-sheets/:id` | HR/ADMIN 📝 | Xoá bảng — **không mất số liệu công** |
| POST | `/v1/admin/attendance-sheets/:id/members` | MGR/HR/ADMIN 📝 | Thêm CBNV vào bảng |
| POST | `/v1/admin/attendance-sheets/:id/members/remove` | MGR/HR/ADMIN 📝 | Bỏ CBNV khỏi bảng |
| POST | `/v1/admin/attendance-sheets/:id/recalculate` | MGR/HR/ADMIN 📝 | Cập nhật bảng công → `202` (`FR-WEB-ATT-10`) |
| POST | `/v1/admin/attendance-sheets/:id/close` | HR/ADMIN 📝 | Chốt bảng |
| POST | `/v1/admin/attendance-sheets/:id/reopen` | HR/ADMIN 📝 | Mở lại bảng đã chốt |
| GET | `/v1/jobs/:id` | MGR/HR/ADMIN | Trạng thái job export |

### Web Quản lý — Nhân sự `/v1/admin/employees`
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | MGR/HR/ADMIN | Danh sách |
| POST | `/preview-code` | HR/ADMIN | Xem trước mã nhân viên |
| POST | `/` | HR/ADMIN 📝 | Tạo hồ sơ + SMS mời |
| GET | `/:id` | MGR/HR/ADMIN | Chi tiết |
| PATCH | `/:id` | HR/ADMIN 📝 | Sửa hồ sơ |
| DELETE | `/:id` | HR/ADMIN 📝 | Xoá (chỉ `PENDING_ACTIVATION`) |
| POST | `/:id/resend-invite` | HR/ADMIN | Gửi lại SMS mời |
| POST | `/:id/suspend` | HR/ADMIN 📝 | Tạm ngưng |
| POST | `/:id/reactivate` | HR/ADMIN 📝 | Kích hoạt lại |
| POST | `/:id/terminate` | HR/ADMIN 📝 | Chấm dứt hợp đồng |
| POST | `/import/validate` | HR/ADMIN | Kiểm tra file import |
| POST | `/import/execute` | HR/ADMIN 📝 | Thực hiện import |
| GET | `/:id/history` | MGR/HR/ADMIN | Lịch sử thay đổi hồ sơ (`FR-WEB-HR-02`) |
| GET | `/:id/devices` | MGR/HR/ADMIN | Thiết bị đã liên kết (`FR-WEB-INV-06`) |
| POST | `/:id/devices/:bindingId/revoke` | HR/ADMIN 📝 | Thu hồi liên kết thiết bị |
| POST | `/:id/reset-biometric` | HR/ADMIN 📝 | Đặt lại sinh trắc học để đăng ký lại |

### Web Quản lý — Chính sách `/v1/admin`
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/policies` | MGR/HR/ADMIN | Chính sách đang hiệu lực |
| PUT | `/policies` | HR/ADMIN 📝 | Cập nhật (versioned, không ghi đè) |
| GET | `/shifts` | MGR/HR/ADMIN | Danh sách ca |
| POST | `/shifts` | HR/ADMIN 📝 | Tạo ca |
| PUT | `/shifts/:id` | HR/ADMIN 📝 | Cập nhật ca |
| DELETE | `/shifts/:id` | HR/ADMIN 📝 | Xoá ca (soft) |
| GET | `/shift-assignments` | MGR/HR/ADMIN | Bảng phân ca theo khoảng ngày (`FR-WEB-HR-03`) |
| POST | `/shift-assignments/bulk` | MGR/HR/ADMIN 📝 | Phân ca hàng loạt |
| POST | `/shift-assignments/clear` | MGR/HR/ADMIN 📝 | Xoá phân ca trong một khoảng ngày (`shiftId` = chỉ xoá một ca) |
| GET | `/shift-schedules` | MGR/HR/ADMIN | Danh sách bảng phân ca (`FR-WEB-HR-13`) |
| GET | `/shift-schedules/:id` | MGR/HR/ADMIN | Chi tiết một bảng |
| POST | `/shift-schedules` | MGR/HR/ADMIN 📝 | Lập bảng phân ca |
| PATCH | `/shift-schedules/:id` | MGR/HR/ADMIN 📝 | Sửa tên / phạm vi — **Web Quản lý không gọi** (xem docs/04 mục 8.4) |
| DELETE | `/shift-schedules/:id` | HR/ADMIN 📝 | Xoá bảng **kèm toàn bộ lịch ca của nó** |
| POST | `/shift-schedules/:id/members` | MGR/HR/ADMIN 📝 | Thêm CBNV vào bảng |
| POST | `/shift-schedules/:id/members/remove` | MGR/HR/ADMIN 📝 | Bỏ CBNV **kèm lịch ca của họ trong bảng** |
| GET | `/leave-policies` | MGR/HR/ADMIN | Chính sách phép năm (`FR-WEB-POL-07/08`) |
| PUT | `/leave-policies` | HR/ADMIN 📝 | Tạo phiên bản mới (versioned, không ghi đè) |
| GET | `/holidays` | MGR/HR/ADMIN | Danh mục ngày lễ |
| POST | `/holidays` | HR/ADMIN 📝 | Thêm/sửa ngày lễ |
| DELETE | `/holidays/:id` | HR/ADMIN 📝 | Xoá ngày lễ |
| GET | `/branches` | MGR/HR/ADMIN | Chi nhánh + geofence |
| POST | `/branches` | **ADMIN** 📝 | Tạo chi nhánh |
| PATCH | `/branches/:id` | **ADMIN** 📝 | Sửa chi nhánh |
| GET | `/departments` | MGR/HR/ADMIN | Phòng ban |
| POST | `/departments` | HR/ADMIN 📝 | Tạo phòng ban |
| PATCH | `/departments/:id` | HR/ADMIN 📝 | Sửa phòng ban |

### Web Quản lý — Tính công & Lương `/v1/admin/payroll` (HR/ADMIN, **không có MANAGER**)
| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/periods` | Danh sách kỳ lương |
| POST | `/periods` 📝 | Tạo kỳ lương |
| GET | `/periods/:id/summary` | Bảng công tổng hợp |
| POST | `/periods/:id/recalculate` 📝 | Chạy lại tính công → `202` |
| GET | `/periods/:id/pre-close-report` | **Báo cáo tiền chốt** |
| POST | `/periods/:id/close` 📝 | **Chốt kỳ (khoá dữ liệu)** |
| POST | `/periods/:id/reopen` 📝 | Mở lại kỳ đã chốt |
| POST | `/recalculate` 📝 | Tính lại theo khoảng → `202` |
| POST | `/export` | Xuất Excel → `202` |

### Web Quản lý — Công làm bù `/v1/admin/makeup` (`FR-WEB-MKUP`)

Mỗi bản ghi là MỘT khoản nợ công gắn với TỐI ĐA MỘT lần làm bù — engine tính công
cộng giờ bù vào đúng ngày `makeupWorkDate`, nên một dòng không biểu diễn được hai
ngày bù. Bù dở dang thì phần còn nợ tự tách sang dòng mới giữ nguyên ngày phát
sinh và hạn.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | MGR/HR/ADMIN | Danh sách khoản nợ + tiến độ bù |
| GET | `/summary` | MGR/HR/ADMIN | Tổng nợ / đã bù / quá hạn + quy tắc quy đổi |
| POST | `/` | HR/ADMIN 📝 | Ghi nhận một khoản nợ công |
| POST | `/:id/record` | HR/ADMIN 📝 | Ghi nhận một lần làm bù |
| POST | `/:id/extend` | HR/ADMIN 📝 | Gia hạn làm bù |
| POST | `/:id/cancel` | HR/ADMIN 📝 | Huỷ khoản ghi nhầm (chỉ khi chưa bù giờ nào) |

**Hai nguồn ghi vào sổ, phân biệt bằng cột `source`:**

| `source` | Ai sinh ra | Đường vào |
|---|---|---|
| `ENGINE` | Engine tính công | Tự động, mỗi lần tính lại một ngày thiếu giờ |
| `MANUAL` | HR nhập tay | `POST /v1/admin/makeup` |

> ⚠ **Engine chỉ được sửa/xoá dòng của chính nó.** `calculateAndPersist` là hàm idempotent bị gọi lại rất nhiều lần cho cùng một ngày (mỗi lần hiệu chỉnh công, mỗi lần duyệt đơn ngược quá khứ, mỗi đêm khi cron quét), và mỗi lần nó **đối chiếu** để tổng nợ `ENGINE` của ngày khớp số giờ thực thiếu — chứ không ghi thêm. Bỏ điều kiện `source` thì một lần tính lại sẽ xoá mất khoản nợ HR nhập tay theo thoả thuận riêng.
>
> Ngày **không** sinh nợ: ngày lễ, cuối tuần, và ngày không có giờ làm nào (vắng mặt / thiếu bản ghi) — vắng mặt là nghỉ không lương, không phải nợ công. Ngưỡng tối thiểu là `makeup.minDebtMinutes` (mặc định 15 phút).

**Đơn xin làm bù được duyệt** (`deductFrom = MAKEUP_CREDIT`) cũng ghi vào sổ này, trả **khoản nợ cũ nhất trước**. Đơn khai nhiều giờ hơn số nợ thật bị từ chối ngay lúc duyệt với `MKUP_EXCEEDS_DEBT` — phần dôi ra là tăng ca, hệ số lương khác hẳn.

### Web Quản lý — Loại đơn & luồng duyệt `/v1/admin/request-types` (`FR-WEB-REQ-05`)

**Không có MANAGER**, kể cả quyền đọc: duyệt đơn là việc của quản lý, còn quyết
định "đơn trên 3 ngày có cần HR duyệt không" là chính sách công ty.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | HR/ADMIN | Danh mục loại đơn kèm luồng duyệt và số đơn đã phát sinh |
| POST | `/` | HR/ADMIN 📝 | Tạo loại đơn |
| PATCH | `/:id` | HR/ADMIN 📝 | Sửa loại đơn (mã khoá sau khi có đơn phát sinh) |
| PUT | `/:id/approval-flow` | HR/ADMIN 📝 | Thay toàn bộ luồng duyệt |

#### `deductFrom` và `isPaidLeave` là HAI trường khác nhau

| Trường | Trả lời câu hỏi | Ảnh hưởng tới |
|---|---|---|
| `deductFrom` | Đơn này trừ vào **quỹ** nào (`NONE` / `ANNUAL_LEAVE` / `UNPAID` / `OT_CREDIT` / `MAKEUP_CREDIT`) | Số dư phép năm, sổ công bù |
| `isPaidLeave` | Ngày nghỉ đó có vào **bảng công** không | `standardDays` của `attendance_daily` → bảng lương |

Không suy trường này từ trường kia. `deductFrom = 'NONE'` đang gộp **Công tác**
(đủ công) với **Xin ra ngoài** / **Về sớm** (không phải một ngày công), nên suy
diễn sẽ sai ở một trong hai. Xem công thức tính công ở docs/04 mục 7.3.

Mặc định `isPaidLeave = false`: loại đơn khai thiếu thì không tự dưng được trả lương.

### Web Quản lý — Báo cáo & Gian lận & Audit
| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/v1/admin/dashboard` | MGR/HR/ADMIN | Dashboard (cache 2 phút) |
| GET | `/v1/admin/dashboard/alerts` | MGR/HR/ADMIN | Cảnh báo hôm nay |
| GET | `/v1/admin/reports/attendance-trend` | MGR/HR/ADMIN | Chuyên cần theo ngày |
| GET | `/v1/admin/reports/violations` | MGR/HR/ADMIN | Vi phạm nhiều lần |
| GET | `/v1/admin/reports/leave-usage` | MGR/HR/ADMIN | Sử dụng phép năm |
| GET | `/v1/admin/reports/overtime` | MGR/HR/ADMIN | Tổng hợp OT |
| GET | `/v1/admin/fraud/flags` | MGR/HR/ADMIN | Danh sách cờ nghi vấn |
| GET | `/v1/admin/fraud/stats` | MGR/HR/ADMIN | Thống kê cờ |
| GET | `/v1/admin/fraud/flags/:id` | MGR/HR/ADMIN | Chi tiết + bằng chứng |
| POST | `/v1/admin/fraud/flags/:id/review` | **HR/ADMIN** 📝 | Giữ / huỷ công |
| GET | `/v1/admin/audit-logs` | ADMIN/HR | Audit log của công ty |

### Web Admin `/v1/system` (toàn bộ: `SYSTEM_ADMIN`)
| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/tenants` | Danh sách tenant |
| POST | `/tenants` 📝 | Tạo tenant (`code` bất biến) |
| GET | `/tenants/:id` | Chi tiết (ghi cross-tenant access) |
| GET | `/tenants/:id/usage` | Thống kê sử dụng |
| POST | `/tenants/:id/suspend` 📝 | Tạm ngưng công ty |
| POST | `/tenants/:id/activate` 📝 | Kích hoạt lại |
| POST | `/tenants/:id/plan` 📝 | Gán gói dịch vụ |
| GET | `/plans` | Danh sách gói |
| PUT | `/plans` 📝 | Tạo/cập nhật gói |
| GET | `/users` | Tìm tài khoản toàn hệ thống |
| GET | `/users/:id/activity` | Lịch sử hoạt động |
| POST | `/users/:id/block` 📝 | Khoá / mở khoá |
| POST | `/users/:id/reset-biometric` 📝 | **Reset sinh trắc (xác nhận 2 bước)** |
| POST | `/users/:id/revoke-device` 📝 | Thu hồi thiết bị |
| POST | `/users/:id/change-phone` 📝 | Đổi số điện thoại |
| GET | `/ai/metrics` | Chỉ số AI Server |
| GET | `/ai/models` | Danh sách model |
| POST | `/ai/models` 📝 | Đăng ký model + FAR/FRR |
| POST | `/ai/models/:id/deploy` 📝 | Triển khai model |
| POST | `/ai/models/:id/rollback` 📝 | Rollback model |
| GET | `/config` | Cấu hình chung |
| PUT | `/config` 📝 | Cập nhật cấu hình |
| GET | `/health` | Health check chi tiết |
| GET | `/queues` | Trạng thái hàng đợi |
| POST | `/queues/:name/retry` 📝 | Retry job lỗi |
| POST | `/maintenance` 📝 | Bật/tắt bảo trì |
| POST | `/recalculate` 📝 | Can thiệp tính lại công → `202` |
| GET | `/security/alerts` | Cảnh báo bảo mật 24h |
| GET | `/audit-logs` | Audit log xuyên tenant |

---

## Phụ lục A — Kịch bản gọi API đầu-cuối

### A.1 Nhân viên mới: từ nhận SMS tới chấm công lần đầu

```bash
BASE=http://localhost:3000/v1

# 1. Đăng nhập Firebase ở client (Flutter SDK) → idToken
#    signInWithEmailAndPassword("duc@amobi.vn", "<mật khẩu tạm trong SMS>")

# 2. Đổi lấy phiên Backend
RES=$(curl -s -X POST $BASE/auth/session -H "Content-Type: application/json" -d '{
  "domain":"amobi.vn","firebaseIdToken":"'"$ID_TOKEN"'",
  "deviceId":"'"$DEVICE_ID"'","deviceInfo":{"model":"iPhone 14","os":"iOS"}}')
# → nextStep = "CHANGE_PASSWORD", kèm deviceSecret (LƯU NGAY vào keystore)
TOKEN=$(echo $RES | jq -r .data.accessToken)

# 3. Firebase reauthenticateWithCredential() → idToken mới, rồi đổi mật khẩu
curl -X POST $BASE/auth/password/change -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firebaseIdToken":"'"$FRESH_ID_TOKEN"'","newPassword":"mat-khau-that-cua-toi"}'
# → cấp phiên mới, nextStep = "SETUP_BIOMETRIC"

# 4. Đăng ký khuôn mặt (lần đầu — KHÔNG cần reauthToken)
curl -X POST $BASE/biometric/face/enroll/start -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'
# → sessionId + 4 bước

for i in 1 2 3 4; do
  curl -X POST $BASE/biometric/face/enroll/submit -H "Authorization: Bearer $TOKEN" \
    -F "sessionId=$SESSION_ID" -F "order=$i" -F "image=@goc_$i.jpg"
done

# 5. Đăng ký vân tay (secure enclave sinh cặp khoá, gửi PUBLIC key)
curl -X POST $BASE/biometric/fingerprint/register -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"'"$DEVICE_ID"'","publicKey":"-----BEGIN PUBLIC KEY-----\n...","algorithm":"ES256"}'

# 6. Kiểm tra đủ điều kiện vào Home
curl $BASE/biometric/status -H "Authorization: Bearer $TOKEN"   # satisfiesMinimum = true

# 7. Chấm công lần đầu
curl $BASE/attendance/challenge -H "Authorization: Bearer $TOKEN"  # → nonce, livenessAction
curl -X POST $BASE/attendance/check-in -H "Authorization: Bearer $TOKEN" \
  -H "X-Signature: $SIG" -H "X-Nonce: $NONCE" -H "X-Timestamp: $TS" -H "X-Body-Sha256: $H" \
  -F "nonce=$SERVER_NONCE" -F "clientTime=$(date -Iseconds)" -F "authMethod=FACE" \
  -F 'location={"latitude":21.012345,"longitude":105.798765,"accuracy":8.2}' \
  -F 'deviceContext={"deviceId":"'"$DEVICE_ID"'","isRooted":false}' \
  -F "image=@selfie.jpg"
```

### A.2 HR xử lý một tháng công

```bash
BASE=http://localhost:3000/v1
H="Authorization: Bearer $HR_TOKEN"

# 1. Rà bảng công, tìm ngày thiếu bản ghi
curl -H "$H" "$BASE/admin/attendance?from=2026-08-01&to=2026-08-31&status=MISSING"

# 2. Hiệu chỉnh các ngày thiếu (tạo bản ghi điều chỉnh, KHÔNG sửa bản gốc)
curl -X POST $BASE/admin/attendance/adjust -H "$H" -H "Content-Type: application/json" -d '{
  "employeeId":"emp_01J...","workDate":"2026-08-02","adjustType":"ADD",
  "afterValue":{"recordedAt":"2026-08-02T01:00:00Z","type":"CHECK_IN"},
  "reason":"Nhân viên quên chấm vào do điện thoại hết pin, trưởng phòng xác nhận"}'

# 3. Duyệt nốt đơn còn treo
curl -H "$H" "$BASE/requests?status=PENDING&from=2026-08-01&to=2026-08-31"
curl -X POST $BASE/requests/bulk-approve -H "$H" -H "Content-Type: application/json" \
  -d '{"requestIds":["req_a","req_b"],"comment":"Duyệt lô cuối kỳ"}'

# 4. Xử lý cờ nghi vấn chưa review
curl -H "$H" "$BASE/admin/fraud/flags?reviewed=false&from=2026-08-01&to=2026-08-31"
curl -X POST $BASE/admin/fraud/flags/flg_01J.../review -H "$H" -H "Content-Type: application/json" \
  -d '{"decision":"KEEP","reason":"GPS lệch do nhà xưởng có mái tôn, đã xác minh qua WiFi BSSID"}'

# 5. Tính lại toàn kỳ
curl -X POST $BASE/admin/payroll/periods/pay_01J.../recalculate -H "$H"

# 6. XEM BÁO CÁO TIỀN CHỐT (bắt buộc)
curl -H "$H" $BASE/admin/payroll/periods/pay_01J.../pre-close-report

# 7. Chốt kỳ
curl -X POST $BASE/admin/payroll/periods/pay_01J.../close -H "$H" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Chốt kỳ tháng 08/2026 theo lịch trả lương ngày 05/09","force":false}'

# 8. Xuất Excel
JOB=$(curl -s -X POST $BASE/admin/payroll/export -H "$H" -H "Content-Type: application/json" \
      -d '{"periodId":"pay_01J...","format":"XLSX"}' | jq -r .data.jobId)
curl -H "$H" $BASE/jobs/$JOB     # → downloadUrl khi status = COMPLETED
```

---

## Phụ lục B — Sai lầm thường gặp khi tích hợp

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Mọi request có ảnh đều `400` | `location`/`deviceContext` gửi dạng object trong multipart | `JSON.stringify()` trước khi gán vào form field |
| `FRAUD_CLOCK_SKEW` liên tục | `X-Timestamp` gửi mili-giây | Phải là **epoch giây** |
| `FRAUD_REPLAY_DETECTED` khi retry | Dùng lại `X-Nonce` cũ | Sinh nonce mới mỗi lần gửi, kể cả khi retry |
| `ATT_INVALID_NONCE` | Nhầm nonce chấm công với `X-Nonce` của chữ ký | Nonce trong body lấy từ `GET /attendance/challenge`; `X-Nonce` là nonce riêng của chữ ký |
| Ngày trong lịch sử lệch 1 ngày | Tự parse `workDate` thành `Date` rồi format theo local | `workDate` đã là chuỗi `YYYY-MM-DD`, dùng thẳng |
| Đơn nghỉ cả ngày thành nghỉ từ 07:00 | `startAt` thiếu offset múi giờ | Luôn gửi `2026-08-10T00:00:00+07:00` |
| `?mineOnly=false` vẫn lọc như `true` | (đã xử lý bằng `@Transform` ở server) | — |
| Bộ lọc query không có tác dụng, không báo lỗi | Field không khai trong DTO bị `ValidationPipe` (`whitelist: true`) **loại bỏ im lặng** | Kiểm tra tên tham số khớp DTO |
| `GET /attendance/today` trả 404 | Route `:id` khai trước route tĩnh | (đã xử lý — `@Get(':id')` là route GET cuối cùng) |
| `data.data` lồng hai lớp | Controller tự bọc `{ success, data }` | Trả dữ liệu trần, `TransformInterceptor` tự bọc |
| Chấm công được từ nhà | `radiusMeters` đặt quá lớn hoặc thiếu `wifiBssids` | Giảm bán kính, bật xác thực WiFi lớp 2 (AF-02) |
| Cả công ty không chấm công được | `trust proxy` sai → `request.ip` là IP của Nginx | Khai đúng `TRUSTED_PROXY_HOPS` |
| Lịch phân ca sai hoàn toàn | Nhầm `weekdayMask` (bitmask) với `weekdays` (số thứ tự) | `31` = T2–T6 dạng bitmask; `[1,2,3,4,5]` = T2–T6 dạng số thứ tự |

---

## Tài liệu liên quan

- [08-hop-dong-api.md](./08-hop-dong-api.md) — hợp đồng API thiết kế (bao gồm cả Backend ↔ AI Server)
- [12-luong-cham-cong-chi-tiet.md](./12-luong-cham-cong-chi-tiet.md) — payload thật ở từng chặng của một lượt chấm công
- [13-luong-onboarding-va-dang-ky-khuon-mat.md](./13-luong-onboarding-va-dang-ky-khuon-mat.md) — luồng onboarding
- [06-anti-fraud.md](./06-anti-fraud.md) — chi tiết 23 biện pháp `AF-01`–`AF-23`
- [07-mo-hinh-du-lieu.md](./07-mo-hinh-du-lieu.md) · [14-so-do-quan-he-bang-du-lieu.md](./14-so-do-quan-he-bang-du-lieu.md) — mô hình dữ liệu
