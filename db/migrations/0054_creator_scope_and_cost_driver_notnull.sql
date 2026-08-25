-- 0054_creator_scope_and_cost_driver_notnull.sql
-- B-23: creator bisa SELECT seluruh data perusahaan lewat <table>_tenant
-- (permissive, di-OR dengan policy lain) -- harusnya cuma lihat baris yang
-- dia buat sendiri. Perlu policy RESTRICTIVE (di-AND), pola yang sudah
-- dipakai price_list_writer (0033/0041) dan ct_role_split (0018 §9).
--
-- Owner column TIDAK seragam created_by di semua tabel -- disamakan persis
-- dengan kolom yang sudah dipakai *_role_split masing-masing tabel (0018,
-- 0025, 0034): dbh_measurements pakai measured_by, survey_submissions pakai
-- submitted_by, sisanya created_by. tree_survey_points sengaja DIKECUALIKAN
-- (belum ada *_role_split, wilayah Dimas/AI-51/K-11).
--
-- B-25: field driver biaya masih boleh NULL di DB walau sudah diwajibkan di
-- form/zod. Dicek dulu (lihat riwayat sesi) -- nol baris NULL di kelima
-- kolom pada data lokal saat ini, jadi tidak ada baris yang perlu
-- dikecualikan/dihapus sebelum ditegakkan.
--
-- land_preparations.effective_area_ha BUKAN NOT NULL polos: prepSchema
-- (src/lib/actions/operational.ts) sengaja mewajibkannya HANYA bila
-- status <> 'not_started' -- sebelum pekerjaan berjalan memang belum ada
-- luas efektif, dan memaksa angka di situ cuma memancing tebakan. DB harus
-- menegakkan aturan yang SAMA (CHECK bersyarat), bukan versi yang lebih
-- ketat dari zod-nya sendiri.

-- ===========================================================================
-- B-23: RESTRICTIVE SELECT per-creator
-- ===========================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cost_transactions',              'created_by'),
    ('fertilizer_applications',        'created_by'),
    ('land_preparations',              'created_by'),
    ('land_suitability_assessments',   'created_by'),
    ('pruning_records',                'created_by'),
    ('nursery_inspections',            'created_by'),
    ('dbh_measurements',               'measured_by'),
    ('survey_submissions',             'submitted_by'),
    ('weeding_records',                'created_by'),
    ('spraying_records',               'created_by'),
    ('harvest_records',                'created_by')
  ) AS t(tbl, owner_col)
  LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_creator_own_select ON app.%1$I
        AS RESTRICTIVE FOR SELECT
        USING (app.current_role_name() <> 'creator' OR %2$I = app.current_user_id())
    $f$, r.tbl, r.owner_col);
  END LOOP;
END $$;

-- ===========================================================================
-- Invariant: setiap tabel ber-*_role_split (approval creator/approver) wajib
-- punya RESTRICTIVE SELECT policy per-pembuat. Sejajar check_rls_coverage()
-- dan check_audit_coverage() (0053) -- harus nol baris.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.check_creator_scope_coverage()
RETURNS TABLE (table_name text, issue text)
LANGUAGE sql STABLE AS $$
  SELECT c.relname::text, 'creator bisa SELECT seluruh baris tenant (tidak ada restrictive SELECT policy per-pembuat)'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app' AND c.relkind = 'r'
     AND EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polcmd = 'w' AND p.polname LIKE '%role_split'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname LIKE '%_creator_own_select'
     )
$$;

GRANT EXECUTE ON FUNCTION app.check_creator_scope_coverage() TO app_rw, app_ro;

COMMENT ON FUNCTION app.check_creator_scope_coverage IS
  'Health check: harus mengembalikan NOL baris. Setiap baris berarti creator bisa SELECT baris milik pembuat lain di tabel itu.';

-- ===========================================================================
-- B-25: tegakkan NOT NULL di DB untuk kolom driver biaya
-- ===========================================================================

ALTER TABLE app.weeding_records    ALTER COLUMN area_ha            SET NOT NULL;
ALTER TABLE app.pruning_records    ALTER COLUMN tree_count         SET NOT NULL;
ALTER TABLE app.spraying_records   ALTER COLUMN total_volume       SET NOT NULL;
ALTER TABLE app.spraying_records   ALTER COLUMN unit               SET NOT NULL;

ALTER TABLE app.land_preparations ADD CONSTRAINT land_preparations_area_required_unless_not_started
  CHECK (status = 'not_started' OR effective_area_ha IS NOT NULL);

-- Gagalkan migrasi bila cakupan RLS, audit, atau creator-scope bocor.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0054', n;
  END IF;

  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_audit_coverage() mengembalikan % baris setelah 0054', n;
  END IF;

  SELECT count(*) INTO n FROM app.check_creator_scope_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_creator_scope_coverage() mengembalikan % baris setelah 0054', n;
  END IF;
END $$;
