-- 0041_price_list_versioning.sql
--
-- K-02 (docs/13 §14, MENGIKAT): tarif diberi dimensi waktu — version + valid_from/valid_to,
-- satu versi terbuka per kode, pencarian lewat SATU pintu app.price_at(code, on),
-- penerbitan lewat app.publish_price() SECURITY DEFINER self-gate super_admin
-- (meniru app.publish_emission_factor, 0018_security_fix.sql §4: search_path minimal,
-- REVOKE PUBLIC, larang backdating). price_list menjadi append-only: REVOKE dari app_rw
-- + didaftarkan di app.privilege_revocations (ledger 0019) supaya bootstrap-role.mjs
-- tidak membukanya lagi lewat GRANT ON ALL TABLES.
--
-- Juga di sini (satu file karena semuanya menyentuh price_list):
--   * AI-02: CHECK driver diperluas — weeding_area_ha, spraying_volume, pruning_tree_count.
--   * §17 "satu sumber kebenaran harga": kolom chemical_id (FK katalog).
--   * K-01: kolom cost_category_id — kategori akuntansi baris tarif, dipakai
--     decide_record saat materialisasi. Dipilih KOLOM (bukan pemetaan kode→kategori di
--     fungsi) karena kategori adalah master data per tenant; db/seed-demo.mjs:763 mengisi
--     price_list.category sebagai teks bebas yang tidak bisa dipercaya sebagai kunci.
--   * §17 Keputusan 3: policy writer menyempit ke super_admin. Policy lama FOR ALL
--     USING(true) aman untuk SELECT (dicek §17 titik 1), tetapi pengganti dipecah
--     per perintah mengikuti pelajaran 0020 — SELECT sengaja tidak dibatasi.
--   * K-09: app.update_price_meta() — tanpa ini, append-only membuat kelas
--     "edit in-place" (category/note/is_active) mustahil selamanya.

-- ===========================================================================
-- §1. Kolom versi (salinan skema §14) + kolom rujukan
-- ===========================================================================

ALTER TABLE app.price_list
  ADD COLUMN version    integer NOT NULL DEFAULT 1,
  ADD COLUMN valid_from date NOT NULL DEFAULT DATE '2026-01-01',
  ADD COLUMN valid_to   date,                    -- NULL = masih berlaku
  ADD COLUMN cost_category_id uuid REFERENCES app.master_items(id),
  ADD COLUMN chemical_id      uuid REFERENCES app.agri_input_chemicals(id);

COMMENT ON COLUMN app.price_list.cost_category_id IS
  'Kategori akuntansi (master_items cost_category) baris tarif ini. Dipakai\n'
  'app.decide_record() sebagai cost_category_id baris materialisasi (K-01 §13).';
COMMENT ON COLUMN app.price_list.chemical_id IS
  'Opsional: item katalog Agri-Input yang tarifnya baris ini (§17 "satu sumber\n'
  'kebenaran harga"). NULL = tarif generik untuk driver-nya.';

-- satu kode kini punya banyak versi → UNIQUE (company_id, code) lama dilepas.
-- Nama constraint auto-generated, dicari dinamis (pola 0018 §7).
DO $$
DECLARE con text;
BEGIN
  FOR con IN
    SELECT c.conname FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'app' AND t.relname = 'price_list' AND c.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE app.price_list DROP CONSTRAINT %I', con);
  END LOOP;
END $$;

-- hanya boleh ada satu versi terbuka per kode (§14)
CREATE UNIQUE INDEX price_list_one_open
  ON app.price_list (company_id, code) WHERE valid_to IS NULL;

ALTER TABLE app.price_list ADD CONSTRAINT price_valid_range
  CHECK (valid_to IS NULL OR valid_to >= valid_from);

-- pencarian versi per tanggal harus murah
CREATE INDEX price_list_window_idx ON app.price_list (company_id, code, valid_from DESC);

-- ===========================================================================
-- §2. AI-02 — driver refleksi diperluas (AKAR-2)
-- weeding→area_ha, spraying→total_volume, pruning→tree_count. Panen TIDAK diberi
-- driver: revenue bukan cost, dan K-03 mengubah grain-nya (lihat 0044).
-- ===========================================================================

DO $$
DECLARE con text;
BEGIN
  SELECT c.conname INTO con FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'app' AND t.relname = 'price_list' AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%driver%ANY%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app.price_list DROP CONSTRAINT %I', con);
  END IF;
END $$;

ALTER TABLE app.price_list ADD CONSTRAINT price_list_driver_check
  CHECK (driver IS NULL OR driver IN (
    'block_area_ha', 'landprep_area_ha', 'seedling_qty', 'fertilizer_qty',
    'weeding_area_ha', 'spraying_volume', 'pruning_tree_count'
  ));

