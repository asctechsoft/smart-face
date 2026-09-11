# 21 — Tài khoản đăng nhập để test

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

Công ty demo: **Công ty AMOBI** — mã `amobi`, tên miền `amobi.vn`, gói `Plus`,
chi nhánh `Văn phòng Hà Nội`.

**Một vai trò một tài khoản.** Không tài khoản nào mang hai vai trò — đó là điều
kiện để kiểm được ranh giới quyền, và nó cũng là lý do bản trước không dùng
được: `an@amobi.vn` từng mang cả `COMPANY_ADMIN` lẫn `HR_PAYROLL`, nên mở màn
Kỳ công sẽ thấy **cả** "Gửi duyệt chốt" **lẫn** "Duyệt chốt" trên cùng một hàng
— đúng cái mà ranh giới #1 của [docs/08 §1.1](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md)
sinh ra để ngăn.

| Vai trò | Email | Họ tên | Phạm vi dữ liệu | Số quyền | Đăng nhập vào |
|---|---|---|---|:--:|---|
| Quản trị nền tảng | `admin@smartface.vn` | Quản trị hệ thống | `PLATFORM` | 9 | Cụm `/system/*` |
| Chủ sở hữu | `owner@amobi.vn` | Vũ Quốc Khánh | `COMPANY` | 41 | Web Giám đốc |
| Giám đốc | `an@amobi.vn` | Phạm Thị An | `COMPANY` | 40 | Web Giám đốc |
| Kế toán / HR | `hoa@amobi.vn` | Lê Thị Hoa | `COMPANY` | 26 | Web Kế toán |
| Quản lý | `binh@amobi.vn` | Trần Văn Bình | `DEPARTMENT` — chỉ phòng Kỹ thuật | 9 | Web Kế toán, dữ liệu bị cắt |
| Nhân viên | `duc@amobi.vn` | Nguyễn Văn Đức | `COMPANY` | 2 | App Nhân viên |

Số quyền lấy từ `role_permission` sau khi seed, đối chiếu với
[`permission.constants.ts`](../server-backend-smart/src/modules/access/permission.constants.ts).

### Bốn ô đáng nhìn nhất

Đây là chỗ bảng phân quyền trở thành thứ nhìn thấy được trên màn hình:

| Quyền | Chủ sở hữu | Giám đốc | Kế toán | Quản lý | Nhân viên |
|---|:--:|:--:|:--:|:--:|:--:|
| `period.submit_lock` — gửi đề nghị chốt kỳ | — | — | ✓ | — | — |
| `period.approve_lock` — duyệt chốt kỳ | ✓ | ✓ | — | — | — |
| `shift.assign` — phân ca | ✓ | ✓ | — | — | — |
| `owner.assign` — chỉ định chủ sở hữu | ✓ | — | — | — | — |

Hai dòng đầu là **ranh giới #1**: không ai vừa gửi vừa duyệt. Mở
`/exec/periods` bằng `hoa@amobi.vn` sẽ thấy nút "Gửi duyệt chốt"; mở đúng màn đó
bằng `an@amobi.vn` sẽ thấy "Duyệt chốt kỳ" và một dòng chữ giải thích thay cho
nút kia. Khoá lại bằng
[`role-matrix.spec.ts`](../server-backend-smart/src/modules/access/role-matrix.spec.ts).

### Nên dùng tài khoản nào

- **Xem giao diện đổi theo vai trò** → đăng nhập lần lượt `hoa` rồi `an`, so
  thanh điều hướng và màn `/exec/periods`.
- **Kiểm giới hạn phạm vi phòng ban** → `binh@amobi.vn`. Backend tự chèn điều
  kiện phòng ban vào truy vấn, nên con số trên Tổng quan của anh này khác của
  Kế toán — và đó là hành vi đúng.
