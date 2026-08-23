# Action Item Perbaikan AgroVision

> Disusun: **22 Agustus 2026**
> Sumber: `docs/QA-Manual-AgroVision-20260821.xlsx` (72 skenario, penguji Harits Balfas, 19–21 Agustus) + `docs/catatan.md` (catatan perbaikan fitur per modul)
> Setiap item sudah dicek ke kode; kolom "Akar masalah" menunjuk file:baris yang harus disentuh.

---

## 1. Ringkasan eksekutif

Rekap 63 skenario QA yang punya baris uji (8 baris sisanya adalah header kelompok A–H):

| Status | Jumlah | ID |
|---|---|---|
| PASS | 30 | A-01…A-06, B-02…B-07, B-10, B-12, B-14, B-15, B-16, B-18, C-01…C-04, C-07, C-08, D-02, D-03, D-05, E-01, E-02, E-03 |
| Belum diuji | 21 | D-01, seluruh kelompok F (5), G (10), H (5) |
| SKIP | 5 | A-07, B-17, C-05, C-06, E-04 |
| BLOCKED | 5 | B-01, B-08, B-09, B-11, D-04 |
| FAIL | 2 | B-13, E-05 |

Angka "30 PASS" itu terlalu optimistis: **8 di antaranya PASS dengan catatan** yang isinya sebenarnya cacat (B-05, B-07, B-18, C-03, C-07, D-05, E-01, E-03). Dan yang lebih penting, **kelompok F, G, H (laporan, mobile/PWA, negatif & ketahanan) belum tersentuh sama sekali** — 21 skenario, 15 di antaranya High/Critical. Jadi kualitas rilis belum bisa dinilai.

### Kabar baik

- **TIKET-03 (bug `moduleKey`) sudah selesai.** Catatan "Blocker diketahui" di sheet Petunjuk sudah basi: `decideExpenditureAction` kini melewatkan `moduleKey` ke `app.decide_record()` sebagai satu pintu lintas-modul (`src/lib/actions/costing.ts:218`), dan B-02/B-03 memang PASS.
- Fondasi keamanan database tetap solid: A-03/A-04/A-05/A-06 (viewer read-only, creator tak bisa menyetujui, master data khusus super admin, logout memutus sesi) semuanya PASS.

### Empat akar masalah yang menjelaskan sebagian besar temuan

**AKAR-1 — Realisasi biaya dibaca dari tabel yang tidak pernah diisi.**
`v_budget_vs_actual` (`db/migrations/0017_reports.sql:96-99`, ditulis ulang di `0018_security_fix.sql:512`) dan `v_block_cost_summary` (`0017_reports.sql:70-88`) menghitung realisasi dari `app.cost_transactions`. Tetapi pencatatan biaya manual **sengaja dihapus** dari UI (model refleksi, docs/11 §4 — lihat komentar di `src/app/(app)/costing/pengeluaran/page.tsx:27-32`), dan model refleksi menghitung biaya **di TypeScript saat render** (`src/lib/repo/pricing.ts:91-106`) tanpa pernah menulis ke `cost_transactions`. Fungsi penulisnya masih ada di `src/lib/repo/costing.ts`, tapi satu-satunya pemanggilnya adalah Server Action yang tidak lagi terpasang di UI mana pun. Jadi selain data seed demo dan fixture uji, tidak ada apa pun yang mengisi tabel realisasi.
→ Menjelaskan: catatan 6.7 (budget belum ter-link), QA E-03 ("realisasi dari mana"), B-01 BLOCKED, E-05 FAIL, E-01 "dengan catatan", B-18 tak bisa diuji.

**AKAR-2 — Refleksi biaya hanya punya 4 driver, dan semuanya agregat se-perusahaan.**
`DRIVER_SQL` (`src/lib/repo/pricing.ts:37-48`) hanya mengenal `block_area_ha`, `landprep_area_ha`, `seedling_qty`, `fertilizer_qty` — dan setiap query men-`SUM` seluruh perusahaan **tanpa GROUP BY blok maupun periode**. Jadi: penyiangan, penyemprotan, pruning, dan panen tidak bisa menghasilkan biaya sama sekali; dan biaya yang ada tidak bisa dipetakan ke periode anggaran atau ke blok.
→ Menjelaskan: catatan B-05 & B-07 ("tidak terdapat harga di inbox approval"), catatan 6.5 (biaya per blok), 6.7 (per periode & per blok), dan kenapa penguncian harga per periode (6.2) belum mungkin secara teknis.

**AKAR-3 — Tarif tidak punya dimensi waktu, jadi riwayat biaya ikut berubah saat tarif diubah.**
`app.price_list` menyimpan satu `rate_idr` per kode, `UNIQUE (company_id, code)`, tanpa `valid_from/valid_to` (`db/migrations/0033_price_list.sql:15-33`). Karena refleksi menghitung ulang setiap render, mengubah tarif hari ini **menulis ulang nilai historis** — persis yang dilarang catatan 6.2. Ironisnya pola yang benar sudah ada di repo ini: `emission_factors` memakai `version` + `valid_from/valid_to` + append-only.

**AKAR-4 — Pemetaan role → menu belum ada, padahal mekanismenya sudah terpasang.**
`Sidebar.tsx:150` sudah memfilter `group.items.filter((i) => !i.roles || i.roles.includes(role))`, tetapi **tidak satu pun item mendeklarasikan `roles`** (`Sidebar.tsx:33-100`). Halaman-halamannya juga hanya memanggil `requireContext()`, bukan `requireRole()`. Jadi petugas lapangan melihat dan bisa membuka seluruh menu. RLS database tetap menahan data, tapi ini tetap celah otorisasi di lapisan aplikasi — dan catatan 9.3 benar menyebutnya masalah keamanan, bukan kenyamanan.

### Urutan kerja yang disarankan

1. **Putuskan dulu K-01 dan K-02** (model biaya & penguncian tarif). Delapan action item bergantung padanya; mengerjakan W1 tanpa keputusan ini berisiko dibongkar ulang.
2. **Sprint keamanan & perbaikan murah** (AI-27, AI-03, AI-06, AI-14, AI-29, AI-31, AI-34, AI-12, AI-13) — semuanya kecil, dampaknya langsung terasa.
3. **Sprint akuntansi** (AI-01, AI-02, AI-04, AI-05) — pekerjaan berat, butuh migrasi.
4. **Sprint kelengkapan modul** (form nursery/DBH/sertifikasi, filter dashboard).
5. **Paralel sepanjang waktu:** selesaikan 21 skenario QA yang belum diuji (W8).

---

## 2. Keputusan yang harus diambil lebih dulu

Ini bukan pekerjaan koding; ini keputusan yang memblokir koding. Tandai jawabannya di dokumen ini.

| ID | Keputusan | Kenapa memblokir | Memblokir |
|---|---|---|---|
| **K-01** | ~~Model biaya: materialisasi ke `cost_transactions` atau view realisasi dibaca dari refleksi?~~ **DIPUTUSKAN 22 Agu 2026: Opsi A — materialisasi saat approval.** Detail & contoh: §13. | Selesai. Biaya menjadi fakta historis: saat record disetujui, satu baris `cost_transactions` ditulis dengan snapshot `quantity` + `unit_price_idr`. Kolomnya sudah tersedia sejak migrasi `0016_costing_fix.sql:50-67`. | AI-01, AI-04, AI-05, AI-09, AI-11 |
| **K-02** | ~~Penguncian tarif: versi tarif atau snapshot?~~ **DIPUTUSKAN 22 Agu 2026: Opsi 1 — versi di dalam `price_list` (`version` + `valid_from/valid_to`), mengikuti pola `emission_factors`; tarif diambil dari TANGGAL KEJADIAN, bukan tanggal approve.** Detail & contoh: §14. | Selesai. Snapshot `unit_price_idr` (K-01) saja tidak cukup: ia mengunci tarif saat approval, bukan saat kejadian — record yang disetujui terlambat atau dicatat mundur akan memakai tarif yang salah. | AI-04, AI-07 |
| **K-03** | ~~Komoditas bertingkat & satuan harga: butir, kg, atau ton?~~ **DIPUTUSKAN 22 Agu 2026: satuan menempel pada grade, bukan dipilih satu untuk semua. Kelapa per butir, durian per kg; ton TIDAK dipakai untuk harga.** Detail & contoh: §15. | Selesai. Tabel baru `commodities` + `commodity_grades`; `REVENUE_CODE` hardcode (`src/lib/repo/pricing.ts:87`) dihapus. Perlu konfirmasi kontrak pembeli sebelum tarif diisi. | AI-07, AI-08 |
| **K-04** | ~~Kesesuaian lahan: satu penilaian aktif per blok atau riwayat berversi?~~ **DIPUTUSKAN 23 Agu 2026: Opsi A — riwayat berversi, satu penilaian aktif per blok PER KOMODITAS (`superseded_at`/`superseded_by`).** Detail & contoh: §16. | Selesai. Indeks `lsa_one_per_block` sekarang memblokir penilaian kelapa pada blok yang sudah dinilai untuk durian — padahal migrasi 0028 menyeed kriteria per komoditas justru untuk dibandingkan. | AI-18 |
| **K-05** | ~~Pembibitan: data bibit hanya dari Super Admin / Master Data?~~ **DIPUTUSKAN 23 Agu 2026: ya — jenis/varietas bibit dirujuk dari Master Data, dikelola Super Admin.** | Selesai. Konsekuensi untuk AI-19: form inspeksi nursery hanya **memilih** dari master (dropdown), tidak boleh ada field teks bebas maupun pembuatan jenis bibit inline. Bila master masih kosong, tampilkan empty state yang menunjuk ke Pengaturan › Master Data — bukan input bebas. Ini juga yang dibuktikan acceptance test AT1. | AI-19 |
| **K-06** | ~~Agri-Input & Equipment: boleh diedit? Dokumentasi biaya seperti apa?~~ **DIPUTUSKAN 23 Agu 2026: (1) stok jadi buku besar mutasi, bukan kolom; (2) equipment hanya biaya KAPITAL, operasional/bahan bakar ditunda; (3) **seluruh `price_list`** (biaya, upah/jasa, revenue) hanya boleh diubah super_admin.** Detail & contoh: §17. | Selesai. Konsekuensi besar: `stock_qty` menjadi turunan; mutasi keluar ditulis otomatis oleh `app.decide_record()`; creator tidak pernah menyentuh stok maupun harga. | AI-43, **AI-45** |
| **K-07** | ~~Laporan: sesi penentuan laporan yang dibutuhkan & formatnya~~ **DIPUTUSKAN 23 Agu 2026: pembaca = manajemen; keputusan dari manajemen; sumber data pakai data demo dulu; ketiga format (layar, PDF, Excel) wajib untuk semua laporan; batas 8 kolom di mobile, sisanya baris detail yang bisa dibuka.** Detail: §18. | Selesai. Konsekuensi: tidak ada laporan yang ditunda (18 → 16, hanya 3 digabung jadi 1); penyatuan jalur layar-vs-ekspor menjadi **wajib**; dan **seluruh 15 laporan modul** melampaui batas 8 kolom sehingga semuanya perlu restrukturisasi. | **AI-47, AI-48, AI-49**, AI-37, AI-38 |
| **K-08** | ~~Modul Akuntansi perlu filter juga?~~ **DIPUTUSKAN 23 Agu 2026: ya, perlu.** | Selesai. Wajib memakai **komponen filter yang sama** dengan dashboard (AI-24) — satu implementasi, satu bentuk `searchParams`. Kalau dibuat terpisah, akan ada dua perilaku filter yang berbeda di aplikasi yang sama. Menyerap sebagian AI-10. | AI-24, AI-10 |
| **K-09** | ~~Price List: perlu edit per baris?~~ **DIPUTUSKAN 23 Agu 2026: tiga kelas field — kekal / berversi / edit in-place.** Detail & contoh: §19. | Selesai. Bukan editor kolom generik: hanya `category`, `note`, `is_active` yang boleh diedit; `rate_idr` **+ `unit`** lewat versi baru; `code`, `kind`, `driver` kekal. Temuan yang lebih mendesak: **tidak ada jalur create sama sekali** — `INSERT INTO app.price_list` hanya ada di `db/seed-demo.mjs:763`. | AI-44a, AI-44b |
| **K-10** | ~~Sidebar: grup menu dibuat highlight/aktif atau dibiarkan?~~ **DIPUTUSKAN 23 Agu 2026: setelah login TIDAK ada grup yang terbuka — semua tertutup.** | Selesai. Dua perubahan kode yang saling terkait: (1) state dibalik — simpan `expanded` (default kosong) alih-alih `collapsed`, karena sekarang `!collapsed[group.key]` membuat semua grup terbuka secara default; (2) buang `hasActive` dari ekspresi `isOpen` (`Sidebar.tsx:152`) — kebetulan itu juga yang diminta catatan 1.2/AI-33. Konsekuensi: pengguna mendarat di `/dashboard` (`src/lib/actions/auth.ts:26`) dengan seluruh menu tertutup, jadi grup yang memuat halaman aktif **wajib diberi penanda visual pada header tertutupnya** supaya orientasi tidak hilang. | AI-32, AI-33 |
| **K-11** | ~~`tree_survey_points`: diaktifkan atau diparkir?~~ **DIPUTUSKAN 23 Agu 2026: DIAKTIFKAN.** | Selesai. Cakupan AI-51 berubah dari investigasi menjadi pembangunan: form input titik pohon + approval + layer peta. Catatan teknis: `client_uuid NOT NULL UNIQUE` (migrasi 0007) berarti klien wajib membangkitkan UUID sendiri (`crypto.randomUUID()`) — kolom itu memang disiapkan untuk idempotensi sync perangkat. | **AI-51** |

---

