# Pematangan Backend AgroVision

| | |
|---|---|
| **Assignee** | Ridwan Nulloh (`ridwannulloh`) |
| **Reviewer** | @ugadimas25 |
| **Total estimasi tersisa** | ± 14 hari kerja (di luar B-1, B-2, B-3, B-5, B-13 yang sudah selesai) |
| **Tenggat** | ± 2 minggu (sesuai kesepakatan durasi satu bulan) |
| **Aturan** | Satu tiket = satu branch = satu PR, wajib approval sebelum merge |

Fokus: perbaikan alur approval, konsistensi angka, ketahanan data, kebersihan skema, dan kesiapan operasional.

> **Pembaruan meeting 21 Agustus 2026:** B-2, B-3, dan B-5 sudah selesai. B-1 & B-13 selesai lewat PR #9 (bucket + IAM sudah disiapkan Dimas). Prioritas berikutnya: database/schema bersih, menghubungkan survei lapangan ke approval, serta B-8 sampai B-11. B-12 ditunda sampai alurnya difinalkan.
>
> **Tambahan 21 Agustus (hasil penelusuran kode):** temuan meeting soal alur approval, hak akses, field wajib, dan **selisih angka budget/realisasi** dijadikan tiket **B-20 … B-25** di Sprint A & B. Semuanya sudah diverifikasi langsung ke kode — bukan disalin dari transkrip. **B-20 wajib dikerjakan lebih dulu** dan **butuh keputusan Dimas** sebelum mulai.

### Infra B-1 yang sudah tersedia (tidak perlu dibuat lagi)

`agrovision-evidence-393569486275` · asia-southeast2 · uniform access · public-access-prevention **enforced** · SA Cloud Run punya `storage.objectAdmin` **hanya pada bucket itu** · SA punya `tokenCreator` **atas dirinya sendiri** (tanpa ini `getSignedUrl()` gagal di Cloud Run) · `_EVIDENCE_BUCKET` sudah terisi di `cloudbuild.yaml`.

> ⚠️ **Gotcha yang sudah dua kali menggigit:** `CREATE OR REPLACE VIEW` **menjatuhkan** opsi `security_invoker`. Setiap migrasi yang menyentuh `app.v_pending_approvals` **wajib** memasangnya ulang di akhir file (lihat 0035, 0036, 0038). Nomor migrasi berikutnya: **0039**.

---

## Aturan kerja

Branch `main` terkunci. Push langsung ditolak — semua perubahan lewat PR dan **harus disetujui @ugadimas25**.

```
branch baru → commit → push branch → buka PR
  → review @ugadimas25 → merge ke main → auto-deploy Cloud Run
```

Penamaan branch: `feat/…`, `fix/…`, `chore/…`

**Checklist tiap PR** (sudah ada di template PR): `npm run lint` 0 error · `npm run build` sukses · migrasi DB idempoten & teruji · tidak ada kredensial ter-commit.

---

## Konteks sistem

- **Next.js 16** (App Router, RSC + Server Actions) + **PostgreSQL 16 + PostGIS**
- Produksi: **Cloud Run** + **Cloud SQL**, region `asia-southeast2`
- Aplikasi konek DB sebagai `app_user` — **bukan** superuser
- Migrasi: ledger ber-checksum di `db/migrations/`, dijalankan `npm run db:migrate` — terakhir **0038**
- **Prinsip data:** nilai kosong ditulis `—`, **tidak pernah** `0`

### Menjalankan lokal

```bash
cp .env.example .env.local     # isi dengan nilai dummy untuk pengembangan
docker compose up -d           # PostgreSQL 16 + PostGIS, port 55433
npm ci
npm run db:migrate             # skema + PostGIS
npm run db:bootstrap           # role aplikasi
npm run db:seed:demo           # data & akun demo
npm run dev
```

