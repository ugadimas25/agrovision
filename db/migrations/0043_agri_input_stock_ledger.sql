-- 0042_agri_input_stock_ledger.sql
--
-- K-06 Keputusan 1 (docs/13 §17, MENGIKAT): stok menjadi BUKU BESAR mutasi,
-- bukan kolom. Skema tabel disalin dari lampiran; dua penyimpangan kecil yang
-- tak terhindarkan didokumentasikan pada constraint-nya:
--   * CHECK (quantity > 0) lampiran kontradiktif dengan formula turunannya
--     "Σ in − Σ out ± adjustment" — adjustment butuh tanda. Dipakai
--     sm_quantity_sign: in/out > 0, adjustment <> 0 (boleh negatif = susut).
--   * 'in' wajib unit_price_idr, 'adjustment' wajib note, 'out' wajib menunjuk
--     record sumber — semuanya dari tabel keputusan §17, dinyatakan sebagai CHECK.
--
-- Yang JUJUR bisa dicatat otomatis sekarang (tugas D):
--   * Penyemprotan punya chemical_id (0034) tetapi TIDAK mencatat jumlah bahan —
--     total_volume adalah volume LARUTAN. Mengurangi stok sebesar larutan =
--     mengarang angka. Ditambahkan kolom spraying_records.chemical_qty (jumlah
--     bahan katalog, satuan katalog); mutasi 'out' hanya ditulis bila terisi.
--   * Pemupukan TIDAK punya relasi ke katalog (fertilizer_type_id ≠ chemical).
--     Ditambahkan kolom opsional fertilizer_applications.chemical_id; total_quantity
--     memang jumlah bahan, jadi 'out' ditulis bila kolom itu terisi.
--   * TIDAK ada backfill 'out' untuk record lama: datanya tidak pernah ada.
--
-- Urutan di file ini PENTING untuk Cloud SQL (postgres bukan superuser, memori
-- proyek agrovision-cloudsql-force-rls): saldo awal ditulis SEBELUM RLS/FORCE
-- dipasang, supaya INSERT pemilik tidak terjegal policy tanpa konteks sesi.

-- ===========================================================================
-- §1. Tabel buku besar (salinan §17 + constraint pengaman)
-- ===========================================================================

