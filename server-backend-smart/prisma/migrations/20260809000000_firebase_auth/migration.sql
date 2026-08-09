-- Chuyển nhà cung cấp danh tính sang Firebase Authentication.
--
-- Backend không còn giữ mật khẩu, không còn tự đếm số lần đăng nhập sai, và
-- không còn dùng TOTP (ứng dụng xác thực) làm lớp thứ hai.
--
-- ⚠ MIGRATION NÀY LÀM MẤT DỮ LIỆU KHÔNG KHÔI PHỤC ĐƯỢC.
--
-- `passwordHash` và `twoFactorSecret` bị xoá hẳn. Trước khi chạy trên môi trường
-- có dữ liệu thật, phải hoàn tất việc chuyển tài khoản sang Firebase và điền
-- `firebaseUid`, vì:
--
--   1. Mật khẩu đang lưu bằng scrypt với tham số riêng của `PasswordService`.
--      Firebase KHÔNG nhập được định dạng này (nó chỉ nhận scrypt biến thể của
--      riêng Firebase, bcrypt, PBKDF2, SHA/MD5 với salt). Nên không có đường
--      chuyển mật khẩu tự động: mọi người dùng phải đặt lại mật khẩu.
--   2. Người dùng đang bật 2FA bằng ứng dụng xác thực sẽ bị tắt 2FA sau bước
--      này và phải bật lại bằng số điện thoại.
--
-- Quy trình đề xuất cho môi trường có dữ liệu thật:
--   a. Tạo tài khoản Firebase cho từng UserAccount (script riêng, dùng email sẵn có).
--   b. Chạy migration này.
--   c. UPDATE user_account SET "firebaseUid" = ... theo email.
--   d. Gửi email đặt lại mật khẩu hàng loạt.
--
-- Ở môi trường phát triển thì chạy thẳng rồi seed lại.

-- 1. Cột mới ------------------------------------------------------------------

-- Thêm ở dạng cho phép NULL trước, vì bảng đang có dữ liệu thì `NOT NULL` không
-- có giá trị mặc định sẽ bị Postgres chặn.
ALTER TABLE "user_account" ADD COLUMN "firebaseUid" TEXT;
ALTER TABLE "user_account" ADD COLUMN "twoFactorPhone" TEXT;

-- Điền chỗ trống bằng một giá trị CỐ TÌNH KHÔNG HỢP LỆ, duy nhất theo từng dòng.
--
-- Không để cột này NULL: `firebaseUid` là thứ duy nhất nối danh tính với tài
-- khoản, và một cột cho phép NULL thì chỉ cần một truy vấn viết lỏng tay là khớp
-- nhầm. Cách này hỏng về phía AN TOÀN — uid thật do Firebase cấp không bao giờ
-- có tiền tố này, nên tài khoản chưa chuyển sẽ không đăng nhập được, thay vì
-- đăng nhập được dưới danh tính sai.
--
-- Tìm các dòng còn sót sau khi chuyển:
--   SELECT id, email FROM user_account WHERE "firebaseUid" LIKE 'CHUA-CHUYEN-%';
UPDATE "user_account" SET "firebaseUid" = 'CHUA-CHUYEN-' || "id" WHERE "firebaseUid" IS NULL;

ALTER TABLE "user_account" ALTER COLUMN "firebaseUid" SET NOT NULL;

-- 2. Bỏ cơ chế cũ -------------------------------------------------------------

-- Mật khẩu giờ do Firebase giữ.
ALTER TABLE "user_account" DROP COLUMN "passwordHash";

-- Firebase tự chống dò mật khẩu (giới hạn theo IP + theo tài khoản). Giữ lại
-- bộ đếm ở đây sẽ thành hai nơi cùng quyết định một việc mà không nơi nào thấy
-- hết bức tranh.
ALTER TABLE "user_account" DROP COLUMN "failedLoginCount";
ALTER TABLE "user_account" DROP COLUMN "lockedUntil";

-- Lớp thứ hai đổi từ TOTP sang OTP gửi qua SMS.
ALTER TABLE "user_account" DROP COLUMN "twoFactorSecret";

-- Người đang bật 2FA bằng ứng dụng xác thực sẽ không có secret nữa. Để nguyên
-- `twoFactorEnabled = true` thì họ bị khoá ngoài: hệ thống đòi mã mà không còn
-- chỗ nào sinh ra mã đó. Tắt đi và để họ bật lại bằng số điện thoại.
UPDATE "user_account"
SET "twoFactorEnabled" = false,
    "twoFactorConfirmedAt" = NULL,
    "twoFactorRecoveryCodes" = ARRAY[]::TEXT[]
WHERE "twoFactorEnabled" = true;

-- 3. Ràng buộc ----------------------------------------------------------------

CREATE UNIQUE INDEX "user_account_firebaseUid_key" ON "user_account"("firebaseUid");
