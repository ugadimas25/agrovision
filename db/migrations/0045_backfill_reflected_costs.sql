-- 0044_backfill_reflected_costs.sql
--
-- Backfill K-01 (tugas G): record aktivitas yang SUDAH approved dimaterialisasi
-- mundur satu kali ke app.cost_transactions.
--
-- Aturan main:
--   * HANYA record yang tarifnya ADA pada tanggal kejadian (price_for_driver
--     mengembalikan baris) — berbeda dari jalur runtime yang menulis baris
--     "belum bertarif": backfill tidak menciptakan tumpukan baris kosong untuk
--     tenant yang memang belum memakai price list.
--   * HANYA record dengan volume terisi (tanpa volume tidak ada yang bisa dihitung).
--   * Idempoten: ON CONFLICT (source_table, source_record_id) pada indeks parsial
--     ct_source_once — migrasi ini boleh dijalankan di lingkungan yang recordnya
--     sudah termaterialisasi tanpa menggandakan biaya.
--   * created_by NULL: siapa yang meng-approve record lama tidak tercatat —
--     mengarangnya dilarang; note menandai barisnya sebagai backfill.
--   * TIDAK ada backfill mutasi stok 'out': jumlah bahan katalog pada record lama
--     tidak pernah dicatat (lihat header 0043) — yang tidak ada tidak difabrikasi.
--   * Panen TIDAK di-backfill: revenue ditunda ke AI-07/K-03 (lihat header 0044).
--
-- Berjalan sebagai pemilik tabel (runner migrasi). Di Postgres lokal pemilik =
-- superuser (bypass RLS); di Cloud SQL tabel-tabel lama berstatus NO FORCE
-- (memori proyek agrovision-cloudsql-force-rls) sehingga pemilik juga lolos.

DO $$
DECLARE
  n     integer;
  total integer := 0;