Akun demo (semuanya dummy, domain `.invalid` memang tidak bisa dipakai sungguhan):
`admin@demo.invalid` · `approver@demo.invalid` · `creator@demo.invalid` · `direktur@demo.invalid`

Nilai environment sungguhan (project ID, connection name, secret) **tidak ada di repo** — minta ke Dimas saat kamu butuh.

> ⚠️ **Gotcha yang sudah pernah menggigit:** `postgres` di Cloud SQL bukan superuser, jadi perilaku beberapa fitur PostgreSQL berbeda dari Docker lokal. Kalau membuat migrasi yang menyentuh privilege atau row-level security, **uji di Cloud SQL**, jangan hanya di lokal.

---

# SPRINT 1 · Jaring pengaman (✅ selesai)

## B-5 · Bug: tombol "Setujui" tidak mengirim `moduleKey`
`fix/approve-modulekey` · **30 menit** · 🔴 Urgent

**Status: ✅ Selesai dan sudah diuji kembali (meeting 21 Agustus 2026).**

**Masalah**
Di `src/app/(app)/approval/DecisionForm.tsx`, form approve hanya mengirim `id` + `decision`, sedangkan form tolak juga mengirim `moduleKey`. Akibatnya action jatuh ke nilai default `"cost_transaction"` (`src/lib/actions/costing.ts:207`).

**Dampak**
Menyetujui hanya berhasil untuk modul Pengeluaran. Sepuluh modul lain (pemupukan, panen, penyiangan, penyemprotan, pruning, persiapan lahan, kesesuaian lahan, nursery, survei, DBH) selalu gagal dengan pesan *"Tidak bisa diputuskan — statusnya bukan menunggu approval."*

**Kerjakan**
Tambahkan `<input type="hidden" name="moduleKey" value={moduleKey} />` pada form approve.

**Selesai bila**
- [ ] Menyetujui berhasil di pemupukan, panen, survei, penyiangan
- [ ] QA manual tidak lagi terblokir di skenario B-02 … B-11

---

## B-3 · CI: lint, typecheck, build, uji DB — jadikan syarat merge
`chore/ci-pipeline` · **1 hari** · 🔴 High

**Status: ✅ Selesai.** Pipeline sudah mencakup build, test, verification, dan migrasi database.

**Masalah**
Tidak ada `.github/workflows/`, dan branch protection belum punya *required status checks* — PR yang gagal build tetap bisa di-merge. Reviewer harus percaya begitu saja bahwa kodenya lolos.

Repo sudah punya skrip verifikasi yang **belum pernah jalan otomatis**: `db:test`, `db:test:adversarial`, `db:check`, `db:verify`.

**Kerjakan**
1. GitHub Actions pada PR: `npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm run build`
2. Job kedua dengan service Postgres + PostGIS: `db:migrate` → `db:bootstrap` → `db:test` → `db:test:adversarial`
3. Minta Dimas menambahkan check ini sebagai **required status check**

**Selesai bila**
- [ ] PR dengan lint error **tidak bisa** di-merge (buktikan dengan PR uji)
- [ ] Status check muncul di setiap PR
- [ ] Waktu CI < 10 menit

---

## B-2 · Migrasi DB belum jalan saat deploy
`feat/deploy-migrations` · **1 hari** · 🔴 High

**Status: ✅ Selesai.** Migrasi dari file dijalankan otomatis saat deployment.

**Masalah**
`cloudbuild.yaml` hanya build → push → deploy. **Tidak ada langkah migrasi.** Kalau ada PR yang butuh migrasi baru, kode naik ke produksi sementara skema DB belum berubah → aplikasi error. Sekarang aman semata karena migrasi dijalankan manual dan belum ada yang lupa.

**Kerjakan**
- Tambahkan step migrasi di `cloudbuild.yaml` **sebelum** step deploy
- Pakai Cloud SQL connector + secret (minta Dimas menyiapkan secretnya)
- Migrasi gagal ⇒ **deploy dibatalkan** — jangan pernah deploy kode baru ke skema lama

