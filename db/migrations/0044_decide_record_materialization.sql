-- 0043_decide_record_materialization.sql
--
-- SATU penulisan ulang app.decide_record() (terakhir didefinisikan 0034) yang
-- mewujudkan sekaligus:
--
--   K-01 §13 (aturan 1–5 MENGIKAT) — materialisasi biaya saat approve:
--     * Pemicu DI DATABASE, di dalam decide_record — tidak bisa dilewati POST langsung.
--     * Tarif dari TANGGAL KEJADIAN via app.price_at (K-02 §14), bukan CURRENT_DATE.
--     * Tarif tidak ada → unit_price_idr & amount_idr NULL, approval TETAP jalan
--       ("— bukan 0"). Konsekuensi skema: amount_idr DROP NOT NULL, dan
--       ct_category_required dilonggarkan KHUSUS baris materialisasi.
--     * Idempoten: UNIQUE parsial (source_table, source_record_id) baris non-pembalik;
--       kolom reversal_of_id disiapkan untuk baris pembalik (aturan 3, jalur koreksi
--       menyusul di AI-11).
--   AI-17 — creator tidak boleh memutuskan record buatannya sendiri. Kolom pembuat
--     per modul DIPETAKAN EKSPLISIT = kolom yang sama dengan policy *_role_split
--     (0025/0034): created_by (cost_transactions, fertilizer_applications,
--     land_preparations, land_suitability_assessments, pruning_records,
--     nursery_inspections — kolomnya ditambah 0014, weeding/spraying/harvest — 0034),
--     measured_by (dbh_measurements), submitted_by (survey_submissions).
--     Pengecualian super_admin DIIZINKAN dan DICATAT ke audit_log (§4 dokumen 13).
--   K-04 §16 — supersede kesesuaian lahan di dalam decide_record saat approve.
--   K-06 §17 — mutasi stok 'out' ditulis pada transaksi yang sama dengan baris biaya.
--
-- PANEN (revenue) SENGAJA TIDAK dimaterialisasi di sini — keputusan eksplisit:
--   (1) §13 adalah desain BIAYA; cost_transactions adalah tabel biaya — baris revenue
--       di dalamnya akan ikut terjumlah sebagai realisasi biaya di v_budget_vs_actual
--       dan v_block_cost_summary — angka salah yang tampak sah (fatal failure).
--   (2) K-03 (§15) mengubah grain panen (header + rincian per grade, satuan per
--       grade); materialisasi per-ton hari ini akan langsung dibatalkan K-03.
--   Revenue menyusul di AI-07 dengan tabel/ledger revenue sendiri.
--
-- Bukti policy untuk INSERT-sebagai-approver (SECURITY INVOKER, tugas C):
--   Policy cost_transactions saat ini: cost_transactions_tenant (0018 §1, PERMISSIVE
--   FOR ALL, WITH CHECK company dalam scope), ct_role_split (0018 §9 — RESTRICTIVE
--   **FOR UPDATE** saja), ct_no_delete_approved (FOR DELETE), viewer_readonly
--   (RESTRICTIVE FOR ALL, WITH CHECK role <> viewer). TIDAK ADA policy RESTRICTIVE
--   untuk INSERT → INSERT oleh approver lolos WITH CHECK tenant + viewer_readonly.
--   Maka TIDAK dibutuhkan fungsi SECURITY DEFINER terpisah; jalur INVOKER tetap
--   diaudit trigger cost_transactions_audit (0016) dengan actor = approver.

-- ===========================================================================
-- §1. cost_transactions: kolom provenance + pelonggaran yang dituntut aturan §13 no.2
-- ===========================================================================

ALTER TABLE app.cost_transactions ALTER COLUMN amount_idr DROP NOT NULL;

COMMENT ON COLUMN app.cost_transactions.amount_idr IS
  'NULL = biaya belum bisa dihitung (tarif belum ada saat approve — §13 aturan 2,\n'
  '"daftar belum bertarif"). JANGAN di-coalesce ke 0 (doktrin kejujuran data).';

