-- 0060_budget_plan.sql
-- Rencana Anggaran (RAB Kebun) -- rapat Fadli 26 Agustus 2026.
--
-- Masalah yang diangkat rapat: aplikasi ini langsung meminta ANGGARAN, padahal
-- ada satu langkah sebelumnya yang hilang. Yang tahu kebun perlu kapur dolomit
-- dulu atau pupuk kandang per lubang tanam adalah agronomis, bukan finance;
-- finance punya uang dan wewenang menyetujui. Jadi urutannya:
--
--   agronomis menyusun RAB -> finance menyetujui/mengoreksi -> master anggaran
--   -> realisasi harian mengurangi saldo
--
-- Migrasi ini hanya membuat DUA tabel pertama dari rantai itu. Materialisasi ke
-- app.budgets dan penurunan saldo SENGAJA belum disentuh: keduanya menyentuh
-- angka yang sudah dipakai laporan, dan sumber dua-arah untuk angka anggaran
-- adalah cara termurah membuat dua layar menampilkan angka berbeda. Itu tiket
-- tersendiri, setelah bentuk RAB terbukti dipakai.
--
-- DUA KEPUTUSAN yang membentuk skema ini, diputuskan 26 Agustus 2026:
--
-- 1. WAKTU MEMAKAI FASE RELATIF (bulan ke-1, ke-2, ...), bukan app.fiscal_periods.
--    Alasannya bukan selera: fiscal_periods sampai hari ini KOSONG dan diblokir
--    keputusan #6 (menunggu nama & rentang fase dari klien). Kalau RAB menuntut
--    periode berkalender, modul ini mati sebelum lahir. Rapatnya sendiri
--    berpikir relatif ("bulan 1 persiapan lahan, bulan 2 pembibitan"). Pemetaan
--    fase -> tanggal dikerjakan belakangan, saat tanggal mulai sudah pasti.
--
-- 2. PENYUSUNNYA role `agronomist` (0058), PEMUTUSNYA `approver` yang sudah ada.
--    Finance tidak mendapat role sendiri: wewenangnya sama persis dengan
--    approver -- menyetujui, menolak dengan alasan, dan (khusus RAB) menambah
--    baris setelah disetujui, mis. menyewa ahli hidrologi.

CREATE TYPE app.budget_item_kind AS ENUM (
  'consumable',   -- habis pakai: pupuk, dolomit, pestisida, bibit
  'asset',        -- bertahan: cangkul, mesin -- rapat membedakan ini eksplisit
  'labor',        -- orang-hari
  'service'       -- borongan/jasa pihak ketiga
);

COMMENT ON TYPE app.budget_item_kind IS
  'Rapat 26 Agu 2026 membedakan habis-pakai (pupuk) dari aset (cangkul, 200 unit '
  'untuk 100 ha). Keduanya biaya, tapi hanya yang pertama berulang tiap fase.';

-- ===========================================================================
-- §1. Header RAB
-- ===========================================================================

CREATE TABLE app.budget_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES app.companies(id),
  -- Opsional: satu entitas bisa punya RAB per estate bila lahannya tersebar.
  -- Rapat memakai asumsi SATU lokasi 100 ha, tapi menyebut kemungkinan lahan
  -- terpisah (Semarang + Kalimantan) yang price list-nya berbeda.
  estate_id        uuid REFERENCES app.estates(id),
  code             text NOT NULL,
  name             text NOT NULL,
  -- Luas yang direncanakan. NULL = belum ditentukan; JANGAN diisi 0 -- nol
  -- hektar adalah angka yang berarti "tidak ada lahan", bukan "belum diisi".
  area_ha          numeric(12,2) CHECK (area_ha IS NULL OR area_ha > 0),
  -- Panjang horizon dalam BULAN RELATIF. Tahun 1 penuh = 12.
  horizon_months   integer NOT NULL DEFAULT 12 CHECK (horizon_months BETWEEN 1 AND 120),
  -- Kontingensi 5% disepakati di rapat. Disimpan sebagai persen, bukan sebagai
  -- baris biaya, supaya tidak ikut terhitung dua kali saat baris dijumlahkan.
  contingency_pct  numeric(5,2) NOT NULL DEFAULT 5 CHECK (contingency_pct BETWEEN 0 AND 100),
  note             text,
  approval_status  app.record_status NOT NULL DEFAULT 'draft',
  rejection_reason text,
  created_by       uuid REFERENCES app.users(id),
  submitted_at     timestamptz,
  decided_by       uuid REFERENCES app.users(id),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CONSTRAINT budget_plans_rejection_needs_reason
    CHECK (approval_status <> 'rejected'
           OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0))
);

COMMENT ON TABLE app.budget_plans IS
  'RAB Kebun: rencana biaya yang disusun agronomis SEBELUM anggaran ada, lalu '
  'disetujui finance (role approver). Fase memakai bulan relatif, bukan '
  'app.fiscal_periods -- lihat kepala migrasi 0060.';

