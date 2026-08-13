# SmartFace — Backend Core

API nghiệp vụ dùng chung cho **App Nhân viên** (Flutter), **Web Quản lý** và **Web Admin** (React).

Thi công theo bộ tài liệu trong [`../docs`](../docs). Mọi lệch pha giữa code và tài liệu
phải được ghi nhận bằng một ADR mới.

| Thành phần | Công nghệ | Nguồn quyết định |
|---|---|---|
| Framework | NestJS 10 + TypeScript | `ADR-02` |
| ORM | Prisma 5 | `ADR-04` |
| Database | PostgreSQL 16 | `docs/02` mục 4 |
| Cache / OTP / nonce | Redis 7 | `docs/02` mục 4 |
| Hàng đợi | BullMQ | `docs/02` mục 10 |
| Lưu trữ ảnh | S3 / MinIO | `NFR-SEC-01`, `NFR-SEC-12` |
| Realtime | Socket.IO | `docs/08` mục 9 |
| API docs | OpenAPI 3 (tự sinh) | `NFR-MAINT-04` |

---

## 1. Chạy nhanh

### Cách A — Docker Compose (đủ hạ tầng, không cần cài gì thêm)

```bash
cd BackEnd
cp .env.example .env
docker compose up -d postgres redis minio minio-init

# Firebase Auth Emulator — bắt buộc, xem mục 0 bên dưới
npx firebase emulators:start --only auth &
export FIREBASE_PROJECT_ID=demo-smartface
export FIREBASE_AUTH_EMULATOR_HOST=localhost:9099

npm install
npx prisma migrate dev --name init
npm run db:guards          # rule bất biến + CHECK + index bổ sung
npm run seed
npm run start:dev
```

### Cách B — hạ tầng có sẵn

```bash
cp .env.example .env       # sửa DATABASE_URL, REDIS_HOST, S3_*, FIREBASE_*
                           # chưa dựng được Redis? đặt REDIS_ENABLED=false (xem mục 7)
npm install
npx prisma migrate deploy
npm run db:guards
npm run seed
npm run start:dev
```

### Bước 0 — Firebase Authentication (bắt buộc)

Danh tính do Firebase quản lý; Backend **không lưu mật khẩu**. Thiếu cấu hình
Firebase thì ứng dụng **cố tình chết lúc khởi động** thay vì chạy với một lớp xác
thực rỗng.

**Môi trường phát triển — dùng Auth Emulator, không đụng dự án thật:**

```bash
npm install -g firebase-tools     # hoặc npx firebase-tools
firebase emulators:start --only auth
```

rồi trong `.env`:

```ini
FIREBASE_PROJECT_ID=demo-smartface
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
```

**Môi trường thật:**

