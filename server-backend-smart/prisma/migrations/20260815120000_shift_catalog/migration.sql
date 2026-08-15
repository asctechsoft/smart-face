-- Danh mục ca làm việc (FR-WEB-POL-04)
--
-- Toàn bộ cột mới đều có DEFAULT nên bảng công đang chạy không đổi một số nào.
-- Riêng "code" là NOT NULL + UNIQUE, không có mặc định hợp lý nào cho dữ liệu
-- cũ — nên thêm ở dạng cho phép NULL, điền cho các ca đã có, rồi mới siết lại.
-- Làm gộp một bước sẽ hỏng ngay trên công ty nào đã có ca.

ALTER TABLE "shift"
  ADD COLUMN "code"             TEXT,
  ADD COLUMN "symbol"           TEXT,
  ADD COLUMN "departmentIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requireCheckIn"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInFrom"      TEXT,
  ADD COLUMN "checkInTo"        TEXT,
  ADD COLUMN "requireCheckOut"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkOutFrom"     TEXT,
  ADD COLUMN "checkOutTo"       TEXT,
  ADD COLUMN "breakStart"       TEXT,
  ADD COLUMN "breakEnd"         TEXT,
  ADD COLUMN "workDayCredit"    DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN "normalDayFactor"  DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN "weeklyRestFactor" DECIMAL(4,2) NOT NULL DEFAULT 2.00,
  ADD COLUMN "holidayFactor"    DECIMAL(4,2) NOT NULL DEFAULT 3.00;

-- Sinh mã cho ca đã tồn tại: CA01, CA02… đánh số riêng trong từng công ty.
-- Ghi bằng số thứ tự thay vì viết tắt từ tên vì tên tiếng Việt có dấu và có thể
-- trùng nhau — sinh mã trùng thì bước tạo UNIQUE bên dưới sẽ hỏng. HR đổi lại
-- mã cho dễ nhớ ngay trên giao diện.
UPDATE "shift" AS s
SET "code" = t."generated"
FROM (
  SELECT
    "id",
    'CA' || lpad(
      (row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id"))::text,
      2, '0'
    ) AS "generated"
  FROM "shift"
) AS t
WHERE s."id" = t."id" AND s."code" IS NULL;

ALTER TABLE "shift" ALTER COLUMN "code" SET NOT NULL;

-- Ca đã xoá mềm vẫn giữ chỗ mã của nó: mã ca nằm trong bảng công đã in ra, tái
-- sử dụng thì hai kỳ lương khác nhau cùng mang một mã mà ý nghĩa đã khác.
CREATE UNIQUE INDEX "shift_companyId_code_key" ON "shift"("companyId", "code");

-- Hệ số riêng cho từng ngày lễ. Chỉ chứa NGOẠI LỆ — ca không có dòng ở đây thì
-- dùng "holidayFactor" chung của ca.
CREATE TABLE "shift_holiday_factor" (
  "id"        TEXT NOT NULL,
  "shiftId"   TEXT NOT NULL,
  "holidayId" TEXT NOT NULL,
  "factor"    DECIMAL(4,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shift_holiday_factor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_holiday_factor_shiftId_holidayId_key"
  ON "shift_holiday_factor"("shiftId", "holidayId");

CREATE INDEX "shift_holiday_factor_holidayId_idx"
  ON "shift_holiday_factor"("holidayId");

-- ON DELETE CASCADE ở cả hai phía: bản ghi này là thuộc tính của cặp (ca, ngày
-- lễ), mất một trong hai thì nó không còn nghĩa gì để giữ lại.
ALTER TABLE "shift_holiday_factor"
  ADD CONSTRAINT "shift_holiday_factor_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_holiday_factor"
  ADD CONSTRAINT "shift_holiday_factor_holidayId_fkey"
  FOREIGN KEY ("holidayId") REFERENCES "holiday"("id") ON DELETE CASCADE ON UPDATE CASCADE;