**Selesai bila**
- [ ] Merge PR berisi migrasi baru → skema ikut ter-update otomatis
- [ ] Migrasi sengaja dirusak → deploy berhenti, revisi lama tetap melayani
- [ ] Migrasi idempoten (jalan dua kali tidak merusak)

---

# SPRINT A · Perbaikan alur approval & konsistensi angka (± 7 hari) — PRIORITAS TERTINGGI

Enam tiket dari temuan meeting. Semuanya sudah diverifikasi ke kode. **Kerjakan berurutan** — B-20 lebih dulu karena angka yang salah lebih berbahaya daripada fitur yang belum ada, dan QA tidak bisa dituntaskan selama satu aktivitas masih menampilkan dua angka berbeda.

## B-20 · Realisasi anggaran selalu 0 & angka beda antar role
`fix/budget-realisasi-source` · **2 hari** · 🔴 **Critical** · *butuh keputusan Dimas dulu*

**Ini akar masalah dari temuan meeting §4** (realisasi nol, angka berbeda antar role, rumus tidak cocok dengan hitungan manual). Hasil penelusuran:

Ada **dua sumber "biaya" yang tidak pernah bertemu:**

| Sumber | Dibaca oleh | Isinya |
|---|---|---|
| `app.cost_transactions` | `v_budget_vs_actual` → layar **Anggaran** | Hanya dari form Pengeluaran manual |
| `reflectedCosts()` (`src/lib/repo/pricing.ts`) | **Refleksi**, Dashboard Finansial | Dihitung dari aktivitas (volume × tarif) |

Menyetujui aktivitas (penyiangan/panen/pemupukan) **tidak pernah membuat baris `cost_transactions`** — satu-satunya INSERT ke tabel itu berasal dari form Pengeluaran manual (`src/lib/repo/costing.ts`).

Bukti di DB demo: **35** `cost_transactions` approved · **3** penyiangan + **8** panen approved · **0** `cost_transactions` yang berasal dari aktivitas.

Konsekuensinya persis seperti temuan Haris:
- **Realisasi anggaran selalu 0** — `v_budget_vs_actual` menjumlahkan tabel yang tidak pernah terisi dari aktivitas
- **Satu aktivitas menampilkan dua angka berbeda** — layar yang membaca `reflectedCosts()` dan layar yang membaca `v_budget_vs_actual` memang menghitung dari sumber berbeda

Meeting juga memutuskan **form Pengeluaran manual tidak dipakai** (biaya direfleksikan dari aktivitas). Artinya `cost_transactions` akan tetap kosong → **realisasi tidak akan pernah terisi** kalau ini tidak diperbaiki.

**Dua arah — jangan pilih sendiri, tanyakan Dimas di awal:**
- **(a) Materialisasi:** approve aktivitas → tulis baris `cost_transactions`. Anggaran & audit punya jejak baris nyata; risikonya duplikasi kalau approve dijalankan dua kali (butuh idempotensi).
- **(b) Ubah sumber:** `v_budget_vs_actual` membaca dari sumber refleksi yang sama. Satu sumber kebenaran; angka anggaran jadi hasil hitungan on-the-fly.

**Selesai bila**
- [ ] Arah (a) atau (b) disepakati dan ditulis alasannya di PR
- [ ] Aktivitas disetujui → realisasi anggaran **berubah**, bukan tetap 0
- [ ] Angka biaya satu aktivitas **identik** di layar creator, approver, Refleksi, dan Anggaran
- [ ] Satu contoh dihitung manual dan dicocokkan angkanya di PR

---

## B-21 · Record ditolak tidak bisa diedit
`feat/rejected-editable-draft` · **1 hari** · 🔴 High

**Temuan meeting §1.** Terverifikasi: **tidak ada satu pun server action untuk mengedit** record ber-approval (pencarian `updateExpenditure`/`updateOpRecord` di `src/lib/actions/` dan `src/lib/repo/` → nol hasil).