ALTER TABLE app.cost_transactions
  ADD COLUMN source_table     text,
  ADD COLUMN source_record_id uuid,
  ADD COLUMN reversal_of_id   uuid REFERENCES app.cost_transactions(id);

COMMENT ON COLUMN app.cost_transactions.source_table IS
  'Materialisasi K-01: tabel record aktivitas asal. NULL = baris manual (overhead/upah).';
COMMENT ON COLUMN app.cost_transactions.reversal_of_id IS
  'Baris pembalik (§13 aturan 3): menunjuk baris yang dikoreksi. Koreksi TIDAK\n'
  'meng-UPDATE baris lama.';

ALTER TABLE app.cost_transactions ADD CONSTRAINT ct_source_pair
  CHECK ((source_table IS NULL) = (source_record_id IS NULL));
ALTER TABLE app.cost_transactions ADD CONSTRAINT ct_source_table_known
  CHECK (source_table IS NULL OR source_table IN (
    'fertilizer_applications', 'land_preparations', 'weeding_records',
    'spraying_records', 'pruning_records'));

-- ct_category_required (0022, divalidasi 0023): baris MANUAL tetap wajib kategori;
-- baris materialisasi boleh NULL bila baris tarifnya belum ada / belum berkategori —
-- itulah bentuk "belum bertarif" yang jujur, bukan disembunyikan.
ALTER TABLE app.cost_transactions DROP CONSTRAINT ct_category_required;
ALTER TABLE app.cost_transactions ADD CONSTRAINT ct_category_required
  CHECK (cost_category_id IS NOT NULL OR source_table IS NOT NULL);

-- Idempotensi (§13 aturan 4): tolak → perbaiki → ajukan → setujui tidak boleh
-- menghasilkan biaya ganda. Hanya baris non-pembalik yang unik.
CREATE UNIQUE INDEX ct_source_once
  ON app.cost_transactions (source_table, source_record_id)
  WHERE source_table IS NOT NULL AND reversal_of_id IS NULL;

-- ===========================================================================
-- §2. Periode fiskal dari TANGGAL KEJADIAN — satu definisi, dipindah dari
-- src/lib/repo/costing.ts:148 ke SQL supaya decide_record dan backfill memakai
-- turunan yang sama (termasuk perilaku NOT is_closed: periode tutup ⇒ NULL).
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.fiscal_period_on(p_company uuid, p_on date)
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT fp.id FROM app.fiscal_periods fp
   WHERE fp.company_id = p_company
     AND NOT fp.is_closed
     AND p_on BETWEEN fp.starts_on AND fp.ends_on
   ORDER BY fp.starts_on
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION app.fiscal_period_on(uuid, date) TO app_rw, app_ro;

-- ===========================================================================
-- §3. K-04 §16 — riwayat berversi per komoditas.
-- Kolom crop_id memang ada (ditambah 0028, FK app.crops) — dipakai apa adanya.
--
-- PENYIMPANGAN TERDOKUMENTASI dari predikat indeks lampiran:
-- lampiran menulis WHERE approval_status <> 'rejected' AND superseded_at IS NULL,
-- tetapi aturan 3 lampiran yang sama ("penilaian baru masuk sebagai DRAFT →
-- approval → baru menggeser yang lama") menuntut draft baru HIDUP BERDAMPINGAN
-- dengan penilaian approved yang masih aktif — mustahil di bawah predikat itu
-- (draft ≠ rejected ⇒ bentrok di indeks, persis gejala B-08 langkah 3 terulang).
-- Dipakai predikat approval_status = 'approved': invariannya tetap "satu penilaian
-- AKTIF per blok per komoditas", draft/submitted bebas seperti modul lain.
-- ===========================================================================

ALTER TABLE app.land_suitability_assessments
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by uuid REFERENCES app.land_suitability_assessments(id);

COMMENT ON COLUMN app.land_suitability_assessments.superseded_at IS
  'Terisi saat penilaian baru (blok+komoditas sama) di-approve lewat\n'
  'app.decide_record() — K-04 §16. NULL + approved = penilaian AKTIF.';

-- Data lama: bila ada lebih dari satu approved aktif per (block, crop) —
-- dimungkinkan indeks lama yang tanpa crop — sisakan yang terbaru, geser sisanya.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY block_id, crop_id
                            ORDER BY assessed_at DESC, created_at DESC, id DESC) AS rn,
         first_value(id) OVER (PARTITION BY block_id, crop_id
                               ORDER BY assessed_at DESC, created_at DESC, id DESC) AS keeper
    FROM app.land_suitability_assessments
   WHERE approval_status = 'approved'
)
UPDATE app.land_suitability_assessments l
   SET superseded_at = now(), superseded_by = r.keeper
  FROM ranked r
 WHERE r.id = l.id AND r.rn > 1;