CREATE INDEX budget_plans_company_status_idx ON app.budget_plans (company_id, approval_status);

-- ===========================================================================
-- §2. Baris RAB -- "seperti Excel", kata rapatnya
-- ===========================================================================

CREATE TABLE app.budget_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES app.budget_plans(id) ON DELETE CASCADE,
  -- Fase relatif: 1 = bulan pertama proyek. Dibatasi horizon header lewat
  -- trigger di §3 -- CHECK tidak bisa menengok tabel lain.
  phase_month      integer NOT NULL CHECK (phase_month >= 1),
  cost_category_id uuid NOT NULL REFERENCES app.master_items(id),
  description      text NOT NULL CHECK (length(btrim(description)) > 0),
  item_kind        app.budget_item_kind NOT NULL DEFAULT 'consumable',
  volume           numeric(18,4) NOT NULL CHECK (volume > 0),
  uom_item_id      uuid REFERENCES app.master_items(id),
  unit_price_idr   numeric(18,2) NOT NULL CHECK (unit_price_idr >= 0),
  -- Dihitung database, bukan aplikasi: satu-satunya cara memastikan angka di
  -- layar, PDF, dan Excel berasal dari perkalian yang sama.
  amount_idr       numeric(18,2) GENERATED ALWAYS AS (round(volume * unit_price_idr, 2)) STORED,
  -- Rapat: setelah master anggaran disetujui, finance MASIH bisa menambah baris
  -- (mis. ahli hidrologi). Ditandai supaya jelas mana yang bukan usulan awal
  -- agronomis -- bukan untuk membatasi, tapi supaya riwayatnya terbaca.
  added_after_approval boolean NOT NULL DEFAULT false,
  note             text,
  sort_order       integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES app.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.budget_plan_items IS
  'Baris RAB: kategori, volume, satuan, harga satuan. amount_idr dihitung '
  'database (GENERATED), bukan dikirim aplikasi.';

CREATE INDEX budget_plan_items_plan_idx ON app.budget_plan_items (plan_id, phase_month, sort_order);

-- ===========================================================================
-- §3. Fase tidak boleh melewati horizon headernya
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_plan_item_phase_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_horizon integer;
BEGIN
  SELECT horizon_months INTO v_horizon FROM app.budget_plans WHERE id = NEW.plan_id;
  IF v_horizon IS NULL THEN
    RAISE EXCEPTION 'RAB induk tidak ditemukan';
  END IF;
  IF NEW.phase_month > v_horizon THEN
    RAISE EXCEPTION 'bulan ke-% melewati horizon RAB (% bulan)', NEW.phase_month, v_horizon;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER budget_plan_items_phase_guard
  BEFORE INSERT OR UPDATE OF phase_month, plan_id ON app.budget_plan_items
  FOR EACH ROW EXECUTE FUNCTION app.budget_plan_item_phase_guard();

-- ===========================================================================
-- §4. RLS
--
-- Penulisnya BUKAN daftar yang sama dengan tabel operasional. Di sini:
--   agronomist  menyusun (draft/rejected miliknya sendiri)
--   approver    memutuskan, dan boleh menambah baris setelah disetujui
--   super_admin keduanya
--   creator     TIDAK menulis RAB -- ia mencatat realisasi, bukan merencanakan
--   viewer      membaca
--
-- Karena daftarnya berbeda, policy di sini TIDAK memakai
-- app.role_may_write_records() (0059) dan namanya sengaja BUKAN
-- *_viewer_readonly -- pola nama itu ditulis ulang otomatis oleh 0059.
--
-- SELECT sengaja se-tenant, tanpa penyempitan per-pembuat seperti B-23. RAB
-- adalah SATU dokumen bersama per entitas, bukan catatan pribadi per orang:
-- finance harus melihat seluruhnya, dan menyembunyikan draft agronomis lain
-- akan mematahkan alur "disusun bersama, diajukan sekali".
-- ===========================================================================

ALTER TABLE app.budget_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.budget_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE app.budget_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.budget_plan_items FORCE ROW LEVEL SECURITY;

CREATE POLICY bp_tenant ON app.budget_plans
  USING (company_id IN (SELECT app.accessible_company_ids()))
  WITH CHECK (company_id IN (SELECT app.accessible_company_ids()));

CREATE POLICY bpi_tenant ON app.budget_plan_items
  USING (EXISTS (SELECT 1 FROM app.budget_plans p
                  WHERE p.id = plan_id AND p.company_id IN (SELECT app.accessible_company_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.budget_plans p
                       WHERE p.id = plan_id AND p.company_id IN (SELECT app.accessible_company_ids())));

CREATE OR REPLACE FUNCTION app.role_may_write_budget_plan()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app.current_role_name(), 'viewer') IN ('agronomist', 'approver', 'super_admin')
$$;
GRANT EXECUTE ON FUNCTION app.role_may_write_budget_plan() TO app_rw, app_ro;

