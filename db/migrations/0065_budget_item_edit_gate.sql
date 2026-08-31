-- ===========================================================================
-- 0065_budget_item_edit_gate.sql
--
-- Lanjutan langsung dari 0064, yang menutup DELETE pada app.budget_plans dan
-- menuliskan apa yang sengaja ditinggalkannya:
--
--     "Yang SENGAJA TIDAK diubah di sini: bpi_edit_update masih membiarkan
--      approver menulis ulang unit_price_idr pada RAB yang sudah disetujui.
--      Itu mengubah logika approval yang disepakati rapat, jadi harus dibahas
--      dulu."
--
-- Sudah dibahas. Rapat 26 Agu menyepakati approver boleh MENAMBAH baris setelah
-- RAB disetujui (mis. menyewa ahli hidrologi). Kesepakatan itu tidak pernah
-- berbunyi "approver boleh mengubah baris yang sudah disetujui". Migrasi ini
-- menutup selisih antara keduanya, dan hanya selisih itu.
--
-- LUBANGNYA. bpi_edit_update (0060:237) berbunyi:
--     AS RESTRICTIVE FOR UPDATE
--     USING (app.current_role_name() IN ('approver','super_admin')
--            OR EXISTS (... penyusun, draft/rejected ...));
-- Cabang pertama tidak menyebut status sama sekali, dan policy-nya tidak punya
-- WITH CHECK. bpi_edit_delete (0060:247) berbentuk sama.
--
-- Dibuktikan pada dataset demo (DB lokal, koneksi app_user, seluruhnya
-- di-ROLLBACK) atas RAB-2026-01 sesudah approver menyetujuinya:
--     11 baris, Rp 2.185.200.000
--     UPDATE ... SET unit_price_idr = unit_price_idr * 2.5
--        -> 11 baris terubah, total menjadi Rp 5.463.000.000
--        -> approval_status tetap 'approved', decided_at tidak bergerak,
--           added_after_approval tetap false pada 11 dari 11 baris
--     UPDATE ... SET is_active = false  -> 11 baris (seluruh total jadi nol)
--     DELETE ...                        -> 11 baris terhapus
-- Persis sama berhasilnya sebagai super_admin. Tidak ada satu pun galat: RAB
-- yang disetujui finance senilai 2,1 miliar menjadi 5,4 miliar tanpa keputusan
-- baru, dan layar tetap menyebutnya "disetujui" oleh orang yang sama pada
-- tanggal yang sama.
--
-- amount_idr adalah GENERATED (0060:104), jadi harga satuan yang bergeser
-- langsung menggeser total tanpa perlu menyentuh kolom lain. is_active (0061)
-- ikut terkena UPDATE dan sama beratnya: mencoret baris mengeluarkan angkanya
-- dari seluruh total, hanya lewat kolom boolean alih-alih kolom rupiah.
--
-- Doktrin 0062 berlaku di sini tanpa perubahan satu kata pun: persetujuan atas
-- angka yang kemudian berubah sendiri bukan persetujuan. 0062 sudah
-- menerapkannya pada ASUMSI; baris RAB -- tempat angkanya benar-benar tinggal
-- -- justru terlewat.
--
-- ATURAN SETELAH MIGRASI INI (baris RAB, perintah UPDATE dan DELETE):
--
--   status RAB   | penyusun (created_by RAB) | approver / super_admin
--   -------------+---------------------------+------------------------------
--   draft        | boleh                     | boleh
--   rejected     | boleh                     | boleh
--   submitted    | TIDAK                     | TIDAK
--   under_review | TIDAK                     | TIDAK
--   approved     | TIDAK                     | hanya baris dengan
--                |                           | added_after_approval = true
--   cancelled    | TIDAK                     | TIDAK
--
-- Peran lain (creator, viewer) tidak muncul di tabel itu karena sudah ditolak
-- lebih dulu: bpi_writer_roles (0060:190) untuk UPDATE, dan pada DELETE kedua
-- cabang predikat di bawah tidak pernah benar bagi mereka.
--
-- INSERT TIDAK diubah sama sekali (bpi_edit_insert, 0060:227): approver tetap
-- bisa menambah baris ke RAB yang sudah disetujui. Justru itu yang membuat
-- pembatasan di atas bisa ditegakkan tanpa menghalangi kerja finance --
-- kebutuhan "tambah ahli hidrologi" punya jalannya sendiri, dan jalan itu
-- meninggalkan penanda added_after_approval = true yang terbaca di layar,
-- alih-alih menaikkan diam-diam angka baris yang sudah diputuskan.
--
-- DUA PILIHAN di bawah ini bukan turunan langsung dari kalimat rapat, jadi
-- ditulis terbuka supaya bisa dibantah:
--
-- 1. Pada draft/rejected, approver dan super_admin tetap boleh menyunting --
--    bukan hanya penyusunnya. Selain mempertahankan perilaku hari ini, ini
--    keharusan teknis: ba_edit_update (0062) memakai daftar yang sama persis,
--    dan app.budget_assumption_cascade() (0062:137) meng-UPDATE
--    budget_plan_items dari trigger pada asumsi. Bila daftar di sini lebih
--    sempit, approver yang mengubah asumsi pada draft orang lain akan berhasil
--    mengubah asumsinya tetapi menggerakkan NOL baris turunannya -- RAB yang
--    setengah berubah, tepat yang diperingatkan kepala 0062, dan
--    app.check_budget_derived_volume() (dipasang ke gerbang produksi oleh 0064)
--    akan menandainya blocking sesudahnya.
--
-- 2. Pada RAB yang sudah disetujui, baris added_after_approval = true boleh
--    disunting oleh peran approver/super_admin, bukan hanya oleh orang yang
--    menambahkannya. Yang menandai sebuah baris "bukan bagian dari yang
--    disetujui" adalah kolomnya, bukan identitas penulisnya; finance adalah
--    fungsi, bukan satu orang. super_admin ikut karena bpi_edit_insert juga
--    mengizinkannya menambah baris setelah persetujuan -- peran yang boleh
--    membuat baris tetapi tidak boleh memperbaiki ketikannya sendiri adalah
--    asimetri tanpa alasan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §1. Satu predikat, dipanggil tiga kali
--
-- USING dan WITH CHECK pada bpi_edit_update HARUS berbunyi sama. USING menguji
-- baris LAMA, WITH CHECK menguji baris BARU, dan syarat yang hanya dipasang di
-- salah satunya bukan syarat: barisnya tinggal DIPINDAHKAN ke keadaan yang
-- dilarang. Dua pemindahan yang nyata di tabel ini, keduanya ditutup WITH CHECK
-- dan tidak satu pun tertutup oleh USING:
--   (a) approver menyunting baris tambahannya sendiri sambil menyetel
--       added_after_approval = false -- barisnya melebur ke dalam angka yang
--       sudah disetujui, dan sesudah itu beku bagi semua orang termasuk dirinya;
--   (b) approver memindahkan baris ke plan_id lain (RAB yang diajukan orang
--       lain, misalnya) -- angka berpindah dokumen tanpa keputusan apa pun.
--
-- Karena harus sama persis, predikatnya ditulis SEKALI sebagai fungsi lalu
-- dipanggil tiga kali; menyalinnya bertiga hanya menunda hari saat salah satu
-- salinan diperbaiki dan dua lainnya tidak. Pola yang sama dengan
-- app.role_may_write_budget_plan() (0060) dan app.role_may_write_records()
-- (0059). SECURITY INVOKER (bawaan, disengaja): subquery ke budget_plans tetap
-- tunduk pada RLS tabel itu, persis seperti EXISTS yang ditulis inline di 0060.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.may_edit_budget_item(
  p_plan_id              uuid,
  p_added_after_approval boolean
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.budget_plans p
     WHERE p.id = p_plan_id
       AND (
         -- Belum diputuskan: penyusunnya sendiri, atau peran pemutus.
         (p.approval_status IN ('draft', 'rejected')
          AND (p.created_by = app.current_user_id()
               OR app.current_role_name() IN ('approver', 'super_admin')))

         -- Sudah disetujui: HANYA baris yang ditambahkan setelah persetujuan,
         -- dan hanya oleh peran yang memang boleh menambahkannya. Baris yang
         -- ikut disetujui tidak punya cabang mana pun di sini -- beku bagi
         -- semua peran, super_admin termasuk.
         OR (p.approval_status = 'approved'
             AND COALESCE(p_added_after_approval, false)
             AND app.current_role_name() IN ('approver', 'super_admin'))

         -- 'submitted', 'under_review', dan 'cancelled' sengaja tidak punya
         -- cabang: RAB yang sedang ditimbang tidak boleh berubah di bawah
         -- tangan orang yang menimbangnya, dan yang dibatalkan sudah selesai.
       )
  )
