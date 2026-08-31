-- 0063_budget_sources.sql
-- Tahap 5 dari docs/19-rab-dari-excel-banyumas.md: registri sumber.
--
-- 0061 memberi baris RAB kolom `source_ref` — teks bebas. Ia menampung kalimat
-- ("Angka lisan rapat 26 Agu, belum ada penawaran kontraktor"), dan justru
-- karena bebas ia TIDAK bisa diperiksa ulang: tidak ada URL, tidak ada tanggal
-- terbit, tidak ada tanggal akses, dan tidak ada cara tahu bahwa dua baris
-- menyebut sumber yang sama.
--
-- 16_Sources pada model Banyumas menyimpan persis yang hilang itu: ID, topik,
-- judul, URL, tanggal terbit, tanggal akses, dan tingkat keyakinan — 22 sumber
-- nyata (Kementan, SK Gubernur Jateng untuk UMK, tarif lab BRMP, LSO). Sheet
-- itu membuka dirinya sendiri dengan kalimat yang menjelaskan kenapa ia ada:
-- "Perbarui sumber berkeyakinan rendah dengan hasil uji lapangan, kontrak,
-- atau sedikitnya tiga penawaran pemasok sebelum persetujuan investasi."
--
-- EMPAT KEPUTUSAN yang membentuk migrasi ini:
--
-- 1. `source_ref` TIDAK dihapus, dan itu bukan kemalasan. Sumber yang bisa
--    ditautkan dan keterangan bebas adalah dua hal berbeda, dan yang kedua
--    sering justru yang paling jujur: angka lisan rapat tidak punya URL dan
--    tidak boleh dipaksa punya. Memaksa setiap baris menunjuk registri hanya
--    akan membuat orang mendaftarkan sumber karangan supaya formulirnya lewat
--    — dan registri berisi sumber karangan lebih berbahaya daripada kolom teks
--    bebas yang jujur mengaku dirinya teks bebas. Keduanya hidup berdampingan:
--    source_id untuk yang bisa diperiksa ulang, source_ref untuk keterangan.
--
-- 2. Registri milik ENTITAS, bukan milik satu RAB. Satu SK Gubernur dipakai
--    berkali-kali oleh RAB yang berbeda; menyalinnya per RAB akan melahirkan
--    sepuluh versi "UMK Banyumas 2026" yang perlahan berbeda isi, dan tidak
--    ada yang tahu mana yang benar. Ini juga sebabnya penguncian-setelah-
--    diajukan ala 0062 TIDAK dipakai di sini — lihat §4.
--
-- 3. URL wajib benar-benar URL. 16_Sources sendiri menulis "User-provided" di
--    kolom URL untuk sumber lisan — dan kalau kalimat itu masuk ke kolom url,
--    layar akan menampilkannya sebagai tautan yang bisa diklik dan tidak
--    menuju ke mana pun. Tautan mati lebih buruk daripada tidak ada tautan:
--    yang pertama MENGAKU bisa diperiksa. CHECK di §1 menolaknya, dan seed
--    memasukkan sumber itu dengan url NULL — dirender em-dash di layar.
--
-- 4. Tanggal yang tidak presisi TIDAK dibulatkan. Kolom "Terbit/per tanggal"
--    di 16_Sources berisi campuran: '2025-10-28' (tanggal), '2019' (tahun),
--    '2026 website' (bukan tanggal sama sekali). Menyimpan '2019' sebagai
--    1 Januari 2019 mengarang presisi yang tidak ada di sumbernya. published_on
--    karena itu NULL untuk baris semacam itu, dan bunyi aslinya dibawa apa
--    adanya ke kolom `note` oleh seed.

-- ===========================================================================
-- §1. Registri sumber
-- ===========================================================================

CREATE TABLE app.budget_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES app.companies(id),
  -- Kode pendek yang dipakai manusia saat berdiskusi ("pakai S07 saja"),
  -- mengikuti kolom ID di 16_Sources: USR, S01..S22. Huruf besar diizinkan —
  -- berbeda dari budget_assumptions.code yang sengaja huruf kecil karena
  -- diketik ke dalam rumus; kode sumber dibaca, bukan diketik ulang.
  code         text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  topic        text,
  title        text NOT NULL CHECK (length(btrim(title)) > 0),
  -- NULL = sumber ini memang tidak punya tautan (keputusan lisan, wawancara,
  -- penawaran di atas kertas). Lihat keputusan 3 di kepala berkas: yang dilarang
  -- adalah menaruh kalimat di sini, bukan mengosongkannya.
  url          text CHECK (url IS NULL OR url ~ '^https?://[^[:space:]]+$'),
  published_on date,
  accessed_on  date,
  -- Enum yang sama dengan 0061/0062: satu skala keyakinan untuk seluruh modul.
  -- NULL = belum dinilai, dan sengaja tanpa default.
  confidence   app.assumption_confidence,
  note         text,
  created_by   uuid REFERENCES app.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

