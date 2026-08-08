# 07 — Mô hình dữ liệu

> Suy dẫn từ toàn bộ nghiệp vụ trong tài liệu PA.
> CSDL: **PostgreSQL 16** · ORM: **Prisma** (`ADR-04`) · Multi-tenant: shared schema + `companyId` (`ADR-05`).

---

## 1. Nguyên tắc thiết kế

| # | Nguyên tắc | Lý do |
|---|---|---|
| **D1** | **Tách bản ghi THÔ và bản ghi ĐÃ TÍNH** (`ADR-08`) | `AttendanceLog` bất biến giữ bằng chứng; `AttendanceDaily` tính lại được bất cứ lúc nào |
| **D2** | Mọi bảng nghiệp vụ có `companyId` + index trên `companyId` | Multi-tenant, mọi query lọc theo tenant (`BR-09`) |
| **D3** | Khoá chính là **UUID/CUID**, không dùng số tự tăng | Tránh đoán ID, an toàn khi merge dữ liệu đa tenant |
| **D4** | **Không xoá cứng** dữ liệu nghiệp vụ — dùng `deletedAt` (soft delete) | Kiểm toán, khôi phục nhầm lẫn |
| **D5** | Lưu thời gian dạng **UTC** (`timestamptz`), quy đổi theo timezone công ty khi tính | Ca đêm, đa chi nhánh, đa múi giờ |
| **D6** | Cấu hình chính sách có **hiệu lực theo thời gian** (`effectiveFrom`/`effectiveTo`) | Đổi giờ ca giữa tháng không làm sai lệch dữ liệu cũ |
| **D7** | Bảng lớn (`AttendanceLog`, `AuditLog`) thiết kế sẵn cho **partition theo tháng** | Hiệu năng khi dữ liệu lên hàng chục triệu dòng |
| **D8** | Embedding khuôn mặt tách bảng riêng, quyền truy cập hạn chế | Dữ liệu sinh trắc học nhạy cảm |

---

## 2. Sơ đồ quan hệ tổng thể

```
┌─ TỔ CHỨC ────────────────────────────────────────────────────────────┐
│  Company ──┬── Branch ──── Department ──── Employee                   │
│            ├── SubscriptionPlan                                       │
│            ├── InviteCode                                             │
│            └── CompanyPolicy                                          │
└──────────────────────────────────────────────────────────────────────┘
                                    │
┌─ TÀI KHOẢN & SINH TRẮC HỌC ───────┼──────────────────────────────────┐
│  UserAccount ──┬── Employee ──────┼── FaceProfile   (embedding)       │
│                │                   ├── BiometricKey (public key vân tay)│
│                │                   └── DeviceBinding                  │
│                └── RefreshToken                                       │
└──────────────────────────────────────────────────────────────────────┘
                                    │
┌─ CA LÀM VIỆC & CHÍNH SÁCH ────────┼──────────────────────────────────┐
│  Shift ──── ShiftSegment          │                                   │
│  ShiftAssignment ─────────────────┤                                   │
│  Holiday                          │                                   │
│  LeavePolicy ──── LeaveBalance ───┤                                   │
│  Geofence (thuộc Branch)          │                                   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
┌─ CHẤM CÔNG ───────────────────────┼──────────────────────────────────┐
│  AttendanceLog (THÔ, BẤT BIẾN) ───┤                                   │
│       └── FraudFlag               │                                   │
│       └── AttendanceAdjustment    │                                   │
│  AttendanceDaily (ĐÃ TÍNH) ───────┤                                   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
┌─ ĐƠN TỪ ──────────────────────────┼──────────────────────────────────┐
│  RequestType ──── ApprovalFlow ──── ApprovalFlowStep                  │
│  LeaveRequest ──┬── ApprovalStep                                      │
│                 └── RequestAttachment                                 │
└──────────────────────────────────────────────────────────────────────┘
                                    │
┌─ TÍNH CÔNG & LƯƠNG ───────────────┼──────────────────────────────────┐
│  PayrollPeriod ──── PayrollSummary│                                   │
│  MakeupWorkRecord                 │                                   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
┌─ HỆ THỐNG ────────────────────────┼──────────────────────────────────┐
│  Notification · AuditLog · SystemConfig · AiModelVersion              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Schema Prisma

### 3.1. Cấu hình

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]     // pgvector — bật khi cần so khớp 1:N quy mô lớn
}
```

---

### 3.2. Tổ chức (Tenant)