- **Xem cụm Quản trị nền tảng** → `admin@smartface.vn`. Tài khoản này **không
  thấy** một màn nghiệp vụ nào của tenant (ranh giới #2), kể cả `/dashboard`.
- **Kiểm rằng nhân viên không vào được Web Quản lý** → `duc@amobi.vn`. Chỉ có 2
  quyền, nên hầu hết trang trả về "Bạn không có quyền xem mục này".

## 3. Vai trò nào thấy gì trên Web

Nguồn duy nhất là
[`permission.constants.ts`](../server-backend-smart/src/modules/access/permission.constants.ts).
Giao diện **không còn bảng phân quyền tĩnh** — nó hỏi `GET /v1/access/me` rồi
dựng thanh điều hướng từ câu trả lời, nên bảng dưới đây mô tả đúng một thứ chứ
không phải hai bản chép tay có thể lệch nhau.

### Thanh điều hướng

| | Kế toán | Quản lý | Giám đốc · Chủ sở hữu | Nền tảng |
|---|---|---|---|---|
| Sidenav | Tổng quan · Theo dõi trong ngày · Bảng công · Đơn từ · **Kỳ công** · Báo cáo | như Kế toán, dữ liệu cắt theo phòng ban | Tổng quan · **Cần duyệt** · Kỳ công · Bảng công · Nhân sự · Báo cáo | Tổng quan · Công ty · Gói dịch vụ · Phiên hỗ trợ · **Giám sát** · Nhật ký |
| Phân ca | ✗ | ✗ | ✓ | ✗ |
| Bánh răng | Nhân viên · Chính sách *(đọc)* · Nhật ký | chỉ Nhân viên | + Phân quyền · Luồng duyệt | **ẩn hẳn** |

### Các ô hay bị nhớ nhầm

| Chức năng | Chủ sở hữu | Giám đốc | Kế toán | Quản lý | Nhân viên |
|---|:--:|:--:|:--:|:--:|:--:|
| Hiệu chỉnh chấm công | ✓ | ✓ | ✓ | — | — |
| Duyệt đơn | ✓ | ✓ | — | ✓ | — |
| Tính công | ✓ | ✓ | ✓ | — | — |
| **Gửi đề nghị chốt kỳ** | — | — | ✓ | — | — |
| **Duyệt chốt kỳ** | ✓ | ✓ | — | — | — |
| Phân ca | ✓ | ✓ | — | — | — |
| Sửa chính sách | ✓ | ✓ | — | — | — |
| Phân quyền | ✓ | ✓ | — | — | — |
| Chỉ định chủ sở hữu | ✓ | — | — | — | — |
| Xem nhật ký kiểm toán | ✓ | ✓ | ✓ | — | — |
| Xuất bảng công | ✓ | ✓ | ✓ | ✓ *(theo phòng)* | — |

Ba chỗ khác với trực giác, và cả ba đều có lý do:

1. **Kế toán không duyệt đơn.** Duyệt đơn là việc của người quản lý trực tiếp và
   Giám đốc. Kế toán *xử lý hậu quả* của đơn trên bảng công.
2. **Kế toán không phân ca, Quản lý cũng không.** `docs/05` §1 ghi "không mặc
   định" — quyền này thuộc Giám đốc và có thể uỷ quyền, không cấp sẵn.
3. **Quản lý xuất được bảng công.** Trông như một ngoại lệ nhưng không phải:
   quyền có, còn dữ liệu bị cắt về phòng ban ở tầng phạm vi. Bị cắt bằng
   **scope**, không bằng cách giấu nút.

Bảng này được khoá hai đầu độc lập:
[`role-matrix.spec.ts`](../server-backend-smart/src/modules/access/role-matrix.spec.ts)
phía Backend (34 test) và
[`nav-items.test.ts`](../web-smart/src/routes/nav-items.test.ts) phía Web
(20 test) — bản Web cố ý chép lại ma trận thay vì dùng chung, vì một bài test
chỉ có giá trị khi nó so hai bản độc lập.

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

- [02 — Nghiệp vụ App Nhân viên](./02-nghiep-vu-app-nhan-vien.md)
- [05 — Nghiệp vụ Web Kế toán](./05-nghiep-vu-web-ke-toan.md) — ma trận phân quyền gốc
- [07 — Nghiệp vụ Web Quản trị nền tảng](./07-nghiep-vu-web-platform-admin.md)
- [15 — Hợp đồng API](./15-hop-dong-api.md) — mục 2: hợp đồng `/auth/session`
- [19 — Luồng onboarding & đăng ký khuôn mặt](./19-luong-onboarding-va-dang-ky-khuon-mat.md)
- [`server-backend-smart/README.md`](../server-backend-smart/README.md) — hướng dẫn dựng môi trường
