-- Loại đơn có được tính công không (FR-WEB-POL-10)
--
-- Trước đây engine tính công suy "đơn có lương" từ `deductFrom = 'ANNUAL_LEAVE'`.
-- Suy như vậy sai ở cả hai chiều:
--
--   - Công tác (`deductFrom = 'NONE'`) là ngày ĐI LÀM, nhưng bị tính 0 công.
--   - Xin ra ngoài / Về sớm cũng là `'NONE'`, và chúng KHÔNG phải một ngày công.
--
-- Hai câu hỏi khác nhau nên cần hai cột: `deductFrom` nói trừ vào QUỸ nào,
-- `isPaidLeave` nói ngày đó có vào BẢNG CÔNG không.

ALTER TABLE "request_type"
  ADD COLUMN "isPaidLeave" BOOLEAN NOT NULL DEFAULT false;

-- Backfill giữ nguyên hành vi cũ cho nghỉ phép năm: engine đang tính đủ công
-- cho `ANNUAL_LEAVE`, tắt nó đi ở đây là lặng lẽ cắt công của cả kỳ đang mở.
UPDATE "request_type" SET "isPaidLeave" = true WHERE "deductFrom" = 'ANNUAL_LEAVE';

-- Công tác và nghỉ ốm: đây là hai loại đã bị tính 0 công do lỗi suy diễn ở trên.
-- Bật theo MÃ loại đơn, không theo `deductFrom` — mã là thứ nghiệp vụ đặt ra,
-- còn `deductFrom` chỉ nói về quỹ.
--
-- Công ty nào không muốn trả công ngày nghỉ ốm thì tắt lại trong màn hình
-- "Loại đơn và luồng duyệt"; đây chỉ là giá trị khởi đầu hợp lý nhất.
UPDATE "request_type"
  SET "isPaidLeave" = true
  WHERE "code" IN ('BUSINESS_TRIP', 'CONG_TAC', 'SICK_LEAVE');