```prisma
enum CompanyStatus {
  TRIAL
  ACTIVE
  SUSPENDED
  TERMINATED
}

model Company {
  id            String        @id @default(cuid())
  /// Mã công ty rút gọn, dùng sinh employee code. BẤT BIẾN. VD: "amobi"
  code          String        @unique
  /// Tên miền nhân viên gõ ở màn hình đăng nhập. VD: "amobi.vn"
  ///
  /// Tách khỏi `code` vì hai thứ phục vụ hai mục đích khác nhau: `code` đi vào
  /// mã nhân viên nên BẤT BIẾN sau lần chấm công đầu (BR-04), còn tên miền là
  /// thứ đối mặt người dùng và công ty có thể muốn đổi khi đổi thương hiệu.
  domain        String        @unique
  name          String
  taxCode       String?
  timezone      String        @default("Asia/Ho_Chi_Minh")
  status        CompanyStatus @default(TRIAL)
  planId        String?
  plan          SubscriptionPlan? @relation(fields: [planId], references: [id])
  trialEndsAt   DateTime?
  suspendedAt   DateTime?
  suspendReason String?

  branches      Branch[]
  departments   Department[]
  employees     Employee[]
  inviteCodes   InviteCode[]
  policies      CompanyPolicy[]
  shifts        Shift[]
  holidays      Holiday[]
  requestTypes  RequestType[]
  payrollPeriods PayrollPeriod[]

  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  deletedAt     DateTime?

  @@index([status])
}

model SubscriptionPlan {
  id                String   @id @default(cuid())
  name              String                     // "Trial" | "Basic" | "Pro" | "Enterprise"
  maxEmployees      Int?                       // null = không giới hạn
  maxBranches       Int?
  maxRecognitionsPerMonth Int?
  storageGb         Int?
  photoRetentionDays Int     @default(90)
  features          Json                       // { rotatingShift: true, ot: true, multiBranch: false, ... }
  pricePerMonth     Decimal? @db.Decimal(12, 2)
  companies         Company[]
  createdAt         DateTime @default(now())
}

model Branch {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  name        String
  address     String?
  /// Geofence
  latitude    Float?
  longitude   Float?
  radiusMeters Int     @default(100)
  /// Xác thực lớp 2 tại chỗ (AF-02)
  ///
  /// `wifiSsids` CHỈ để hiển thị cho HR — không tham gia quyết định. Tên mạng
  /// ai cũng đặt trùng được trong ba giây; chỉ `wifiBssids` (địa chỉ MAC của
  /// bộ phát) mới dùng để đối chiếu.
  wifiSsids   String[] @default([])
  wifiBssids  String[] @default([])
  beaconUuids String[] @default([])

  /// AF-02b — dải IP CÔNG CỘNG của mạng văn phòng, dạng CIDR.
  /// VD: ["203.0.113.0/24", "198.51.100.7/32"]
  ///
  /// Mạnh hơn hẳn `wifiBssids`: địa chỉ nguồn do SERVER quan sát từ kết nối
  /// TCP, client không tự khai được.
  ///
  /// ⚠ Phải là IP công cộng nhà mạng cấp cho văn phòng, KHÔNG phải dải nội bộ
  /// sau NAT — khai "192.168.1.0/24" là nhầm lẫn phổ biến nhất.
  /// ⚠ Chỉ đúng khi TRUSTED_PROXY_HOPS khai đúng số proxy đứng trước Backend.
  allowedIpCidrs String[] @default([])

  timezone    String?                       // ghi đè timezone công ty nếu chi nhánh khác múi giờ

  departments Department[]
  employees   Employee[]
  createdAt   DateTime @default(now())
  deletedAt   DateTime?

  @@index([companyId])
}

model Department {
  id           String   @id @default(cuid())
  companyId    String
  company      Company  @relation(fields: [companyId], references: [id])
  branchId     String?
  branch       Branch?  @relation(fields: [branchId], references: [id])
  name         String
  parentId     String?                       // cây phòng ban
  parent       Department?  @relation("DeptTree", fields: [parentId], references: [id])
  children     Department[] @relation("DeptTree")
  /// Trưởng phòng — dùng cho luồng duyệt đơn
  managerId    String?
  employees    Employee[]
  createdAt    DateTime @default(now())
  deletedAt    DateTime?

  @@index([companyId])
  @@index([companyId, branchId])
}

// Model InviteCode ĐÃ BỊ XOÁ.
//
// Nhân viên không tự tham gia công ty bằng mã mời nữa. HR cấp sẵn tài khoản
// (tên miền + email + mật khẩu tạm). Xem docs/01 mục 9 và docs/13.
```

---

### 3.3. Tài khoản & Nhân viên

