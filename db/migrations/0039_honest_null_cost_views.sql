-- ===========================================================================
-- 0039 — AI-06: view realisasi biaya berhenti memfabrikasi angka 0.
--
-- Masalah: `v_block_cost_summary.total_cost_idr` dan
-- `v_budget_vs_actual.actual_idr` memakai COALESCE(...,0), sehingga "belum ada
-- transaksi yang disetujui" tampil sebagai "biayanya nol". Itu angka fabrikasi
-- pada layar keuangan — hal yang dokumen konsep sebut sebagai fatal failure, dan
-- yang seluruh lapisan lain justru menegakkan (src/lib/format.ts: null -> "—").
-- Ironisnya COMMENT pada v_block_cost_summary sendiri sudah mewajibkannya:
-- "cost_per_ha NULL bila luas belum ada -- JANGAN diganti 0".
-- Terlihat langsung di scripts/at-verify.mjs: "klik blok menarik biaya
-- hidupnya — Rp 0".
--
-- Yang TIDAK diubah, dan ini disengaja per kolom:
--   * transaction_count  -> tetap COUNT (0 transaksi itu FAKTA hasil hitung,
--                           bukan nilai yang belum diketahui).
--   * remaining_idr      -> tetap COALESCE. Sisa anggaran ketika belum ada
--                           realisasi memang DIKETAHUI: sebesar anggaran penuh.
--                           Menjadikannya NULL akan menyembunyikan angka benar.
--   * is_over_budget     -> tetap COALESCE. Realisasi nol tidak mungkin
--                           melampaui anggaran; membuatnya NULL memaksa setiap
--                           pemanggil menangani tiga keadaan, dan yang lupa akan
--                           merender "Dalam anggaran" untuk keadaan "belum tahu".
--   * utilisation_pct    -> NULL bila realisasi NULL (0% itu klaim, bukan fakta).
--
-- Definisi yang disalin: v_budget_vs_actual dari 0018_security_fix.sql §8
-- (BUKAN dari 0017 — badan view di 0017 sudah mati, di-DROP di 0018:454, dan
-- versi 0018 memakai LEFT JOIN LATERAL yang memperbaiki bug fan-out temuan #14:
-- satu baris budget beranak N baris). v_block_cost_summary dari 0017:70-88,
-- satu-satunya definisinya.
--
-- WAJIB: security_invoker di-set ulang secara eksplisit. CREATE OR REPLACE
-- pernah menjatuhkan reloption itu dan membuat inbox approval bocor lintas
-- tenant — itulah seluruh isi migrasi 0035, dan 0036 mengulang peringatannya.
-- ===========================================================================

CREATE OR REPLACE VIEW app.v_block_cost_summary
WITH (security_invoker = true) AS
SELECT
  b.id                              AS block_id,
  b.company_id,
  b.estate_id,
  b.code                            AS block_code,
  b.area_ha,
  COUNT(ct.id)                      AS transaction_count,
  -- Tanpa COALESCE: NULL = belum ada transaksi disetujui.
  SUM(ct.amount_idr)                AS total_cost_idr,
  CASE WHEN b.area_ha IS NULL OR b.area_ha = 0 THEN NULL
       ELSE SUM(ct.amount_idr) / b.area_ha
  END                               AS cost_per_ha_idr
FROM app.blocks b
LEFT JOIN app.cost_transactions ct
       ON ct.block_id = b.id
      AND ct.approval_status = 'approved'
WHERE b.archived_at IS NULL
GROUP BY b.id, b.company_id, b.estate_id, b.code, b.area_ha;

COMMENT ON VIEW app.v_block_cost_summary IS
  'total_cost_idr & cost_per_ha NULL bila belum ada transaksi disetujui / luas belum ada '
  '-- JANGAN diganti 0. Empty state jujur (concept:40). transaction_count tetap 0 karena itu hasil hitung.';

CREATE OR REPLACE VIEW app.v_budget_vs_actual
WITH (security_invoker = true) AS
SELECT
  bg.id                AS budget_id,
  bg.company_id,
  bg.fiscal_period_id,
  fp.name              AS period_name,
  bg.cost_category_id,
  mi.name              AS cost_category_name,
  bg.scope_type,
  bg.estate_id,
  bg.block_id,
  bg.amount_idr        AS budget_idr,
  -- Tanpa COALESCE: NULL = belum ada realisasi.
  a.actual_idr         AS actual_idr,
  -- TETAP COALESCE: sisa anggaran tanpa realisasi = anggaran penuh (diketahui).
  bg.amount_idr - COALESCE(a.actual_idr, 0) AS remaining_idr,
  CASE WHEN a.actual_idr IS NULL THEN NULL
       WHEN bg.amount_idr = 0   THEN NULL
       ELSE ROUND(a.actual_idr * 100.0 / bg.amount_idr, 2)
  END                  AS utilisation_pct,
  -- TETAP COALESCE: realisasi nol tidak mungkin melampaui anggaran.
  COALESCE(a.actual_idr, 0) > bg.amount_idr AS is_over_budget
FROM app.budgets bg
JOIN app.fiscal_periods fp ON fp.id = bg.fiscal_period_id
JOIN app.master_items  mi ON mi.id = bg.cost_category_id
-- LATERAL: agregasi dihitung pada grain baris budget, jadi tepat satu baris keluar.
LEFT JOIN LATERAL (
  SELECT SUM(ct.amount_idr) AS actual_idr
    FROM app.cost_transactions ct
    LEFT JOIN app.blocks b ON b.id = ct.block_id
   WHERE ct.approval_status  = 'approved'
     AND ct.company_id       = bg.company_id
     AND ct.fiscal_period_id = bg.fiscal_period_id
     AND ct.cost_category_id = bg.cost_category_id
     AND CASE bg.scope_type
           WHEN 'block'  THEN ct.block_id  = bg.block_id
           WHEN 'estate' THEN b.estate_id  = bg.estate_id
           ELSE true
         END
) a ON true;

COMMENT ON VIEW app.v_budget_vs_actual IS
  'Tepat SATU baris per baris budget. Agregasi lewat LATERAL pada grain budget -- '
  'jangan diubah ke JOIN ber-grain blok, itu mengalikan budget dan membagi actual. '
  'actual_idr NULL = belum ada realisasi (bukan 0); remaining_idr & is_over_budget tetap terdefinisi.';

-- Sabuk pengaman: pastikan reloption tidak hilang, apa pun perilaku
-- CREATE OR REPLACE pada versi Postgres yang dipakai.
ALTER VIEW app.v_block_cost_summary SET (security_invoker = true);
ALTER VIEW app.v_budget_vs_actual   SET (security_invoker = true);

-- Gagalkan migrasi bila cakupan RLS bocor -- lebih baik menolak di sini daripada
-- ditemukan lewat suite adversarial (atau tidak ditemukan sama sekali).
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0039', n;
  END IF;
END $$;