CREATE TABLE app.agri_input_stock_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES app.companies(id),
  chemical_id      uuid NOT NULL REFERENCES app.agri_input_chemicals(id),
  moved_on         date NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in','out','adjustment')),
  quantity         numeric(14,2) NOT NULL,
  unit_price_idr   numeric(16,2) CHECK (unit_price_idr IS NULL OR unit_price_idr >= 0),
  source_table     text,                 -- 'fertilizer_applications' | 'spraying_records' | NULL (pembelian)
  source_record_id uuid,
  note             text,
  created_by       uuid REFERENCES app.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- §17: formula stok "± adjustment" menuntut adjustment bertanda.
  CONSTRAINT sm_quantity_sign CHECK (
    (direction = 'adjustment' AND quantity <> 0)
    OR (direction <> 'adjustment' AND quantity > 0)),
  CONSTRAINT sm_in_needs_price CHECK (direction <> 'in' OR unit_price_idr IS NOT NULL),
  CONSTRAINT sm_adjustment_needs_note CHECK (
    direction <> 'adjustment' OR (note IS NOT NULL AND length(btrim(note)) > 0)),
  CONSTRAINT sm_out_needs_source CHECK (
    direction <> 'out' OR (source_table IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT sm_source_pair CHECK ((source_table IS NULL) = (source_record_id IS NULL))
);

COMMENT ON TABLE app.agri_input_stock_movements IS
  'Buku besar mutasi stok Agri-Input (K-06 Keputusan 1). Append-only; koreksi =\n'
  'baris adjustment baru, bukan mengubah baris lama. stock_qty adalah TURUNAN\n'
  '(lihat app.v_agri_input_stock), bukan kolom.';

-- Integritas lintas-tenant lewat composite FK (pola 0018 §6): mutasi tidak
-- boleh menunjuk item katalog tenant lain.
CREATE UNIQUE INDEX agri_input_chemicals_company_id_uniq
  ON app.agri_input_chemicals (company_id, id);
ALTER TABLE app.agri_input_stock_movements
  ADD CONSTRAINT sm_chemical_same_company
  FOREIGN KEY (company_id, chemical_id) REFERENCES app.agri_input_chemicals (company_id, id);

-- Idempotensi jalur approval: satu mutasi 'out' per record sumber.
CREATE UNIQUE INDEX sm_out_once_per_source
  ON app.agri_input_stock_movements (source_table, source_record_id)
  WHERE direction = 'out';

CREATE INDEX sm_chemical_idx ON app.agri_input_stock_movements (chemical_id, moved_on DESC);
CREATE INDEX sm_company_dir_idx ON app.agri_input_stock_movements (company_id, direction);

-- ===========================================================================
-- §2. Hak akses + append-only lewat ledger (0019)
-- Catatan: bootstrap-role.mjs dan ALTER DEFAULT PRIVILEGES memberi blanket
-- SELECT/INSERT/UPDATE/DELETE — pencabutan WAJIB lewat ledger supaya dipasang
-- ulang setiap bootstrap.
-- ===========================================================================

GRANT SELECT, INSERT ON app.agri_input_stock_movements TO app_rw;
GRANT SELECT ON app.agri_input_stock_movements TO app_ro;

INSERT INTO app.privilege_revocations (table_name, privileges, reason) VALUES
  ('agri_input_stock_movements', 'UPDATE, DELETE',
   'buku besar stok append-only (K-06 Keputusan 1); koreksi lewat baris adjustment')
ON CONFLICT (table_name, privileges) DO NOTHING;

REVOKE UPDATE, DELETE ON app.agri_input_stock_movements FROM app_rw;

-- ===========================================================================
-- §3. Saldo awal: nilai kolom stock_qty lama dipindahkan menjadi baris
-- 'adjustment' (opname awal — 'in' menuntut harga beli yang datanya tidak ada,
-- mengarangnya dilarang). HARUS sebelum RLS/FORCE (lihat header).
-- ===========================================================================

INSERT INTO app.agri_input_stock_movements
  (company_id, chemical_id, moved_on, direction, quantity, note, created_by)
SELECT c.company_id, c.id, c.created_at::date, 'adjustment', c.stock_qty,
       'Saldo awal — migrasi kolom agri_input_chemicals.stock_qty (0043)', c.created_by
  FROM app.agri_input_chemicals c
 WHERE c.stock_qty <> 0;

-- Dua sumber kebenaran untuk satu fakta adalah cacat (pelajaran 0023):
-- kolomnya dihapus, pembaca pindah ke view turunan (§6).
ALTER TABLE app.agri_input_chemicals DROP COLUMN stock_qty;

-- ===========================================================================
-- §4. Kolom penghubung modul → katalog (lihat header, tugas D)
-- ===========================================================================

ALTER TABLE app.fertilizer_applications
  ADD COLUMN chemical_id uuid REFERENCES app.agri_input_chemicals(id);
COMMENT ON COLUMN app.fertilizer_applications.chemical_id IS
  'Opsional: item katalog Agri-Input yang dipakai. Bila terisi, app.decide_record()\n'
  'menulis mutasi stok ''out'' sebesar total_quantity saat approve (K-06).';

ALTER TABLE app.spraying_records
  ADD COLUMN chemical_qty numeric(14,2) CHECK (chemical_qty IS NULL OR chemical_qty > 0);
COMMENT ON COLUMN app.spraying_records.chemical_qty IS
  'Jumlah BAHAN katalog yang dipakai (satuan katalog). BUKAN total_volume —\n'
  'total_volume adalah volume larutan (driver biaya). Bila terisi (dan chemical_id\n'
  'ada), app.decide_record() menulis mutasi ''out'' sebesar nilai ini saat approve.';

-- ===========================================================================
-- §5. RLS: tenant + pemisahan arah per §17 (in/adjustment = super_admin,
-- out = jalur approval yang berjalan sebagai approver lewat SECURITY INVOKER).
-- Pelajaran 0020: pembatasan tulis dipecah per perintah, tidak menyentuh SELECT.
-- FORCE dipasang TERAKHIR (lihat header soal Cloud SQL).
-- ===========================================================================

ALTER TABLE app.agri_input_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY sm_tenant ON app.agri_input_stock_movements
  USING (app.company_in_scope(company_id))
  WITH CHECK (app.company_in_scope(company_id));

CREATE POLICY sm_direction_writer ON app.agri_input_stock_movements
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    (direction = 'out' AND app.current_role_name() IN ('approver', 'super_admin'))
    OR (direction IN ('in', 'adjustment') AND app.current_role_name() = 'super_admin')
  );

