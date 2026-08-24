-- 0053_audit_trail_approval.sql
-- B-8: jejak audit belum menyeluruh. Trigger app.write_audit() (0012_workflow.sql)
-- baru terpasang di 5 tabel (blocks, emission_factors, carbon_runs,
-- cert_decisions, cost_transactions). 11 dari 12 tabel ber-approval_status
-- lain tidak tercatat sama sekali -- siapa menyetujui pemupukan atau panen
-- tidak terekam di mana pun.
--
-- write_audit() sudah generik (AFTER INSERT OR UPDATE OR DELETE, mencatat
-- before/after penuh), jadi memasangnya cukup untuk menangkap perubahan
-- approval_status + aktor -- tidak perlu trigger khusus per tabel, dan
-- app.decide_record() tidak perlu diubah untuk menulis audit_log secara
-- eksplisit (satu-satunya INSERT manualnya, di cabang pengecualian
-- self-approval super_admin, tetap jalan berdampingan).
--
-- tree_survey_points ikut disentuh di sini (trigger audit saja) meski
-- tabelnya sedang dikerjakan Dimas (AI-51/K-11) -- sudah dikoordinasikan,
-- lihat B-8 di TIKET-Backend-Ridwan.md.

CREATE TRIGGER dbh_measurements_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.dbh_measurements
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER fertilizer_applications_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.fertilizer_applications
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER harvest_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.harvest_records
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER land_preparations_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.land_preparations
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER land_suitability_assessments_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.land_suitability_assessments
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER nursery_inspections_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.nursery_inspections
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER pruning_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.pruning_records
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER spraying_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.spraying_records
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER survey_submissions_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.survey_submissions
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER tree_survey_points_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.tree_survey_points
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER weeding_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.weeding_records
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

-- ===========================================================================
-- Invariant: setiap tabel ber-approval_status wajib punya trigger write_audit().
-- Sejajar app.check_rls_coverage() -- health check yang wajib nol baris,
-- supaya tabel baru ber-approval_status tidak bisa lupa dipasangi.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.check_audit_coverage()
RETURNS TABLE (table_name text, issue text)
LANGUAGE sql STABLE AS $$
  SELECT c.relname::text, 'punya approval_status tapi tidak ada trigger write_audit()'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relkind = 'r'
     AND EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'approval_status' AND NOT a.attisdropped
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND p.proname = 'write_audit'
     )
$$;

GRANT EXECUTE ON FUNCTION app.check_audit_coverage() TO app_rw, app_ro;

COMMENT ON FUNCTION app.check_audit_coverage IS
  'Health check: harus mengembalikan NOL baris. Setiap baris berarti keputusan approval di tabel itu tidak tercatat di audit_log.';

-- Gagalkan migrasi bila cakupan audit atau RLS bocor.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_audit_coverage() mengembalikan % baris setelah 0053', n;
  END IF;

  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0053', n;
  END IF;
END $$;
