-- ===========================================================================
-- 0047 — realisasi anggaran digulung ke kategori INDUK (QA B-20, Critical).
--
-- Keputusan pemilik produk 23 Agu 2026: anggaran dikelola di tingkat kategori
-- INDUK. Realisasi WAJIB memakai sumbu yang sama; kalau tidak, perbandingan
-- anggaran membandingkan dua taksonomi yang tidak pernah berpotongan.
--
-- Yang terjadi sebelum migrasi ini, terukur pada dataset demo:
--   * anggaran dipasang pada 8 kategori INDUK (Persiapan Lahan, Tenaga Kerja, …)
--   * 30 cost_transactions approved (Rp 1,95 M) dicatat pada kategori ANAK
--     (Land Clearing, Bibit Durian, Mandor & Supervisi, …)
--   * irisan keduanya NOL -> actual_idr NULL untuk SETIAP baris anggaran
-- Itu persis gejala yang dilaporkan QA B-20 "realisasi anggaran selalu 0".
--
-- Pencocokan baru: realisasi diakui bila kategorinya SAMA dengan kategori
-- anggaran, ATAU merupakan ANAK LANGSUNG dari kategori anggaran. Digulung
-- HANYA ke arah anggaran, bukan dua arah -- kalau suatu saat anggaran dipasang
-- di tingkat anak, ia tetap hanya mencocokkan anak itu dan tidak menyerap
-- saudara-saudaranya.
--
-- Ini bukan konvensi baru: app.v_spend_by_category (migrasi 0024) sudah
-- menggulung dengan COALESCE(parent.id, cat.id) sejak awal. v_budget_vs_actual
-- yang menyimpang dari konvensi itu.
--
-- Pohon kategori hanya DUA tingkat (induk -> anak); tidak ada cucu, jadi satu
-- lompatan parent_id cukup. Bila suatu saat menjadi lebih dalam, pencocokan ini
-- harus diganti penelusuran rekursif.
--
-- Kolom TIDAK berubah sama sekali -- CREATE OR REPLACE VIEW tidak bisa
-- menghapus atau menyusun ulang kolom, dan `remaining_idr`/`is_over_budget`
-- sengaja tetap COALESCE ke 0 (keduanya turunan anggaran yang PASTI ada,
-- lihat 0039).
-- ===========================================================================

CREATE OR REPLACE VIEW app.v_budget_vs_actual AS
SELECT bg.id AS budget_id,
    bg.company_id,
    bg.fiscal_period_id,
    fp.name AS period_name,
    bg.cost_category_id,
    mi.name AS cost_category_name,
    bg.scope_type,
    bg.estate_id,
    bg.block_id,
    bg.amount_idr AS budget_idr,
    a.actual_idr,
    bg.amount_idr - COALESCE(a.actual_idr, 0::numeric) AS remaining_idr,
        CASE
            WHEN a.actual_idr IS NULL THEN NULL::numeric
            WHEN bg.amount_idr = 0::numeric THEN NULL::numeric
            ELSE round(a.actual_idr * 100.0 / bg.amount_idr, 2)
        END AS utilisation_pct,
    COALESCE(a.actual_idr, 0::numeric) > bg.amount_idr AS is_over_budget
   FROM app.budgets bg
     JOIN app.fiscal_periods fp ON fp.id = bg.fiscal_period_id
     JOIN app.master_items mi ON mi.id = bg.cost_category_id
     LEFT JOIN LATERAL ( SELECT sum(ct.amount_idr) AS actual_idr
           FROM app.cost_transactions ct
             LEFT JOIN app.blocks b ON b.id = ct.block_id
             -- kategori transaksi, untuk menemukan induknya
             LEFT JOIN app.master_items cm ON cm.id = ct.cost_category_id
          WHERE ct.approval_status = 'approved'::app.record_status
            AND ct.company_id = bg.company_id
            AND ct.fiscal_period_id = bg.fiscal_period_id
            -- SAMA dengan kategori anggaran, atau ANAK LANGSUNG-nya.
            -- cm.parent_id NULL menghasilkan NULL (bukan true), jadi transaksi
            -- di tingkat induk hanya cocok lewat kesamaan langsung.
            AND bg.cost_category_id IN (ct.cost_category_id, cm.parent_id)
            AND CASE bg.scope_type
                    WHEN 'block'::app.budget_scope THEN ct.block_id = bg.block_id
                    WHEN 'estate'::app.budget_scope THEN b.estate_id = bg.estate_id
                    ELSE true
                END) a ON true;

-- WAJIB: CREATE OR REPLACE VIEW MENJATUHKAN security_invoker (regresi nyata,
-- 0035 memperbaiki 0034). Tanpa baris ini view berjalan sebagai pemiliknya dan
-- RLS pemanggil tidak berlaku.
ALTER VIEW app.v_budget_vs_actual SET (security_invoker = true);

COMMENT ON VIEW app.v_budget_vs_actual IS
  'Anggaran vs realisasi. Realisasi digulung ke kategori INDUK anggaran '
  '(keputusan pemilik produk 23 Agu 2026, QA B-20). actual_idr NULL = belum ada '
  'realisasi, BUKAN nol.';

-- ===========================================================================
-- Kanari kesehatan (pola 0039–0046)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0047', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0047', n;
  END IF;
END $$;
