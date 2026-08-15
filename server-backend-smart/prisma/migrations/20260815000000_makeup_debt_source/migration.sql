-- Phân biệt nợ công do ENGINE tự sinh với nợ do HR nhập tay.
--
-- Engine tính công chạy lại rất nhiều lần cho cùng một ngày (mỗi lần sửa công,
-- duyệt đơn, hay cron đêm), và nó phải giữ cho tổng nợ của ngày đó khớp với số
-- giờ thực sự thiếu. Muốn làm được điều đó nó phải SỬA và XOÁ được các dòng nợ.
--
-- Không có cột này thì engine không phân biệt được dòng nào là của nó. Hậu quả
-- cụ thể: HR ghi nhận một khoản nợ theo thoả thuận riêng với nhân viên, hôm sau
-- engine tính lại ngày đó, thấy bảng chấm công không thiếu giờ, và XOÁ khoản nợ
-- HR vừa nhập. Không lỗi, không dấu vết trên giao diện.
--
-- An toàn khi chạy: chỉ thêm cột và chỉ mục, không sửa dữ liệu sẵn có. Mọi dòng
-- đang có đều do HR nhập tay (trước bản vá này engine chưa từng ghi vào bảng
-- này), nên mặc định 'MANUAL' là đúng với thực tế lịch sử.

ALTER TABLE "makeup_work_record"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- Engine đối chiếu nợ theo (công ty, nhân viên, ngày phát sinh nợ) ở MỖI lần
-- tính lại một ngày công. Thiếu chỉ mục này thì đó là một lần quét toàn bảng
-- cho mỗi nhân viên mỗi ngày.
CREATE INDEX "makeup_work_record_companyId_employeeId_debtWorkDate_idx"
  ON "makeup_work_record" ("companyId", "employeeId", "debtWorkDate");