```prisma
enum EmployeeStatus {
  PENDING_ACTIVATION
  ACTIVE
  SUSPENDED
  TERMINATED
}

enum SystemRole {
  SYSTEM_ADMIN
  COMPANY_ADMIN
  MANAGER
  HR_PAYROLL
  EMPLOYEE
}

/// Tài khoản đăng nhập — gắn với ĐÚNG MỘT công ty.
///
/// Một người làm ở hai công ty trên nền tảng có HAI tài khoản riêng, hai mật
/// khẩu riêng. Nhất quán với việc tài khoản do công ty cấp: công ty A không
/// được biết nhân viên còn làm ở đâu, và mật khẩu do A cấp không được mở dữ
/// liệu của B.
///
/// `companyId = null` dành riêng cho quản trị viên nền tảng (Web Admin).
model UserAccount {
  id        String   @id @default(cuid())
  companyId String?                          // null = quản trị viên nền tảng
  company   Company? @relation(fields: [companyId], references: [id])

  email     String                           // định danh đăng nhập, LUÔN lưu chữ thường
  phone     String?
  fullName  String
  avatarUrl String?
  locale    String   @default("vi")

  passwordHash       String                  // scrypt — xem PasswordService
  mustChangePassword Boolean   @default(true)
  passwordChangedAt  DateTime?
  failedLoginCount   Int       @default(0)   // sai 8 lần → khoá 15 phút
  lockedUntil        DateTime?

  twoFactorEnabled       Boolean   @default(false)   // TOTP, người dùng tự bật
  twoFactorSecret        String?                     // base32
  twoFactorConfirmedAt   DateTime?
  twoFactorRecoveryCodes String[]  @default([])      // đã băm

  isSystemAdmin Boolean   @default(false)
  isBlocked     Boolean   @default(false)
  blockedReason String?
  lastLoginAt   DateTime?

  employees     Employee[]
  refreshTokens RefreshToken[]
  devices       DeviceBinding[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  /// Email duy nhất TRONG TỪNG công ty, không phải toàn hệ thống.
  ///
  /// ⚠ KHÔNG áp dụng cho quản trị viên nền tảng: Postgres coi mọi NULL là khác
  /// nhau nên (null, 'a@b.vn') lặp lại bao nhiêu lần cũng lọt. Chỗ đó cần chỉ
  /// mục một phần — xem prisma/sql/02_auth_constraints.sql.
  @@unique([companyId, email])
  @@index([companyId])
}

model Employee {
  id             String         @id @default(cuid())
  companyId      String
  company        Company        @relation(fields: [companyId], references: [id])
  userId         String?                          // null khi HR tạo trước, chưa đăng nhập lần đầu
  user           UserAccount?   @relation(fields: [userId], references: [id])
  /// Mã hiển thị: ducnv.amobi — DUY NHẤT trong công ty, BẤT BIẾN sau khi dùng chấm công (BR-04)
  employeeCode   String
  fullName       String
  phone          String
  email          String?
  branchId       String?
  branch         Branch?        @relation(fields: [branchId], references: [id])
  departmentId   String?
  department     Department?    @relation(fields: [departmentId], references: [id])
  position       String?
  contractType   String?                          // "Chính thức" | "Thử việc" | "Thời vụ" | "Part-time"
  joinedAt       DateTime?
  terminatedAt   DateTime?
  status         EmployeeStatus @default(PENDING_ACTIVATION)
  roles          SystemRole[]   @default([EMPLOYEE])
  /// Phạm vi quản lý — dùng cho ScopeGuard của vai trò MANAGER
  managedDepartmentIds String[] @default([])
  /// true sau lần chấm công đầu tiên → khoá employeeCode (BR-04)
  codeLocked     Boolean        @default(false)

  faceProfiles      FaceProfile[]
  biometricKeys     BiometricKey[]
  attendanceLogs    AttendanceLog[]
  attendanceDailies AttendanceDaily[]
  requests          LeaveRequest[]
  leaveBalances     LeaveBalance[]
  shiftAssignments  ShiftAssignment[]
  makeupRecords     MakeupWorkRecord[]

  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  deletedAt      DateTime?

  @@unique([companyId, employeeCode])
  @@unique([companyId, phone])
  @@index([companyId, status])
  @@index([companyId, departmentId])
  @@index([userId])
}

model RefreshToken {
  id          String   @id @default(cuid())
  userId      String
  user        UserAccount @relation(fields: [userId], references: [id])
  tokenHash   String   @unique
  deviceId    String
  expiresAt   DateTime
  revokedAt   DateTime?
  /// Rotation: token thay thế token này
  replacedById String?
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([tokenHash])
}
```

---

### 3.4. Sinh trắc học & Thiết bị

```prisma
enum FaceProfileStatus {
  ACTIVE
  REPLACED
  REVOKED
}

/// Một nhân viên có NHIỀU embedding (nhiều góc, nhiều điều kiện ánh sáng)
model FaceProfile {
  id           String  @id @default(cuid())
  companyId    String
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id])
  /// Vector 512 chiều đã L2-normalize.
  /// Dùng Unsupported để Prisma không đụng vào; truy vấn qua $queryRaw.
  embedding    Unsupported("vector(512)")?
  /// Bản sao dạng bytes để chạy được cả khi chưa bật pgvector
  embeddingRaw Bytes?
  modelVersion String                            // "buffalo_l@2.1" — đổi model phải re-enroll
  qualityScore Float?
  photoKey     String?                           // S3 key ảnh hồ sơ gốc
  angle        String?                           // "FRONT" | "LEFT" | "RIGHT"
  status       FaceProfileStatus @default(ACTIVE)
  enrolledAt   DateTime @default(now())
  revokedAt    DateTime?
  revokedBy    String?
  revokedReason String?

  @@index([companyId, employeeId, status])
  @@index([modelVersion])
}

/// Vân tay: server CHỈ lưu public key. Private key nằm trong secure enclave thiết bị (BR-05)
model BiometricKey {
  id          String   @id @default(cuid())
  companyId   String
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])
  deviceId    String
  publicKey   String   @db.Text
  algorithm   String   @default("ES256")
  attestation Json?                              // kết quả App Attest / Play Integrity lúc đăng ký
  revokedAt   DateTime?
  revokedReason String?
  createdAt   DateTime @default(now())

  @@unique([employeeId, deviceId])
  @@index([companyId, employeeId])
}

model DeviceBinding {
  id            String   @id @default(cuid())
  companyId     String
  userId        String
  user          UserAccount @relation(fields: [userId], references: [id])
  deviceId      String
  deviceModel   String?
  osName        String?
  osVersion     String?
  appVersion    String?
  /// Secret dùng ký HMAC request (AF-12). Lưu dạng hash.
  deviceSecretHash String
  pushToken     String?
  isRooted      Boolean  @default(false)
  lastSeenAt    DateTime?
  isActive      Boolean  @default(true)
  revokedAt     DateTime?
  revokedBy     String?
  revokedReason String?
  createdAt     DateTime @default(now())

  @@unique([userId, deviceId])
  @@index([companyId, userId, isActive])
}
```

