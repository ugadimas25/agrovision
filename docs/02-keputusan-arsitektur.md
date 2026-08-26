# AgroVision — Keputusan Arsitektur

> Tanggal keputusan: **30 Juli 2026**
> Menjawab STEP 4 dari [00-refinement-concept.md](00-refinement-concept.md) plus keputusan tambahan yang muncul dari audit.
> Semua `// DECISION NEEDED:` yang berkaitan boleh dihapus dari kode setelah ini.

---

## Ringkasan

| # | Keputusan | Jawaban |
|---|---|---|
| 1 | Costing: integrasi Koltiva ERP atau standalone | **Standalone** |
| 2 | Stack backend & database | **Cloud Run + Cloud SQL PostgreSQL + PostGIS** (tetap berlaku) |
| 3 | Sumber emission factor & alometrik | **IPCC** |
| 4 | Polygon blok: impor atau digambar | **Keduanya** |
| 5 | Jumlah entitas korporat | **Belum diketahui (TBC)** |
| 6 | Struktur budget | **Per fase proyek** |
| 7 | Biaya tenaga kerja | **Masuk costing (per blok)** |
| 8 | Fitur perkebunan produktif | **Diparkir & disembunyikan** |
| 9 | Modul Sertifikasi (13 halaman) | **Opsi (c) — skema disimpan, UI disembunyikan** |
| 10 | Dashboard sustainability boleh kosong | **Ya**, yang penting perhitungan sesuai kaidah IPCC |
| 11 | Basemap peta | **Gratis** |
| 12 | Nilai enum database | **Bahasa Inggris** |
| 13 | Strategi pengerjaan | **Depth-first** |

---

## 1. Costing — standalone

Modul costing dibangun **standalone**, tidak terikat API Koltiva ERP.

**Konsekuensi teknis:** disiapkan *seam* integrasi supaya penyambungan nanti bukan rewrite:

- `cost_transactions.erp_document_no` — kunci rekonsiliasi eksternal
- `cost_transactions.erp_synced_at` — penanda status sinkronisasi
- `erp_sync_logs` — tabel log rekonsiliasi (sudah ada di `0008_costing.sql`)
- Akses data lewat satu lapis repository, bukan query langsung dari komponen

```
// TODO: phase 2 — Koltiva ERP adapter di belakang antarmuka CostRepository
```

## 2. Stack — tetap GCP

Keputusan sebelumnya berlaku, tidak berubah oleh profil proyek yang baru:

| Lapisan | Layanan |
|---|---|
| Web + API (Next.js 16) | Cloud Run, service `agrovision-web` |
| Database | Cloud SQL PostgreSQL 16 + PostGIS 3.4 |
| Auth | Identity Platform (gratis < 50k MAU) |
| File & attachment | Cloud Storage |
| Job berat (report PDF, GDAL, tile) | Cloud Run service/job terpisah |
| Region | `asia-southeast2` (Jakarta) |

Skala baru (100.000 ha, ~3.300 blok) **tidak** mengubah pilihan ini. PostGIS tetap tepat; yang berubah hanya kebutuhan indeks spasial dan pagination server-side.

### 2b. Login — verifikasi ID token, dan stub yang bergerbang tiga lapis (B-27, 26 Agu 2026)

Kata sandi ditukar peramban **langsung** ke Identity Platform; server hanya menerima ID token, memverifikasi tanda tangannya, lalu memakai klaim `sub`. Tanpa dependensi baru — `node:crypto` sudah cukup, dan itu juga yang membuat modulnya bisa diuji langsung dari skrip `.mjs` (`npm run auth:verify`).

Tiga keputusan yang bukan detail teknis:

1. **Bawaan fail-closed.** `AUTH_MODE` yang tidak diset berarti `identity-platform`, bukan stub. Lupa memasang env di lingkungan baru harus berarti login mati, bukan login terbuka.
2. **Saklar login stub adalah DATA di database** (`app.auth_settings.stub_login_enabled`, default false), bukan keberadaan sebuah fungsi. Alasannya konkret: gerbang lama menandai stub sebagai blocking selama fungsi `lookup_login_email` ADA, sehingga gerbang produksi tak pernah bisa hijau selama pengembangan lokal butuh fungsi itu. `app_rw` tidak punya hak tulis ke tabelnya, jadi aplikasi tidak bisa menyalakan stub-nya sendiri.
3. **Penautan akun bukan bagian dari login.** Token sah milik orang yang `sub`-nya belum terpasang di `app.users.external_id` tetap ditolak; menautkannya adalah tindakan super_admin lewat koneksi superuser. Alternatifnya — menautkan otomatis lewat email terverifikasi saat login pertama — ditolak karena memindahkan keputusan "siapa boleh jadi siapa" dari admin ke penyedia identitas.

