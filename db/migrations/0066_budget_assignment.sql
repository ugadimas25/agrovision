-- ===========================================================================
-- 0066_budget_assignment.sql
--
-- Penugasan RAB dan serapan anggaran. Sambungan yang hilang antara RAB yang
-- sudah disetujui (0060..0065) dan realisasi harian (app.cost_transactions,
-- 0008/0016) -- dua modul yang sampai hari ini tidak saling mengenal.
--
-- Alur yang diminta pemilik produk, apa adanya:
--
--   1. agronomis menyusun RAB                       -> 0060 (draft -> submitted)
--   2. finance menyetujui                           -> 0060 (approver -> approved)
--   3. agronomis membuat penugasan ke tiap creator  -> §2 migrasi ini
--   4. "Pak Dede, siapkan 2 kg KCL"                 -> satu baris RAB, volume sebagian
--   5. Pak Dede mencatat pengeluaran                -> app.cost_transactions
--   6. anggaran berkurang, dipantau lewat kurva S   -> §10 migrasi ini
--
-- ENAM KEPUTUSAN yang membentuk migrasi ini:
--
-- 1. PENUGASAN HANYA PADA RAB YANG SUDAH `approved`. Menugaskan dari RAB draft
--    berarti menyuruh orang membelanjakan angka yang belum diputuskan siapa
--    pun; kalau kemudian finance memotong angka itu, uangnya sudah keluar dan
--    tidak ada keputusan yang bisa ditunjuk sebagai dasarnya. Ditegakkan
--    trigger (§5), bukan CHECK -- CHECK tidak bisa menengok tabel lain (pola
--    yang sama dengan budget_plan_item_phase_guard, 0060 §3).
--
-- 2. PAGU VOLUME PER BARIS RAB. Jumlah volume seluruh penugasan aktif untuk
--    satu baris tidak boleh melewati volume baris itu. Tanpa pagu, "7.000
--    bibit" bisa ditugaskan tiga kali penuh ke tiga orang dan RAB yang
--    disetujui berubah menjadi 21.000 bibit tanpa satu pun keputusan baru --
--    persis kelas kebocoran yang ditutup 0065, hanya lewat pintu lain.
--
-- 3. `assignee_user_id` HARUS PUNYA AKSES KE ENTITAS YANG SAMA, dan harus
--    orang yang memang boleh mencatat realisasi. Pemeriksaan foreign key
--    berjalan di dalam mesin dan MELEWATI policy (pelajaran 0063 §2), jadi RLS
--    saja tidak cukup: tenant B yang menebak satu uuid pengguna tenant A bisa
--    menuliskannya. Trigger §5 memeriksanya di bawah RLS pemanggil, sehingga
--    pengguna yang tak terlihat = tertolak.
--
-- 4. `start_date` PADA RAB, NULLABLE DAN TANPA DEFAULT. Lihat §3 -- ini titik
--    nol yang membuat kurva rencana dan kurva realisasi berada pada sumbu yang
--    sama, dan menebaknya berarti mengarang jadwal.
--
-- 5. `realisasi` NULL, BUKAN 0, untuk baris yang belum punya realisasi
--    tertaut. Doktrin repo (CLAUDE.md): null = "belum ada data", dirender
--    em-dash; 0 adalah KLAIM bahwa pencatatannya lengkap dan hasilnya nihil.
--    Di layar finansial bedanya bukan kosmetik: "sisa anggaran Rp 700 juta"
--    karena belum ada yang mencatat belanjanya adalah angka yang salah, dan ia
--    salah ke arah yang membuat orang merasa aman.
--
-- 6. SERAPAN YANG MELEBIHI ANGGARAN TETAP TERLIHAT. `sisa` boleh negatif dan
--    sengaja tidak dijepit ke nol. Menjepitnya menyembunyikan satu-satunya
--    angka yang orang butuh lihat cepat.
--
-- CATATAN NAMA. Sudah ada app.assignments (0004/0007) -- penugasan SURVEI
-- berbasis form, tanpa company_id, dan tidak dipakai satu baris pun di src/.
-- Tabel di sini sengaja bernama app.budget_assignments dan memakai enum
-- statusnya sendiri: keduanya benda berbeda (perintah kerja atas satu baris
-- anggaran vs. tugas pengisian form), dan menyatukannya hanya akan membuat
-- satu tabel dengan separuh kolom selalu NULL.
-- ===========================================================================

-- ===========================================================================
-- §1. Status penugasan
--
-- Tiga nilai, sesedikit yang bisa dipertanggungjawabkan. `done` TIDAK berarti
-- "uangnya sudah keluar" -- itu dijawab realisasi tertaut, bukan oleh centang
-- yang dibuat manusia. Ia hanya menandai penerima tugas menganggap pekerjaan
-- itu selesai, dan karena itu volumenya TETAP dihitung dalam pagu §6: tugas
-- yang selesai tetap memakai jatah baris RAB-nya.
--
-- Hanya `cancelled` yang mengembalikan jatah. Itu sebabnya membatalkan adalah
-- wewenang penugas, bukan penerima (§7) -- membatalkan berarti melepas
-- anggaran, dan orang yang ditugasi tidak memutuskan anggaran.
-- ===========================================================================

CREATE TYPE app.budget_assignment_status AS ENUM (
  'assigned',    -- sudah diberikan, belum dinyatakan selesai
  'done',        -- penerima menyatakan selesai; jatah volumenya TETAP terpakai
  'cancelled'    -- ditarik penugas; jatah volumenya kembali ke baris RAB
);

COMMENT ON TYPE app.budget_assignment_status IS
  'Status penugasan RAB. Hanya cancelled yang mengembalikan jatah volume ke '
  'baris RAB-nya; done tetap memakai jatah karena pekerjaannya memang '
  'dikerjakan. "Selesai" bukan bukti uang sudah keluar -- itu dijawab '
  'realisasi tertaut.';

-- ===========================================================================
-- §2. app.budget_assignments -- perintah kerja atas SATU baris RAB
--
-- Tiga integritas di bawah ditegakkan MESIN lewat composite FK, bukan trigger,
-- mengikuti 0018 §6 (ct_block_same_company). Bedanya penting: composite FK
-- tidak bisa dibohongi oleh RLS pemanggil dan tidak bisa lupa dipanggil.
--
--   (company_id, plan_id)      -> RAB benar-benar milik entitas ini
--   (plan_id, plan_item_id)    -> baris RAB benar-benar milik RAB ini
--   (company_id, id) di-index  -> dipakai app.cost_transactions di §4
--
-- Yang TIDAK bisa dijadikan composite FK adalah kelayakan assignee: haknya
-- tinggal di app.user_company_access, bukan di kolom tabel ini. Itu yang
-- dikerjakan trigger §5.
-- ===========================================================================

CREATE UNIQUE INDEX budget_plans_company_id_uniq
  ON app.budget_plans (company_id, id);
CREATE UNIQUE INDEX budget_plan_items_plan_id_uniq
  ON app.budget_plan_items (plan_id, id);

