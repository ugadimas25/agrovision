-- 0057_identity_platform_login.sql
-- B-27: login stub masih aktif.
--
-- app.lookup_login_email() (0021) memetakan email -> external_id tanpa
-- verifikasi kredensial apa pun. Siapa pun yang tahu sebuah email terdaftar
-- bisa masuk sebagai orang itu, termasuk sebagai super_admin. Sejak 0021
-- app.check_production_readiness() menandainya blocking, dan penandanya adalah
-- KEBERADAAN fungsi itu -- artinya selama fungsinya ada, gerbang produksi tidak
-- pernah bisa hijau, dan begitu fungsinya dihapus pengembangan lokal mati.
--
-- Migrasi ini memisahkan kedua hal itu:
--
--   1. Alur produksi tidak lagi butuh pencarian by email sama sekali.
--      src/lib/auth/identity-platform.ts memverifikasi ID token Identity
--      Platform (tanda tangan RS256 terhadap kunci publik Google, iss, aud,
--      exp/iat) lalu menyerahkan klaim `sub` ke app.resolve_session() --
--      pintu SECURITY DEFINER yang sudah ada sejak 0018 dan tidak berubah.
--
--   2. Login stub tetap ada untuk pengembangan, tapi kini BERGERBANG DATA:
--      app.auth_settings.stub_login_enabled. Default false. Fungsi stubnya
--      melempar exception saat saklar itu mati, dan gerbang kesiapan produksi
--      membaca saklarnya -- bukan lagi keberadaan fungsi.
--
-- Tiga gerbang berlapis, semuanya harus terbuka agar login tanpa kata sandi
-- bisa terjadi:
--      env AUTH_MODE=stub  ·  NODE_ENV != production  ·  saklar DB ini
-- Dua yang pertama ada di src/lib/auth/config.ts. Yang ketiga ada di sini,
-- karena database adalah batas keamanan yang otoritatif: kalau seseorang salah
-- memasang env di Cloud Run, database tetap menolak.
--
-- Saklarnya sengaja DATA, bukan keberadaan objek: satu baris yang bisa dibaca
-- gerbang produksi, dilihat di health check, dan diubah HANYA superuser
-- (seed dev/demo) -- bukan oleh aplikasi.

-- ===========================================================================
-- §1. Saklar mode login
-- ===========================================================================

