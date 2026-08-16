-- Một người, một ngày, NHIỀU ca — miễn là giờ các ca không giao nhau.
--
-- Khoá cũ `(employeeId, workDate)` chỉ cho đúng một ca mỗi ngày. Khoá mới thêm
-- `shiftId` nên vẫn chặn xếp trùng đúng một ca hai lần, mà không chặn ca thứ hai
-- khác giờ. Điều kiện "không giao giờ" không diễn đạt được bằng ràng buộc SQL
-- (phải đọc khung giờ bên bảng `shift`, và ca qua đêm còn tràn sang ngày sau)
-- nên nó nằm ở tầng service.
--
-- Không mất dữ liệu: mọi dòng đang có đều thoả khoá mới, vì khoá cũ đã bảo đảm
-- mỗi (nhân viên, ngày) chỉ có một dòng.

DROP INDEX IF EXISTS "shift_assignment_employeeId_workDate_key";

CREATE UNIQUE INDEX "shift_assignment_employeeId_workDate_shiftId_key"
  ON "shift_assignment" ("employeeId", "workDate", "shiftId");

-- Tra "ca của người này ngày này" là truy vấn nóng nhất (chấm công, tính công
-- gọi mỗi ngày mỗi người). Khoá cũ đang gánh việc đó; mất nó mà không dựng lại
-- index thì mỗi lượt tra thành một lần quét bảng.
CREATE INDEX "shift_assignment_employeeId_workDate_idx"
  ON "shift_assignment" ("employeeId", "workDate");