1. [Firebase Console](https://console.firebase.google.com) → tạo project.
2. **Authentication → Sign-in method** → bật **Email/Password**.
3. **⚙ Project settings → Service accounts → Generate new private key** → tải tệp JSON.
4. Điền `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` từ tệp đó
   (khoá riêng để trên MỘT dòng, giữ nguyên `\n`, bọc trong nháy kép).

> ⚠ `FIREBASE_AUTH_EMULATOR_HOST` **không được** đặt ở production: emulator không
> kiểm chữ ký ID token, ai cũng tự dựng được token hợp lệ. `validateEnv` chặn
> ngay lúc khởi động.

> **Không cần bật Phone Authentication.** Xác thực 2 lớp dùng OTP do Backend sinh
> và gửi qua `SMS_PROVIDER` — xem mục 6.

> `db:guards` chạy **cả hai** tệp trong `prisma/sql/` qua `prisma db execute`,
> không cần cài `psql`. Bỏ qua bước này thì `attendance_log` và `audit_log`
> **sửa/xoá được** — mất toàn bộ đảm bảo của `BR-06`/`BR-08`.

### Khi DB user không có quyền `CREATE DATABASE`

`prisma migrate dev` cần dựng shadow database để so sánh schema. Trên PostgreSQL
dùng chung, tài khoản cấp cho ứng dụng thường không có quyền đó và lệnh dừng với
`P3014`. Sinh migration không cần shadow DB:

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_init
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<thư-mục-vừa-tạo>/migration.sql
npx prisma migrate deploy
```

> Trên PowerShell, `Out-File` và `>` thêm BOM vào đầu tệp và Prisma sẽ báo lỗi cú
> pháp ở câu lệnh đầu tiên. Ghi bằng
> `[System.IO.File]::WriteAllText($f, $text, (New-Object System.Text.UTF8Encoding($false)))`.

Sau khi chạy:

- API: `http://localhost:3000/v1`
- Swagger: `http://localhost:3000/v1/docs`
- Health: `http://localhost:3000/health`
- Bảng mã lỗi: `http://localhost:3000/v1/meta/error-codes`

### Tài khoản seed sẵn

Đăng nhập hai bước: đăng nhập với Firebase bằng `{ email, password }`, rồi gọi
`POST /v1/auth/session` với `{ domain, firebaseIdToken }`.

Seed tạo tài khoản ở **cả hai nơi** (Firebase và `user_account`), nên phải chạy
với `FIREBASE_PROJECT_ID` đã đặt — thường là emulator ở bước 0.

**Mật khẩu chung cho mọi tài khoản seed: `SmartFaceDev2026`**

| Vai trò | Tên miền | Email |
|---|---|---|
| Admin nền tảng | `system` | `admin@smartface.vn` |
| Admin công ty + Kế toán | `amobi.vn` | `an@amobi.vn` (Phạm Thị An) |
| HR | `amobi.vn` | `hoa@amobi.vn` (Lê Thị Hoa) |
| Quản lý phòng Kỹ thuật | `amobi.vn` | `binh@amobi.vn` (Trần Văn Bình) |
| Nhân viên | `amobi.vn` | `duc@amobi.vn` (Nguyễn Văn Đức) |

Tài khoản seed đặt `mustChangePassword: false` để đỡ phải đổi mật khẩu mỗi lần
reset cơ sở dữ liệu. Tài khoản do HR cấp qua API thì **luôn** bắt đổi.

> ⚠ Seed chỉ dành cho môi trường phát triển — mật khẩu ở trên nằm công khai
> trong mã nguồn.

---

## 2. Cấu trúc thư mục

```
BackEnd/
├── prisma/
│   ├── schema.prisma              # Mô hình dữ liệu (docs/07)
│   ├── seed.ts                    # Dữ liệu khởi tạo (docs/07 mục 4.5)
│   └── sql/
│       ├── 01_immutability_and_rls.sql   # BR-06, BR-08, RLS (ADR-05)
│       └── 02_partitioning.sql           # Partition attendance_log theo tháng (D7)
└── src/
    ├── main.ts                    # Entry point API
    ├── worker.ts                  # Entry point worker (pod riêng)
    ├── app.module.ts              # Lắp guard/filter/interceptor toàn cục
    ├── config/                    # Đọc + validate biến môi trường
    ├── common/
    │   ├── errors/                # ⭐ BẢNG MÃ LỖI TẬP TRUNG
    │   ├── guards/                # JwtAuth · Tenant · Roles · Scope · Signature · RateLimit
    │   ├── interceptors/          # Transform (bọc response) · Audit (BR-08)
    │   ├── filters/               # Chuẩn hoá mọi lỗi về một hình dạng
    │   ├── decorators/            # @Roles @Audit @CurrentTenant @RequireSignature…
    │   ├── dto/                   # Phân trang, response chuẩn
    │   └── utils/                 # employee-code · geo · time (timezone) · crypto
    ├── infra/
    │   ├── prisma/                # PrismaService singleton + BaseRepository + TransactionManager
    │   ├── redis/                 # OTP, nonce, rate limit, cache
    │   ├── storage/               # S3 + presigned URL
    │   ├── queue/                 # BullMQ + 7 processor + scheduler + JobsRepository
    │   └── logger/                # pino, có traceId, che dữ liệu nhạy cảm
    └── modules/
        ├── auth/          # Đổi Firebase ID token lấy phiên, OTP 2 lớp, JWT, refresh rotation, device binding
        ├── tenant/        # Company, tên miền, gói dịch vụ
        ├── employee/      # Hồ sơ, vòng đời, import Excel theo dòng
        ├── biometric/     # Đăng ký mặt đa góc, vân tay (public key)
        ├── attendance/    # ⭐ Chấm công + hiệu chỉnh + export
        ├── fraud/         # Fraud scoring, dashboard cảnh báo, xử lý cờ
        ├── request/       # Đơn từ, workflow duyệt nhiều cấp
        ├── policy/        # ⭐ Toàn bộ ngưỡng cấu hình được (BR-12)
        ├── payroll/       # ⭐ Engine tính công + kỳ lương
        ├── report/        # Dashboard, báo cáo
        ├── notification/  # Push, SMS, realtime
        ├── audit/         # Audit trail append-only
        ├── ai-gateway/    # Client AI Server + circuit breaker
        ├── admin/         # Web Admin (/system/*)
        └── health/        # Health check, giờ server, bảng mã lỗi
```

### Quy ước bắt buộc trong mỗi module

```
Controller  →  chỉ nhận request, validate DTO, gọi Service. KHÔNG chứa business logic.
Service     →  toàn bộ nghiệp vụ. KHÔNG import PrismaService.
Repository  →  NƠI DUY NHẤT chạm Prisma. LUÔN nhận companyId làm tham số đầu tiên,
               bắt buộc, không có giá trị mặc định.
DTO         →  validate bằng class-validator. Không dùng `any`.
```

Mỗi module có đúng một file `<tên>.repository.ts` kế thừa `BaseRepository`
([src/infra/prisma/base.repository.ts](src/infra/prisma/base.repository.ts)).

**Vì sao gom nhiều bảng vào một repository thay vì một repository mỗi bảng.**
Ranh giới là AGGREGATE nghiệp vụ, không phải bảng. `RequestRepository` giữ cả
`leave_request`, `approval_step`, `leave_balance` vì không có thao tác nào chạm
bảng sau mà không đi từ bảng đầu. Tách ra bảy repository chỉ khiến mọi transaction
phải nối tay qua bảy đối tượng.

**Transaction.** Service KHÔNG mở transaction bằng `PrismaService.$transaction`
— dùng `TransactionManager`
([src/infra/prisma/transaction.manager.ts](src/infra/prisma/transaction.manager.ts)).
Mọi phương thức ghi của Repository nhận `tx?: Prisma.TransactionClient` ở tham số
cuối, nên Service ghép nhiều lời gọi vào một transaction mà không cần biết Prisma:

```ts
await this.transactions.run(async (tx) => {
  await this.requests.updateStatus(companyId, id, { status: 'REJECTED' }, tx);
  await this.requests.skipPendingSteps(companyId, id, tx);
});
```

`runForTenant(companyId, …)` là biến thể đặt sẵn `app.company_id` cho Row-Level
Security — lớp phòng thủ thứ hai của `ADR-05` khi RLS được bật.

**`updateMany` thay cho `update`.** Repository sửa bản ghi bằng
`updateMany({ where: { id, companyId } })` rồi đọc lại, thay vì
`update({ where: { id } })`. Lý do: `where` của `update` chỉ nhận khoá duy nhất
nên không nhét được `companyId` vào, và một id đoán đúng sẽ sửa được dữ liệu của
công ty khác (`BR-09`).

**Ba ngoại lệ có chủ đích, không được nhân thêm:**

| Repository | Không nhận `companyId` vì | Bù lại bằng |
|---|---|---|
| `AuthRepository` | chạy TRƯỚC khi biết người gọi thuộc công ty nào — chính nó trả lời câu hỏi đó | ràng buộc `firebaseUid` + `domain` trong `AuthService.createSession` |
| `AdminRepository` | đối tượng là NỀN TẢNG, không phải một công ty | `@Roles(SYSTEM_ADMIN)` + `recordCrossTenantAccess` (A1) |
| `JobsRepository` | job nền quét toàn bộ tenant, không có ngữ cảnh người gọi | chỉ khai trong `WorkerModule`, không controller nào với tới; phương thức xuyên tenant mang tiền tố `acrossTenants…` |

---

## 3. Những quy tắc KHÔNG được vi phạm

Đây là phần quan trọng nhất của tài liệu này. Vi phạm một trong các mục dưới đây
là lỗi nghiêm trọng, không phải chuyện phong cách code.

### `BR-02` / `AF-10` — Backend không tin cờ xác thực từ client

Payload chấm công **tuyệt đối không có** `faceVerified`, `biometricOk`, `livenessPassed`.
App gửi **bằng chứng thô** (ảnh, hoặc chữ ký challenge từ secure enclave); Backend tự
gọi AI Server kiểm chứng rồi tự so ngưỡng.

Nếu Backend tin `faceVerified: true` thì **mọi biện pháp chống gian lận khác trở nên
vô nghĩa** — chỉ cần một lệnh `curl` là chấm công được.

`ValidationPipe` chạy với `whitelist: true` nên field lạ bị strip tự động — đúng ý đồ này.

### `BR-01` / `AF-17` — Giờ server là chuẩn duy nhất

`AttendanceLog.recordedAt` = thời điểm Backend nhận request, **không bao giờ** nhận từ client.
`clientReportedAt` chỉ để đối chiếu phát hiện chỉnh giờ (`AF-18`).

App lấy giờ hiển thị từ `GET /v1/time` hoặc `serverTime` trong response, không dùng
`DateTime.now()` của máy cho bất cứ thứ gì liên quan tới chấm công.

### `BR-06` / `ADR-08` — Bản ghi thô là bất biến

`AttendanceLog` **không bao giờ** UPDATE hay DELETE. Hiệu chỉnh tạo `AttendanceAdjustment`
riêng trỏ về bản ghi gốc. Rule ở tầng DB chặn cứng (`prisma/sql/01_...`).

`AttendanceDaily` là kết quả tính, xoá được vì chạy lại job là có.

### `BR-09` / `ADR-05` — Cách ly tenant

`companyId` **luôn** lấy từ JWT qua `@CurrentTenant()`, **không bao giờ** từ body/query.
Đây là rủi ro nghiêm trọng nhất của mô hình SaaS: một query thiếu `companyId` = rò rỉ
dữ liệu chéo khách hàng.

Trước go-live phải bật Row-Level Security (phần comment trong `01_immutability_and_rls.sql`)
và viết integration test quét toàn bộ endpoint (`NFR-SEC-05`).

### `BR-12` — Không hard-code ngưỡng

Mọi ngưỡng đi qua `PolicyService`. Danh mục khoá ở `modules/policy/policy.constants.ts`.
Thêm ngưỡng mới = thêm khoá ở đó, không viết số vào service.

### `BR-07` — Kỳ lương đã chốt bị khoá

Không chấm công, không sửa công, không duyệt đơn vào kỳ đã chốt. Job tính công gặp
ngày thuộc kỳ đã chốt thì **bỏ qua và ghi cảnh báo**, không ghi đè.

### `NFR-REL-06` — Engine tính công phải idempotent

Chạy lại nhiều lần cho cùng `(employee, date)` phải ra kết quả **giống hệt**.
Đơn nghỉ duyệt muộn và sửa cấu hình ca đều kích hoạt tính lại.

---

## 4. Luồng chấm công — thứ tự kiểm tra

Đây là endpoint quan trọng nhất hệ thống. Thứ tự này **không được đổi** (`docs/02` mục 8.2):

```
1. JWT hợp lệ + X-Device-Id khớp token       → JwtAuthGuard        → 401
2. Chữ ký HMAC + X-Body-Sha256                → SignatureGuard      → 401
3. Rate limit (10 lần/giờ theo account+device)→ RateLimitGuard      → 429
4. Nonce chưa dùng (Redis SET NX)             → AttendanceService   → 409
5. Lệch giờ client vs server                  → AttendanceService   → cờ AF-18
6. is_mock == false, accuracy trong ngưỡng    → AttendanceService   → 403
7. Kiểm tra geofence với toạ độ server nhận
8. BSSID WiFi khớp chi nhánh      (AF-02)     → AttendanceService   → 403
9. IP nguồn nằm trong dải văn phòng (AF-02b)  → AttendanceService   → 403
   ↑ Hai chốt này đặt TRƯỚC lời gọi AI: so chuỗi/so bit trong bộ nhớ,
     rẻ hơn suy luận GPU hàng nghìn lần. Kiểm sau là đốt GPU cho
     request chắc chắn bị từ chối.
10. GỌI AI SERVER kiểm chứng khuôn mặt        → AiGatewayService    → 422
    (Backend TỰ so ngưỡng — AI Server không biết ngưỡng là bao nhiêu)
11. Tính fraud score, gắn cờ
12. Ghi AttendanceLog với SERVER TIMESTAMP
13. Đẩy job tính công vào queue
```

### Hai chốt mạng — bắt buộc cấu hình trước khi deploy

Cả hai mặc định `BLOCK`. **Thiếu cấu hình = cả công ty không chấm công được.**

| Chốt | Cấu hình ở | Nguồn dữ liệu | Sửa app có qua được? |
|---|---|---|---|
| `AF-02` BSSID | `Branch.wifiBssids` | App tự khai | **Có** |
| `AF-02b` IP | `Branch.allowedIpCidrs` + `TRUSTED_PROXY_HOPS` | **Server tự quan sát** | Không |

Hai chốt bổ trợ nhau: người cắm VPN về văn phòng qua được chốt IP nhưng không
qua được chốt BSSID; app bị sửa qua được chốt BSSID nhưng không qua được chốt IP.

> ⚠ **`TRUSTED_PROXY_HOPS` là cấu hình dễ làm sai nhất.** Khai thiếu →
> `request.ip` là IP của Nginx, cả công ty bị chặn. Khai thừa → ai cũng gửi
> `X-Forwarded-For: <IP văn phòng>` là qua, chốt mất sạch tác dụng mà log vẫn
> hiển thị đúng IP văn phòng. Production từ chối khởi động nếu chưa khai.
>
> Sau khi deploy, **kiểm `request.ip` trong audit log**: phải là IP của nhân
> viên, không phải IP của Nginx.

Triển khai dần: đặt cả hai về `FLAG` trước, xem báo cáo cờ vài ngày để biết chi
nhánh nào cấu hình sai, rồi mới chuyển `BLOCK`.

### Ba lớp quyết định của fraud scoring

| Điểm | Xử lý |
|---|---|
| 0–29 | Chấp nhận bình thường |
| 30–59 | Chấp nhận nhưng **gắn cờ**, hiện trên dashboard |
| 60–79 | **Chờ duyệt** — công không tính tới khi kế toán xác nhận |
| ≥ 80 | **Từ chối**, cảnh báo Admin ngay |

> Nguyên tắc: **ưu tiên gắn cờ để con người xem xét hơn là chặn cứng**. Chặn nhầm một
> nhân viên thật gây bức xúc lớn và tạo gánh nặng hỗ trợ.

---

## 5. Hợp đồng API cho Frontend

### Định dạng phản hồi

Thành công:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 156, "totalPages": 8 } }
```

Lỗi:

```json
{
  "success": false,
  "error": {
    "code": "FACE_LIVENESS_FAILED",
    "message": "Không xác nhận được người thật. Vui lòng nhìn thẳng vào camera và thử lại.",
    "messageEn": "Liveness check failed. Please look directly at the camera and try again.",
    "hint": "Đảm bảo đủ ánh sáng và không dùng ảnh/video",
    "retryable": true,
    "details": { "livenessScore": 0.42, "threshold": 0.7 },
    "traceId": "01J8XK2M9P4R7T"
  }
}
```

### Bảng mã lỗi — nguồn duy nhất

```
GET /v1/meta/error-codes
```

App/Web **import bảng này** rồi ánh xạ sang i18n của mình. Không hard-code chuỗi
tiếng Việt rải rác trong Flutter/React (`docs/03` mục 3.3).

### Header chuẩn

| Header | Bắt buộc | Ghi chú |
|---|---|---|
| `Authorization: Bearer <token>` | ✓ (trừ auth) | |
| `X-Device-Id` | ✓ (App) | Phải khớp `deviceId` trong token (`AF-16`) |
| `X-Signature` · `X-Nonce` · `X-Timestamp` | ✓ (chấm công) | HMAC-SHA256 (`AF-12`) |
| `X-Company-Id` | — | Chỉ Admin hệ thống dùng để xem xuyên tenant |

### Nhóm endpoint

| Prefix | Dùng cho | Quyền |
|---|---|---|
| `/v1/auth/*` | Cả ba client | Public / đã đăng nhập |
| `/v1/attendance/*` · `/v1/biometric/*` · `/v1/me/*` | App Nhân viên | `EMPLOYEE` |
| `/v1/requests/*` · `/v1/notifications/*` | App + Web | Tuỳ endpoint |
| `/v1/admin/*` | Web Quản lý | `MANAGER` · `HR_PAYROLL` · `COMPANY_ADMIN` |
| `/v1/system/*` | Web Admin | `SYSTEM_ADMIN` |

### Ghi chú cho Web Quản lý

- `MANAGER` bị giới hạn **hai chiều**: theo vai trò **và** theo phòng ban được phân công.
  Backend tự chèn scope, FE không cần lọc lại — nhưng cũng đừng cho rằng ẩn nút là đủ.
- Ẩn/hiện nút ở UI chỉ là trải nghiệm, **không phải bảo mật**. Backend kiểm tra lại mọi quyền.
- Export chạy bất đồng bộ: `POST /v1/admin/attendance/export` trả `202` + `jobId`,
  poll `GET /v1/jobs/{jobId}` để lấy link tải.
- Ảnh chấm công chỉ truy cập qua presigned URL hết hạn sau 5 phút, không có link vĩnh viễn.

### WebSocket

```
wss://<host>/ws?token=<accessToken>
```

Sự kiện: `request.decided` · `request.pending` · `attendance.recorded` ·
`fraud.flagged` · `notification.new` · `system.maintenance`

---

## 6. Cấp tài khoản và đăng nhập lần đầu

Một đường duy nhất: **HR cấp tài khoản**. Mã mời đã bỏ hẳn (`docs/01` mục 9).

```
Web:  POST /admin/employees   → trả về { account: { email, temporaryPassword, loginDomain } }
                                  ↑ hiển thị MỘT LẦN cho HR đọc lại cho nhân viên

App:  Firebase SDK: signInWithEmailAndPassword(email, password)
        → Firebase ID token          ← mật khẩu KHÔNG đi qua Backend
      POST /auth/session  { domain, firebaseIdToken }
        → nextStep: CHANGE_PASSWORD     ← token bị CHẶN ở mọi API khác
      POST /auth/password/change  { firebaseIdToken, newPassword }
        → nextStep: SETUP_BIOMETRIC
      POST /biometric/face/enroll/start … submit ×4
        → Home
```

**App điều hướng theo `nextStep`, không tự suy luận.** Bốn giá trị:
`TWO_FACTOR` → `CHANGE_PASSWORD` → `SETUP_BIOMETRIC` → `HOME`.

### Ai giữ gì

| | Firebase | Backend |
|---|:--:|:--:|
| Email + mật khẩu, chống dò mật khẩu, khoá tạm | ✔ | |
| Phiên làm việc (JWT + refresh xoay vòng) | | ✔ |
| Ràng buộc thiết bị, thu hồi theo từng thiết bị (AF-16) | | ✔ |
| Xác thực 2 lớp (OTP) | | ✔ |
| Vai trò, công ty, phạm vi phòng ban | | ✔ |

Backend vẫn cấp token riêng thay vì dùng thẳng Firebase ID token — lý do đầy đủ ở
đầu [auth.service.ts](src/modules/auth/auth.service.ts).

### Chốt cưỡng chế ở server, không phải điều hướng ở App

| Chốt | Ở đâu | Chặn gì |
|---|---|---|
| `PasswordChangeGuard` | Guard toàn cục, ngay sau `JwtAuthGuard` | Token còn mật khẩu tạm không gọi được API nào ngoài `password/change`, `me`, `logout` |
| Ràng buộc tên miền | `AuthService.createSession` | Nhân viên công ty A gõ tên miền công ty B. Firebase chỉ xác nhận danh tính, đây là nơi DUY NHẤT biết ranh giới công ty |
| Chỉ nhận uid đã được cấp hồ sơ | `AuthService.createSession` | Người tự đăng ký thẳng qua Firebase SDK → `AUTH_ACCOUNT_NOT_PROVISIONED` |
| Đòi xác thực còn tươi | `FirebaseService.verifyFreshIdToken` | Thao tác nhạy cảm bằng token cũ. ID token sống 1 giờ nên "hợp lệ" ≠ "vừa nhập mật khẩu" |

`POST /auth/refresh` **không** xoá cờ `mustChangePassword` — nếu không thì chỉ
cần gọi refresh một lần là thoát được màn hình đổi mật khẩu.

### Xác thực 2 lớp

Tuỳ chọn, người dùng tự bật, dùng **OTP gửi qua SMS** tới số điện thoại đã xác
minh riêng (`twoFactorPhone`, tách khỏi số liên lạc trong hồ sơ nhân sự).

Không dùng MFA của Firebase: MFA qua SMS đòi nâng cấp Identity Platform, và từ
09/2024 mọi tin nhắn của Firebase Phone Auth đòi gói Blaze có gắn thanh toán. Thử
thách lớp hai do `OtpService` + `SmsService` đảm nhiệm, nên mọi ngưỡng chống lạm
dụng (`OTP_*`) nằm trong tay mình.

### Một người làm ở hai công ty

Hai tài khoản riêng, hai mật khẩu riêng. Không có màn hình chọn công ty, không
có chuyển công ty giữa phiên.

> ⚠ **Giới hạn do Firebase mang lại:** một dự án Firebase (không nâng cấp
> Identity Platform) coi **email là duy nhất toàn dự án**, trong khi bảng
> `user_account` vẫn cho phép cùng email ở hai công ty. Nên trên thực tế một
> email chỉ dùng được ở MỘT công ty — HR công ty thứ hai sẽ nhận `EMP_EMAIL_TAKEN`.
> Muốn khôi phục hành vi cũ: nâng lên Identity Platform rồi ánh xạ mỗi công ty
> thành một Firebase tenant.

---

## 7. Vận hành

### Tách pod API và pod worker

```bash
# Pod API — chỉ đẩy job, không xử lý
WORKER_ENABLED=false node dist/main

# Pod worker — chỉ xử lý job, không phục vụ HTTP
WORKER_ENABLED=true  node dist/worker
```

Nhờ vậy scale API (theo CPU/RPS) và worker (theo độ dài queue) độc lập được
(`docs/02` mục 12.2).

Cờ này được đọc lúc **dựng module**, không phải lúc chạy: `@Processor()` của
`@nestjs/bullmq` tạo `Worker` ngay khi class được đăng ký làm provider, và
`Worker` tiêu thụ job lập tức — không có công tắc runtime nào tắt được nó. Vì vậy
`WorkerModule` quyết định danh sách provider dựa trên cờ (xem `worker.module.ts`).

### Chạy khi chưa có Redis — `REDIS_ENABLED`

Dành cho máy lập trình viên chưa dựng được Redis. Đặt `REDIS_ENABLED=false` thì
Backend khởi động và phục vụ API bình thường, nhưng:

| | `REDIS_ENABLED=true` | `REDIS_ENABLED=false` |
|---|---|---|
| Cache / OTP / nonce / rate limit | Redis, dùng chung mọi pod | `Map` trong tiến trình |
| Rate limit (`AF-13`) | chung toàn hệ thống | riêng từng tiến trình, restart là mất |
| Nonce chống replay (`AF-12`) | dùng lại là chặn được | chỉ chặn trong cùng tiến trình |
| BullMQ | đăng ký đầy đủ | không đăng ký, thay bằng queue giả |
| Job nền | xếp hàng, có retry | **bị vứt bỏ**, không chạy bù |

Hệ quả cụ thể khi tắt: không tính lương, không gửi OTP qua SMS, không xuất Excel,
không quét gian lận. Mỗi job bị vứt đều ghi một dòng `warn` kèm tên job — cố ý ồn,
vì im lặng sẽ thành "ngồi chờ file Excel không bao giờ tới".

Đặt `false` ở `NODE_ENV=production` khiến ứng dụng **chết lúc khởi động**
(`env.validation.ts`). Chạy nhiều pod với chế độ này thì chốt chống lạm dụng gần
như không còn: kẻ tấn công chỉ cần rải request trúng pod khác là bộ đếm về 0.

Kiểm tra đang chạy chế độ nào bằng `GET /health` → trường `redisMode`.

### Job định kỳ

| Queue | Job | Lịch |
|---|---|---|
| `payroll` | Tính lại bảng công hằng đêm | `0 2 * * *` |
| `fraud-scan` | Impossible travel (`AF-03`) | mỗi 15 phút |
| `fraud-scan` | Thời lượng ca bất thường (`AF-19`) | `30 3 * * *` |
| `fraud-scan` | Thiếu chấm ra | `45 3 * * *` |
| `ai-batch` | Random audit (`AF-08`) | `0 4 * * *` |
| `retention` | Xoá ảnh chấm công quá hạn | `0 5 * * *` |
| `retention` | Xoá ảnh hồ sơ khuôn mặt đã thu hồi | `15 5 * * *` |
| `retention` | Xoá file xuất quá hạn | `30 5 * * *` |

Dùng repeatable job của BullMQ nên nhiều pod worker chạy song song vẫn chỉ kích hoạt
một lần cho mỗi mốc thời gian.

> Thứ tự 04:00 → 05:00 là bắt buộc: random audit đối chiếu ảnh chấm công với hồ
> sơ, chạy dọn trước thì nó mất chính những tấm ảnh cần đối chiếu.

### Chính sách lưu trữ (`NFR-LEGAL-04`, `NFR-SCALE-07`)

Bốn tiền tố, bốn quy tắc khác nhau:

| Tiền tố | Khoá chính sách | Mặc định |
|---|---|---|
| `attendance/` | `privacy.attendancePhotoRetentionDays` | 90 ngày |
| `face-profile/` | `privacy.deleteBiometricDelayDays` — chỉ tính **sau khi thu hồi** | 90 ngày |
| `exports/` | `privacy.exportFileRetentionDays` | 7 ngày |
| `requests/` | **chưa có** — cần pháp chế chốt (`NFR-LEGAL-08`) | — |

**Ba điều dễ hiểu nhầm:**

`face-profile/` **không** xoá theo tuổi. Hồ sơ của nhân viên đang làm việc phải
sống mãi — đó là thứ dùng để so khớp mỗi ngày. Chỉ hồ sơ đã `REVOKED`/`REPLACED`
mới bị dọn, và còn phải qua thời gian chờ để kịp điều tra nếu việc thu hồi là do
bị chiếm thiết bị.

Giữ **bản ghi**, chỉ xoá **ảnh**. `AttendanceLog` là chứng từ cho thanh tra lao
động (`NFR-LEGAL-08`), giữ vĩnh viễn. Ảnh khuôn mặt là dữ liệu sinh trắc học,
xoá sau thời hạn. Job **không đụng** tới bảng `attendance_log` — bảng đó bất
biến (`BR-06`).

Đặt chính sách `<= 0` nghĩa là **giữ vĩnh viễn**, không phải xoá tất cả.

Lifecycle rule trên bucket là lớp thứ hai — trần cứng chạy kể cả khi worker
chết. Xem [docs/r2-lifecycle.md](docs/r2-lifecycle.md).

### Lệnh thường dùng

```bash
npm run start:dev        # API + worker trong một process (dev)
npm run worker:dev       # chỉ worker
npm run typecheck        # tsc --noEmit
npm test                 # unit test
npm run test:cov         # độ phủ (payroll cần ≥ 90% — NFR-MAINT-01)
npm run prisma:studio    # xem dữ liệu
```

---

## 8. Việc còn lại trước khi go-live

Những mục dưới đây **chưa hoàn thiện** trong bản dựng này và cần xử lý trước production.
Cột "Chặn ở đâu" nói rõ *vì sao chưa xong* — nhiều mục không phải chờ viết code mà chờ
hạ tầng, dữ liệu khách hàng, hoặc một quyết định đã bị hoãn.

| Hạng mục | Trạng thái thật | Chặn ở đâu | Bước kế tiếp | Chặn go-live? |
|---|---|---|---|---|
| **AI Server** | Đã thi công — [`../server-ai-smart`](../server-ai-smart), đang chạy `ENGINE=stub` | Chưa có model chống giả mạo thật. Engine giả sinh embedding từ mã băm ảnh: cùng một ảnh cho cùng embedding nên luồng chạy thông, nhưng **hai ảnh khác nhau của cùng một người cho điểm gần 0** | `scripts/download_models.py` (buffalo_l tự tải, MiniFASNet lấy thủ công) → `ENGINE=insightface` → nối `AI_SERVER_INTERNAL_KEY` ≥ 32 ký tự. Danh sách đầy đủ ở [`../server-ai-smart/README.md`](../server-ai-smart/README.md) mục 8 | ✅ Có |
| **App Attestation** (`AF-15`) | Khung sẵn, chưa verify thật | `verifyAttestation()` ([attendance.service.ts](src/modules/attendance/attendance.service.ts)) chỉ kiểm tra token **có tồn tại** rồi trả `null`. Hệ quả dây chuyền: điều kiện `attestationPassed === false` trong `fraud.service.ts` **không bao giờ đúng**, nên bật `DEVICE_REQUIRE_ATTESTATION` hiện chỉ chặn được người không gửi token — gửi chuỗi rác vẫn qua | Gọi thật Google Play Integrity (cần service account GCP + app đã phát hành) và Apple App Attest (Team ID + xác thực chuỗi chứng chỉ). Tự parse token là vô nghĩa. Phụ thuộc app lên store → Giai đoạn 3 | Không |
| **Row-Level Security** (`ADR-05`) | Script sẵn, khối `DO $$` đang comment trong `prisma/sql/01_immutability_and_rls.sql` | Ba điều kiện chưa đạt: ① DB user hiện là owner → Postgres **tự động BYPASSRLS cho owner**, bật lên không có tác dụng mà tạo cảm giác an toàn giả; ② `user_account`/`audit_log` bị loại trừ vì admin nền tảng có `companyId IS NULL`, policy so bằng `=` trả NULL → admin tự khoá mình ra ngoài; ③ `PrismaService.withTenant()` có sẵn nhưng **chưa nơi nào gọi** — bật RLS bây giờ thì mọi query trả 0 dòng | Theo đúng thứ tự: tách DB role `NOBYPASSRLS` → bọc request qua `withTenant()`/`runForTenant()` → nhánh `app.bypass_rls='on'` cho `SYSTEM_ADMIN` → đổi policy hai bảng trên sang `IS NOT DISTINCT FROM` → bỏ comment → chạy lại e2e cách ly tenant | ✅ Có |
| **Partition `attendance_log`** (`D7`) | Script sẵn, **chưa áp và chưa nạp vào DB** | `npm run db:guards` chỉ chạy `01_immutability_and_rls.sql` + `02_auth_constraints.sql`, **không chạy `02_partitioning.sql`** — nên hàm `create_attendance_log_partition()` chưa tồn tại trong database. Ngoài ra `AttendanceLog` đang có PK đơn `id`, mà Postgres đòi partition key nằm trong PK → phải đổi thành `(id, workDate)`, kéo theo 2 khoá ngoại từ `FraudFlag`/`AttendanceAdjustment` thành tổ hợp | **Làm ngay khi bảng còn rỗng** — để lâu thành migration có downtime. Các bước chi tiết ở [`../docs/14`](../docs/14-so-do-quan-he-bang-du-lieu.md) mục 8b.5. Nhớ kèm job hằng tháng: thiếu partition tháng hiện tại thì **mọi INSERT chấm công lỗi** | ✅ Có |
| **Hiệu chỉnh ngưỡng AI** | Đang dùng mặc định `0.45` / `0.70` / `0.60` | Không phải việc code — cần bộ ảnh thật của khách hàng để dựng ma trận similarity genuine/impostor rồi quét ngưỡng. Riêng phần code: `AiModelVersion.defaultMatchThreshold` **không consumer nào đọc**, tất cả chỉ đọc `PolicyKeys` — đổi model không tự kéo theo ngưỡng | Quét `t` từ 0.20→0.80, chọn theo FAR mục tiêu (1:1 = 0,1%; 1:N N≤100 = 0,001%; N≥500 = 0,0001%), **không dùng EER**. Ghi kết quả vào `AiModelVersion`, đặt override qua `CompanyPolicy`. FRR > 10% thì sửa khâu đăng ký/ánh sáng, đừng hạ ngưỡng. Quy trình ở [`../docs/00`](../docs/00-kien-thuc-nen-tang.md) Phần 2 | ✅ Có |
| **Test cách ly tenant** (`NFR-SEC-05`) | **Đã viết** — [test/tenant-isolation.e2e-spec.ts](test/tenant-isolation.e2e-spec.ts), 4 nhóm kịch bản (GET chéo tenant, list không rò rỉ, leo thang bằng `X-Company-Id`, kiểm vai trò) | Chưa chạy được tự động: không có `.env.test`, không có `globalSetup` dựng schema. Muốn chạy phải tự trỏ `DATABASE_URL` sang DB test + Redis + Firebase emulator (điều kiện ghi ở đầu tệp test) | `.env.test` + `globalSetup` + đưa vào CI. Xem dòng **CI + coverage gate** bên dưới | ✅ Có |
| **CI + coverage gate** | Chưa có | Repo không có `.github/workflows`, và grep `coverageThreshold` toàn repo = 0 kết quả. Nên câu "test cách ly tenant FAIL = chặn release" (`NFR-SEC-05`) và "payroll ≥ 90%" (`NFR-MAINT-01`) hiện **không có gì cưỡng chế** | Workflow chạy `typecheck` → `test` → `test:e2e`, thêm `coverageThreshold` cho `modules/payroll` | ✅ Có |
| **Chế độ offline** (`FR-APP-STAT-06`) | Chưa làm — chỉ có cột `attendance_log.isOffline`, không nơi nào ghi/đọc | Mâu thuẫn trực tiếp với `BR-01`: bản ghi offline buộc phải lấy giờ máy, đúng lỗ hổng mà `AF-17`/`AF-18` sinh ra để bịt. Endpoint `POST /v1/attendance/sync-offline` đã đặc tả ở `docs/08` mục 8 nhưng chưa tồn tại | Ép `decision = PENDING_REVIEW` **không phụ thuộc fraud score**, không tự vào bảng công, phải người duyệt (`docs/03` mục 9.1). Ưu tiên *Could* → Giai đoạn 3 | Không |
| **Kiosk 1:N** | Chưa làm — AI Server đã sẵn `/v1/identify` + `/v1/index/*`, thiếu phía Backend | ① Embedding lưu dạng `Bytes`, pgvector đang comment trong `schema.prisma`; ② không có `PolicyKey` nào cho ngưỡng 1:N lẫn `margin` tối thiểu — không dùng chung `0.45` được vì `FAR_mỗi_so_sánh ≤ FAR_mong_muốn / N`; ③ không có job đẩy embedding lên `/v1/index/upsert`, cũng không nạp lại khi AI Server restart (chỉ mục nằm trong RAM) | Cài pgvector rồi làm theo hướng dẫn ghi sẵn trong `schema.prisma` (`ALTER TABLE face_profile ADD COLUMN embedding vector(512)` + HNSW index). `namespace` **bắt buộc** là `companyId` — trộn hai công ty = nhận nhầm người chéo tenant | Không |
| **2FA cho Admin** (`NFR-SEC-11`) | Máy móc **đã đủ và có test** (OtpService, SmsService, `twoFactorPhone`, recovery code, 5 endpoint `2fa/*`) — thiếu phần cưỡng chế | 2FA hiện thuần opt-in: `AuthService.createSession` chỉ đọc `twoFactorEnabled`, không đọc `isSystemAdmin` hay vai trò; `resolveNextStep()` cho admin đi thẳng `HOME`; `disableTwoFactor()` không chặn admin tự tắt. Không có guard 2FA nào trong `common/guards/` | Thêm policy key bắt buộc 2FA cho admin → `resolveNextStep()` trả bước thiết lập 2FA → guard kiểu `PasswordChangeGuard` chặn mọi API trừ `2fa/*`, `me`, `logout` → chặn `disableTwoFactor()` với tài khoản admin. ⚠ `SMS_PROVIDER` mặc định là `console`, phải nối eSMS thật trước | Không |
| **Export theo template tuỳ biến** | Mới có mẫu mặc định, cột viết cứng | DTO **có** nhận `template` và `format` nhưng `export.processor.ts` không đọc → cả hai bị bỏ qua âm thầm; xin `format: 'CSV'` vẫn nhận về `.xlsx`. Grep `MISA`/`Fast` trong `src` = 0 kết quả. (`departmentIds` trước đây cũng bị bỏ qua — **đã sửa**, xem mục 8.1 bên dưới) | Hoặc bỏ hai trường khỏi DTO (đừng hứa cái không làm), hoặc đưa định nghĩa cột (nhãn + thứ tự) vào cấu hình rồi cho processor đọc theo tên template, kèm nhánh CSV | Không |

### 8.1. Phạm vi phòng ban của job chạy nền

`POST /admin/attendance/export` từng cho `MANAGER` xuất bảng công **toàn công ty**:
endpoint thiếu `@DepartmentScoped()`, và processor chỉ lọc theo `companyId`. Đã sửa —
nhưng cái bẫy phía sau đáng nhớ vì nó sẽ lặp lại ở mọi job chạy nền tiếp theo:

> **Worker không có JWT.** Nó chạy ở pod khác, sau khi request đã kết thúc. Không có
> cách nào để nó suy lại "người yêu cầu được xem phòng ban nào". Nên với job chạy nền,
> `resolveDepartmentScope(ctx)` phải được gọi **lúc nhận request** rồi ghi kết quả vào
> `params` — xem `resolveExportDepartmentFilter()` ở
> [attendance-admin.service.ts](src/modules/attendance/attendance-admin.service.ts).

Ba điểm dễ sai khi làm việc tương tự:

- **`null` và `[]` không cùng nghĩa.** `null` = toàn công ty (HR/Admin), `[]` = không
  phòng ban nào. Lẫn hai giá trị này theo chiều `[] → null` là mở cửa toàn bộ dữ liệu
  cho đúng người vừa bị chặn.
- **Client gửi `departmentIds: []` là chuyện bình thường** — Ant Design gửi mảng rỗng
  khi người dùng xoá hết lựa chọn. Với người có quyền toàn công ty, đó là "không lọc".
- **Bộ lọc client gửi phải được GIAO với phạm vi**, không phải dùng thay. `ScopeGuard`
  đã chặn ở tầng trên, nhưng phép giao là lớp thứ hai — rẻ hơn nhiều so với một vụ rò rỉ.

Ràng buộc này được khoá bằng [export-scope.spec.ts](src/modules/attendance/export-scope.spec.ts).

---

## 9. Checklist khi thêm endpoint mới

Trích `docs/08` mục 11 — dán vào PR description:

- [ ] Có `TenantGuard`; mọi query lọc theo `companyId` (`BR-09`)
- [ ] Nếu đẩy job chạy nền: phạm vi phòng ban đã chốt lúc nhận request và ghi vào `params` (mục 8.1)
- [ ] Truy vấn nằm trong `<module>.repository.ts`, Service **không** import `PrismaService`
- [ ] Có `@Roles()` (+ `@DepartmentScoped()` nếu `MANAGER` truy cập được)
- [ ] DTO validate đầy đủ, không dùng `any`
- [ ] **Không nhận cờ trạng thái xác thực từ client** (`BR-02`)
- [ ] Thao tác nhạy cảm có `@Audit({ requireReason: true })` (`BR-08`)
- [ ] Thao tác ghi kiểm tra kỳ lương đã chốt chưa (`BR-07`)
- [ ] Lỗi ném qua `AppException` với mã khai trong `error-catalog.ts`
- [ ] Có `@ApiOperation` + `@ApiErrors()` đầy đủ
- [ ] Có integration test kiểm tra cách ly tenant
