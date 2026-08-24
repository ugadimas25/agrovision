-- AI-28 · penjaga penonaktifan & penghapusan pengguna.
--
-- Halaman /pengguna mendapat aksi per baris (nonaktifkan / aktifkan kembali /
-- hapus). Dua di antaranya bisa MEMATIKAN AKSES SELURUH ENTITAS, jadi penjaganya
-- ditaruh di database, bukan hanya di Server Action:
--
--   1. Menonaktifkan super_admin terakhir yang masih aktif membuat tidak ada lagi
--      yang bisa mengelola pengguna -- termasuk mengaktifkannya kembali. Itu
--      kunci-diri yang hanya bisa dipulihkan lewat akses SQL langsung ke
--      produksi.
--   2. Menghapus pengguna yang punya riwayat akan memutus jejak audit. 59 dari 61
--      foreign key ke app.users memakai NO ACTION, jadi databasenya sudah
--      menolak -- tapi pesannya berupa galat FK mentah yang tidak menjelaskan
--      apa pun kepada pengguna.
--
-- Kenapa trigger dan bukan hanya cek di TypeScript: Server Action bisa dipanggil
-- POST langsung, dan aturan "jangan sampai nol super_admin" adalah invarian
-- data, bukan aturan tampilan. Lapisan TypeScript tetap memeriksa lebih dulu
-- supaya pesannya enak dibaca (defense-in-depth, bukan pengganti).

CREATE OR REPLACE FUNCTION app.guard_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sisa integer;
BEGIN
  -- Superuser DIKECUALIKAN dengan sengaja. Penjaga ini melindungi APLIKASI dari
  -- mengunci dirinya sendiri; DBA dengan akses SQL langsung justru satu-satunya
  -- jalur pemulihan bila itu sampai terjadi, dan menghalanginya berarti
  -- menghalangi perbaikannya. Superuser memang di luar batas keamanan di proyek
  -- ini (aplikasi konek sebagai app_user, bukan postgres) -- lihat CLAUDE.md.
  -- Konsekuensi praktis: pembersihan fixture massal di db/verify-adversarial.mjs
  -- (yang memakai koneksi superuser) tetap bisa jalan, sementara uji adversarial
  -- yang menyerang lewat koneksi app_user tetap ditolak.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- Hanya peduli pada transisi yang MENGURANGI jumlah super_admin aktif.
  IF TG_OP = 'UPDATE'
     AND NOT (OLD.is_active AND OLD.app_role = 'super_admin'
              AND (NEW.is_active IS DISTINCT FROM TRUE OR NEW.app_role IS DISTINCT FROM 'super_admin'))
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND NOT (OLD.is_active AND OLD.app_role = 'super_admin') THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO sisa
    FROM app.users
   WHERE company_id = OLD.company_id
     AND app_role = 'super_admin'
     AND is_active
     AND id <> OLD.id;

  IF sisa = 0 THEN
    RAISE EXCEPTION
      'super_admin aktif terakhir pada entitas ini tidak boleh dinonaktifkan atau dihapus: tidak akan ada lagi yang bisa mengelola pengguna'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.guard_last_super_admin() IS
  'AI-28: mencegah entitas kehilangan super_admin aktif terakhirnya (kunci-diri).';

DROP TRIGGER IF EXISTS users_guard_last_super_admin ON app.users;
CREATE TRIGGER users_guard_last_super_admin
  BEFORE UPDATE OR DELETE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.guard_last_super_admin();
