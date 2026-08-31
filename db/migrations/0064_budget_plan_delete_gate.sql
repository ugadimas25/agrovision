-- ===========================================================================
-- 0064_budget_plan_delete_gate.sql
--
-- Dua lubang yang ditemukan audit modul RAB, 31 Agustus 2026.
--
-- (1) app.budget_plans TIDAK PUNYA policy DELETE.
--     0060 memasang bp_writer_roles sebagai RESTRICTIVE FOR ALL USING (true);
--     untuk DELETE hanya klausa USING yang dikonsultasi, sehingga
--     WITH CHECK (app.role_may_write_budget_plan()) di policy itu tidak pernah
--     dievaluasi. bp_edit_gate dibatasi FOR UPDATE. Hasilnya: siapa pun dalam
--     satu tenant -- termasuk viewer -- bisa menghapus RAB yang sudah
--     disetujui, dan ON DELETE CASCADE (0060:92 dan 0062:34) ikut membawa
--     seluruh komponen biaya serta seluruh asumsinya.
--
--     Dibuktikan pada DB lokal sebagai app_user dengan konteks viewer:
--         sebelum : 1 RAB / 11 komponen / 3 asumsi
--         sesudah : 0 RAB / 0 komponen / 0 asumsi
--     Kedua tabel anak sudah punya *_edit_delete sejak 0060; hanya induknya
--     yang terlewat. Asimetri itu sendiri menunjukkan kelalaian, bukan pilihan.
--
--     app.check_rls_coverage() tidak melihatnya: ia memeriksa RLS aktif + ada
--     policy, bukan cakupan per-perintah. Seluruh kelas lubang ini tak terlihat
--     oleh health check mana pun -- karena itu (2) di bawah ikut dikerjakan.
--
-- (2) app.check_budget_derived_volume() (0062) tidak pernah dipanggil di
--     lingkungan mana pun. Sekarang masuk ke gerbang produksi.
--
-- Yang SENGAJA TIDAK diubah di sini: bpi_edit_update masih membiarkan approver
-- menulis ulang unit_price_idr pada RAB yang sudah disetujui. Itu mengubah
-- logika approval yang disepakati rapat ("approver boleh menambah baris setelah
-- disetujui"), jadi harus dibahas dulu -- lihat CLAUDE.md, alur kerja PR.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Gerbang DELETE untuk RAB
--
-- Lebih ketat daripada policy anak-anaknya, dan itu disengaja: menghapus satu
-- baris biaya menghilangkan satu angka, menghapus RAB menghilangkan seluruh
-- keputusan beserta jejak siapa memutus apa. RAB yang sudah diajukan atau
-- diputuskan tidak boleh hilang lewat DELETE dari peran mana pun -- termasuk
-- super_admin. Yang boleh dihapus hanya draft/rejected, oleh penyusunnya
-- sendiri atau super_admin.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS bp_edit_delete ON app.budget_plans;
CREATE POLICY bp_edit_delete ON app.budget_plans
  AS RESTRICTIVE FOR DELETE
  USING (
    approval_status IN ('draft', 'rejected')
    AND (
      created_by = app.current_user_id()
      OR app.current_role_name() = 'super_admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Volume turunan masuk gerbang produksi
--    Seluruh cabang lama dipertahankan apa adanya; hanya satu UNION ALL baru.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.check_production_readiness()
 RETURNS TABLE(item text, blocking boolean, detail text)
 LANGUAGE sql
 STABLE
AS $function$

  -- Login tanpa verifikasi kredensial masih dinyalakan di database ini.
  SELECT 'login stub masih aktif'::text, true,
         'app.auth_settings.stub_login_enabled = true; login tidak memverifikasi kredensial'::text
    FROM app.auth_settings s
   WHERE s.singleton AND s.stub_login_enabled
  UNION ALL
  -- Fungsi stub pra-B-27 muncul kembali.
  SELECT 'fungsi login stub warisan masih ada'::text, true,
         'app.lookup_login_email seharusnya dihapus migrasi 0057'::text
   WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'lookup_login_email')
  UNION ALL
  -- Lubang RLS.
  SELECT 'cakupan RLS bocor', true, table_name || ': ' || issue
    FROM app.check_rls_coverage()
  UNION ALL
  -- Pencabutan hak yang tidak berlaku.
  SELECT 'pencabutan hak bocor', true, table_name || '.' || privilege
    FROM app.check_privilege_revocations()
  UNION ALL
  -- Koefisien karbon belum divalidasi ahli.
  SELECT 'koefisien alometrik belum divalidasi', false,
         COALESCE(crop_id::text, '(global)') || ' versi ' || version
    FROM app.allometric_coefficients WHERE requires_validation
  UNION ALL
  -- Emission factor tanpa provenance yang jelas.
  SELECT 'emission factor tanpa sitasi', false, code || ' v' || version
    FROM app.emission_factors WHERE source_citation IS NULL
  UNION ALL
  -- Periode fiskal belum didefinisikan -> budget tidak bisa dibandingkan.
  SELECT 'periode fiskal belum didefinisikan', false,
         'app.fiscal_periods kosong; keputusan #6 butuh nama & rentang fase dari klien'
   WHERE NOT EXISTS (SELECT 1 FROM app.fiscal_periods)

  UNION ALL
  -- Volume turunan menyimpang dari asumsinya. Fungsinya sudah ada sejak 0062
  -- tapi tidak pernah dipanggil di lingkungan mana pun -- hanya di dalam blok
  -- DO migrasi itu sendiri dan di suite adversarial yang selalu ROLLBACK atas
  -- data buatannya sendiri. Artinya ia belum pernah melihat satu pun RAB nyata.
  -- Blocking: layar mengklaim "= net_ha x 70"; kalau volumenya bukan itu lagi,
  -- angka yang dipakai finance berbeda dari angka yang dijanjikan layar.
  SELECT 'volume turunan RAB menyimpang dari asumsi', true,
         plan_code || ' / ' || description
    FROM app.check_budget_derived_volume()
$function$;

COMMENT ON POLICY bp_edit_delete ON app.budget_plans IS
  'RAB yang sudah diajukan/diputuskan tidak boleh dihapus siapa pun; draft/rejected hanya oleh penyusunnya atau super_admin. Menutup lubang 0060 yang membiarkan viewer menghapus RAB beserta cascade-nya.';