$$;

GRANT EXECUTE ON FUNCTION app.may_edit_budget_item(uuid, boolean) TO app_rw, app_ro;

COMMENT ON FUNCTION app.may_edit_budget_item(uuid, boolean) IS
  'Boleh-tidaknya satu baris RAB disunting/dihapus oleh sesi saat ini. '
  'Dipanggil bpi_edit_update (USING dan WITH CHECK) serta bpi_edit_delete, '
  'supaya ketiganya tidak mungkin berbeda bunyi. Argumen kedua diisi kolom '
  'added_after_approval baris yang bersangkutan -- baris lama pada USING, baris '
  'baru pada WITH CHECK.';

-- ---------------------------------------------------------------------------
-- §2. Gerbang UPDATE dan DELETE
--
-- Tetap DIPECAH PER PERINTAH, dan itu bukan gaya penulisan. RESTRICTIVE FOR ALL
-- membuat klausa USING-nya ikut menyaring SELECT: begitu RAB disetujui, baris
-- yang beku akan HILANG dari layar semua orang alih-alih sekadar tak bisa
-- disunting. Repo ini pernah tepat begitu -- 0018 §5 memasang
-- report_builtin_protect sebagai RESTRICTIVE FOR ALL dan menyembunyikan tiga
-- laporan bawaan dari semua orang, lalu 0020 memecahnya per perintah. 0060
-- sudah mencatat pelajaran itu di tempat ini; migrasi ini tidak membatalkannya.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS bpi_edit_update ON app.budget_plan_items;
CREATE POLICY bpi_edit_update ON app.budget_plan_items
  AS RESTRICTIVE FOR UPDATE
  USING      (app.may_edit_budget_item(plan_id, added_after_approval))
  WITH CHECK (app.may_edit_budget_item(plan_id, added_after_approval));