COMMENT ON TABLE app.budget_sources IS
  'Registri sumber yang bisa diperiksa ulang, mengikuti 16_Sources pada model '
  'Banyumas. Sejajar app.emission_factors.source_citation: angka tanpa asalnya '
  'adalah angka fabrikasi yang kebetulan rapi. Milik entitas, bukan milik satu '
  'RAB — satu SK Gubernur dikutip banyak RAB.';

COMMENT ON COLUMN app.budget_sources.url IS
  'Tautan yang benar-benar bisa dibuka. NULL = sumber ini memang tidak punya '
  'tautan, dan dirender em-dash. CHECK menolak kalimat seperti "User-provided" '
  '— tautan mati lebih buruk daripada tidak ada tautan, karena ia mengaku bisa '
  'diperiksa.';

COMMENT ON COLUMN app.budget_sources.published_on IS
  'Tanggal terbit, HANYA bila sumbernya menyebut tanggal. Sumber yang cuma '
  'menyebut tahun ("2019") atau tidak menyebut apa pun ("2026 website") '
  'disimpan NULL; bunyi aslinya dibawa ke `note`. Membulatkan "2019" menjadi '
  '1 Januari 2019 mengarang presisi yang tidak ada di sumbernya.';

COMMENT ON COLUMN app.budget_sources.accessed_on IS
  'Kapan tautannya terakhir benar-benar dibuka. Kolom "Diakses" di 16_Sources: '
  'sumber daring bisa hilang atau berubah, dan tanggal akses adalah satu-satunya '
  'yang memberi tahu seberapa tua pemeriksaan terakhir.';

CREATE INDEX budget_sources_company_idx ON app.budget_sources (company_id, topic, code);

-- ===========================================================================
-- §2. Relasi — BERDAMPINGAN dengan source_ref, bukan menggantikannya
--
-- ON DELETE RESTRICT dan bukan SET NULL: menghapus sumber yang sedang dikutip
-- berarti mencabut bukti dari bawah angka yang sudah ditulis, dan meninggalkan
-- baris yang tampak tak pernah punya sumber. Sumber yang keliru diperbaiki
-- dengan menyunting atau mendaftarkan yang baru, bukan dengan menghapus.
-- ===========================================================================

ALTER TABLE app.budget_plan_items
  ADD COLUMN source_id uuid REFERENCES app.budget_sources(id) ON DELETE RESTRICT;

ALTER TABLE app.budget_assumptions
  ADD COLUMN source_id uuid REFERENCES app.budget_sources(id) ON DELETE RESTRICT;

COMMENT ON COLUMN app.budget_plan_items.source_id IS
  'Sumber di registri (app.budget_sources) yang bisa dibuka ulang. NULL = tidak '
  'ada sumber yang bisa ditautkan — dan itu SAH: source_ref di sebelahnya boleh '
  'tetap berisi keterangan bebas seperti "Angka lisan rapat 26 Agu". Keduanya '
  'ditampilkan berdampingan; tidak ada yang menggantikan yang lain.';

COMMENT ON COLUMN app.budget_assumptions.source_id IS
  'Sumber di registri untuk asumsi ini, mengikuti kolom "ID sumber" di '
  '02_Assumptions. NULL tidak berarti asumsi ini tak bersumber — periksa juga '
  'source_ref.';

