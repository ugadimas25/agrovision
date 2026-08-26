# 16 · Urutan pengerjaan QA — Sprint A, 3 & 3B, plus B-27

| | |
|---|---|
| **Untuk** | Harits Balfas (`haritshb`) |
| **Sumber** | `docs/QA-Manual-AgroVision-SprintA-3-3B-20260826.xlsx` (PR #46) |
| **Ditulis** | 26 Agustus 2026, setelah seluruh Sprint A/3/3B **dan** B-27 mendarat di produksi |
| **Sifat** | Urutan pengerjaan + satu kelompok skenario yang belum ada di sheet. Sheet-nya tetap jadi tempat mengisi hasil |

## Kenapa dokumen ini ada

Sheet berisi **72 skenario, 36 di antaranya Critical**. Label prioritasnya benar
per tiket, tapi tidak diurutkan lintas tiket — dikerjakan dari baris atas ke
bawah, hal yang paling berbahaya justru kebagian paling akhir.

Urutan di bawah disusun bukan dari label, melainkan dari **seberapa senyap
kerusakannya**. RLS yang terlalu sempit tidak memunculkan galat; ia
mengembalikan nol baris, dan itu terbaca sebagai "belum ada data". Kelas itu
yang harus diuji lebih dulu, karena kalau lolos ke demo tidak ada yang sadar.

Kalau waktunya sempit: **Tier 0 + 1 + 2 (± 16 skenario)** menutup hampir seluruh
risiko nyata. Tier 3 dan 4 bisa menyusul.

---

## Tier 0 · Login — BELUM ADA DI SHEET, kerjakan paling awal

Sheet ditulis sebelum **B-27** mendarat (26 Agustus siang). Login berubah total:
**sekarang wajib kata sandi**. Instruksi lama ("cukup ketik email") sudah tidak
berlaku, dan kalau ini tidak diuji duluan, 72 skenario lain terblokir.

- Akun ada di **Identity Platform**; kata sandinya dikirim Dimas terpisah dan
  **tidak pernah ditulis di repo**.
- Alamat `@demo.invalid` tidak bisa menerima email → **tidak ada alur reset
  kata sandi**. Hilang berarti akunnya dibuat ulang; minta ke Dimas.

Salin blok ini ke sheet *Skenario QA* (kolomnya sudah disamakan):

| ID | Menu (grup) | Modul / Layar | Path URL | Role | Skenario | Langkah Uji | Hasil yang Diharapkan | Prioritas |
|---|---|---|---|---|---|---|---|---|
| L-01 | Autentikasi | Login | `/login` | Semua (4 akun) | Login dengan kata sandi yang benar | 1) Buka `/login` 2) Isi email + kata sandi 3) Masuk | Mendarat di Dashboard sesuai perannya. Diulang untuk keempat akun | Critical |
| L-02 | Autentikasi | Login | `/login` | Creator | Kata sandi salah ditolak | Isi email benar + kata sandi asal | Ditolak dengan pesan **"Email atau kata sandi salah."** | Critical |
| L-03 | Autentikasi | Login | `/login` | — | Email tak terdaftar ditolak dengan pesan **yang sama persis** | Isi `bukansiapa@demo.invalid` + kata sandi asal | Pesannya **identik** dengan L-02. Kalau berbeda, itu **bug**: layar jadi bisa dipakai menebak email mana yang terdaftar | Critical |
| L-04 | Autentikasi | Login | `/login` | — | Akun terverifikasi tapi belum ditautkan | Minta Dimas membuat akun Identity Platform tanpa menautkan `external_id`, lalu login | Ditolak dengan pesan yang menyebut **"belum terhubung ke pengguna AgroVision"** — bukan "kata sandi salah" | High |
| L-05 | Autentikasi | Login | `/login` | Semua | Produksi tidak lagi mengumumkan mode pengembangan | Buka `/login`, perhatikan seluruh halaman | **Tidak ada** kotak kuning "Mode pengembangan", dan **ada** kolom Kata sandi | Critical |
| L-06 | Autentikasi | Logout & sesi | `/dashboard` | Creator | Logout benar-benar memutus sesi | 1) Login 2) Logout 3) Tempel URL `/dashboard` langsung | Dialihkan ke `/login`, bukan menampilkan dashboard | High |
| L-07 | Autentikasi | Penonaktifan | `/pengguna` | Super Admin → Creator | Menonaktifkan pengguna langsung berlaku | 1) Creator login di satu peramban 2) Super admin menonaktifkannya 3) Creator memuat ulang halaman | Creator langsung kehilangan akses tanpa perlu logout — sesi diperiksa ulang ke database tiap request | High |

---

## Tier 1 · Kerusakan yang tidak terlihat seperti kerusakan

