-- 0062_budget_assumptions.sql
-- Tahap 2 dari docs/19-rab-dari-excel-banyumas.md: pusat asumsi + penggerak
-- yang benar-benar menghitung.
--
-- Di model Banyumas, volume TIDAK pernah diketik. 17_Model_Fleksibel bagian E
-- menyusunnya sebagai `Jumlah = Basis x Rasio per basis`, dan basisnya menunjuk
-- 02_Assumptions: luas bruto 100 ha -> areal efektif 88 ha -> populasi per
-- kerapatan. Peta ketergantungan (bagian H) menyebut akibatnya: satu perubahan
-- luas bruto menggerakkan CAPEX, OPEX, produksi, dan arus kas sekaligus.
--
-- 0060/0061 masih menyimpan volume sebagai angka mati. Artinya mengubah asumsi
-- luas berarti menyunting sebelas baris satu per satu, tanpa jaminan semuanya
-- ikut berubah -- dan RAB yang setengah berubah lebih berbahaya daripada RAB
-- yang salah seluruhnya, karena ia terlihat konsisten.
--
-- DUA ATURAN yang membentuk migrasi ini:
--
-- 1. Asumsi milik SATU RAB, bukan global. Dua RAB boleh berangkat dari luas
--    berbeda (mis. skenario 80 ha vs 100 ha) tanpa saling menimpa. Ini juga
--    yang nanti membuat skenario 1-vs-4-lokasi (tahap 3) bisa dibangun tanpa
--    membongkar apa pun.
--
-- 2. Asumsi TERKUNCI begitu RAB diajukan. Kalau tidak, mengubah satu angka
--    asumsi akan diam-diam menggeser nilai RAB yang SUDAH DISETUJUI finance --
--    persetujuan atas angka yang kemudian berubah sendiri bukan persetujuan.
--    Penguncian memakai policy yang sama bentuknya dengan bp_edit_gate (0060).

-- ===========================================================================
-- §1. Pusat asumsi
-- ===========================================================================

CREATE TABLE app.budget_assumptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES app.budget_plans(id) ON DELETE CASCADE,
  -- Kode dipakai baris RAB untuk menunjuk asumsi ini (basis_code). Huruf kecil
  -- + garis bawah supaya bisa ditulis tangan tanpa ragu: 'gross_ha', 'net_ha'.
  code        text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  value       numeric(18,4) NOT NULL,
  unit        text,
  -- Kolom "ID sumber" dan "Tingkat keyakinan" di 02_Assumptions. Keduanya
  -- nullable TANPA default: asumsi yang belum ditelaah harus terlihat begitu,
  -- bukan disamarkan jadi 'medium'.
  source_ref  text,
  confidence  app.assumption_confidence,
  note        text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES app.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, code)
);

COMMENT ON TABLE app.budget_assumptions IS
  'Pusat penggerak satu RAB, mengikuti 02_Assumptions pada model Banyumas. '
  'Baris RAB menunjuk kodenya lewat budget_plan_items.basis_code, dan volumenya '
  'dihitung ulang otomatis saat nilai di sini berubah.';

COMMENT ON COLUMN app.budget_assumptions.value IS
  'Nilai asumsi. Boleh 0 -- di model Banyumas harga akuisisi lahan sengaja 0 '
  'dengan sumber "OPEN" dan catatan "wajib diisi setelah due diligence". Nol '
  'yang DISENGAJA dan bersumber berbeda dari nol yang berarti "belum diisi": '
  'yang kedua ditulis dengan membiarkan source_ref/confidence kosong.';

CREATE INDEX budget_assumptions_plan_idx ON app.budget_assumptions (plan_id, sort_order);

-- ===========================================================================
-- §2. Baris RAB bisa diturunkan dari asumsi
-- ===========================================================================

ALTER TABLE app.budget_plan_items
  ADD COLUMN basis_code      text,
  ADD COLUMN ratio_per_basis numeric(18,6);

COMMENT ON COLUMN app.budget_plan_items.basis_code IS
  'Kode asumsi yang menjadi basis volume (budget_assumptions.code). NULL = '
  'volume diketik tangan, dan itu tetap sah -- tidak semua baris punya basis '
  'yang jelas (mis. "Farm master plan & BOQ design" di 08 berbasis lot).';

COMMENT ON COLUMN app.budget_plan_items.ratio_per_basis IS
  'Rasio per satuan basis, mengikuti kolom "Rasio per basis" di 17 bagian E. '
  'volume = nilai asumsi x rasio. Wajib berpasangan dengan basis_code.';

ALTER TABLE app.budget_plan_items
  ADD CONSTRAINT bpi_basis_berpasangan
    CHECK ((basis_code IS NULL) = (ratio_per_basis IS NULL));