DROP INDEX app.lsa_one_per_block;

-- satu penilaian AKTIF per blok per komoditas; sisanya menjadi riwayat (§16)
CREATE UNIQUE INDEX lsa_one_active_per_block_crop
  ON app.land_suitability_assessments (block_id, crop_id)
  WHERE approval_status = 'approved' AND superseded_at IS NULL;

-- §16 aturan 2: creator boleh menghapus DRAFT miliknya sendiri — policy DELETE
-- eksplisit, per perintah (pelajaran 0020). Sekaligus menutup lubang lama:
-- tanpa policy DELETE, policy tenant permissive FOR ALL membolehkan siapa pun
-- se-tenant menghapus baris apa pun.
CREATE POLICY lsa_delete_draft_own ON app.land_suitability_assessments
  AS RESTRICTIVE FOR DELETE
  USING (app.current_role_name() = 'super_admin'
         OR (created_by = app.current_user_id() AND approval_status = 'draft'));

-- ===========================================================================
-- §4. app.decide_record — SATU pintu keputusan, ditulis ulang.
-- Tetap SECURITY INVOKER (disengaja — policy *_role_split yang menggate siapa
-- boleh memutuskan; lihat bukti policy INSERT di header).
-- FOR UPDATE pada fetch: serialisasi dua keputusan atas record yang sama —
-- menutup balapan supersede/materialisasi ganda.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.decide_record(p_module text, p_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE
  n          integer := 0;
  v_actor    uuid := app.current_user_id();
  v_role     text := app.current_role_name();
  v_creator  uuid;             -- pembuat record (kolomnya beda per modul — dipetakan eksplisit)
  v_company  uuid;
  v_block    uuid;
  v_event    date;             -- TANGGAL KEJADIAN (K-02 aturan 5) — bukan tanggal approve
  v_qty      numeric;          -- volume driver biaya
  v_uom      uuid;
  v_unit     text;
  v_chem     uuid;             -- item katalog Agri-Input (bila record menunjuknya)
  v_chem_qty numeric;          -- jumlah bahan katalog yang dipakai
  v_crop     uuid;             -- kesesuaian lahan: komoditas
  v_driver   text;             -- price_list.driver modul ini; NULL = tidak dimaterialisasi
  v_src      text;             -- nama tabel sumber (source_table / audit)
  v_price    app.price_list;
  v_period   uuid;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'keputusan harus approved atau rejected';
  END IF;
  IF p_decision = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'penolakan wajib menyertakan alasan';
  END IF;

  -- -------------------------------------------------------------------------
  -- 1. Ambil metadata record sumber + kunci barisnya.
  --    Pemetaan modul → (kolom pembuat, tanggal kejadian, volume, driver):
  --      fertilizer_application      created_by  applied_on        total_quantity    fertilizer_qty
  --      land_preparation            created_by  checked_at::date  effective_area_ha landprep_area_ha
  --      weeding_record              created_by  weeded_on         area_ha           weeding_area_ha
  --      spraying_record             created_by  sprayed_on        total_volume      spraying_volume
  --      pruning_record              created_by  pruned_on         tree_count        pruning_tree_count
  --      harvest_record              created_by  (revenue — ditunda AI-07/K-03)
  --      land_suitability_assessment created_by  (supersede, tanpa biaya)
  --      nursery_inspection          created_by  (kolom dari 0014; tanpa biaya)
  --      dbh_measurement             measured_by (tanpa biaya)
  --      survey_submission           submitted_by(tanpa biaya)
  --      cost_transaction            created_by  (baris SUDAH biaya — tidak dimaterialisasi ulang)
  -- -------------------------------------------------------------------------
  CASE p_module
    WHEN 'cost_transaction' THEN
      SELECT ct.created_by, ct.company_id
        INTO v_creator, v_company
        FROM app.cost_transactions ct
       WHERE ct.id = p_id AND ct.approval_status IN ('submitted','under_review')
         FOR UPDATE OF ct;
      v_src := 'cost_transactions';
    WHEN 'fertilizer_application' THEN
      SELECT fa.created_by, b.company_id, fa.block_id, fa.applied_on,
             fa.total_quantity, fa.uom_item_id, fa.chemical_id, fa.total_quantity
        INTO v_creator, v_company, v_block, v_event, v_qty, v_uom, v_chem, v_chem_qty
        FROM app.fertilizer_applications fa
        JOIN app.blocks b ON b.id = fa.block_id
       WHERE fa.id = p_id AND fa.approval_status IN ('submitted','under_review')
         FOR UPDATE OF fa;
      v_driver := 'fertilizer_qty'; v_src := 'fertilizer_applications';
    WHEN 'land_preparation' THEN
      SELECT lp.created_by, b.company_id, lp.block_id, lp.checked_at::date, lp.effective_area_ha
        INTO v_creator, v_company, v_block, v_event, v_qty
        FROM app.land_preparations lp
        JOIN app.blocks b ON b.id = lp.block_id
       WHERE lp.id = p_id AND lp.approval_status IN ('submitted','under_review')
         FOR UPDATE OF lp;
      v_driver := 'landprep_area_ha'; v_src := 'land_preparations'; v_unit := 'ha';
    WHEN 'weeding_record' THEN
      SELECT w.created_by, b.company_id, w.block_id, w.weeded_on, w.area_ha
        INTO v_creator, v_company, v_block, v_event, v_qty
        FROM app.weeding_records w
        JOIN app.blocks b ON b.id = w.block_id
       WHERE w.id = p_id AND w.approval_status IN ('submitted','under_review')
         FOR UPDATE OF w;
      v_driver := 'weeding_area_ha'; v_src := 'weeding_records'; v_unit := 'ha';
    WHEN 'spraying_record' THEN
      SELECT s.created_by, b.company_id, s.block_id, s.sprayed_on,
             s.total_volume, s.unit, s.chemical_id, s.chemical_qty
        INTO v_creator, v_company, v_block, v_event, v_qty, v_unit, v_chem, v_chem_qty
        FROM app.spraying_records s
        JOIN app.blocks b ON b.id = s.block_id
       WHERE s.id = p_id AND s.approval_status IN ('submitted','under_review')
         FOR UPDATE OF s;
      v_driver := 'spraying_volume'; v_src := 'spraying_records';
    WHEN 'pruning_record' THEN
      SELECT pr.created_by, b.company_id, pr.block_id, pr.pruned_on, pr.tree_count::numeric
        INTO v_creator, v_company, v_block, v_event, v_qty
        FROM app.pruning_records pr
        JOIN app.blocks b ON b.id = pr.block_id
       WHERE pr.id = p_id AND pr.approval_status IN ('submitted','under_review')
         FOR UPDATE OF pr;
      v_driver := 'pruning_tree_count'; v_src := 'pruning_records'; v_unit := 'pohon';
    WHEN 'harvest_record' THEN
      -- Revenue TIDAK dimaterialisasi (lihat header — keputusan eksplisit, AI-07/K-03).
      SELECT h.created_by, b.company_id
        INTO v_creator, v_company
        FROM app.harvest_records h
        JOIN app.blocks b ON b.id = h.block_id
       WHERE h.id = p_id AND h.approval_status IN ('submitted','under_review')
         FOR UPDATE OF h;
      v_src := 'harvest_records';
    WHEN 'land_suitability_assessment' THEN
      SELECT lsa.created_by, b.company_id, lsa.block_id, lsa.crop_id
        INTO v_creator, v_company, v_block, v_crop
        FROM app.land_suitability_assessments lsa
        JOIN app.blocks b ON b.id = lsa.block_id
       WHERE lsa.id = p_id AND lsa.approval_status IN ('submitted','under_review')
         FOR UPDATE OF lsa;
      v_src := 'land_suitability_assessments';
    WHEN 'nursery_inspection' THEN
      SELECT ni.created_by, sb.company_id
        INTO v_creator, v_company
        FROM app.nursery_inspections ni
        JOIN app.seed_batches sb ON sb.id = ni.seed_batch_id
       WHERE ni.id = p_id AND ni.approval_status IN ('submitted','under_review')
         FOR UPDATE OF ni;
      v_src := 'nursery_inspections';
    WHEN 'dbh_measurement' THEN
      SELECT dm.measured_by, b.company_id
        INTO v_creator, v_company
        FROM app.dbh_measurements dm
        JOIN app.blocks b ON b.id = dm.block_id
       WHERE dm.id = p_id AND dm.approval_status IN ('submitted','under_review')
         FOR UPDATE OF dm;
      v_src := 'dbh_measurements';
    WHEN 'survey_submission' THEN
      SELECT ss.submitted_by, b.company_id
        INTO v_creator, v_company
        FROM app.survey_submissions ss
        LEFT JOIN app.blocks b ON b.id = ss.block_id
       WHERE ss.id = p_id AND ss.approval_status IN ('submitted','under_review')
         FOR UPDATE OF ss;
      v_src := 'survey_submissions';
    ELSE
      RAISE EXCEPTION 'modul tidak dikenal: %', p_module;
  END CASE;

  IF NOT FOUND THEN
    RETURN 0;   -- tidak ada / statusnya bukan menunggu — perilaku 0034 dipertahankan
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. AI-17 — larangan self-approval. Pengecualian super_admin diizinkan dan
  --    DICATAT (audit_log append-only) — "pengecualian tercatat" per §4 dokumen 13.
  -- -------------------------------------------------------------------------
  IF v_creator IS NOT NULL AND v_creator = v_actor THEN
    IF v_role = 'super_admin' THEN
      INSERT INTO app.audit_log (company_id, actor_id, action, entity_type, entity_id, diff)
      VALUES (v_company, v_actor, 'self_' || p_decision, v_src, p_id,
              jsonb_build_object('self_approval_exception', true,
                                 'module', p_module, 'decision', p_decision));
    ELSE
      RAISE EXCEPTION 'creator tidak boleh memutuskan record buatannya sendiri (AI-17)';
    END IF;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. K-04 — supersede SEBELUM status baru dipasang: indeks parsial
  --    lsa_one_active_per_block_crop menuntut penilaian lama keluar dari
  --    predikat lebih dulu. Baris sumber sudah terkunci FOR UPDATE (langkah 1),
  --    jadi urutan ini aman dari balapan.
  -- -------------------------------------------------------------------------
  IF p_module = 'land_suitability_assessment' AND p_decision = 'approved' THEN
    UPDATE app.land_suitability_assessments old
       SET superseded_at = now(), superseded_by = p_id
     WHERE old.block_id = v_block
       AND old.crop_id IS NOT DISTINCT FROM v_crop
       AND old.id <> p_id
       AND old.approval_status = 'approved'
       AND old.superseded_at IS NULL;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. Keputusan status — badan CASE 0034 dipertahankan apa adanya.
  -- -------------------------------------------------------------------------
  CASE p_module
    WHEN 'cost_transaction' THEN
      UPDATE app.cost_transactions SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END,
        updated_at = now(), updated_by = app.current_user_id()
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'fertilizer_application' THEN
      UPDATE app.fertilizer_applications SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'land_preparation' THEN
      UPDATE app.land_preparations SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'land_suitability_assessment' THEN
      UPDATE app.land_suitability_assessments SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'pruning_record' THEN
      UPDATE app.pruning_records SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'nursery_inspection' THEN
      UPDATE app.nursery_inspections SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'dbh_measurement' THEN
      UPDATE app.dbh_measurements SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'survey_submission' THEN
      UPDATE app.survey_submissions SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'weeding_record' THEN
      UPDATE app.weeding_records SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'spraying_record' THEN
      UPDATE app.spraying_records SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
    WHEN 'harvest_record' THEN
      UPDATE app.harvest_records SET approval_status = p_decision::app.record_status,
        rejection_reason = CASE WHEN p_decision='rejected' THEN p_reason END
       WHERE id = p_id AND approval_status IN ('submitted','under_review');
  END CASE;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- -------------------------------------------------------------------------
  -- 5. K-01 materialisasi + K-06 mutasi stok — hanya bila keputusan approve
  --    benar-benar terjadi (n > 0) dan modulnya beraktivitas-biaya.
  -- -------------------------------------------------------------------------
  IF n > 0 AND p_decision = 'approved' AND v_driver IS NOT NULL THEN
    v_price  := app.price_for_driver(v_company, v_driver, v_chem, v_event);
    v_period := app.fiscal_period_on(v_company, v_event);

    -- §13 aturan 2: tarif tidak ada → baris TETAP ditulis, unit_price/amount NULL
    -- ("belum bertarif"), approval tetap jalan. Volume kosong → quantity/amount NULL
    -- ("belum lengkap") — celahnya terlihat, tidak disembunyikan.
    -- ON CONFLICT = idempotensi §13 aturan 4 (indeks parsial ct_source_once).
    INSERT INTO app.cost_transactions
      (company_id, block_id, cost_category_id, uom_item_id, fiscal_period_id,
       transaction_date, quantity, unit, unit_price_idr, amount_idr, is_overhead,
       approval_status, created_by, updated_by, source_table, source_record_id, note)
    VALUES
      (v_company, v_block, (v_price).cost_category_id, v_uom, v_period,
       v_event, v_qty,
       COALESCE((v_price).unit, v_unit,
                (SELECT mi.code FROM app.master_items mi WHERE mi.id = v_uom)),
       (v_price).rate_idr,
       CASE WHEN v_qty IS NOT NULL AND (v_price).rate_idr IS NOT NULL
            THEN round(v_qty * (v_price).rate_idr, 2) END,
       false,
       'approved', v_actor, v_actor, v_src, p_id, NULL)
    ON CONFLICT (source_table, source_record_id)
      WHERE source_table IS NOT NULL AND reversal_of_id IS NULL
      DO NOTHING;

    -- K-06: mutasi 'out' pada transaksi yang sama — hanya bila record JUJUR
    -- menunjuk item katalog DAN jumlah bahannya tercatat (lihat header 0043).
    IF v_chem IS NOT NULL AND v_chem_qty IS NOT NULL THEN
      INSERT INTO app.agri_input_stock_movements
        (company_id, chemical_id, moved_on, direction, quantity,
         source_table, source_record_id, created_by)
      VALUES
        (v_company, v_chem, v_event, 'out', v_chem_qty, v_src, p_id, v_actor)
      ON CONFLICT (source_table, source_record_id) WHERE direction = 'out'
        DO NOTHING;
    END IF;
  END IF;

  RETURN n;
END $function$;

-- CREATE OR REPLACE mempertahankan ACL, tapi ditegaskan ulang (idempoten).
GRANT EXECUTE ON FUNCTION app.decide_record(text, uuid, text, text) TO app_rw;

-- ===========================================================================
-- §5. Gagalkan migrasi bila kesehatan bocor (pola 0039/0040)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0044', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0044', n;
  END IF;
END $$;