CREATE INDEX budget_plan_items_source_idx ON app.budget_plan_items (source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX budget_assumptions_source_idx ON app.budget_assumptions (source_id)
  WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Sumber harus milik entitas RAB yang mengutipnya.
--
-- Ini BUKAN dijaga RLS. Pemeriksaan foreign key berjalan di dalam mesin,
-- melewati policy — jadi tenant B yang menebak (atau membocorkan) satu uuid
-- sumber milik tenant A bisa menuliskannya ke barisnya sendiri. Barisnya
-- kemudian merender "sumber: —" untuk selamanya, karena RLS tetap
-- menyembunyikan baris sumbernya: RAB dengan sumber yang tak seorang pun di
-- entitas itu bisa lihat.
--
-- SELECT di bawah sengaja TIDAK security definer: ia berjalan di bawah RLS
-- pemanggilnya, jadi sumber milik tenant lain menghasilkan NULL dan langsung
-- tertolak oleh perbandingan IS DISTINCT FROM.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.budget_source_same_company()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entitas_rab    uuid;
  v_entitas_sumber uuid;
BEGIN
  IF NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.company_id INTO v_entitas_rab
    FROM app.budget_plans p WHERE p.id = NEW.plan_id;

  SELECT s.company_id INTO v_entitas_sumber
    FROM app.budget_sources s WHERE s.id = NEW.source_id;

  IF v_entitas_sumber IS DISTINCT FROM v_entitas_rab THEN
    RAISE EXCEPTION 'sumber tidak terdaftar di entitas RAB ini'
      USING HINT = 'Daftarkan sumbernya lebih dulu di registri entitas ini.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER budget_plan_items_source_scope
  BEFORE INSERT OR UPDATE OF source_id, plan_id ON app.budget_plan_items
  FOR EACH ROW EXECUTE FUNCTION app.budget_source_same_company();

CREATE TRIGGER budget_assumptions_source_scope
  BEFORE INSERT OR UPDATE OF source_id, plan_id ON app.budget_assumptions
  FOR EACH ROW EXECUTE FUNCTION app.budget_source_same_company();

-- ===========================================================================
-- §3. Identitas sumber membeku begitu dikutip RAB yang sudah diajukan
--
-- 0062 mengunci ASUMSI setelah RAB diajukan, dengan alasan "persetujuan atas
-- angka yang berubah sendiri bukan persetujuan". Kutipan menuntut hal yang
-- sama untuk alasan yang bersebelahan: kalau judul S07 bisa diubah dari
-- "Keputusan Gubernur Jateng 100.3.3.1/505/2025" menjadi kalimat lain setelah
-- finance menyetujui, maka RAB yang disetujui kini mengaku bersandar pada
-- sesuatu yang tidak pernah dibaca finance. Angkanya tidak bergerak; buktinya
-- yang diganti — dan itu justru lebih sulit ketahuan.
--
-- TAPI penguncian di sini SENGAJA LEBIH SEMPIT daripada 0062, karena
-- registrinya milik entitas (keputusan 2 di kepala berkas). Mengunci seluruh
-- baris akan membuat SATU RAB yang diajukan membekukan sumber yang masih
-- dipakai sepuluh RAB draft lain — termasuk untuk hal yang memang harus bisa
-- diperbaiki: URL yang pindah, tanggal akses yang disegarkan, keyakinan yang
-- diturunkan setelah ketahuan penawarannya basi.
--
-- Yang dibekukan hanya empat kolom PEMBAWA IDENTITAS: code, title, url,
-- published_on. Yang tetap bisa disunting: topic, accessed_on, confidence,
-- note. Penurunan keyakinan sengaja dibiarkan lewat — mengetahui sebuah sumber
-- lebih lemah daripada yang dikira adalah informasi yang harus mengalir, bukan
-- ditahan.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_source_identity_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rab text;
BEGIN
  IF NEW.code         IS NOT DISTINCT FROM OLD.code
 AND NEW.title        IS NOT DISTINCT FROM OLD.title
 AND NEW.url          IS NOT DISTINCT FROM OLD.url
 AND NEW.published_on IS NOT DISTINCT FROM OLD.published_on THEN
    RETURN NEW;                       -- hanya kolom yang boleh bergerak
  END IF;

  SELECT p.code INTO v_rab
    FROM app.budget_plans p
   WHERE p.approval_status NOT IN ('draft', 'rejected')
     AND (EXISTS (SELECT 1 FROM app.budget_plan_items i
                   WHERE i.plan_id = p.id AND i.source_id = OLD.id)
       OR EXISTS (SELECT 1 FROM app.budget_assumptions a
                   WHERE a.plan_id = p.id AND a.source_id = OLD.id))
   LIMIT 1;

  IF v_rab IS NOT NULL THEN
    RAISE EXCEPTION 'sumber "%" sudah dikutip RAB % yang bukan lagi draft', OLD.code, v_rab
      USING HINT = 'Tanggal akses, keyakinan, topik, dan catatan masih bisa disunting. '
                   'Untuk mengganti judul atau tautan, daftarkan sumber baru.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER budget_sources_identity_guard
  BEFORE UPDATE ON app.budget_sources
  FOR EACH ROW EXECUTE FUNCTION app.budget_source_identity_guard();

-- ===========================================================================
-- §4. RLS — tenant, lalu gerbang tulis per peran
--
-- Penulisnya sama dengan RAB: agronomist menyusun, approver (finance)
-- memutuskan dan boleh ikut mendaftarkan penawaran vendor, super_admin
-- keduanya, creator dan viewer hanya membaca. Karena itu ia memakai ulang
-- app.role_may_write_budget_plan() (0060), bukan role_may_write_records().
--
-- TIDAK ADA penguncian per status RAB di lapisan policy. Registri melayani
-- banyak RAB sekaligus, jadi status salah satunya tidak boleh menentukan siapa
-- boleh menyunting seluruh registri. Yang menjaga kutipan RAB yang sudah
-- diputuskan adalah trigger §3 (identitas membeku) ditambah bpi_edit_update /
-- ba_edit_update (0060/0062) yang sudah melarang MEMINDAHKAN source_id sebuah
-- baris setelah RAB-nya diajukan.
--
-- GERBANG TULIS DIPECAH PER PERINTAH, dan di sini itu bukan sekadar mengikuti
-- pelajaran 0018 §5 -> 0020 soal USING yang ikut menyaring SELECT. Ada alasan
-- kedua yang lebih tajam: RESTRICTIVE FOR ALL dengan `USING (true)` — bentuk
-- yang dipakai bp_writer_roles di 0060 — TIDAK menggerbang DELETE sama sekali,
-- karena DELETE hanya membaca USING dan tidak pernah menyentuh WITH CHECK.
-- Bentuk di bawah menggerbang ketiga perintah tulis satu per satu, dan
-- membiarkan SELECT sepenuhnya bebas.
-- ===========================================================================

ALTER TABLE app.budget_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.budget_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY bs_tenant ON app.budget_sources
  USING (company_id IN (SELECT app.accessible_company_ids()))
  WITH CHECK (company_id IN (SELECT app.accessible_company_ids()));

CREATE POLICY bs_write_insert ON app.budget_sources
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.role_may_write_budget_plan());