-- Baris tarif seed yang selama ini ber-driver NULL (WEED-HA/SPRAY-L/PRUNE-TREE)
-- kini dinyatakan sebagai driver — inilah yang membuat B-05/B-07 punya harga.
UPDATE app.price_list SET driver = 'weeding_area_ha'    WHERE code = 'WEED-HA'    AND driver IS NULL;
UPDATE app.price_list SET driver = 'spraying_volume'    WHERE code = 'SPRAY-L'    AND driver IS NULL;
UPDATE app.price_list SET driver = 'pruning_tree_count' WHERE code = 'PRUNE-TREE' AND driver IS NULL;

-- ===========================================================================
-- §3. Pemetaan kategori akuntansi untuk baris seed yang sudah ada.
-- Join per company lewat KODE master (COST_TREE db/seed-demo.mjs) — hanya terisi
-- bila kedua sisi ada, jadi aman untuk tenant mana pun. Level INDUK dipakai
-- karena anggaran demo dipasang di level induk (v_budget_vs_actual mencocokkan
-- cost_category_id secara persis).
-- SPRAY-L (bahan+tenaga campuran) dan MAP-HA sengaja DIBIARKAN NULL — tidak ada
-- kategori yang jujur; super_admin memetakannya lewat update_price_meta.
-- ===========================================================================

UPDATE app.price_list pl
   SET cost_category_id = mi.id
  FROM (VALUES
         ('PREP-HA',   'LANDPREP'),
         ('FERT-KG',   'FERTILIZER'),
         ('SEED-UNIT', 'SEEDLING'),
         ('LABOR-DAY', 'LABOR'),
         ('WEED-HA',   'LABOR'),
         ('PRUNE-TREE','LABOR')
       ) AS map(price_code, cat_code)
  JOIN app.master_items mi ON mi.code = map.cat_code AND mi.parent_id IS NULL
  JOIN app.master_types mt ON mt.id = mi.master_type_id AND mt.code = 'cost_category'
 WHERE pl.code = map.price_code
   AND pl.cost_category_id IS NULL
   AND mi.company_id = pl.company_id;

-- ===========================================================================
-- §4. Satu pintu pencarian tarif (§14): app.price_at(code, on[, company])
-- SECURITY INVOKER: RLS pembaca berlaku. Parameter ke-3 opsional untuk sesi
-- multi-entitas (decide_record selalu mengisinya dari company blok record).
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.price_at(p_code text, p_on date, p_company uuid DEFAULT NULL)
RETURNS app.price_list
LANGUAGE sql STABLE AS $$
  SELECT pl.* FROM app.price_list pl
   WHERE pl.code = p_code
     AND (p_company IS NULL OR pl.company_id = p_company)
     AND p_on >= pl.valid_from
     AND (pl.valid_to IS NULL OR p_on <= pl.valid_to)
   ORDER BY pl.valid_from DESC
   LIMIT 1
$$;

COMMENT ON FUNCTION app.price_at(text, date, uuid) IS
  'K-02: versi tarif yang berlaku pada TANGGAL KEJADIAN. NULL bila tidak ada.\n'
  'Bentuk dua argumen (§14) tetap berlaku lewat DEFAULT.';

-- Resolusi modul→baris tarif untuk materialisasi: cari KODE per (company, driver,
-- chemical) lalu serahkan pemilihan versi ke price_at — pintu tunggalnya tetap satu.
-- Baris ber-chemical_id yang cocok menang atas baris generik; baris ber-chemical
-- lain TIDAK ikut (tarif item X tidak boleh menghargai item Y).
CREATE OR REPLACE FUNCTION app.price_for_driver(p_company uuid, p_driver text, p_chemical uuid, p_on date)
RETURNS app.price_list
LANGUAGE plpgsql STABLE AS $$
DECLARE v_code text;
BEGIN
  IF p_company IS NULL OR p_driver IS NULL OR p_on IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT pl.code INTO v_code
    FROM app.price_list pl
   WHERE pl.company_id = p_company
     AND pl.kind = 'cost'
     AND pl.is_active
     AND pl.driver = p_driver
     AND (pl.chemical_id IS NULL OR pl.chemical_id = p_chemical)
     AND p_on >= pl.valid_from
     AND (pl.valid_to IS NULL OR p_on <= pl.valid_to)
   ORDER BY (pl.chemical_id = p_chemical) DESC NULLS LAST, pl.code
   LIMIT 1;
  IF v_code IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN app.price_at(v_code, p_on, p_company);
END $$;

GRANT EXECUTE ON FUNCTION app.price_at(text, date, uuid) TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION app.price_for_driver(uuid, text, uuid, date) TO app_rw, app_ro;