`submitOpRecord` memang menerima status `draft` **dan** `rejected`, jadi record ditolak bisa diajukan ulang — **tapi apa adanya, tanpa bisa diperbaiki**. Padahal alasan penolakan justru meminta perbaikan. Praktisnya: petugas hanya bisa mengajukan ulang data yang sama, lalu ditolak lagi.

**Kerjakan**
1. Server action edit untuk record berstatus `draft`/`rejected`, hanya oleh pembuatnya
2. Saat disimpan, status kembali ke `draft` dan `rejection_reason` dibersihkan
3. Tegakkan juga di lapis DB, bukan hanya server action — policy `role_split` sudah membatasi UPDATE ke baris sendiri berstatus draft/rejected, pastikan tetap konsisten
4. UI: tombol **Perbaiki** pada record ditolak (koordinasi penempatannya dengan Dimas)

**Selesai bila**
- [ ] Record ditolak bisa diedit pembuatnya lalu diajukan ulang dengan data baru
- [ ] Approver **tidak** bisa mengedit data milik orang lain lewat jalur ini
- [ ] Record `approved` **tidak** bisa diedit lewat jalur ini
- [ ] Alasan penolakan hilang setelah diperbaiki

---

## B-22 · Inbox approval tidak menyimpan riwayat
`feat/approval-history` · **1 hari** · 🟠 High · *butuh B-8 lebih dulu*

**Temuan meeting §1.** Terverifikasi di `db/migrations/0038`: **setiap** cabang `v_pending_approvals` memfilter `approval_status = ANY (ARRAY['submitted','under_review'])`.

Jadi begitu diputuskan, ajuan **langsung hilang** dari Inbox. Approver tidak punya cara melihat apa yang pernah dia setujui atau tolak — kebutuhan dasar akuntabilitas, dan tanpa itu keputusan lama tidak bisa diperiksa.

**Kerjakan** (migrasi `0039`)
1. View riwayat (mis. `v_approval_history`) atau parameter status pada view yang ada — **jangan** ubah perilaku Inbox default (tetap menampilkan yang menunggu)
2. Tampilkan: siapa memutuskan, kapan, keputusannya, alasan penolakan
3. Bergantung pada **B-8** (`approved_by`/`approved_at`) — kerjakan B-8 lebih dulu atau bersamaan
4. ⚠️ **Pasang ulang `ALTER VIEW … SET (security_invoker = true)`**

**Selesai bila**
- [ ] Approver bisa melihat ajuan yang sudah diputuskan, lengkap dengan siapa & kapan
- [ ] Inbox default tetap hanya menampilkan yang menunggu
- [ ] Creator bisa melihat riwayat ajuannya sendiri

---

## B-23 · Creator masih melihat data seluruh perusahaan
`fix/creator-own-data-scope` · **1 hari** · 🟠 High

**Temuan meeting §2** ("creator hanya dapat melihat data miliknya sendiri"). Terverifikasi lewat `pg_policies` pada `weeding_records`:

- `weeding_records_tenant [ALL]` → membatasi per **tenant** (lewat blok → perusahaan)
- `weeding_records_role_split [UPDATE]` → membatasi **tulis** ke baris sendiri

Artinya untuk **SELECT**, creator melihat **seluruh data perusahaan**, bukan hanya miliknya. Pembatasan per-pembuat hanya berlaku untuk UPDATE.

**Kerjakan** (migrasi `0039`)
1. Policy SELECT terpisah: role `creator` → hanya `created_by = app.current_user_id()`; approver/super_admin/viewer tetap lingkup tenant
2. Terapkan konsisten ke **semua** tabel operasional ber-`approval_status`
3. Tambah invariant seperti `check_rls_coverage()` supaya tabel baru tidak lupa dipasangi
4. ⚠️ Uji di **Cloud SQL**, bukan hanya Docker lokal — perilaku privilege di sana berbeda

