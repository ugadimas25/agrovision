-- ===========================================================================
-- 0048 — biaya yang TIDAK bisa dibandingkan ke anggaran berhenti hilang diam-diam.
--
-- Temuan telaah adversarial 0041–0047 (23 Agu 2026). Tiga jalan berbeda membuat
-- biaya yang sudah DISETUJUI tidak pernah muncul di perbandingan anggaran, dan
-- ketiganya tanpa satu pun peringatan:
--
--   1. `amount_idr` NULL — tarif untuk driver itu tidak ada atau dinonaktifkan
--      saat record disetujui. Dibuktikan: WEED-HA dinonaktifkan, penyiangan 5 ha
--      disetujui, lahir satu baris biaya bernilai NULL. Pekerjaan itu gratis
--      selamanya kecuali ada yang menyadarinya.
--   2. `cost_category_id` NULL — tarif belum dipetakan ke kategori akuntansi.
--      v_budget_vs_actual mencocokkan lewat kategori, jadi barisnya tak terjangkau.
--   3. `fiscal_period_id` NULL — tanggal kejadian di luar semua periode fiskal.
--      Dibuktikan: kejadian 2035 disetujui, biaya Rp 5.250.000 tercatat dan tidak
--      masuk perbandingan mana pun.
--
-- Keputusan pemilik produk 24 Agu 2026: **tampilkan, jangan blokir**. Menolak
-- approval karena tarif belum diisi akan menghentikan pekerjaan lapangan, dan
-- doktrin proyek menuntut yang belum diketahui TERLIHAT, bukan didiamkan.
--
-- View ini SENGAJA tidak menghitung apa pun. Ia daftar kerja: baris apa, kenapa,
-- dan berapa nilainya bila nilainya diketahui.
-- ===========================================================================

CREATE VIEW app.v_cost_unmatched AS
SELECT
  ct.id,
  ct.company_id,
  ct.transaction_date,
  b.code            AS block_code,
  ct.source_table,
  ct.quantity,
  ct.unit,
  ct.amount_idr,
  cat.name          AS cost_category_name,
  -- Alasan paling menentukan lebih dulu: tanpa nilai, dua alasan lain tidak
  -- relevan karena tidak ada angka untuk dibandingkan.
  CASE
    WHEN ct.amount_idr IS NULL       THEN 'nilai belum bisa dihitung'
    WHEN ct.cost_category_id IS NULL THEN 'kategori belum dipetakan'
    ELSE                                  'di luar periode anggaran'
  END AS reason
FROM app.cost_transactions ct
LEFT JOIN app.blocks b        ON b.id  = ct.block_id
LEFT JOIN app.master_items cat ON cat.id = ct.cost_category_id
WHERE ct.approval_status = 'approved'
  AND (ct.amount_idr IS NULL
    OR ct.cost_category_id IS NULL
    OR ct.fiscal_period_id IS NULL);

-- WAJIB: tanpa ini view berjalan sebagai pemiliknya dan RLS pemanggil tidak
-- berlaku — satu tenant akan melihat biaya tenant lain.
ALTER VIEW app.v_cost_unmatched SET (security_invoker = true);

COMMENT ON VIEW app.v_cost_unmatched IS
  'Biaya approved yang tidak bisa dibandingkan ke anggaran: nilai/kategori/periode '
  'belum ada. Daftar kerja, bukan perhitungan. Temuan telaah adversarial 23 Agu 2026.';

-- Whitelist view yang boleh dipakai report_definitions.base_view (FK dipasang
-- 0018 §"temuan #22": klaim validasi tanpa FK). Nama tabelnya
-- app.report_allowed_views, kolomnya (view_name, note).
INSERT INTO app.report_allowed_views (view_name, note)
VALUES ('v_cost_unmatched', 'Biaya approved yang belum bisa dibandingkan ke anggaran')
ON CONFLICT (view_name) DO NOTHING;

-- ===========================================================================
-- Kanari kesehatan (pola 0039–0047)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0048', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0048', n;
  END IF;
END $$;