CREATE TABLE app.budget_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES app.companies(id),
  plan_id          uuid NOT NULL REFERENCES app.budget_plans(id),
  -- Menunjuk SATU baris RAB, bukan RAB-nya. "Siapkan 2 kg KCL" adalah bagian
  -- dari baris pupuk KCL dan tidak berarti apa-apa tanpa baris itu -- yang
  -- membuat pagu §6 dan serapan §10 punya penyebut.
  plan_item_id     uuid NOT NULL REFERENCES app.budget_plan_items(id),
  assignee_user_id uuid NOT NULL REFERENCES app.users(id),
  -- Volume SEBAGIAN dari baris RAB. 2 kg dari 700 kg KCL yang dianggarkan.
  volume           numeric(18,4) NOT NULL CHECK (volume > 0),
  -- Satuan penugasan. NULL = ikut satuan baris RAB-nya; tidak diisi otomatis
  -- karena menyalin satuan diam-diam menyembunyikan penugasan yang satuannya
  -- memang berbeda dari barisnya (kg vs. sak).
  uom_item_id      uuid REFERENCES app.master_items(id),
  -- NULL = belum ada tenggat. BUKAN "hari ini" dan bukan tanggal RAB: tenggat
  -- yang tidak pernah ditetapkan siapa pun tidak boleh muncul di layar sebagai
  -- tenggat.
  target_date      date,
  note             text,
  status           app.budget_assignment_status NOT NULL DEFAULT 'assigned',
  created_by       uuid REFERENCES app.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- RAB harus milik entitas baris ini (mesin, bukan trigger).
  CONSTRAINT bas_plan_same_company
    FOREIGN KEY (company_id, plan_id) REFERENCES app.budget_plans (company_id, id),
  -- Baris RAB harus milik RAB yang ditunjuk (mesin, bukan trigger). Ini juga
  -- yang menahan baris RAB dipindahkan ke RAB lain di bawah penugasan yang
  -- sudah menunjuknya.
  CONSTRAINT bas_item_in_plan
    FOREIGN KEY (plan_id, plan_item_id) REFERENCES app.budget_plan_items (plan_id, id)
);

COMMENT ON TABLE app.budget_assignments IS
  'Penugasan RAB: perintah kerja bervolume sebagian atas SATU baris RAB yang '
  'sudah disetujui, ditujukan ke satu pengguna. Jembatan antara rencana '
  '(app.budget_plan_items) dan realisasi (app.cost_transactions).';

COMMENT ON COLUMN app.budget_assignments.volume IS
  'Volume yang ditugaskan, bagian dari volume baris RAB. Jumlah seluruh '
  'penugasan aktif (status <> cancelled) atas satu baris tidak boleh melewati '
  'volume baris itu -- ditegakkan app.budget_assignment_volume_guard().';

COMMENT ON COLUMN app.budget_assignments.target_date IS
  'Tenggat, bila ada. NULL = belum ditetapkan, dirender em-dash. Sengaja tanpa '
  'default: tenggat yang diarang aplikasi akan dibaca sebagai janji.';

CREATE UNIQUE INDEX budget_assignments_company_id_uniq
  ON app.budget_assignments (company_id, id);
CREATE INDEX budget_assignments_item_idx
  ON app.budget_assignments (plan_item_id) WHERE status <> 'cancelled';
CREATE INDEX budget_assignments_assignee_idx
  ON app.budget_assignments (assignee_user_id, status);
CREATE INDEX budget_assignments_plan_idx
  ON app.budget_assignments (plan_id, status);

-- ===========================================================================
-- §3. app.budget_plans.start_date -- titik nol kurva
--
-- KENAPA KOLOM INI ADA. `phase_month` (0060 §2) bersifat RELATIF: "bulan ke-1
-- persiapan lahan, bulan ke-2 pembibitan". Realisasi bertanggal SUNGGUHAN:
-- 12 Maret 2026. Tanpa satu titik nol yang sama, kurva rencana dan kurva
-- realisasi tidak berada pada sumbu yang sama, dan menggambar keduanya di satu
-- grafik hanya menghasilkan gambar yang rapi dan tidak berarti apa pun.
--
-- NULLABLE DAN TIDAK DIISI DEFAULT, dan itu keputusan utamanya. Selama kosong,
-- app.budget_s_curve() (§10) mengembalikan NOL BARIS dan layar mengatakan
-- kurvanya belum bisa digambar.
--
-- JANGAN mengisinya otomatis dari created_at maupun dari tanggal realisasi
-- pertama. Keduanya menciptakan jadwal yang tidak pernah ditetapkan siapa pun:
-- created_at adalah kapan seseorang mengetik RAB-nya, bukan kapan pekerjaannya
-- dimulai; tanggal realisasi pertama membuat kurva rencana bergeser sendiri
-- setiap kali ada belanja lebih awal, sehingga rencana selalu tampak tepat
-- waktu. Kolom ini harus diisi manusia, satu kali, secara sadar.
-- ===========================================================================

ALTER TABLE app.budget_plans ADD COLUMN start_date date;

COMMENT ON COLUMN app.budget_plans.start_date IS
  'Tanggal mulai pekerjaan = titik nol phase_month. NULL = belum ditetapkan, '
  'dan selama itu kurva S tidak digambar (app.budget_s_curve mengembalikan nol '
  'baris). JANGAN diisi otomatis dari created_at atau dari realisasi pertama: '
  'itu mengarang jadwal yang tidak pernah ditetapkan siapa pun. Sebaiknya '
  'tanggal 1, supaya bulan relatif berimpit dengan bulan kalender.';

-- ===========================================================================
-- §4. Tautan realisasi
--
-- NULLABLE, dan itu bukan kelonggaran: tidak semua pengeluaran berasal dari
-- RAB (overhead, biaya yang sudah berjalan sebelum modul ini ada, seluruh
-- baris hasil materialisasi 0044/0045). Memaksa NOT NULL akan membuat modul
-- costing yang sudah jalan berhenti.
--
-- Lintas entitas ditutup composite FK (mesin), bukan trigger -- alasan yang
-- sama dengan §2. Yang TIDAK bisa dijawab composite FK adalah "penugasan ini
-- diberikan kepada siapa": itu trigger §8.
--
-- ON DELETE RESTRICT sekaligus menjawab syarat "penugasan yang sudah punya
-- realisasi tertaut tidak boleh dihapus". Sengaja ditegakkan FK, bukan policy
-- atau trigger: pemeriksaan integritas referensial berjalan di dalam mesin dan
-- MELEWATI RLS, jadi realisasi yang tak terlihat oleh si penghapus tetap
-- menahan penghapusan. Trigger SECURITY INVOKER justru akan meloloskannya --
-- ia tidak melihat apa yang RLS sembunyikan darinya.
-- ===========================================================================

ALTER TABLE app.cost_transactions ADD COLUMN budget_assignment_id uuid;

ALTER TABLE app.cost_transactions
  ADD CONSTRAINT ct_assignment_same_company
  FOREIGN KEY (company_id, budget_assignment_id)
  REFERENCES app.budget_assignments (company_id, id)
  ON DELETE RESTRICT;

COMMENT ON COLUMN app.cost_transactions.budget_assignment_id IS
  'Penugasan RAB yang direalisasikan baris biaya ini. NULL = pengeluaran ini '
  'memang tidak berasal dari RAB (overhead, biaya lama, baris hasil '
  'materialisasi 0044) -- itu keadaan yang sah, bukan data yang kurang.';

CREATE INDEX cost_tx_assignment_idx ON app.cost_transactions (budget_assignment_id)
  WHERE budget_assignment_id IS NOT NULL;

-- ===========================================================================
-- §5. Gerbang bentuk penugasan: RAB harus disetujui, assignee harus layak
--
-- Keduanya trigger dan bukan policy karena keduanya menjawab pertanyaan
-- "keadaan apa", bukan "peran siapa" -- dan jawabannya harus MENYEBUT keadaan
-- itu. Penolakan lewat policy diam ("row-level security"), penolakan lewat
-- trigger bisa berbunyi "RAB RAB-2026-01 berstatus draft". Peran tetap
-- digerbang policy di §9; kedua lapis itu tidak saling menggantikan.
--
-- SECURITY INVOKER (bawaan, disengaja) untuk keduanya: subquery-nya tunduk RLS
-- pemanggil, jadi RAB atau pengguna milik tenant lain menghasilkan NULL dan
-- langsung tertolak -- pola persis app.budget_source_same_company() (0063 §2).
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_assignment_plan_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_kode   text;
  v_status app.record_status;