-- ===========================================================================
-- §3. Volume turunan
--
-- Dihitung di DATABASE, bukan di aplikasi. Alasannya sama dengan amount_idr
-- yang sudah GENERATED sejak 0060: kalau perkaliannya hidup di TypeScript,
-- seed, skrip impor, dan perbaikan manual lewat psql semuanya bisa menulis
-- volume yang tidak cocok dengan basisnya, dan tidak ada yang tahu mana yang
-- benar.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_item_derive_volume()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_nilai numeric;
BEGIN
  IF NEW.basis_code IS NULL THEN
    RETURN NEW;                     -- volume diketik tangan, biarkan apa adanya
  END IF;

  -- Constraint bpi_basis_berpasangan menangkap hal yang sama, TAPI trigger
  -- BEFORE berjalan lebih dulu: tanpa cek ini, volume terlanjur jadi NULL dan
  -- yang sampai ke pengguna adalah "volume tidak boleh kosong" -- pesan yang
  -- menunjuk kolom yang bukan penyebabnya. Constraint tetap dipertahankan
  -- sebagai jaring bila trigger ini suatu saat hilang.
  IF NEW.ratio_per_basis IS NULL THEN
    RAISE EXCEPTION 'basis "%" diisi tetapi rasio per basis kosong', NEW.basis_code
      USING HINT = 'Isi rasio per basis, atau kosongkan basisnya dan ketik volume langsung.';
  END IF;

  SELECT a.value INTO v_nilai
    FROM app.budget_assumptions a
   WHERE a.plan_id = NEW.plan_id AND a.code = NEW.basis_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asumsi "%" tidak ada di RAB ini', NEW.basis_code
      USING HINT = 'Tambahkan asumsinya lebih dulu, atau kosongkan basis dan isi volume manual.';
  END IF;

  NEW.volume := round(v_nilai * NEW.ratio_per_basis, 4);
  RETURN NEW;
END $$;

CREATE TRIGGER budget_plan_items_derive_volume
  BEFORE INSERT OR UPDATE OF basis_code, ratio_per_basis, plan_id
  ON app.budget_plan_items
  FOR EACH ROW EXECUTE FUNCTION app.budget_item_derive_volume();

-- Perubahan nilai asumsi menggerakkan seluruh baris yang bergantung padanya.
-- Inilah properti yang dikejar tahap 2; tanpa ini, "pusat asumsi" hanya
-- kolom tambahan yang tidak memusatkan apa pun.
CREATE OR REPLACE FUNCTION app.budget_assumption_cascade()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.value IS DISTINCT FROM OLD.value OR NEW.code IS DISTINCT FROM OLD.code THEN
    UPDATE app.budget_plan_items i
       SET volume = round(NEW.value * i.ratio_per_basis, 4),
           updated_at = now()
     WHERE i.plan_id = NEW.plan_id
       AND i.basis_code = OLD.code;

    -- Kode asumsi yang berubah harus ikut terbawa, kalau tidak baris yang
    -- menunjuknya menjadi yatim dan trigger di atas akan menolaknya nanti
    -- pada penyuntingan berikutnya -- kegagalan yang munculnya jauh dari
    -- sebabnya.
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      UPDATE app.budget_plan_items SET basis_code = NEW.code
       WHERE plan_id = NEW.plan_id AND basis_code = OLD.code;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER budget_assumptions_cascade
  AFTER UPDATE ON app.budget_assumptions
  FOR EACH ROW EXECUTE FUNCTION app.budget_assumption_cascade();

-- ===========================================================================
-- §4. RLS -- bentuknya sama persis dengan budget_plan_items (0060)
--
-- Termasuk penguncian setelah diajukan: asumsi RAB yang sudah disetujui tidak
-- boleh berubah, karena nilainya menggerakkan angka yang sudah disetujui.
-- ===========================================================================

ALTER TABLE app.budget_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.budget_assumptions FORCE ROW LEVEL SECURITY;

CREATE POLICY ba_tenant ON app.budget_assumptions
  USING (EXISTS (SELECT 1 FROM app.budget_plans p
                  WHERE p.id = plan_id AND p.company_id IN (SELECT app.accessible_company_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.budget_plans p
                       WHERE p.id = plan_id AND p.company_id IN (SELECT app.accessible_company_ids())));

CREATE POLICY ba_writer_roles ON app.budget_assumptions
  AS RESTRICTIVE FOR ALL
  USING (true)
  WITH CHECK (app.role_may_write_budget_plan());

-- Dipecah per perintah, BUKAN FOR ALL: klausa USING pada RESTRICTIVE FOR ALL
-- ikut menyaring SELECT, dan asumsi yang tidak bisa dibaca setelah RAB
-- disetujui akan menyembunyikan justru dasar dari angka yang disetujui.
-- Pelajaran 0018 §5 -> 0020, dan diulang lagi saat menulis 0060.
CREATE POLICY ba_edit_insert ON app.budget_assumptions
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    -- TIDAK ada pengecualian untuk approver di sini, berbeda dari
    -- budget_plan_items. Rapat 26 Agu menyepakati finance boleh MENAMBAH BARIS
    -- setelah RAB disetujui (mis. menyewa ahli hidrologi) -- baris baru tidak
    -- mengubah angka yang sudah disetujui. Mengubah ASUMSI lain perkaranya:
    -- satu angka bergeser dan seluruh baris turunannya ikut bergerak, sehingga
    -- nilai yang sudah diputuskan finance berubah tanpa keputusan baru.
    -- Persetujuan atas angka yang kemudian berubah sendiri bukan persetujuan.
    EXISTS (SELECT 1 FROM app.budget_plans p
             WHERE p.id = plan_id
               AND p.approval_status IN ('draft', 'rejected')
               AND (p.created_by = app.current_user_id()
                    OR app.current_role_name() IN ('approver', 'super_admin')))
  );