---

### 3.5. Ca làm việc & Chính sách

```prisma
enum ShiftType {
  FIXED        // ca hành chính
  ROTATING     // ca xoay / ca kíp
  FLEXIBLE     // ca linh hoạt theo tổng giờ
}

model Shift {
  id             String    @id @default(cuid())
  companyId      String
  company        Company   @relation(fields: [companyId], references: [id])
  name           String                            // "Hành chính", "Ca đêm"
  type           ShiftType @default(FIXED)
  /// Giờ dạng "HH:mm" theo timezone công ty
  startTime      String?
  endTime        String?
  /// true nếu ca kết thúc vào NGÀY HÔM SAU (ca đêm 22:00 → 06:00)
  crossesMidnight Boolean  @default(false)
  breakMinutes   Int       @default(0)
  /// Ca linh hoạt: tổng phút phải làm trong ngày
  requiredMinutes Int?
  lateToleranceMinutes  Int @default(0)
  earlyLeaveToleranceMinutes Int @default(0)
  /// Hiệu lực theo thời gian (D6)
  effectiveFrom  DateTime
  effectiveTo    DateTime?

  segments       ShiftSegment[]
  assignments    ShiftAssignment[]
  createdAt      DateTime  @default(now())
  deletedAt      DateTime?

  @@index([companyId, effectiveFrom])
}

/// Ca gãy: sáng 08:00-12:00, chiều 14:00-18:00
model ShiftSegment {
  id        String @id @default(cuid())
  shiftId   String
  shift     Shift  @relation(fields: [shiftId], references: [id])
  order     Int
  startTime String
  endTime   String

  @@index([shiftId])
}

model ShiftAssignment {
  id         String   @id @default(cuid())
  companyId  String
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id])
  shiftId    String
  shift      Shift    @relation(fields: [shiftId], references: [id])
  /// Ngày làm việc áp dụng (theo timezone công ty)
  workDate   DateTime @db.Date
  createdBy  String?
  createdAt  DateTime @default(now())

  @@unique([employeeId, workDate])
  @@index([companyId, workDate])
}

model Holiday {
  id           String   @id @default(cuid())
  companyId    String
  company      Company  @relation(fields: [companyId], references: [id])
  name         String
  date         DateTime @db.Date
  /// Nghỉ bù khi lễ trùng cuối tuần
  substituteDate DateTime? @db.Date
  /// Hệ số OT áp dụng cho ngày này
  otMultiplier Decimal  @default(3.0) @db.Decimal(4, 2)
  branchIds    String[] @default([])            // rỗng = áp dụng toàn công ty
  createdAt    DateTime @default(now())

  @@unique([companyId, date])
  @@index([companyId, date])
}

/// Toàn bộ chính sách cấu hình được của công ty (BR-12).
/// Lưu dạng key-value có phiên bản để đổi chính sách không phá dữ liệu cũ (D6).
model CompanyPolicy {
  id            String   @id @default(cuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id])
  key           String                            // "attendance.geofence.outOfRangeAction"
  value         Json
  effectiveFrom DateTime
  effectiveTo   DateTime?
  updatedBy     String?
  createdAt     DateTime @default(now())

  @@index([companyId, key, effectiveFrom])
}

model LeavePolicy {
  id                  String   @id @default(cuid())
  companyId           String
  contractType        String?                     // null = áp dụng chung
  baseDaysPerYear     Decimal  @db.Decimal(5, 2) @default(12)
  seniorityBonusDays  Decimal  @db.Decimal(5, 2) @default(1)
  seniorityEveryYears Int      @default(5)
  allowCarryOver      Boolean  @default(true)
  maxCarryOverDays    Decimal? @db.Decimal(5, 2)
  carryOverExpireMonth Int?    @default(3)        // hết hạn tháng 3 năm sau
  accrualMode         String   @default("YEARLY") // "YEARLY" | "MONTHLY"
  effectiveFrom       DateTime
  effectiveTo         DateTime?
  createdAt           DateTime @default(now())

  @@index([companyId, effectiveFrom])
}

model LeaveBalance {
  id            String   @id @default(cuid())
  companyId     String
  employeeId    String
  employee      Employee @relation(fields: [employeeId], references: [id])
  year          Int
  entitledDays  Decimal  @db.Decimal(5, 2)        // được cấp
  carriedOverDays Decimal @db.Decimal(5, 2) @default(0)
  usedDays      Decimal  @db.Decimal(5, 2) @default(0)
  pendingDays   Decimal  @db.Decimal(5, 2) @default(0)  // đang chờ duyệt
  updatedAt     DateTime @updatedAt

  @@unique([employeeId, year])
  @@index([companyId, year])
}
```

