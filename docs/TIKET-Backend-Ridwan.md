# Pematangan Backend AgroVision

| | |
|---|---|
| **Assignee** | Ridwan Nulloh (`ridwannulloh`) |
| **Reviewer** | @ugadimas25 |
| **Direfine** | 24 Agustus 2026, tiket baru (B-28–B-33, Sprint 3B) ditambah 25 Agustus — seluruh status di bawah **diverifikasi langsung ke kode & database**, bukan disalin dari transkrip meeting |
| **Progres keseluruhan** | 26 Agustus 2026, ~11:15 WIB — **Sprint A ✅ selesai** (4/4 tiket merged). **Sprint 3 setengah selesai** (2/4 tiket; B-11/B-12 belum dikerjakan, B-9 milik Dimas). **Sprint 3B kode selesai** (6/6 tiket): B-28 sudah merged + fix-nya disetujui, lima tiket lain (B-29–B-33) sudah direview Dimas & semua perbaikannya sudah didorong, menunggu review ulang/merge. **Sprint 4 belum disentuh sama sekali.** Progres per sprint ada di bawah tiap header `# SPRINT ...`, detail per tiket di [Ringkasan](#ringkasan) |
| **Total estimasi tersisa** | **± 6 hari kerja** yang genuinely belum dikerjakan: **B-11** (1 hari), **B-12** (0,5 hari, ditunda), **Sprint 4 penuh** (± 4 hari), **B-26** (0,5 hari). Sprint A & Sprint 3B (± 8,5 hari di estimasi awal) **sudah dikerjakan** — kode selesai/merged, tinggal menunggu merge PR terakhir; rincian di [Ringkasan](#ringkasan) |
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
| B-27 stub login | — | **Dimas**. Jangan sentuh `src/lib/session.ts` tanpa bicara |

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

> Angka di atas diverifikasi di `main` pada 24 Agustus 2026, **setelah** PR #29 & #30 di-merge. Kalau angkamu lebih rendah, `git pull origin main` dulu — jangan dianggap regresi sebelum memastikan branch-mu sudah mutakhir.

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

> **Progres (26 Agustus 2026):** ✅ **Sprint ini selesai** — keempat tiket sudah merged ke `main`. B-21 + B-23 + B-25 lewat satu migrasi `0053` sesuai rencana ([PR #33](https://github.com/ugadimas25/agrovision/pull/33), merged 25 Agustus 2026 11:47 WIB); B-22 menyusul ([PR #36](https://github.com/ugadimas25/agrovision/pull/36), merged 25 Agustus 2026 22:59 WIB). Body tiket di bawah ini masih menuliskan kondisi **SEBELUM** dikerjakan — sengaja dibiarkan sebagai riwayat/rujukan pola implementasi, checklist "Selesai bila" per tiket belum dicentang balik satu per satu. Anggap statusnya sudah tercermin di baris ini dan di tabel [Ringkasan](#ringkasan).

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

> **Progres (26 Agustus 2026):** 2 dari 4 tiket aktif sudah selesai, 2 belum dikerjakan.
> - ✅ **B-8** (jejak audit) — [PR #32](https://github.com/ugadimas25/agrovision/pull/32), merged 24 Agustus 2026 19:23 WIB.
> - ✅ **B-10** (drop kolom `users.role`) — [PR #35](https://github.com/ugadimas25/agrovision/pull/35), merged 25 Agustus 2026 22:30 WIB.
> - 🟡 **B-19** (database/schema bersih untuk pengujian) — separuh: replika lokal (`db-staging`, [PR #34](https://github.com/ugadimas25/agrovision/pull/34)) sudah ada; bagian cloud/staging environment menyatu dengan **B-18** (Sprint 4, belum dikerjakan).
> - ⬜ **B-11** (tabel approval berjenjang mati) — **belum dikerjakan**. `approval_requests`/`approval_steps` masih ada di skema (dikonfirmasi langsung ke database 26 Agustus 2026). Sebelumnya menunggu B-22 merge — **B-22 sudah merge** (lihat Sprint A di atas), jadi tiket ini sekarang tidak lagi diblokir apa pun.
> - ⬜ **B-12** (status yang tak pernah dipakai) — ditunda, tidak diprioritaskan.
> - ➡️ **B-9** — dipindah ke Dimas (AI-51), bukan bagian pekerjaanmu.

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

# SPRINT 3B · Konsistensi UI approval & master data (± 4 hari) — sebelum Sprint 4

Temuan dari walkthrough dengan client (25 Agustus), plus audit menyeluruh (`grep -rl "<details" src/`) yang menyusul setelahnya untuk menangkap tempat lain dengan pola yang sama. Sebagian besar tiket di sini mengikuti pola yang sudah terbukti di B-21: editor `<details>` inline yang lama (baris tabel melar ke bawah saat diklik) diganti pop-up modal (`src/components/ui/OpRecordEditor.tsx` — dialog native, `m-auto` untuk penengahan karena preflight Tailwind menghapus margin bawaan browser, sudah dipakai 9 modul operasional). Setelah B-32, `OpRecordEditor.tsx` jadi **standar tunggal** aplikasi ini untuk "edit baris existing" — editor baru berikutnya rujuk ke situ, bukan bikin pola `<details>` baru.

> **Progres (26 Agustus 2026, ~11:15 WIB):** kode utuh untuk keenam tiket selesai dan lolos verifikasi. PR #37 (B-28, milik Dimas) sudah **merged**; PR #39 (fix gating B-28) sudah **disetujui** setelah satu putaran review. PR #40/#41/#43/#44 masing-masing dapat review dari Dimas (isinya di bawah judul tiket masing-masing) — perbaikannya sudah didorong dan **review ulang sudah diminta**. PR #42 juga sudah direview & diperbaiki (satu temuan langsung diterapkan reviewer lewat suggestion-commit, satu lagi diperbaiki manual). Belum ada yang di-merge selain #37/#39.
>
> B-28 berbeda dari lima lainnya: implementasinya **tabrakan dengan pekerjaan Dimas** yang merge duluan (PR #37) sambil dikerjakan paralel — lihat detail di bawah judul B-28.

### Ringkas status 6 tiket

| Tiket | Cabang | PR | Status |
|---|---|---|---|
| [B-28](#b-28) — Badge Inbox Approval | `feat/inbox-badge` → ditutup, digantikan Dimas | [#37](https://github.com/ugadimas25/agrovision/pull/37) (Dimas) + [#39](https://github.com/ugadimas25/agrovision/pull/39) (fix gating) | ✅ #37 merged · ✅ #39 disetujui (belum merge) |
| [B-32](#b-32) — ExpenditureEditor & OrganicTracker → modal | `fix/row-editor-modal-remaining` | [#40](https://github.com/ugadimas25/agrovision/pull/40) | 🟡 Direview, menunggu merge |
| [B-29](#b-29) — Master Data → modal + border Nonaktifkan | `fix/master-data-editor-modal` | [#41](https://github.com/ugadimas25/agrovision/pull/41) | 🟡 Direview, menunggu merge |
| [B-30](#b-30) — Kategori Biaya, pengelompokan induk/turunan | `fix/cost-category-hierarchy-display` | [#42](https://github.com/ugadimas25/agrovision/pull/42) | 🟡 2 temuan review sudah diperbaiki, menunggu review ulang — ⚠️ konflik dangkal dgn #41 |
| [B-31](#b-31) — Costing Price List → modal | `fix/price-list-editor-modal` | [#43](https://github.com/ugadimas25/agrovision/pull/43) | 🟡 2 temuan review sudah diperbaiki, menunggu review ulang |
| [B-33](#b-33) — Alasan Tolak → modal | `fix/decision-reject-modal` | [#44](https://github.com/ugadimas25/agrovision/pull/44) | 🟡 Perubahan diminta sudah diperbaiki, menunggu review ulang — menutup Sprint 3B |

<a id="b-28"></a>
## B-28 · Badge notifikasi Inbox Approval di Topbar
`feat/inbox-badge` · **0,5 hari** · 🟡 Medium

**Status (26 Agustus 2026):** ✅ Dikerjakan — tapi bukan lewat branch di atas. Sementara ini disiapkan, **Dimas mengerjakan tiket yang sama secara paralel** dan merge duluan: **[PR #37](https://github.com/ugadimas25/agrovision/pull/37)** (dibuka 25 Agustus 2026 22:44 WIB, **merged** 25 Agustus 2026 23:15 WIB) — cakupannya lebih luas dari tiket ini (juga merapikan Sidebar/BottomNav). Branch `feat/inbox-badge` milik tiket ini ditutup sebagai duplikat: **[PR #38](https://github.com/ugadimas25/agrovision/pull/38)** (dibuka 25 Agustus 2026 23:42 WIB, **closed**, tidak di-merge).

Audit PR #37 menemukan gap terhadap kriteria "Selesai bila" #2 di bawah: `countAllPending()` dipanggil **tanpa gating role**, jadi creator/viewer ikut melihat badge (dengan angka ajuan mereka sendiri, bukan "menunggu keputusan mereka" — apalagi setelah B-23 men-scope SELECT per-creator). Diperbaiki lewat **[PR #39](https://github.com/ugadimas25/agrovision/pull/39)** (dibuka 25 Agustus 2026 23:47 WIB) — menggating `pendingApprovalCount` ke `number | null`, hanya dihitung untuk `approver`/`super_admin`.

Review Dimas atas PR #39 menemukan gap KEDUA: gating dipindah ke seluruh `<Link>`, bukan cuma badge-nya — padahal sejak PR #37, Topbar adalah satu-satunya jalan ke `/approval` (dan ke `/approval/riwayat` B-22 di dalamnya), dan halaman itu sengaja tetap terbuka untuk creator/viewer (cuma tombol Setujui/Tolak yang digate). Diperbaiki: gate dipindah ke `<span>` badge-nya saja, `<Link>` selalu dirender. **PR #39 sudah disetujui** setelah perbaikan ini — ✅ **menunggu merge**, bukan lagi menunggu review.

**Terverifikasi belum ada.** Tidak ada pola badge/counter di aplikasi ini untuk direplikasi — `ready: false` di `GROUPS` (`Sidebar.tsx`) adalah flag statis nonaktif, bukan angka hidup.

Diminta: ikon amplop di dekat avatar pengguna (`src/components/layout/Topbar.tsx` — dua tempat render, desktop & mobile) menampilkan jumlah item Inbox Approval yang menunggu keputusan.

**Kerjakan**
1. Hitung dari sumber yang sama dengan Inbox (`app.v_pending_approvals`, dibaca `listAllPending` di `src/lib/repo/costing.ts`) — jangan duplikasi logika filter di tempat lain.
2. Tampilkan hanya untuk role yang benar-benar memutuskan (`approver`, `super_admin`). Creator/viewer tidak punya apa pun yang "menunggu keputusan mereka" — badge disembunyikan untuk role itu, bukan menampilkan angka 0 yang membingungkan.
3. Ambil count di Server Component (`AppLayout.tsx` sudah mengambil data sesi di situ) — cukup; tidak perlu polling client-side, Next me-refetch Server Component di setiap navigasi.

**Selesai bila**
- [x] Approver/super_admin login → badge menampilkan angka yang sama dengan jumlah baris di `/approval` — diverifikasi manual (badge "14" cocok "Menampilkan 1–14 dari 14")
- [x] Creator/viewer login → tidak ada badge (bukan badge "0") — gap di PR #37, diperbaiki & diverifikasi di PR #39
- [x] Badge berubah otomatis setelah item diputuskan, cukup lewat navigasi biasa (tanpa refresh manual/polling) — bawaan Server Component, tidak perlu polling

---

<a id="b-29"></a>
## B-29 · Master Data: editor masih pola lama, dan aksi Nonaktifkan tidak konsisten
`fix/master-data-editor-modal` · **0,5–1 hari** *(naik dari 0,5 — ada temuan kedua)* · 🟡 Medium

**Status (26 Agustus 2026):** ✅ Kode selesai — **[PR #41](https://github.com/ugadimas25/agrovision/pull/41)** (dibuka 26 Agustus 2026 00:02 WIB), 🟡 **direview, menunggu merge** @ugadimas25. `lint`/`tsc`/`build` bersih, `at:verify` 149/0. ⚠️ Berkas `MasterDataManager.tsx` juga disentuh PR #42 (B-30) — konflik dangkal saat salah satu di-rebase, lihat catatan di PR #42.

**Terverifikasi, dua masalah berbeda di berkas yang sama** (`MasterDataManager.tsx`, `src/app/(app)/pengaturan/master-data/`):

1. **"Ubah"** masih memakai pola `<details>` inline yang sama persis dengan yang diganti B-21 di modul operasional (baris tabel melar ke bawah). Aksinya sendiri (`updateMasterItemAction`) sudah ada dan berfungsi — ini murni soal tampilan, **bukan** membangun fitur edit dari nol.
2. **"Nonaktifkan"** (baris 390-395) sama sekali **tidak punya kotak/border** — `className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:text-red-600"`, tidak ada `border` sama sekali. Dibandingkan tombol "Ubah" di sebelahnya yang punya `border border-slate-200`, "Nonaktifkan" terlihat seperti teks biasa — sulit membedakan apakah itu bisa diklik atau bukan.

**Sudah diperiksa ke seluruh `src/`** apakah pola tombol-tanpa-border ini muncul di tempat lain: **tidak** — `UserRowActions.tsx` (halaman Pengguna, AI-28) sudah memakai pola tombol berborder yang benar untuk Nonaktifkan/Aktifkan/Hapus-nya (`border border-slate-200` / `border border-red-200`). Jadi ini **satu titik perbaikan terisolasi**, bukan pola yang tersebar — pakai `UserRowActions.tsx` sebagai rujukan gaya tombol yang benar.

**Kerjakan**
1. "Ubah" → pola `OpRecordEditor.tsx` (pop-up modal).
2. "Nonaktifkan" → tambahkan `border` (samakan dengan gaya tombol sekunder di `UserRowActions.tsx`) — **tidak perlu jadi modal**, ini aksi sekali-klik tanpa field, cukup terlihat jelas sebagai tombol.

**Selesai bila**
- [x] Klik "Ubah" pada baris master data manapun → pop-up modal di tengah layar, bukan baris yang melar
- [x] Tombol Batal/Simpan sejajar, sama seperti pola B-21
- [x] "Nonaktifkan" punya kotak/border yang sama jelasnya dengan "Ubah" — hover-nya terlihat sebagai tombol, bukan teks
- [x] Seluruh tipe master data (Kategori Biaya, Satuan, dst.) tetap bisa diedit — diverifikasi tipe berjenjang & datar, tidak ada tipe yang kehilangan aksinya

---

<a id="b-30"></a>
## B-30 · Master Biaya (Kategori Biaya): baris induk membingungkan
`fix/cost-category-hierarchy-display` · **0,5–1 hari** · 🟡 Medium

**Status (26 Agustus 2026):** ✅ Kode selesai — **[PR #42](https://github.com/ugadimas25/agrovision/pull/42)** (dibuka 26 Agustus 2026 00:09 WIB). ⚠️ **Konflik dangkal dengan PR #41 (B-29)** — keduanya menyentuh `ItemRow` di `MasterDataManager.tsx`, props/JSX berdampingan bukan logika yang sama. Disarankan merge #41 dulu baru rebase PR ini.

Direview Dimas, dua temuan: (1) `groupHierarchical()` membuang baris yatim (parent-nya tidak terlihat lewat RLS) tanpa suara — **diperbaiki langsung oleh reviewer** lewat suggestion-commit; (2) di kartu mobile (<768px) identitas induk hilang total karena `.rt-cards tr{background:#fff}` mengalahkan `bg-slate-50/60` — **diperbaiki**: sel "Induk" khusus mobile (`md:hidden`) dikembalikan untuk baris turunan. Diverifikasi manual di viewport sempit. 🟡 **Menunggu review ulang** @ugadimas25.

**Terverifikasi di `/pengaturan/master-data?tipe=cost_category`.** Kategori berjenjang (mis. kode `SEEDLING`, nama "Pengadaan Bibit") ditampilkan sebagai barisnya sendiri di tabel datar (kolom Induk = "—"), lalu turunannya (`SEEDLING-01` "Bibit Durian", dst.) tampil sebagai baris terpisah dengan kolom Induk = "Pengadaan Bibit". Nama induk jadi muncul dua kali — sekali sebagai baris utuh, sekali lagi berulang di kolom Induk tiap turunannya. Pola yang sama berlaku untuk `LANDPREP`/"Persiapan Lahan", `FERTILIZER`/"Pengadaan Pupuk", dst.

⚠️ **Baris induk itu BUKAN header dekoratif — itu master data sungguhan**: punya `Kode`, `Urutan`, `Status` sendiri, dan bisa di-"Ubah"/nonaktifkan lewat UI ini. **Jangan sekadar dihapus dari tampilan** seperti kesan pertama di walkthrough — itu akan menghilangkan satu-satunya jalan mengedit/menonaktifkan kategori induknya.

**Kerjakan:** ganti render datar dengan tampilan berjenjang yang membedakan baris induk secara visual (mis. baris induk ditebalkan/beda warna latar, turunan diindentasi di bawahnya) — bukan menghapus baris induk itu sendiri. Kolom "Induk" pada baris turunan jadi tidak perlu lagi ditampilkan sebagai kolom terpisah begitu hierarkinya sudah terlihat dari pengelompokan/indentasi visual.

**Selesai bila**
- [x] Kategori induk & turunannya tampil berkelompok, bukan dua baris terpisah yang saling mengulang nama yang sama
- [x] Baris induk tetap bisa di-"Ubah"/nonaktifkan lewat UI — diverifikasi manual, tidak ada master data yang kehilangan akses edit
- [x] Kolom "Induk" pada baris turunan dihapus sebagai kolom terpisah (sudah terwakili posisi/indentasi)
- [x] Diperiksa untuk seluruh tipe master data berjenjang — satu-satunya tipe `is_hierarchical=true` saat ini adalah `cost_category` (dikonfirmasi ke migrasi), kode ditulis generik lewat `isHierarchical` bukan hardcode

---

<a id="b-31"></a>
## B-31 · Costing Price List: editor masih pola lama
`fix/price-list-editor-modal` · **0,5 hari** · 🟡 Medium

**Status (26 Agustus 2026):** ✅ Kode selesai — **[PR #43](https://github.com/ugadimas25/agrovision/pull/43)** (dibuka 26 Agustus 2026 00:20 WIB). `at:verify` 149/0 (baseline bersih setelah `db:purge:demo`+`db:seed:demo` — dua percobaan awal sempat gagal di tes yang sama sekali tak berhubungan, ternyata drift data kumulatif dari `at:verify` berulang di sesi yang sama, bukan regresi PR ini).

Direview Dimas: komentar header `PriceRateEditor.tsx` keliru menyatakan tarif "tetap bisa diterbitkan tanpa JavaScript" — **diperbaiki**, komentar sekarang jujur soal `showModal()` yang butuh JS. Nit `max-h-[85vh] overflow-y-auto` yang belum ada di editor ini — **ditambahkan**. Nit ketiga (konfirmasi eksplisit alih-alih modal yang hilang sendiri saat sukses) **dicoba tapi dibatalkan** setelah diverifikasi: `setPriceRateAction` memanggil `revalidatePath`, yang me-remount seluruh komponen begitu sukses, jadi konfirmasi apa pun di dalam modal itu tidak akan pernah sempat terlihat pengguna — dijelaskan di komentar berkas & balasan PR. 🟡 **Menunggu review ulang** @ugadimas25.

**Terverifikasi.** `PriceMetaEditor.tsx` (label/kategori akuntansi/catatan) dan `PriceRateEditor.tsx` (terbitkan tarif baru) di `src/app/(app)/costing/refleksi/` sama-sama masih pola `<details>` inline.

⚠️ **`PriceRateEditor.tsx` BUKAN edit-di-tempat** — tarif berversi (migrasi 0041): baris lama ditutup, baris baru diterbitkan lewat `app.publish_price` (super_admin saja), nilai historis tidak pernah berubah. Komentar di file itu sendiri sudah menjelaskan ini. Saat dipindah ke modal, **judul & label tombolnya harus tetap jujur menyebut "Terbitkan tarif baru"**, bukan "Ubah tarif" — supaya modalnya tidak berjanji sesuatu yang tidak dilakukan constraint DB-nya.

**Kerjakan**
1. `PriceMetaEditor.tsx` → pola `OpRecordEditor.tsx` apa adanya (ini genuinely edit-di-tempat, metadata saja).
2. `PriceRateEditor.tsx` → pola modal yang sama, tapi copy tombol/judul tetap menyebut "Terbitkan tarif baru", bukan "Ubah".

**Selesai bila**
- [x] Kedua editor jadi pop-up modal, bukan baris yang melar — diverifikasi manual di browser (PR #43)
- [x] Label `PriceRateEditor` tidak menyiratkan edit-di-tempat — modal berjudul "Terbitkan tarif baru", tombol "Terbitkan"
- [x] `db:test` bagian AI-44a (tarif hanya super_admin) tetap hijau — 45/0, dijalankan ulang 26 Agustus 2026 setelah perubahan, tidak ada perubahan otorisasi

---

<a id="b-32"></a>
## B-32 · Editor baris ditolak/lampiran — dua tempat lain terlewat B-21
`fix/row-editor-modal-remaining` · **0,5–1 hari** · 🟡 Medium

**Status (26 Agustus 2026):** ✅ Kode selesai — **[PR #40](https://github.com/ugadimas25/agrovision/pull/40)** (dibuka 25 Agustus 2026 23:57 WIB), 🟡 **direview, menunggu merge** @ugadimas25. `lint`/`tsc`/`build` bersih, `at:verify` 149/0.

**Ditemukan lewat audit menyeluruh** (`grep -rl "<details" src/`) setelah B-29/B-31: dua tempat lain masih memakai persis pola `<details>` inline yang B-21 ganti di modul operasional, dan **keduanya terlewat** karena B-21 hanya menyentuh 9 modul operasional lewat `OpRecordEditor.tsx`, bukan berkas editor lain yang berdiri sendiri.

1. **`ExpenditureEditor.tsx`** (`src/app/(app)/costing/pengeluaran/`) — editor baris Pengeluaran ditolak/draft. **Ironisnya ini justru berkas ASAL yang jadi rujukan pola saat `OpRecordEditor.tsx` ditulis** (lihat komentar di `OpRecordEditor.tsx`) — polanya disalin ke 9 modul lain, tapi berkas sumbernya sendiri tidak pernah diperbarui balik.
2. **`OrganicTracker.tsx`** (`src/app/(app)/keberlanjutan/sertifikasi/`, fungsi `Row()`) — editor "Ubah / lampirkan bukti" per baris sertifikasi organik. Komentarnya di baris ~47-54 punya alasan yang identik dengan `ExpenditureEditor.tsx` (uji berbasis HTTP tidak bisa menemukan form di balik `useState`), tapi belum pernah dipindah ke modal.

**Sudah diperiksa, TIDAK termasuk** (dan sengaja dibiarkan sebagai `<details>` — bukan anti-pola, beda kebutuhan):
`OpRecordForm.tsx`, `ExpenditureForm.tsx`, `BlockCreateForm.tsx`, `Forms.tsx` (anggaran), `PriceRowForm.tsx` — semuanya form **buat-baru** (bukan edit baris yang sudah ada), collapsible di atas halaman itu wajar. `FilterBar.tsx`, `ReportDownload.tsx`, `report/screen.tsx` — dropdown filter/unduh/rincian, bukan form edit sama sekali.

**Kerjakan:** terapkan pola `OpRecordEditor.tsx` ke kedua berkas. Setelah ini, `OpRecordEditor.tsx` jadi **standar tunggal** untuk "edit baris existing" di seluruh aplikasi — tulis itu eksplisit di komentar berkas (atau pindahkan ke lokasi yang lebih generik kalau makin banyak dipakai) supaya editor baru berikutnya tidak balik lagi ke pola `<details>`.

**Selesai bila**
- [x] `ExpenditureEditor.tsx` dan `OrganicTracker.tsx` (Row editor) jadi pop-up modal
- [x] `grep -rl "<details" src/` tidak lagi menyisakan berkas yang mengedit baris existing (sisa match hanya komentar penjelas, bukan JSX tag)
- [x] `at:verify` untuk Pengeluaran & Sertifikasi Organik tetap hijau — 149/0

---

<a id="b-33"></a>
## B-33 · Alasan penolakan di Inbox Approval masih inline
`fix/decision-reject-modal` · **0,5 hari** · 🟡 Medium

**Status (26 Agustus 2026):** ✅ Kode selesai — **[PR #44](https://github.com/ugadimas25/agrovision/pull/44)** (dibuka 26 Agustus 2026 00:26 WIB). Diuji end-to-end manual (klik Tolak → modal → isi alasan → Kirim → baris hilang dari Inbox, badge Topbar ikut turun).

Dimas **meminta perubahan** (`CHANGES_REQUESTED`): satu `useActionState` dipakai bersama form Setujui & Tolak, jadi galat dari percobaan Setujui (mis. race condition — record sudah diputuskan orang lain) salah memicu modal "Tolak pengajuan" terbuka sendiri. **Diperbaiki**: efek auto-open dihapus (tidak diperlukan — dialog yang terbuka tidak tertutup oleh submit Server Action), dan galat non-field ditambahkan ke footer modal supaya tetap terlihat saat modal terbuka. Diverifikasi ulang dengan race condition sungguhan (dua tab). 🟡 **Menunggu review ulang** @ugadimas25 — tiket terakhir di Sprint 3B, setelah ini disetujui & di-merge, seluruh Sprint 3B selesai.

**Terverifikasi.** `DecisionForm.tsx` (`src/app/(app)/approval/`, dipakai `PendingTable.tsx` untuk Setujui/Tolak lintas SEMUA modul di Inbox) — tombol "Tolak" adalah `<summary>` yang membuka `<details>` berisi input alasan + tombol "Kirim penolakan" **inline di dalam baris tabel**, sama seperti pola yang diganti B-21.

**Kerjakan:** terapkan pola `OpRecordEditor.tsx` — klik "Tolak" membuka modal berisi input alasan (`required`, sama seperti sekarang) + tombol "Kirim penolakan". "Setujui" tetap tombol langsung (tidak perlu modal, tidak ada input apa pun).

**Selesai bila**
- [x] Klik "Tolak" pada baris Inbox manapun → pop-up modal berisi input alasan, bukan baris yang melar
- [x] Alasan tetap wajib (tiga lapis penegakan yang sudah ada — HTML `required`, zod, `CHECK` constraint DB — tidak berubah, murni tampilan)
- [x] "Setujui" tidak terpengaruh — tetap satu klik langsung, diverifikasi tidak diubah

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

Satu untukmu (B-26), satu untuk Dimas (B-27) — yang kedua ditulis di sini supaya kamu tahu apa yang menahan produksi, bukan untuk dikerjakan.

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

## B-27 · Stub login masih aktif — **milik Dimas, jangan dikerjakan**
~~`feat/identity-platform-verify`~~ · **0 hari untukmu** · 🔴 Critical

**Pemiliknya sudah diputuskan: Dimas.** Dicatat di sini bukan untuk kamu kerjakan, tapi supaya kamu tahu apa yang sedang menahan produksi — dan supaya kamu tidak menyentuh `resolveLogin()` tanpa bicara.

`resolveLogin()` di `src/lib/session.ts` **mencocokkan email ke user aktif tanpa verifikasi kredensial apa pun**. Siapa pun yang tahu sebuah email terdaftar bisa masuk sebagai orang itu. `app.check_production_readiness()` menandainya **blocking**:

```
login stub masih aktif | blocking | app.lookup_login_email masih ada;
                                    verifikasi ID token Identity Platform belum terpasang
```

**Dua konsekuensi praktis untukmu:**

1. **Jangan pakai stub ini sebagai alasan menunda tiketmu.** B-23 (lingkup creator) dan B-22 (riwayat approval) tetap harus benar walau login-nya belum aman — keduanya tentang *apa yang boleh dilihat* setelah masuk, bukan *bagaimana masuknya*.
2. **Jangan menyentuh `src/lib/session.ts` tanpa bicara dengan Dimas.** Kalau tiketmu butuh sesuatu dari sesi (mis. `ctx.session.userId` untuk policy per-pembuat di B-23), itu sudah tersedia dan tidak perlu diubah.

Yang **sudah** benar dan tidak akan berubah oleh tiket ini: mekanisme sesinya sendiri — cookie httpOnly bertanda HMAC, 12 jam, **diverifikasi ulang ke database setiap request** (jadi menonaktifkan pengguna langsung berlaku), dan menyimpan `externalId`, bukan uuid internal. Yang hilang **hanya** verifikasi ID token.

---

<a id="ringkasan"></a>
# Ringkasan

| Sprint | Tiket | Estimasi |
|---|---|---|
| 1 · Jaring pengaman | B-5, B-3, B-2 | ✅ Selesai |
| 2 · Ketahanan data | B-1, B-13 | ✅ Selesai |
| Akar angka | B-20, B-24 | ✅ Selesai |
| **A · Sisa alur approval** | ✅ **Selesai (4/4)** — B-21+B-23+B-25 [PR #33](https://github.com/ugadimas25/agrovision/pull/33) merged, B-22 [PR #36](https://github.com/ugadimas25/agrovision/pull/36) merged | **± 4,5 hari** (sudah dikerjakan) |
| 3 · Jejak & skema | 🟡 **2/4 selesai** — B-8 [PR #32](https://github.com/ugadimas25/agrovision/pull/32) ✅, B-10 [PR #35](https://github.com/ugadimas25/agrovision/pull/35) ✅, B-19 separuh (lokal ✅, cloud/branch = B-18), **B-11 belum dikerjakan** (tidak lagi diblokir — B-22 sudah merge), B-12 ditunda, B-9 → Dimas | ± 3,5 hari |
| **3B · Konsistensi UI (baru, dari walkthrough 25 Agu + audit lanjutan)** | 🟡 **Kode selesai (6/6), direview** — B-28 [PR #37](https://github.com/ugadimas25/agrovision/pull/37) milik Dimas ✅ merged + fix [PR #39](https://github.com/ugadimas25/agrovision/pull/39) ✅ disetujui; B-29 [#41](https://github.com/ugadimas25/agrovision/pull/41), B-32 [#40](https://github.com/ugadimas25/agrovision/pull/40) direview & menunggu merge; B-30 [#42](https://github.com/ugadimas25/agrovision/pull/42), B-31 [#43](https://github.com/ugadimas25/agrovision/pull/43), B-33 [#44](https://github.com/ugadimas25/agrovision/pull/44) sudah diperbaiki sesuai review, menunggu review ulang — sebelum Sprint 4 | **± 4 hari** (sudah dikerjakan, menunggu merge) |
| 4 · Kesiapan produksi | ⬜ **Belum disentuh** — B-15 (sisa), B-16, B-17 (sisa), B-18 | ± 4 hari |
| Baru | ⬜ B-26 belum dikerjakan (perlu keputusan arah bareng Dimas) | ± 0,5 hari |
| | **Total tersisa (genuinely belum dikerjakan)** | **± 6 hari kerja** — B-11 (1 hari) + B-12 (0,5 hari, ditunda) + Sprint 4 penuh (± 4 hari, sudah mencakup sisa cloud B-19 lewat B-18) + B-26 (0,5 hari). *(Angka lama ± 16,5 hari termasuk Sprint A & 3B yang sekarang sudah dikerjakan — dipertahankan di baris estimasi masing-masing sebagai catatan historis, bukan dihapus.)* |
| Milik Dimas — **jangan dikerjakan** | B-9 (AI-51) · **B-27** stub login | — |

## Lima hal yang menentukan urutan

**1. B-8 sebelum B-22.** Riwayat approval butuh jejak audit, dan 11 dari 13 tabel approval belum punya trigger audit. Tanpa B-8, riwayatnya akan kosong untuk hampir semua modul — dan kosongnya tidak akan terlihat seperti bug, hanya seperti "belum ada keputusan".

**2. B-22 sebelum B-11.** Kalau riwayat ternyata lebih pas disimpan di `approval_requests`, tabel itu dihidupkan, bukan dibuang. Membuangnya lebih dulu berarti membangunnya kembali dua minggu kemudian.

**3. B-21, B-23, B-25 semuanya menyentuh RLS & tabel operasional yang sama.** Rencanakan sebagai **satu migrasi `0053`** kalau bisa, supaya tidak bolak-balik menyentuh policy yang sama. Dan jangan lupa memasang ulang `security_invoker` kalau menyentuh view.

**4. B-23 punya risiko yang tidak kelihatan.** Menyempitkan SELECT untuk creator bisa mengosongkan laporan & dashboard bagi role itu. Periksa dampaknya **sebelum** merge, bukan setelah QA mengeluh — dan ingat bahwa RLS mengembalikan 0 baris **tanpa error**, jadi gejalanya terlihat seperti "belum ada data".

**5. Kalau harus memilih:** **Sprint A + B-8 + B-19** adalah yang wajib supaya QA bisa hijau dan aplikasi layak UAT. Sprint 4 bisa menyusul setelah UAT — kecuali **B-15**, yang naik prioritas karena Cloud SQL sudah `db-g1-small` sementara Cloud Run bisa 4 instance dengan pool masing-masing.

## Cara menulis PR yang cepat di-review

Reviewer-nya satu orang dan waktunya terbatas. Yang membuat review cepat:

- **Angka, bukan klaim.** "Realisasi 15/17 baris, total Rp 3,03 M" bisa diperiksa; "sudah jalan" tidak.
- **Tulis apa yang kamu putuskan dan mengapa**, terutama di tiket yang punya dua arah (B-11) atau butuh keputusan Dimas (B-22, B-25, B-26).
- **Sebutkan apa yang belum kamu verifikasi.** Kalau kamu tidak bisa menguji di Cloud SQL, tulis itu. Lebih baik daripada reviewer menemukannya setelah merge.
- **Kalau menemukan hal yang lebih berbahaya dari tiketmu, laporkan dulu** sebelum melanjutkan. Sudah beberapa kali terjadi di proyek ini, dan setiap kali lebih murah dilaporkan lebih awal.
- **Satu pertanyaan untuk setiap uji yang kamu tulis: apa yang membuat uji ini MERAH?** Kalau tidak ada jawabannya, ujinya belum menguji apa pun. Ini bukan nasihat abstrak — di proyek ini sudah ada beberapa uji yang hijau sambil tidak membuktikan apa pun (serangan yang tidak sampai ke sasaran, `.every()` pada daftar kosong, filter yang menyisakan terlalu sedikit baris sehingga tombol yang diuji tidak pernah muncul).

## Catatan

- **`docs/13-action-item-perbaikan-20260822.md`** adalah daftar tiket Dimas (50+ item `AI-*`). Baca §10b/§10c untuk melihat apa yang sudah selesai, dan **bicara dulu** sebelum mengambil apa pun dari sana.
- **`docs/15-serah-terima-20260823.md`** §3 memuat sembilan jebakan yang sudah ditemukan — baca supaya tidak menemukannya lagi.
- **PR #29 dan #30 sudah di-merge** (24 Agustus). Keduanya menyentuh `src/lib/report/*`, `src/components/dashboard/*`, `src/app/(app)/pengguna/`, `src/app/(app)/survei/`, `src/app/(app)/keberlanjutan/sertifikasi/`, dan menambah migrasi **`0052`**. Jadi `main` sudah memuat semuanya — cukup `git pull origin main` sebelum mulai.
- Tiga baris `blocking` di `app.check_production_readiness()` yang **memang diketahui**: stub login (B-27, milik Dimas) dan dua tenant demo `DEMO`/`DEMO2` (hilang setelah `db:purge:demo`). Kalau muncul baris blocking keempat, itu temuan baru — laporkan.
