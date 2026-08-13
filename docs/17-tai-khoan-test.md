# 17 — Tài khoản đăng nhập để test

> ⚠ **CHỈ dành cho môi trường phát triển.** Mật khẩu trong tài liệu này nằm công
> khai trong mã nguồn (`prisma/seed.ts`). Seed không bao giờ được chạy trên
> production.

Nguồn sự thật là [`server-backend-smart/prisma/seed.ts`](../server-backend-smart/prisma/seed.ts).
Sửa tài khoản ở đó thì cập nhật lại bảng dưới đây.

---

## 1. Mật khẩu

**Mọi tài khoản seed dùng chung một mật khẩu:**

```
SmartFaceDev2026
```

Định nghĩa tại `seed.ts` — hằng `SEED_PASSWORD`.

Tất cả đều đặt `mustChangePassword: false` để đội thi công không phải đổi mật
khẩu lại sau mỗi lần reset cơ sở dữ liệu. Tài khoản do HR cấp qua API thì **luôn**
bắt đổi ở lần đăng nhập đầu.

---

## 2. Danh sách tài khoản

Công ty demo: **Công ty AMOBI** — mã `amobi`, tên miền `amobi.vn`, gói `Pro`,
chi nhánh `Văn phòng Hà Nội`.

| # | Email | Họ tên | Vai trò | Phòng ban · Chức vụ | Điện thoại | Đăng nhập ở đâu |
|---|---|---|---|---|---|---|
| 1 | `admin@smartface.vn` | Quản trị hệ thống | `SYSTEM_ADMIN` | — (không thuộc công ty nào) | — | Web Admin |
| 2 | `an@amobi.vn` | Phạm Thị An | `COMPANY_ADMIN` + `HR_PAYROLL` + `EMPLOYEE` | Kế toán · Kế toán trưởng | `0901234570` | Web Quản lý |
| 3 | `hoa@amobi.vn` | Lê Thị Hoa | `HR_PAYROLL` + `EMPLOYEE` | Nhân sự · Chuyên viên nhân sự | `0901234569` | Web Quản lý |
| 4 | `binh@amobi.vn` | Trần Văn Bình | `MANAGER` + `EMPLOYEE` | Kỹ thuật · Trưởng phòng | `0901234568` | Web Quản lý |
| 5 | `duc@amobi.vn` | Nguyễn Văn Đức | `EMPLOYEE` | Kỹ thuật · Nhân viên | `0901234567` | App nhân viên |

### Nên dùng tài khoản nào

- **Test Web Quản lý (`web-smart`)** → dùng `an@amobi.vn`. Đây là tài khoản duy
  nhất thấy được toàn bộ menu.
- **Test giới hạn phạm vi phòng ban** → dùng `binh@amobi.vn`. `MANAGER` bị giới
  hạn hai chiều: theo vai trò, và theo phòng ban được phân công (Backend tự chèn
  điều kiện vào query).
- **Test nghiệp vụ nhân sự / bảng lương** → dùng `hoa@amobi.vn`.
- **Test App nhân viên (`app-smart`)** → dùng `duc@amobi.vn`.

> ⚠ `duc@amobi.vn` **không dùng để test Web Quản lý được.** Nó chỉ có vai trò
> `EMPLOYEE`, không nằm trong bất kỳ ô nào của ma trận phân quyền, nên đăng nhập
> vào được nhưng hầu hết trang sẽ hiện "Bạn không có quyền xem mục này"
> (`RequirePermission` — `web-smart/src/routes/guards.tsx`).

> ℹ Web Admin (`admin-smart`) hiện mới chỉ có `README.md`, chưa thi công. Tài
> khoản `admin@smartface.vn` tạm thời chưa có giao diện để đăng nhập.

---

## 3. Vai trò nào thấy được gì trên Web Quản lý

Rút từ `web-smart/src/lib/rbac/permissions.ts` (bản sao của bảng ở
[docs/04 mục 1](./04-nghiep-vu-web-quan-ly.md)).