-- Append-only juga di lapisan policy: tidak ada peran aplikasi yang boleh
-- mengubah/menghapus baris buku besar, termasuk super_admin.
CREATE POLICY sm_no_update ON app.agri_input_stock_movements
  AS RESTRICTIVE FOR UPDATE
  USING (false);
CREATE POLICY sm_no_delete ON app.agri_input_stock_movements
  AS RESTRICTIVE FOR DELETE
  USING (false);

ALTER TABLE app.agri_input_stock_movements FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- §6. Stok turunan: VIEW (bukan kolom generated — generated column tidak bisa
-- mengagregasi tabel lain). stock_qty 0 pada buku besar kosong adalah FAKTA
-- hasil hitung (seperti transaction_count di 0039), bukan fabrikasi: buku besar
-- adalah satu-satunya sumber stok per K-06. needs_reorder NULL bila
-- reorder_level belum diisi — bukan false.
-- ===========================================================================

CREATE VIEW app.v_agri_input_stock
WITH (security_invoker = true) AS
SELECT
  c.id            AS chemical_id,
  c.company_id,
  c.code,
  c.name,
  c.category,
  c.is_organic,
  c.unit,
  c.reorder_level,
  c.rec_phase,
  c.rec_note,
  c.is_active,
  c.created_at,
  c.created_by,
  COALESCE(m.stock_qty, 0) AS stock_qty,
  m.last_moved_on,
  CASE WHEN c.reorder_level IS NULL THEN NULL
       ELSE COALESCE(m.stock_qty, 0) <= c.reorder_level
  END             AS needs_reorder
FROM app.agri_input_chemicals c
LEFT JOIN LATERAL (
  SELECT SUM(CASE sm.direction
               WHEN 'in'  THEN sm.quantity
               WHEN 'out' THEN -sm.quantity
               ELSE sm.quantity          -- adjustment sudah bertanda
             END)            AS stock_qty,
         MAX(sm.moved_on)    AS last_moved_on
    FROM app.agri_input_stock_movements sm
   WHERE sm.chemical_id = c.id
) m ON true;

COMMENT ON VIEW app.v_agri_input_stock IS
  'Stok turunan buku besar (Σ in − Σ out ± adjustment, K-06 Keputusan 1).\n'
  'needs_reorder NULL = reorder_level belum diisi (bukan false).';

-- Sabuk pengaman reloption (pelajaran 0035/0036/0039).
ALTER VIEW app.v_agri_input_stock SET (security_invoker = true);

GRANT SELECT ON app.v_agri_input_stock TO app_rw, app_ro;

INSERT INTO app.report_allowed_views (view_name, note)
VALUES ('v_agri_input_stock', 'Stok Agri-Input turunan buku besar + penanda reorder')
ON CONFLICT (view_name) DO NOTHING;

-- ===========================================================================
-- §7. Gagalkan migrasi bila kesehatan bocor (pola 0039/0040)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0043', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0043', n;
  END IF;
END $$;