## 3. W1 · Akuntansi & Refleksi Biaya — prioritas tertinggi

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-01 | Materialisasi biaya ter-refleksi ke `cost_transactions` per blok & per periode | AKAR-1, catatan 6.7, E-03, B-01 | P0 | XL (5–8 hari) | Backend |
| AI-02 | Lengkapi driver refleksi untuk semua modul aktivitas | AKAR-2, B-05, B-07 | P0 | L (3–4 hari) | Backend |
| AI-03 | Wajibkan field volume yang menjadi driver biaya | B-05, B-07 | P0 | S (2–4 jam) | Backend |
| AI-04 | Penguncian tarif per periode (versi + snapshot) | catatan 6.2 | P0 | L (3–5 hari) | Backend |
| AI-05 | Anggaran: hubungkan ke realisasi + form dinamis per scope | catatan 6.7, E-03 | P1 | M (2 hari) | Backend |
| AI-06 | Hapus `COALESCE(...,0)` pada view realisasi — kosong harus NULL → "—" | E-04, doktrin kejujuran data | P1 | S (2 jam) | Backend |
| AI-07 | Revenue bertingkat per grade: tabel `commodities` + `commodity_grades`, satuan per grade (§15) | catatan 6.3, 6.6 · K-03 | P1 | L (3–5 hari) | Backend |
| AI-08 | Penamaan & header: "Tarif/ton" → "Harga" + satuan dari grade (butir/kg), header ringkas + ikon **i** | catatan 6.3, 6.6 · K-03 | P2 | S (3 jam) | Frontend |
| AI-09 | Biaya per blok bisa ditelusuri/diedit | catatan 6.5 | P2 | M (1–2 hari) | Fullstack |
| AI-10 | Pengeluaran: sorting per kolom + filter tanpa reload halaman penuh | catatan 6.5 | P2 | M (1–2 hari) | Frontend |
| AI-11 | Data berstatus **Ditolak** harus bisa diedit | catatan 6.5 (Bug) | P1 | M (1 hari) | Fullstack |
| AI-12 | Hapus jalur pengeluaran manual yang sudah mati | AKAR-1 | P1 | S (2 jam) | Backend |

### Detail

**AI-01 · Materialisasi biaya ter-refleksi** — tunggu K-01.
Sekarang: `reflectedCosts()` (`src/lib/repo/pricing.ts:91`) menghitung Σ(volume × tarif) setiap kali halaman dirender, dan tidak menyimpan apa pun. Realisasi anggaran membaca `cost_transactions` yang tidak pernah diisi.
Kerjakan: saat sebuah record aktivitas berpindah ke `approved` (di dalam `app.decide_record()`, migrasi baru), tulis satu baris `cost_transactions` berisi `block_id`, `fiscal_period_id` (dari tanggal kejadian), `cost_category_id`, `volume`, `rate_idr` (snapshot), `amount_idr`. Tetap append-only. Sertakan mundur-isi (backfill) untuk record yang sudah approved.
Verifikasi: `npm run db:test` + skenario baru di `scripts/at-verify.mjs` — approve satu pemupukan, pastikan realisasi anggaran naik sebesar volume × tarif.

**AI-02 · Lengkapi driver refleksi.**
Tambahkan driver untuk `weeding_records` (HOK/luas), `spraying_records` (volume), `pruning_records` (jumlah pohon), dan `harvest_records`. Perlu memperluas CHECK constraint `price_list.driver` (`db/migrations/0033_price_list.sql:23-25`) lewat migrasi baru, plus `DRIVER_SQL`/`DRIVER_LABEL` di `src/lib/repo/pricing.ts:37-55`. Sekalian tambahkan `GROUP BY block_id, periode` supaya bisa dipakai AI-01.

**AI-03 · Wajibkan field driver biaya.**
`spraySchema.totalVolume` dan area efektif persiapan lahan bersifat opsional (`src/lib/actions/operational.ts:231-249`), sehingga record tersimpan tanpa volume dan biayanya mustahil dihitung — inilah yang dilaporkan di catatan B-05 dan B-07. Jadikan wajib bila kategori biayanya punya tarif, atau tampilkan peringatan eksplisit "tanpa volume, biaya tidak bisa direfleksikan" di form dan di Inbox.

**AI-06 · Kejujuran data di view realisasi.**
`db/migrations/0017_reports.sql:113-118` dan `0018_security_fix.sql:525` memakai `COALESCE(a.actual_idr, 0)`; `v_block_cost_summary` melakukan hal yang sama untuk `total_cost_idr` dan `cost_per_ha_idr` (`0017_reports.sql:79-82`) — padahal komentar view itu sendiri (baris 90-91) justru mewajibkan NULL. Ini melanggar aturan yang ditegakkan di seluruh lapisan lain ("`null` = belum ada data, dirender '—', bukan 0" — `src/lib/format.ts:4-6`). Biarkan NULL; biarkan formatter yang memutuskan tampilannya. Skenario E-04 (SKIP) harus dijalankan setelah ini.

**AI-12 · Hapus kode mati pengeluaran manual.**
`src/app/(app)/costing/pengeluaran/ExpenditureForm.tsx` tidak diimpor dari mana pun, dan `createExpenditureAction` / `submitExpenditureAction` (`src/lib/actions/costing.ts:87,165`) tidak punya pemanggil di UI — padahal Server Action tetap bisa dipanggil lewat POST langsung. Pilih satu: hapus, atau pertahankan sebagai jalur resmi (keputusan K-01) dan pasang kembali formnya. Jangan tinggalkan di tengah.

---

## 4. W2 · Approval & Siklus Hidup Record

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-13 | Perbaiki "infinite loading" saat ajukan ulang setelah ditolak | B-13 (FAIL) | P0 | M (1 hari) | Frontend |
| AI-14 | `revalidatePath` setelah keputusan approval belum lengkap | Temuan kode | P1 | S (1 jam) | Backend |
| AI-15 | Ganti nama `decideExpenditureAction` → `decideRecordAction` | Temuan kode | P3 | S (1 jam) | Backend |
| AI-16 | Inbox: bagian "baru diputuskan", sort & filter, default tanggal desc | catatan 11.1–11.3 | P2 | M (2 hari) | Fullstack |
| AI-17 | Tutup celah self-approval | B-18, TIKET-04 | P1 | M (1–2 hari) | Backend |
| AI-18 | Kesesuaian lahan: riwayat berversi per komoditas + aksi hapus draft (§16) | B-08 (BLOCKED), C-04 · K-04 | P1 | M (1–2 hari) | Backend |

**AI-13** — perlu reproduksi terlebih dulu (penguji: iPhone/Safari & desktop). Satu cacat sudah pasti terlihat dari kode: `OpSubmitButton` (`src/components/ui/OpSubmitButton.tsx`) hanya merender pesan **error** (`state.message && !state.ok`) dan tidak punya cabang sukses, sedangkan `pending` menampilkan spinner. Begitu `submitOpAction` sukses, `revalidatePath` mengganti daftar dan tombol itu ikut dirender ulang — pengguna hanya melihat spinner tanpa pernah melihat konfirmasi. Bandingkan dengan `DecisionForm` (`src/app/(app)/approval/DecisionForm.tsx:22-30`) yang punya cabang `state.ok`. Tambahkan cabang sukses + `key` stabil per baris, lalu uji ulang B-13.

**AI-14** — `decideExpenditureAction` merevalidasi `/approval`, `/costing/pengeluaran`, `/laporan/keuangan`, `/laporan/operasional`, `/dashboard` (`src/lib/actions/costing.ts:224-229`), tapi **tidak** merevalidasi halaman modul asal. Setujui sebuah record Panen, lalu buka `/aktivitas/panen` — statusnya masih tampil lama. `MODULE_PATH` yang dibutuhkan sudah ada di `src/lib/actions/operational.ts:283-295`; pakai itu.

**AI-17** — B-18 ditandai PASS tapi catatannya "tidak ada menu catat pengeluaran", artinya **uji self-approval belum pernah benar-benar berjalan**. Celahnya tetap terbuka: `app.decide_record()` sengaja SECURITY INVOKER dan hanya bergantung pada policy `*_role_split`, yang mengizinkan `approver` mengubah baris apa pun — termasuk buatannya sendiri. Perbaikan yang tepat ada di database: tambahkan syarat `created_by <> app.current_user_id()` pada jalur keputusan (dengan pengecualian tercatat untuk `super_admin` bila memang dikehendaki). Wajib disertai kasus baru di `db/verify-adversarial.mjs`.

**AI-18** — lihat K-04. Bila jawabannya "riwayat berversi": ganti `lsa_one_per_block` dengan unique partial index untuk penilaian aktif saja, atau `UNIQUE (block_id, crop_code, assessed_at)`. Bila jawabannya "tetap satu": beri creator kemampuan menghapus/mengganti draft miliknya sendiri, supaya salah input tidak mengunci blok.

---

## 5. W3 · Modul yang belum punya jalur input

Empat skenario BLOCKED semuanya bukan bug — memang belum ada formnya. Ini pekerjaan fitur, bukan perbaikan.

> **Ditegaskan 23 Agu 2026: sasarannya modul benar-benar TERPAKAI, bukan sekadar laporannya tampil.** Data demo dari K-07 (§18) hanya jembatan untuk review manajemen. Karena itu seluruh workstream ini **naik ke Sprint 2**, berjalan bersama akuntansi — bukan Sprint 3.

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-19 | Form catat inspeksi pembibitan — jenis bibit dari Master Data, dropdown saja (K-05) | B-09 (BLOCKED) · K-05 | **P0** | M (2 hari) | Fullstack |
| AI-20 | Form catat pengukuran DBH | B-11 (BLOCKED) | **P0** | M (2 hari) | Fullstack |
| **AI-50** | **Form distribusi bibit** (`seed_distributions`) — tanpa ini driver biaya `seedling_qty` dan survival rate mustahil bergerak | Temuan kode | **P0** | M (2 hari) | Fullstack |
| **AI-52** | **Form biaya overhead & upah tenaga kerja** — menutup aturan 5 di §13 | K-01 §13 | **P0** | M (2 hari) | Fullstack |
| AI-21 | Sertifikasi: aksi tambah & perbarui status bukti K1–K7 | D-04 (BLOCKED) | P1 | M (2 hari) | Fullstack |
| AI-22 | Field Survey: aksi **View** untuk melihat hasil survei | catatan 10 | P1 | M (1–2 hari) | Fullstack |
| AI-23 | Pemupukan: daftar rekomendasi untuk creator + bridging hasil kesesuaian | C-07, C-03 | P2 | M (1–2 hari) | Fullstack |
| **AI-51** | **Aktifkan `tree_survey_points`** (K-11): form input titik pohon + approval + layer peta dari tabel ini | Temuan kode · K-11 | P1 | L (3–5 hari) | Fullstack |

Catatan teknis: `src/app/(app)/nursery/` dan `src/app/(app)/keberlanjutan/karbon/` hanya berisi `page.tsx` — tidak ada komponen form, dan tidak ada Server Action `createNurseryInspection*`/`createDbh*`. Tabel dan approval-nya sudah ada (`nursery_inspections`, `dbh_measurements` sudah masuk policy `*_role_split` di migrasi 0025), jadi pekerjaannya murni action + form + wiring. Pola yang bisa dicontek persis: `src/app/(app)/costing/anggaran/Forms.tsx` + `src/lib/actions/operational.ts`.

**Inventaris lengkap jalur tulis yang belum ada.** Dibanding daftar tabel ber-`approval_status` dengan daftar `INSERT INTO` di `src/lib/repo/*`:

| Tabel | Jalur tulis | Akibat kalau dibiarkan | Item |
|---|---|---|---|
| `nursery_inspections` | ❌ tidak ada | Survival rate tak pernah berubah (B-09) | AI-19 |
| `dbh_measurements` | ❌ tidak ada | Carbon run tanpa data biomassa (B-11) | AI-20 |
| `seed_distributions` | ❌ tidak ada | Dibaca `pricing.ts:43` (driver `seedling_qty`) dan `sustainability.ts:291`, tapi tidak pernah bisa terisi — **tidak pernah muncul di sheet QA** | AI-50 |
| `tree_survey_points` | ❌ tidak ada — **diputuskan DIAKTIFKAN (K-11)** | Tabel lengkap (geom titik, `tree_count`, `condition`, `growth_phase`, `client_uuid` untuk sync perangkat) tapi tidak dibaca maupun ditulis sama sekali; juga tidak ada di sheet QA. Fase 1 usul: input online + geolokasi browser, `client_uuid` dibangkitkan klien (`crypto.randomUUID()`) untuk idempotensi klik-ganda; sync offline sungguhan menyusul bila memang dibutuhkan. Layer peta "Titik pohon" (C-01) dialihkan ke tabel ini lewat route geojson baru — sumber lamanya perlu dipastikan lebih dulu | AI-51 |
| `cost_transactions` (overhead & upah) | ⚠️ ada di repo, tidak terpasang di UI | Keputusan #7 menaruh labor di costing per blok, tapi tidak ada cara memasukkannya | AI-52 |
| `agri_input_stock_movements` (pembelian) | — belum ada tabelnya | Stok tak pernah bertambah | AI-45 |

Dua baris terakhir dari tabel di atas menegaskan pola yang sama seperti AKAR-1: **skema sudah siap, view sudah membaca, tinggal jalur inputnya yang tidak pernah dibuat.** Itu sebabnya laporan tampak kosong walau databasenya lengkap.

---

## 6. W4 · Dashboard & Filter

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-24 | Filter dashboard benar-benar berfungsi, multi-pilih | catatan 2.1, 2.2 | P1 | L (4–6 hari) | Fullstack |
| AI-25 | Audit Dashboard Keberlanjutan: faktual atau placeholder? | catatan 2.3 | P1 | M (1 hari) | Backend |
| AI-26 | Dashboard Finansial: pie chart per kategori biaya + insight disesuaikan | catatan 2.4 | P2 | M (1–2 hari) | Fullstack |

