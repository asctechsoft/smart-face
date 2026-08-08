-- ============================================================================
--  SmartFace — ràng buộc enforce ở tầng DB
--  Nguồn: docs/07-mo-hinh-du-lieu.md mục 4.3
--  Chạy SAU khi `prisma migrate deploy` thành công.
--
--  npm run db:guards      (cần psql trong PATH)
--  hoặc: psql "$DATABASE_URL" -f prisma/sql/01_immutability_and_rls.sql
--  không có psql: npx prisma db execute --schema prisma/schema.prisma --file <tệp này>
--
--  ⚠ QUY ƯỚC ĐẶT TÊN — đọc trước khi sửa tệp này.
--
--  schema.prisma dùng `@@map` cho TÊN BẢNG (snake_case) nhưng KHÔNG dùng `@map`
--  cho tên cột. Vì vậy cột trong Postgres giữ nguyên camelCase: "companyId",
--  "fullName", "createdAt"…
--
--  Postgres hạ mọi định danh không đóng ngoặc kép về chữ thường, nên `companyId`
--  viết trần sẽ thành `companyid` và câu lệnh báo `column does not exist`.
--  MỌI tên cột trong tệp này BẮT BUỘC đóng ngoặc kép.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BR-06 / ADR-08: attendance_log là BẤT BIẾN
--    Rule DO INSTEAD NOTHING khiến mọi UPDATE/DELETE bị bỏ qua âm thầm ở tầng DB.
--    Đây là lớp phòng thủ cuối — tầng ứng dụng cũng đã chặn.
-- ----------------------------------------------------------------------------
DROP RULE IF EXISTS no_update_attendance_log ON attendance_log;
DROP RULE IF EXISTS no_delete_attendance_log ON attendance_log;

CREATE RULE no_update_attendance_log AS
  ON UPDATE TO attendance_log DO INSTEAD NOTHING;
CREATE RULE no_delete_attendance_log AS
  ON DELETE TO attendance_log DO INSTEAD NOTHING;

-- ----------------------------------------------------------------------------
-- 2. BR-08 / NFR-SEC-10: audit_log append-only, kể cả Admin hệ thống
-- ----------------------------------------------------------------------------
DROP RULE IF EXISTS no_update_audit_log ON audit_log;
DROP RULE IF EXISTS no_delete_audit_log ON audit_log;

CREATE RULE no_update_audit_log AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_log AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ----------------------------------------------------------------------------
-- 3. ADR-05: Row-Level Security — lớp phòng thủ THỨ HAI cho multi-tenant.
--    Lớp thứ nhất là TenantGuard + Repository bắt buộc nhận companyId.
--
--    Ứng dụng set biến phiên trước mỗi transaction nghiệp vụ:
--        SELECT set_config('app.company_id', $1, true);
--    Với vai trò SYSTEM_ADMIN, đặt 'app.bypass_rls' = 'on'.
--
--    LƯU Ý: bật RLS yêu cầu DB user của ứng dụng KHÔNG phải superuser và
--    KHÔNG có thuộc tính BYPASSRLS. Vì vậy phần này để COMMENT sẵn — bật khi
--    hạ tầng đã tách role riêng cho ứng dụng (khuyến nghị trước khi go-live).
-- ----------------------------------------------------------------------------

--    ⚠ HAI BẢNG CỐ Ý KHÔNG CÓ TRONG DANH SÁCH:
--
--    `user_account` — quản trị viên nền tảng có "companyId" IS NULL. Policy so
--    sánh bằng sẽ khiến NULL trả về NULL (không phải TRUE), nên họ tự ẩn mất
--    tài khoản của chính mình và không ai đăng nhập quản trị được nữa.
--
--    `audit_log`  — nhật ký cấp hệ thống cũng có "companyId" NULL, và che nó đi
--    thì mất đúng thứ dùng để điều tra sự cố xuyên công ty.
--
--    Nếu sau này muốn bật RLS cho hai bảng đó, điều kiện phải là
--    `"companyId" IS NOT DISTINCT FROM current_setting(...)` cộng một nhánh
--    riêng cho NULL — không dùng chung policy bên dưới.

-- DO $$
-- DECLARE
--   t text;
--   tenant_tables text[] := ARRAY[
--     'employee','branch','department','company_policy','device_binding',
--     'shift','shift_assignment','holiday','leave_policy','leave_balance',
--     'attendance_log','attendance_daily','attendance_adjustment','fraud_flag',
--     'request_type','leave_request','approval_flow','approval_step',
--     'request_attachment','makeup_work_record','payroll_period',
--     'payroll_summary','face_profile','biometric_key','export_job',
--     'notification'
--   ];
-- BEGIN
--   FOREACH t IN ARRAY tenant_tables LOOP
--     EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
--     EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
--     EXECUTE format($f$
--       CREATE POLICY tenant_isolation ON %I
--         USING (
--           coalesce(current_setting('app.bypass_rls', true), 'off') = 'on'
--           OR "companyId" = current_setting('app.company_id', true)
--         )
--     $f$, t);
--   END LOOP;
-- END $$;

-- ----------------------------------------------------------------------------
-- 4. Index bổ sung không biểu diễn được trong Prisma
-- ----------------------------------------------------------------------------

-- Tìm kiếm nhân viên theo tên/mã (FR-WEB-ATT-02)
CREATE INDEX IF NOT EXISTS idx_employee_search
  ON employee ("companyId", lower("fullName") text_pattern_ops);

-- Cờ nghi vấn CHƯA xử lý — truy vấn nóng nhất của dashboard cảnh báo (AF-21)
CREATE INDEX IF NOT EXISTS idx_fraud_flag_unreviewed
  ON fraud_flag ("companyId", "createdAt" DESC)
  WHERE "reviewedAt" IS NULL;

-- "Đơn tôi cần duyệt" — chỉ quan tâm step đang PENDING
CREATE INDEX IF NOT EXISTS idx_approval_step_pending
  ON approval_step ("approverId")
  WHERE status = 'PENDING';
