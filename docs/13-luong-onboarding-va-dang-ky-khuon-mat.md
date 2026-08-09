# 13 — Từ lúc được cấp tài khoản tới lúc chấm công được

> Thuật lại **đúng những gì code đang chạy**. Mọi payload đối chiếu từ DTO thật.
>
> Liên quan: [03 — Nghiệp vụ App](./03-nghiep-vu-app-nhan-vien.md) ·
> [08 — Hợp đồng API](./08-hop-dong-api.md) ·
> [12 — Một lượt chấm công đi qua những đâu](./12-luong-cham-cong-chi-tiet.md) ·
> [AiServer/README.md](../AiServer/README.md)

Tài liệu `12` mô tả luồng **chấm công hằng ngày** — luồng đó giả định nhân viên
đã có hồ sơ khuôn mặt trong cơ sở dữ liệu. Tài liệu này mô tả luồng chạy **trước
đó một lần duy nhất**: từ lúc nhân viên được cấp tài khoản tới lúc hồ sơ khuôn
mặt nằm trong `face_profile` và người đó chấm công được.

---

## Mục lục

1. [Toàn cảnh](#1-toàn-cảnh)
2. [Bước 1 — Đăng nhập bằng OTP](#2-bước-1--đăng-nhập-bằng-otp)
3. [Bước 2 — Tham gia công ty](#3-bước-2--tham-gia-công-ty-bằng-mã-mời)
4. [Bước 3 — Mở phiên đăng ký khuôn mặt](#4-bước-3--mở-phiên-đăng-ký-khuôn-mặt)
5. [Bước 4 — Gửi từng ảnh](#5-bước-4--gửi-từng-ảnh-lặp-4-lần)
6. [Bước 5 — Hoàn tất và ghi DB](#6-bước-5--hoàn-tất-và-ghi-cơ-sở-dữ-liệu)
7. [Đăng ký lại — nơi từng có lỗ hổng](#7-đăng-ký-lại--nơi-từng-có-lỗ-hổng)
8. [Bảng lỗi và cách App xử lý](#8-bảng-lỗi-và-cách-app-xử-lý)
9. [Vân tay — luồng thay thế](#9-vân-tay--luồng-thay-thế)

---

## 1. Toàn cảnh

```
┌─ HR LÀM TRƯỚC ─────────────────────────────────────────────────────┐
│  Tạo hồ sơ nhân viên trên Web Quản lý                              │
│    └→ hệ thống cấp luôn tài khoản: email + MẬT KHẨU TẠM             │
│    └→ HR đọc lại cho nhân viên (hiển thị MỘT LẦN)                   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ MỘT LẦN DUY NHẤT, LÚC ONBOARDING ─────────────────────────────────┐
│                                                                     │
│  ⓪ Firebase SDK: signInWithEmailAndPassword(email, mật khẩu tạm)   │
│     └→ nhận Firebase ID token                                       │
│                                                                     │
│  ① POST /auth/session     tên miền + firebaseIdToken               │
│     └→ nextStep: CHANGE_PASSWORD                                    │
│     └→ token bị CHẶN ở mọi API khác cho tới khi đổi mật khẩu         │
│                                                                     │
│  ② POST /auth/password/change  → nextStep: SETUP_BIOMETRIC         │
│                                                                     │
│  ③ POST /biometric/face/enroll/start   → nhận 4 bước cần chụp      │
│  ④ POST /biometric/face/enroll/submit  ×4 lần                      │
│     └→ mỗi lần: Backend → AI Server → embedding tạm vào Redis       │
│  ⑤ Lần thứ 4: kiểm trùng danh tính → ghi DB → ACTIVE               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ HẰNG NGÀY ────────────────────────────────────────────────────────┐
│  GET /attendance/challenge → POST /attendance/check-in             │
│  (xem tài liệu 12)                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

> **Xác thực 2 lớp là tuỳ chọn.** Người dùng tự bật trong phần cá nhân, dùng
> **OTP gửi qua SMS**. Đã bật thì bước ① trả `nextStep: TWO_FACTOR` kèm
> `twoFactorToken` và tự gửi mã tới số đã đăng ký; phải qua `POST /auth/2fa/verify`
> mới có token đăng nhập.
>
> Mật khẩu do **Firebase Authentication** giữ — Backend không bao giờ nhận mật
> khẩu. Bước ② vì vậy cần một Firebase ID token vừa làm mới thay cho trường
> `currentPassword`; xem [08 mục 2](./08-hop-dong-api.md#2-api-xác-thực-auth).
>
> Không còn đăng nhập bằng OTP SMS, không còn mã mời, không còn TOTP.

### Bức tranh dữ liệu

```
      APP                BACKEND              AI SERVER          POSTGRES
       │                    │                     │                  │
       │  4 ảnh, từng cái   │                     │                  │
       ├───────────────────►│  ảnh (base64)       │                  │
       │                    ├────────────────────►│                  │
       │                    │◄────────────────────┤                  │
       │                    │  embedding 512 số   │                  │
       │                    │                     │                  │
       │                    │ ─ Redis (tạm, 5') ─ │                  │
       │                    │                     │                  │
       │  ...sau ảnh thứ 4  │                     │                  │
       │                    │ kiểm trùng (BR-10)  │                  │
       │                    ├─────────────────────┼─────────────────►│
       │◄───────────────────┤   4 dòng face_profile + employee ACTIVE│
       │  completed: true   │                     │                  │
```

Điểm cần nắm: **embedding của 3 ảnh đầu không vào cơ sở dữ liệu ngay**. Chúng
nằm tạm trong Redis 5 phút. Chỉ khi đủ cả 4 ảnh mới ghi một lượt vào DB. Bỏ dở
giữa chừng thì không để lại hồ sơ nửa vời — Redis tự dọn.

---

## 2. Bước 1 — Đăng nhập với Firebase rồi đổi lấy phiên

Hai lượt gọi, không phải một. Mật khẩu chỉ đi tới Firebase; Backend chỉ nhận ID
token.

```ts
// ⓪ Client — Firebase SDK
const cred = await signInWithEmailAndPassword(auth, 'duc@amobi.vn', '<mật khẩu tạm HR đọc cho>');
const firebaseIdToken = await cred.user.getIdToken();
```

```jsonc
// ① Backend
POST /v1/auth/session
{
  "domain": "amobi.vn",              // ← tên miền công ty cấp
  "firebaseIdToken": "eyJ...",
  "deviceId": "a3f9c2e1-...",        // App bắt buộc; Web quản lý không cần
  "deviceInfo": { "model": "iPhone 14", "os": "iOS" }
}
```

Trả về:

```jsonc
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "deviceSecret": "base64...",        // ← chỉ trả MỘT LẦN, App lưu vào secure enclave
  "nextStep": "CHANGE_PASSWORD",      // ← App điều hướng theo trường này
  "user": {
    "id": "usr_...", "fullName": "Nguyễn Văn Đức",
    "email": "duc@amobi.vn", "phone": "0901234567",
    "twoFactorEnabled": false
  },
  "employee": {
    "id": "emp_...", "employeeCode": "ducnv.amobi",
    "companyId": "cmp_1", "status": "PENDING_ACTIVATION", "roles": ["EMPLOYEE"]
  }
}
```

### Lỗi sai mật khẩu giờ đến từ Firebase, không phải Backend

Bước ⓪ hỏng thì client nhận mã lỗi thẳng từ Firebase SDK
(`auth/wrong-password`, `auth/user-not-found`, `auth/too-many-requests`) và tự
hiển thị — không có lượt gọi nào tới Backend. Việc khoá tạm sau nhiều lần sai
cũng do Firebase làm; Backend không còn cột `failedLoginCount`/`lockedUntil`.

Bước ① chỉ còn hai loại lỗi thuộc về Backend:

- `AUTH_DOMAIN_MISMATCH` — tên miền không khớp công ty của tài khoản. **Tên miền
  không tồn tại cũng trả đúng mã này**, để gõ bừa không dò ra được tên miền nào
  có thật.
- `AUTH_ACCOUNT_NOT_PROVISIONED` — uid hợp lệ nhưng chưa có hồ sơ trong hệ thống,
  tức ai đó tự đăng ký thẳng qua Firebase SDK. Tài khoản chỉ do HR cấp.

> ⚠ Đây là điểm **bắt buộc** phải kiểm ở bước ①: Firebase chỉ xác nhận danh tính,
> nó không biết gì về ranh giới công ty. Bỏ chốt tên miền thì nhân viên công ty A
> gõ tên miền của công ty B vẫn vào được.

### `nextStep` — Backend quyết định điều hướng, không phải App

App **không tự suy luận** phải đi màn hình nào:

```
đã bật 2FA?                    → TWO_FACTOR       (chưa cấp token)
mật khẩu tạm chưa đổi?         → CHANGE_PASSWORD
là quản trị viên nền tảng?     → HOME
đã có face HOẶC fingerprint?   → HOME
                   ngược lại   → SETUP_BIOMETRIC
```

Để App tự suy luận nghĩa là logic `BR-03` bị nhân bản ở cả ba client (App
Android, App iOS, Web) và sớm muộn sẽ lệch nhau.

Hai chi tiết về thứ tự:

**Đổi mật khẩu đứng TRƯỚC đăng ký sinh trắc học.** Cho đăng ký khuôn mặt khi vẫn
đang dùng mật khẩu tạm nghĩa là ai cầm tờ giấy ghi mật khẩu đó đều đăng ký được
khuôn mặt của mình.

**Điều kiện sinh trắc học là face HOẶC fingerprint**, không phải cả hai. `BR-03`
chỉ yêu cầu tối thiểu một phương thức.

### Quản trị viên nền tảng đăng nhập thế nào

Họ không thuộc công ty nào nên không có tên miền thật. Dành riêng một tên miền
quy ước, mặc định `system`, đặt được qua biến môi trường `SYSTEM_ADMIN_DOMAIN`.

Không tách thành endpoint riêng: một endpoint đăng nhập duy nhất thì chỉ có một
chỗ để làm đúng việc chống dò tài khoản và đếm số lần sai.

`createTenant` **từ chối** cấp tên miền này cho công ty — trùng thì công ty đó
vĩnh viễn không đăng nhập được.

---

## 3. Bước 2 — Đổi mật khẩu tạm

Backend không giữ mật khẩu nên không đối chiếu được `currentPassword`. Client cho
người dùng gõ lại mật khẩu tạm qua Firebase, rồi gửi lên ID token vừa làm mới:
`auth_time` trong token là bằng chứng việc gõ lại vừa xảy ra.

```ts
await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, mậtKhẩuTạm));
const firebaseIdToken = await user.getIdToken(true);
```

```jsonc
POST /v1/auth/password/change
{ "firebaseIdToken": "eyJ...", "newPassword": "..." }
```

Token cũ hơn `FIREBASE_FRESH_AUTH_WINDOW_SECONDS` (mặc định 300 giây) bị từ chối
với `AUTH_REAUTH_STALE`. Firebase ID token sống một giờ, nên chỉ kiểm token hợp
lệ là chưa đủ: máy đang mở sẵn phiên vẫn lấy được token hợp lệ mà không cần biết
mật khẩu.

### Cưỡng chế ở SERVER, không phải điều hướng ở App

Token cấp ra ở bước ① mang cờ `mustChangePassword`, và `PasswordChangeGuard`
chặn **mọi** API khác ngoài ba endpoint: đổi mật khẩu, xem phiên hiện tại, đăng
xuất.

Trả `nextStep: "CHANGE_PASSWORD"` rồi tin App sẽ chuyển màn hình là để ngỏ: ai
gọi thẳng API bằng token vừa nhận vẫn dùng được toàn hệ thống với mật khẩu tạm —
mà mật khẩu đó đi qua nhiều tay: HR đọc qua điện thoại, ghi ra giấy, có khi gửi
qua tin nhắn.

Cờ nằm trong **token** chứ không chỉ trong response, và `POST /auth/refresh`
**không** xoá cờ — nếu không thì chỉ cần gọi refresh một lần là thoát được màn
hình đổi mật khẩu.

### Chính sách mật khẩu

| Quy tắc | Giá trị |
|---|---|
| Độ dài tối thiểu | 12 ký tự |
| Chỉ gồm chữ số | phải từ 16 ký tự |
| Tối đa | 128 ký tự |
| Không được | trùng mật khẩu hiện tại, chứa phần đầu email, nằm trong danh sách phổ biến |

**Không có quy tắc "phải có chữ hoa, số và ký tự đặc biệt".** Quy tắc kiểu đó
đẩy người dùng tới đúng một khuôn `Matkhau@123` — thoả mọi điều kiện mà nằm đầu
mọi danh sách dò. NIST SP 800-63B đã bỏ khuyến nghị này từ lâu. `caidenhoihaidongsau`
(19 ký tự, toàn chữ thường) mạnh hơn hẳn và dễ nhớ hơn nhiều.

Đổi xong, Backend **thu hồi toàn bộ phiên khác** rồi cấp phiên mới. Nếu mật khẩu
đã lộ và kẻ tấn công đang có phiên mở, đổi mật khẩu mà không thu hồi thì phiên
của hắn vẫn sống.

### `PENDING_ACTIVATION` nghĩa là gì

| | `PENDING_ACTIVATION` | `ACTIVE` |
|---|---|---|
| Đăng nhập được | Có | Có |
| Xem thông tin cá nhân | Có | Có |
| **Chấm công** | **Không** | Có |
| Gửi đơn từ | Không | Có |

Nhân viên ở trạng thái này **chưa chấm công được** vì chưa có phương thức xác
thực nào. Đây là chốt `BR-03`.

`employeeCode` sinh từ họ tên theo `docs/01` mục 8: *"Nguyễn Văn Đức"* +
công ty *amobi* → `ducnv.amobi`. Trùng thì thêm số: `ducnv2.amobi`. Mã này
**bất biến sau lần chấm công đầu tiên** (`BR-04`).

---

## 4. Bước 3 — Mở phiên đăng ký khuôn mặt

```jsonc
POST /v1/biometric/face/enroll/start
{ }                                    // ← lần đầu: body rỗng
```

Trả về
([biometric.service.ts:88-140](../BackEnd/src/modules/biometric/biometric.service.ts#L88-L140)):

```jsonc
{
  "sessionId": "enr_01J8X...",
  "expiresIn": 300,
  "isReEnrollment": false,
  "steps": [
    { "order": 1, "angle": "FRONT", "action": null },
    { "order": 2, "angle": "LEFT",  "action": "TURN_LEFT" },
    { "order": 3, "angle": "RIGHT", "action": "TURN_RIGHT" },
    { "order": 4, "angle": "FRONT", "action": "BLINK" }      // ← NGẪU NHIÊN (AF-05)
  ],
  "guidance": { "minFacePixels": 112, "maxFileSizeKb": 800 }
}
```

### Vì sao chụp 4 góc mà không phải 1

Mỗi góc cho một embedding riêng. Lúc chấm công, AI Server so ảnh mới với **cả
4** rồi lấy điểm cao nhất. Người dùng nghiêng đầu một chút vẫn có góc khớp.

Chỉ đăng ký một góc thẳng thì người hơi cúi mặt hoặc đứng lệch camera sẽ bị từ
chối liên tục — và cách người dùng phản ứng với việc bị từ chối liên tục là bỏ
qua hệ thống, nhờ đồng nghiệp chấm hộ.

### Vì sao bước 4 có hành động ngẫu nhiên

Ba bước đầu có hành động cố định vì mục đích là **lấy đủ góc chụp**, không phải
kiểm tra người thật. Bước 4 mới là bước chống giả mạo: server chọn ngẫu nhiên
trong 5 hành động (`BLINK`, `TURN_LEFT`, `TURN_RIGHT`, `SMILE`, `NOD`).

Nếu để App chọn, kẻ gian patch app cho luôn chọn hành động đã quay sẵn video.

### `guidance.minFacePixels` lấy từ chính sách công ty

Không hard-code. App dùng số này để hiển thị khung ngắm và cảnh báo "hãy lại gần
hơn" **trước khi** người dùng bấm chụp, thay vì để họ chụp xong mới báo lỗi.

---

## 5. Bước 4 — Gửi từng ảnh (lặp 4 lần)

```
POST /v1/biometric/face/enroll/submit
Content-Type: multipart/form-data
X-Signature / X-Nonce / X-Timestamp / X-Body-Sha256    ← bắt buộc khi AF-12 đã bật

sessionId = enr_01J8X...
order     = 1
image     = <JPEG ~400KB>
```

> `X-Body-Sha256` ràng buộc nội dung ảnh vào chữ ký. Ảnh đăng ký là thứ quyết
> định danh tính về sau — tráo được ảnh ở đây thì tráo được cả hồ sơ chấm công.
> Công thức: [08 mục 1.2.1](./08-hop-dong-api.md#121-x-body-sha256--ràng-buộc-nội-dung-của-request-multipart).

Backend xử lý
([biometric.service.ts:146-240](../BackEnd/src/modules/biometric/biometric.service.ts#L146-L240)):

```
1. Lấy phiên từ Redis theo sessionId
     └─ không có / hết hạn / sai người  →  FACE_ENROLL_SESSION_INVALID
2. Tra bước `order` trong phiên → biết góc và hành động liveness cần kiểm
3. → GỌI AI SERVER  POST /v1/enroll
4. AI trả số liệu → BACKEND TỰ SO NGƯỠNG
5. Lưu ảnh gốc lên S3
6. Nhét embedding vào phiên Redis (CHƯA vào DB)
7. Còn bước → trả nextOrder.  Hết bước → sang mục 6 dưới đây.
```

### Backend gọi AI Server

```jsonc
POST http://ai-server:8000/v1/enroll
X-Internal-Key: <khoá nội bộ>

{
  "image_base64": "/9j/4AAQ...",
  "require_liveness": true,        // ← chỉ true ở bước có action
  "liveness_action": "TURN_LEFT"
}
```

AI Server trả:

```jsonc
{
  "face_found": true,
  "quality": { "blur": 142.3, "brightness": 128, "yaw": -22.4, "face_px": 218 },
  "liveness": { "score": 0.91, "action_verified": true },
  "embedding": [0.0123, -0.0456, ...],    // ← 512 số, đã L2-normalize
  "model_version": "buffalo_l@2.1",
  "processing_ms": 187
}
```

Khác `/v1/verify` ở đúng một chỗ: **có `embedding`, không có `match`**. Lúc đăng
ký chưa có gì để so khớp cả.

### Backend tự so ngưỡng

Giống hệt nguyên tắc ở luồng chấm công (`P3`) — AI Server không biết ngưỡng:

```ts
if (result.quality.face_px < minFacePixels)      → FACE_TOO_SMALL
if (livenessScore < livenessThreshold)           → FACE_LIVENESS_FAILED
if (result.liveness?.action_verified === false)  → FACE_LIVENESS_FAILED
if (!result.embedding?.length)                   → FACE_NOT_FOUND
```

### Embedding nằm tạm trong Redis

Đây là lựa chọn có chủ đích. Ba lý do:

**Không để lại hồ sơ nửa vời.** Người dùng chụp 2 ảnh rồi bỏ dở, hoặc mất mạng
giữa chừng. Nếu ghi DB từng ảnh thì hồ sơ có 2 góc — chấm công sẽ chập chờn mà
không ai biết vì sao.

**Kiểm trùng danh tính chỉ chạy một lần.** `BR-10` phải so với toàn bộ nhân viên
trong công ty. Chạy 4 lần là lãng phí 4 lần.

**Đổi ý thì không mất gì.** Redis tự xoá sau 5 phút.

### ⚠ Đánh đổi chưa xử lý xong: embedding chạm đĩa

Redis hiện chạy `--appendonly yes` với volume `redis-data`
([docker-compose.yml:24-31](../BackEnd/docker-compose.yml#L24-L31)). Nghĩa là
embedding trong phiên đăng ký **được ghi vào file AOF trên đĩa**, và nằm lại đó
tới lần rewrite AOF kế tiếp — lâu hơn nhiều so với TTL 5 phút của phiên.

Embedding không khôi phục lại được ảnh khuôn mặt, nhưng nó **định danh được một
con người cụ thể**, nên vẫn là dữ liệu sinh trắc học theo Nghị định 13/2023/NĐ-CP.

Ba hướng xử lý, chưa chốt:

| Hướng | Ưu | Nhược |
|---|---|---|
| Tách phiên đăng ký sang Redis instance riêng, tắt AOF | Sạch nhất | Thêm một service phải vận hành |
| Mã hoá embedding trước khi đưa vào Redis | Không đổi hạ tầng | Phải quản lý khoá |
| Chấp nhận, mã hoá toàn bộ volume ở tầng đĩa | Đơn giản | Không chống được người có quyền đọc volume |

Việc này **chưa làm**. Ghi lại đây để đưa vào hồ sơ pháp lý về xử lý dữ liệu
sinh trắc học (`docs/10` mục 10).

### Phản hồi giữa chừng

```jsonc
// Còn bước tiếp theo
{ "accepted": true, "nextOrder": 2, "quality": { "blur": 142.3, "brightness": 128 } }
```

`quality` trả về để App hiển thị phản hồi tức thì cho người dùng — *"ảnh hơi
mờ, thử lại nhé"* — trước khi họ chụp bước kế tiếp.

---

## 6. Bước 5 — Hoàn tất và ghi cơ sở dữ liệu

Sau ảnh thứ 4, Backend làm ba việc **theo đúng thứ tự này**:

### 6.1. Kiểm trùng danh tính (`BR-10`)

> Một khuôn mặt chỉ được đăng ký cho **duy nhất một** nhân viên trong công ty.

```ts
const others = await prisma.faceProfile.findMany({
  where: {
    companyId,                        // ← chỉ trong CÙNG công ty (ADR-05)
    status: ACTIVE,
    employeeId: { not: employeeId },  // ← trừ chính mình ra
  },
});
// so cosine với từng cái, lấy điểm cao nhất
if (bestScore >= duplicateThreshold) → chặn + cảnh báo
```

Chặn kịch bản: Đức đã đăng ký khuôn mặt, rồi Đức mượn tài khoản của Nam để đăng
ký **chính khuôn mặt mình** vào hồ sơ Nam. Từ đó Đức chấm công cho cả hai.

Trượt chốt này thì Backend trả `FACE_DUPLICATE_IDENTITY` (409) **và** phát thông
báo `IDENTITY_DUPLICATE_ALERT` cho HR — chặn thôi chưa đủ, phải có người biết là
vừa có người thử.

Hai điểm về phạm vi so sánh:

- **Chỉ trong cùng `companyId`.** Cùng một người làm ở hai công ty khác nhau
  trên nền tảng là hoàn toàn hợp lệ.
- **Loại chính mình ra.** Không loại thì đăng ký lại sẽ luôn trùng với hồ sơ cũ
  của chính mình.

### 6.2. Ghi DB trong một transaction

```sql
-- 1. Hồ sơ cũ (nếu có) → REPLACED, KHÔNG xoá, giữ dấu vết
UPDATE face_profile SET status='REPLACED', revoked_at=now()
WHERE employee_id=? AND status='ACTIVE';

-- 2. Ghi 4 hồ sơ mới
INSERT INTO face_profile (company_id, employee_id, embedding_raw, embedding_dim,
                          model_version, quality_score, photo_key, angle, status)
VALUES (...), (...), (...), (...);

-- 3. BR-03: đã có phương thức xác thực → mở khoá chấm công
UPDATE employee SET status='ACTIVE'
WHERE id=? AND status='PENDING_ACTIVATION';
```

Cả ba trong **một** transaction. Nếu tách ra, một lỗi giữa chừng có thể để lại
nhân viên `ACTIVE` mà không có hồ sơ khuôn mặt nào — chấm công sẽ luôn trả
`FACE_NOT_ENROLLED` và không ai hiểu vì sao.

Chú ý bước 3 dùng `WHERE ... AND status='PENDING_ACTIVATION'`. Nhân viên đang bị
đình chỉ (`SUSPENDED`) đăng ký lại khuôn mặt **không** được tự động mở khoá.

### 6.3. Phản hồi

```jsonc
{
  "accepted": true,
  "completed": true,
  "profileCount": 4,
  "modelVersion": "buffalo_l@2.1",
  "isReEnrollment": false
}
```

App gọi `GET /biometric/status` để xác nhận rồi vào Home. Từ giờ nhân viên chấm
công được — luồng đó ở [tài liệu 12](./12-luong-cham-cong-chi-tiet.md).

---

## 7. Đăng ký lại — nơi từng có lỗ hổng

### Kịch bản tấn công

```
1. Kẻ tấn công cầm được điện thoại đang đăng nhập của nạn nhân
2. Gọi POST /biometric/face/enroll/start
3. Chụp 4 tấm ảnh CỦA CHÍNH MÌNH
4. Hồ sơ nạn nhân → REPLACED.  Hồ sơ kẻ tấn công → ACTIVE
5. Từ đó chấm công thay nạn nhân, vĩnh viễn
```

Chốt xác thực lại ban đầu chỉ đặt ở `DELETE /biometric/face`. Nhưng **kẻ tấn
công không cần gọi DELETE** — chính đường đăng ký đã ghi đè sẵn rồi.

### Cách chặn hiện tại

Phân biệt hai trường hợp ngay ở bước mở phiên:

| Trường hợp | Điều kiện | Yêu cầu |
|---|---|---|
| **Đăng ký lần đầu** | Chưa có hồ sơ `ACTIVE` nào | Đi thẳng |
| **Đăng ký đè** | Đã có hồ sơ `ACTIVE` | **Bắt buộc `reauthToken`** |

```jsonc
POST /v1/biometric/face/enroll/start
{ "reauthToken": "..." }        // lấy từ POST /auth/reauth/verify (OTP), TTL 5 phút

// Thiếu token mà đã có hồ sơ → 401
{ "success": false, "error": { "code": "AUTH_REAUTH_REQUIRED", ... } }
```

Vì sao **lần đầu không đòi xác thực lại**: lúc đó người dùng chưa có phương thức
sinh trắc học nào để xác thực. Đòi hỏi ở đây là khoá cửa rồi vứt chìa khoá vào
trong.

Vì sao chặn ở **bước mở phiên** chứ không phải bước submit:

- Người dùng không mất công chụp xong 4 ảnh mới bị từ chối.
- Kẻ tấn công không dò được nạn nhân đã đăng ký khuôn mặt hay chưa qua việc
  quan sát bước nào bị chặn.

Ngoài ra khi đăng ký đè hoàn tất, Backend **thông báo cho HR** và ghi audit với
action riêng `BIOMETRIC_FACE_REENROLL`. Đăng ký lần đầu thì không báo — báo mỗi
lần onboarding chỉ tạo nhiễu khiến HR bỏ qua cảnh báo thật.

Bộ test canh giữ chốt này:
[biometric.service.spec.ts](../BackEnd/src/modules/biometric/biometric.service.spec.ts).

### Ba đường dẫn tới việc thay hồ sơ khuôn mặt

| Đường | Ai làm | Yêu cầu | Báo HR |
|---|---|---|---|
| `POST /face/enroll/start` lần đầu | Nhân viên | Không | Không |
| `POST /face/enroll/start` đè | Nhân viên | `reauthToken` | **Có** |
| `DELETE /biometric/face` | Nhân viên | `reauthToken` + lý do | **Có** |
| Admin/HR reset hộ | HR | Quyền + lý do | **Có** + báo cả nhân viên |

---

## 8. Bảng lỗi và cách App xử lý

| Mã | HTTP | Nghĩa | App nên làm gì |
|---|:--:|---|---|
| `AUTH_REAUTH_REQUIRED` | 401 | Đã có hồ sơ, cần OTP | Mở màn hình xác thực lại |
| `FACE_ENROLL_SESSION_INVALID` | 400 | Phiên hết hạn / sai người | Gọi lại `start` |
| `FACE_NOT_FOUND` | 422 | Không thấy mặt trong ảnh | "Đưa mặt vào khung ngắm" |
| `FACE_MULTIPLE` | 422 | Nhiều hơn một người | "Chỉ một người trong khung hình" |
| `FACE_LOW_LIGHT` | 422 | Quá tối | "Tìm chỗ sáng hơn" |
| `FACE_BACKLIT` | 422 | Ngược sáng | "Đừng đứng quay lưng vào cửa sổ" |
| `FACE_BLURRY` | 422 | Ảnh nhoè | "Giữ máy vững hơn" |
| `FACE_TOO_SMALL` | 422 | Mặt nhỏ hơn ngưỡng | "Đưa máy lại gần hơn" |
| `FACE_MASK_DETECTED` | 422 | Đeo khẩu trang | "Bỏ khẩu trang" |
| `FACE_LIVENESS_FAILED` | 422 | Không xác nhận được người thật | "Làm đúng động tác được yêu cầu" |
| `FACE_DUPLICATE_IDENTITY` | 409 | Khuôn mặt đã thuộc người khác | **Liên hệ HR** — không cho thử lại |
| `SYS_AI_UNAVAILABLE` | 503 | AI Server không phản hồi | "Thử lại sau, hoặc đăng ký vân tay" |

Nội dung thông báo lấy từ `GET /v1/meta/error-codes` chứ **không hard-code trong
App** — sửa câu chữ không cần phát hành bản App mới.

`FACE_DUPLICATE_IDENTITY` là mã duy nhất trong bảng mà App **không nên** mời thử
lại. Thử lại không giải quyết được gì và chỉ tạo thêm cảnh báo giả cho HR.

---

## 9. Vân tay — luồng thay thế

`BR-03` chỉ đòi **tối thiểu một** phương thức. Nhân viên có thể bỏ qua khuôn mặt
và đăng ký vân tay.

```jsonc
POST /v1/biometric/fingerprint/register
X-Signature / X-Nonce / X-Timestamp        // ← bắt buộc khi AF-12 đã bật

{
  "deviceId": "a3f9c2e1-...",              // ← PHẢI trùng deviceId trong token
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMFkwEw...\n-----END PUBLIC KEY-----",
  "algorithm": "ES256",
  "attestation": { "platform": "android", "token": "..." },
  "reauthToken": "..."                     // ← chỉ cần khi deviceId khác token
}
```

Một lượt gọi duy nhất, **không đụng tới AI Server**, không có ảnh nào.

### `deviceId` phải trùng thiết bị trong token

Kịch bản bị chặn:

```
1. Kẻ tấn công lấy được access token của nạn nhân
   (từ log, bản sao lưu máy, proxy — KHÔNG cần cầm điện thoại)
   Token gắn với thiết bị D1 của nạn nhân.

2. Gọi POST /biometric/fingerprint/register
     { deviceId: "D2-máy-của-hắn", publicKey: "khoá-của-hắn" }

3. Từ đó chấm công bằng vân tay từ máy mình, thay nạn nhân.
```

Đăng ký khoá cho một thiết bị mà mình **đang không đứng trên đó** không có kịch
bản hợp lệ nào — App luôn đăng ký cho chính máy nó đang chạy. Vì vậy lệch
`deviceId` thì bắt buộc `reauthToken`.

Chốt này **không gây phiền cho người dùng thật**: đổi điện thoại thì phải đăng
nhập lại trên máy mới, token mới mang `deviceId` mới, hai bên khớp nhau.

> ⚠ **Mã hoá payload token KHÔNG chặn được kịch bản trên.** Kẻ tấn công không
> cần *đọc* token, hắn chỉ *gửi lại* nguyên xi — server tự giải mã và thấy phiên
> hợp lệ. Mã hoá giải quyết bài toán đọc; đây là bài toán dùng.
>
> Thứ chặn được là chữ ký HMAC (`AF-12`): request phải ký bằng `deviceSecret`,
> thứ nằm trong secure enclave và **không** đi kèm token. Endpoint này đã gắn
> `@RequireSignature()`.

Thay khoá trên thiết bị **đã có khoá** thì vẫn cho, nhưng **báo HR** và ghi audit
`BIOMETRIC_FINGERPRINT_REPLACE`. Không phân biệt được từ phía server giữa "người
dùng đăng ký lại vân tay ở tầng hệ điều hành" (bình thường) và "ai đó cầm được
máy rồi thêm vân tay của mình" — nên phải để có người xem.

App sinh cặp khoá trong secure enclave và gửi lên **public key**. Private key
không rời khỏi con chip, và chỉ dùng được sau khi OS xác thực vân tay thành
công. Server không bao giờ thấy dữ liệu vân tay — vì Apple và Google không cho
phép bất kỳ app nào đọc nó. Chi tiết ở
[docs/11](./11-cach-hoat-dong-cham-cong-mat-va-van-tay.md).

Hoàn tất cũng chuyển `PENDING_ACTIVATION` → `ACTIVE` giống luồng khuôn mặt.

### So sánh hai luồng onboarding

| | Khuôn mặt | Vân tay |
|---|---|---|
| Số lượt gọi API | 1 + 4 | 1 |
| Gọi AI Server | 4 lần | Không |
| Ảnh gửi lên | 4 | 0 |
| Server lưu gì | 4 embedding + 4 ảnh trên S3 | 1 public key |
| Kiểm trùng danh tính | Có (`BR-10`) | **Không áp dụng** |
| Dùng được trên máy khác | Có | **Không** — khoá gắn với thiết bị |

Dòng cuối là khác biệt đáng chú ý nhất trong vận hành: nhân viên đổi điện thoại
thì hồ sơ khuôn mặt vẫn dùng được, còn vân tay phải đăng ký lại trên máy mới.

Vì vậy nếu công ty chỉ cho đăng ký vân tay, mỗi lần nhân viên đổi máy là một lần
gọi HR. Nên khuyến khích đăng ký **cả hai**: khuôn mặt làm phương thức chính,
vân tay làm phương án dự phòng khi AI Server gặp sự cố.
