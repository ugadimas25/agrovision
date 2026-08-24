# Pematangan Backend AgroVision

| | |
|---|---|
| **Assignee** | Ridwan Nulloh (`ridwannulloh`) |
| **Reviewer** | @ugadimas25 |
| **Direfine** | 24 Agustus 2026 — seluruh status di bawah **diverifikasi langsung ke kode & database**, bukan disalin dari transkrip meeting |
| **Total estimasi tersisa** | ± 12,5 hari kerja (turun dari ± 14; lihat [Ringkasan](#ringkasan)) |
| **Aturan** | Satu tiket = satu branch = satu PR, wajib approval @ugadimas25 sebelum merge |

Fokus: perbaikan alur approval, konsistensi angka, ketahanan data, kebersihan skema, dan kesiapan operasional.

---

## Baca ini dulu — 5 menit, hemat sehari

Dokumen ini terakhir direfine **21 Agustus**. Sejak itu banyak yang berubah, dan sebagian tiketmu **sudah selesai dikerjakan orang lain**. Kalau kamu langsung mulai dari daftar sprint tanpa membaca bagian ini, kamu akan mengerjakan hal yang sudah jadi.

**Yang berubah paling besar:** migrasi terakhir bukan lagi `0038`, tapi **`0052`** — 14 migrasi baru. Nomor berikutnya untuk kamu: **`0053`**.

| Tiket | Status 21 Agu | Status 24 Agu | Bukti terukur |
|---|---|---|---|
| B-20 · realisasi anggaran selalu 0 | 🔴 Critical, butuh keputusan | ✅ **Selesai** | Arah **(a) materialisasi** dipilih. `app.decide_record()` menulis `cost_transactions` (migrasi `0044`). `v_budget_vs_actual`: **15 dari 17** baris punya realisasi, total **Rp 3.034.200.000** — bukan lagi 0 |
| B-24 · survei belum masuk approval | 🟠 High | ✅ **Selesai** | `survey_submissions` ada di `v_pending_approvals`, `decide_record()` merutekannya, DEMO punya **2 approved + 1 submitted** |
| B-21 · record ditolak tidak bisa diedit | 🔴 High | 🟡 **Separuh** | `updateExpenditureAction` ada untuk **Pengeluaran saja**. 10 modul operasional masih hanya punya `create*` + `submitOp` — **belum bisa diedit**. Lihat [B-21](#b-21) |
| B-9 · `tree_survey_points` yatim | 🟡 Medium | ➡️ **Pindah ke Dimas** (AI-51) | Keputusan K-11: cakupannya naik jadi form + approval + layer peta. **Jangan dikerjakan** — bentrok |
| B-15 · connection pool | 🟠 High | 🟡 **Separuh** | `src/lib/db.ts:52-54` sudah punya `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`. Sisa: setel angkanya ke kapasitas Cloud SQL + uji beban |
| B-17 · uji restore Cloud SQL | 🟠 High | 🟡 **Separuh** | Backup harian sudah aktif (Dimas). Sisa: restore sungguhan + catat RTO |
| B-8, B-10, B-11, B-12, B-16, B-18, B-19, B-22, B-23, B-25 | — | ⬜ **Masih terbuka** | Detail per tiket di bawah, dengan angkanya |

Plus satu tiket lama yang **sudah selesai tapi tidak ada di daftarmu**: celah self-approval (AI-17 di `docs/13`). `decide_record()` sekarang menolak approver menyetujui buatannya sendiri, dengan **pengecualian super_admin yang dicatat ke `audit_log`**. Jangan diubah tanpa bicara — itu keputusan produk, bukan bug.

---

## Dua bahaya penamaan — tolong baca sebelum bicara dengan siapa pun

**1. Kode `B-nn` dipakai DUA dokumen berbeda, dengan arti yang sama sekali lain.**

| Kode | Di dokumen INI | Di sheet QA (`docs/13`, `docs/14`) |
|---|---|---|
| `B-13` | `evidence_links` INSERT dinonaktifkan | Infinite loading saat ajukan ulang setelah ditolak |
| `B-8` | Jejak audit belum menyeluruh | Skenario uji kesesuaian lahan (BLOCKED) |
| `B-1` | Penyimpanan bukti belum persisten | Skenario uji unggah bukti (BLOCKED) |

Akibatnya nyata: kalau kamu bilang *"B-13 sudah selesai"* di meeting, separuh ruangan akan mengira kamu bicara soal infinite loading. **Selalu sebut dokumennya:** "B-13 tiket backend" atau "B-13 sheet QA".

**2. `docs/13-action-item-perbaikan-20260822.md` berisi 50+ tiket `AI-*`, banyak di antaranya bertanda Backend, dan itu dikerjakan Dimas.** Jangan mengambil `AI-*` tanpa bicara lebih dulu. Tabrakan yang sudah pasti:

| Tiketmu | Tiket Dimas | Siapa yang kerjakan |
|---|---|---|
| B-9 `tree_survey_points` | **AI-51** (cakupan lebih luas: form + approval + layer peta) | **Dimas** |
| B-25 field wajib | **AI-03** (wajibkan field volume driver biaya) | **Kamu** — AI-03 adalah bagian dari B-25 |
| B-20 materialisasi biaya | AI-01 | ✅ Sudah selesai |
| — | AI-42 (perluas `at-verify.mjs` ke semua modul approval) | **Dimas**, tapi kamu wajib menambah cek untuk tiketmu sendiri |

---

## Aturan kerja

Branch `main` terkunci. Push langsung ditolak — semua perubahan lewat PR dan **harus disetujui @ugadimas25**.

```
branch baru → commit → push branch → buka PR
  → review @ugadimas25 → merge ke main → auto-deploy Cloud Run
```

Penamaan branch: `feat/…`, `fix/…`, `chore/…`

### Baseline yang TIDAK BOLEH turun

Ini bukan formalitas. Jalankan **setiap kali selesai satu tiket**, bukan hanya di akhir — kalau ada yang merah setelah lima tiket, kamu tidak akan tahu tiket mana penyebabnya.

| Perintah | Angka sekarang |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm run lint` | 0 error, 13 warning |
| `npm run build` | sukses |
| `npm run db:test` | 45 PASS / 0 FAIL |
| `npm run db:test:adversarial` | 66 PASS / 0 FAIL — semuanya *harus* gagal ditolak |
| `npm run at:verify` | 149 PASS / 0 FAIL (butuh `npm run dev` hidup) |
| `npm run db:verify` | 0 drift |
| `app.check_rls_coverage()` | 0 baris |
| `app.check_privilege_revocations()` | 0 baris |

> Angka `at:verify` dan `adversarial` bisa **naik** sementara PR #29 & #30 belum di-merge (149 dan 66 sudah termasuk keduanya). Kalau punyamu lebih rendah, `git pull origin main` dulu, jangan dianggap regresi.

**Tiap tiket yang menyentuh RLS, policy, atau privilege wajib menambah kasus baru di `db/verify-adversarial.mjs`** — kasus yang *harus gagal*. Tanpa itu tidak ada bukti gerbangnya bekerja.

---

## Konteks sistem

- **Next.js 16** (App Router, RSC + Server Actions) + **PostgreSQL 16 + PostGIS**
- Produksi: **Cloud Run** + **Cloud SQL**, region `asia-southeast2`
- Aplikasi konek DB sebagai `app_user` — **bukan** superuser. Ini bukan detail: append-only & RLS ditegakkan lewat REVOKE + policy, jadi menguji sebagai `postgres` membuat semua uji **lulus palsu**
- Migrasi: ledger ber-checksum di `db/migrations/`, dijalankan `npm run db:migrate` — terakhir **0052**, berikutnya **0053**
- **Prinsip data:** nilai kosong ditulis `—`, **tidak pernah** `0`. Angka fabrikasi di layar finansial dianggap kegagalan fatal
- Rujukan utama: **`docs/technical-documentation.md`** (arsitektur, model keamanan, runbook). Baca bagian yang relevan sebelum menyentuh area itu

### Menjalankan lokal

```bash
cp .env.example .env.local     # isi nilai dummy untuk pengembangan
docker compose up -d db        # PostgreSQL 16 + PostGIS, port 55433
npm ci
npm run db:migrate             # skema + PostGIS
npm run db:bootstrap           # role aplikasi (app_user + GRANT + re-apply REVOKE)
npm run db:seed:demo           # data & akun demo
npm run dev
```

Akun demo (dummy, domain `.invalid` memang tidak bisa dipakai sungguhan):
`admin@demo.invalid` · `approver@demo.invalid` · `creator@demo.invalid` · `direktur@demo.invalid`

Nilai environment sungguhan (project ID, connection name, secret) **tidak ada di repo** — minta ke Dimas.

### Enam gotcha yang sudah pernah menggigit

Semuanya nyata, semuanya memakan waktu orang sebelum kamu.

1. **`CREATE OR REPLACE VIEW` menjatuhkan opsi `security_invoker`.** Setiap migrasi yang menyentuh `app.v_pending_approvals` **wajib** memasangnya ulang di akhir file. Sudah menggigit dua kali (lihat `0035` yang memperbaiki `0034`). Tujuh migrasi menyentuh view ini: `0025`, `0034`, `0035`, `0036`, `0038`, `0040`, `0042`.
2. **`postgres` di Cloud SQL bukan superuser.** Perilaku privilege dan RLS berbeda dari Docker lokal. Migrasi yang menyentuh privilege/RLS **wajib diuji di Cloud SQL**, bukan hanya lokal.
3. **`FORCE ROW LEVEL SECURITY` memblokir fungsi `SECURITY DEFINER`** — pernah membuat login dan seed gagal total di Cloud SQL. Pakai `NO FORCE`.
4. **`npm run db:seed:demo` TIDAK idempoten.** Jalankan `npm run db:purge:demo` dulu. Dan **ambil dump sebelum perintah destruktif apa pun** — `docker exec -i agrovision-db pg_dump -U postgres -d agrovision --no-owner > db/backups/pre-<apa>-$(date +%Y%m%d-%H%M%S).sql`.
5. **Berkas `"use server"` hanya boleh mengekspor fungsi `async`.** Mengekspor objek (mis. nilai awal `useActionState`) membuat **setiap POST ke halaman itu jadi HTTP 500**, dan `tsc` maupun `lint` **tidak menangkapnya**. Galatnya muncul di log dev sebagai `A "use server" file can only export async functions, found object.`
6. **`notFound()` di bawah batas `loading.tsx` menjawab HTTP 200, bukan 404.** Lihat [B-26](#b-26).

---

# Sudah selesai — jangan dikerjakan lagi

Ringkas saja, supaya kamu tidak membuka tiket yang sudah tutup. Kalau perlu detail, baca commit-nya.

| Tiket | Isi | Bukti |
|---|---|---|
| **B-5** | Tombol "Setujui" tidak mengirim `moduleKey` | Approve berhasil di semua modul; `at:verify` AT4 menguji ajukan → setujui → tolak |
| **B-3** | CI: lint, typecheck, build, uji DB | `.github/workflows/ci.yml`; trigger `branches: [main, 'feat/**']` supaya PR di tengah stack ikut diuji |
| **B-2** | Migrasi belum jalan saat deploy | `cloudbuild.yaml`: build → push → **migrasi** → deploy. Migrasi gagal ⇒ deploy tidak jalan |
| **B-1** | Penyimpanan bukti belum persisten | Cloud Storage di `src/lib/storage.ts`; bucket `agrovision-evidence-393569486275`, public-access-prevention **enforced**, SA punya `objectAdmin` hanya di bucket itu + `tokenCreator` atas dirinya sendiri (tanpa itu `getSignedUrl()` gagal di Cloud Run) |
| **B-13** | `evidence_links` INSERT dinonaktifkan | Aktif kembali; jalur `evidence_files` + `evidence_links` sekarang juga dipakai bukti sertifikasi K1–K7 |
| **B-20** | Realisasi anggaran selalu 0 | Arah (a) materialisasi, migrasi `0044` + `0047`. **15/17** baris anggaran punya realisasi, total Rp 3.034.200.000 |
| **B-24** | Survei belum masuk approval | `survey_submissions` di `v_pending_approvals` + routing `decide_record()`; DEMO: 2 approved, 1 submitted |
| *(AI-17)* | Celah self-approval | `decide_record()` menolak `created_by = actor`; pengecualian super_admin **dicatat** ke `audit_log` dengan `self_approval_exception: true` |

---

# SPRINT A · Sisa perbaikan alur approval (± 4,5 hari) — PRIORITAS TERTINGGI

B-20 sudah selesai, jadi akar masalah angka sudah tertutup. Yang tersisa di sprint ini soal **hak akses, kelengkapan data, dan akuntabilitas** — dan dua di antaranya masih menahan QA.

<a id="b-21"></a>
## B-21 · Record ditolak tidak bisa diedit — **baru separuh jalan**
`feat/rejected-editable-oprecords` · **1,5 hari** · 🔴 High

**Yang sudah ada:** `updateExpenditureAction` (`src/lib/actions/costing.ts:194`) + `ExpenditureEditor.tsx`. Repo-nya membersihkan `rejection_reason` saat disimpan (`src/lib/repo/costing.ts:292`). Jadi untuk **Pengeluaran**, tiket ini sudah tuntas — dan polanya bisa kamu tiru.

**Yang belum:** sepuluh modul operasional. `src/lib/actions/operational.ts` hanya punya `createFertilizerAction`, `createLandPrepAction`, `createLandSuitabilityAction`, `createPruningAction`, `createWeedingAction`, `createSprayingAction`, `createHarvestAction`, `createNurseryInspectionAction`, `createDbhAction`, `createSeedDistributionAction`, `submitOpAction` — **nol action edit**.

Akibatnya keluhan asli B-21 masih berlaku persis untuk 10 modul itu: `submitOpRecord` menerima status `draft` **dan** `rejected`, jadi record ditolak bisa diajukan ulang — **tapi apa adanya**. Padahal alasan penolakan justru meminta perbaikan. Praktisnya petugas mengajukan ulang data yang sama, lalu ditolak lagi.

**Kerjakan**
1. Satu action edit generik untuk record operasional (`updateOpRecordAction`) — jangan sepuluh action yang hampir sama. `OpRecordForm`/`OpRecordTable` sudah generik, ikuti itu
2. Hanya oleh **pembuatnya**, hanya status `draft`/`rejected`
3. Saat disimpan: status kembali `draft`, `rejection_reason` dibersihkan
4. Tegakkan di lapis DB juga. Policy `*_role_split` sudah membatasi UPDATE ke baris sendiri berstatus draft/rejected — **verifikasi**, jangan asumsikan, karena bentuk policy-nya berbeda antar tabel
5. UI: tombol **Perbaiki** pada record ditolak (koordinasi penempatan dengan Dimas)

**Selesai bila**
- [ ] Record ditolak di penyiangan, panen, pemupukan bisa diedit pembuatnya lalu diajukan ulang dengan data baru
- [ ] Approver **tidak** bisa mengedit data milik orang lain lewat jalur ini — dibuktikan lewat kasus baru di `db/verify-adversarial.mjs`
- [ ] Record `approved` **tidak** bisa diedit lewat jalur ini
- [ ] Alasan penolakan hilang setelah diperbaiki
- [ ] `at:verify` punya cek: tolak → edit → ajukan ulang → data **berubah**

---

## B-22 · Inbox approval tidak menyimpan riwayat
`feat/approval-history` · **1 hari** · 🟠 High · *butuh B-8 lebih dulu*

**Terverifikasi masih terbuka.** `pg_get_viewdef('app.v_pending_approvals')` masih memfilter `approval_status = ANY (ARRAY['submitted','under_review'])` di setiap cabangnya, dan `src/app/(app)/approval/page.tsx` tidak punya satu pun rujukan riwayat.

Jadi begitu diputuskan, ajuan **langsung hilang** dari Inbox. Approver tidak punya cara melihat apa yang pernah dia setujui atau tolak — kebutuhan dasar akuntabilitas, dan tanpa itu keputusan lama tidak bisa diperiksa.

**Ada kabar baik yang mengubah rencana aslinya.** Tiket versi lama bilang ini butuh kolom `approved_by`/`approved_at` dari B-8. Setelah ditelusuri: **kolom itu kemungkinan besar tidak perlu.** `app.audit_log` sudah memuat aktor + waktu + diff, dan trigger `write_audit()` mencatat perubahan `approval_status` di tabel yang sudah dipasangi — `cost_transactions` membuktikannya. Jadi riwayat bisa dibaca dari `audit_log` alih-alih menambah dua kolom di 11 tabel. Yang hilang hanyalah triggernya, dan **itu persis isi B-8**.

Diskusikan bentuk akhirnya dengan Dimas sebelum menulis migrasi — ada juga opsi menghidupkan `approval_requests` alih-alih membuangnya (lihat B-11).

> ⚠️ **Sudah diperiksa, dan hasilnya penting untuk rencanamu:** `decide_record()` punya **tepat satu** `INSERT INTO app.audit_log`, dan itu ada di cabang pengecualian self-approval super_admin. **Keputusan biasa tidak dicatat oleh fungsinya** — hanya oleh trigger `write_audit()` di tabelnya. Karena 11 dari 12 tabel approval belum punya trigger itu, jejak keputusan untuk hampir semua modul memang belum ada di mana pun. Jadi B-8 bukan sekadar prasyarat administratif: **tanpa B-8, riwayat yang kamu bangun akan kosong**, dan kosongnya akan terlihat seperti "belum ada keputusan", bukan seperti bug.

**Kerjakan** (migrasi `0053`)
1. View riwayat (mis. `v_approval_history`) atau parameter status pada view yang ada — **jangan** ubah perilaku Inbox default (tetap hanya yang menunggu)
2. Tampilkan: siapa memutuskan, kapan, keputusannya, alasan penolakan
3. ⚠️ **Pasang ulang `ALTER VIEW … SET (security_invoker = true)`** kalau menyentuh `v_pending_approvals`

**Selesai bila**
- [ ] Approver bisa melihat ajuan yang sudah diputuskan, lengkap dengan siapa & kapan
- [ ] Inbox default tetap hanya menampilkan yang menunggu
- [ ] Creator bisa melihat riwayat ajuannya sendiri, dan **tidak** riwayat orang lain
- [ ] Dibuktikan lewat SQL langsung, bukan hanya dari tampilan

---

## B-23 · Creator masih melihat data seluruh perusahaan
`fix/creator-own-data-scope` · **1 hari** · 🟠 High

**Terverifikasi masih terbuka.** `pg_policies` pada `weeding_records` hari ini:

| Policy | cmd | Efek |
|---|---|---|
| `weeding_records_tenant` | ALL | batas per **tenant** (lewat blok → perusahaan) |
| `weeding_records_viewer_readonly` | ALL | viewer hanya baca |
| `weeding_records_role_split` | **UPDATE** | batas **tulis** ke baris sendiri |

Untuk **SELECT** tidak ada pembatasan per pembuat. Creator melihat seluruh data perusahaan. Di seluruh skema hanya ada **satu** policy per-pembuat, dan itu untuk DELETE: `lsa_delete_draft_own` di `land_suitability_assessments`.

**Kerjakan** (migrasi `0053`)
1. Policy SELECT terpisah: role `creator` → hanya `created_by = app.current_user_id()`; approver/super_admin/viewer tetap lingkup tenant
2. Terapkan konsisten ke **semua 13 tabel** ber-`approval_status`
3. Tambah invariant seperti `app.check_rls_coverage()` supaya tabel baru tidak lupa dipasangi
4. ⚠️ Uji di **Cloud SQL**, bukan hanya Docker lokal

**Selesai bila**
- [ ] Login `creator@` → hanya melihat record buatannya sendiri
- [ ] Login `approver@` → tetap melihat semua ajuan perusahaan
- [ ] Dibuktikan **lewat SQL langsung** di `db/verify.mjs` + kasus adversarial, bukan dari tampilan UI
- [ ] Laporan & dashboard **tidak jadi kosong** untuk creator — periksa dampaknya sebelum merge. Ini risiko nyata: banyak layar membaca lewat repo yang sama

> **Hati-hati satu hal.** Tanpa konteks RLS, query mengembalikan **0 baris tanpa error** — persis seperti "belum ada data", bukan seperti bug. Kalau setelah perubahanmu ada layar yang kosong, jangan buru-buru menyimpulkan datanya tidak ada.

---

## B-25 · Field wajib & rumus biaya belum ditegakkan
`feat/mandatory-cost-drivers` · **1 hari** · 🟠 High · *menyerap AI-03 dari `docs/13`*

**Terverifikasi masih terbuka, dan bentuknya lebih tajam dari yang tertulis 21 Agustus.**

Constraint-nya **ada**, tapi justru **mengizinkan NULL secara eksplisit**:

```
weeding_records_area_ha_check       → CHECK ((area_ha IS NULL) OR (area_ha >= 0))
spraying_records_total_volume_check → CHECK ((total_volume IS NULL) OR (total_volume >= 0))
pruning_records_tree_count_check    → CHECK ((tree_count >= 0))
```

Kolomnya juga masih `is_nullable = YES` untuk `weeding_records.area_ha`, `pruning_records.tree_count`, `spraying_records.unit`. Yang sudah `NOT NULL` hanya `harvest_records.quantity_ton`.

Di lapis zod pun `treeCount` masih `.optional()` (`src/lib/actions/operational.ts:68`).

**Dan celah ini tidak kelihatan dari data demo:** `weeding.area_ha`, `pruning.tree_count`, `spraying.total_volume` semuanya punya **0 baris NULL**. Artinya seluruh uji yang hanya melihat dataset demo akan **hijau** sambil membiarkan lubangnya terbuka. Jangan mengandalkan demo untuk membuktikan tiket ini — buat baris NULL sengaja, dan pastikan ditolak.

Ini penting karena biaya operasional dihitung **volume × tarif**: volume kosong ⇒ biaya tidak bisa dihitung, dan itu langsung memukul realisasi anggaran yang baru saja diperbaiki B-20.

**Kerjakan**
1. Wajibkan di **tiga lapis**: zod di server action · `NOT NULL`/`CHECK` di DB (migrasi `0053`) · atribut `required` di form
2. **Hati-hati:** `NOT NULL` pada tabel berisi data akan gagal. Bersihkan/isi data lama dulu, atau pakai `CHECK` dengan pengecualian tercatat untuk baris lama — dan **tulis di PR** baris mana yang dikecualikan dan mengapa
3. Pastikan satuan konsisten dengan `app.price_list.unit` supaya volume × tarif tidak salah satuan
4. Daftar field final per modul: koordinasi dengan Dimas. Yang sudah disebut meeting: luas area · jumlah tenaga/orang · jumlah pohon · volume & satuan · komponen rekomendasi pemupukan

**Selesai bila**
- [ ] Kirim form tanpa field wajib → ditolak dengan pesan **per field**, bukan satu pesan umum
- [ ] Ditegakkan di DB — dibuktikan lewat `INSERT` langsung yang gagal, di `db/verify-adversarial.mjs`
- [ ] Biaya = volume × tarif menghasilkan angka yang cocok dengan hitungan manual; satu contoh ditulis di PR
- [ ] Realisasi anggaran tidak turun setelah perubahan ini

---

# SPRINT 3 · Kelengkapan jejak & kebersihan skema (± 3,5 hari)

<a id="b-8"></a>
## B-8 · Jejak audit belum menyeluruh
`feat/audit-trail-approval` · **1 hari** · 🟠 High · *prasyarat B-22*

**Terverifikasi. Angkanya:** 18 tabel punya trigger `write_audit()`, tapi dari **12 tabel** ber-`approval_status`, hanya **satu** yang punya (`cost_transactions`). **Sebelas tabel tidak punya:**

```
dbh_measurements · fertilizer_applications · harvest_records · land_preparations
land_suitability_assessments · nursery_inspections · pruning_records
spraying_records · survey_submissions · tree_survey_points · weeding_records
```

Artinya: siapa yang menyetujui pemupukan atau panen **tidak terekam di mana pun**. Untuk modul yang triggernya ada (`cost_transactions`, `blocks`, `emission_factors`, `carbon_runs`, `cert_decisions`), jejaknya lengkap.

**Kerjakan** (migrasi `0053`)
- Pasang trigger `write_audit()` ke 11 tabel itu
- Pastikan perubahan `approval_status` + aktor tercatat — bukan hanya INSERT
- Tambah invariant: setiap tabel ber-`approval_status` **wajib** punya trigger audit. Taruh sebagai fungsi health-check yang mengembalikan nol baris, sejajar `app.check_rls_coverage()`, supaya tabel baru tidak bisa lupa
- Periksa juga apakah `decide_record()` perlu menulis `audit_log` untuk **setiap** keputusan (lihat catatan di B-22)

**Selesai bila**
- [ ] Setujui/tolak di modul mana pun → tercatat di `audit_log` dengan aktor & waktu
- [ ] Fungsi invariant baru mengembalikan **nol baris**, dan masuk ke `db/verify.mjs`
- [ ] `audit_log` tetap append-only (cek `app.privilege_revocations`)

---

## B-9 · `tree_survey_points` — **dipindah ke Dimas**
~~`fix/tree-survey-approval`~~ · **0 hari untukmu**

Keputusan **K-11** (23 Agustus) menaikkan cakupannya: bukan lagi "hubungkan kolom approval yatim", tapi bangun penuh — form input titik pohon + approval + layer peta dari tabel ini. Sekarang bernama **AI-51** di `docs/13` dan dikerjakan Dimas.

Keadaan tabelnya sekarang: **0 baris**, tidak ada di `v_pending_approvals`, dan **nol referensi di `src/`**.

**Jangan dikerjakan.** Kalau kamu butuh menyentuh tabel ini untuk B-8 (memasang trigger audit), silakan — tapi bilang ke Dimas supaya migrasinya tidak bertabrakan.

Catatan teknis kalau nanti kamu tetap terlibat: `client_uuid NOT NULL UNIQUE` (migrasi `0007`) berarti klien wajib membangkitkan UUID sendiri — kolom itu memang disiapkan untuk idempotensi sync perangkat.

---

## B-10 · Kolom `users.role` warisan
`chore/drop-legacy-role` · **0,5 hari** · 🟡 Medium

**Terverifikasi masih ada, dan lebih berbahaya dari sekadar duplikasi.** Kolom `role` (enum lama 8 nilai, `0002_core.sql:34-46`) masih hidup di samping `app_role` yang kanonik, sudah ditandai DEPRECATED di `0014:64` tapi tak pernah di-`DROP`.

Yang membuatnya bukan sekadar kerapian: **isinya saling bertentangan.** Nilai nyata di database hari ini:

```
role      app_role        role      app_role
--------  -----------     --------  -----------
viewer    approver        manager   super_admin
viewer    creator         admin     super_admin
viewer    super_admin     approver  approver
manager   viewer          surveyor  creator
```

Baris `role = 'viewer'` dengan `app_role = 'super_admin'` bukan hipotesis — itu ada di database sekarang. Satu query yang salah membaca kolom, dan super_admin diperlakukan sebagai viewer, atau sebaliknya.

**Kerjakan**
1. Pastikan **nol** pemakaian di `src/` dan `db/`. Yang sudah ketemu: `db/seed-dev.mjs:52,67` masih mengisi dan mencetak `role`
2. Drop kolom + enum lamanya lewat migrasi `0053`
3. Perbaiki seed supaya tidak menulis kolom yang sudah tidak ada

**Selesai bila**
- [ ] `grep -rn "\.role" src/ db/` tidak menghasilkan pemakaian `users.role` (`ctx.session.role` **bukan** kolom ini — itu `app_role`, jangan ikut dihapus)
- [ ] `npm run db:seed:dev` dan `db:seed:demo` masih jalan dari database kosong
- [ ] Baseline penuh hijau

---

## B-11 · Tabel approval berjenjang yang tidak terpakai
`chore/drop-dead-approval-tables` · **1 hari** *(naik dari 0,5)* · 🟡 Medium

**Terverifikasi: 0 baris di `approval_requests`, 0 baris di `approval_steps`, dan nol referensi di `src/`.** Keputusan meeting 21 Agustus: approval saat ini satu tingkat, berjenjang belum diperlukan.

**Estimasinya naik karena ada yang belum terlihat 21 Agustus:** kolom `approval_id` di **lima tabel** — `block_boundary_versions`, `cost_transactions`, `nursery_inspections`, `survey_submissions`, `tree_survey_points` — punya **foreign key ke `approval_requests`**. Jadi ini bukan drop dua tabel mati; ini drop dua tabel **plus** lima kolom FK di tabel yang hidup dan berisi data.

**Putuskan dulu dengan Dimas, jangan pilih sendiri:**
- **(a) Drop semuanya** — dua tabel + lima kolom `approval_id`. Paling bersih, tapi membuang tempat jejak keputusan yang mungkin dipakai B-22
- **(b) Tunda sampai B-22 selesai** — kalau riwayat approval ternyata lebih pas disimpan di `approval_requests` daripada `audit_log`, tabel ini justru dihidupkan, bukan dibuang

Saran: **kerjakan B-22 lebih dulu**, lalu tiket ini jadi jelas ke arah mana. Membuang tabel lalu membangunnya kembali dua minggu berikutnya adalah pekerjaan dua kali.

**Selesai bila**
- [ ] Arah (a) atau (b) disepakati dan alasannya ditulis di PR
- [ ] Kalau (a): migrasi idempoten, dan dokumentasikan di `docs/technical-documentation.md` bahwa alur aktif adalah approval **satu tingkat**
- [ ] Baseline penuh hijau, termasuk `at:verify`

---

## B-12 · Status yang tak pernah dipakai
`chore/prune-record-status` · **0,5 hari** · 🟡 Medium · ⏸ **Ditunda**

**Jangan dikerjakan** sampai finalisasi alur dikonfirmasi Dimas.

Data terkini kalau nanti dibuka: enum `app.record_status` punya 6 nilai (`draft, submitted, under_review, approved, rejected, cancelled`). `under_review` muncul **9 kali** di `src/` dan `cancelled` **19 kali** — tapi semuanya di klausa `IN (…)`, label i18n, dan tipe; **nol baris** di database yang benar-benar berstatus itu. State machine efektifnya 4 status.

Kalau dibuka: buang dari enum & label, **atau** implementasikan alurnya. Jangan setengah — enum yang punya nilai tanpa jalur adalah jebakan untuk pembaca berikutnya.

---

## B-19 · Database/schema bersih untuk pengujian
`chore/clean-test-database` · **1 hari** · 🟠 High

**Sebagian sudah terjawab tanpa disadari.** CI (`.github/workflows/ci.yml`) sudah menjalankan `db:migrate` → `db:bootstrap` → `db:test` → `db:test:adversarial` di atas container PostGIS **kosong setiap run**. Jadi klaim "seluruh migrasi berhasil dari kondisi kosong" sudah diuji otomatis di setiap PR.

**Yang belum:** environment **pengujian** (untuk QA manual) masih memakai database yang sama dengan development, sehingga data lama memengaruhi hasil QA.

**Kerjakan**
- Siapkan database atau schema baru yang bersih untuk QA
- Jalankan seluruh migrasi + bootstrap role + seed demo di sana
- Arahkan environment pengujian ke database/schema itu **tanpa** memasukkan credential ke repo
- Pertahankan database existing sebagai development/staging sampai pembagian environment dikonfirmasi
- Catat langkah reset/rebuild di `docs/technical-documentation.md` supaya bisa diulang siapa pun

> Satu hal yang perlu kamu tahu sebelum mulai: **`npm run db:purge:demo` pernah rusak total** — FK violation, 16 tabel tidak ikut dihapus. Sudah diperbaiki, tapi uji ulang di environment barumu: purge → seed → `npm run db:check` harus nol baris `blocking` selain stub login dan dua tenant demo.

**Selesai bila**
- [ ] Aplikasi environment pengujian terhubung ke database/schema bersih
- [ ] `db:purge:demo` → `db:seed:demo` → `db:check` berjalan bersih dua kali berturut-turut
- [ ] QA bisa dijalankan tanpa terpengaruh data lama
- [ ] Credential tidak tersimpan di repo

---

# SPRINT 4 · Kesiapan produksi (± 4 hari)

## B-15 · Connection pool untuk serverless — **separuh selesai**
`feat/pool-tuning` · **0,5 hari** *(turun dari 1)* · 🟠 High

**Yang sudah ada** di `src/lib/db.ts:52-54`:

```ts
max: Number(process.env.DATABASE_POOL_MAX ?? 10),
idleTimeoutMillis: 30_000,
connectionTimeoutMillis: 10_000,
```

**Yang belum:** angkanya belum disetel ke kapasitas Cloud SQL yang sebenarnya, dan belum ada uji beban yang membuktikannya.

Prioritasnya naik karena Cloud SQL sudah diturunkan ke **`db-g1-small`** (RAM 1,7 GB ⇒ `max_connections` lebih kecil), sementara Cloud Run bisa scale ke 4 instance **dengan pool masing-masing**. Default `max: 10` × 4 instance = 40 koneksi, dan itu belum termasuk migrasi yang jalan saat deploy.

**Kerjakan:** hitung `DATABASE_POOL_MAX` = `max_connections` ÷ `max-instances` (sisakan margin untuk migrasi & koneksi admin) · set di Cloud Run · **uji beban** sampai melihat perilakunya saat pool penuh — apakah request menunggu atau gagal, dan apakah pesannya bisa dimengerti.

**Selesai bila**
- [ ] Angka `DATABASE_POOL_MAX` dihitung dari `max_connections` sungguhan dan ditulis di PR
- [ ] Uji beban menunjukkan tidak ada `too many connections` pada beban puncak yang diharapkan
- [ ] Perilaku saat pool penuh terdokumentasi

---

## B-16 · Logging terstruktur & error reporting
`feat/observability` · **1 hari** · 🟠 High

**Terverifikasi belum ada apa pun:** nol rujukan log terstruktur, request ID, atau Error Reporting di `src/lib/`. Saat ada error di produksi, tidak ada yang tahu kecuali pengguna mengeluh.

**Kerjakan:** log JSON (Cloud Logging membacanya otomatis) · request ID yang menembus server action · Cloud Error Reporting.

⚠️ **Jangan sampai log memuat data pribadi** (nama petani, email pengguna) atau isi konfigurasi sensitif. Ini bukan catatan gaya — email pengguna adalah identitas, dan log Cloud Logging bisa dibaca lebih banyak orang daripada database.

**Selesai bila**
- [ ] Error di server action muncul di Cloud Error Reporting dengan stack trace
- [ ] Satu request bisa dilacak dari awal sampai akhir lewat request ID
- [ ] Diperiksa: nol email/nama pengguna di sampel log

---

## B-17 · Uji restore Cloud SQL — **separuh selesai**
`chore/backup-restore-drill` · **0,5 hari** · 🟠 High

**Sudah dikerjakan Dimas (21 Agustus):** backup harian aktif (18:00, retensi 7) + satu backup on-demand `1787358085994`. Sebelumnya backup **sama sekali tidak aktif dan nol backup** sejak database dibuat.

**Sisa untukmu:** lakukan **restore sungguhan** ke instance sementara, catat waktu pemulihan (RTO), tulis runbook singkat di `docs/technical-documentation.md`. Aktifkan juga PITR kalau belum.

Backup yang belum pernah diuji restore belum bisa disebut backup.

**Selesai bila**
- [ ] Restore ke instance sementara berhasil, dan aplikasi bisa konek ke hasil restore
- [ ] RTO tercatat dengan angka
- [ ] Runbook cukup jelas untuk dijalankan orang yang belum pernah melakukannya

---

## B-18 · Lingkungan staging
`feat/staging-env` · **2 hari** · 🟡 Medium

**Terverifikasi belum ada.** `cloudbuild.yaml` hanya punya jalur branch `main` → produksi. Merge ke `main` langsung ke produksi; tidak ada tempat mencoba migrasi sebelum kena data sungguhan.

**Kerjakan:** Cloud Run + Cloud SQL staging · trigger dari branch `staging` · data seed demo.

**Selesai bila**
- [ ] Push ke branch `staging` men-deploy ke Cloud Run staging
- [ ] Migrasi berjalan di staging lebih dulu, dan gagalnya **tidak** memblokir produksi
- [ ] Staging punya data demo sendiri, bukan salinan produksi

---

# Tiket baru dari temuan 22–24 Agustus

<a id="b-26"></a>
## B-26 · `notFound()` menjawab HTTP 200, bukan 404
`fix/notfound-status-code` · **0,5 hari** · 🟡 Medium

**Ditemukan 24 Agustus, terverifikasi.** Rute di bawah batas `loading.tsx` mem-flush shell HTML lebih dulu, jadi saat `notFound()` dipanggil, status sudah terkirim sebagai 200 dan tidak bisa diubah lagi. Isi halamannya benar (halaman 404), tapi **status HTTP-nya salah**.

Buktinya:

```
/rute-yang-tidak-ada        → 404   (tidak ada loading.tsx di jalurnya)
/survei/hasil/bukan-uuid    → 200   (ada src/app/(app)/survei/loading.tsx)
/survei/tidak-ada-form      → 200   (rute lama, perilaku sama — bukan regresi baru)
```

Ada **13 berkas `loading.tsx`**: `dashboard`, `costing`, `laporan`, `survei`, `pengguna`, `pengaturan`, `keberlanjutan`, `traceability`, `aktivitas`, `operasional`, `agri-input`, `nursery`, `approval`. Praktisnya hampir seluruh aplikasi.

**Kenapa ini penting:** monitoring tidak bisa membedakan halaman hilang dari halaman sehat, crawler mengindeks halaman 404 sebagai halaman sah, dan uji otomatis tidak bisa memakai status sebagai penanda.

**Kerjakan:** putuskan dengan Dimas — pindahkan pemeriksaan yang bisa gagal ke sebelum batas streaming, atau terima 200 dan pakai penanda lain untuk monitoring. **Jangan** sekadar membuang `loading.tsx`: itu menghapus skeleton yang memang berguna di koneksi lambat.

**Selesai bila**
- [ ] Arah disepakati dan ditulis di PR
- [ ] Kalau diperbaiki: `/survei/hasil/<uuid-tidak-ada>` menjawab 404, dan skeleton loading tetap muncul
- [ ] `at:verify` punya cek statusnya

---

## B-27 · Stub login masih aktif — **satu-satunya penghalang produksi yang belum ada pemiliknya**
`feat/identity-platform-verify` · **2–3 hari** · 🔴 **Critical** · *butuh keputusan & kredensial Dimas*

**Ini tidak ada di daftar tiket siapa pun** — tidak di dokumen ini, tidak di `docs/13`. Saya munculkan di sini karena ini backend security dan ini yang menahan produksi. **Putuskan dengan Dimas apakah masuk lingkupmu**; kalau tidak, tiket ini tetap harus punya pemilik.

`resolveLogin()` di `src/lib/session.ts` **mencocokkan email ke user aktif tanpa verifikasi kredensial apa pun**. Siapa pun yang tahu sebuah email terdaftar bisa masuk sebagai orang itu. `app.check_production_readiness()` menandainya sebagai **blocking**:

```
login stub masih aktif | blocking | app.lookup_login_email masih ada;
                                    verifikasi ID token Identity Platform belum terpasang
```

Yang **sudah** nyata dan tidak perlu dibangun ulang: mekanisme sesinya sendiri sudah benar — cookie httpOnly bertanda HMAC, 12 jam, **diverifikasi ulang ke database setiap request** (jadi menonaktifkan pengguna langsung berlaku), dan menyimpan `externalId`, bukan uuid internal. Yang hilang **hanya** verifikasi ID token.

**Kerjakan**
1. Verifikasi ID token Identity Platform di `resolveLogin()` — validasi signature, issuer, audience, expiry
2. Hapus `app.lookup_login_email` setelah jalur baru terbukti jalan
3. Pastikan `check_production_readiness()` berhenti melaporkan baris ini
4. Jalur pengembangan lokal tetap harus bisa jalan tanpa Identity Platform — **tapi jangan** lewat flag yang bisa ikut ke produksi tanpa sengaja

**Selesai bila**
- [ ] Login dengan email terdaftar **tanpa** token yang sah → gagal
- [ ] `app.check_production_readiness()` tidak lagi melaporkan stub login sebagai blocking
- [ ] Sesi 12 jam, verifikasi ulang per request, dan pengguna nonaktif langsung tertolak — semuanya masih berlaku
- [ ] Kasus baru di `db/verify-adversarial.mjs` dan `scripts/at-verify.mjs`

---

<a id="ringkasan"></a>
# Ringkasan

| Sprint | Tiket | Estimasi |
|---|---|---|
| 1 · Jaring pengaman | B-5, B-3, B-2 | ✅ Selesai |
| 2 · Ketahanan data | B-1, B-13 | ✅ Selesai |
| Akar angka | B-20, B-24 | ✅ Selesai |
| **A · Sisa alur approval** | **B-21 (sisa), B-22, B-23, B-25** | **± 4,5 hari** |
| 3 · Jejak & skema | B-8, B-10, B-11, B-19 · B-9 → Dimas · B-12 ditunda | ± 3,5 hari |
| 4 · Kesiapan produksi | B-15 (sisa), B-16, B-17 (sisa), B-18 | ± 4 hari |
| Baru | B-26 | ± 0,5 hari |
| | **Total tersisa** | **± 12,5 hari kerja** |
| Belum ada pemilik | **B-27** stub login | ± 2–3 hari |

## Lima hal yang menentukan urutan

**1. B-8 sebelum B-22.** Riwayat approval butuh jejak audit, dan 11 dari 13 tabel approval belum punya trigger audit. Tanpa B-8, riwayatnya akan kosong untuk hampir semua modul — dan kosongnya tidak akan terlihat seperti bug, hanya seperti "belum ada keputusan".

**2. B-22 sebelum B-11.** Kalau riwayat ternyata lebih pas disimpan di `approval_requests`, tabel itu dihidupkan, bukan dibuang. Membuangnya lebih dulu berarti membangunnya kembali dua minggu kemudian.

**3. B-21, B-23, B-25 semuanya menyentuh RLS & tabel operasional yang sama.** Rencanakan sebagai **satu migrasi `0053`** kalau bisa, supaya tidak bolak-balik menyentuh policy yang sama. Dan jangan lupa memasang ulang `security_invoker` kalau menyentuh view.

**4. B-23 punya risiko yang tidak kelihatan.** Menyempitkan SELECT untuk creator bisa mengosongkan laporan & dashboard bagi role itu. Periksa dampaknya **sebelum** merge, bukan setelah QA mengeluh — dan ingat bahwa RLS mengembalikan 0 baris **tanpa error**, jadi gejalanya terlihat seperti "belum ada data".

**5. Kalau harus memilih:** **Sprint A + B-8 + B-19** adalah yang wajib supaya QA bisa hijau dan aplikasi layak UAT. Sprint 4 bisa menyusul setelah UAT — kecuali **B-15**, yang naik prioritas karena Cloud SQL sudah `db-g1-small` sementara Cloud Run bisa 4 instance dengan pool masing-masing.

## Cara menulis PR yang cepat di-review

Reviewer-nya satu orang dan waktunya terbatas. Yang membuat review cepat:

- **Angka, bukan klaim.** "Realisasi 15/17 baris, total Rp 3,03 M" bisa diperiksa; "sudah jalan" tidak.
- **Tulis apa yang kamu putuskan dan mengapa**, terutama di tiket yang punya dua arah (B-11) atau butuh keputusan Dimas (B-25, B-26, B-27).
- **Sebutkan apa yang belum kamu verifikasi.** Kalau kamu tidak bisa menguji di Cloud SQL, tulis itu. Lebih baik daripada reviewer menemukannya setelah merge.
- **Kalau menemukan hal yang lebih berbahaya dari tiketmu, laporkan dulu** sebelum melanjutkan. Sudah beberapa kali terjadi di proyek ini, dan setiap kali lebih murah dilaporkan lebih awal.
- **Satu pertanyaan untuk setiap uji yang kamu tulis: apa yang membuat uji ini MERAH?** Kalau tidak ada jawabannya, ujinya belum menguji apa pun. Ini bukan nasihat abstrak — di proyek ini sudah ada beberapa uji yang hijau sambil tidak membuktikan apa pun (serangan yang tidak sampai ke sasaran, `.every()` pada daftar kosong, filter yang menyisakan terlalu sedikit baris sehingga tombol yang diuji tidak pernah muncul).

## Catatan

- **`docs/13-action-item-perbaikan-20260822.md`** adalah daftar tiket Dimas (50+ item `AI-*`). Baca §10b/§10c untuk melihat apa yang sudah selesai, dan **bicara dulu** sebelum mengambil apa pun dari sana.
- **`docs/15-serah-terima-20260823.md`** §3 memuat sembilan jebakan yang sudah ditemukan — baca supaya tidak menemukannya lagi.
- **PR #29 dan #30** sedang menunggu review saat dokumen ini ditulis. Keduanya menyentuh `src/lib/report/*`, `src/components/dashboard/*`, `src/app/(app)/pengguna/`, `src/app/(app)/survei/`, `src/app/(app)/keberlanjutan/sertifikasi/`, dan menambah migrasi **`0052`**. Kalau kamu mulai sebelum keduanya di-merge, hindari berkas-berkas itu atau `git pull` dulu.
- Tiga baris `blocking` di `app.check_production_readiness()` yang **memang diketahui**: stub login (B-27) dan dua tenant demo `DEMO`/`DEMO2` (hilang setelah `db:purge:demo`). Kalau muncul baris blocking keempat, itu temuan baru — laporkan.