-- ===========================================================================
-- §5. app.publish_price — tutup versi lama + terbitkan versi baru, SATU pintu tulis.
-- Meniru publish_emission_factor (0018 §4). Self-gate super_admin (§17 Keputusan 3).
-- Kekal (K-09): code, kind, driver. Berversi: rate_idr + unit. p_category/p_note/
-- p_cost_category_id/p_chemical_id hanya dibaca saat KODE BARU; untuk kode lama
-- pakai update_price_meta.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.publish_price(
  p_code             text,
  p_rate_idr         numeric,
  p_valid_from       date,
  p_unit             text DEFAULT NULL,
  p_company_id       uuid DEFAULT NULL,
  p_kind             text DEFAULT NULL,
  p_category         text DEFAULT NULL,
  p_driver           text DEFAULT NULL,
  p_cost_category_id uuid DEFAULT NULL,
  p_chemical_id      uuid DEFAULT NULL,
  p_note             text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog
AS $$
DECLARE
  v_actor     uuid := app.current_user_id();
  v_company   uuid := COALESCE(p_company_id, app.current_company_id());
  v_base      app.price_list;
  v_last_edge date;
  v_next      integer;
  v_id        uuid;
BEGIN
  IF app.current_role_name() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'hanya super_admin boleh menerbitkan tarif (K-06 Keputusan 3)';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'konteks sesi wajib — penerbitan tarif harus dapat diatribusikan';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'entitas wajib — pilih satu entitas atau isi p_company_id';
  END IF;
  IF NOT app.company_in_scope(v_company) THEN
    RAISE EXCEPTION 'entitas % di luar akses Anda', v_company;
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'code wajib';
  END IF;
  IF p_rate_idr IS NULL OR p_rate_idr < 0 THEN
    RAISE EXCEPTION 'rate_idr harus >= 0 (diberikan: %)', p_rate_idr;
  END IF;
  IF p_valid_from IS NULL THEN
    RAISE EXCEPTION 'valid_from wajib';
  END IF;

  -- versi terbaru sebagai baseline pewarisan field
  SELECT * INTO v_base FROM app.price_list
   WHERE company_id = v_company AND code = p_code
   ORDER BY version DESC LIMIT 1;

  IF v_base.id IS NULL THEN
    -- ===== kode baru: versi 1 (jalur create AI-44a) =====
    IF p_kind IS NULL OR p_kind NOT IN ('cost', 'revenue') THEN
      RAISE EXCEPTION 'kind (cost|revenue) wajib untuk kode baru';
    END IF;
    IF p_category IS NULL OR btrim(p_category) = '' THEN
      RAISE EXCEPTION 'category wajib untuk kode baru';
    END IF;
    IF p_unit IS NULL OR btrim(p_unit) = '' THEN
      RAISE EXCEPTION 'unit wajib untuk kode baru';
    END IF;
    INSERT INTO app.price_list
      (company_id, code, kind, category, driver, unit, rate_idr, note, is_active,
       version, valid_from, valid_to, cost_category_id, chemical_id, updated_at, updated_by)
    VALUES
      (v_company, p_code, p_kind, p_category, p_driver, p_unit, p_rate_idr, p_note, true,
       1, p_valid_from, NULL, p_cost_category_id, p_chemical_id, now(), v_actor)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- ===== kode lama: field kekal tidak boleh dibelokkan lewat parameter =====
  IF p_kind IS NOT NULL AND p_kind IS DISTINCT FROM v_base.kind THEN
    RAISE EXCEPTION 'kind kekal (K-09): % tidak bisa menjadi %', v_base.kind, p_kind;
  END IF;
  IF p_driver IS NOT NULL AND p_driver IS DISTINCT FROM v_base.driver THEN
    RAISE EXCEPTION 'driver kekal (K-09): buat baris kode baru dan nonaktifkan yang lama';
  END IF;

  -- Timeline hanya boleh maju (K-02 aturan 2 — backdating dilarang).
  -- GREATEST mengabaikan NULL, jadi kode yang sudah tertutup pun terjaga.
  SELECT GREATEST(max(valid_from), max(valid_to)) INTO v_last_edge
    FROM app.price_list WHERE company_id = v_company AND code = p_code;
  IF p_valid_from <= v_last_edge THEN
    RAISE EXCEPTION 'backdating dilarang (K-02 aturan 2): valid_from (%) harus setelah %',
      p_valid_from, v_last_edge;
  END IF;

  -- tutup versi terbuka (bila ada)
  UPDATE app.price_list
     SET valid_to = p_valid_from - 1, updated_at = now(), updated_by = v_actor
   WHERE company_id = v_company AND code = p_code AND valid_to IS NULL;

  SELECT COALESCE(max(version), 0) + 1 INTO v_next
    FROM app.price_list WHERE company_id = v_company AND code = p_code;

  INSERT INTO app.price_list
    (company_id, code, kind, category, driver, unit, rate_idr, note, is_active,
     version, valid_from, valid_to, cost_category_id, chemical_id, updated_at, updated_by)
  VALUES
    (v_company, p_code, v_base.kind, v_base.category, v_base.driver,
     COALESCE(p_unit, v_base.unit), p_rate_idr, COALESCE(p_note, v_base.note),
     v_base.is_active, v_next, p_valid_from, NULL,
     COALESCE(p_cost_category_id, v_base.cost_category_id),
     COALESCE(p_chemical_id, v_base.chemical_id), now(), v_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION app.publish_price(
  text, numeric, date, text, uuid, text, text, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_price(
  text, numeric, date, text, uuid, text, text, text, uuid, uuid, text) TO app_rw;

-- ===========================================================================
-- §6. app.update_price_meta — kelas "edit in-place" K-09: category, note,
-- is_active (+ cost_category_id, rujukan akuntansi yang satu kelas dengan
-- category). Diterapkan ke SEMUA versi kode supaya riwayat terbaca konsisten.
-- Perubahan tercatat otomatis lewat trigger audit (§8).
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.update_price_meta(
  p_id               uuid,
  p_category         text DEFAULT NULL,
  p_note             text DEFAULT NULL,
  p_is_active        boolean DEFAULT NULL,
  p_cost_category_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog
AS $$
DECLARE
  v_actor   uuid := app.current_user_id();
  v_company uuid;
  v_code    text;
  n         integer;
BEGIN
  IF app.current_role_name() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'hanya super_admin boleh mengubah metadata tarif (K-06 Keputusan 3)';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'konteks sesi wajib';
  END IF;
  SELECT company_id, code INTO v_company, v_code FROM app.price_list WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'baris tarif % tidak ditemukan', p_id;
  END IF;
  IF NOT app.company_in_scope(v_company) THEN
    RAISE EXCEPTION 'entitas di luar akses Anda';
  END IF;
  UPDATE app.price_list
     SET category         = COALESCE(p_category, category),
         note             = COALESCE(p_note, note),
         is_active        = COALESCE(p_is_active, is_active),
         cost_category_id = COALESCE(p_cost_category_id, cost_category_id),
         updated_at = now(), updated_by = v_actor
   WHERE company_id = v_company AND code = v_code;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION app.update_price_meta(uuid, text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_price_meta(uuid, text, text, boolean, uuid) TO app_rw;

-- ===========================================================================
-- §7. Append-only (§14 aturan 3, diperkuat): INSERT ikut dicabut supaya SATU-
-- SATUNYA jalur tulis adalah publish_price/update_price_meta (preseden:
-- user_company_access di ledger 0019 — 'hanya via fungsi bergerbang').
-- Seed & migrasi tetap bisa menulis karena berjalan sebagai pemilik tabel.
-- ===========================================================================

INSERT INTO app.privilege_revocations (table_name, privileges, reason) VALUES
  ('price_list', 'INSERT, UPDATE, DELETE',
   'tarif berversi append-only (K-02); tulis hanya via publish_price/update_price_meta')
ON CONFLICT (table_name, privileges) DO NOTHING;

REVOKE INSERT, UPDATE, DELETE ON app.price_list FROM app_rw;

-- ===========================================================================
-- §8. Policy writer menyempit ke super_admin (§17 Keputusan 3).
-- Pelajaran 0020: JANGAN FOR ALL bila hanya membatasi tulis — dipecah per
-- perintah; SELECT sengaja tidak dibatasi (katalog terbaca semua role, §17).
-- Tetap dipasang walau privilege sudah dicabut: pertahanan berlapis untuk
-- konteks owner ber-FORCE (Cloud SQL) dan bila GRANT kembali tanpa sengaja.
-- ===========================================================================

DROP POLICY price_list_writer ON app.price_list;

CREATE POLICY price_list_writer_insert ON app.price_list
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.current_role_name() = 'super_admin');

CREATE POLICY price_list_writer_update ON app.price_list
  AS RESTRICTIVE FOR UPDATE
  USING (app.current_role_name() = 'super_admin')
  WITH CHECK (app.current_role_name() = 'super_admin');

CREATE POLICY price_list_writer_delete ON app.price_list
  AS RESTRICTIVE FOR DELETE
  USING (app.current_role_name() = 'super_admin');

-- Jejak audit pada pengendali seluruh angka keuangan — wajib (K-09).
CREATE TRIGGER price_list_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.price_list
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

-- ===========================================================================
-- §9. Gagalkan migrasi bila kesehatan bocor (pola 0039/0040)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0041', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0041', n;
  END IF;
END $$;
