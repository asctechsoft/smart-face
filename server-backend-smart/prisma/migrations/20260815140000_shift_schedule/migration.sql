-- Bảng phân ca (FR-WEB-HR-05)
--
-- Thêm một tầng khái niệm lên trên dữ liệu phân ca đang có, KHÔNG đụng vào dữ
-- liệu cũ: "scheduleId" cho phép NULL nên mọi lượt phân ca đã xếp trước đây vẫn
-- hợp lệ, chỉ là không thuộc bảng nào.

CREATE TABLE "shift_schedule" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "periodMonth"   DATE NOT NULL,
  "departmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "shiftIds"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "deletedAt"     TIMESTAMP(3),

  CONSTRAINT "shift_schedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_schedule_companyId_periodMonth_idx"
  ON "shift_schedule" ("companyId", "periodMonth");

ALTER TABLE "shift_schedule"
  ADD CONSTRAINT "shift_schedule_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shift_schedule_member" (
  "id"          TEXT NOT NULL,
  "scheduleId"  TEXT NOT NULL,
  "employeeId"  TEXT NOT NULL,
  "periodMonth" DATE NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shift_schedule_member_pkey" PRIMARY KEY ("id")
);

-- Một người, một tháng, một bảng.
--
-- Ràng buộc này là lý do duy nhất "periodMonth" được nhân bản xuống đây. Không
-- có nó thì hai bảng cùng tháng tranh nhau ghi vào cùng ô (employeeId, workDate)
-- — bảng lưu sau đè bảng lưu trước, và màn chi tiết của bảng kia hiển thị ca mà
-- nó không hề xếp. Kiểm tra ở tầng service là chưa đủ: hai request tạo bảng
-- chạy song song đều thấy "chưa ai giữ" rồi cùng ghi.
CREATE UNIQUE INDEX "shift_schedule_member_employeeId_periodMonth_key"
  ON "shift_schedule_member" ("employeeId", "periodMonth");

CREATE UNIQUE INDEX "shift_schedule_member_scheduleId_employeeId_key"
  ON "shift_schedule_member" ("scheduleId", "employeeId");

CREATE INDEX "shift_schedule_member_scheduleId_idx"
  ON "shift_schedule_member" ("scheduleId");

ALTER TABLE "shift_schedule_member"
  ADD CONSTRAINT "shift_schedule_member_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "shift_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_schedule_member"
  ADD CONSTRAINT "shift_schedule_member_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Gắn lượt phân ca vào bảng đã sinh ra nó.
--
-- ON DELETE SET NULL chứ không CASCADE: đây là dữ liệu đi thẳng vào bảng công.
-- Xoá bảng phân ca có xoá lịch ca hay không là quyết định NGHIỆP VỤ, do service
-- thực hiện tường minh trong một transaction sau khi đã kiểm tra kỳ lương chưa
-- chốt. Để database tự cascade là bỏ qua toàn bộ phần kiểm tra đó.
ALTER TABLE "shift_assignment" ADD COLUMN "scheduleId" TEXT;

CREATE INDEX "shift_assignment_scheduleId_idx" ON "shift_assignment" ("scheduleId");

ALTER TABLE "shift_assignment"
  ADD CONSTRAINT "shift_assignment_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "shift_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