BEGIN
  SELECT p.code, p.approval_status INTO v_kode, v_status
    FROM app.budget_plans p
   WHERE p.id = NEW.plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RAB tidak ditemukan di entitas ini'
      USING HINT = 'Penugasan hanya bisa dibuat pada RAB yang terlihat oleh entitas Anda.';
  END IF;

  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'RAB % belum disetujui (status: %); penugasan hanya boleh dibuat pada RAB yang sudah disetujui',
      v_kode, v_status
      USING HINT = 'Menugaskan dari RAB yang belum diputuskan berarti menyuruh orang '
                   'membelanjakan angka yang belum disetujui siapa pun.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.budget_assignment_plan_guard IS
  'Penugasan hanya pada RAB berstatus approved. Trigger, bukan CHECK -- CHECK '
  'tidak bisa menengok tabel lain (pola 0060 §3). Tidak dipasang pada perubahan '
  'status penugasan, supaya penerima tugas tetap bisa menandai pekerjaannya '
  'selesai walau RAB-nya kemudian dibatalkan.';

CREATE TRIGGER budget_assignments_plan_guard
  BEFORE INSERT OR UPDATE OF plan_id, plan_item_id, volume ON app.budget_assignments
  FOR EACH ROW EXECUTE FUNCTION app.budget_assignment_plan_guard();

CREATE OR REPLACE FUNCTION app.budget_assignment_assignee_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_nama  text;
  v_peran app.app_role;
  v_aktif boolean;
BEGIN
  -- Dibaca di bawah RLS pemanggil: pengguna tenant lain TIDAK terlihat, jadi
  -- NOT FOUND -- yang persis merupakan penolakan yang kita mau. Lihat 0063 §2:
  -- FK-nya sendiri tidak menolong, ia dievaluasi mesin dan melewati policy.
  SELECT u.full_name, u.app_role, u.is_active INTO v_nama, v_peran, v_aktif
    FROM app.users u
   WHERE u.id = NEW.assignee_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'penerima tugas tidak terdaftar di entitas ini'
      USING HINT = 'Penugasan lintas entitas ditolak.';
  END IF;

  -- Punya home company saja tidak cukup: yang menentukan akses adalah
  -- app.user_company_access (dan itu yang dipakai app.accessible_company_ids()).
  IF NOT EXISTS (SELECT 1 FROM app.user_company_access uca
                  WHERE uca.user_id = NEW.assignee_user_id
                    AND uca.company_id = NEW.company_id) THEN
    RAISE EXCEPTION '% tidak punya akses ke entitas RAB ini', v_nama
      USING HINT = 'Beri akses entitasnya lebih dulu lewat app.grant_company_access().';
  END IF;

  IF NOT v_aktif THEN
    RAISE EXCEPTION '% sudah dinonaktifkan; tidak bisa ditugasi', v_nama;
  END IF;

  -- Menugasi orang yang tidak boleh mencatat realisasi berarti membuat tugas
  -- yang tidak mungkin ditutup: viewer dan agronomist ditolak menulis ke
  -- app.cost_transactions oleh *_viewer_readonly + role_may_write_records()
  -- (0018 §9 / 0059). Tugasnya akan menggantung selamanya, dan pagu volume
  -- baris RAB-nya ikut tertahan tanpa ada yang bisa membebaskannya.
  IF v_peran NOT IN ('creator', 'approver', 'super_admin') THEN
    RAISE EXCEPTION '% berperan % dan tidak boleh mencatat realisasi, jadi tidak bisa ditugasi',
      v_nama, v_peran
      USING HINT = 'Yang bisa ditugasi adalah peran yang boleh menulis realisasi: '
                   'creator, approver, super_admin.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.budget_assignment_assignee_guard IS
  'Penerima tugas wajib terlihat di entitas ini, punya app.user_company_access '
  'ke entitas RAB, masih aktif, dan berperan yang boleh mencatat realisasi. '
  'SECURITY INVOKER: pengguna tenant lain tidak terlihat, jadi tertolak.';

CREATE TRIGGER budget_assignments_assignee_guard
  BEFORE INSERT OR UPDATE OF assignee_user_id, company_id ON app.budget_assignments
  FOR EACH ROW EXECUTE FUNCTION app.budget_assignment_assignee_guard();