-- WITH CHECK-nya WAJIB ada bersama USING. Tanpa WITH CHECK, baris yang lolos
-- USING bisa dipindahkan ke keadaan yang seharusnya terlarang — di sini:
-- dipindahkan ke company_id lain. USING menguji baris LAMA, WITH CHECK menguji
-- baris BARU; keduanya diperlukan (pola yang sama dengan bp_edit_gate, 0060).
CREATE POLICY bs_write_update ON app.budget_sources
  AS RESTRICTIVE FOR UPDATE
  USING (app.role_may_write_budget_plan())
  WITH CHECK (app.role_may_write_budget_plan());

CREATE POLICY bs_write_delete ON app.budget_sources
  AS RESTRICTIVE FOR DELETE
  USING (app.role_may_write_budget_plan());

-- Yang berubah di tabel ini adalah BUKTI di balik angka yang disetujui. Trigger
-- §3 membekukan identitas sumber yang sudah dikutip RAB non-draft; jejak audit
-- ini yang menjawab pertanyaan berikutnya — siapa mengubah apa selama sumber
-- itu masih bebas disunting.
CREATE TRIGGER budget_sources_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.budget_sources
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON app.budget_sources TO app_rw;
GRANT SELECT ON app.budget_sources TO app_ro;

-- ===========================================================================
-- §5. Pemeriksa integritas — padanan 15_Checks untuk registri sumber
--
-- Harus nol baris. Setiap baris berarti ada kutipan lintas entitas, yaitu RAB
-- yang menunjuk sumber yang tidak akan pernah terlihat oleh siapa pun di
-- entitasnya sendiri.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.check_budget_source_scope()
RETURNS TABLE (asal text, row_id uuid, plan_code text, source_code text)
LANGUAGE sql STABLE AS $$
  SELECT 'budget_plan_items', i.id, p.code, s.code
    FROM app.budget_plan_items i
    JOIN app.budget_plans p   ON p.id = i.plan_id
    JOIN app.budget_sources s ON s.id = i.source_id
   WHERE s.company_id <> p.company_id
  UNION ALL
  SELECT 'budget_assumptions', a.id, p.code, s.code
    FROM app.budget_assumptions a
    JOIN app.budget_plans p   ON p.id = a.plan_id
    JOIN app.budget_sources s ON s.id = a.source_id
   WHERE s.company_id <> p.company_id
$$;

GRANT EXECUTE ON FUNCTION app.check_budget_source_scope() TO app_rw, app_ro;

COMMENT ON FUNCTION app.check_budget_source_scope IS
  'Health check RAB: harus nol baris. Setiap baris adalah kutipan lintas '
  'entitas — RAB menunjuk sumber yang RLS sembunyikan dari entitasnya sendiri.';

-- ===========================================================================
-- §6. Gagalkan migrasi bila kesehatan bocor (pola 0060/0061/0062)
-- ===========================================================================
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_rls_coverage() % baris setelah 0063', n; END IF;
  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_audit_coverage() % baris setelah 0063', n; END IF;
  SELECT count(*) INTO n FROM app.check_creator_scope_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_creator_scope_coverage() % baris setelah 0063', n; END IF;
  SELECT count(*) INTO n FROM app.check_budget_derived_volume();
  IF n > 0 THEN RAISE EXCEPTION 'check_budget_derived_volume() % baris setelah 0063', n; END IF;
  SELECT count(*) INTO n FROM app.check_budget_source_scope();
  IF n > 0 THEN RAISE EXCEPTION 'check_budget_source_scope() % baris setelah 0063', n; END IF;
END $$;