**Selesai bila**
- [ ] Login `creator@` → hanya melihat record buatannya sendiri
- [ ] Login `approver@` → tetap melihat semua ajuan perusahaan
- [ ] Dibuktikan **lewat SQL langsung**, bukan hanya dari tampilan UI
- [ ] Laporan & dashboard tidak jadi kosong untuk creator — periksa dampaknya

---

## B-24 · Survei lapangan belum masuk alur approval
`feat/survey-approval-flow` · **1 hari** · 🟠 High · *kerjakan bersama B-9*

**Tindak lanjut meeting.** `survey_submissions` **sudah ada** di `v_pending_approvals` (migrasi 0038) dan punya `approval_status` — tapi meeting menemukan alurnya belum tersambung dari sisi aplikasi.

**Kerjakan**
1. Telusuri di mana rantainya putus: tombol Ajukan di UI survei? routing di `decide_record()`? policy `role_split`?
2. Sambungkan sampai alur penuh **draft → ajukan → setujui/tolak** berjalan
3. Sekalian periksa **B-9** (`tree_survey_points`) — kolom approval yatim yang berkaitan dengan survei

**Selesai bila**
- [ ] Survei bisa diajukan, muncul di Inbox, bisa disetujui **dan** ditolak
- [ ] Penolakan wajib beralasan, seperti modul lain

---

## B-25 · Field wajib & rumus biaya belum ditegakkan
`feat/mandatory-fields-cost-formula` · **1 hari** · 🟠 High

**Temuan meeting §3.** Field yang belum wajib: luas area · jumlah tenaga/orang · jumlah pohon · volume & satuan · komponen rekomendasi pemupukan.

Biaya operasional memakai **volume × tarif**, jadi volume/satuan yang kosong membuat biaya tidak bisa dihitung — salah satu penyebab angka kosong yang ditemukan QA. Berkaitan erat dengan **B-20**.

**Kerjakan**
1. Wajibkan di **tiga lapis**: zod di server action · `NOT NULL`/`CHECK` di DB (migrasi `0039`) · atribut di form
2. **Hati-hati:** `NOT NULL` pada tabel yang sudah berisi data akan gagal — bersihkan/isi data lama dulu, atau pakai `CHECK` dengan pengecualian baris lama
3. Pastikan satuan konsisten dengan `price_list` supaya volume × tarif tidak salah satuan
4. Koordinasi dengan Dimas soal daftar field final per modul

**Selesai bila**
- [ ] Kirim form tanpa field wajib → ditolak dengan pesan jelas per field
- [ ] Ditegakkan juga di DB (buktikan lewat INSERT langsung yang gagal)
- [ ] Biaya = volume × tarif menghasilkan angka yang cocok dengan hitungan manual

---

# SPRINT 2 · Ketahanan data (✅ selesai lewat PR #9)

## B-1 · Penyimpanan bukti belum persisten
`feat/gcs-evidence-storage` · **2 hari** · 🔴 Critical

**Status: ✅ Selesai lewat PR #9.** Bucket & IAM disiapkan Dimas (lihat bagian atas). Tinggal verifikasi di produksi setelah merge: unggah bukti → objek muncul di bucket → bisa dibuka dari Inbox Approval lewat signed URL.

**Masalah**
`src/lib/storage.ts:70-84` — bila `GCS_BUCKET_EVIDENCE` tidak diset, berkas jatuh ke `writeFile()` ke folder `.evidence` di dalam container. **Filesystem Cloud Run bersifat sementara dan per-instance**: berkas hilang saat instance restart, dan tidak terlihat oleh instance lain. Implementasi Cloud Storage-nya sendiri masih `TODO` (baris 72).

Padahal bukti pembelian **wajib** diunggah saat mengajukan pengeluaran — jadi ada risiko approver menerima ajuan yang buktinya sudah tidak bisa dibuka.