BEGIN
  -- ---------------------------------------------------------------- pemupukan
  INSERT INTO app.cost_transactions
    (company_id, block_id, cost_category_id, uom_item_id, fiscal_period_id,
     transaction_date, quantity, unit, unit_price_idr, amount_idr, is_overhead,
     approval_status, created_by, updated_by, source_table, source_record_id, note)
  SELECT b.company_id, fa.block_id, p.cost_category_id, fa.uom_item_id,
         app.fiscal_period_on(b.company_id, fa.applied_on),
         fa.applied_on, fa.total_quantity,
         COALESCE(p.unit, (SELECT mi.code FROM app.master_items mi WHERE mi.id = fa.uom_item_id)),
         p.rate_idr, round(fa.total_quantity * p.rate_idr, 2), false,
         'approved'::app.record_status, NULL, NULL,
         'fertilizer_applications', fa.id,
         'Backfill K-01 (0045): materialisasi mundur record approved'
    FROM app.fertilizer_applications fa
    JOIN app.blocks b ON b.id = fa.block_id
    CROSS JOIN LATERAL app.price_for_driver(b.company_id, 'fertilizer_qty', fa.chemical_id, fa.applied_on) AS p
   WHERE fa.approval_status = 'approved'
     AND fa.total_quantity IS NOT NULL
     AND p.id IS NOT NULL
  ON CONFLICT (source_table, source_record_id)
    WHERE source_table IS NOT NULL AND reversal_of_id IS NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RAISE NOTICE 'backfill pemupukan: % baris', n;

  -- ---------------------------------------------------------- persiapan lahan
  INSERT INTO app.cost_transactions
    (company_id, block_id, cost_category_id, uom_item_id, fiscal_period_id,
     transaction_date, quantity, unit, unit_price_idr, amount_idr, is_overhead,
     approval_status, created_by, updated_by, source_table, source_record_id, note)
  SELECT b.company_id, lp.block_id, p.cost_category_id, NULL,
         app.fiscal_period_on(b.company_id, lp.checked_at::date),
         lp.checked_at::date, lp.effective_area_ha,
         COALESCE(p.unit, 'ha'),
         p.rate_idr, round(lp.effective_area_ha * p.rate_idr, 2), false,
         'approved'::app.record_status, NULL, NULL,
         'land_preparations', lp.id,
         'Backfill K-01 (0045): materialisasi mundur record approved'
    FROM app.land_preparations lp
    JOIN app.blocks b ON b.id = lp.block_id
    CROSS JOIN LATERAL app.price_for_driver(b.company_id, 'landprep_area_ha', NULL::uuid, lp.checked_at::date) AS p
   WHERE lp.approval_status = 'approved'
     AND lp.effective_area_ha IS NOT NULL
     AND p.id IS NOT NULL
  ON CONFLICT (source_table, source_record_id)
    WHERE source_table IS NOT NULL AND reversal_of_id IS NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RAISE NOTICE 'backfill persiapan lahan: % baris', n;

  -- ---------------------------------------------------------------- penyiangan
  INSERT INTO app.cost_transactions
    (company_id, block_id, cost_category_id, uom_item_id, fiscal_period_id,
     transaction_date, quantity, unit, unit_price_idr, amount_idr, is_overhead,
     approval_status, created_by, updated_by, source_table, source_record_id, note)
  SELECT b.company_id, w.block_id, p.cost_category_id, NULL,
         app.fiscal_period_on(b.company_id, w.weeded_on),
         w.weeded_on, w.area_ha,
         COALESCE(p.unit, 'ha'),
         p.rate_idr, round(w.area_ha * p.rate_idr, 2), false,
         'approved'::app.record_status, NULL, NULL,
         'weeding_records', w.id,
         'Backfill K-01 (0045): materialisasi mundur record approved'
    FROM app.weeding_records w
    JOIN app.blocks b ON b.id = w.block_id
    CROSS JOIN LATERAL app.price_for_driver(b.company_id, 'weeding_area_ha', NULL::uuid, w.weeded_on) AS p
   WHERE w.approval_status = 'approved'
     AND w.area_ha IS NOT NULL
     AND p.id IS NOT NULL
  ON CONFLICT (source_table, source_record_id)
    WHERE source_table IS NOT NULL AND reversal_of_id IS NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RAISE NOTICE 'backfill penyiangan: % baris', n;

  -- --------------------------------------------------------------- penyemprotan
  INSERT INTO app.cost_transactions
    (company_id, block_id, cost_category_id, uom_item_id, fiscal_period_id,
     transaction_date, quantity, unit, unit_price_idr, amount_idr, is_overhead,
     approval_status, created_by, updated_by, source_table, source_record_id, note)
  SELECT b.company_id, s.block_id, p.cost_category_id, NULL,
         app.fiscal_period_on(b.company_id, s.sprayed_on),
         s.sprayed_on, s.total_volume,
         COALESCE(p.unit, s.unit),
         p.rate_idr, round(s.total_volume * p.rate_idr, 2), false,
         'approved'::app.record_status, NULL, NULL,
         'spraying_records', s.id,
         'Backfill K-01 (0045): materialisasi mundur record approved'
    FROM app.spraying_records s
    JOIN app.blocks b ON b.id = s.block_id
    CROSS JOIN LATERAL app.price_for_driver(b.company_id, 'spraying_volume', s.chemical_id, s.sprayed_on) AS p
   WHERE s.approval_status = 'approved'
     AND s.total_volume IS NOT NULL
     AND p.id IS NOT NULL
  ON CONFLICT (source_table, source_record_id)
    WHERE source_table IS NOT NULL AND reversal_of_id IS NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RAISE NOTICE 'backfill penyemprotan: % baris', n;

  -- ------------------------------------------------------------------- pruning
  INSERT INTO app.cost_transactions
    (company_id, block_id, cost_category_id, uom_item_id, fiscal_period_id,
     transaction_date, quantity, unit, unit_price_idr, amount_idr, is_overhead,
     approval_status, created_by, updated_by, source_table, source_record_id, note)
  SELECT b.company_id, pr.block_id, p.cost_category_id, NULL,
         app.fiscal_period_on(b.company_id, pr.pruned_on),
         pr.pruned_on, pr.tree_count::numeric,
         COALESCE(p.unit, 'pohon'),
         p.rate_idr, round(pr.tree_count * p.rate_idr, 2), false,
         'approved'::app.record_status, NULL, NULL,
         'pruning_records', pr.id,
         'Backfill K-01 (0045): materialisasi mundur record approved'
    FROM app.pruning_records pr
    JOIN app.blocks b ON b.id = pr.block_id
    CROSS JOIN LATERAL app.price_for_driver(b.company_id, 'pruning_tree_count', NULL::uuid, pr.pruned_on) AS p
   WHERE pr.approval_status = 'approved'
     AND pr.tree_count IS NOT NULL
     AND p.id IS NOT NULL
  ON CONFLICT (source_table, source_record_id)
    WHERE source_table IS NOT NULL AND reversal_of_id IS NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RAISE NOTICE 'backfill pruning: % baris', n;

  RAISE NOTICE 'backfill K-01 selesai: total % baris cost_transactions', total;
END $$;

-- ===========================================================================
-- Gagalkan migrasi bila kesehatan bocor (pola 0039/0040)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0045', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0045', n;
  END IF;
END $$;
