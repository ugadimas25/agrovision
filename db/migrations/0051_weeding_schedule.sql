-- ===========================================================================
-- 0051 — jadwal penyiangan per blok, supaya "Jadwal vs Realisasi" berhenti
-- mengklaim "Tepat waktu" tanpa dasar.
--
-- Kolom itu sebelumnya literal 'Tepat waktu' untuk SETIAP baris laporan
-- Penyiangan — menyatakan kepatuhan jadwal padahal `weeding_records` tidak punya
-- kolom jadwal dan satu-satunya tabel jadwal di skema adalah
-- `fertilizer_schedules` (pupuk). Kolomnya dihapus lebih dulu (PR #24) dan
-- sekarang dikembalikan dengan perhitungan yang nyata.
--
-- Model: INTERVAL, mengikuti preseden fertilizer_schedules — bukan kalender
-- tanggal-per-tanggal. Penyiangan itu siklus ("tiap 30 hari"), bukan janji
-- tanggal, dan menyimpan kalender berarti seseorang harus memeliharanya terus.
--
-- Per BLOK, bukan per komoditas: kadensi penyiangan adalah keputusan operasi
-- lapangan pada blok itu, dan memetakannya lewat komoditas akan menuntut blok
-- punya komoditas tunggal — padahal K-04 justru menegaskan satu blok bisa
-- dinilai untuk beberapa komoditas.
--
-- company_id NOT NULL, tanpa baris global. Baris global menuntut policy
-- *_global_admin_only dan itu sudah sekali menimbulkan kebocoran lintas tenant
-- sesi ini (master_items dengan company_id NULL). Tidak ada alasan kuat untuk
-- mengulanginya di tabel referensi kecil ini.
--
-- `tolerance_day` ada supaya "terlambat sehari" tidak langsung dianggap
-- pelanggaran — tanpa toleransi, kolomnya akan berwarna merah hampir selalu dan
-- berhenti dibaca.
-- ===========================================================================

CREATE TABLE app.weeding_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES app.companies(id),
  block_id       uuid NOT NULL REFERENCES app.blocks(id) ON DELETE CASCADE,
  interval_day   integer NOT NULL,
  tolerance_day  integer NOT NULL DEFAULT 7,
  note           text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES app.users(id),
  CONSTRAINT ws_interval_positive CHECK (interval_day > 0),
  CONSTRAINT ws_tolerance_nonneg  CHECK (tolerance_day >= 0)
);

-- Satu jadwal AKTIF per blok: laporan memilih satu, jadi dua yang aktif membuat
-- pilihannya bergantung urutan baris (pelajaran indeks 0046 pada price_list).
CREATE UNIQUE INDEX ws_one_active_per_block
  ON app.weeding_schedules (block_id) WHERE is_active;

-- Blok milik entitas lain tidak boleh dijadwalkan dari entitas ini.
CREATE OR REPLACE FUNCTION app.ws_block_same_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.blocks b
                  WHERE b.id = NEW.block_id AND b.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'blok % bukan milik entitas %', NEW.block_id, NEW.company_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ws_block_same_company_trg
  BEFORE INSERT OR UPDATE ON app.weeding_schedules
  FOR EACH ROW EXECUTE FUNCTION app.ws_block_same_company();

-- ===========================================================================
-- RLS: pola yang sama dengan tabel referensi lain (0018).
-- ===========================================================================

ALTER TABLE app.weeding_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY weeding_schedules_tenant ON app.weeding_schedules
  FOR ALL
  USING (company_id IN (SELECT app.accessible_company_ids()))
  WITH CHECK (company_id IN (SELECT app.accessible_company_ids()));

-- Menentukan kadensi penyiangan adalah keputusan OPERASI, bukan pencatatan
-- lapangan: creator mencatat pekerjaannya, tidak menetapkan targetnya sendiri.
--
-- Ditegakkan DI DATABASE, bukan hanya di Server Action. Versi pertama tabel ini
-- hanya memasang policy "viewer tidak boleh menulis" — dan uji adversarial
-- menunjukkan CREATOR masih bisa INSERT, karena policy tenant meloloskan semua
-- peran dalam tenant. Persis lubang yang sama dengan seed_distributions (luput di
-- 0018, baru ditambal 0042). requireRole di aplikasi hanya defense-in-depth.
CREATE POLICY weeding_schedules_role_split ON app.weeding_schedules
  AS RESTRICTIVE FOR ALL
  USING (true)
  WITH CHECK (COALESCE(app.current_role_name(), 'viewer') IN ('approver', 'super_admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON app.weeding_schedules TO app_rw;
GRANT SELECT ON app.weeding_schedules TO app_ro;

COMMENT ON TABLE app.weeding_schedules IS
  'Interval penyiangan per blok. Dipakai laporan Penyiangan untuk menghitung '
  'Jadwal vs Realisasi — sebelumnya kolom itu literal "Tepat waktu".';

-- ===========================================================================
-- Kanari kesehatan (pola 0039–0050)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0051', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0051', n;
  END IF;
END $$;