**Kerjakan**
1. Implementasikan Cloud Storage di `storage.ts` (bucket privat)
2. Buat bucket Cloud Storage untuk evidence dan konfigurasi IAM service account Cloud Run; koordinasikan nilai project/credential yang dibutuhkan dengan Dimas
3. Baca kembali lewat **signed URL** berumur pendek
4. Pertahankan perhitungan `sha256` (baris 62) untuk verifikasi integritas
5. Fallback penyimpanan lokal tetap dipertahankan untuk pengembangan
6. Cek apakah masih ada berkas lama yang bisa diselamatkan

**Selesai bila**
- [ ] Unggah bukti → tersimpan di Cloud Storage
- [ ] Restart instance → berkas tetap ada
- [ ] Batas 8 MB tetap berlaku

---

## B-13 · `evidence_links` INSERT dinonaktifkan
`fix/evidence-links` · **0,5 hari** · 🟠 High

**Status: ✅ Selesai lewat PR #9** (bersama B-1). Verifikasi wajib: jumlah bukti di daftar Pengeluaran **dan** Inbox Approval harus **1**, bukan 0. Data lama tetap 0 karena penautannya belum pernah tercatat — tidak perlu di-backfill, datanya demo.

`src/lib/repo/costing.ts:196-197` memuat komentar `// MUTATION-TEST: evidence link INSERT disabled on purpose.` Bukti tersimpan tapi **tidak tertaut ke transaksinya**. Cari tahu apakah ini sisa eksperimen, lalu aktifkan kembali. **Kerjakan bersama B-1.**

**Selesai bila:** bukti yang diunggah tertaut ke transaksinya dan bisa ditelusuri dari Inbox Approval.

---

# SPRINT 3 · Kelengkapan jejak & kebersihan skema (± 3,5 hari tersisa)

> Sebelum mulai sprint ini, tanyakan ke Dimas soal tiket tambahan yang dibagikan terpisah — beberapa di antaranya menyentuh berkas yang sama.

## B-8 · Jejak audit belum menyeluruh
`feat/audit-trail-approval` · **1 hari** · 🟠 High

**Masalah**
Trigger `write_audit()` baru terpasang di 5 tabel: `cost_transactions` (`0016:93-95`), `blocks`, `emission_factors`, `carbon_runs`, `cert_decisions` (`0012:86-100`). Modul approval lainnya **tidak tercatat di `audit_log`** — siapa yang menyetujui pemupukan atau panen tidak terekam.

**Kerjakan**
- Pasang trigger audit ke seluruh tabel ber-`approval_status`
- Pastikan perubahan status + aktor tercatat
- Tambah invariant: setiap tabel ber-`approval_status` **wajib** punya trigger audit

**Selesai bila**
- [ ] Setujui/tolak di modul mana pun → tercatat di `audit_log` dengan aktor & waktu

---

## B-9 · Kolom approval yatim di `tree_survey_points`
`fix/tree-survey-approval` · **0,5 hari** · 🟡 Medium

Tabel punya kolom `approval_status` (`0014:134-137`) tapi tidak terhubung ke alur approval mana pun: tidak ada di view `v_pending_approvals`, dan tidak ada routing di `decide_record()`. Record di tabel itu tidak akan pernah bisa diputuskan lewat UI.

**Keputusan meeting 21 Agustus 2026:** hubungkan survei lapangan ke alur approval satu tingkat. Jangan buang kolom approval-nya.

**Kerjakan**
- Masukkan pengajuan survei lapangan ke `v_pending_approvals`
- Tambahkan routing keputusan survei di `decide_record()`
- Pastikan creator dapat menyimpan draft, mengajukan, dan mengedit kembali data yang ditolak
- Wajibkan alasan penolakan dan pertahankan riwayat pengajuan yang sudah diproses di Inbox Approval

**Selesai bila**
- [ ] Survei dapat diajukan, disetujui, dan ditolak dari alur approval
- [ ] Survei yang ditolak kembali menjadi draft yang dapat diedit dan diajukan ulang
- [ ] Riwayat keputusan beserta aktor, waktu, dan alasan penolakan dapat ditelusuri