CREATE POLICY bp_writer_roles ON app.budget_plans
  AS RESTRICTIVE FOR ALL
  USING (true)
  WITH CHECK (app.role_may_write_budget_plan());

CREATE POLICY bpi_writer_roles ON app.budget_plan_items
  AS RESTRICTIVE FOR ALL
  USING (true)
  WITH CHECK (app.role_may_write_budget_plan());

-- Pemisahan penyusun/pemutus, sejajar ct_role_split (0018 §9): pada UPDATE,
-- USING menguji baris LAMA dan WITH CHECK menguji baris BARU.
--
-- WITH CHECK-nya BUKAN hiasan. Tanpa itu, agronomis boleh menyunting draft
-- miliknya sendiri -- termasuk menyetel approval_status = 'approved'. Artinya
-- penyusun RAB menyetujui anggarannya sendiri, tepat pemisahan yang seluruh
-- modul ini ada untuk menegakkan. Baris baru karena itu hanya boleh berakhir
-- di 'draft' atau 'submitted' bila yang menyunting bukan pemutus.
CREATE POLICY bp_edit_gate ON app.budget_plans
  AS RESTRICTIVE FOR UPDATE
  USING (
    app.current_role_name() IN ('approver', 'super_admin')
    OR (created_by = app.current_user_id() AND approval_status IN ('draft', 'rejected'))
  )
  WITH CHECK (
    app.current_role_name() IN ('approver', 'super_admin')
    OR approval_status IN ('draft', 'submitted')
  );

-- Baris hanya boleh disunting selama RAB-nya belum diputuskan -- kecuali oleh
-- approver, yang memang diizinkan menambah baris setelah disetujui.
--
-- DIPECAH PER PERINTAH, dan ini bukan gaya penulisan. RESTRICTIVE FOR ALL
-- membuat klausa USING-nya ikut menyaring SELECT: begitu RAB disetujui,
-- agronomis yang menyusunnya tidak lagi bisa MEMBACA barisnya sendiri. Repo ini
-- pernah tepat begitu -- 0018 §5 memasang report_builtin_protect sebagai
-- RESTRICTIVE FOR ALL dan tanpa sengaja menyembunyikan tiga laporan bawaan dari
-- semua orang, lalu 0020 memecahnya per perintah dan menuliskan pelajarannya:
-- untuk membatasi TULIS saja, jangan pernah pakai FOR ALL.
--
-- Uji adversarial di db/verify-adversarial.mjs menangkap pengulangan kesalahan
-- ini ("agronomist tetap melihat seluruh baris RAB entitasnya" -- 0 baris).
CREATE POLICY bpi_edit_insert ON app.budget_plan_items
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    app.current_role_name() IN ('approver', 'super_admin')
    OR EXISTS (SELECT 1 FROM app.budget_plans p
                WHERE p.id = plan_id
                  AND p.created_by = app.current_user_id()
                  AND p.approval_status IN ('draft', 'rejected'))
  );

CREATE POLICY bpi_edit_update ON app.budget_plan_items
  AS RESTRICTIVE FOR UPDATE
  USING (
    app.current_role_name() IN ('approver', 'super_admin')
    OR EXISTS (SELECT 1 FROM app.budget_plans p
                WHERE p.id = plan_id
                  AND p.created_by = app.current_user_id()
                  AND p.approval_status IN ('draft', 'rejected'))
  );

CREATE POLICY bpi_edit_delete ON app.budget_plan_items
  AS RESTRICTIVE FOR DELETE
  USING (
    app.current_role_name() IN ('approver', 'super_admin')
    OR EXISTS (SELECT 1 FROM app.budget_plans p
                WHERE p.id = plan_id
                  AND p.created_by = app.current_user_id()
                  AND p.approval_status IN ('draft', 'rejected'))
  );

-- ===========================================================================
-- §5. Jejak audit (B-8). budget_plans punya approval_status, jadi
--     app.check_audit_coverage() menuntutnya. Baris RAB ikut diaudit walau
--     tidak wajib: yang berubah di sana adalah uang.
-- ===========================================================================

CREATE TRIGGER budget_plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.budget_plans
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

CREATE TRIGGER budget_plan_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.budget_plan_items
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON app.budget_plans, app.budget_plan_items TO app_rw;
GRANT SELECT ON app.budget_plans, app.budget_plan_items TO app_ro;

-- ===========================================================================
-- §6. Gagalkan migrasi bila kesehatan bocor (pola 0053/0054/0056)
-- ===========================================================================
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0060', n; END IF;

  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_audit_coverage() mengembalikan % baris setelah 0060', n; END IF;

  SELECT count(*) INTO n FROM app.check_creator_scope_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_creator_scope_coverage() mengembalikan % baris setelah 0060', n; END IF;
END $$;
