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
npm install
npx prisma migrate dev --name init
npm run db:guards          # rule bất biến + CHECK + index bổ sung
npm run seed
npm run start:dev
```

### Cách B — hạ tầng có sẵn

```bash
cp .env.example .env       # sửa DATABASE_URL, REDIS_HOST, S3_*
npm install
npx prisma migrate deploy
npm run db:guards
npm run seed
npm run start:dev
```

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

Đăng nhập: `POST /v1/auth/login` với `{ domain, email, password }`.

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
    │   ├── prisma/                # PrismaService singleton (hot-reload safe)
    │   ├── redis/                 # OTP, nonce, rate limit, cache
    │   ├── storage/               # S3 + presigned URL
    │   ├── queue/                 # BullMQ + 6 processor + scheduler
    │   └── logger/                # pino, có traceId, che dữ liệu nhạy cảm
    └── modules/
        ├── auth/          # Login mật khẩu, TOTP 2FA, JWT, refresh rotation, device binding
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
Service     →  toàn bộ nghiệp vụ.
Repository  →  LUÔN nhận companyId làm tham số bắt buộc, không có giá trị mặc định.
DTO         →  validate bằng class-validator. Không dùng `any`.
```

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

App:  POST /auth/login  { domain, email, password }
        → nextStep: CHANGE_PASSWORD     ← token bị CHẶN ở mọi API khác
      POST /auth/password/change
        → nextStep: SETUP_BIOMETRIC
      POST /biometric/face/enroll/start … submit ×4
        → Home
```

**App điều hướng theo `nextStep`, không tự suy luận.** Bốn giá trị:
`TWO_FACTOR` → `CHANGE_PASSWORD` → `SETUP_BIOMETRIC` → `HOME`.

### Ba chốt cưỡng chế ở server, không phải điều hướng ở App

| Chốt | Ở đâu | Chặn gì |
|---|---|---|
| `PasswordChangeGuard` | Guard toàn cục, ngay sau `JwtAuthGuard` | Token còn mật khẩu tạm không gọi được API nào ngoài `password/change`, `me`, `logout` |
| Một mã lỗi cho ba loại sai | `AuthService.login` | Sai tên miền / email không tồn tại / sai mật khẩu đều trả `AUTH_INVALID_CREDENTIALS`, và tốn thời gian như nhau |
| Khoá tạm | `AuthService.assertPasswordMatches` | Sai 8 lần liên tiếp → khoá 15 phút |

`POST /auth/refresh` **không** xoá cờ `mustChangePassword` — nếu không thì chỉ
cần gọi refresh một lần là thoát được màn hình đổi mật khẩu.

### Xác thực 2 lớp

Tuỳ chọn, người dùng tự bật, dùng **TOTP** (Google Authenticator) — không phải
SMS. Bản cài theo RFC 6238, kiểm chứng bằng vector thử chuẩn trong
[totp.service.spec.ts](src/modules/auth/totp.service.spec.ts).

### Một người làm ở hai công ty

Hai tài khoản riêng, hai mật khẩu riêng. Không có màn hình chọn công ty, không
có chuyển công ty giữa phiên.

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

Những mục dưới đây **chưa hoàn thiện** trong bản dựng này và cần xử lý trước production:

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| **AI Server** | Chưa có | Backend đã có `AiGatewayService` + circuit breaker, chỉ cần AI Server nói đúng hợp đồng ở `docs/08` mục 8 |
| **App Attestation** (`AF-15`) | Khung sẵn, chưa verify thật | Phải gọi API Google Play Integrity / Apple App Attest — tự parse token là vô nghĩa. Giai đoạn 3 |
| **Row-Level Security** (`ADR-05`) | Script sẵn, đang comment | Bật khi đã tách DB role riêng cho ứng dụng |
| **Partition `attendance_log`** (`D7`) | Script sẵn, chưa áp | Áp khi bảng còn rỗng, hoặc lên kế hoạch migrate có downtime |
| **Hiệu chỉnh ngưỡng AI** | Đang dùng giá trị mặc định | ⚠ **Bắt buộc** đo FAR/FRR trên dữ liệu thật của khách hàng trước go-live (`docs/09` checklist) |
| **Test cách ly tenant** (`NFR-SEC-05`) | Chưa viết | Quét toàn bộ endpoint: đăng nhập tenant A không đọc được dữ liệu tenant B. **Test này FAIL = chặn release** |
| **Chế độ offline** (`FR-APP-STAT-06`) | Chưa làm | Mâu thuẫn với `BR-01`, cần cơ chế duyệt riêng. Giai đoạn 3 |
| **Kiosk 1:N** | Chưa làm | Cần bật pgvector; ngưỡng 1:N khắt khe hơn nhiều và phải kiểm tra `margin` |
| **2FA cho Admin** (`NFR-SEC-11`) | Chưa làm | |
| **Export theo template tuỳ biến** | Mới có mẫu mặc định | Mapping cột MISA/Fast để trong cấu hình, không viết cứng |

---

## 9. Checklist khi thêm endpoint mới

Trích `docs/08` mục 11 — dán vào PR description:

- [ ] Có `TenantGuard`; mọi query lọc theo `companyId` (`BR-09`)
- [ ] Có `@Roles()` (+ `@DepartmentScoped()` nếu `MANAGER` truy cập được)
- [ ] DTO validate đầy đủ, không dùng `any`
- [ ] **Không nhận cờ trạng thái xác thực từ client** (`BR-02`)
- [ ] Thao tác nhạy cảm có `@Audit({ requireReason: true })` (`BR-08`)
- [ ] Thao tác ghi kiểm tra kỳ lương đã chốt chưa (`BR-07`)
- [ ] Lỗi ném qua `AppException` với mã khai trong `error-catalog.ts`
- [ ] Có `@ApiOperation` + `@ApiErrors()` đầy đủ
- [ ] Có integration test kiểm tra cách ly tenant
