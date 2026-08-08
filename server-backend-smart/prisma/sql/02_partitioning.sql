-- ============================================================================
--  SmartFace — Partition attendance_log theo tháng (D7)
--  Nguồn: docs/07-mo-hinh-du-lieu.md mục 4.1
--
--  Ước tính: 500 NV × 4 lượt/ngày × 250 ngày = 500.000 dòng/năm/công ty
--            100 công ty → 50 triệu dòng/năm
--
--  ⚠ Prisma KHÔNG quản lý partition. Script này chạy thủ công/qua migration job.
--  ⚠ Chuyển bảng đang có dữ liệu sang partitioned table cần downtime — thực hiện
--    ngay từ đầu (bảng rỗng) hoặc qua quy trình migrate có kế hoạch.
--
--  Sau khi chuyển, mỗi tháng chạy `SELECT create_attendance_log_partition(...)`
--  qua cron (queue `payroll` hoặc pg_cron) để tạo trước partition tháng sau.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Hàm tạo partition cho một tháng cụ thể. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_attendance_log_partition(p_year int, p_month int)
RETURNS void AS $$
DECLARE
  start_date date := make_date(p_year, p_month, 1);
  end_date   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  part_name  text := format('attendance_log_%s_%s', p_year, lpad(p_month::text, 2, '0'));
BEGIN
  IF to_regclass(part_name) IS NOT NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF attendance_log FOR VALUES FROM (%L) TO (%L)',
    part_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Tạo sẵn partition cho 12 tháng tới kể từ tháng hiện tại.
-- Chỉ chạy được khi attendance_log ĐÃ là partitioned table (PARTITION BY RANGE (work_date)).
-- ---------------------------------------------------------------------------
-- DO $$
-- DECLARE
--   d date := date_trunc('month', current_date)::date;
-- BEGIN
--   FOR i IN 0..12 LOOP
--     PERFORM create_attendance_log_partition(
--       extract(year from d + (i || ' month')::interval)::int,
--       extract(month from d + (i || ' month')::interval)::int
--     );
--   END LOOP;
-- END $$;