Konsekuensi operasional: instance yang sudah jalan (Cloud Run) **tidak bisa dilogini** sampai Identity Platform diaktifkan dan `external_id` tiap akun dipasang — lihat [12-deploy-gcp.md](12-deploy-gcp.md) §9.

## 3. Emission factor & alometrik — IPCC

Sumber referensi: **IPCC**.

**Yang saya kerjakan:** struktur tabel `emission_factors` dan `sequestration_models` sudah menyimpan provenance wajib — `source_standard`, `source_citation`, `uncertainty_pct`, `version`, `valid_from/valid_to`. Setiap perhitungan menunjuk **versi faktor** yang dipakai, jadi angka bisa direproduksi dan diaudit.

**Yang saya TIDAK kerjakan — dan ini penting:** saya **tidak akan mengisi angka koefisiennya**. Dokumen konsep melarangnya (*"do not invent coefficients"*) dan saya sependapat — koefisien karbon yang salah lebih berbahaya daripada kolom kosong, karena terlihat sah.

Yang perlu diekstrak dari dokumen IPCC oleh orang yang kompeten:

| Kebutuhan | Rujukan IPCC yang relevan |
|---|---|
| Emisi land clearing / konversi lahan | 2006 GL + 2019 Refinement, Vol. 4 (AFOLU), Ch. 2 & 4 |
| Emisi bahan bakar (solar alat berat, transport) | Vol. 2 (Energy), Ch. 3 — faktor stasioner & mobile |
| Emisi aplikasi pupuk N (N₂O langsung & tidak langsung) | Vol. 4, Ch. 11 |
| Biomassa & sequestration tanaman tahunan | Vol. 4, Ch. 4 (perennial cropland) |

Baris `emission_factors` diseed **kosong nilainya** dengan `source_citation` menunjuk tabel IPCC spesifik, lalu diisi setelah validasi.

```
// DECISION NEEDED: nilai koefisien IPCC harus divalidasi ahli MRV sebelum
// carbon run pertama dijalankan. Struktur sudah siap; nilainya sengaja kosong.
```

⚠️ **Catatan jujur:** memilih IPCC menetapkan *sumber*, bukan *metode tier*. IPCC menyediakan Tier 1 (default global), Tier 2 (faktor spesifik negara), dan Tier 3 (model). Untuk fase ini Tier 1 realistis. Ini perlu dinyatakan eksplisit di setiap laporan, karena Tier 1 punya ketidakpastian besar dan itu harus terlihat, bukan disembunyikan.

## 4. Polygon blok — impor dan digambar

Keduanya didukung:

- **Impor** — shapefile / GeoJSON / KML lewat `boundary_imports`, diproses Cloud Run worker (GDAL), divalidasi topologi, overlap dilaporkan ke `boundary_overlaps` untuk direview manusia (bukan ditolak keras)
- **Digambar** — digitasi langsung di peta, tersimpan sebagai `geometry(MultiPolygon, 4326)`

`blocks.boundary_source` sudah membedakan asalnya: `shapefile_import` vs `manual_digitize` vs `gps_survey` vs `drone_ortho`. Ini penting untuk audit sertifikasi nanti — kriteria "batas lahan terverifikasi" menuntut kejelasan sumber.

## 5. Jumlah entitas korporat — TBC

Belum diketahui. **Tidak memblokir**: skema sudah multi-tenant dengan `company_id` pada setiap tabel operasional + `user_estate_access` untuk lingkup akses per pengguna. Jumlah N tidak dibatasi.

Yang tertunda hanya seeding data dan konfigurasi akses awal. Untuk sekarang diseed **satu** entitas placeholder.

```
// DECISION NEEDED: jumlah & nama entitas korporat untuk seeding company table
```

## 6. Budget — per fase proyek

Ini mengubah tabel `budgets` yang sudah ditulis di `0008_costing.sql`. Bentuk lama memakai `period_month`; harus jadi **fase proyek**.

Perubahan yang diperlukan:

```sql
-- Baru: master fase proyek
CREATE TABLE app.project_phases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES app.companies(id),
  code         text NOT NULL,        -- 'PHASE-1-NURSERY'
  name         text NOT NULL,        -- 'Fase 1 — Pengadaan Bibit'
  starts_on    date,
  ends_on      date,
  sort_order   integer NOT NULL,
  UNIQUE (company_id, code)
);

-- budgets: period_month -> project_phase_id
```

Actual-vs-budget dibandingkan per fase × kategori biaya. Indikator over-budget dihitung, tidak disimpan.

## 7. Biaya tenaga kerja — masuk costing per blok

Labor masuk `cost_transactions` dengan `cost_category = 'labor'` dan `block_id` terisi. Bukan overhead terpisah.

**Konsekuensi yang harus disadari:** ini membuat **cost per hectare** dan **cost per tree** menyertakan tenaga kerja — angka yang ditunggu direktur keuangan jadi lebih lengkap dan lebih tinggi.

⚠️ Syaratnya: pencatatan tenaga kerja harus benar-benar bisa diatribusikan per blok. Kalau di lapangan satu tim bekerja lintas blok dalam sehari, perlu mekanisme alokasi. Ini disiapkan sebagai catatan, bukan diasumsikan selesai:

```
// TODO: alokasi labor lintas blok — perlu konfirmasi cara pencatatan absensi di lapangan
```

## 8. Fitur perkebunan produktif — diparkir & disembunyikan

Prototype memodelkan perkebunan produktif, padahal **belum ada yang ditanam**.

| Fitur | Tindakan |
|---|---|
| Struktur data panen (`harvest_batches`) | **Skema disimpan**, UI disembunyikan |
| Revenue / AR | **Skema disimpan**, UI disembunyikan (sesuai instruksi dokumen konsep) |
| Tree inventory fase `productive` | Skema disimpan, enum tetap ada |
| Survival rate | Dihitung, tapi bernilai kosong sampai ada penanaman |
| **Proyeksi produksi 2026–2030** | **Dihapus** — angka fabrikasi |
| **Estimasi pendapatan / margin / payback** | **Dihapus** — angka fabrikasi di dashboard finansial |

Pembedaan ini disengaja: "diparkir" berlaku untuk **struktur data**, tapi **angka fabrikasi tetap dihapus**. Dokumen konsep menyebut angka palsu di dashboard finansial sebagai *fatal failure*, dan menyembunyikannya tidak menghilangkan risikonya — cukup satu kali unhide dan angka bohong itu tayang lagi.

## 9. Modul Sertifikasi — opsi (c)

Skema 12 tabel sertifikasi (`0011_cert.sql`) **disimpan utuh**, UI 13 halaman **disembunyikan** dari navigasi.

Alasannya sehat: sertifikasi baru relevan ~3 tahun lagi, tapi skemanya sudah dirancang dan diuji — membuangnya berarti mengulang pekerjaan nanti. Yang tetap aktif dari grup Sustainability hanyalah **kerangka form builder** untuk checklist, sesuai arahan dokumen (*"build the framework, not the checklist content"*).

Isi checklist contoh (kriteria Rainforest Alliance, ISPO dsb di `certification.ts`) **tidak** diseed — klien akan menulis checklist sendiri.

## 10. Dashboard sustainability boleh kosong

Disetujui: tampilan akan terasa kosong dibanding prototype, dan itu diterima.

Kondisi fase ini:

- **Sequestration ≈ 0** — semua masih bibit, belum ada biomassa terukur
- **Emisi > 0** — land clearing adalah sumber terbesar saat ini
- **Net carbon = negatif dari sisi iklim** (net emitter), bukan Net Sink

Angka `Net Sink` / `-14,8 tCO2e` di prototype **dihapus**. Yang tampil: emisi aktual bila ada data, dan *empty state* jujur bila belum. Form pengukuran **DBH** dibangun sekarang tapi relevan mulai fase juvenil.

## 11. Basemap — gratis

⚠️ **Perlu diluruskan:** basemap gratis tersedia, tapi **citra satelit** gratis pilihannya terbatas — dan untuk kebun, satelit bukan kosmetik.

| Opsi | Biaya | Resolusi | Catatan |
|---|---|---|---|
| **OpenStreetMap** raster | Gratis | — | Tidak ada citra satelit; hanya peta jalan. Kurang berguna untuk batas kebun |
| **Sentinel-2** (ESA Copernicus) | **Gratis & terbuka** | ~10 m/px | Lisensi jelas, data publik. **Rekomendasi saya** |
| **Esri World Imagery** | Gratis dengan atribusi | ~0,5–1 m | Resolusi jauh lebih baik, tapi syarat penggunaannya perlu dibaca untuk konteks komersial |
| Mapbox / Google | Berbayar per request | Tinggi | Di luar keputusan "gratis" |

