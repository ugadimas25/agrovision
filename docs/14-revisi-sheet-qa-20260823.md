# Revisi Sheet QA — 23 Agustus 2026

> Sumber: `docs/QA-Manual-AgroVision-20260821.xlsx` (72 baris, penguji Harits Balfas)
> Menindaklanjuti **AI-39** di [13-action-item-perbaikan-20260822.md](13-action-item-perbaikan-20260822.md) §10.
> Kenapa dokumen terpisah dan bukan sheet-nya langsung yang diedit: file `.xlsx` itu biner
> dengan dropdown & format yang akan hilang bila ditulis ulang oleh skrip, dan
> pemiliknya penguji — jadi yang di bawah ini **daftar perubahan per baris untuk
> diterapkan pemilik sheet**, bukan penggantinya.

Alasan revisi ini mendesak: selama skenario basi dibiarkan, sheet akan terus
melaporkan **kegagalan palsu** (fitur yang memang sudah dihapus by design) dan
kegagalan palsu itu menenggelamkan kegagalan sungguhan.

---

## A. Sheet `Petunjuk` — tiga koreksi

| Baris | Sekarang | Ganti menjadi |
|---|---|---|
| Blocker diketahui | "Tombol 'Setujui' saat ini hanya berfungsi untuk modul Pengeluaran (bug moduleKey, lihat TIKET-03). Skenario B-02 s.d. B-11 akan GAGAL…" | **Hapus seluruh baris.** TIKET-03 sudah selesai: `decideExpenditureAction` melewatkan `moduleKey` ke `app.decide_record()` sebagai satu pintu lintas modul, dan B-02/B-03 memang sudah PASS. Catatan yang basi ini membuat penguji menandai BLOCKED untuk hal yang sudah jalan. |
| Akun uji | 4 akun `@demo.invalid` | **Tambah satu baris:** `admin.multi@demo.invalid` — Super Admin dengan **dua entitas** (DEMO + DEMO2). Ini akun untuk A-07. `admin@demo.invalid` sengaja tetap satu entitas supaya perilakunya di A-01/A-05/AT1 tidak berubah. |
| (baru) | — | **Tambah catatan:** akun dua entitas mendarat di mode **"Semua Entitas"** setelah login. Di mode itu form tulis yang butuh entitas aktif tidak dirender (mis. form blok baru). Pilih satu entitas di switcher kanan atas sebelum menguji pembuatan data. |

---

## B. Lima skenario BASI — menguji fitur yang sudah dihapus by design

Kelimanya mengandaikan adanya form **"catat pengeluaran manual"**. Form itu
dilepas dari layar Pengeluaran mengikuti model refleksi (docs/11 §4): biaya
mengalir dari aktivitas yang disetujui (volume × tarif), bukan diinput tangan.
Formnya **tidak dibuang** — disimpan di `src/app/(app)/costing/pengeluaran/ExpenditureForm.tsx`
dan akan dipasang kembali khusus **overhead & upah** oleh AI-52.

| ID | Judul sekarang | Tindakan |
|---|---|---|
| **B-01** | Pengeluaran: alur penuh draft > ajukan > setujui | **Tulis ulang** memakai modul aktivitas (mis. Pemupukan) sebagai alur approval penuh; hapus langkah "catat pengeluaran + unggah foto struk". Alur biayanya sekarang: aktivitas disetujui → nilainya muncul di Refleksi. |
| **B-18** | SELF-APPROVAL (uji keamanan) | **Tulis ulang** dengan modul aktivitas: approver membuat record Pemupukan sendiri → ajukan → setujui ajuannya sendiri. Celahnya masih terbuka (AI-17), jadi skenarionya tetap relevan — yang salah cuma pintu masuknya. Statusnya sekarang PASS dengan catatan "tidak ada menu catat pengeluaran", artinya **uji ini belum pernah benar-benar berjalan**. |
| **E-05** | Bukti pembelian wajib | **Tandai BLOCKED sampai AI-52.** Satu-satunya jalur unggah bukti di aplikasi ada di form yang belum dipasang; tidak ada modul lain yang mengunggah berkas (dibuktikan: `putEvidence()` hanya dipanggil `createExpenditureAction`). |
| **G-06** | Kamera struk terbuka di HP | **Tandai BLOCKED sampai AI-52**, alasan sama. Field-nya sudah `capture="environment"`, jadi uji ini akan langsung berlaku begitu formnya dipasang. |
| **H-02** | Berkas > 8 MB ditolak | **Tandai BLOCKED sampai AI-52**, alasan sama. |