| Chức năng | `COMPANY_ADMIN` (an) | `HR_PAYROLL` (hoa) | `MANAGER` (binh) |
|---|:--:|:--:|:--:|
| Xem bảng điều khiển | ✓ | ✓ | ✓ |
| Xem chấm công | ✓ | ✓ | ✓ |
| Hiệu chỉnh chấm công | ✓ | ✓ | — |
| Xuất chấm công | ✓ | ✓ | ✓ |
| Xem / duyệt đơn từ | ✓ | ✓ | ✓ |
| Xem chính sách | ✓ | ✓ | — |
| Sửa chính sách | ✓ | — | — |
| Xem bảng lương | ✓ | ✓ | — |
| Tính lương | — | ✓ | — |
| Chốt lương | ✓ | ✓ | — |
| Xem nhân viên | ✓ | ✓ | ✓ |
| Sửa / nhập khẩu nhân viên | ✓ | ✓ | — |
| Phân ca | ✓ | ✓ | ✓ |
| Xem báo cáo | ✓ | ✓ | ✓ |
| Xem cảnh báo gian lận | ✓ | ✓ | ✓ |
| Xử lý cảnh báo gian lận | ✓ | ✓ | — |
| Gửi thông báo | ✓ | ✓ | ✓ |
| Xem nhật ký kiểm toán | ✓ | ✓ | — |
| Quản lý lời mời | ✓ | ✓ | — |
| Thu hồi thiết bị | ✓ | ✓ | — |
| Đặt lại sinh trắc học | ✓ | ✓ | — |

Hai chỗ cố ý không giao cho `MANAGER`: **hiệu chỉnh chấm công** và **xử lý cảnh
báo gian lận** — cả hai đều ảnh hưởng thẳng tới bảng lương.

---

## 4. Luồng đăng nhập — hiểu để đọc đúng lỗi

Backend **không lưu mật khẩu dưới bất kỳ dạng nào**. Đăng nhập luôn đi qua hai
bước, và biết lỗi rơi ở bước nào là biết ngay phải sửa ở đâu:

```
① Firebase Authentication          signInWithEmailAndPassword(email, password)
   kiểm mật khẩu                 → trả về Firebase ID token
                                    ↓
② Backend NestJS                   POST /v1/auth/session { firebaseIdToken }
   xác minh token, tra công ty,  → trả về accessToken + refreshToken
   quyết định quyền
```

`domain` là **tuỳ chọn** — bỏ trống thì Backend tự suy công ty từ tài khoản
(quan hệ tài khoản–công ty là 1–1). Web Quản lý không hỏi tên miền; App Flutter
và các bản cũ vẫn gửi lên và khi đó tên miền phải khớp.

---

## 5. Điều kiện để đăng nhập chạy được

Đủ **cả bốn** thứ sau:

| Thành phần | Kiểm tra bằng |
|---|---|
| Postgres + Redis đang chạy | `docker ps` |
| Backend đang chạy ở cổng 3000 | mở `http://localhost:3000/health` |
| Web đang chạy ở cổng 5173 | `cd web-smart; npm run dev` |
| Đã chạy seed với `FIREBASE_PROJECT_ID` | xem mục 6 |

Web và Backend **bắt buộc trỏ cùng một dự án Firebase**, nếu không Backend sẽ
không xác minh được ID token do Web gửi lên:

- `web-smart/.env` → `VITE_FIREBASE_PROJECT_ID`
- `server-backend-smart/.env` → `FIREBASE_PROJECT_ID`

Hiện tại cả hai đều là `smart-face-bf8e2`.

---

## 6. Tạo lại tài khoản

Seed tạo tài khoản ở **cả hai nơi** — Firebase (giữ mật khẩu) và bảng
`user_account` (giữ nghiệp vụ), vì `UserAccount.firebaseUid` là bắt buộc. Chạy
seed mà bỏ qua Firebase sẽ sinh ra một cơ sở dữ liệu không tài khoản nào đăng
nhập được.