Kelompok B-23 (lingkup data creator) menyempitkan SELECT lewat RLS. Kalau
terlalu sempit, laporan dan dashboard creator **kosong tanpa galat**.

| ID | Skenario | Kenapa duluan |
|---|---|---|
| **C-04** | Dashboard creator tidak boleh kosong total | Sheet-nya sendiri menandai kelompok ini "RISIKO REGRESI TINGGI" |
| **C-01** | Creator hanya melihat record buatannya sendiri (Penyiangan) | Inti perubahan B-23 |
| **C-02** | Pembatasan konsisten di Penyemprotan | Satu modul benar tidak berarti semuanya benar |
| **C-03** | Pembatasan berlaku juga di Pengeluaran | Modul uang — salah di sini paling mahal |
| **C-08** | Approver TETAP melihat seluruh ajuan perusahaan | Arah sebaliknya: pembatasan tidak boleh kebablasan |
| **C-09** | Lingkup creator tidak merusak isolasi antar entitas | Kebocoran lintas tenant |
| **H-04** | Nilai kosong dirender `—`, bukan `0` | Doktrin kejujuran angka; `0` palsu lebih buruk daripada kosong |

## Tier 2 · Kode paling baru, paling belum disentuh manusia

Dua di antaranya ada di sheet **karena temuan review 26 Agustus**, dan
perbaikannya baru mendarat beberapa jam sebelum QA ini.

| ID | Skenario | Kenapa |
|---|---|---|
| **G-17** | Gagal "Setujui" tidak boleh membuka modal "Tolak" | Temuan review PR #44 — dua approver berebut baris yang sama |
| **F-04** | Creator tetap bisa **mencapai** Inbox lewat ikon Topbar | Temuan review PR #39 — ikonnya sempat disembunyikan, dan itu satu-satunya jalan ke `/approval/riwayat` |
| **B-05** | Inbox default tetap hanya menampilkan yang menunggu | Perilaku lama tidak boleh berubah oleh B-22 |
| **B-06** | Creator hanya melihat riwayat ajuannya sendiri | Lingkup B-23 harus ikut berlaku di riwayat |
| **A-03** | Simpan perbaikan mengembalikan status ke Draft | Inti B-21 |
| **A-05** | Ajukan ulang membawa data **baru** | Kegagalan di sini menyetujui angka lama diam-diam |
| **H-01** | Approver tidak bisa menyetujui ajuannya sendiri | Pemisahan pembuat/pemutus |
| **H-03** | Viewer tidak bisa memutuskan | Sama, dari sisi peran terendah |

## Tier 3 · Menyentuh uang

**D-04** (biaya = volume × tarif, cocok dengan hitungan manual) ·
**D-05** (realisasi anggaran tidak turun setelah field diwajibkan) ·
**G-09** (terbitkan tarif = versi baru, bukan edit di tempat) ·
**G-10** (non-super-admin tidak bisa menerbitkan tarif) ·
**G-08** (label penerbitan tarif jujur) ·
**H-06** (Master Data hanya super admin)

## Tier 4 · Sisanya

Pop-up modal (**G-01–G-07**, **G-11–G-16**), **D-01/D-02/D-03**,
**A-01/A-02/A-09/A-10**, **E-01**, **F-01**, dan sisa kelompok B/C/F.
Tetap dikerjakan — tapi kalau salah, gejalanya langsung kelihatan, bukan diam-diam.

## Penutup

**H-08** — satu alur utuh creator → approver yang menyentuh semua sprint.
Jalankan paling akhir sebagai pembuktian, bukan sebagai pemanasan.

---

## Yang sudah usang di sheet (jangan bingung saat membacanya)

| Tertulis di sheet | Keadaan sebenarnya, 26 Agustus |
|---|---|
| "B-28 — #37 merged, #39 belum" | #39 **sudah** merged & live |
| "POP-UP MODAL & MASTER DATA — PR #40-#44 BELUM merged, cek dulu" | #40–#44 **semuanya** merged & live |
| Instruksi login tanpa kata sandi | Sudah tidak berlaku — lihat Tier 0 |

Kolom **Status** di sheet tetap dipakai seperti biasa: `PASS` / `FAIL` /
`BLOCKED` / `SKIP`. Tier di dokumen ini hanya mengatur **urutan**, bukan
menggantikan penilaian.

## Lingkungan uji

- **URL**: https://agrovision-pjy4ku3jjq-et.a.run.app
- Data masih dataset demo (`is_demo`) — aman dirusak, dan memang masih
  dilaporkan sebagai penghalang produksi sampai `npm run db:purge:demo`
  dijalankan setelah QA selesai.
- Aplikasi ini PWA: setelah ada deploy baru, **tutup total lalu buka lagi** —
  service worker menyimpan versi lama.
