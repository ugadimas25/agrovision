-- ===========================================================================
-- 0042 — AI-50: jalur input distribusi bibit (docs/13 §5 W3).
--
-- app.seed_distributions (0005) TIDAK punya approval_status: ia pencatatan
-- langsung, dan driver biaya seedling_qty (src/lib/repo/pricing.ts) memang
-- membaca semua baris tanpa saringan approval. Karena itu TIDAK ada cabang
-- baru di v_pending_approvals maupun app.decide_record() — bukan kelalaian.
-- Policy *_role_split (0025) juga tidak relevan: ia FOR UPDATE untuk menjaga
-- transisi approval, dan tabel ini tidak punya kolom itu.
--
-- Dua hal yang butuh migrasi:
--   1. created_by — jejak petugas, konsisten dengan tabel record lain.
--      Nullable: baris lama dari seed-demo/import-pilot tetap NULL dan
--      dirender em-dash (null = "belum ada data", bukan 0/anonim palsu).
--   2. seed_distributions LUPUT dari daftar `writable` di 0018 §"viewer tidak
--      boleh menulis apa pun". Policy tenant-nya (0018, diturunkan lewat
--      seed_batches) punya WITH CHECK yang lolos untuk SEMUA peran dalam
--      tenant, jadi viewer bisa INSERT lewat koneksi app_rw. requireRole di
--      aplikasi hanya defense-in-depth; database adalah batas keamanan yang
--      otoritatif, maka ditambal di sini. Polanya disalin persis dari 0018.
-- ===========================================================================

ALTER TABLE app.seed_distributions
  ADD COLUMN created_by uuid REFERENCES app.users(id);

DROP POLICY IF EXISTS seed_distributions_viewer_readonly ON app.seed_distributions;
CREATE POLICY seed_distributions_viewer_readonly ON app.seed_distributions
  AS RESTRICTIVE FOR ALL
  USING (true)
  WITH CHECK (COALESCE(app.current_role_name(), 'viewer') <> 'viewer');

-- Kanari (pola 0039/0040): tidak boleh ada tabel yang bocor dari cakupan RLS.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0042', n;
  END IF;
END $$;