DROP POLICY IF EXISTS bpi_edit_delete ON app.budget_plan_items;
CREATE POLICY bpi_edit_delete ON app.budget_plan_items
  AS RESTRICTIVE FOR DELETE
  USING (app.may_edit_budget_item(plan_id, added_after_approval));

COMMENT ON POLICY bpi_edit_update ON app.budget_plan_items IS
  'Baris RAB yang sudah disetujui beku untuk semua peran, termasuk super_admin; '
  'approver hanya boleh menyunting baris yang ia tambahkan setelah persetujuan '
  '(added_after_approval). WITH CHECK berbunyi sama dengan USING supaya baris '
  'tidak bisa dipindahkan ke keadaan terlarang -- termasuk menyetel ulang '
  'added_after_approval menjadi false. Mencoret baris (is_active) tunduk aturan '
  'yang sama: ia mengubah total, hanya lewat kolom boolean.';

COMMENT ON POLICY bpi_edit_delete ON app.budget_plan_items IS
  'Cermin bpi_edit_update untuk DELETE: menghapus baris RAB yang sudah disetujui '
  'sama saja dengan menyetel nilainya jadi nol, jadi gerbangnya harus sama.';

-- ---------------------------------------------------------------------------
-- §3. Gagalkan migrasi bila kesehatan atau bentuk policy-nya bocor
--     (pola 0053/0054/0056/0060)
--
-- Dua pemeriksaan pertama menjaga hal yang tidak dilihat health check mana pun:
-- app.check_rls_coverage() memeriksa "RLS aktif + ada policy", bukan cakupan
-- per-perintah maupun ada-tidaknya WITH CHECK. Kelas lubang inilah yang lolos
-- dari 0060 sampai audit 31 Agu -- lihat kepala 0064.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer; r record;
BEGIN
  SELECT cmd, permissive, qual, with_check INTO r
    FROM pg_policies
   WHERE schemaname = 'app' AND tablename = 'budget_plan_items'
     AND policyname = 'bpi_edit_update';
  -- IF NOT FOUND lebih dulu: tanpa itu seluruh pemeriksaan di bawah menjadi
  -- NULL saat policy-nya tidak ada, dan NULL bukan true -- gerbang yang lolos
  -- justru karena yang digerbang lenyap.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bpi_edit_update tidak ada setelah 0065';
  END IF;
  IF r.cmd <> 'UPDATE' OR r.permissive <> 'RESTRICTIVE' THEN
    RAISE EXCEPTION 'bpi_edit_update bukan RESTRICTIVE FOR UPDATE (%, %) -- FOR ALL akan menyembunyikan baris dari SELECT', r.permissive, r.cmd;
  END IF;
  IF r.with_check IS NULL THEN
    RAISE EXCEPTION 'bpi_edit_update tanpa WITH CHECK: baris masih bisa dipindahkan ke keadaan terlarang';
  END IF;
  IF r.qual IS DISTINCT FROM r.with_check THEN
    RAISE EXCEPTION 'USING dan WITH CHECK bpi_edit_update tidak berbunyi sama: % vs %', r.qual, r.with_check;
  END IF;

  SELECT cmd, permissive INTO r
    FROM pg_policies
   WHERE schemaname = 'app' AND tablename = 'budget_plan_items'
     AND policyname = 'bpi_edit_delete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bpi_edit_delete tidak ada setelah 0065';
  END IF;
  IF r.cmd <> 'DELETE' OR r.permissive <> 'RESTRICTIVE' THEN
    RAISE EXCEPTION 'bpi_edit_delete bukan RESTRICTIVE FOR DELETE (%, %)', r.permissive, r.cmd;
  END IF;

  -- Kesepakatan rapat 26 Agu harus tetap hidup: policy INSERT tidak boleh ikut
  -- tersapu migrasi ini.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'app' AND tablename = 'budget_plan_items'
                    AND policyname = 'bpi_edit_insert' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'bpi_edit_insert hilang: approver tidak lagi bisa menambah baris setelah RAB disetujui';
  END IF;

  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0065', n; END IF;

  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0065', n; END IF;

  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_audit_coverage() mengembalikan % baris setelah 0065', n; END IF;
END $$;
