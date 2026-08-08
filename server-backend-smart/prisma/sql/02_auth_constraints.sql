-- Ràng buộc xác thực mà Prisma không diễn đạt được.
--
-- Chạy sau `prisma migrate deploy`:
--   psql "$DATABASE_URL" -f prisma/sql/02_auth_constraints.sql
--   không có psql: npx prisma db execute --schema prisma/schema.prisma --file <tệp này>
--
-- ⚠ Tên cột giữ nguyên camelCase (schema.prisma chỉ `@@map` bảng, không `@map`
--   cột) nên BẮT BUỘC đóng ngoặc kép — xem đầu tệp 01.

-- ---------------------------------------------------------------------------
-- 1. Email duy nhất cho QUẢN TRỊ VIÊN NỀN TẢNG
-- ---------------------------------------------------------------------------
--
-- Schema đã có @@unique([companyId, email]), nhưng ràng buộc đó KHÔNG bảo vệ
-- được tài khoản nền tảng: Postgres coi mọi NULL là khác nhau, nên bộ
-- (NULL, 'admin@smartface.vn') lặp lại bao nhiêu lần cũng lọt qua.
--
-- Hệ quả nếu thiếu chỉ mục này: hai tài khoản quản trị nền tảng cùng email,
-- và việc "đăng nhập bằng email nào thì vào tài khoản nào" trở thành ngẫu nhiên
-- theo thứ tự dòng trả về.
CREATE UNIQUE INDEX IF NOT EXISTS user_account_platform_email_key
  ON user_account (email)
  WHERE "companyId" IS NULL AND "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Email của tài khoản công ty không được lặp sau khi xoá mềm
-- ---------------------------------------------------------------------------
--
-- @@unique([companyId, email]) tính cả bản ghi đã xoá mềm, nên xoá một nhân
-- viên rồi tuyển người mới dùng lại email cũ sẽ bị chặn oan. Chỉ mục một phần
-- dưới đây thay thế, chỉ tính bản ghi còn sống.
--
-- ⚠ Bật chỉ mục này thì PHẢI gỡ @@unique([companyId, email]) khỏi schema.prisma,
-- nếu không hai ràng buộc chồng nhau và cái chặt hơn vẫn thắng.
-- Chưa gỡ vì chưa chốt chính sách tái sử dụng email — xem docs/13.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS user_account_company_email_active_key
--   ON user_account ("companyId", email)
--   WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Tài khoản quản trị nền tảng không được gắn công ty
-- ---------------------------------------------------------------------------
--
-- Chặn ở tầng DB chứ không chỉ ở tầng ứng dụng: một quản trị viên nền tảng bị
-- gán nhầm company_id sẽ vừa có quyền toàn hệ thống vừa lọt vào các truy vấn
-- lọc theo công ty — kết hợp tệ nhất có thể.
ALTER TABLE user_account
  DROP CONSTRAINT IF EXISTS user_account_platform_admin_no_company;

ALTER TABLE user_account
  ADD CONSTRAINT user_account_platform_admin_no_company
  CHECK (NOT ("isSystemAdmin" AND "companyId" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 4. Mật khẩu tạm phải có hạn dùng
-- ---------------------------------------------------------------------------
--
-- Không ràng buộc được bằng CHECK vì cần so với thời gian hiện tại. Việc dọn
-- tài khoản chưa từng đăng nhập quá lâu do tác vụ nền xử lý.
-- Chỉ mục dưới đây để tác vụ đó quét nhanh.
CREATE INDEX IF NOT EXISTS user_account_never_logged_in_idx
  ON user_account ("createdAt")
  WHERE "lastLoginAt" IS NULL AND "deletedAt" IS NULL;