```powershell
cd server-backend-smart
npm run seed
```

Chạy lại nhiều lần vẫn an toàn: hàm `upsertFirebaseUser` gặp email đã tồn tại
thì đặt lại mật khẩu về `SmartFaceDev2026` và mở khoá tài khoản, thay vì báo lỗi.

**Khuyến nghị dùng Auth Emulator** khi phát triển để không đụng vào dự án
Firebase thật:

```powershell
firebase emulators:start --only auth
# rồi ở cửa sổ khác:
$env:FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'
$env:FIREBASE_PROJECT_ID = 'demo-smartface'
npm run seed
```

---

## 7. Lỗi hay gặp và nguyên nhân thật

| Thông báo trên màn hình | Rơi ở bước | Nguyên nhân thật |
|---|:--:|---|
| "Email hoặc mật khẩu không đúng." | ① | Sai mật khẩu, **hoặc** email chưa tồn tại bên Firebase (chưa chạy seed với dự án đang dùng). Firebase cố ý gộp hai trường hợp làm một để không lộ email nào có thật. |
| "Tài khoản đã bị vô hiệu hoá." | ① | `disabled: true` bên Firebase Console. |
| "Bạn đã thử quá nhiều lần." | ① | Firebase chặn tạm thời. Chờ vài phút. |
| "Máy chủ trả về phản hồi không đọc được." | ② | **Backend chưa chạy.** Vite proxy `/v1` sang `localhost:3000` không gặp ai nên trả 500 thân rỗng. Mật khẩu đã đúng rồi — bước ① đã qua. |
| "Chưa cấu hình Firebase — chưa đăng nhập được" | trước ① | Thiếu biến trong `web-smart/.env`. Màn hình sẽ nói rõ thiếu biến nào. |
| `AUTH_ACCOUNT_NOT_PROVISIONED` | ② | Có tài khoản Firebase nhưng chưa có hồ sơ trong `user_account` — thường do seed chạy dở, hoặc tự đăng ký thẳng qua Firebase SDK. |
| `AUTH_DOMAIN_MISMATCH` | ② | Chỉ xảy ra khi client có gửi `domain` mà tên miền không khớp công ty của tài khoản. |
| `AUTH_COMPANY_INACTIVE` | ② | Công ty đang `SUSPENDED` hoặc `TERMINATED`. |
| "Bạn không có quyền xem mục này" | sau ② | Đăng nhập thành công nhưng vai trò không có quyền — xem lại bảng ở mục 3. Rất hay gặp khi lỡ dùng `duc@amobi.vn` để test Web Quản lý. |

---

## 8. Xác thực 2 lớp

Tài khoản seed **không bật** 2FA nên đăng nhập xong là vào thẳng.

Khi bật (`POST /v1/auth/2fa/setup` → `enable`), đăng nhập sẽ chèn thêm bước nhập
OTP 6 số gửi qua SMS. Ở môi trường phát triển, đặt `OTP_DEBUG_RETURN=true` trong
`server-backend-smart/.env` thì API trả kèm `debugCode` — khỏi cần SMS thật.

Mã dự phòng (8 mã, dạng `xxxx-xxxx`) chỉ hiện **một lần** lúc bật. Server chỉ giữ
bản băm nên không cấp lại được.

---

## 9. Tài liệu liên quan

- [03 — Nghiệp vụ App nhân viên](./03-nghiep-vu-app-nhan-vien.md)
- [04 — Nghiệp vụ Web Quản lý](./04-nghiep-vu-web-quan-ly.md) — ma trận phân quyền gốc
- [05 — Nghiệp vụ Web Admin](./05-nghiep-vu-web-admin.md)
- [08 — Hợp đồng API](./08-hop-dong-api.md) — mục 2: hợp đồng `/auth/session`
- [13 — Luồng onboarding và đăng ký khuôn mặt](./13-luong-onboarding-va-dang-ky-khuon-mat.md)
- [`server-backend-smart/README.md`](../server-backend-smart/README.md) — hướng dẫn dựng môi trường