---

### 3.6. Chấm công

```prisma
enum AttendanceType {
  CHECK_IN
  CHECK_OUT
  BREAK_OUT
  BREAK_IN
  RANDOM_CHECK       // AF-20
}

enum AuthMethod {
  FACE
  FINGERPRINT
  MANUAL             // do HR/Kế toán bổ sung
  KIOSK
}

enum AttendanceDecision {
  ACCEPTED
  FLAGGED            // chấp nhận nhưng gắn cờ
  PENDING_REVIEW     // chờ duyệt mới tính công
  REJECTED
}

/// ⚠ BẢNG THÔ — BẤT BIẾN. KHÔNG BAO GIỜ UPDATE hay DELETE (BR-06, ADR-08).
/// Mọi hiệu chỉnh tạo bản ghi AttendanceAdjustment riêng.
model AttendanceLog {
  id                String   @id @default(cuid())
  companyId         String
  employeeId        String
  employee          Employee @relation(fields: [employeeId], references: [id])
  branchId          String?
  type              AttendanceType
  authMethod        AuthMethod

  /// ⏰ THỜI GIAN CHÍNH THỨC — server timestamp (BR-01, AF-17)
  recordedAt        DateTime @default(now())
  /// Giờ client gửi lên — CHỈ để đối chiếu, KHÔNG dùng tính công (AF-18)
  clientReportedAt  DateTime?
  clockSkewSeconds  Int?
  /// Ngày làm việc quy đổi theo timezone công ty. Ca đêm gắn với NGÀY BẮT ĐẦU CA.
  workDate          DateTime @db.Date

  /// Vị trí
  latitude          Float?
  longitude         Float?
  gpsAccuracy       Float?
  locationProvider  String?                       // "gps" | "network" | "fused" | "mock"
  isMockLocation    Boolean  @default(false)
  distanceToBranchM Float?
  insideGeofence    Boolean?
  wifiBssid         String?
  beaconUuid        String?

  /// Thiết bị & mạng
  deviceId          String?
  deviceModel       String?
  osVersion         String?
  appVersion        String?
  isRootedDevice    Boolean  @default(false)
  attestationPassed Boolean?
  ipAddress         String?

  /// Kết quả AI
  matchScore        Float?
  livenessScore     Float?
  imageQuality      Json?                         // { blur, brightness, yaw, facePx }
  livenessChallenge String?                       // "BLINK" | "TURN_LEFT" | ...
  aiModelVersion    String?
  aiProcessingMs    Int?

  /// Bằng chứng
  photoKey          String?                       // S3 key
  photoHash         String?

  /// Đánh giá rủi ro
  fraudScore        Int      @default(0)
  decision          AttendanceDecision @default(ACCEPTED)

  /// Nguồn
  isOffline         Boolean  @default(false)
  createdByUserId   String?                       // khi authMethod = MANUAL

  fraudFlags        FraudFlag[]
  adjustments       AttendanceAdjustment[]

  createdAt         DateTime @default(now())

  @@index([companyId, employeeId, workDate])
  @@index([companyId, workDate])
  @@index([companyId, decision])
  @@index([employeeId, recordedAt])
}

model FraudFlag {
  id              String   @id @default(cuid())
  companyId       String
  attendanceLogId String
  attendanceLog   AttendanceLog @relation(fields: [attendanceLogId], references: [id])
  employeeId      String
  /// Mã cờ: MOCK_LOCATION | ROOTED_DEVICE | CLOCK_TAMPERING | IMPOSSIBLE_TRAVEL |
  ///        MULTI_DEVICE_ANOMALY | OUT_OF_GEOFENCE | LOW_LIVENESS | SHORT_ATTENDANCE | ...
  code            String
  severity        String                          // "LOW" | "MEDIUM" | "HIGH"
  score           Int
  details         Json?
  /// Xử lý (AF-23)
  reviewedBy      String?
  reviewedAt      DateTime?
  reviewDecision  String?                         // "KEEP" | "VOID" | "ESCALATE"
  reviewReason    String?
  createdAt       DateTime @default(now())

  @@index([companyId, createdAt])
  @@index([companyId, reviewedAt])
  @@index([attendanceLogId])
}

/// Hiệu chỉnh công thủ công — KHÔNG sửa đè AttendanceLog (BR-ADJ-01)
model AttendanceAdjustment {
  id              String   @id @default(cuid())
  companyId       String
  employeeId      String
  workDate        DateTime @db.Date
  /// null nếu là BỔ SUNG bản ghi hoàn toàn mới (quên chấm công)
  attendanceLogId String?
  attendanceLog   AttendanceLog? @relation(fields: [attendanceLogId], references: [id])
  adjustType      String                          // "ADD" | "MODIFY_TIME" | "VOID"
  beforeValue     Json?
  afterValue      Json?
  reason          String
  /// Đơn "Bổ sung công" liên quan (nếu có)
  requestId       String?
  createdByUserId String
  createdAt       DateTime @default(now())

  @@index([companyId, employeeId, workDate])
}

enum DailyStatus {
  ON_TIME
  LATE
  EARLY_LEAVE
  LATE_AND_EARLY
  OVERTIME
  INSUFFICIENT
  ON_LEAVE
  HOLIDAY
  ABSENT
  MISSING_RECORD
}

/// ✅ BẢNG ĐÃ TÍNH — tính lại được bất cứ lúc nào (ADR-08).
/// Job tính công phải IDEMPOTENT.
model AttendanceDaily {
  id                 String   @id @default(cuid())
  companyId          String
  employeeId         String
  employee           Employee @relation(fields: [employeeId], references: [id])
  workDate           DateTime @db.Date
  shiftId            String?

  firstCheckInAt     DateTime?
  lastCheckOutAt     DateTime?
  workedMinutes      Int      @default(0)
  breakMinutes       Int      @default(0)
  lateMinutes        Int      @default(0)
  earlyLeaveMinutes  Int      @default(0)
  otMinutes          Int      @default(0)
  otMultiplier       Decimal? @db.Decimal(4, 2)
  makeupMinutes      Int      @default(0)
  /// Số công chuẩn quy đổi
  standardDays       Decimal  @db.Decimal(5, 3) @default(0)
  status             DailyStatus @default(ABSENT)
  /// Đơn từ ảnh hưởng ngày này
  appliedRequestIds  String[] @default([])
  hasFraudFlag       Boolean  @default(false)
  /// Truy vết: lần tính gần nhất và phiên bản engine
  calculatedAt       DateTime @default(now())
  calcEngineVersion  String?
  /// Snapshot chi tiết phục vụ giải trình "con số này ra từ đâu"
  breakdown          Json?

  @@unique([employeeId, workDate])
  @@index([companyId, workDate])
  @@index([companyId, employeeId, workDate])
  @@index([companyId, status])
}
```