CREATE TABLE app.auth_settings (
  -- Baris tunggal: PK konstan + CHECK membuat baris kedua mustahil, jadi
  -- pembacaan "SELECT ... FROM app.auth_settings" tidak pernah ambigu.
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  stub_login_enabled boolean NOT NULL DEFAULT false,
  note               text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app.auth_settings (singleton, stub_login_enabled, note)
VALUES (true, false, 'default: hanya verifikasi ID token Identity Platform');

COMMENT ON TABLE app.auth_settings IS
  'Saklar mode login, satu baris. Diubah HANYA lewat koneksi superuser '
  '(db/seed-dev.mjs, db/seed-demo.mjs, atau UPDATE manual di lingkungan '
  'pengembangan). Aplikasi (app_rw) hanya boleh membacanya -- lihat ledger '
  'app.privilege_revocations.';

COMMENT ON COLUMN app.auth_settings.stub_login_enabled IS
  'true = app.lookup_login_stub() boleh dipakai, yaitu login TANPA verifikasi '
  'kredensial. WAJIB false di produksi; app.check_production_readiness() '
  'melaporkannya sebagai blocking selama true.';

GRANT SELECT ON app.auth_settings TO app_rw, app_ro;

-- Aplikasi tidak boleh membalik saklarnya sendiri. Tanpa pencabutan ini, satu
-- SQL injection atau satu Server Action yang lalai cukup untuk menyalakan login
-- tanpa kata sandi di produksi.
REVOKE INSERT, UPDATE, DELETE ON app.auth_settings FROM app_rw;

-- Didaftarkan di ledger supaya db/bootstrap-role.mjs mencabutnya ULANG setelah
-- `GRANT ... ON ALL TABLES` -- persis jebakan yang 0019 tutup.
INSERT INTO app.privilege_revocations (table_name, privileges, reason) VALUES
  ('auth_settings', 'INSERT, UPDATE, DELETE',
   'saklar mode login; menyalakan login stub bukan wewenang aplikasi (B-27)')
ON CONFLICT (table_name, privileges) DO NOTHING;

-- Tabel global (bukan data tenant), jadi wajib terdaftar exempt -- kalau tidak,
-- app.check_rls_coverage() akan melaporkannya sebagai lubang.
INSERT INTO app.rls_exempt_tables (table_name, reason) VALUES
  ('auth_settings', 'saklar mode login global, bukan data tenant; read-only bagi aplikasi')
ON CONFLICT (table_name) DO NOTHING;

-- ===========================================================================
-- §2. Fungsi login stub -- bergerbang, dan namanya menyebut dirinya stub
--
-- 0021 dicatat sebagai "HAPUS fungsi ini begitu login lewat verifikasi ID token
-- terpasang". Dihapus di sini. Penggantinya bukan fungsi produksi: ia hanya
-- hidup ketika saklar §1 menyala, dan namanya tidak bisa disalahbaca sebagai
-- bagian dari alur normal.
-- ===========================================================================

DROP FUNCTION IF EXISTS app.lookup_login_email(text);

CREATE FUNCTION app.lookup_login_stub(p_email text)
RETURNS TABLE (external_id text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
BEGIN
  IF NOT COALESCE((SELECT s.stub_login_enabled FROM app.auth_settings s WHERE s.singleton), false) THEN
    -- 42501 = insufficient_privilege. Dipetakan ke pesan berbahasa Indonesia di
    -- src/lib/actions/auth.ts; jangan diubah tanpa memperbarui pemetaan itu.
    RAISE EXCEPTION 'login stub dimatikan (app.auth_settings.stub_login_enabled = false)'
      USING ERRCODE = '42501';
  END IF;

  -- citext dikualifikasi eksplisit (public.citext) alih-alih menambahkan
  -- `public` ke search_path -- alasan sama seperti 0021: search_path fungsi
  -- SECURITY DEFINER harus sesempit mungkin.
  RETURN QUERY
    SELECT u.external_id, u.id
      FROM app.users u
     WHERE u.email = p_email::public.citext AND u.is_active;
END $$;

REVOKE ALL ON FUNCTION app.lookup_login_stub(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_login_stub(text) TO app_rw;

COMMENT ON FUNCTION app.lookup_login_stub IS
  'HANYA untuk pengembangan: memetakan email -> external_id TANPA verifikasi '
  'kredensial. Melempar 42501 kecuali app.auth_settings.stub_login_enabled = true. '
  'Alur produksi tidak memanggilnya sama sekali -- external_id di sana berasal '
  'dari klaim `sub` ID token Identity Platform yang sudah diverifikasi '
  '(src/lib/auth/identity-platform.ts), lalu langsung ke app.resolve_session().';

-- ===========================================================================
-- §3. Gerbang kesiapan produksi membaca SAKLAR, bukan keberadaan fungsi
--
-- Klausa "fungsi warisan" tetap dipertahankan: kalau suatu hari
-- app.lookup_login_email muncul lagi (restore dump lama, tangan iseng), gerbang
-- ini harus tetap merah.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.check_production_readiness()
RETURNS TABLE (item text, blocking boolean, detail text)
LANGUAGE sql STABLE AS $$
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
$$;

GRANT EXECUTE ON FUNCTION app.check_production_readiness() TO app_rw, app_ro;

COMMENT ON FUNCTION app.check_production_readiness IS
  'Baris dengan blocking = true harus nol sebelum deploy publik.';

-- ===========================================================================
-- §4. Gagalkan migrasi bila gerbangnya sendiri tidak terpasang
--
-- ALTER DEFAULT PRIVILEGES dari db/bootstrap-role.mjs memberi app_rw hak tulis
-- pada SETIAP tabel baru di schema app -- termasuk auth_settings, beberapa
-- milidetik yang lalu. REVOKE di §1 yang membatalkannya. Kalau urutan itu
-- pernah tergeser, migrasi ini harus mati di sini, bukan lolos diam-diam.
-- ===========================================================================

DO $$
DECLARE
  n integer;
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    IF has_table_privilege('app_rw', 'app.auth_settings', p) THEN
      RAISE EXCEPTION 'app_rw masih punya % pada app.auth_settings', p;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('app_rw', 'app.auth_settings', 'SELECT') THEN
    RAISE EXCEPTION 'app_rw tidak bisa membaca app.auth_settings -- login akan mati total';
  END IF;

  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0057', n;
  END IF;

  SELECT count(*) INTO n FROM app.check_production_readiness() WHERE blocking;
  IF n > 0 THEN
    -- Database yang baru dimigrasi (belum diseed) HARUS bersih. Kalau tidak,
    -- gerbang produksi tidak pernah bisa hijau dan B-27 tidak selesai.
    RAISE WARNING 'masih ada % penghalang produksi setelah 0057 -- jalankan npm run db:check', n;
  END IF;
END $$;
