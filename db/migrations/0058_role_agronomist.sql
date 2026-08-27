-- 0058_role_agronomist.sql
-- Rapat Fadli 26 Agustus 2026: yang tahu kebutuhan operasional kebun bukan
-- finance, melainkan AGRONOMIS. Modul Rencana Anggaran (RAB) disusun agronomis,
-- disetujui finance. Finance memakai role `approver` yang sudah ada; agronomis
-- belum punya padanan, jadi ditambahkan di sini.
--
-- BERKAS INI SENGAJA HANYA BERISI SATU PERINTAH.
--
-- db/migrate.mjs membungkus tiap berkas dalam SATU transaksi, dan Postgres
-- melarang nilai enum yang baru ditambahkan DIPAKAI di transaksi yang sama
-- ("unsafe use of new value of enum type"). Jadi penambahan nilainya harus
-- berdiri sendiri; pemakaiannya (policy, seed, kolom) menyusul di migrasi
-- berikutnya yang otomatis berjalan di transaksi berbeda.
--
-- Konsekuensi keamanan yang TIDAK boleh dilewat: policy `*_viewer_readonly`
-- (0018 §9) berbunyi "role apa pun selain viewer boleh menulis". Menambah role
-- baru karena itu diam-diam memberinya hak tulis ke SELURUH tabel operasional.
-- Itu ditutup di 0059 -- migrasi ini saja belum aman ditinggal sendirian.

ALTER TYPE app.app_role ADD VALUE IF NOT EXISTS 'agronomist';

COMMENT ON TYPE app.app_role IS
  'creator = petugas lapangan (mencatat realisasi) · approver = pemutus, '
  'sekaligus finance untuk RAB · super_admin = pengelola · viewer = pembaca · '
  'agronomist = penyusun Rencana Anggaran (RAB), TIDAK mencatat realisasi dan '
  'TIDAK memutus approval (lihat 0059).';