---

### 3.7. Đơn từ

```prisma
enum RequestStatus {
  DRAFT
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

/// Loại đơn cấu hình được theo công ty (không hard-code enum)
model RequestType {
  id                String  @id @default(cuid())
  companyId         String
  company           Company @relation(fields: [companyId], references: [id])
  code              String                        // "ANNUAL_LEAVE" | "GO_OUT" | "MAKEUP" | ...
  name              String
  /// Trừ vào đâu: "ANNUAL_LEAVE" | "NONE" | "UNPAID" | "OT_CREDIT" | "MAKEUP_CREDIT"
  deductFrom        String  @default("NONE")
  unit              String  @default("DAY")       // "DAY" | "HALF_DAY" | "HOUR"
  requiresAttachment Boolean @default(false)
  requiresPreApproval Boolean @default(false)     // OT phải duyệt trước mới tính
  maxDaysPerRequest Int?
  isActive          Boolean @default(true)
  approvalFlow      ApprovalFlow?
  requests          LeaveRequest[]

  @@unique([companyId, code])
  @@index([companyId])
}

model ApprovalFlow {
  id            String  @id @default(cuid())
  companyId     String
  requestTypeId String  @unique
  requestType   RequestType @relation(fields: [requestTypeId], references: [id])
  steps         ApprovalFlowStep[]
}

model ApprovalFlowStep {
  id           String  @id @default(cuid())
  flowId       String
  flow         ApprovalFlow @relation(fields: [flowId], references: [id])
  order        Int
  /// Ai duyệt: "DIRECT_MANAGER" | "DEPARTMENT_HEAD" | "HR_PAYROLL" | "COMPANY_ADMIN"
  approverRole String
  isRequired   Boolean @default(true)
  /// Điều kiện kích hoạt bước này, VD { "minDays": 3 }
  condition    Json?

  @@index([flowId, order])
}

model LeaveRequest {
  id             String        @id @default(cuid())
  companyId      String
  employeeId     String
  employee       Employee      @relation(fields: [employeeId], references: [id])
  requestTypeId  String
  requestType    RequestType   @relation(fields: [requestTypeId], references: [id])
  status         RequestStatus @default(DRAFT)

  startAt        DateTime
  endAt          DateTime
  /// Số ngày/giờ quy đổi
  quantity       Decimal       @db.Decimal(6, 2)
  isHalfDay      Boolean       @default(false)
  reason         String        @db.Text
  /// Cho đơn "Xin ra ngoài": giờ đi/về dự kiến
  expectedReturnAt DateTime?

  submittedAt    DateTime?
  decidedAt      DateTime?
  rejectReason   String?
  cancelledAt    DateTime?
  cancelledBy    String?

  approvalSteps  ApprovalStep[]
  attachments    RequestAttachment[]

  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([companyId, status])
  @@index([companyId, employeeId, startAt])
  @@index([employeeId, status])
}

model ApprovalStep {
  id           String   @id @default(cuid())
  companyId    String
  requestId    String
  request      LeaveRequest @relation(fields: [requestId], references: [id])
  order        Int
  approverRole String
  /// Người được phân công duyệt (giải quyết cụ thể tại thời điểm gửi đơn)
  approverId   String?
  status       String   @default("PENDING")       // "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED"
  decidedAt    DateTime?
  comment      String?
  /// Người duyệt thay (khi người duyệt chính vắng mặt - BR-APV-04)
  delegatedFrom String?

  @@index([companyId, status])
  @@index([requestId, order])
  @@index([approverId, status])
}

model RequestAttachment {
  id         String   @id @default(cuid())
  companyId  String
  requestId  String
  request    LeaveRequest @relation(fields: [requestId], references: [id])
  fileKey    String                                // S3 key
  fileName   String
  mimeType   String
  sizeBytes  Int
  uploadedAt DateTime @default(now())

  @@index([requestId])
}
```