**Rekomendasi:** MapLibre GL (open source, tanpa biaya lisensi) + **Sentinel-2** sebagai layer citra + OSM sebagai layer referensi.

Resolusi 10 m memadai untuk blok ~30 ha (blok 30 ha ≈ 550 × 550 m, jadi ~55 piksel per sisi — cukup untuk memverifikasi batas). Untuk detail per pohon nantinya, sumbernya **orthophoto drone**, bukan basemap.

## 12. Nilai enum — bahasa Inggris

Semua nilai enum diseragamkan ke Inggris; label Indonesia disediakan di layer UI.

Yang harus direvisi dari migrasi yang sudah ditulis:

| Enum | Sekarang | Menjadi |
|---|---|---|
| `tree_condition` | `baik, sedang, buruk, mati` | `good, fair, poor, dead` |
| `growth_phase` | `bibit, vegetatif, produktif` | `seedling, vegetative, productive` |
| `plan_status` | `on_track, tertunda, selesai, dibatalkan` | `on_track, delayed, completed, cancelled` |
| `cost_status` | `draft, menunggu, disetujui, ditolak` | `draft, pending, approved, rejected` |
| `approval_status` | `menunggu, disetujui, ditolak, dibatalkan` | `pending, approved, rejected, cancelled` |
| `run_status` | `..., menunggu_approval, ...` | `..., pending_approval, ...` |
| `field_type` | `teks, angka, tanggal, ...` | `text, number, date, ...` |
| `priority` | `rendah, sedang, tinggi` | `low, medium, high` |
| `evidence_type` | `foto, dokumen, ..., tanda_tangan` | `photo, document, ..., signature` |

Sekaligus: state machine approval disesuaikan ke bentuk yang diminta dokumen konsep — `draft → submitted → under_review → approved | rejected`. Bentuk lama tidak punya `submitted` dan `under_review`.

## 13. Strategi — depth-first

Satu alur hidup utuh lebih diutamakan daripada cakupan layar:

```
Expenditure Form → Cloud SQL → Financial Report
```

Prioritas urutan (dari STEP 5 item 6):

1. **Costing / Expenditure form** ← paling ditunggu klien
2. Seedling Monitoring form
3. Land Preparation form
4. Map view dengan polygon blok
5. Financial dashboard (expenditure vs budget)

Sisanya **stub berlabel jelas** — bukan mockup berisi data palsu.

Alasan memilih ini bukan penghematan waktu, tapi karena keenam acceptance test hanya bisa dibuktikan pada alur yang utuh. Delapan layar setengah jadi tidak lolos satu pun.

---

## Koreksi pasca-audit

Audit ([03-audit-refinement.md](03-audit-refinement.md)) memperbaiki tiga hal yang saya tulis di atas. Versi di bawah ini yang berlaku.

**#1 Costing — penamaan kolom dan constraint.** Rekomendasi awal saya (`erp_document_no` + `UNIQUE`) salah untuk keputusan standalone:

- `erp_document_no` → **`external_document_no`** (netral-vendor; Koltiva belum tentu satu-satunya sumber)
- **Hapus `UNIQUE (company_id, erp_document_no)`** — constraint unique yang salah pada data yang sudah masuk tidak bisa dicabut murah. Integrasi bisa ditambahkan nanti; constraint keliru tidak bisa dibatalkan gratis.
- `erp_sync_logs` **diparkir** sampai ada keputusan integrasi.

**#6 Budget — kunci yang lebih tahan perubahan.** Bentuk `project_phase_id` yang saya usulkan hanya menampung satu jawaban. Bentuk ini menampung ketiganya (per tahun / per fase / per blok) tanpa migrasi ulang:

```sql
budgets: UNIQUE (company_id, cost_category_id, period_id, scope_type, scope_id)
         scope_type ∈ ('company','block_group','block')
fiscal_periods: memindahkan granularitas periode dari DDL ke data
```

Ini juga menutup cacat yang saya lewatkan: `budgets` versi lama **tidak punya `block_id`**, padahal acceptance test 3 mensyaratkan actual-vs-budget bergerak mengikuti pengeluaran **per blok**.