---

## C. Yang sekarang BISA dijalankan (sebelumnya SKIP/BLOCKED)

| ID | Status lama | Sekarang |
|---|---|---|
| **A-07** isolasi antar entitas (Critical) | SKIP — "menu belum tersedia" | **Bisa dijalankan.** Login `admin.multi@demo.invalid` → switcher entitas muncul di kanan atas → bandingkan blok & transaksi antara DEMO (blok KPS-xx/BRT-xx, Kalimantan) dan DEMO2 (blok MJU-xx, Mamuju). Uji arah sebaliknya dengan `direktur.mamuju@demo.invalid`: ia tidak boleh melihat sebutir pun data DEMO. |
| **E-04** kosong = "—", bukan 0 | SKIP | **Jalankan lagi.** Migrasi 0038 menghapus `COALESCE(...,0)` dari `v_block_cost_summary.total_cost_idr` dan `v_budget_vs_actual.actual_idr`. Yang HARUS tetap berangka (dan itu benar): `remaining_idr` (sisa = anggaran penuh bila belum ada realisasi), `is_over_budget` (realisasi nol tidak melampaui anggaran), dan `transaction_count` (0 itu hasil hitung, bukan nilai kosong). |

---

## D. Skenario BARU yang perlu ditambahkan

Semua di bawah ini menguji perubahan Sprint 1 dan belum ada di sheet.

| ID usul | Menu / Modul | Role | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|---|
| **A-08** | Pengaturan | Creator | Login creator@ → tempel URL `/pengaturan`, `/pengaturan/master-data`, `/pengguna` satu per satu | Ketiganya menampilkan halaman **"Akses ditolak"** (bukan data, bukan dialihkan ke /login — sesi tetap aktif) | Critical |
| **A-09** | Pengaturan | Approver | Tempel URL `/pengaturan/master-data` lalu `/pengguna` | Master Data **ditolak** (sesuai A-05); Pengguna & Akses **terbuka** | High |
| **A-10** | Sidebar | Creator & Viewer | Perhatikan sidebar setelah login | Grup **Pengaturan hilang seluruhnya** (Master Data & Pengguna tersaring, header grup ikut hilang). Menu lain tetap ada — viewer wajib bisa membaca setiap modul (A-03) | High |
| **E-06** | Master Data | Super Admin | Buka Master Data → tekan **Ubah** pada satu item → ganti nama & urutan → Simpan → buka form Pemupukan | Nama baru tersimpan dan langsung muncul di dropdown form lain. Baris ber-badge **"global" tidak punya tombol Ubah** (mengubahnya akan mengubah label bagi semua entitas) | High |
| **E-07** | Master Data | Super Admin | Kosongkan field Nama → Simpan | Ditolak dengan pesan galat **di bawah field itu** (bukan hanya border merah) | Medium |
| **C-09** | Persiapan Lahan · Penyiangan · Panen | Semua | Buka daftar record ketiga modul | Kolom Detail memakai bahasa manusia: **"Siap tanam"** bukan `ready_to_plant`, **"Manual"** bukan `manual`, **"Kelapa"** bukan `COCONUT` | High |
| **B-19** | Penyiangan / Penyemprotan / Pruning | Creator | Simpan record dengan field volume dikosongkan (Luas / Volume total / Jumlah pohon) | Ditolak, dan pesannya **menyebutkan akibatnya**: "tanpa luas, biaya penyiangan tidak bisa dihitung" | High |
| **B-20** | Inbox Approval | Approver | Arahkan kursor ke kolom Nilai Refleksi yang bertanda "—" | Muncul keterangan: belum bisa direfleksikan karena volume kosong atau tarif belum ada — **bukan** berarti nilainya nol | Medium |
| **B-21** | Aktivitas Kebun | Creator > Approver | Setujui satu record Panen dari Inbox, lalu buka `/aktivitas/panen` **tanpa refresh manual** | Status di modul asalnya sudah ikut berubah menjadi Disetujui (sebelumnya tetap tampil lama) | High |