**AI-24** — filternya saat ini **dekoratif**, dan itu tertulis di kodenya sendiri: `src/components/dashboard/shared.tsx:6` menyebut `DashboardFilterBar` sebagai "(presentational)", `src/app/(app)/dashboard/page.tsx:14` tidak menerima `searchParams`, dan loader seperti `operationalDashboardView(ctx)` tidak punya parameter filter. Jadi catatan 2.1 tepat: angkanya statis.
Pekerjaannya berlapis dan harus dikerjakan berurutan: (1) bentuk tipe `DashboardFilter` (estate[], periode, blok[], komoditas[]); (2) filter → URL `searchParams` supaya bisa di-bookmark dan bekerja tanpa JS; (3) tambahkan parameter filter ke seluruh loader di `src/lib/report/*Dashboard.ts`; (4) turunkan filter ke klausa WHERE query repo — jangan memfilter di TypeScript setelah `SUM`, karena hasilnya akan salah. Ini juga prasyarat K-08 (filter di modul akuntansi) — pakai satu komponen yang sama.

**AI-25** — jawab dengan bukti, bukan dugaan: telusuri `src/lib/report/sustDashboard.ts` dan pastikan setiap KPI punya asal query. Ingat keputusan #10 (`docs/02-keputusan-arsitektur.md`): dashboard sustainability **boleh kosong**, yang wajib adalah perhitungannya benar. Karena itu jawaban yang benar mungkin "memang kosong dan itu sah" — bukan "harus diisi".

---

## 7. W5 · Master Data, Pengguna & Hak Akses

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-27 | **Pemetaan role → menu (aplikasi + server-side)** | catatan 9.3 (Bug keamanan), AKAR-4 | **P0** | M (2 hari) | Fullstack |
| AI-28 | Pengguna: aksi nonaktifkan / aktifkan kembali / hapus per baris | catatan 9.1, 9.2 | P1 | M (2 hari) | Fullstack |
| AI-29 | Master Data: pasang aksi **Edit** (action-nya sudah ada, UI-nya belum) | catatan 8.2 | P1 | S (2–3 jam) | Frontend |
| AI-30 | Master Data: form menyesuaikan entitas, bukan satu form untuk semua | catatan 8.1 | P2 | M (2 hari) | Fullstack |
| AI-31 | Seed entitas kedua + akses admin agar uji isolasi tenant bisa jalan | A-07 (SKIP) | P1 | S (3 jam) | Backend |

**AI-27** — dua lapis, keduanya wajib. (a) Deklarasikan `roles` pada tiap item di `GROUPS` (`src/components/layout/Sidebar.tsx:33-100`); mekanisme filternya sudah jalan di baris 150, tinggal diisi. (b) Ganti `requireContext()` menjadi `requireRole(...)` di halaman yang memang terbatas — menyembunyikan menu tanpa memagari route hanya menyembunyikan masalah, karena URL-nya masih bisa ditempel langsung. Sekalian sinkronkan `BottomNav.tsx`. Setelah ini, uji ulang A-03/A-04 dan tambahkan skenario baru: "creator membuka URL modul pengaturan langsung → ditolak".

**AI-29** — `updateMasterItemAction` sudah ada dan teruji (`src/lib/actions/master.ts:112`), tetapi `MasterDataManager.tsx` hanya mengimpor `deactivateMasterItemAction` (baris 8, 41). Ini item termurah di seluruh daftar: cukup pasang formnya.

**AI-31** — A-07 di-SKIP dengan catatan "menu belum tersedia", tetapi switcher entitas sebenarnya sudah ada; ia hanya tampil bila pengguna punya lebih dari satu entitas (`multi = companies.length > 1`, `src/components/layout/Topbar.tsx:62`). Data demo hanya memberi admin satu entitas. Tambahkan entitas kedua + `user_company_access` di `db/seed-demo.mjs`, lalu jalankan A-07 — ini uji **Critical** untuk isolasi tenant dan sayang sekali dibiarkan SKIP.

---

## 8. W6 · Navigasi & UX

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-32 | Sidebar: seluruh baris grup bisa diklik + indikator aktif | catatan 1.1 (tunggu K-10) | P2 | S (3 jam) | Frontend |
| AI-33 | Sidebar: grup induk tidak bisa di-minimize saat submenu aktif | catatan 1.2 (Bug) | P2 | S (2 jam) | Frontend |
| AI-34 | Label status manusiawi — hentikan kebocoran nilai enum ke UI | catatan 3 | P1 | S (2 jam) | Backend |
| AI-35 | Regroup menu: Blok & Peta, Survei Lapangan, Inbox Approval | catatan 1.3 | P2 | S (2 jam) | Frontend |
| AI-36 | Traceability: node & garis alur bisa diklik | D-05 (PASS dgn catatan) | P2 | S (3 jam) | Frontend |
| AI-43 | Agri-Input: aksi edit & nonaktifkan katalog + policy tulis restriktif (harga beli = super_admin) | catatan 5 · K-06 | P2 | M (1–2 hari) | Fullstack |
| AI-45 | **Buku besar mutasi stok** `agri_input_stock_movements` (append-only); `stock_qty` jadi turunan; mutasi keluar otomatis saat approval; alert reorder | catatan 5, D-01 · K-06 | P1 | L (3–4 hari) | Backend |
| AI-46 | Equipment: harga beli → satu baris biaya overhead saat pembelian (tanpa depresiasi) | catatan 5 · K-06 | P2 | S (4 jam) | Backend |
| **AI-44a** | **Tambah baris tarif baru** + tampilkan `driver` & `unit` sebagai kolom | catatan 6.4 · K-09 · **prasyarat K-03** | **P1** | M (1–2 hari) | Fullstack |
| AI-44b | Edit metadata (`category`/`note`/`is_active`) + riwayat versi per baris | catatan 6.4 · K-09 | P2 | M (1 hari) | Fullstack |

**AI-33** — perilakunya disengaja, jadi ini keputusan produk yang dibalik, bukan sekadar bug: `Sidebar.tsx:152` mencegah grup yang memuat halaman aktif ditutup ("Grup dengan halaman aktif tak boleh disembunyikan"). Kalau penguji menganggapnya mengganggu, longgarkan aturannya dan simpan state buka/tutup per grup.

**AI-34** — sumber kebocoran `ready_to_plant` / `in_progress` bukan di komponen, tapi di SQL: `detailExpr` untuk `land_preparations` merangkai `t.status` mentah ke string tampilan (`src/lib/repo/operational.ts:47`). Halaman formnya sendiri sudah punya label bagus ("Berjalan", "Siap tanam" — `src/app/(app)/operasional/persiapan-lahan/page.tsx:17-18`), jadi tinggal dipakai konsisten. Petakan label di TypeScript, jangan di SQL; sekalian periksa `detailExpr` modul lain untuk kebocoran serupa.

---

## 9. W7 · Laporan

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-37 | Sesi penggabungan laporan: Penyiangan + Penyemprotan + Pruning → satu "Aktivitas Pemeliharaan" berfilter modul | catatan 7 · K-07 | P2 | Sesi 1 jam + M (2 hari) | Dimas + Fullstack |
| **AI-47** | **Satukan jalur laporan layar & ekspor** — PDF/Excel dirender dari objek `ReportScreen` yang sama | Temuan kode · K-07 | **P1** | L (3–4 hari) | Backend |
| **AI-48** | **Batas 8 kolom di mobile + baris detail yang bisa dibuka**, untuk 15 laporan modul | catatan 7, G-04 · K-07 | P1 | L (4–5 hari) | Frontend |
| **AI-49** | Perluas seed demo agar laporan Panen/Bibit/Karbon/Equipment punya isi + penanda "contoh" — **jembatan sementara**, exit criteria: dihapus lewat `db:purge:demo` begitu AI-19/AI-20/AI-50 selesai dan data nyata mengalir | K-07 | P2 | M (1–2 hari) | Backend |
| AI-38 | Selesaikan uji F-01…F-05 (PDF, Excel, silang-cek angka) — **jalankan SETELAH AI-47**, kalau tidak yang diuji akan dibuang | 5 skenario belum diuji | P1 | M (1–2 hari) | QA |

Urutannya mengikat: **AI-47 lebih dulu** (satukan jalur), baru AI-48 (batas kolom), baru AI-38 (uji ekspor). Membalik urutan berarti mengerjakan tata letak dua kali dan menguji jalur yang akan dibuang. AI-37 dan AI-49 bisa jalan paralel.

---

## 10. W8 · QA & Proses

| ID | Item | Sumber | Prioritas | Estimasi | Owner usul |
|---|---|---|---|---|---|
| AI-39 | Perbarui QA sheet: buang/tulis ulang skenario yang sudah basi | Temuan kode | P0 | S (3 jam) | QA + Dimas |
| AI-40 | Selesaikan 21 skenario yang belum diuji (D-01, F, G, H) | Rekap status | P0 | L (3–4 hari) | QA |
| AI-41 | Jalankan ulang 5 SKIP setelah prasyaratnya beres | A-07, B-17, C-05, C-06, E-04 | P1 | M (1 hari) | QA |
| AI-42 | Perluas `scripts/at-verify.mjs` ke alur approval semua modul | Pencegahan regresi | P1 | M (2 hari) | Backend |

**AI-39 — sheet QA punya lima skenario yang tidak mungkin lulus karena mengetes fitur yang sudah dihapus by design.** B-01, B-18, E-05, G-06, dan H-02 semuanya mengandaikan adanya form "catat pengeluaran" manual, padahal itu dihapus mengikuti model refleksi. Selama tidak diperbaiki, sheet ini akan terus melaporkan kegagalan palsu dan menutupi kegagalan sungguhan. Sekalian: hapus catatan "Blocker diketahui" soal TIKET-03 (sudah selesai), dan pindahkan uji bukti/kamera struk (E-05, G-06, H-02) ke modul yang benar-benar mengunggah bukti sekarang.

**AI-42** — `at-verify.mjs` sekarang menguji alur approval lewat modul pengeluaran; setelah AI-01/AI-12 jalur itu berubah. Ganti dengan alur multi-modul (pemupukan → inbox → setujui → angka laporan berubah), supaya AKAR-1 tidak bisa kambuh tanpa terdeteksi.

---

## 10b. Status pelaksanaan Sprint 1 — diperbarui 23 Agustus 2026

Dikerjakan langsung di working tree (belum di-commit, belum PR). Baseline sebelum
mulai: `tsc` 0 error · `lint` 0 error/13 warning · `db:test` 21/0 ·
`db:test:adversarial` 36/0 · 37 migrasi terpasang tanpa drift. Setelah seluruh
perubahan di bawah: **keempat angka itu tetap sama**.

| Item | Status | Bukti |
|---|---|---|
| AI-27a matriks role → menu | **selesai** | `Sidebar.tsx` + `BottomNav.tsx`; hanya 2 pembatasan yang route-nya benar-benar dipagari |
| AI-27b pemagaran route | **selesai** | `requirePageRole()` + `AksesDitolak.tsx`; diuji per peran lewat HTTP (tabel di bawah) |
| AI-29 Edit Master Data | **selesai** | `MasterDataManager.tsx` (ItemRow), + bug `sortOrder` di action |
| AI-31 entitas kedua | **selesai** | DEMO2 (1 estate, 4 blok MJU-xx) + akun baru `admin.multi@demo.invalid` |
| AI-34 label enum | **selesai** | `src/lib/labels.ts`; SQL mengembalikan nilai mentah, label dirakit di TS |
| AI-13 cabang sukses Ajukan | **selesai sebagian** | patch dipasang; B-13 disempitkan (server & form bersarang dikecualikan) tapi **belum ditutup** — lihat catatan |
| AI-14 revalidasi modul asal | **selesai** | `DECIDE_PATH` ber-kunci tunggal di `actions/costing.ts` |
| AI-12 kode mati pengeluaran | **selesai (jadi komentar)** | keputusan dibalik — lihat catatan |
| AI-03 field driver biaya | **selesai** | volume driver jadi wajib di 4 modul; pesan galat menyebut akibatnya; diuji lewat HTTP |
| AI-06 `COALESCE(...,0)` | **selesai** | migrasi `0038_honest_null_cost_views.sql`; per kolom, bukan borongan |
| AI-39 revisi sheet QA | **selesai** | [14-revisi-sheet-qa-20260823.md](14-revisi-sheet-qa-20260823.md) |

### Hasil pemagaran route (diuji lewat HTTP, bukan klaim)

| Akun | `/pengaturan` | `/pengaturan/master-data` | `/pengguna` |
|---|---|---|---|
| creator@demo.invalid | ditolak | ditolak | ditolak |
| approver@demo.invalid | ditolak | ditolak | terbuka |
| direktur@demo.invalid (viewer) | ditolak | ditolak | ditolak |
| admin@demo.invalid | terbuka | terbuka | terbuka |

Halaman penolakan berstatus HTTP 200 (bukan 403): `forbidden()` di Next 16.2.9
masih eksperimental dan menuntut flag `experimental.authInterrupts`. Buktinya
dibaca dari isi halaman (`data-testid="akses-ditolak"`).