---

### 3.8. Làm bù, kỳ lương

```prisma
model MakeupWorkRecord {
  id             String   @id @default(cuid())
  companyId      String
  employeeId     String
  employee       Employee @relation(fields: [employeeId], references: [id])
  /// Ngày phát sinh nợ công
  debtWorkDate   DateTime @db.Date
  debtMinutes    Int
  /// Ngày thực hiện làm bù
  makeupWorkDate DateTime? @db.Date
  makeupMinutes  Int      @default(0)
  remainingMinutes Int
  /// Hạn phải làm bù
  dueDate        DateTime? @db.Date
  requestId      String?
  status         String   @default("OPEN")         // "OPEN" | "PARTIAL" | "COMPLETED" | "EXPIRED"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([companyId, employeeId, status])
}

enum PayrollPeriodStatus {
  OPEN
  REVIEWING
  CLOSED
}

model PayrollPeriod {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  name        String                               // "Tháng 08/2026"
  startDate   DateTime @db.Date
  endDate     DateTime @db.Date
  status      PayrollPeriodStatus @default(OPEN)
  closedAt    DateTime?
  closedBy    String?
  /// Mở lại kỳ đã chốt — thao tác đặc quyền (BR-07)
  reopenedAt  DateTime?
  reopenedBy  String?
  reopenReason String?
  summaries   PayrollSummary[]
  createdAt   DateTime @default(now())

  @@unique([companyId, startDate, endDate])
  @@index([companyId, status])
}

/// Snapshot bảng công tại thời điểm chốt kỳ — BẤT BIẾN sau khi chốt
model PayrollSummary {
  id                String   @id @default(cuid())
  companyId         String
  periodId          String
  period            PayrollPeriod @relation(fields: [periodId], references: [id])
  employeeId        String
  standardDays      Decimal  @db.Decimal(6, 2)
  workedMinutes     Int
  otMinutesNormal   Int      @default(0)
  otMinutesWeekend  Int      @default(0)
  otMinutesHoliday  Int      @default(0)
  lateCount         Int      @default(0)
  lateMinutesTotal  Int      @default(0)
  earlyLeaveCount   Int      @default(0)
  leaveDays         Decimal  @db.Decimal(5, 2) @default(0)
  unpaidLeaveDays   Decimal  @db.Decimal(5, 2) @default(0)
  makeupMinutes     Int      @default(0)
  penaltyAmount     Decimal? @db.Decimal(14, 2)
  violationCount    Int      @default(0)
  /// Chi tiết để giải trình
  breakdown         Json?
  calculatedAt      DateTime @default(now())

  @@unique([periodId, employeeId])
  @@index([companyId, periodId])
}
```

---

### 3.9. Hệ thống

```prisma
model Notification {
  id          String   @id @default(cuid())
  companyId   String?
  /// Người nhận. null + companyId → thông báo toàn công ty
  employeeId  String?
  departmentId String?
  type        String                               // "REQUEST_APPROVED" | "ATTENDANCE_REMINDER" | ...
  title       String
  body        String   @db.Text
  data        Json?
  channel     String   @default("PUSH")            // "PUSH" | "IN_APP" | "SMS" | "EMAIL"
  scheduledAt DateTime?
  sentAt      DateTime?
  readAt      DateTime?
  createdBy   String?
  createdAt   DateTime @default(now())

  @@index([companyId, employeeId, readAt])
  @@index([scheduledAt, sentAt])
}

/// Append-only. KHÔNG cho update/delete kể cả Admin (BR-08).
model AuditLog {
  id          String   @id @default(cuid())
  companyId   String?
  actorUserId String?
  actorName   String?
  actorRole   String?
  actorIp     String?
  actorUserAgent String?
  action      String                               // "BIOMETRIC_RESET" | "PAYROLL_REOPEN" | ...
  targetType  String?
  targetId    String?
  reason      String?
  before      Json?
  after       Json?
  traceId     String?
  createdAt   DateTime @default(now())

  @@index([companyId, createdAt])
  @@index([actorUserId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
}

/// Cấu hình toàn hệ thống (Admin) — khác CompanyPolicy (cấu hình theo công ty)
model SystemConfig {
  key         String   @id
  value       Json
  description String?
  updatedBy   String?
  updatedAt   DateTime @updatedAt
}

model AiModelVersion {
  id            String   @id @default(cuid())
  name          String                             // "buffalo_l"
  version       String                             // "2.1"
  isActive      Boolean  @default(false)
  /// Kết quả đo trên tập kiểm định
  farMeasured   Float?
  frrMeasured   Float?
  latencyP95Ms  Int?
  defaultMatchThreshold Float?
  defaultLivenessThreshold Float?
  deployedAt    DateTime?
  rolledBackAt  DateTime?
  notes         String?
  createdAt     DateTime @default(now())

  @@unique([name, version])
}
```

