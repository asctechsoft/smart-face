-- Mã ca: đổi ràng buộc duy nhất đầy đủ thành PARTIAL, chỉ tính bản còn mở.
--
-- Migration trước tạo UNIQUE ("companyId", "code") trên toàn bảng. Ràng buộc đó
-- chặn đúng cơ chế phiên bản hoá D6 của hệ thống: khi HR đổi giờ một ca đã được
-- phân, service ĐÓNG bản hiện tại bằng "effectiveTo" rồi tạo bản kế nhiệm mang
-- CÙNG mã — và bản kế nhiệm sẽ không ghi được.
--
-- Điều kiện `WHERE "effectiveTo" IS NULL` cho đúng ba hành vi cần có:
--   bản đang hiệu lực   → giữ mã, không ai trùng được
--   bản đã đóng (D6)    → nhả mã cho bản kế nhiệm
--   bản xoá mềm         → "effectiveTo" vẫn null nên VẪN giữ mã; mã đã in trên
--                         bảng công không được phép mang nghĩa khác về sau

DROP INDEX IF EXISTS "shift_companyId_code_key";

CREATE UNIQUE INDEX "shift_companyId_code_active_key"
  ON "shift" ("companyId", "code")
  WHERE "effectiveTo" IS NULL;

-- Index thường cho việc tra mã (Prisma khai @@index([companyId, code])).
CREATE INDEX "shift_companyId_code_idx" ON "shift" ("companyId", "code");