**#4 Polygon — `geom` harus nullable.** `blocks.geom NOT NULL` yang saya tulis mengunci "batas harus ada dulu", sehingga 3.300 blok tidak bisa didaftarkan bertahap. Karena polygon boleh diimpor **dan** digambar, `geom` jadi nullable; peta merender hanya blok yang sudah didigitasi.

---

## Cacat terkonfirmasi pada migrasi yang sudah ditulis

Empat cacat, semuanya di pekerjaan saya sendiri. Tiga pertama pasti secara konstruksi:

1. **`emission_factors` tidak akan pernah bisa di-supersede.** `0013_rls.sql:18` mencabut `UPDATE`, tapi `0009_carbon.sql:33` (`ef_active_uniq ON (code) WHERE valid_to IS NULL`) mensyaratkan versi lama ditutup lewat `UPDATE valid_to` sebelum versi baru bisa masuk. Skema versioning append-only **tidak dapat dieksekusi**. Perbaikan: tutup versi lewat `SECURITY DEFINER` function, atau ganti index jadi `(code, version)` + kolom `is_current` yang dikelola fungsi.
2. **`evidence_files` tidak akan pernah bisa diverifikasi.** `verified_at`/`verified_by` (`0010_evidence.sql:25-26`) butuh `UPDATE`, yang dicabut di `0013_rls.sql:17`. Perbaikan: pindahkan verifikasi ke tabel `evidence_verifications` terpisah (append-only, konsisten dengan prinsip §3.7).
3. **RLS surveyor tidak berfungsi.** `blocks_tenant` dan `blocks_estate_scope` keduanya `PERMISSIVE`, dan Postgres meng-**OR** policy permissive sejenis. Karena `blocks_tenant` sudah `TRUE` untuk seluruh blok dalam company, pembatasan per-estate menjadi **inert** — surveyor melihat semua blok. Perbaikan: `blocks_estate_scope` harus `AS RESTRICTIVE`. Jumlah `AS RESTRICTIVE` di `0013_rls.sql` saat ini: **0**.
4. **Empat tabel anak belum punya policy** (`submission_values`, `cert_assessment_items`, `capa`, `approval_steps`) — sudah saya tandai sendiri di komentar akhir `0013_rls.sql`, tapi tetap lubang.

### Pelajaran metodologis — kenapa uji saya sebelumnya lolos padahal salah

Smoke test yang saya jalankan sebelumnya menyatakan skema versioning emission factor **berhasil**. Itu **false pass**: saya menjalankannya sebagai superuser `postgres`, yang **melewati semua `REVOKE`**. Sebagai `app_rw` — role yang sebenarnya dipakai aplikasi — operasi yang sama gagal.

**Aturan untuk ke depan: setiap uji hak akses dan RLS wajib dijalankan sebagai `app_rw`, tidak pernah sebagai `postgres`.** Uji sebagai superuser hanya membuktikan sintaks DDL, bukan perilaku keamanan.

---

## Sumber kebenaran domain — dibatalkan dan diganti

[01-desain-skema-database.md](01-desain-skema-database.md) baris **5** menyebut `src/data/dummy.ts` sebagai sumber kebenaran domain, dan baris **1234** merencanakan `0014_seed` diisi langsung dari `src/data/*.ts`.

**Keduanya dibatalkan.** Kalau dijalankan, rencana itu akan mencuci angka fabrikasi ke dalam Postgres — membuat aplikasi *tampak* dinamis sambil membuat acceptance test 6 mustahil lulus. Ini justru kegagalan yang paling sulit terdeteksi, karena datanya nyata-nyata datang dari database.

Sumber kebenaran domain sekarang: **[00-refinement-concept.md](00-refinement-concept.md)**.
`0014_seed` hanya berisi master data yang **benar strukturnya dan kosong isinya**, plus 1–2 skema form.

---

## Yang masih terbuka

| Hal | Status |
|---|---|
| Nilai koefisien IPCC | Perlu ekstraksi + validasi ahli MRV |
| Jumlah & nama entitas korporat | TBC |
| Cara pencatatan absensi tenaga kerja per blok | Perlu konfirmasi lapangan |
| Definisi fase proyek (nama & rentang tanggal) | Perlu dari klien untuk seeding `fiscal_periods` |
| **24 fitur tanpa rumah baru** | **Menunggu keputusan Anda — lihat [03-audit-refinement.md](03-audit-refinement.md) §3** |
| Penghapusan klaim Net Sink di landing page publik | Menunggu persetujuan Anda |