---

## 4. Ghi chú thi công quan trọng

### 4.1. `AttendanceLog` là bảng lớn nhất hệ thống

```
Ước tính: 500 nhân viên × 4 lượt/ngày × 250 ngày/năm = 500.000 dòng/năm/công ty
100 công ty → 50 triệu dòng/năm

→ Chuẩn bị PARTITION theo tháng ngay từ đầu:
   CREATE TABLE attendance_log_2026_08 PARTITION OF attendance_log
     FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

→ Prisma chưa hỗ trợ partition trực tiếp — dùng raw SQL migration.
→ Ảnh KHÔNG lưu trong DB, chỉ lưu S3 key.
```

### 4.2. Truy vấn embedding

```sql
-- Với pgvector (khuyến nghị khi > 5.000 nhân viên/công ty)
SELECT employee_id, 1 - (embedding <=> $1::vector) AS score
FROM face_profile
WHERE company_id = $2 AND status = 'ACTIVE'
ORDER BY embedding <=> $1::vector
LIMIT 5;

-- Index
CREATE INDEX ON face_profile USING hnsw (embedding vector_cosine_ops);
```

Với chấm công qua App (mô hình **1:1** — đã đăng nhập nên biết là ai), chỉ cần lấy embedding của đúng nhân viên đó và so sánh — **không cần pgvector**. pgvector chỉ cần khi làm kiosk 1:N. Xem `00-kien-thuc-nen-tang.md` Phần 2 về bẫy 1:N.

### 4.3. Ràng buộc cần enforce ở tầng DB

```sql
-- Employee code duy nhất trong công ty
ALTER TABLE employee ADD CONSTRAINT uq_employee_code
  UNIQUE (company_id, employee_code);

-- Một nhân viên chỉ một bản ghi daily cho mỗi ngày
ALTER TABLE attendance_daily ADD CONSTRAINT uq_daily
  UNIQUE (employee_id, work_date);

-- Không cho sửa/xoá AttendanceLog (BR-06) — dùng trigger
CREATE RULE no_update_attendance_log AS
  ON UPDATE TO attendance_log DO INSTEAD NOTHING;
CREATE RULE no_delete_attendance_log AS
  ON DELETE TO attendance_log DO INSTEAD NOTHING;

-- Không cho sửa/xoá AuditLog
CREATE RULE no_update_audit_log AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_log AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- Row-Level Security làm lớp phòng thủ thứ hai cho multi-tenant (ADR-05)
ALTER TABLE employee ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee
  USING (company_id = current_setting('app.company_id', true));
```

### 4.4. Index cần có ngay từ đầu

| Bảng | Index | Phục vụ truy vấn |
|---|---|---|
| `attendance_log` | `(company_id, employee_id, work_date)` | Lịch sử chấm công của nhân viên |
| `attendance_log` | `(company_id, work_date)` | Danh sách chấm công theo ngày (Web QL) |
| `attendance_daily` | `(company_id, work_date)` | Dashboard, báo cáo |
| `leave_request` | `(company_id, status)` | Danh sách đơn chờ duyệt |
| `approval_step` | `(approver_id, status)` | "Đơn tôi cần duyệt" |
| `fraud_flag` | `(company_id, reviewed_at)` | Dashboard cảnh báo — cờ chưa xử lý |
| `employee` | `(company_id, status)` | Danh sách nhân viên đang làm việc |
| `audit_log` | `(company_id, created_at)` | Tra cứu audit |

### 4.5. Dữ liệu khởi tạo (seed)

Khi tạo tenant mới, seed sẵn:

- `RequestType` mặc định: Nghỉ phép, Xin ra ngoài, Về sớm, Làm bù, Nghỉ không lương, Công tác, Bổ sung công, Đăng ký OT.
- `ApprovalFlow` mặc định: 1 cấp (Quản lý trực tiếp) cho hầu hết loại đơn; 2 cấp (Quản lý → Kế toán) cho "Bổ sung công".
- `Shift` mặc định: Ca hành chính 08:00–17:30, nghỉ trưa 60 phút, trễ cho phép 5 phút.
- `LeavePolicy` mặc định: 12 ngày/năm, cộng dồn tối đa 5 ngày, hết hạn 31/03 năm sau.
- `Holiday`: danh mục ngày lễ Việt Nam của năm hiện tại.
- `CompanyPolicy` mặc định: geofence 100m, hành động ngoài vùng = cảnh báo, ngưỡng match 0.45, liveness 0.70.

---

**Tiếp theo:** [08 — Hợp đồng API](./08-hop-dong-api.md)