---

## E. `npm run at:verify` — baseline yang bisa dipakai sebagai gate

Sebelum 23 Agustus suite ini **tidak menyelesaikan satu cek pun**: ia mati dengan
`ERROR: ENOENT` (AT6 membaca `src/app/(app)/laporan/keuangan/page.tsx` yang sudah
tidak ada sejak laporan jadi satu route dinamis) dan sebelum itu pun AT2 gagal
("Form tidak ditemukan") karena `login()` tidak memilih entitas — `admin@agrovision.local`
punya dua entitas (DEV + PILOT dari `npm run db:import:pilot`) sehingga mendarat di
mode "Semua Entitas". Keduanya sudah diperbaiki di harness.

Baseline sekarang: **18 PASS / 11 FAIL**. Kesebelas kegagalan itu **known-fail**,
bukan regresi — semuanya bermuara pada satu sebab yang sama:

| Blok | Kegagalan | Sebab |
|---|---|---|
| AT1 (2) | kategori & blok baru tidak muncul di dropdown Pengeluaran | dropdown itu milik form pengeluaran manual yang belum dipasang (AI-52) |
| AT3 (1) | prasyarat AT3 tidak tersedia | idem |
| AT3 lanjutan (5) | periode fiskal, realisasi 7jt, Laporan Keuangan | tidak ada transaksi yang bisa dibuat, jadi tidak ada realisasi |
| AT2 lengkap (2) | biaya hidup blok & cost/ha | idem — nilainya benar-benar kosong, dan sekarang tercetak "—" bukan "Rp 0" |

Artinya: **suite ini boleh dipakai sebagai gate dengan ambang 18/11.** Turun dari
18 PASS = regresi. Naik = AI-52 mulai jalan. Sebelumnya angka itu tidak ada
sehingga tidak ada yang bisa dibandingkan.

Catatan tambahan: `npm run db:seed:demo` **tidak idempoten** (`INSERT INTO app.estates`
tanpa `ON CONFLICT`) — jalankan `npm run db:purge:demo` lebih dulu, atau seed-nya
gagal di `estates_company_id_code_key`. Layak diperbaiki bersama AI-42.

---

## F. Kolom Role yang HARUS ikut berubah bila pembatasan layar uang diberlakukan

Belum diberlakukan, dan itu keputusan sadar (lihat §10b dokumen 13). Tapi kalau
nanti Dashboard Finansial / Refleksi / Revenue / Anggaran dibatasi dari creator,
tiga baris ini **wajib** ikut direvisi di sheet — kalau tidak, penguji akan
melaporkan kegagalan palsu:

| ID | Kolom Role sekarang | Menjadi |
|---|---|---|
| E-01 Refleksi biaya | Semua | Super Admin / Approver / Viewer |
| E-02 Pendapatan | Semua | Super Admin / Approver / Viewer |
| F-01 Tiga dashboard | Semua | Operasional & Sustainability: Semua · Finansial: tanpa Creator |

Dan pembatasannya sendiri tidak boleh berhenti di sidebar: angka yang sama masih
terbaca lewat `/laporan/keuangan` beserta `/pdf` dan `/excel`, jadi harus satu
paket dengan gating di `src/lib/report/registry.ts` (AI-44/AI-47).