-- ===========================================================================
-- §6. Pagu volume per baris RAB
--
-- KENAPA SECURITY DEFINER, padahal 0063 §2 justru menegaskan triggernya BUKAN
-- security definer. Karena yang dihitung di sini berbeda jenisnya: 0063
-- memeriksa KETERLIHATAN satu baris (dan "tak terlihat = tertolak" memang
-- jawaban yang benar), sedangkan di sini yang dihitung adalah JUMLAH SELURUH
-- penugasan atas satu baris RAB. Penjumlahan yang tunduk RLS akan
-- mengembalikan angka yang lebih kecil bagi pembaca yang penglihatannya
-- disempitkan -- dan pagu yang menghasilkan angka berbeda tergantung siapa
-- yang kebetulan menabraknya bukan pagu. `budget_assignments_creator_own_select`
-- (§9) adalah penyempitan seperti itu, dan sudah cukup untuk membuat versi
-- SECURITY INVOKER meloloskan penugasan berlebih.
--
-- Karena itu fungsinya MENGGERBANG DIRI: ia menolak menjawab untuk baris RAB
-- di luar app.accessible_company_ids() sesi ini. Dengan begitu satu-satunya
-- yang bisa didapat penyerang adalah angka yang memang sudah boleh ia baca.
-- Urutannya juga disengaja -- trigger §5 lebih dulu menolak RAB yang tak
-- terlihat, dan trigger BEFORE ROW berjalan SEBELUM WITH CHECK policy, jadi
-- tanpa gerbang itu pesan galat di sini bisa membocorkan volume baris RAB
-- milik tenant lain.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_assignment_assigned_volume(
  p_plan_item_id uuid,
  p_exclude_id   uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
DECLARE
  v_company uuid;
  v_total   numeric;
BEGIN
  SELECT p.company_id INTO v_company
    FROM app.budget_plan_items i
    JOIN app.budget_plans p ON p.id = i.plan_id
   WHERE i.id = p_plan_item_id;

  IF v_company IS NULL THEN
    RETURN NULL;                       -- baris RAB tidak ada
  END IF;

  -- Gerbang diri. accessible_company_ids() menyaring dengan
  -- app.current_user_id()/current_company_id() sesi, jadi ia tetap menjawab
  -- untuk SESI ini walau fungsinya berjalan sebagai pemilik.
  IF NOT EXISTS (SELECT 1 FROM app.accessible_company_ids() a WHERE a = v_company) THEN
    RAISE EXCEPTION 'baris RAB tidak ditemukan di entitas ini';
  END IF;

  SELECT COALESCE(SUM(b.volume), 0) INTO v_total
    FROM app.budget_assignments b
   WHERE b.plan_item_id = p_plan_item_id
     AND b.status <> 'cancelled'
     AND (p_exclude_id IS NULL OR b.id <> p_exclude_id);

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION app.budget_assignment_assigned_volume(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.budget_assignment_assigned_volume(uuid, uuid) TO app_rw, app_ro;

COMMENT ON FUNCTION app.budget_assignment_assigned_volume(uuid, uuid) IS
  'Total volume penugasan AKTIF atas satu baris RAB, lengkap tanpa penyempitan '
  'RLS. SECURITY DEFINER dengan gerbang diri ke app.accessible_company_ids(): '
  'pagu yang berbeda angkanya tergantung siapa yang melihat bukan pagu.';

CREATE OR REPLACE FUNCTION app.budget_assignment_volume_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_volume_baris numeric;
  v_uraian       text;
  v_terpakai     numeric;
BEGIN
  -- Perubahan yang tidak menggeser jumlah aktif tidak perlu dijumlah ulang:
  -- menandai tugas selesai (assigned -> done) tetap memakai jatah yang sama.
  IF TG_OP = 'UPDATE'
     AND NEW.plan_item_id IS NOT DISTINCT FROM OLD.plan_item_id
     AND NEW.volume       IS NOT DISTINCT FROM OLD.volume
     AND (OLD.status = 'cancelled') = (NEW.status = 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Penugasan yang dibatalkan melepas jatahnya; tak ada yang perlu digerbang.
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT i.volume, i.description INTO v_volume_baris, v_uraian
    FROM app.budget_plan_items i
   WHERE i.id = NEW.plan_item_id;

  IF v_volume_baris IS NULL THEN
    RAISE EXCEPTION 'baris RAB tidak ditemukan di entitas ini';
  END IF;

  v_terpakai := app.budget_assignment_assigned_volume(
                  NEW.plan_item_id,
                  CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END);

  IF v_terpakai + NEW.volume > v_volume_baris THEN
    RAISE EXCEPTION
      'total penugasan melebihi volume baris RAB "%": volume baris %, sudah ditugaskan %, sisa %, diminta %',
      v_uraian,
      trim_scale(v_volume_baris), trim_scale(v_terpakai),
      trim_scale(v_volume_baris - v_terpakai), trim_scale(NEW.volume)
      USING HINT = 'Kurangi volumenya, atau batalkan penugasan lain pada baris yang sama.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.budget_assignment_volume_guard IS
  'Pagu: jumlah volume penugasan aktif atas satu baris RAB tidak boleh melewati '
  'volume baris itu. Tanpa pagu, satu baris 7.000 bibit bisa ditugaskan penuh '
  'ke tiga orang dan RAB yang disetujui berubah jadi 21.000 tanpa keputusan baru.';

CREATE TRIGGER budget_assignments_volume_guard
  BEFORE INSERT OR UPDATE OF plan_item_id, volume, status ON app.budget_assignments
  FOR EACH ROW EXECUTE FUNCTION app.budget_assignment_volume_guard();

-- ===========================================================================
-- §7. Apa yang boleh diubah PENERIMA tugas
--
-- Policy RLS tidak bisa membandingkan baris lama dengan baris baru: USING
-- melihat OLD, WITH CHECK melihat NEW, dan tidak ada klausa yang melihat
-- keduanya sekaligus. "Boleh mengubah status, tidak boleh mengubah volume"
-- karena itu mustahil ditulis sebagai policy dan harus jadi trigger.
--
-- Tanpa trigger ini, bas_write_update (§9) yang membiarkan penerima tugas
-- menyunting barisnya sendiri juga membiarkannya MENAIKKAN volumenya sendiri:
-- Pak Dede ditugasi 2 kg dan menuliskan ulang 700 kg untuk dirinya. Pagu §6
-- tetap menahan totalnya, tapi bukan pagu yang seharusnya menjawab pertanyaan
-- "siapa yang menentukan volume" -- penugas yang menentukan.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_assignment_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app.role_may_write_budget_plan() THEN
    RETURN NEW;                        -- penugas: agronomist/approver/super_admin
  END IF;

  IF NEW.company_id       IS DISTINCT FROM OLD.company_id
  OR NEW.plan_id          IS DISTINCT FROM OLD.plan_id
  OR NEW.plan_item_id     IS DISTINCT FROM OLD.plan_item_id
  OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
  OR NEW.volume           IS DISTINCT FROM OLD.volume
  OR NEW.uom_item_id      IS DISTINCT FROM OLD.uom_item_id
  OR NEW.target_date      IS DISTINCT FROM OLD.target_date
  OR NEW.created_by       IS DISTINCT FROM OLD.created_by
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'penerima tugas hanya boleh mengubah status dan catatan penugasannya'
      USING HINT = 'Volume, sasaran, dan tenggat ditentukan penugas.';
  END IF;

  IF NEW.status = 'cancelled' OR OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'membatalkan atau menghidupkan kembali penugasan adalah wewenang penugas'
      USING HINT = 'Membatalkan berarti melepas anggarannya kembali ke baris RAB.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.budget_assignment_transition_guard IS
  'Penerima tugas boleh menggerakkan status assigned <-> done dan menyunting '
  'catatan; tidak boleh menyentuh volume, sasaran, tenggat, maupun membatalkan. '
  'Trigger dan bukan policy karena RLS tidak bisa membandingkan OLD dengan NEW.';

CREATE TRIGGER budget_assignments_transition_guard
  BEFORE UPDATE ON app.budget_assignments
  FOR EACH ROW EXECUTE FUNCTION app.budget_assignment_transition_guard();

-- ===========================================================================
-- §8. Realisasi hanya boleh ditaut ke penugasan SENDIRI
--
-- Lintas entitas sudah ditutup composite FK di §4. Yang tersisa: Pak Dede
-- tidak boleh menaut realisasinya ke penugasan yang diberikan kepada orang
-- lain. Kalau bisa, serapan sebuah penugasan menjadi angka yang bisa
-- ditambahi siapa saja dalam satu entitas, dan pertanyaan "siapa
-- membelanjakan jatah ini" kehilangan jawabannya.
--
-- Trigger sengaja dipasang `UPDATE OF budget_assignment_id` DAN menyaring
-- perubahan nilai: tanpa itu, approver yang menyetujui realisasi Pak Dede
-- (UPDATE approval_status) akan ikut tertolak karena penugasannya memang bukan
-- miliknya. Yang digerbang adalah TINDAKAN MENAUT, bukan setiap sentuhan pada
-- barisnya.
--
-- approver TIDAK dikecualikan, dan itu disengaja: finance memutuskan besaran
-- uang, bukan menentukan jatah siapa yang terpakai. super_admin dikecualikan
-- karena ia yang membereskan data salah taut.
--
-- PEMILIK PENUGASAN DIBACA LEWAT FUNGSI SECURITY DEFINER YANG MENGGERBANG DIRI,
-- bukan lewat SELECT biasa, dan alasannya adalah KEJUJURAN PESAN GALAT.
-- budget_assignments_creator_own_select (§9) menyembunyikan penugasan orang
-- lain dari seorang creator; SELECT biasa di dalam trigger ini karena itu
-- mengembalikan NOT FOUND dan pesannya menjadi "penugasan tidak ditemukan di
-- entitas ini" -- kalimat yang TIDAK BENAR: penugasannya ada di entitas itu,
-- ia cuma bukan miliknya. Pak Dede lalu mencari kesalahan di tempat yang salah.
-- Fungsi di bawah menjawab dalam batas entitas sesi (dan hanya di dalamnya),
-- sehingga triggernya bisa menyebut pemiliknya. Yang tetap tak terlihat adalah
-- penugasan entitas lain -- di situ "tidak ditemukan" memang kalimat yang benar.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.budget_assignment_owner(p_id uuid)
RETURNS TABLE (owner_user_id uuid, owner_company_id uuid, owner_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_catalog AS $$
DECLARE v_row record;
BEGIN
  SELECT b.assignee_user_id AS uid, b.company_id AS cid, u.full_name AS nama
    INTO v_row
    FROM app.budget_assignments b
    LEFT JOIN app.users u ON u.id = b.assignee_user_id
   WHERE b.id = p_id;

  IF NOT FOUND THEN
    RETURN;                            -- tidak ada
  END IF;

  -- Gerbang diri: penugasan milik entitas lain tetap tidak terlihat.
  IF NOT EXISTS (SELECT 1 FROM app.accessible_company_ids() a WHERE a = v_row.cid) THEN
    RETURN;
  END IF;

  owner_user_id    := v_row.uid;
  owner_company_id := v_row.cid;
  owner_name       := v_row.nama;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION app.budget_assignment_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.budget_assignment_owner(uuid) TO app_rw, app_ro;

COMMENT ON FUNCTION app.budget_assignment_owner(uuid) IS
  'Pemilik satu penugasan, dalam batas entitas sesi ini. SECURITY DEFINER '
  'dengan gerbang diri supaya penolakan "bukan penugasan Anda" bisa menyebut '
  'pemiliknya alih-alih berbohong dengan "tidak ditemukan" -- penyempitan '
  'SELECT per-penerima membuat SELECT biasa tidak bisa membedakan keduanya.';

CREATE OR REPLACE FUNCTION app.cost_transaction_assignment_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pemilik record;
BEGIN
  IF NEW.budget_assignment_id IS NULL THEN
    RETURN NEW;                        -- pengeluaran non-RAB: sah, lihat §4
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.budget_assignment_id IS NOT DISTINCT FROM OLD.budget_assignment_id THEN
    RETURN NEW;                        -- tautannya tidak bergerak
  END IF;

  SELECT * INTO v_pemilik FROM app.budget_assignment_owner(NEW.budget_assignment_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'penugasan tidak ditemukan di entitas ini';
  END IF;

  -- Redundan terhadap ct_assignment_same_company (§4), dan sengaja: FK
  -- dievaluasi di akhir perintah dan berbunyi teknis; ini berbunyi manusia.
  IF v_pemilik.owner_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'penugasan milik entitas lain tidak bisa ditaut ke realisasi ini';
  END IF;

  IF app.current_role_name() = 'super_admin' THEN
    RETURN NEW;
  END IF;

  IF v_pemilik.owner_user_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'penugasan ini diberikan kepada %, bukan kepada Anda',
      COALESCE(v_pemilik.owner_name, 'pengguna lain')
      USING HINT = 'Realisasi hanya bisa ditaut ke penugasan yang diberikan kepada Anda.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION app.cost_transaction_assignment_guard IS
  'Realisasi hanya boleh ditaut ke penugasan milik sesi ini (kecuali '
  'super_admin) dan tidak boleh lintas entitas. Hanya digerbang saat tautannya '
  'benar-benar bergerak, supaya persetujuan realisasi oleh approver tidak ikut '
  'tertolak.';

CREATE TRIGGER cost_transactions_assignment_guard
  BEFORE INSERT OR UPDATE OF budget_assignment_id, company_id ON app.cost_transactions
  FOR EACH ROW EXECUTE FUNCTION app.cost_transaction_assignment_guard();

-- ===========================================================================
-- §9. RLS
--
-- Tiga lapis, mengikuti bentuk yang sudah dipakai modul RAB:
--
--   bas_tenant                            se-entitas, permissive
--   budget_assignments_creator_own_select creator hanya melihat tugasnya
--   bas_write_{insert,update,delete}      gerbang tulis, DIPECAH PER PERINTAH
--
-- DIPECAH PER PERINTAH, bukan RESTRICTIVE FOR ALL, dan itu bukan gaya
-- penulisan. Klausa USING sebuah policy FOR ALL ikut menyaring SELECT: gerbang
-- tulis yang ditulis begitu akan MENYEMBUNYIKAN penugasan dari orang yang tidak
-- boleh menulisnya, termasuk dari penerima tugasnya sendiri. Repo ini pernah
-- tepat begitu (0018 §5 -> 0020), dan 0063 §4 menambahkan alasan kedua:
-- RESTRICTIVE FOR ALL dengan USING (true) TIDAK menggerbang DELETE sama sekali,
-- karena DELETE tidak pernah menyentuh WITH CHECK.
--
-- SIAPA MENULIS APA:
--   agronomist / approver / super_admin  membuat, mengubah, membatalkan, menghapus
--   penerima tugas (creator)             hanya status + catatan tugasnya (§7)
--   viewer, dan creator yang bukan penerima  tidak menulis apa pun
--
-- Daftar penugasnya sama dengan penulis RAB, jadi ia memakai ulang
-- app.role_may_write_budget_plan() (0060) -- bukan role_may_write_records(),
-- yang justru TIDAK memuat agronomist.
--
-- SELECT: se-entitas untuk semua peran KECUALI creator, yang disempitkan ke
-- penugasan miliknya sendiri -- sejajar cost_transactions_creator_own_select
-- (0054 / B-23). Namanya sengaja mengikuti pola `%_creator_own_select` supaya
-- app.check_creator_scope_coverage() ikut menjaganya bila kelak tabel ini
-- mendapat policy *_role_split.
-- ===========================================================================

ALTER TABLE app.budget_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.budget_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY bas_tenant ON app.budget_assignments
  USING (company_id IN (SELECT app.accessible_company_ids()))
  WITH CHECK (company_id IN (SELECT app.accessible_company_ids()));

CREATE POLICY budget_assignments_creator_own_select ON app.budget_assignments
  AS RESTRICTIVE FOR SELECT
  USING (app.current_role_name() <> 'creator'
         OR assignee_user_id = app.current_user_id());

CREATE POLICY bas_write_insert ON app.budget_assignments
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.role_may_write_budget_plan());

-- USING dan WITH CHECK HARUS berbunyi sama. USING menguji baris LAMA, WITH
-- CHECK menguji baris BARU; syarat yang hanya dipasang di salah satunya bukan
-- syarat -- barisnya tinggal DIPINDAHKAN ke keadaan yang dilarang. Di sini
-- pemindahan yang nyata: penerima tugas mengoper tugasnya ke orang lain (USING
-- lolos karena baris lama miliknya) atau MENGAMBIL tugas orang lain (WITH CHECK
-- lolos karena baris baru miliknya). 0065 dibuat justru karena kelalaian ini.
CREATE POLICY bas_write_update ON app.budget_assignments
  AS RESTRICTIVE FOR UPDATE
  USING      (app.role_may_write_budget_plan() OR assignee_user_id = app.current_user_id())
  WITH CHECK (app.role_may_write_budget_plan() OR assignee_user_id = app.current_user_id());

-- Menghapus penugasan adalah wewenang penugas saja. Penugasan yang sudah punya
-- realisasi tertaut tetap tertahan FK §4, di lapisan mesin, untuk semua peran
-- termasuk super_admin -- menghapusnya akan meninggalkan realisasi yang tidak
-- lagi punya jatah yang ia habiskan.
CREATE POLICY bas_write_delete ON app.budget_assignments
  AS RESTRICTIVE FOR DELETE
  USING (app.role_may_write_budget_plan());

-- Yang berubah di tabel ini adalah perintah membelanjakan uang yang sudah
-- disetujui. B-8: jejak audit menjawab siapa menugaskan apa kepada siapa.
CREATE TRIGGER budget_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON app.budget_assignments
  FOR EACH ROW EXECUTE FUNCTION app.write_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON app.budget_assignments TO app_rw;
GRANT SELECT ON app.budget_assignments TO app_ro;

-- ===========================================================================
-- §10. Serapan dan kurva S
--
-- Keduanya SECURITY INVOKER (bawaan LANGUAGE sql, tidak ditimpa) dan karena
-- itu tunduk RLS pemanggilnya. Konsekuensi yang harus diketahui pemakainya:
-- bagi `creator`, keduanya menghitung IRISAN MILIKNYA saja -- penugasannya
-- sendiri (budget_assignments_creator_own_select) dan realisasinya sendiri
-- (cost_transactions_creator_own_select, 0054). Itu perilaku yang benar untuk
-- "tugas saya", dan angka yang SALAH untuk "serapan RAB". Layar serapan
-- ditujukan ke agronomist/approver/viewer/super_admin, yang melihat entitas
-- penuh.
--
-- Tidak dibuat sebagai VIEW karena keduanya berparameter satu RAB. Kalau kelak
-- dijadikan view, ia WAJIB `security_invoker = true` -- 0035 ada di repo ini
-- justru untuk memperbaiki 0034 yang lupa.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §10a. Serapan per baris RAB
--
-- KENAPA `realisasi` NULL DAN BUKAN 0. Lihat keputusan 5 di kepala berkas.
-- Perhatikan bahwa NULL-nya bukan tambalan: SUM() atas nol baris memang
-- mengembalikan NULL, dan kode ini hanya menahan diri untuk TIDAK
-- meng-COALESCE-nya ke 0. Itu persis yang diminta CLAUDE.md ("repo
-- mempertahankan null dari DB, tidak meng-coalesce ke 0").
--
-- `ditugaskan` mengikuti aturan yang sama, dan ini pilihan sadar. Bisa
-- dibantah -- penugasan lahir di dalam aplikasi ini, jadi "tidak ada baris"
-- rasanya berarti "memang belum ditugaskan". Tapi begitu RLS menyempitkan
-- penglihatan (paragraf di atas), "tidak ada baris yang terlihat" berhenti
-- sama dengan "tidak ada baris", dan 0 menjadi klaim yang tidak dijamin.
--
-- `belum_diputuskan` DIPISAH dari `realisasi` dan bukan dijumlahkan ke
-- dalamnya: realisasi yang masih draft/submitted belum diputuskan siapa pun,
-- jadi ia bukan serapan. Ia dikembalikan supaya layar bisa menampilkannya
-- sebagai KETERANGAN ("Rp 12 jt menunggu persetujuan"), bukan sebagai serapan.
--
-- `sisa` = anggaran - realisasi, ikut NULL saat realisasi NULL, dan BOLEH
-- NEGATIF. Keduanya disengaja. Ikut NULL: "sisa Rp 700 juta" untuk baris yang
-- belum pernah dicatat belanjanya adalah angka yang salah ke arah yang membuat
-- orang merasa aman. Boleh negatif: serapan yang melewati anggaran adalah
-- satu-satunya angka yang harus terlihat cepat, jadi tidak dijepit ke nol.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.budget_absorption(p_plan_id uuid)
RETURNS TABLE (
  item_id          uuid,
  description      text,
  phase_month      integer,
  anggaran         numeric,
  ditugaskan       numeric,
  realisasi        numeric,
  belum_diputuskan numeric,
  sisa             numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    i.id,
    i.description,
    i.phase_month,
    i.amount_idr,
    t.ditugaskan,
    r.realisasi,
    r.belum_diputuskan,
    i.amount_idr - r.realisasi          -- NULL bila belum ada realisasi; boleh negatif
  FROM app.budget_plan_items i
  -- LATERAL pada grain baris RAB: tepat satu baris keluar per baris RAB.
  -- Pelajaran 0018 §8 -- join ber-grain lain membuat anggaran terkali dan
  -- realisasi terbagi, dan angkanya salah tanpa satu pun galat.
  LEFT JOIN LATERAL (
    SELECT SUM(b.volume) AS ditugaskan
      FROM app.budget_assignments b
     WHERE b.plan_item_id = i.id
       AND b.status <> 'cancelled'
  ) t ON true
  LEFT JOIN LATERAL (
    SELECT
      SUM(ct.amount_idr) FILTER (WHERE ct.approval_status = 'approved') AS realisasi,
      SUM(ct.amount_idr) FILTER (WHERE ct.approval_status
            IN ('draft', 'submitted', 'under_review'))                 AS belum_diputuskan
      FROM app.cost_transactions ct
      JOIN app.budget_assignments b ON b.id = ct.budget_assignment_id
     WHERE b.plan_item_id = i.id
  ) r ON true
  WHERE i.plan_id = p_plan_id
    AND i.is_active
  ORDER BY i.phase_month, i.sort_order, i.description
$$;

GRANT EXECUTE ON FUNCTION app.budget_absorption(uuid) TO app_rw, app_ro;

COMMENT ON FUNCTION app.budget_absorption(uuid) IS
  'Serapan per baris RAB. realisasi HANYA menghitung cost_transactions '
  'berstatus approved; yang belum diputuskan dikembalikan terpisah sebagai '
  'belum_diputuskan supaya layar menampilkannya sebagai keterangan, bukan '
  'sebagai serapan. Baris tanpa realisasi tertaut mengembalikan NULL, bukan 0 '
  '-- dan sisa ikut NULL. sisa boleh negatif: serapan yang melewati anggaran '
  'harus terlihat. SECURITY INVOKER: bagi creator angkanya adalah irisan '
  'miliknya sendiri.';

-- ---------------------------------------------------------------------------
-- §10b. Indeks bulan relatif
--
-- Bulan ke-N adalah rentang [start_date + (N-1) bulan, start_date + N bulan),
-- jadi setiap bulan sama panjangnya -- itu arti "fase" pada RAB. Rumusnya
-- floor selisih bulan kalender, dikoreksi bila tanggal harinya belum sampai:
-- start 15 Mar, belanja 14 Apr masih bulan ke-1; 15 Apr sudah bulan ke-2.
--
-- Tidak dibulatkan ke awal bulan kalender, dan hasilnya BOLEH <= 0: belanja
-- yang terjadi sebelum start_date memang ada, dan menggesernya ke bulan ke-1
-- akan menyamarkan salah satu dari dua hal yang justru perlu dilihat --
-- start_date yang salah, atau belanja yang mendahului rencananya.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.budget_month_index(p_start date, p_date date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_start IS NULL OR p_date IS NULL THEN NULL ELSE
    ( (date_part('year',  p_date) - date_part('year',  p_start)) * 12
    + (date_part('month', p_date) - date_part('month', p_start))
    - CASE WHEN date_part('day', p_date) < date_part('day', p_start) THEN 1 ELSE 0 END
    )::int + 1
  END
$$;

GRANT EXECUTE ON FUNCTION app.budget_month_index(date, date) TO app_rw, app_ro;

COMMENT ON FUNCTION app.budget_month_index(date, date) IS
  'Bulan relatif ke berapa sebuah tanggal jatuh, dihitung dari titik nol RAB '
  '(budget_plans.start_date). 1 = bulan pertama. Boleh <= 0 untuk tanggal '
  'sebelum start_date -- belanja yang mendahului rencananya tidak digeser.';

-- ---------------------------------------------------------------------------
-- §10c. Kurva S
--
-- DUA ATURAN yang menentukan kejujurannya:
--
-- 1. start_date NULL -> NOL BARIS. Tanpa titik nol, indeks bulan realisasi
--    tidak bisa dihitung dari apa pun kecuali tebakan, dan kurva hasil tebakan
--    tetap terlihat seperti kurva. Layar yang menerima nol baris mengatakan
--    kurvanya belum bisa digambar -- kalimat yang benar.
--
-- 2. realisasi_kumulatif berhenti di bulan terakhir yang BENAR-BENAR punya
--    data; sesudahnya NULL, bukan garis datar. Garis datar berarti "sudah
--    dipastikan tidak ada belanja"; yang benar adalah "belum ada catatannya".
--    Di grafik, keduanya adalah gambar yang berbeda: yang satu kurva selesai,
--    yang lain kurva yang berhenti.
--
-- Rentangnya melebar mengikuti data, tidak dipotong ke horizon: belanja yang
-- melewati horizon RAB adalah hal yang paling perlu terlihat, bukan yang perlu
-- disembunyikan. Sama halnya rencana_kumulatif tidak dipotong -- ia mendatar
-- di totalnya karena rencana memang habis di situ, dan itu bukan tebakan.
--
-- rencana_kumulatif TIDAK memasukkan contingency_pct (0060 §1). Kontingensi
-- adalah cadangan, bukan jadwal: menaruhnya di bulan mana pun berarti mengarang
-- kapan ia akan dipakai.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.budget_s_curve(p_plan_id uuid)
RETURNS TABLE (
  bulan_ke            integer,
  rencana_kumulatif   numeric,
  realisasi_kumulatif numeric
) LANGUAGE sql STABLE AS $$
  WITH rab AS (
    -- start_date NULL -> CTE kosong -> seluruh fungsi mengembalikan nol baris.
    SELECT p.id, p.start_date, p.horizon_months
      FROM app.budget_plans p
     WHERE p.id = p_plan_id
       AND p.start_date IS NOT NULL
  ),
  rencana AS (
    SELECT i.phase_month AS bulan_ke, SUM(i.amount_idr) AS nilai
      FROM app.budget_plan_items i
      JOIN rab ON rab.id = i.plan_id
     WHERE i.is_active
     GROUP BY i.phase_month
  ),
  realisasi AS (
    SELECT app.budget_month_index(rab.start_date, ct.transaction_date) AS bulan_ke,
           SUM(ct.amount_idr) AS nilai
      FROM app.cost_transactions ct
      JOIN app.budget_assignments b ON b.id = ct.budget_assignment_id
      JOIN rab ON rab.id = b.plan_id
     WHERE ct.approval_status = 'approved'
     GROUP BY 1
  ),
  batas AS (
    -- Alias di setiap subquery bukan hiasan: `bulan_ke` juga nama kolom
    -- keluaran fungsi ini, dan referensi tak berkualifikasi ke nama yang sama
    -- adalah ambigu.
    SELECT LEAST(1, COALESCE((SELECT min(z.bulan_ke) FROM realisasi z), 1))  AS awal,
           GREATEST((SELECT k.horizon_months FROM rab k),
                    COALESCE((SELECT max(z.bulan_ke) FROM rencana z), 1),
                    COALESCE((SELECT max(z.bulan_ke) FROM realisasi z), 1))  AS akhir,
           -- NULL bila belum ada satu pun realisasi approved yang tertaut:
           -- seluruh kolom realisasi_kumulatif ikut NULL, bukan nol.
           (SELECT max(z.bulan_ke) FROM realisasi z)                        AS bulan_terakhir_berdata
  )
  SELECT g.n,
         COALESCE((SELECT SUM(x.nilai) FROM rencana x WHERE x.bulan_ke <= g.n), 0),
         CASE WHEN b.bulan_terakhir_berdata IS NULL OR g.n > b.bulan_terakhir_berdata
              THEN NULL
              ELSE COALESCE((SELECT SUM(y.nilai) FROM realisasi y WHERE y.bulan_ke <= g.n), 0)
         END
    FROM batas b
    CROSS JOIN generate_series(b.awal, b.akhir) AS g(n)
   WHERE EXISTS (SELECT 1 FROM rab)
   ORDER BY g.n
$$;

GRANT EXECUTE ON FUNCTION app.budget_s_curve(uuid) TO app_rw, app_ro;

COMMENT ON FUNCTION app.budget_s_curve(uuid) IS
  'Deret kumulatif untuk kurva S. NOL BARIS bila budget_plans.start_date masih '
  'NULL -- tanpa titik nol, indeks bulan realisasi hanya bisa ditebak. '
  'realisasi_kumulatif NULL setelah bulan terakhir yang benar-benar punya data, '
  'bukan garis datar: datar berarti "dipastikan tidak ada belanja", padahal '
  'yang benar "belum ada catatannya". SECURITY INVOKER.';

-- ===========================================================================
-- §11. Pemeriksa integritas + gerbang produksi
--
-- Harus nol baris. Dua kelas pelanggaran yang TIDAK bisa dilihat health check
-- mana pun yang sudah ada, dan keduanya hanya bisa lahir dari drift (trigger
-- di-DROP, migrasi setengah jalan, tambalan data lewat superuser):
--
--   (1) penugasan melewati volume baris RAB -- orang disuruh membelanjakan
--       lebih dari yang disetujui;
--   (2) penugasan ke orang yang tidak punya akses ke entitas RAB-nya --
--       tugas yang tak akan pernah terlihat oleh penerimanya.
--
-- Dipasang ke check_production_readiness() sebagai BLOCKING, mengikuti
-- pelajaran 0064: app.check_budget_derived_volume() sempat ada sejak 0062 dan
-- tidak pernah dipanggil di lingkungan mana pun, sehingga ia belum pernah
-- melihat satu pun RAB nyata. Fungsi pemeriksa yang tidak dipanggil bukan
-- pemeriksa, ia dokumentasi yang kebetulan bisa dieksekusi.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.check_budget_assignment_integrity()
RETURNS TABLE (masalah text, assignment_id uuid, plan_code text, detail text)
LANGUAGE sql STABLE AS $$
  SELECT 'penugasan melebihi volume baris RAB',
         NULL::uuid,
         p.code,
         i.description || ': volume baris ' || trim_scale(i.volume)
           || ', ditugaskan ' || trim_scale(s.total)
    FROM app.budget_plan_items i
    JOIN app.budget_plans p ON p.id = i.plan_id
    JOIN LATERAL (
      SELECT SUM(b.volume) AS total
        FROM app.budget_assignments b
       WHERE b.plan_item_id = i.id AND b.status <> 'cancelled'
    ) s ON s.total IS NOT NULL
   WHERE s.total > i.volume
  UNION ALL
  SELECT 'penerima tugas tidak punya akses ke entitas RAB',
         b.id,
         p.code,
         COALESCE(u.full_name, b.assignee_user_id::text)
    FROM app.budget_assignments b
    JOIN app.budget_plans p ON p.id = b.plan_id
    LEFT JOIN app.users u ON u.id = b.assignee_user_id
   WHERE NOT EXISTS (SELECT 1 FROM app.user_company_access uca
                      WHERE uca.user_id = b.assignee_user_id
                        AND uca.company_id = b.company_id)
$$;

GRANT EXECUTE ON FUNCTION app.check_budget_assignment_integrity() TO app_rw, app_ro;

COMMENT ON FUNCTION app.check_budget_assignment_integrity IS
  'Health check penugasan RAB: harus nol baris. Baris pertama berarti seseorang '
  'disuruh membelanjakan lebih dari yang disetujui; yang kedua berarti ada tugas '
  'yang tak akan pernah terlihat oleh penerimanya.';

-- Seluruh cabang lama dipertahankan apa adanya (0064); hanya satu UNION ALL baru.
CREATE OR REPLACE FUNCTION app.check_production_readiness()
 RETURNS TABLE(item text, blocking boolean, detail text)
 LANGUAGE sql
 STABLE
AS $function$

  -- Login tanpa verifikasi kredensial masih dinyalakan di database ini.
  SELECT 'login stub masih aktif'::text, true,
         'app.auth_settings.stub_login_enabled = true; login tidak memverifikasi kredensial'::text
    FROM app.auth_settings s
   WHERE s.singleton AND s.stub_login_enabled
  UNION ALL
  -- Fungsi stub pra-B-27 muncul kembali.
  SELECT 'fungsi login stub warisan masih ada'::text, true,
         'app.lookup_login_email seharusnya dihapus migrasi 0057'::text
   WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'app' AND p.proname = 'lookup_login_email')
  UNION ALL
  -- Lubang RLS.
  SELECT 'cakupan RLS bocor', true, table_name || ': ' || issue
    FROM app.check_rls_coverage()
  UNION ALL
  -- Pencabutan hak yang tidak berlaku.
  SELECT 'pencabutan hak bocor', true, table_name || '.' || privilege
    FROM app.check_privilege_revocations()
  UNION ALL
  -- Koefisien karbon belum divalidasi ahli.
  SELECT 'koefisien alometrik belum divalidasi', false,
         COALESCE(crop_id::text, '(global)') || ' versi ' || version
    FROM app.allometric_coefficients WHERE requires_validation
  UNION ALL
  -- Emission factor tanpa provenance yang jelas.
  SELECT 'emission factor tanpa sitasi', false, code || ' v' || version
    FROM app.emission_factors WHERE source_citation IS NULL
  UNION ALL
  -- Periode fiskal belum didefinisikan -> budget tidak bisa dibandingkan.
  SELECT 'periode fiskal belum didefinisikan', false,
         'app.fiscal_periods kosong; keputusan #6 butuh nama & rentang fase dari klien'
   WHERE NOT EXISTS (SELECT 1 FROM app.fiscal_periods)
  UNION ALL
  -- Volume turunan menyimpang dari asumsinya (0062, dipasang ke gerbang oleh 0064).
  SELECT 'volume turunan RAB menyimpang dari asumsi', true,
         plan_code || ' / ' || description
    FROM app.check_budget_derived_volume()

  UNION ALL
  -- Penugasan RAB yang melewati pagunya atau salah alamat (0066 §11).
  -- Blocking: yang pertama berarti seseorang disuruh membelanjakan lebih dari
  -- yang disetujui finance; yang kedua berarti perintah kerja yang tak pernah
  -- sampai ke orangnya, sementara jatah anggarannya sudah terpakai.
  SELECT 'penugasan RAB melanggar integritas', true,
         masalah || ' — ' || plan_code || ' / ' || detail
    FROM app.check_budget_assignment_integrity()
$function$;

-- ===========================================================================
-- §12. Gagalkan migrasi bila kesehatan atau BENTUK policy-nya bocor
--      (pola 0053/0054/0056/0060/0065)
--
-- Pemeriksaan bentuk ada karena app.check_rls_coverage() hanya memeriksa "RLS
-- aktif + ada policy" -- bukan cakupan per-perintah, bukan ada-tidaknya WITH
-- CHECK, dan bukan apakah USING dan WITH CHECK berbunyi sama. Kelas lubang
-- itulah yang lolos dari 0060 sampai audit 31 Agu (lihat kepala 0064/0065).
-- ===========================================================================
DO $$
DECLARE n integer; r record;
BEGIN
  -- Gerbang tulis WAJIB per perintah: FOR ALL akan menyembunyikan penugasan
  -- dari SELECT orang yang tidak boleh menulisnya -- termasuk penerimanya.
  FOR r IN SELECT policyname, cmd, permissive, qual, with_check
             FROM pg_policies
            WHERE schemaname = 'app' AND tablename = 'budget_assignments'
              AND policyname IN ('bas_write_insert', 'bas_write_update', 'bas_write_delete')
  LOOP
    IF r.permissive <> 'RESTRICTIVE' THEN
      RAISE EXCEPTION '% bukan RESTRICTIVE (%)', r.policyname, r.permissive;
    END IF;
    IF r.cmd = 'ALL' THEN
      RAISE EXCEPTION '% dipasang FOR ALL: klausa USING-nya akan ikut menyaring SELECT', r.policyname;
    END IF;
  END LOOP;

  -- IF NOT FOUND lebih dulu: tanpa itu seluruh pemeriksaan di bawah menjadi
  -- NULL saat policy-nya tidak ada, dan NULL bukan true -- gerbang yang lolos
  -- justru karena yang digerbang lenyap (pelajaran 0065 §3).
  SELECT cmd, permissive, qual, with_check INTO r
    FROM pg_policies
   WHERE schemaname = 'app' AND tablename = 'budget_assignments'
     AND policyname = 'bas_write_update';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bas_write_update tidak ada setelah 0066';
  END IF;
  IF r.cmd <> 'UPDATE' THEN
    RAISE EXCEPTION 'bas_write_update bukan FOR UPDATE (%)', r.cmd;
  END IF;
  IF r.with_check IS NULL THEN
    RAISE EXCEPTION 'bas_write_update tanpa WITH CHECK: penugasan bisa dipindahkan ke keadaan terlarang';
  END IF;
  IF r.qual IS DISTINCT FROM r.with_check THEN
    RAISE EXCEPTION 'USING dan WITH CHECK bas_write_update tidak berbunyi sama: % vs %', r.qual, r.with_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'app' AND tablename = 'budget_assignments'
                    AND policyname = 'budget_assignments_creator_own_select'
                    AND cmd = 'SELECT' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'penyempitan SELECT per-penerima hilang: creator melihat penugasan orang lain';
  END IF;

  -- Pagu volume HARUS security definer, kalau tidak jumlahnya menyusut
  -- mengikuti penglihatan pemanggilnya (§6). budget_assignment_owner() sama:
  -- tanpa itu, penolakan "bukan penugasan Anda" berbohong jadi "tidak
  -- ditemukan" (§8). Keduanya WAJIB juga mengunci search_path -- SECURITY
  -- DEFINER tanpa search_path tetap bisa dibelokkan lewat skema pemanggil.
  FOR r IN SELECT p.proname, p.prosecdef,
                  COALESCE(array_to_string(p.proconfig, ','), '') AS konfigurasi
             FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'app'
              AND p.proname IN ('budget_assignment_assigned_volume', 'budget_assignment_owner')
  LOOP
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'app.%() bukan SECURITY DEFINER: gerbangnya bisa dilewati lewat penyempitan RLS', r.proname;
    END IF;
    IF r.konfigurasi NOT LIKE '%search_path%' THEN
      RAISE EXCEPTION 'app.%() SECURITY DEFINER tanpa search_path terkunci', r.proname;
    END IF;
  END LOOP;

  -- Sebaliknya, fungsi pembaca WAJIB invoker: kalau tidak, ia membocorkan
  -- angka lintas tenant ke layar.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'app'
                AND p.proname IN ('budget_absorption', 'budget_s_curve')
                AND p.prosecdef) THEN
    RAISE EXCEPTION 'budget_absorption/budget_s_curve tidak boleh SECURITY DEFINER';
  END IF;

  -- Penugasan yang sudah punya realisasi tidak boleh terhapus: itu FK, dan FK
  -- itu harus benar-benar menahan (RESTRICT/NO ACTION), bukan CASCADE/SET NULL.
  SELECT confdeltype INTO r
    FROM pg_constraint WHERE conname = 'ct_assignment_same_company';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ct_assignment_same_company tidak ada setelah 0066';
  END IF;
  IF r.confdeltype NOT IN ('r', 'a') THEN
    RAISE EXCEPTION 'ct_assignment_same_company ber-ON DELETE % : penugasan berealisasi bisa terhapus', r.confdeltype;
  END IF;

  -- start_date tidak boleh punya default. Nilai bawaan apa pun di kolom ini
  -- adalah jadwal yang tidak pernah ditetapkan siapa pun (§3).
  IF EXISTS (SELECT 1 FROM pg_attrdef d
               JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
              WHERE d.adrelid = 'app.budget_plans'::regclass AND a.attname = 'start_date') THEN
    RAISE EXCEPTION 'budget_plans.start_date punya DEFAULT: titik nol kurva tidak boleh dikarang';
  END IF;

  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0066', n; END IF;

  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0066', n; END IF;

  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_audit_coverage() mengembalikan % baris setelah 0066', n; END IF;

  SELECT count(*) INTO n FROM app.check_creator_scope_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_creator_scope_coverage() mengembalikan % baris setelah 0066', n; END IF;

  SELECT count(*) INTO n FROM app.check_budget_source_scope();
  IF n > 0 THEN RAISE EXCEPTION 'check_budget_source_scope() mengembalikan % baris setelah 0066', n; END IF;

  SELECT count(*) INTO n FROM app.check_budget_assignment_integrity();
  IF n > 0 THEN RAISE EXCEPTION 'check_budget_assignment_integrity() mengembalikan % baris setelah 0066', n; END IF;
END $$;
