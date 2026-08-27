-- 0059_agronomist_readonly.sql
-- Menutup lubang yang dibuka 0058.
--
-- Policy `*_viewer_readonly` (0018 §9) berbunyi:
--
--     WITH CHECK (COALESCE(app.current_role_name(), 'viewer') <> 'viewer')
--
-- yaitu "siapa pun KECUALI viewer boleh menulis". Daftar yang dilarang, bukan
-- daftar yang diizinkan -- sehingga setiap role baru otomatis mendapat hak
-- tulis ke seluruh tabel operasional pada detik ia ditambahkan ke enum. Untuk
-- `agronomist` itu salah: ia menyusun RENCANA, bukan mencatat realisasi. Tanpa
-- migrasi ini, agronomis bisa mencatat panen, mengubah blok, dan menulis
-- master data.
--
-- Diperbaiki dengan memindahkan aturannya ke satu fungsi. Role berikutnya cukup
-- mengubah satu tempat, bukan berburu policy di belasan tabel -- pelajaran yang
-- sama dengan ledger app.privilege_revocations (0019): daftar yang hidup di
-- banyak tempat pasti menyimpang.

CREATE OR REPLACE FUNCTION app.role_may_write_records()
RETURNS boolean
LANGUAGE sql STABLE AS $$
  -- Daftar yang DIIZINKAN, bukan yang dilarang. Role baru default-nya tidak
  -- boleh menulis sampai ditambahkan di sini secara sadar.
  SELECT COALESCE(app.current_role_name(), 'viewer') IN ('creator', 'approver', 'super_admin')
$$;

COMMENT ON FUNCTION app.role_may_write_records IS
  'Gerbang tulis untuk tabel operasional, dipakai seluruh policy *_viewer_readonly. '
  'Daftar putih: creator, approver, super_admin. viewer dan agronomist hanya membaca '
  '-- agronomist menulis di RAB (app.budget_plans), bukan di realisasi lapangan.';

GRANT EXECUTE ON FUNCTION app.role_may_write_records() TO app_rw, app_ro;

-- Terapkan ke SEMUA policy yang sudah ada, dibaca dari katalog -- bukan dari
-- daftar tabel yang ditulis tangan. Daftar tangan di 0018 sudah tertinggal dua
-- kali (0034 menambah tabel aktivitas kebun, 0042 menambah seed_distributions);
-- membacanya dari pg_policies membuat migrasi ini mustahil ketinggalan.
DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'app' AND policyname LIKE '%\_viewer\_readonly'
  LOOP
    EXECUTE format('ALTER POLICY %I ON app.%I WITH CHECK (app.role_may_write_records())',
                   r.policyname, r.tablename);
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE EXCEPTION 'tidak ada policy *_viewer_readonly yang ditemukan -- 0018 §9 hilang?';
  END IF;
  RAISE NOTICE '% policy viewer_readonly dialihkan ke app.role_may_write_records()', n;
END $$;

-- ===========================================================================
-- Pemeriksa: role yang TIDAK boleh menulis tidak boleh punya jalan masuk lain.
--
-- decide_record() dan publish_emission_factor() sudah menggerbang diri ke
-- approver/super_admin (0018, 0025), jadi agronomist otomatis tertolak di sana.
-- Yang diperiksa di sini cuma satu: tidak ada policy viewer_readonly yang
-- tertinggal memakai predikat lama.
-- ===========================================================================
DO $$
DECLARE tertinggal integer;
BEGIN
  SELECT count(*) INTO tertinggal
    FROM pg_policies
   WHERE schemaname = 'app' AND policyname LIKE '%\_viewer\_readonly'
     AND with_check NOT LIKE '%role_may_write_records%';
  IF tertinggal > 0 THEN
    RAISE EXCEPTION '% policy viewer_readonly masih memakai predikat lama', tertinggal;
  END IF;
END $$;