CREATE POLICY ba_edit_update ON app.budget_assumptions
  AS RESTRICTIVE FOR UPDATE
  USING (
    -- TIDAK ada pengecualian untuk approver di sini, berbeda dari
    -- budget_plan_items. Rapat 26 Agu menyepakati finance boleh MENAMBAH BARIS
    -- setelah RAB disetujui (mis. menyewa ahli hidrologi) -- baris baru tidak
    -- mengubah angka yang sudah disetujui. Mengubah ASUMSI lain perkaranya:
    -- satu angka bergeser dan seluruh baris turunannya ikut bergerak, sehingga
    -- nilai yang sudah diputuskan finance berubah tanpa keputusan baru.
    -- Persetujuan atas angka yang kemudian berubah sendiri bukan persetujuan.
    EXISTS (SELECT 1 FROM app.budget_plans p
             WHERE p.id = plan_id
               AND p.approval_status IN ('draft', 'rejected')
               AND (p.created_by = app.current_user_id()
                    OR app.current_role_name() IN ('approver', 'super_admin')))
  );

CREATE POLICY ba_edit_delete ON app.budget_assumptions
  AS RESTRICTIVE FOR DELETE
  USING (
    -- TIDAK ada pengecualian untuk approver di sini, berbeda dari
    -- budget_plan_items. Rapat 26 Agu menyepakati finance boleh MENAMBAH BARIS
    -- setelah RAB disetujui (mis. menyewa ahli hidrologi) -- baris baru tidak
    -- mengubah angka yang sudah disetujui. Mengubah ASUMSI lain perkaranya:
    -- satu angka bergeser dan seluruh baris turunannya ikut bergerak, sehingga
    -- nilai yang sudah diputuskan finance berubah tanpa keputusan baru.
    -- Persetujuan atas angka yang kemudian berubah sendiri bukan persetujuan.
    EXISTS (SELECT 1 FROM app.budget_plans p
             WHERE p.id = plan_id
               AND p.approval_status IN ('draft', 'rejected')
               AND (p.created_by = app.current_user_id()
                    OR app.current_role_name() IN ('approver', 'super_admin')))
  );

CREATE TRIGGER budget_assumptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.budget_assumptions
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON app.budget_assumptions TO app_rw;
GRANT SELECT ON app.budget_assumptions TO app_ro;

-- ===========================================================================
-- §5. Pemeriksa integritas -- padanan 15_Checks untuk RAB
--
-- Mengembalikan baris yang volumenya TIDAK cocok dengan basis x rasio. Harus
-- nol; kalau tidak, ada yang menulis volume langsung dan melewati trigger.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.check_budget_derived_volume()
RETURNS TABLE (item_id uuid, plan_code text, description text, tersimpan numeric, seharusnya numeric)
LANGUAGE sql STABLE AS $$
  SELECT i.id, p.code, i.description, i.volume, round(a.value * i.ratio_per_basis, 4)
    FROM app.budget_plan_items i
    JOIN app.budget_plans p ON p.id = i.plan_id
    JOIN app.budget_assumptions a ON a.plan_id = i.plan_id AND a.code = i.basis_code
   WHERE i.basis_code IS NOT NULL
     AND i.volume IS DISTINCT FROM round(a.value * i.ratio_per_basis, 4)
$$;

GRANT EXECUTE ON FUNCTION app.check_budget_derived_volume() TO app_rw, app_ro;

COMMENT ON FUNCTION app.check_budget_derived_volume IS
  'Health check RAB: harus nol baris. Setiap baris berarti volume tersimpan '
  'menyimpang dari basis x rasio -- ada yang menulis melewati trigger.';

-- ===========================================================================
-- §6. Gagalkan migrasi bila kesehatan bocor
-- ===========================================================================
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_rls_coverage() % baris setelah 0062', n; END IF;
  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_audit_coverage() % baris setelah 0062', n; END IF;
  SELECT count(*) INTO n FROM app.check_budget_derived_volume();
  IF n > 0 THEN RAISE EXCEPTION 'check_budget_derived_volume() % baris setelah 0062', n; END IF;
END $$;