---

## B-10 · Kolom `users.role` warisan
`chore/drop-legacy-role` · **0,5 hari** · 🟡 Medium

Enum lama 8 nilai (`0002_core.sql:34-46`) masih ada di samping `app_role` yang kanonik; sudah ditandai DEPRECATED di `0014:64` tapi tak pernah di-`DROP`. **Dua sumber kebenaran** — tinggal menunggu satu query membaca kolom yang salah.

**Kerjakan:** pastikan nol pemakaian di `src/` dan `db/`, lalu drop kolom + enum lamanya.

---

## B-11 · Tabel approval berjenjang yang tidak terpakai
`chore/drop-dead-approval-tables` · **0,5 hari** · 🟡 Medium

`approval_requests` + `approval_steps` (`0012:12-41`, `0014:90-125`) lengkap dengan `required_app_role`, `step_order`, `resubmitted_from_id` — tapi **nol referensi di `src/`**. Skema mati yang menyesatkan pembaca berikutnya.

**Keputusan meeting 21 Agustus 2026:** approval saat ini hanya satu tingkat dan approval berjenjang belum diperlukan.

**Kerjakan:** pastikan tabel benar-benar tidak digunakan, lalu drop melalui migrasi idempoten. Dokumentasikan bahwa alur aktif menggunakan approval satu tingkat.

---

## B-12 · Status yang tak pernah dipakai
`chore/prune-record-status` · **0,5 hari** · 🟡 Medium

**Status: ⏸ Ditunda.** Jangan dikerjakan sampai finalisasi alur berdasarkan hasil meeting dikonfirmasi oleh Dimas.

Enum `app.record_status` punya 6 nilai, tapi `under_review` dan `cancelled` tidak pernah di-set kode mana pun — hanya muncul di klausa `IN (…)` dan label i18n. State machine efektifnya cuma 4 status.

**Kerjakan:** buang dari enum & label, **atau** implementasikan alurnya.

---

## B-19 · Database/schema bersih untuk pengujian
`chore/clean-test-database` · **1 hari** · 🟠 High

**Masalah**
Data lama dapat memengaruhi hasil QA dan menyulitkan verifikasi bahwa migrasi serta seed menghasilkan kondisi awal yang benar.

**Kerjakan**
- Siapkan database atau schema baru yang bersih
- Jalankan seluruh migrasi, bootstrap role aplikasi, dan seed data demo yang diperlukan
- Arahkan environment pengujian ke database/schema tersebut tanpa memasukkan credential ke repo
- Pertahankan database existing sebagai development/staging sampai pembagian environment dikonfirmasi
- Catat konfigurasi dan langkah reset/rebuild agar dapat diulang

**Selesai bila**
- [ ] Aplikasi environment pengujian terhubung ke database/schema bersih
- [ ] Seluruh migrasi berhasil dari kondisi kosong
- [ ] QA dapat dijalankan tanpa terpengaruh data lama
- [ ] Credential tidak tersimpan di repo

---

# SPRINT 4 · Kesiapan produksi (± 4,5 hari)

## B-15 · Connection pool untuk serverless
`feat/pool-tuning` · **1 hari** · 🟠 High

Cloud Run bisa scale ke banyak instance, dan **tiap instance membawa pool sendiri** → Cloud SQL bisa kehabisan koneksi saat ramai.

**Kerjakan:** setel `DATABASE_POOL_MAX` sesuai `max_connections` ÷ `max-instances`, tambahkan `connectionTimeoutMillis` & `idleTimeoutMillis`, lalu **uji beban** untuk membuktikan.

---

## B-16 · Logging terstruktur & error reporting
`feat/observability` · **1 hari** · 🟠 High

Belum ada log terstruktur, request ID, atau Error Reporting. Saat ada error di produksi, tidak ada yang tahu kecuali pengguna mengeluh.

