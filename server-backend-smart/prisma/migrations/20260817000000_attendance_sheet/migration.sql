-- Bảng chấm công (FR-WEB-ATT-08)
--
-- Song sinh với `shift_schedule`: cùng một hình dạng (kỳ + phạm vi phòng ban +
-- danh sách thành viên chốt sẵn) vì người dùng nghĩ về hai thứ này theo cùng
-- một đơn vị — "bảng của tháng 8, phòng Kho".
--
-- KHÔNG đụng vào dữ liệu công đang có. `attendance_daily`, `shift_assignment`
-- và `leave_request` vẫn là nguồn số liệu duy nhất; hai bảng dưới đây chỉ khai
-- báo PHẠM VI để đọc chúng.

CREATE TABLE "attendance_sheet" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "periodMonth"      DATE NOT NULL,
  "departmentIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "shiftScheduleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"           TEXT NOT NULL DEFAULT 'DRAFT',
  "closedAt"         TIMESTAMP(3),
  "closedBy"         TEXT,
  "createdBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "deletedAt"        TIMESTAMP(3),

  CONSTRAINT "attendance_sheet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_sheet_companyId_periodMonth_idx"
  ON "attendance_sheet" ("companyId", "periodMonth");

ALTER TABLE "attendance_sheet"
  ADD CONSTRAINT "attendance_sheet_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- `shiftScheduleIds` cố ý KHÔNG có khoá ngoại.
--
-- Bảng chấm công là chứng từ của một kỳ đã qua. Xoá bảng phân ca nguồn không
-- được phép làm hỏng nó — cùng lắm là mất dấu vết "thành viên lấy từ đâu ra",
-- còn bản thân danh sách thành viên đã nằm ở `attendance_sheet_member`.

CREATE TABLE "attendance_sheet_member" (
  "id"          TEXT NOT NULL,
  "sheetId"     TEXT NOT NULL,
  "employeeId"  TEXT NOT NULL,
  "periodMonth" DATE NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attendance_sheet_member_pkey" PRIMARY KEY ("id")
);

-- Một người, một tháng, một bảng chấm công.
--
-- Đây là lý do duy nhất "periodMonth" được nhân bản xuống bảng thành viên. Hai
-- bảng cùng chứa một người trong cùng kỳ nghĩa là cùng một ngày công được rà
-- soát và chốt hai lần ở hai nơi, và không có cách nào biết bảng nào là thật.
-- Kiểm tra ở tầng service không đủ: hai request lập bảng chạy song song đều
-- thấy "chưa ai giữ" rồi cùng ghi.
CREATE UNIQUE INDEX "attendance_sheet_member_employeeId_periodMonth_key"
  ON "attendance_sheet_member" ("employeeId", "periodMonth");

CREATE UNIQUE INDEX "attendance_sheet_member_sheetId_employeeId_key"
  ON "attendance_sheet_member" ("sheetId", "employeeId");

CREATE INDEX "attendance_sheet_member_sheetId_idx"
  ON "attendance_sheet_member" ("sheetId");

ALTER TABLE "attendance_sheet_member"
  ADD CONSTRAINT "attendance_sheet_member_sheetId_fkey"
  FOREIGN KEY ("sheetId") REFERENCES "attendance_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_sheet_member"
  ADD CONSTRAINT "attendance_sheet_member_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