### Verifikasi akhir Sprint 1 (dijalankan 23 Agustus 2026)

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm run lint` | 0 error · 13 warning (sama dengan baseline) |
| `npm run build` | sukses |
| `npm run db:verify` | tidak ada drift checksum |
| `npm run db:test` | 21 PASS · 0 FAIL |
| `npm run db:test:adversarial` | 36 PASS · 0 FAIL |
| `npm run at:verify` | 18 PASS · 11 FAIL — kesebelasnya known-fail, lihat dokumen 14 §E |
| `npm run db:check` | 4 penghalang (stub login + 3 tenant demo), 4 catatan non-blocking — semuanya memang diketahui |
| `app.check_rls_coverage()` | 0 baris (diperiksa di dalam migrasi 0038, migrasi gagal bila bocor) |

### Dua temuan tambahan yang ikut diperbaiki

- **`npm run db:check` tidak bisa dijalankan sama sekali.** Skrip itu one-liner
  `node -e` di `package.json` dengan tanda kutip bertumpuk (JSON di dalam shell di
  dalam JS), sehingga shell memecahnya dan perintahnya gagal parse. CLAUDE.md
  menyebutnya "gate produksi", jadi selama ini gate-nya tidak pernah benar-benar
  ada. Dipindahkan ke `db/check-readiness.mjs` (pola yang sama dengan skrip `db/*`
  lain) dan sekarang keluar dengan kode 1 bila ada baris blocking, supaya bisa
  dipakai di pipeline.
- **Pesan uji di `at-verify.mjs` mencetak `Number(null)` sebagai 0.** Baris
  "klik blok menarik biaya hidupnya — Rp 0" ternyata BUKAN bukti COALESCE di view:
  route `/api/blocks/[id]/summary` sudah benar mengembalikan null, dan angka 0 itu
  dibuat oleh pesan uji itu sendiri. Jebakan `Number(null)` yang sama, tapi di
  harness — dan ia sempat menyesatkan pembacaan saya sendiri. Sekarang mencetak "—".
  (Bukti COALESCE yang sungguhan ada di baris anggaran: `6000000.00|0|false`.)

### Tiga koreksi terhadap dokumen ini sendiri

1. **AI-12 dibalik: JANGAN hapus apa pun.** Dua premis §3 salah.
   `submitExpenditureAction` BUKAN kode mati — ia dipakai `SubmitButton.tsx` yang
   dirender layar Pengeluaran hari ini. Dan `createExpenditureAction` adalah
   satu-satunya pemanggil `putEvidence()`, sementara `ExpenditureForm.tsx` memuat
   satu-satunya `<input type="file">` di seluruh `src/`. Menghapusnya berarti
   aplikasi kehilangan seluruh kemampuan unggah bukti, dan AI-52 justru akan
   memasangnya kembali. Yang dikerjakan: komentar penanda di 4 tempat.
2. **AI-14: "MODULE_PATH sudah ada, pakai itu" salah.** `MODULE_PATH`
   (`actions/operational.ts`) ber-kunci JAMAK nama tabel (`harvest_records`),
   sedangkan Inbox mengirim `module_key` TUNGGAL (`harvest_record`, lihat CASE di
   `app.decide_record()`, migrasi 0034). Mengimpornya akan membuat
   `revalidatePath(undefined)` melempar TypeError SESUDAH keputusan ter-commit —
   approver melihat "gagal" untuk keputusan yang berhasil, yaitu gejala BUG-01
   yang sudah pernah ditutup. Dipakai peta baru ber-kunci tunggal + `if (p)`.
3. **AI-31: akses ganda tidak boleh diberikan ke `admin@demo.invalid`.**
   `resolveLogin()` menaruh akun bermultientitas di mode "semua entitas"
   (`companyId` null); di mode itu `createMasterItem` menulis `company_id = NULL`
   yang diloloskan `master_items_global_admin_only` untuk super_admin — item
   master menjadi GLOBAL lintas tenant. Ini bukan teori: hal yang sama sudah
   terjadi pada `admin@agrovision.local` (DEV + PILOT dari `db:import:pilot`) dan
   membuat `at:verify` mati di AT2. Dipakai akun baru `admin.multi@demo.invalid`;
   `admin@demo.invalid` tidak diubah. Ditambah guard `if (!ctx.companyId)` di tiga
   action `master.ts` (create/update item, create fertilizer type) meniru pola
   `createExpenditureAction`.

### Temuan baru (belum ada itemnya)

- **`at:verify` mati sebelum menguji apa pun** — dua sebab, keduanya sudah
  diperbaiki di harness-nya: (a) AT6 membaca
  `src/app/(app)/laporan/keuangan/page.tsx` yang tidak ada lagi (laporan sudah
  satu route dinamis) sehingga `readFileSync` melempar ENOENT dan seluruh suite
  keluar exit 1; (b) `login()` tidak memilih entitas, sehingga
  `admin@agrovision.local` (2 entitas) mendarat di mode "semua entitas" dan semua
  form tulis tersembunyi. Setelah diperbaiki: **18 PASS / 11 FAIL** (sebelumnya
  0 cek selesai). Kesebelas kegagalan itu bukan regresi — semuanya bermuara pada
  jalur pengeluaran manual yang memang dihapus (AI-52) dan `COALESCE(...,0)`
  (AI-06); "klik blok menarik biaya hidupnya — **Rp 0**" adalah AI-06 yang
  terlihat langsung di layar.
- **`db:seed:demo` tidak idempoten** (pre-existing): `INSERT INTO app.estates`
  tanpa `ON CONFLICT`, jadi menjalankannya dua kali gagal pada
  `estates_company_id_code_key`. Harus `db:purge:demo` lebih dulu. Layak
  diperbaiki bersama AI-42.
- **Harga beli aset Agri-Input belum digate.** `agri-input/chemical/page.tsx` dan
  `equipment/page.tsx` memakai `canWrite = [creator, approver, super_admin]` dan
  field "Harga beli (Rp)" ada di dalam form yang sama — padahal K-06 Keputusan 3
  menetapkan harga = super_admin saja.
- **Enum mentah di Inbox Approval — SELESAI 23 Agu 2026.** `app.v_pending_approvals`
  merangkai `w.method` dan `h.crop_code` di dalam SQL (migrasi 0034:241,258 / 0036).
  Diperbaiki lewat migrasi baru **`0039_inbox_enum_codes.sql`**: `detail` tidak lagi
  memuat kode enum, dan dua kolom baru (`crop_code`, `method_code`) mengembalikan
  KODE-nya supaya lapisan tampilan yang memberi label. `params` dibiarkan mentah —
  kuncinya ('Metode', 'Komoditas', 'Fase', 'Status') sudah cukup bagi `labelParam()`
  di `src/lib/labels.ts` untuk memilih peta, jadi jsonb-nya tidak perlu dibongkar di
  SQL. Dibuktikan di layar: kolom Detail kini berbunyi "Durian · 8.200 ton · Grade B",
  dan tidak ada satu pun token `DURIAN`/`manual`/`ready_to_plant` tersisa di
  `/approval`.
- **Layar uang belum dibatasi, dan itu disengaja.** Menyembunyikan Dashboard
  Finansial/Refleksi/Revenue/Anggaran dari creator tanpa memagari route-nya hanya
  menghapus discoverability: angka yang sama masih terbaca lewat
  `/laporan/keuangan` beserta `/pdf` dan `/excel`. Pembatasannya harus satu paket
  dengan `src/lib/report/registry.ts` (AI-44/AI-47) **dan** revisi kolom Role di
  QA E-01/E-02/F-01 yang sekarang bertuliskan "Semua" dan berstatus lulus.
- **B-13 masih terbuka, tapi sudah jauh lebih sempit.** Yang sudah DIBUKTIKAN,
  bukan diduga:
  1. **Jalur servernya benar.** Siklus penuh diuji lewat HTTP: catat draft →
     ajukan → approver tolak dengan alasan → creator **ajukan ulang**. Hasilnya
     HTTP 200 dalam 54 ms, `approval_status` berpindah `rejected` → `submitted`,
     dan `rejection_reason` ikut dibersihkan (`submitOpRecord` memang menyetel
     `rejection_reason = NULL`). Jadi ini bukan RLS, bukan policy `*_role_split`,
     bukan `n === 0`, dan bukan galat Server Action.
  2. **Bukan form bersarang.** Kedalaman `<form>` pada keenam halaman modul
     diperiksa dari HTML terender: semuanya 1, tidak ada yang bersarang.
  Sisa kemungkinannya ada di sisi klien (transisi `useActionState` yang tidak
  pernah selesai), dan itu **tidak bisa dibuktikan tanpa menjalankan browser
  sungguhan** — tidak tersedia di sesi ini. Saya sengaja TIDAK menambal secara
  spekulatif: menutup B-13 dengan perbaikan yang tidak menjelaskan gejalanya sama
  dengan menyembunyikan bug-nya.
  **Resep reproduksi (fixture sudah disiapkan di DB lokal):** login
  `creator@demo.invalid` → `/aktivitas/weeding` → cari baris **9,99 ha · Mekanis**
  berstatus Ditolak (alasan "foto struk buram") → tekan **Ajukan** dengan DevTools
  terbuka. Yang perlu dicatat: (a) tab Network — apakah POST ke `/aktivitas/weeding`
  mengembalikan 200 atau menggantung; (b) tab Console — ada galat hidrasi/runtime?
  (c) apakah spinner berhenti setelah halaman di-refresh manual. Jawaban (a)
  memisahkan dua kemungkinan yang tersisa: menggantung = jaringan/transisi router,
  200 tapi spinner tetap jalan = React tidak menyelesaikan transisinya.

---

## 10c. Status pelaksanaan Sprint 2 — diperbarui 23 Agustus 2026

Rantai migrasi **0040–0044** terpasang. Verifikasi akhir: `tsc` 0 error · `lint` 0 error/13 warning ·
`db:test` **23/0** (naik dari 21, tiga cek baru K-04) · `db:test:adversarial` **37/0** (naik dari 36,
cek policy 0040) · `at:verify` 18/11 (known-fail tak berubah) · `check_rls_coverage()` dan
`check_privilege_revocations()` **nol baris** · tanpa drift checksum.

| Item | Status | Bukti terukur |
|---|---|---|
| AI-02 driver refleksi lengkap | **selesai** | 0041: `weeding_area_ha`, `spraying_volume`, `pruning_tree_count` terisi — akar B-05/B-07 |
| AI-04 penguncian tarif per periode | **selesai** | 0041 + TS. Terbit 750rb→825rb: versi 1 ditutup, `price_at('WEED-HA','2026-08-01')` **tetap 750rb** |
| AI-45 buku besar stok | **selesai** | 0042: saldo awal 5 item/2.500 unit pindah ke ledger, `stock_qty` dihapus, alert reorder hidup (QA D-01 akhirnya bisa diuji) |
| AI-01 materialisasi biaya | **selesai** | 0043 + backfill 0044 (20 baris, Rp 1,397 M). Approve penyiangan 4 ha → `4.000 × 750.000 = 3.000.000`, kategori LABOR, periode dari **tanggal kejadian** |
| AI-17 larangan self-approval | **selesai** | `ERROR: creator tidak boleh memutuskan record buatannya sendiri (AI-17)` |
| AI-18 supersede kesesuaian | **selesai** | 0043: indeks aktif per `(block_id, crop_id)`; blok boleh dinilai durian **dan** kelapa |
| AI-19 / AI-20 / AI-50 jalur input | **selesai** | AI-19 teruji end-to-end sampai Disetujui; 0040 untuk AI-50 |
| **AI-52** form overhead & upah | **selesai** | Form dipasang kembali dengan peringatan berbasis data (`autoMaterializedCategories`). Ini yang membuka 11 known-fail: **at:verify 18/11 → 43/0** |
| **AI-11** edit record ditolak | **selesai** | Editor per baris draft/ditolak; invarian `ct_role_split` menuntut status kembali ke `draft` — diuji 6/6 |
| AI-05 form anggaran per scope | **selesai** | `budgetSchema` superRefine dua arah + `BudgetForm` dinamis pasca-hidrasi. 12 cek `at:verify` baru (6 pasangan ditolak, 2 sah, 4 struktur form) |
| AI-44a tambah baris tarif | **selesai** | `createPriceRowAction` + `PriceRowForm` (`<details>`, jalan tanpa JS) + kolom driver/satuan/status + migrasi 0045. 11 cek `db:test`, 17 cek adversarial, 10 cek `at:verify` |

### Catatan §6.7 terjawab: anggaran ↔ realisasi kini ter-link

| Periode | Kategori | Anggaran | Realisasi | Serapan |
|---|---|---|---|---|
| Fase 1 | Persiapan Lahan | 1,4 M | **952.500.000** | **68,04%** |
| Fase 1 | Tenaga Kerja | 1,1 M | 29.250.000 | 2,66% |

### Taksonomi kategori biaya — dijawab dari data (pertanyaan pemilik produk, 23 Agu)

Ada DUA taksonomi hidup bersamaan, dan hanya satu yang mengikat:

- **Kunci akuntansi** = `cost_category_id` → Master Data › Kategori Biaya. Ini yang dipakai `budgets`,
  jadi realisasi WAJIB memakainya juga; kalau tidak, perbandingan anggaran membandingkan dua sumbu.
- **Label tampilan** = `price_list.category`, teks bebas, isinya campur aktivitas ("Penyiangan",
  "Pruning") dan sumber daya ("Pupuk", "Pengadaan bibit"). Kosmetik, bukan kunci.

Pemetaan hasil 0041: WEED-HA → **LABOR**, PRUNE-TREE → **LABOR**, PREP-HA → LANDPREP,
FERT-KG → FERTILIZER, SEED-UNIT → SEEDLING, LABOR-DAY → LABOR. Penyiangan & pruning masuk LABOR
konsisten dengan keputusan arsitektur #7 (biaya tenaga kerja masuk costing per blok).

**Dua lubang menunggu keputusan** (bisa diisi lewat `app.update_price_meta()`, tanpa migrasi):
`SPRAY-L` (Penyemprotan) dan `MAP-HA` (Pemetaan) belum punya kategori master yang jujur, jadi
`cost_category_id`-nya NULL dan baris biayanya tidak match anggaran mana pun. Usul: penyemprotan
dipecah — bahan ke kategori baru `PESTICIDE` (sejajar FERTILIZER), tenaga ke LABOR; pemetaan ke
`SERVICE` yang sudah ada.

**Granularitas**: 34 sub-kategori (Bibit Durian, Land Clearing, Pupuk Tunggal, …) **belum dipakai
sama sekali** — anggaran maupun tarif keduanya di tingkat induk. Laporan biaya karena itu sedetail
induk. Memakai sub-kategori menuntut tarif per sub-kategori DAN anggaran per sub-kategori; selama
tarifnya masih satu per aktivitas, sub-kategori tidak akan pernah terisi angka.

### Tambahan setelah AI-52 & AI-11 (23 Agu, sore)

- **`at:verify` 18/11 → 43/0.** Memasang kembali form pengeluaran (AI-52) membuat AT1/AT3/AT4 —
  inti acceptance test biaya — benar-benar berjalan: 3 pengeluaran, ajukan, setujui 2 tolak 1, dan
  "klik blok menarik biaya hidupnya — Rp 7.000.000 · cost/ha Rp 70.250".
- **Layar finansial kini menampilkan peringatan "anggaran terlampaui"** yang sebelumnya HANYA ada di
  PDF, dan kalimat "pendapatan & break-even sengaja kosong" disamakan dengan versi PDF-nya (arah AI-47:
  layar dan ekspor tidak boleh mengatakan hal berbeda tentang angka yang sama).
- **Satu assertion `at-verify` yang basi diperbarui**: layar laporan sengaja tidak lagi mencetak nama
  view SQL (`v_budget_vs_actual`) ke manajemen, jadi uji provenance-nya diubah menjadi memeriksa isi
  yang hanya bisa berasal dari jalur definisi itu.
- **`pickForm` di harness diperkuat**: penanda kini dicocokkan ke seluruh elemen `<form>` sehingga
  `data-testid` bisa dipakai. Sebelumnya menambah satu form ke halaman bisa membuat uji menembak form
  yang salah, dan kegagalannya muncul jauh kemudian sebagai "0 approved".
- **Cakupan AI-52 TIDAK dibatasi per kategori** — sengaja. `LABOR` lahir otomatis dari penyiangan &
  pruning TAPI upah harian (`LABOR-DAY`, tanpa driver) memang harus dicatat tangan; memblokir
  kategorinya akan mematikan kebutuhan yang membuat form ini ada. Penjaganya peringatan berbasis data.

### Sprint 2 selesai — dua item terakhir (23 Agu 2026, malam)

**AI-44a · tambah baris tarif (K-09 §19).** Sebelum ini `INSERT INTO app.price_list`
hanya ada di `db/seed-demo.mjs`, jadi setiap tarif baru menuntut migrasi — itulah
yang membuat AI-44a menjadi prasyarat K-03. Sekarang ada `createPriceRowAction` →
`app.publish_price()` (bukan INSERT langsung: `app_rw` tidak punya privilege itu,
ledger 0041 §7). Kolom `driver`/`unit`/`is_active` yang menentukan perilaku tapi
tidak pernah terlihat kini menjadi kolom tabel, dan baris tanpa driver ditandai
"tarif manual" **di barisnya**, bukan sebagai catatan kaki.

Tiga hal yang muncul saat mengerjakannya:

1. **`PriceRateEditor` dipindah dari `useState` ke `<details>`.** Jebakan yang sudah
   tercatat, tapi akibatnya lebih besar dari perkiraan: form penerbitan tarif TIDAK
   ADA di HTML server, jadi tanpa JavaScript tarif tidak bisa diubah sama sekali —
   pada satu-satunya layar yang mengendalikan seluruh angka keuangan.
2. **Kode yang sudah ada harus ditolak jalur create.** `app.publish_price()` mengenali
   "kode sudah ada" dan menempuh cabang **versi baru**. Tanpa pemeriksaan terpisah,
   menekan "tambah baris" pada kode yang sudah ada akan MENGUBAH tarif berjalan dan
   pesannya tetap berbunyi sukses.
3. **`chemical_id` sengaja tidak diekspos.** Tarif per bahan adalah kemampuan nyata
   (`price_for_driver` memenangkan baris ber-`chemical_id`), tapi "bahan mana yang
   pantas punya tarif sendiri" adalah keputusan produk yang belum diambil.

**Migrasi 0045 — satu tarif aktif per (entitas, driver, bahan).** `app.price_for_driver()`
memilih baris dengan `LIMIT 1` dan MENGANDAIKAN hanya ada satu kandidat generik;
andaian itu tidak pernah ditegakkan. Dua baris aktif ber-driver sama membuat biaya
yang dimaterialisasi `app.decide_record()` bergantung pada urutan **kode**, bukan pada
fakta ekonomi — dan membuat `reflectedCosts()` mengalikan volume yang sama dua kali.
Selama tarif hanya lahir dari seed hal itu tidak pernah terjadi; membuka jalur create
memaksa andaian itu menjadi invarian database. `NULLS NOT DISTINCT` supaya dua baris
generik tetap bertabrakan.

**AI-05 · form anggaran dinamis per lingkup (catatan 6.7).** Dua bagian:

- **`budgetSchema` menegakkan pasangan DUA ARAH.** Arah pertama (lingkup menuntut
  pengenalnya) sudah ada. Arah kedua hilang: `createBudget()` diam-diam mem-NULL-kan
  pengenal yang tidak cocok supaya CHECK `budgets_scope_coherent` tidak menolak. Jadi
  memilih "Seluruh entitas" + Estate Sungai Danau lalu menekan simpan memberi pesan
  "Anggaran tersimpan" — untuk anggaran **se-entitas**. Pilihan estate-nya hilang tanpa
  satu kata pun, dan pada layar anggaran itu bukan kosmetik: yang hilang bukan sebuah
  field tapi **arti angkanya**.
- **Tampil/sembunyi berlaku SESUDAH hidrasi.** Seluruh field tetap ada di HTML server;
  `useSyncExternalStore` memberi `false` di server dan `true` di klien (bukan
  `useEffect(setState)` — dilarang `react-hooks`, cascading render). Field yang
  disembunyikan juga di-**`disabled`**: select tersembunyi TETAP ikut terkirim, dan
  sejak AI-05 server menolaknya.

**Penyimpangan dari catatan 6.7 yang perlu diketahui pemilik produk:** catatan itu
menulis "Scope Semua → tampilkan Estate dan Blok". Itu tidak bisa dijalankan — CHECK
`budgets_scope_coherent` menuntut `estate_id` DAN `block_id` NULL untuk lingkup
`company`, jadi field yang ditampilkan itu pasti ditolak begitu diisi. Lingkup
"Seluruh entitas" karena itu menyembunyikan keduanya.

### AI-02 ditandai selesai padahal separuhnya tidak dikerjakan

§10c sebelumnya menandai AI-02 selesai dengan bukti migrasi 0041 saja. §3 (AKAR-2)
mendefinisikannya sebagai migrasi **dan** `DRIVER_SQL`/`DRIVER_LABEL` di
`src/lib/repo/pricing.ts`. Bagian TypeScript-nya terlewat, dan `reflectedCosts()`
punya `if (!sql) continue` — jadi tiga baris tarif yang mendapat driver di 0041
(WEED-HA, SPRAY-L, PRUNE-TREE) **dilewati tanpa suara**.

Terukur dari halaman terender `/costing/refleksi` (DEMO, `admin@demo.invalid`):

| | Baris biaya | Total |
|---|---|---|
| sebelum | 4 | Rp 1.016.009.126 |
| sesudah | 7 | **Rp 1.053.009.126** |

Selisih Rp 37.000.000 = penyiangan 47 ha × 750rb + penyemprotan 70 liter × 25rb.
PILOT understate **Rp 414.130.000** (SPRAY-L 15.734,8 liter + PRUNE-TREE 1.384 pohon).
Angka yang sama sudah benar di `cost_transactions` sejak 0043, jadi layar Refleksi dan
Dashboard Finansial menyebut angka berbeda untuk hal yang sama — pola yang AI-47 ada
untuk menghapus.

Ikutan yang ikut diperbaiki: `COALESCE(SUM(...),0)` dibuang dari `DRIVER_SQL`. Baris
"Pupuk (agri-input) — 0 kg — **Rp 0**" adalah angka fabrikasi (doktrin: `null` = belum
ada data, dirender em-dash, BUKAN 0). AI-06 membersihkan sisi SQL; sisi TypeScript ini
terlewat dan **tidak tertangkap AT6** karena angkanya dihitung, bukan literal. Satuan
tidak dicetak di sebelah em-dash — "— ha" terbaca seperti nol hektar.

Driver yang tak dikenal maupun bentrok tidak lagi hilang diam-diam: `unknownDrivers`
dan `driverConflicts` dirender sebagai peringatan di layar.

### Verifikasi akhir Sprint 2 (23 Agustus 2026, malam)

| Pemeriksaan | Awal sesi | Sekarang |
|---|---|---|
| `npx tsc --noEmit` | 0 error | 0 error |
| `npm run lint` | 0 error · 13 warning | 0 error · 13 warning |
| `npm run build` | sukses | sukses |
| `npm run db:verify` | 44 migrasi, tanpa drift | **45** migrasi, tanpa drift |
| `npm run db:test` | 23 / 0 | **34 / 0** |
| `npm run db:test:adversarial` | 37 / 0 | **54 / 0** |
| `npm run at:verify` | 43 / 0 | **65 / 0** |
| `app.check_rls_coverage()` | 0 baris | 0 baris |
| `app.check_privilege_revocations()` | 0 baris | 0 baris |
| `npm run db:check` | 4 penghalang | 4 penghalang (sama) |

`db:test` dan `at:verify` idempoten: dijalankan dua kali berurutan, angkanya sama.
`db/verify-dates.mjs` 0 FAIL di kedua zona (WIB 20 PASS, UTC 19 PASS + 1 SKIP — cek
"pola lama terbukti menggeser" memang hanya bermakna di zona offset positif).

### Yang harus diketahui sebelum melanjutkan

- **Rantai 0041–0044 diterapkan TANPA telaah adversarial.** Empat dari lima agen workflow mati kena
  batas kuota bulanan organisasi; hanya arsiteknya selesai. Saya menelaah sendiri (satu lensa) dan
  memverifikasi tiap migrasi terhadap DB nyata sebelum menerapkan — tapi sepanjang sesi ini SETIAP
  ronde telaah adversarial menemukan temuan blocking, jadi ketiadaannya di sini adalah risiko nyata,
  bukan formalitas. Telaah ulang sebelum menyentuh produksi.
- **Lapisan TS ditulis tangan menggantikan agen yang mati**, mencakup yang wajib menyertai migrasi:
  `getPriceList` menyaring `valid_to IS NULL` (tanpa ini refleksi menjumlahkan tarif lama + baru),
  `setPriceRate` → `publishPriceRate` lewat `app.publish_price()`, gerbang tarif menyempit ke
  super_admin (§17 Keputusan 3), dan 12 situs `stock_qty` pindah ke `v_agri_input_stock`.
- **Editor tarif belum jalan tanpa JavaScript.** `PriceRateEditor` memakai toggle `useState`, jadi
  formnya tidak ada di HTML server — pola yang sama sudah dicatat untuk OrganicTracker/RegistryGroup.
- **Panen sengaja belum dimaterialisasi**: revenue bukan `cost_transactions`, dan grain-nya berubah
  di K-03 (harga per grade). Ditunda ke AI-07.
- Sisa fixture uji di DB demo: kategori `TEST320433` dengan anggaran Rp 6 jt, dan periode
  `Fase Uji 320433` — layak dibersihkan.

---

## 11. Rencana sprint

**Sprint 0 — keputusan (2–3 hari, paralel dengan Sprint 1)**
**Seluruh keputusan wajib sudah selesai (22–23 Agu 2026): K-01, K-02, K-03, K-04** (lihat §13–§16). Sprint 1 dan 2 boleh jalan. **K-05 dan K-06 juga sudah diputuskan 23 Agu 2026** (§17 untuk K-06). Tersisa K-07 (sebaiknya segera, memblokir W7), lalu K-08/K-09/K-10 menyusul sebelum workstream-nya masing-masing dimulai.

**Sprint 1 — keamanan & perbaikan murah (1 minggu)**
AI-27 (keamanan, kerjakan pertama), AI-03, AI-06, AI-13, AI-14, AI-29, AI-31, AI-34, AI-12, AI-39.
Selesai bila: petugas lapangan tidak lagi melihat menu yang bukan haknya; B-13 lulus; enum mentah hilang dari UI; A-07 bisa dijalankan; sheet QA bersih dari skenario basi.

**Sprint 2 — akuntansi + jalur input yang belum ada (2–3 minggu)**
AI-01, AI-02, AI-04, **AI-44a**, AI-05, AI-11, AI-17, AI-45 · **dan W3: AI-19, AI-20, AI-50, AI-52.**
Digabung karena keputusan 23 Agu 2026: sasarannya modul **terpakai**, bukan laporan yang tampil dengan data demo. Angka akuntansi juga tidak akan bergerak tanpa jalur input ini — AI-50 mengisi driver `seedling_qty`, AI-52 mengisi overhead/upah.
Selesai bila: menyetujui satu aktivitas menaikkan realisasi anggaran; mengubah tarif tidak mengubah nilai historis; approver tidak bisa menyetujui ajuannya sendiri; **dan setiap tabel ber-`approval_status` punya jalur input yang bisa dipakai creator.**

**Sprint 3 — laporan & dashboard (2 minggu)**
AI-47, AI-48, AI-21, AI-22, AI-24, AI-28, AI-51.
Selesai bila: tidak ada lagi skenario BLOCKED; unduhan PDF/Excel identik dengan layar; tidak ada laporan melebihi 8 kolom di mobile; filter dashboard benar-benar mengubah angka.

**Sprint 4 — pemolesan & laporan (1–2 minggu)**
AI-07, AI-08, AI-09, AI-10, AI-16, AI-23, AI-25, AI-26, AI-30, AI-32, AI-33, AI-35, AI-36, AI-37, AI-38, AI-43, AI-44b, AI-46.

AI-45 (buku besar stok) masuk **Sprint 2**, bukan Sprint 4: ia menulis lewat `app.decide_record()` yang sama dengan AI-01, jadi harus satu paket.

Paralel sepanjang waktu: AI-40, AI-41, AI-42. AI-49 (seed demo) hanya bila review manajemen perlu digelar sebelum Sprint 2 selesai.

---

## 12. Syarat selesai (berlaku untuk setiap item)

- `npm run lint` bersih dan `npx tsc --noEmit` bersih.
- Setiap perubahan skema = **migrasi baru**; file migrasi yang sudah diterapkan tidak boleh diedit (checksum ledger akan menolaknya).
- Perubahan yang menyentuh RLS/role/approval wajib disertai kasus baru di `db/verify-adversarial.mjs`; `app.check_rls_coverage()` dan `app.check_privilege_revocations()` harus tetap mengembalikan nol baris.
- Perubahan alur pengguna wajib disertai skenario di `scripts/at-verify.mjs`.
- `npm run db:check` — baris `blocking` tetap nol (kecuali stub login dan tenant demo yang memang diketahui).
- Nilai kosong tetap "—", tidak pernah 0. Berlaku juga di view SQL (lihat AI-06).
- Diuji di 375 px sebelum PR (checklist wajib di template PR).

---

## 13. Lampiran · K-01 — desain yang diputuskan (Opsi A: materialisasi saat approval)

> Diputuskan 22 Agustus 2026. Bagian ini mengikat AI-01, AI-04, AI-05, AI-09, dan AI-11.

### Contoh kasus

Blok **PILOT-01** (2 ha). Anggaran Fase Pemeliharaan, kategori Pupuk = Rp 5.000.000.

| Tanggal | Kejadian |
|---|---|
| 5 Agu 2026 | Creator catat pemupukan NPK 50 kg di PILOT-01 |
| 6 Agu 2026 | Approver menyetujui |
| 20 Agu 2026 | Tarif pupuk di Price List diubah: Rp 12.000 → Rp 13.000/kg |

### Sebelum (perilaku sekarang)

| Layar | Angka | Sebab |
|---|---|---|
| Refleksi Biaya | Rp 600.000 | dihitung ulang saat render (`src/lib/repo/pricing.ts:91`) |
| Anggaran vs Realisasi | Realisasi Rp 0 | `v_budget_vs_actual` baca `cost_transactions` yang kosong |
| Biaya per blok | Rp 0 · cost/ha Rp 0 | `v_block_cost_summary` idem |
| Refleksi, setelah 20 Agu | Rp 650.000 | tarif baru dipakai ulang untuk kejadian 5 Agustus |

### Sesudah (Opsi A)

Saat `app.decide_record()` mengubah status menjadi `approved`, ia menulis satu baris biaya:

```sql
INSERT INTO app.cost_transactions (
  company_id, block_id, fiscal_period_id, cost_category_id,
  transaction_date, quantity, uom_item_id, unit_price_idr, amount_idr,
  approval_status, created_by, source_table, source_record_id
) VALUES (
  :company, :block_pilot01, :periode_agustus_2026, :kategori_pupuk,
  '2026-08-05', 50, :kg, 12000, 600000,
  'approved', :approver, 'fertilizer_applications', :record_id
);
```

| Layar | Sebelum 20 Agu | Setelah tarif naik |
|---|---|---|
| Anggaran vs Realisasi | Rp 600.000 / Rp 5.000.000 (12%) | **tetap** Rp 600.000 |
| Biaya per blok | Rp 600.000 · Rp 300.000/ha | **tetap** |
| Pemupukan yang dicatat 25 Agu | — | pakai tarif Rp 13.000 |

`unit_price_idr` adalah snapshot-nya; kenaikan tarif hanya berlaku untuk record sesudahnya.

### Kenapa Opsi A

- Kolomnya sudah disiapkan sejak `0016_costing_fix.sql:50-67` (`fiscal_period_id`, `cost_category_id`, `quantity`, `uom_item_id`, `unit_price_idr`) — memang untuk pola ini. Yang baru hanya `source_table` + `source_record_id`.
- Seam rekonsiliasi ERP (`external_document_no`, keputusan arsitektur #1) hanya bermakna bila baris transaksinya ada.
- View realisasi tidak perlu di-JOIN ulang setiap kali ada modul aktivitas baru.

### Aturan pelaksanaan (bagian dari keputusan)

1. **Pemicu di database**, di dalam `app.decide_record()` — bukan di Server Action — supaya tidak bisa dilewati lewat POST langsung.
2. **Tarif belum ada saat approve** → approval tetap boleh jalan, `amount_idr` NULL, record masuk daftar "belum bertarif". Konsisten dengan doktrin "—, bukan 0".
3. **Koreksi setelah disetujui** → tulis **baris pembalik**, jangan UPDATE baris lama. Jejak audit tetap utuh.
4. **Idempotensi** → `UNIQUE (source_table, source_record_id)` untuk baris non-pembalik, supaya alur tolak → perbaiki → ajukan → setujui tidak menghasilkan biaya ganda.
5. **Overhead & upah tenaga kerja** belum punya jalur input sama sekali (`ct_overhead_scope` mengizinkan `block_id` NULL; keputusan arsitektur #7 menaruh labor di costing per blok). Perlu diputuskan terpisah: refleksi otomatis untuk aktivitas lapangan + form manual **khusus** overhead/upah. Bila itu dipilih, `ExpenditureForm.tsx` dipasang kembali dengan cakupan dipersempit — bukan dihapus (lihat AI-12).

---

## 14. Lampiran · K-02 — desain yang diputuskan (Opsi 1: versi tarif di `price_list`)

> Diputuskan 22 Agustus 2026. Bagian ini mengikat AI-04 dan AI-07.

### Kenapa snapshot saja tidak cukup

Snapshot `unit_price_idr` dari K-01 mengunci tarif **pada saat approval**. Yang benar adalah tarif **pada saat kejadian**. Dua momen itu sering berbeda: approver menyetujui beberapa hari kemudian, atau record dicatat mundur.

Tarif pupuk NPK:

| Versi | Tarif | Masa berlaku |
|---|---|---|
| v1 | Rp 12.000/kg | 1 Jan 2026 – 19 Agu 2026 |
| v2 | Rp 13.000/kg | 20 Agu 2026 – sekarang |

| Record | Jumlah | Tgl kejadian | Tgl disetujui | Tarif benar | Nilai benar | Bila snapshot pakai tarif saat approve | Selisih |
|---|---|---|---|---|---|---|---|
| A | 50 kg | 5 Agu | 6 Agu | v1 | Rp 600.000 | Rp 600.000 | — |
| B | 40 kg | 10 Agu | **22 Agu** | v1 | Rp 480.000 | Rp 520.000 | **+40.000** |
| C | 30 kg | 25 Agu | 26 Agu | v2 | Rp 390.000 | Rp 390.000 | — |
| D | 20 kg | **3 Agu** (dicatat mundur) | 27 Agu | v1 | Rp 240.000 | Rp 260.000 | **+20.000** |

Total benar Rp 1.710.000; snapshot-saat-approve Rp 1.770.000 — salah Rp 60.000 hanya dari empat record, dan selalu menggelembung ke arah tarif terbaru. Angkanya tetap terlihat wajar, jadi tidak akan ada yang curiga. Itu sebabnya ini dikerjakan sekarang, bukan nanti.

### Skema

```sql
ALTER TABLE app.price_list
  ADD COLUMN version    integer NOT NULL DEFAULT 1,
  ADD COLUMN valid_from date NOT NULL DEFAULT DATE '2026-01-01',
  ADD COLUMN valid_to   date;                    -- NULL = masih berlaku

-- satu kode kini punya banyak versi
ALTER TABLE app.price_list DROP CONSTRAINT price_list_company_id_code_key;

-- hanya boleh ada satu versi terbuka per kode
CREATE UNIQUE INDEX price_list_one_open
  ON app.price_list (company_id, code) WHERE valid_to IS NULL;

ALTER TABLE app.price_list ADD CONSTRAINT price_valid_range
  CHECK (valid_to IS NULL OR valid_to >= valid_from);
```

Satu pintu pencarian tarif, dipakai `app.decide_record()`:

```sql
CREATE FUNCTION app.price_at(p_code text, p_on date) RETURNS app.price_list
-- WHERE code = p_code AND p_on >= valid_from AND (valid_to IS NULL OR p_on <= valid_to)
```

`decide_record()` memanggil `app.price_at(kode, :tanggal_kejadian)` — **bukan** `CURRENT_DATE`. Itu yang membuat record B dan D benar.

Mengubah tarif **bukan** `UPDATE rate_idr`, melainkan: tutup versi lama (`valid_to`) + terbitkan versi baru, lewat fungsi SECURITY DEFINER `app.publish_price(...)` yang self-gate ke **`super_admin` saja** (diputuskan 23 Agu 2026, lihat §17 Keputusan 3) — meniru `app.publish_emission_factor` (`0018_security_fix.sql` §4).

### Aturan pelaksanaan (bagian dari keputusan)

1. **Granularitas masa berlaku: per tanggal.** UI memilih periode, lalu diterjemahkan ke tanggal awal periode. Alasan: anggaran di sistem ini per **fase proyek** (keputusan arsitektur #6) sedangkan `fiscal_periods` entitas lain — menyimpan rentang tanggal tidak mengikat diri ke salah satunya.
2. **Tarif mundur (backdating) dilarang**, sama seperti `publish_emission_factor`. Koreksi tarif lama = versi baru + baris pembalik pada transaksi terdampak (§13 aturan 3).
3. **`price_list` jadi append-only.** REVOKE UPDATE/DELETE dari `app_rw` wajib didaftarkan di `app.privilege_revocations` (ledger migrasi 0019) — kalau tidak, `bootstrap-role.mjs` akan membukanya kembali lewat `GRANT ON ALL TABLES`. Penutupan `valid_to` dilakukan di dalam fungsi SECURITY DEFINER.
4. **Berlaku untuk kedua `kind`** — 'cost' dan 'revenue'. Harga jual per grade (K-03) berubah lebih sering daripada tarif biaya; jangan dua mekanisme.
5. **Tarif diambil dari tanggal kejadian** — `applied_on`, `sprayed_on`, `harvested_on`, `checked_at`, `weeded_on`. Nama kolomnya berbeda tiap tabel, jadi pemetaannya harus eksplisit, bukan diasumsikan.

### Cara membuktikan

- `db/verify.mjs`: `price_at()` mengembalikan v1 untuk 10 Agu dan v2 untuk 25 Agu; menyetujui record B pada 22 Agu menghasilkan Rp 480.000, bukan Rp 520.000.
- `db/verify-adversarial.mjs`: penerbitan tarif mundur ditolak; masa berlaku tumpang tindih ditolak; `creator` tidak bisa menerbitkan tarif; `app.check_privilege_revocations()` tetap nol baris setelah `price_list` masuk ledger.

---

## 15. Lampiran · K-03 — desain yang diputuskan (satuan menempel pada grade)

> Diputuskan 22 Agustus 2026. Bagian ini mengikat AI-07 dan AI-08.

### Keputusan

**Kelapa per butir. Durian per kg. Ton tidak dipakai untuk harga.** Tetapi yang mengikat secara teknis bukan pilihan satuan itu, melainkan: **satuan disimpan sebagai data yang menempel pada grade**, bukan konstanta di kode maupun di nama kolom.

| Komoditas | Bentuk produk | Satuan harga | Grade ditentukan oleh |
|---|---|---|---|
| Kelapa | butir segar (farm gate) | **Rp/butir** | ukuran/berat butir |
| Kelapa | kopra (bila nanti diolah) | Rp/kg | kadar air, mutu |
| Durian | buah segar borongan/pengepul | **Rp/kg** | berat per buah + mutu |
| Durian | varietas premium, retail | Rp/butir | varietas, berat |

Dasarnya praktik pasar: pemanen kelapa **menghitung butir**, durian **ditimbang**. Satuan pencatatan lapangan dibuat sama dengan satuan penjualan supaya tidak ada konversi — karena konversi butuh asumsi.

⚠️ **Yang menentukan akhirnya adalah kontrak pembeli/offtaker.** Bila pengepul kelapa di lokasi ternyata membeli per kg, maka per kg yang benar. Konfirmasi ini harus selesai sebelum tarif diisi.

### Masalah pada keadaan sekarang

`harvest_records.quantity_ton numeric NOT NULL` (`0034_farm_activities_agri_input.sql:112`) memaksa pencatat mengonversi ke ton saat input. Untuk kelapa itu berarti menebak berat rata-rata per butir — persis jenis koefisien tebakan yang dilarang proyek ini (bandingkan sikap terhadap koefisien IPCC & alometrik: struktur disiapkan, angka sengaja kosong).

Lebih buruk, konversi ke ton **menghapus detail grade** yang justru diminta catatan 6.3:

| Grade | Volume | Harga | Revenue |
|---|---|---|---|
| A | 600 butir | Rp 4.000/butir | Rp 2.400.000 |
| B | 900 butir | Rp 3.000/butir | Rp 2.700.000 |
| C | 500 butir | Rp 1.800/butir | Rp 900.000 |
| **Total** | **2.000 butir** | | **Rp 6.000.000** |

Dengan model sekarang: 2.000 butir × asumsi 1,8 kg = 3,6 ton, dikalikan satu "Tarif/ton". Supaya hasilnya Rp 6.000.000, tarifnya harus Rp 1.666.667/ton — angka yang hanya benar selama bauran grade-nya persis seperti hari itu. Panen berikutnya lebih banyak grade C, angkanya salah, dan tidak ada kolom yang menjelaskan kenapa. Durian sama: grade A Rp 35.000/kg vs grade C Rp 15.000/kg adalah selisih 2,3× yang hilang begitu diratakan per ton.

### Skema

```sql
CREATE TABLE app.commodities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app.companies(id),
  code       text NOT NULL,          -- 'COCONUT', 'DURIAN'
  name       text NOT NULL,
  UNIQUE (company_id, code)
);

CREATE TABLE app.commodity_grades (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id uuid NOT NULL REFERENCES app.commodities(id),
  code         text NOT NULL,        -- 'A', 'B', 'C'
  name         text NOT NULL,        -- 'Grade A (> 900 g/butir)'
  uom_item_id  uuid NOT NULL REFERENCES app.master_items(id),   -- butir | kg
  sort_order   integer NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (commodity_id, code)
);
```

Konsekuensinya:

- **Satuan ikut grade**, jadi kelapa per butir dan durian per kg hidup di satu sistem tanpa percabangan di kode.
- Baris revenue `price_list` menunjuk `commodity_grade_id`. `REVENUE_CODE = { DURIAN: "REV-DUR-A", COCONUT: "REV-COCO" }` (`src/lib/repo/pricing.ts:87`) dihapus — di sana grade "A" ikut dibakukan ke dalam nama kode, yang berarti grade B dan C secara harfiah tidak punya tempat.
- Tarif per grade berversi mengikuti K-02 (§14).
- `harvest_records`: `quantity_ton` → `quantity` + `commodity_grade_id`; `grade text` bebas (baris 113) menjadi FK. `quantity_ton` boleh tetap ada sebagai **kolom turunan opsional**, diisi hanya bila faktor konversi terdaftar; bila tidak, tonase dirender "—".
- **Faktor konversi** (berat rata-rata per butir), bila memang dibutuhkan: data master dengan provenance — sumber, tanggal penimbangan, jumlah sampel — bukan konstanta di kode. Pola sama seperti `emission_factors`.
- `crop_code text CHECK (... IN ('DURIAN','COCONUT'))` (baris 111) menjadi FK ke `commodities`, sehingga komoditas ketiga tidak lagi menuntut migrasi CHECK constraint.

### Aturan pelaksanaan (bagian dari keputusan)

1. **Satu kejadian panen = header + baris rincian per grade.** Bukan satu baris per grade yang berdiri sendiri: dengan model datar, approval jadi per grade dan bisa terjadi grade A disetujui sementara grade C ditolak untuk panen yang sama — tidak masuk akal di lapangan. Approval di tingkat header.
2. **Agregat lintas komoditas hanya dalam Rupiah.** Begitu kelapa dalam butir dan durian dalam kg, "total tonase" di dashboard kehilangan makna. Volume ditampilkan **per komoditas dalam satuan aslinya**.
3. **Jangan seed tarif tebakan.** Keputusan arsitektur #8: belum ada tanaman produktif, belum ada panen sungguhan. Bangun mekanismenya sekarang, biarkan tarifnya kosong "—" sampai ada harga riil dari pembeli. Tarif tebakan akan tampil di Dashboard Finansial sebagai angka yang kelihatan sah — tepat yang disebut *fatal failure* di dokumen konsep.

---

## 16. Lampiran · K-04 — desain yang diputuskan (Opsi A: riwayat berversi per komoditas)

> Diputuskan 23 Agustus 2026. Bagian ini mengikat AI-18.

### Keadaan sekarang

`lsa_one_per_block` adalah partial unique index pada **`block_id` saja**, `WHERE approval_status <> 'rejected'` (`0017_reports.sql:251-252`). Sejak `0028_land_suitability.sql:95` penilaian bersifat **per komoditas** (`crop_id`), dan `land_suit_criteria` diseed terpisah untuk DURIAN dan COCONUT — jelas dimaksudkan untuk dibandingkan. Indeksnya tidak ikut menyertakan `crop_id`, jadi fitur perbandingan itu diblokir oleh constraint-nya sendiri.

| Langkah | Yang dilakukan di blok PILOT-01 | Hasil |
|---|---|---|
| 1 | Hitung kesesuaian **DURIAN** (pH 5,88; lereng 14,3; drainase agak terhambat) → S2 (wa, nr) → Simpan | ✅ tersimpan sebagai draft |
| 2 | Hitung kesesuaian **KELAPA** untuk blok yang sama → Simpan | ❌ "Blok ini sudah punya penilaian kesesuaian" — **bug**, bukan pilihan desain |
| 3 | pH ternyata salah input (5,88 → 4,88). Hitung ulang → Simpan | ❌ gagal; draft yang salah menempati slot dan tidak ada aksi hapus draft |
| 4 | Jalan keluar satu-satunya: ajukan data yang salah → minta approver **menolak** → slot bebas | 😐 koreksi data harus lewat penolakan approval (inilah B-08) |

### Argumen yang menentukan

Modul ini **menghasilkan saran perbaikan**: faktor pembatas `oa` → "perbaiki sistem drainase", `eh` → "bangun teras/rorak" (map `LIMIT` di `src/lib/report/screens.ts`). Artinya penilaian ulang adalah **bagian dari alur kerja normal** — kebun memperbaiki drainase, lalu menilai lagi untuk membuktikan kelasnya naik. Tanpa riwayat, perbaikan itu tidak bisa dibuktikan; nilai lama tertimpa. Untuk audit sertifikasi, justru itu bukti yang paling dicari.

### Skema

```sql
DROP INDEX app.lsa_one_per_block;

ALTER TABLE app.land_suitability_assessments
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by uuid REFERENCES app.land_suitability_assessments(id);

-- satu penilaian AKTIF per blok per komoditas; sisanya menjadi riwayat
CREATE UNIQUE INDEX lsa_one_active_per_block_crop
  ON app.land_suitability_assessments (block_id, crop_id)
  WHERE approval_status <> 'rejected' AND superseded_at IS NULL;
```

Hasilnya untuk PILOT-01:

| Penilaian | Komoditas | Tanggal | Kelas | Status |
|---|---|---|---|---|
| #1 | Durian | 10 Agu 2026 | S3 (oa) | superseded 15 Nov 2026 |
| #2 | Durian | 15 Nov 2026 | S2 (nr) | **aktif** — setelah drainase diperbaiki |
| #3 | Kelapa | 10 Agu 2026 | S1 | **aktif** |

C-04 ("riwayat penilaian, urut, rincian per karakteristik") kini punya data untuk ditampilkan, perbandingan durian-vs-kelapa jalan, dan perbaikan lahan terekam.

### Aturan pelaksanaan (bagian dari keputusan)

1. **Penilaian bersifat per komoditas** — melanjutkan arah 0028. Kolom lama `score_durian` / `score_coconut` (`0017_reports.sql:241-242`) tetap ditinggalkan. Setiap indeks dan query wajib menyertakan `crop_id`.
2. **Creator boleh menghapus draft miliknya sendiri.** Policy `*_role_split` sudah mengizinkan UPDATE draft/rejected milik sendiri, tetapi DELETE butuh policy baru yang eksplisit — jangan mengandalkan yang sudah ada.
3. **Penilaian `approved` tidak boleh diganti langsung.** Penilaian baru masuk sebagai draft → approval → baru menggeser yang lama; `superseded_at`/`superseded_by` diisi **di dalam `app.decide_record()`** saat approve. Kalau tidak, kelas kesesuaian bisa berubah tanpa persetujuan.
4. **Konsumen data menunjuk penilaian aktif** (`superseded_at IS NULL` AND `approved`): rekomendasi pemupukan, `/laporan/kesesuaian-lahan`, dan dashboard. `db/verify-suitability.mjs` ikut disesuaikan — kalau terlewat, laporan bisa menampilkan penilaian yang sudah digeser.

### Cara membuktikan

- `db/verify.mjs`: satu blok boleh punya penilaian durian **dan** kelapa; dua penilaian aktif durian ditolak; menyetujui penilaian baru mengisi `superseded_at` pada yang lama.
- `db/verify-adversarial.mjs`: creator tidak bisa menghapus draft milik orang lain; creator tidak bisa menggeser penilaian `approved` tanpa approval.
- Jalankan ulang **B-08** dan **C-04** di sheet QA.

---

## 17. Lampiran · K-06 — desain yang diputuskan (Agri-Input & Equipment)

> Diputuskan 23 Agustus 2026. Bagian ini mengikat AI-43, AI-45, dan AI-46.

### Keadaan sekarang

- Katalog **hanya bisa ditambah**. `src/lib/actions/agriInput.ts` cuma punya `createChemicalAction` / `createEquipmentAction`; repo cuma `list*` + `create*`. Kolom `is_active` sudah ada (`0034_farm_activities_agri_input.sql:29,45`) tapi tidak pernah ditulisi, padahal database sudah memberi `UPDATE, DELETE` ke `app_rw` (baris 56). Yang kurang murni lapisan aplikasi.
- **Tidak ada tabel mutasi stok dan tidak ada tabel pemakaian alat.** `stock_qty` kolom biasa dengan `CHECK (stock_qty >= 0)`, hanya terisi sekali saat item dibuat. Karena itu skenario D-01 belum bisa diuji sama sekali.
- Katalog chemical **tidak punya kolom harga**; harga hidup di `price_list` (kode seperti `PUPUK-NPK`, driver `fertilizer_qty`). Dua katalog yang tidak saling menunjuk.
- Equipment menyimpan `purchase_price_idr`, `fuel_type`, `fuel_per_hour` (baris 41-44) tetapi **tidak dipakai perhitungan apa pun**.
- Kedua tabel **belum punya policy `*_writer` restriktif** seperti `price_list` — jadi tanpa penambahan policy, memasang aksi edit berarti creator pun bisa mengubah harga.

### Contoh kasus

Katalog **NPK 15-15-15**: stok awal 500 kg, reorder level 100 kg, harga beli Rp 12.000/kg.

| Langkah | Yang diharapkan | Sekarang |
|---|---|---|
| 1 | Creator catat pemupukan 50 kg di PILOT-01, disetujui | ✅ |
| 2 | Stok turun 500 → 450 kg | ❌ tetap 500; `fertilizer_applications` tidak terhubung ke katalog |
| 3 | Stok ≤ 100 kg → alert "Perlu reorder" | ❌ tidak akan pernah muncul |
| 4 | Harga beli naik jadi Rp 13.000/kg | ❌ tidak ada aksi edit; harus buat item berkode baru |
| 5 | Biaya 50 kg × Rp 12.000 masuk realisasi | ⚠️ jalan, tapi harganya bukan dari katalog |

### Keputusan 1 · Stok menjadi buku besar

```sql
CREATE TABLE app.agri_input_stock_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES app.companies(id),
  chemical_id      uuid NOT NULL REFERENCES app.agri_input_chemicals(id),
  moved_on         date NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in','out','adjustment')),
  quantity         numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_price_idr   numeric(16,2),        -- wajib untuk 'in'; snapshot harga beli
  source_table     text,                 -- 'fertilizer_applications' | 'spraying_records' | NULL (pembelian)
  source_record_id uuid,
  note             text,
  created_by       uuid REFERENCES app.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

- `stock_qty` menjadi **turunan** (Σ in − Σ out ± adjustment), bukan kolom yang di-UPDATE.
- **Append-only**: REVOKE UPDATE/DELETE dari `app_rw`, didaftarkan di `app.privilege_revocations` (ledger migrasi 0019). Koreksi lewat baris `adjustment`, bukan mengubah baris lama.
- Baris `out` ditulis **otomatis oleh `app.decide_record()`** saat aplikasi pupuk/pestisida disetujui — transaksi yang sama dengan penulisan baris biaya (§13). Karena itu AI-45 harus satu paket dengan AI-01.
- Alert reorder jadi bisa dihitung, dan D-01 akhirnya bisa diuji.

| Jenis mutasi | Siapa | Catatan |
|---|---|---|
| `in` (pembelian) | **super_admin** | `unit_price_idr` wajib |
| `out` (pemakaian) | otomatis dari approval | tanpa harga; biaya diambil dari `price_list` per tanggal kejadian (§14) |
| `adjustment` (opname/susut) | **super_admin** | `note` wajib |

Konsekuensi yang disengaja: **creator tidak pernah menyentuh stok maupun harga.** Itu menghapus satu form dari cakupan AI-43 dan menghilangkan seluruh kelas kesalahan input di lapangan.

### Keputusan 2 · Equipment hanya biaya kapital

- Harga beli dicatat sebagai **satu baris biaya overhead** saat pembelian: `is_overhead = true`, `block_id` NULL — sudah didukung constraint `ct_overhead_scope` (`0016_costing_fix.sql:76`).
- **Depresiasi tidak dikerjakan.** Ia menuntut kebijakan umur ekonomis dan metode penyusutan yang belum ada keputusannya; jangan diasumsikan.
- **Biaya operasional (bahan bakar × jam pakai) ditunda.** Ia butuh log `equipment_usage` yang belum ada, dan log itu hanya berguna kalau operator memang akan mencatat jam pakai.
- Karena itu `fuel_type` dan `fuel_per_hour` dinyatakan sebagai **input carbon accounting** (IPCC Vol. 2 Ch. 3), **bukan** input biaya. Nyatakan ini di UI supaya tidak ada yang menunggu angka biaya yang tidak akan datang.

### Keputusan 3 · Harga beli hanya super_admin

| Yang diubah | Siapa | Cara |
|---|---|---|
| **Harga — SELURUH `price_list`** (biaya, revenue, tarif jasa/upah) + `unit_price_idr` mutasi `in` | **super_admin saja** | penerbitan versi lewat `app.publish_price()` (§14) |
| Field katalog non-harga: nama, kategori, satuan, reorder level | approver / super_admin | `updateChemicalAction` / `updateEquipmentAction` |
| Nonaktifkan item | approver / super_admin | `is_active = false` — **bukan** DELETE; record historis tetap menunjuk item lama |
| Kode item | tidak boleh diubah | ganti kode = item baru |
| Stok | tidak ada yang mengedit langsung | lewat buku besar (Keputusan 1) |

**Diputuskan 23 Agu 2026: pengetatan berlaku untuk SELURUH `price_list`, bukan hanya baris ber-`chemical_id`.** Tarif biaya, tarif jasa/upah, dan harga jual revenue semuanya menjadi wewenang super_admin. Alasannya konsistensi: satu aturan lebih mudah dijelaskan dan diuji daripada aturan yang bergantung pada isi kolom. Konsekuensi yang harus disadari: peran approver menyusut menjadi *menyetujui record aktivitas saja*, dan pembaruan tarif menjadi bergantung pada ketersediaan super_admin.

Empat titik yang harus diubah supaya keputusan ini nyata, bukan sekadar dicek di Server Action:

1. **Policy `price_list_writer`** (`0033_price_list.sql:43-47`) — `WITH CHECK (... IN ('approver','super_admin'))` menjadi `('super_admin')`, lewat migrasi baru. Catatan: policy ini memang `FOR ALL` tetapi `USING (true)`, jadi ia **tidak** memfilter SELECT — aman, dan bukan contoh jebakan 0020.
2. **`app.publish_price()`** self-gate ke `super_admin`.
3. **`setPriceRateAction`** (`src/lib/actions/pricing.ts:17`) — `requireRole("approver","super_admin")` menjadi `requireRole("super_admin")`; pesan errornya di baris 29 ikut diperbaiki. Aksi ini juga akan diganti oleh `publish_price()` saat AI-04 dikerjakan, jadi kalau AI-04 lebih dulu, cukup ubah sekali.
4. **Label & gating di UI** — `canEdit` di `src/app/(app)/costing/refleksi/page.tsx:16` (`["approver","super_admin"]` → `["super_admin"]`), teksnya di baris 132, dan keterangan "diubah di Refleksi Biaya (approver/super admin)" di `src/app/(app)/costing/pendapatan/page.tsx:98`.

Untuk katalog Agri-Input sendiri, tambahkan policy `*_writer` RESTRICTIVE pada `agri_input_chemicals` dan `agri_input_equipment` meniru pola di atas. Bila policy baru itu perlu membatasi **tulis saja** tanpa `USING (true)`, ingat pelajaran migrasi 0020: jangan pakai `FOR ALL` — pecah per perintah (`FOR UPDATE` / `FOR DELETE` / `FOR INSERT`), karena `USING` pada `FOR ALL` ikut memfilter SELECT dan pernah menyembunyikan tiga laporan built-in dari semua orang.

### Satu sumber kebenaran harga

`price_list` mendapat kolom opsional `chemical_id` (FK ke katalog). Dengan begitu satu item katalog punya satu baris harga berversi, dan form penyemprotan/pemupukan menarik dari item yang **sama** dengan yang dipakai perhitungan biaya. Wiring-nya sudah benar: `spraying_records.chemical_id` sudah FK ke katalog (`0034:95`) dan `listChemicalOptions` sudah mengisi dropdown-nya — jadi catatan B-05 ("Insektisida X tidak ada di pilihan") terbaca sebagai **katalog belum diisi**, bukan bug.

### Cara membuktikan

- `db/verify.mjs`: pemupukan 50 kg disetujui → satu baris `out` 50 kg; `stock_qty` turunan menjadi 450; stok ≤ reorder level memunculkan penanda reorder.
- `db/verify-adversarial.mjs`: `creator` tidak bisa INSERT mutasi `in`; **`approver` tidak bisa mengubah tarif apa pun di `price_list`**. Catatan: `price_list` saat ini **tidak disentuh sama sekali** oleh `db/verify.mjs` maupun `db/verify-adversarial.mjs` — nol cakupan uji untuk tabel yang komentarnya sendiri menyebut "pengendali seluruh angka keuangan". Jadi ini kasus baru, bukan revisi kasus lama, dan sebaiknya sekalian menutup celah cakupan itu; UPDATE/DELETE pada `agri_input_stock_movements` ditolak; `app.check_privilege_revocations()` tetap nol baris; katalog tetap terbaca semua role (jaga-jaga regresi pola `FOR ALL`).
- Jalankan D-01 di sheet QA — baru kali ini bisa.

---

## 18. Lampiran · K-07 — keputusan laporan

> Diputuskan 23 Agustus 2026. Bagian ini mengikat AI-37, AI-38, AI-47, AI-48, dan AI-49.

### Jawaban atas kerangka empat pertanyaan

| # | Pertanyaan | Jawaban |
|---|---|---|
| 1 | Siapa pembacanya | **Manajemen** — berlaku untuk semua laporan |
| 2 | Keputusan apa yang ditopang | **Keputusan manajemen** |
| 3 | Sumber datanya | **Pakai data demo dulu** (lihat batasan di bawah — wajib dibaca) |
| 4 | Format yang dipakai | **Ketiganya**: layar, PDF, Excel — untuk semua laporan |
| 5 | Batas kolom mobile | **8 kolom**; sisanya masuk baris detail yang bisa dibuka |

### Konsekuensi langsung

**a. Tidak ada laporan yang ditunda.** Kategori "tunda" pada straw-man sebelumnya bersandar pada aliran data yang masih kosong. Karena data demo dipakai, ke-18 laporan tetap tayang. Yang tersisa dari pemangkasan hanyalah **penggabungan**: Penyiangan + Penyemprotan + Pruning → satu "Aktivitas Pemeliharaan" berfilter modul, karena kolomnya ±70% sama. **18 → 16.**

⚠️ Data demo membuat laporannya **tampil**, bukan membuat modulnya **terpakai**. B-09 (form inspeksi nursery) dan B-11 (form DBH) tetap BLOCKED, dan AI-19/AI-20 tetap P1 — kalau tidak, laporan menampilkan baris yang tak seorang pun bisa membuatnya.

**b. Penyatuan jalur laporan menjadi wajib, bukan opsional (AI-47).** Karena ketiga format wajib untuk semua laporan, ketiganya harus setuju satu sama lain. Sekarang tidak:

- Layar: `page.tsx` → `buildReportScreen()` → `screens.ts`. Ke-15 slug modul punya builder (`screens.ts:783-799`), sehingga `ModuleReportView` **tidak pernah terpakai** di layar.
- PDF & Excel: `laporan/[slug]/pdf/route.ts:22` dan `excel/route.ts:17` → `entry.load(ctx)` → `moduleData.ts` — jalur lama, kolom berbeda.

| Laporan | Layar | PDF & Excel | Selisih |
|---|---|---|---|
| Penyemprotan | 16 | 12 | **−4** |
| Karbon | 13 | 9 | **−4** |
| Kesesuaian Lahan | 16 | 13 | −3 |
| Penyiangan | 13 | 10 | −3 |
| Approval | 11 | 9 | −2 |
| Pemupukan | 15 | 13 | −2 |
| Chemical · Equipment · Blok | 11 | 10 | −1 |
| Panen · Pruning · Bibit · Anggaran · Persiapan Lahan | sama | sama | 0 |

Arah perbaikan: `screens.ts` menjadi **satu-satunya** sumber; PDF dan Excel dirender dari objek `ReportScreen` yang sama, sehingga hasil unduhan secara struktural mustahil berbeda dari yang di layar. **AI-38 (uji F-01…F-05) dijalankan setelah ini**, kalau tidak yang diuji akan dibuang.

**c. Seluruh 15 laporan modul melampaui batas 8 kolom (AI-48).** Yang paling ramping pun 9 kolom (Pruning, Pengeluaran); tertinggi 16 (Kesesuaian Lahan, Penyemprotan). Jadi batas ini bukan penyesuaian kecil di beberapa layar — semuanya perlu dipilah menjadi "kolom utama (maks 8)" + "baris detail". Kerjakan setelah AI-47, supaya pemilahan itu dilakukan sekali dan langsung berlaku untuk ketiga format.

### Batasan pemakaian data demo — wajib dipatuhi

"Data demo" di sini berarti **baris data pada tenant yang ditandai `companies.is_demo = true`**, yang dihasilkan `npm run db:seed:demo`. **Bukan** angka yang ditulis langsung ke dalam kode laporan. Bedanya menentukan:

| | Data seed pada tenant demo | Literal angka di kode |
|---|---|---|
| Bisa dihapus sebelum go-live | ✅ `npm run db:purge:demo` | ❌ menetap di kode |
| Terdeteksi gate produksi | ✅ `check_production_readiness()` menandainya **blocking** | ❌ tidak terdeteksi |
| Bisa dibedakan dari data nyata | ✅ lewat `is_demo` | ❌ tidak bisa |
| Status di dokumen konsep | Sah, memang disediakan | **Dilarang** (concept:38-40, "fatal failure") |

Karena itu:

1. Seluruh isi laporan demo datang dari `db/seed-demo.mjs`; **AI-49** memperluasnya agar Panen, Bibit, Karbon, dan Equipment punya isi.
2. Laporan wajib menampilkan penanda saat tenantnya `is_demo` — pola badge "contoh" yang sudah dipakai `src/app/(app)/operasional/kesesuaian-lahan/AssessmentHistory.tsx:78` bisa langsung dicontek, dan untuk laporan sebaiknya berupa kop "DATA DEMO" yang **ikut tercetak di PDF dan Excel**, bukan hanya di layar.
3. `npm run db:purge:demo` wajib dijalankan sebelum go-live; `npm run db:check` harus nol baris blocking.
4. Perlu diketahui: **AT6 tidak melindungi lapisan laporan.** Uji itu hanya memindai empat file halaman (`scripts/at-verify.mjs:435-440`) dan tidak menyentuh `src/lib/report/*`. Jadi literal angka di `screens.ts` tidak akan tertangkap otomatis — di sini disiplin manusia adalah satu-satunya penjaga. Usul: perluas daftar file AT6 ke `src/lib/report/screens.ts` dan `moduleData.ts` (masuk cakupan AI-42).

### Catatan tentang jawaban 1 & 2

"Pembaca = manajemen" dan "keputusan dari manajemen" berlaku untuk semua laporan, sehingga kedua pertanyaan itu **tidak bisa dipakai memilah** laporan mana yang lebih penting. Akibatnya prioritas antar-laporan harus ditentukan cara lain — usul: dari frekuensi pemakaian nyata setelah dipakai satu-dua bulan, lalu laporan yang tidak pernah dibuka dipertimbangkan untuk digabung. Itu keputusan yang bisa ditunda tanpa memblokir apa pun, karena penyatuan jalur (AI-47) dan batas kolom (AI-48) berlaku untuk semua laporan tanpa kecuali.

---

## 19. Lampiran · K-09 — Price List: tiga kelas field

> Diputuskan 23 Agustus 2026. Bagian ini mengikat AI-44a dan AI-44b.

### Temuan yang mengubah pertanyaannya

Pertanyaan aslinya "apakah edit per baris dibutuhkan?", tetapi yang lebih mendesak: **tidak ada cara menambah baris tarif sama sekali.** `INSERT INTO app.price_list` hanya ada di `db/seed-demo.mjs:763` — tidak ada Server Action, tidak ada fungsi repo. Tarif hanya bisa lahir dari seed atau SQL manual.

Itu langsung menabrak K-03: harga per grade (Kelapa A/B/C, Durian A/B/C) berarti baris revenue baru untuk setiap grade. Tanpa jalur create, semuanya harus lewat migrasi. Karena itu **AI-44a berstatus prasyarat K-03** dan masuk Sprint 2.

UI Price List juga hanya menampilkan 4 kolom — Kode, Kategori, Jenis, Tarif (`src/app/(app)/costing/refleksi/page.tsx:136-141`). Tiga kolom yang justru menentukan perilaku tidak pernah terlihat:

| Kolom | Terlihat? | Padahal ia menentukan |
|---|---|---|
| `unit` | hanya sebagai ekor tarif ("/kg") | arti angka volumenya |
| `driver` | ❌ tidak pernah | metrik volume mana yang mengalikan tarif ini — atau NULL, yang membuatnya "tarif manual" dan hanya muncul sebagai catatan kaki teks (`refleksi/page.tsx:121-126`) |
| `is_active` | ❌ tidak pernah | apakah baris ini ikut dihitung |

Akibatnya super_admin mengubah tarif tanpa bisa melihat metrik volume yang akan dikalikan dengannya.

### Contoh kasus

Baris `PUPUK-NPK` · kategori Pupuk · driver `fertilizer_qty` · unit **kg** · Rp 12.000.

| Skenario | Yang sebenarnya diminta | Perlakuan |
|---|---|---|
| Harga naik jadi Rp 13.000 | fakta ekonomi baru | **versi baru** (§14) — bukan edit |
| Kategori salah tulis "Pupk" → "Pupuk" | perbaikan label | **edit in-place** |
| Satuan salah: kontraknya per **sak 50 kg**, dicatat per kg | arti angkanya berubah | **versi baru**, unit + tarif sekaligus |
| Driver salah: `fertilizer_qty` seharusnya `landprep_area_ha` | baris ini mengukur hal lain | **baris baru**, yang lama dinonaktifkan |

Baris ketiga adalah alasan `unit` **diversikan bersama tarif**, bukan diedit terpisah: "Rp 12.000" dan "per kg" adalah satu pernyataan ekonomi. Kalau unit bisa diedit sendiri, seseorang bisa mengubah kg → sak tanpa mengubah angkanya dan tarif pupuk mendadak salah 50×.

Riwayat sendiri sudah aman berkat K-01: `cost_transactions` menyimpan `quantity`, `uom_item_id`, `unit_price_idr`, dan `amount_idr` sebagai snapshot, jadi mengubah `price_list` **tidak** merusak biaya yang sudah materialisasi. Yang berubah hanya perhitungan ke depan dan pratinjau di halaman Refleksi.

### Keputusan · tiga kelas field

| Kelas | Field | Cara ubah |
|---|---|---|
| **Kekal** | `code`, `kind` (biaya/revenue), `driver` | Tidak bisa diubah. Salah = baris baru + baris lama `is_active = false` |
| **Berversi** | `rate_idr` **+ `unit`** | `app.publish_price()` — tutup versi lama, terbitkan versi baru (§14) |
| **Edit in-place** | `category`, `note`, `is_active` | `updatePriceMetaAction`, tercatat di `audit_log` |

### Konsekuensi untuk UI

1. **Tambah baris tarif baru** (AI-44a) — paling mendesak; sekarang tidak ada sama sekali.
2. Tampilkan `driver` dan `unit` sebagai kolom. Baris tanpa driver ditandai "tarif manual" **di barisnya**, bukan sebagai catatan kaki.
3. Tombol pada tarif berubah makna: dari "ubah tarif" menjadi **"terbitkan tarif baru, berlaku mulai …"**, dengan riwayat versi bisa dibuka di baris itu (AI-44b).
4. Nonaktifkan, bukan hapus — baris historis tetap menunjuk tarif lama.
5. Seluruhnya hanya untuk super_admin (K-06 Keputusan 3).

### Cara membuktikan

- `db/verify.mjs`: menambah baris tarif baru berhasil; mengubah `code`/`kind`/`driver` ditolak; mengubah `rate_idr` langsung (bukan lewat `publish_price`) ditolak.
- `db/verify-adversarial.mjs`: `approver` dan `creator` tidak bisa menambah maupun mengedit baris tarif apa pun.