**Kerjakan:** log JSON (Cloud Logging membacanya otomatis) · request ID yang menembus server action · Cloud Error Reporting.
⚠️ **Jangan sampai log memuat data pribadi (nama petani, email) atau isi konfigurasi sensitif.**

---

## B-17 · Uji restore Cloud SQL
`chore/backup-restore-drill` · **0,5 hari** · 🟠 High · *sebagian sudah selesai*

**Sudah dikerjakan Dimas (21 Agustus):** backup harian aktif (18:00, retensi 7) + satu backup on-demand `1787358085994`. Sebelumnya **backup sama sekali tidak aktif dan nol backup** sejak database dibuat.

**Sisa untukmu:** lakukan **restore sungguhan** ke instance sementara, catat waktu pemulihan (RTO), tulis runbook singkat. Backup yang belum pernah diuji restore belum bisa disebut backup.

Backup otomatis belum dikonfigurasi eksplisit dan **belum pernah diuji restore**. Backup yang belum pernah diuji bukan backup.

**Kerjakan:** nyalakan backup harian + PITR · **lakukan restore sungguhan** ke instance sementara · catat waktu pemulihan (RTO) · tulis runbook singkat.

---

## B-18 · Lingkungan staging
`feat/staging-env` · **2 hari** · 🟡 Medium

Sekarang merge ke `main` langsung ke produksi. Tidak ada tempat mencoba migrasi sebelum kena data sungguhan.

**Kerjakan:** Cloud Run + Cloud SQL staging, trigger dari branch `staging`, data seed demo.

---

# Ringkasan

| Sprint | Tiket | Estimasi |
|---|---|---|
| 1 · Jaring pengaman | B-5, B-3, B-2 | ✅ Selesai |
| 2 · Ketahanan data | B-1, B-13 | ✅ Selesai (PR #9) |
| **A · Alur approval & konsistensi angka** | **B-20, B-21, B-22, B-23, B-24, B-25** | **± 7 hari** |
| 3 · Jejak & skema | B-8, B-9, B-10, B-11, B-19; B-12 ditunda | ± 3,5 hari |
| 4 · Kesiapan produksi | B-15, B-16, B-17, B-18 | ± 4 hari |
| | **Total tersisa** | **± 14 hari kerja** |

## Empat hal yang menentukan urutan

**1. B-20 lebih dulu dari apa pun.** Angka yang salah lebih berbahaya daripada fitur yang belum ada, dan QA tidak bisa dituntaskan selama satu aktivitas masih menampilkan dua angka berbeda. Tiket ini **butuh keputusan Dimas** — tanyakan di awal, jangan di tengah pengerjaan.

**2. B-8 sebelum B-22.** Riwayat approval butuh kolom `approved_by`/`approved_at` yang dibuat B-8.

**3. B-21, B-22, B-23 semuanya menyentuh RLS & `v_pending_approvals`.** Rencanakan sebagai **satu migrasi `0039`** kalau bisa, supaya tidak bolak-balik menyentuh policy yang sama — dan jangan lupa memasang ulang `security_invoker`.

**4. Estimasi ± 14 hari, tenggat ± 2 minggu.** Praktis tanpa margin. Kalau harus memilih: **Sprint A + B-19 adalah yang wajib** supaya QA bisa hijau dan aplikasi layak UAT. Sprint 4 (B-15…B-18) bisa menyusul setelah UAT — kecuali **B-15**, yang naik prioritas karena Cloud SQL sudah diturunkan ke `db-g1-small` (RAM 1,7 GB → `max_connections` lebih sedikit, sementara Cloud Run bisa scale ke 4 instance dengan pool masing-masing).

## Catatan

Ada beberapa tiket tambahan yang dibagikan Dimas secara terpisah (tidak lewat repo) — tanyakan sebelum mulai Sprint 3, karena beberapa menyentuh berkas yang sama.
