# Serah Terima Pekerjaan — 23 Agustus 2026

> Dokumen ini untuk **sesi berikutnya** (rencana: dijalankan dengan `--dangerously-skip-permissions`).
> Isinya: keadaan terverifikasi, jebakan yang sudah ketemu supaya tidak dipelajari ulang, sisa
> pekerjaan, dan keputusan yang menunggu pemilik produk.
> Pelacak utama tetap [13-action-item-perbaikan-20260822.md](13-action-item-perbaikan-20260822.md)
> (§10b Sprint 1, §10c Sprint 2). Revisi sheet QA: [14](14-revisi-sheet-qa-20260823.md).

---

## 1. Keadaan sekarang — angka terukur, bukan klaim

| Pemeriksaan | Hasil | Catatan |
|---|---|---|
| `npx tsc --noEmit` | **0 error** | |
| `npm run lint` | **0 error**, 13 warning | 13 warning sudah ada sejak awal sesi |
| `npm run build` | sukses | |
| `npm run db:test` | **34 PASS / 0 FAIL** | naik dari 23 (11 cek K-09/AI-44a) |
| `npm run db:test:adversarial` | **54 PASS / 0 FAIL** | naik dari 37 (17 cek gerbang tarif) |
| `npm run at:verify` | **65 PASS / 0 FAIL** | naik dari 43 (10 cek AI-44a, 12 cek AI-05) |
| `app.check_rls_coverage()` | 0 baris | |
| `app.check_privilege_revocations()` | 0 baris | |
| `npm run db:verify` | tanpa drift | **46** migrasi terpasang (0038 milik PR #9, punya saya 0039–0046) |
| `npm run db:check` | 4 penghalang | stub login + 3 tenant demo — semuanya diketahui |

**Dikirim sebagai stack 8 PR**, bukan satu PR besar. Tiap PR menargetkan branch
di bawahnya, jadi diff yang direview hanya potongannya sendiri:

| # | Branch | Isi | Berkas |
|---|---|---|---|
| 1 | `feat/s1-fondasi-perkakas` | tanggal kalender, label enum, i18n, peta, `db:check` & `at:verify` yang tidak pernah jalan, dokumen | 36 |
| 2 | `feat/s2-role-akses` | AI-27 pemagaran route, AI-29, AI-31, AI-13 | 12 |
| 3 | `feat/s3-angka-jujur` | 0039 COALESCE, 0040 kode enum Inbox, AI-03 | 10 |
| 4 | `feat/s4-tarif-berversi` | 0041 K-02 | 6 |
| 5 | `feat/s5-stok-jalur-input` | 0042 + 0043, nursery/DBH/distribusi bibit | 12 |
| 6 | `feat/s6-materialisasi-biaya` | 0044 + 0045 K-01, AI-52, AI-11, AI-14 | 10 |
| 7 | `feat/s7-tambah-tarif` | AI-44a + 0046, AI-02 yang tertinggal | 9 |
| 8 | `feat/s8-anggaran-dinamis` | AI-05 | 6 |

Commit monolit lamanya ditinggalkan di tag `backup/monolith-20260823`. Invarian
yang diperiksa: pohon PR 8 **identik** dengan tag itu kecuali satu perubahan
`ci.yml` yang disengaja — pemecahan 79 berkas tidak menghilangkan atau menambah
apa pun.

`.github/workflows/ci.yml` menambahkan `feat/**` ke trigger (PR 1). Tanpa itu
hanya PR paling bawah yang mendapat CI, karena PR ke-2 dan seterusnya
menargetkan branch, bukan `main`.

Job `db-verify` CI diuji lokal untuk **kedelapan** PR dengan database dibuat dari
nol (migrate → bootstrap → db:test → adversarial). Angkanya monoton naik, tidak
pernah turun:

| PR | migrasi | `db:test` | `db:test:adversarial` |
|---|---|---|---|
| 1 | 37 | 21/0 | 36/0 |
| 2 | 37 | 21/0 | 36/0 |
| 3 | 40 | 21/0 | 36/0 |
| 4 | 41 | 21/0 | 36/0 |
| 5 | 43 | 21/0 | 37/0 |
| 6 | 45 | 23/0 | 37/0 |
| 7 | 46 | 34/0 | 54/0 |
| 8 | 46 | 34/0 | 54/0 |

PR 1 & 2 diukur pada basis lamanya (sebelum insiden §1b diketahui); PR 3–8 diukur ulang
SETELAH rebase ke `main` terkini, jadi hitungan migrasinya sudah memuat 0038 milik PR #9.

`at:verify` BUKAN bagian dari CI, dan baru hijau penuh dari PR 6 ke atas —
sebagian assertion-nya menguji fitur yang menyusul di stack.

> **`main` lokal tertinggal 10 commit.** `git rev-parse main` menunjuk `d1b6722`,
> sedangkan `origin/main` sudah di `ac33655` — PR #3–#10 (CI pipeline, migrasi di
> cloudbuild, tema RSPO, pindah owner) tidak ada di ref lokal itu. Branch
> `feat/sprint-1-2` karena itu di-root ke **`origin/main`**, bukan ke `main` lokal.
> Jalankan `git fetch && git branch -f main origin/main` sebelum bercabang lagi.

`npm run dev` mungkin masih hidup di port 3000 (`pkill -f "next dev"` untuk mematikan).

---

## 1b. Insiden: stack dibangun di atas `origin/main` yang basi

Ditulis lengkap karena akarnya prosedural dan mudah terulang.

**Apa yang terjadi.** Stack 8 PR dibangun dengan basis `ac33655`, hasil membaca
`git rev-parse origin/main` **tanpa `git fetch` lebih dulu**. Ref remote-tracking lokal
itu basi: `main` sebenarnya sudah memuat dua PR lain —

| commit | isi |
|---|---|
| `6d6d7f2` | feat: Cloud Storage untuk bukti + aktifkan `evidence_links` (B-1, B-13) (#9) |
| `c1e9f10` | docs: refine tiket Ridwan (#11) |

Yang menyesatkan: sesi itu **sudah** menandai bahwa branch `main` LOKAL tertinggal 10
commit, lalu menyimpulkan `origin/main` pasti terkini. Dua ref berbeda, dan yang kedua
tidak pernah diperiksa kesegarannya.

**Akibatnya, dan yang paling berbahaya lebih dulu.**

1. **Migrasi akan GAGAL dan memblokir deploy.** PR #9 membawa
   `0038_evidence_traceability.sql` yang menambahkan kolom `evidence_id` ke
   `app.v_pending_approvals`. Migrasi inbox saya menulis ulang view yang sama dengan
   definisi yang ditulis SEBELUM #9 ada — tanpa `evidence_id`. PostgreSQL menolak view
   yang kehilangan kolom:

   ```
   CREATE VIEW v AS SELECT 1 AS a, 2 AS b;
   CREATE OR REPLACE VIEW v AS SELECT 1 AS a;
   → ERROR:  cannot drop columns from view
   ```

   `cloudbuild.yaml` menjalankan migrasi SEBELUM deploy dan deploy tidak jalan bila
   migrasi gagal. Jadi ini bukan PR merah, ini pipeline mati.

2. **Tabrakan nomor 0038** — `0038_evidence_traceability` (#9) vs
   `0038_honest_null_cost_views` (saya).

3. Konflik tekstual di `PendingTable.tsx` dan `repo/costing.ts`.

**Kenapa CI tidak menangkapnya.** Job `db-verify` menjalankan `db:migrate` pada DB kosong
dari branch PR itu sendiri. Branch saya tidak memuat 0038 milik #9, jadi rantai yang diuji
tidak pernah berisi keduanya. Kegagalannya hanya muncul setelah keduanya berada di satu
rantai — yaitu setelah merge. **Pelajaran: CI per-branch tidak menguji interaksi dengan
apa pun yang menyusul di `main`.**

**Yang dikerjakan untuk memperbaiki.** #12 dan #13 sudah lebih dulu masuk dan ternyata
BERSIH — perubahan #9 tetap utuh (diperiksa: `evidence_links` 5 kemunculan di
`repo/costing.ts`, sama dengan `main`). #14–#19 di-rebase ke `main` terkini, migrasi
dinomori ulang, dan migrasi inbox ditulis ulang di atas definisi #9 sehingga urutan
kolomnya menjadi `… params, evidence_id, crop_code, method_code` — `evidence_id`
dipertahankan, dua kolom baru ditambahkan SESUDAHnya (satu-satunya arah yang diizinkan
`CREATE OR REPLACE VIEW`).

**Renomorinya menaik sesuai urutan merge**, bukan sekadar menghindari tabrakan — supaya DB
berumur panjang dan instalasi baru menerapkan urutan yang SAMA:

| lama | baru | PR |
|---|---|---|
| 0038_honest_null_cost_views | **0039** | #14 |
| 0039_inbox_enum_codes | **0040** | #14 |
| 0041_price_list_versioning | 0041 (tetap) | #15 |
| 0040_seed_distribution_input | **0042** | #16 |
| 0042_agri_input_stock_ledger | **0043** | #16 |
| 0043_decide_record_materialization | **0044** | #17 |
| 0044_backfill_reflected_costs | **0045** | #17 |
| 0045_price_driver_uniqueness | **0046** | #18 |

107 rujukan tekstual ke nomor lama ikut diperbarui di komentar SQL/TS, suite uji, dan
dokumen ini. Dua positif palsu sengaja dilewati: `'NRS-0042'` (contoh kode di
`0005_nursery.sql`) dan angka data di `db/data/adoption-observations.json`.

**Aturan untuk sesi berikutnya:** `git fetch origin` SEBELUM bercabang, dan bercabang dari
`origin/main` yang baru saja di-fetch — bukan dari `main` lokal, dan bukan dari ref
remote-tracking yang belum di-fetch. Bila `main` bergerak saat stack sedang berjalan,
rebase seluruh sisa stack dan **jalankan ulang migrasi dari DB kosong**, karena tabrakan
nomor dan konflik view hanya terlihat di sana.

---

## 2. Migrasi yang ditambahkan sesi ini (0039–0046)

| Berkas | Isi |
|---|---|
| `0039_honest_null_cost_views.sql` | Hapus `COALESCE(...,0)` per kolom pada `v_block_cost_summary` & `v_budget_vs_actual`. `remaining_idr` & `is_over_budget` SENGAJA tetap COALESCE |
| `0040_inbox_enum_codes.sql` | Inbox berhenti merangkai kode enum ke `detail`; dua kolom baru `crop_code`/`method_code` |
| `0042_seed_distribution_input.sql` | `seed_distributions`: kolom `created_by` + policy viewer_readonly yang tadinya luput |
| `0041_price_list_versioning.sql` | K-02 §14: `version`/`valid_from`/`valid_to`, `app.price_at()`, `app.publish_price()`, `app.update_price_meta()`, append-only + ledger, driver diperluas, kolom `cost_category_id`/`chemical_id` |
| `0043_agri_input_stock_ledger.sql` | K-06 §17: `agri_input_stock_movements` (append-only), saldo awal dimigrasikan, **`stock_qty` DIHAPUS**, view `v_agri_input_stock` |
| `0044_decide_record_materialization.sql` | `app.decide_record()` ditulis ulang SEKALI: materialisasi biaya (K-01 §13), larangan self-approval (AI-17), supersede kesesuaian (K-04 §16) |
| `0045_backfill_reflected_costs.sql` | Materialisasi mundur 20 record approved (Rp 1,397 M) |
| `0046_price_driver_uniqueness.sql` | AI-44a: indeks unik `(company_id, driver, chemical_id) NULLS NOT DISTINCT` untuk tarif aktif ber-kind `cost`. Menegakkan andaian `LIMIT 1` di `app.price_for_driver()` yang tidak pernah ditegakkan |

**Peringatan penting:** 0041–0045 **diterapkan tanpa telaah adversarial**. Empat dari lima agen
workflow mati kena batas kuota bulanan organisasi; hanya arsiteknya selesai. Saya menelaah sendiri
(satu lensa) dan memverifikasi tiap migrasi terhadap DB nyata. Sepanjang sesi ini SETIAP ronde telaah
adversarial menemukan temuan blocking, jadi ketiadaannya di sini adalah risiko nyata. **Telaah ulang
sebelum menyentuh produksi.**

---

## 3. Jebakan yang sudah ketemu — jangan dipelajari ulang

Ini bagian paling berharga dari dokumen ini.

1. **`db:seed:demo` TIDAK idempoten.** `INSERT INTO app.estates` tanpa `ON CONFLICT` → jalan dua kali
   gagal di `estates_company_id_code_key`. Selalu `npm run db:purge:demo` dulu.
   Dan **ambil dump sebelum purge**: `db/backups/` sudah disiapkan + di-gitignore.
2. **Kunci modul: JAMAK vs TUNGGAL.** `MODULE_PATH` (`actions/operational.ts`) memakai nama tabel
   JAMAK (`harvest_records`); `module_key` dari `v_pending_approvals`/`decide_record` TUNGGAL
   (`harvest_record`). Menukarnya membuat `revalidatePath(undefined)` melempar TypeError SESUDAH
   keputusan ter-commit — approver melihat "gagal" untuk keputusan yang berhasil.
   Peta yang benar untuk kunci tunggal: `DECIDE_PATH` di `actions/costing.ts`.
3. **`ct_role_split` menguji baris LAMA di `USING`, baris BARU di `WITH CHECK`.** Memperbaiki record
   `rejected` WAJIB memindahkannya ke `draft`/`submitted`; mempertahankan `rejected` ditolak RLS.
4. **`getPriceList` wajib menyaring `valid_to IS NULL`.** Sejak 0041 satu kode punya banyak versi;
   tanpa filter, refleksi menjumlahkan tarif lama + baru.
5. **Kolom DATE: jangan `new Date(v).toISOString().slice(0,10)`.** Parser identitas OID 1082 sudah
   dipasang di `src/lib/db.ts`, jadi DATE tiba sebagai string `'YYYY-MM-DD'`. Untuk "hari ini" pakai
   `todayInOperationalZone()` (`src/lib/date.ts`) — `toISOString()` di server UTC memberi tanggal
   KEMARIN bagi pengguna WIB antara 00:00–07:00. Bukti lintas zona: `db/verify-dates.mjs`.
6. **`at-verify.mjs` memilih form dengan mencocokkan substring.** Menambah satu `<form>` ke halaman
   bisa membuat uji menembak form yang salah, dan kegagalannya muncul JAUH kemudian (mis. "0 approved"
   di AT4, padahal sebabnya form submit tertukar di AT3). Sudah diperbaiki: `pickForm` mencocokkan
   seluruh elemen form sehingga `data-testid` bisa dipakai sebagai pegangan stabil. **Pakai
   `data-testid`, jangan prosa.**
7. **Beberapa editor inline tidak jalan tanpa JavaScript.** Toggle `useState` membuat form-nya
   tidak ada di HTML server. Pola yang benar: `<details>` native (lihat `ExpenditureForm`,
   `ExpenditureEditor`, `PriceRowForm`). `PriceRateEditor` **sudah dipindahkan** bersama AI-44a;
   yang masih memakai `useState` dan belum diperbaiki: **`OrganicTracker` dan `RegistryGroup`**.
8. **`CREATE OR REPLACE VIEW` menjatuhkan `security_invoker`.** Selalu `ALTER VIEW … SET
   (security_invoker = true)` sesudahnya, dan akhiri migrasi dengan kanari `check_rls_coverage()`.
9. **`app.publish_price()` punya DUA cabang, dan kode yang sudah ada menempuh cabang
   "versi baru".** Menekan "tambah baris tarif" pada kode yang sudah ada akan MENGUBAH
   tarif berjalan, dan pesannya tetap berbunyi sukses. Jalur create wajib memeriksa
   keberadaan kode lebih dulu (`priceCodeExists`).
10. **Select yang disembunyikan TETAP ikut terkirim.** Menyembunyikan field dengan
   `class="hidden"` saja membuat nilai lamanya tetap masuk FormData — dan sejak AI-05
   server menolak pasangan yang tidak cocok. Wajib `disabled` juga; field `disabled`
   tidak masuk FormData sama sekali.
11. **`useEffect(() => setState(true), [])` untuk deteksi hidrasi ditolak lint**
   (`react-hooks`, cascading render). Pakai `useSyncExternalStore(langganan, () => true,
   () => false)`: `false` di server, `true` di klien, tanpa render kedua.
12. **`psql -tAc` mencetak boolean bergantung cara memilihnya.** Kolom boolean apa
   adanya (`SELECT is_active`) keluar sebagai **`f`/`t`**; hanya ekspresi yang di-cast
   ke text — termasuk hasil `||` — yang keluar sebagai **`false`/`true`**. Assertion
   string bisa gagal walau datanya benar, dan arah kegagalannya berbeda tergantung
   query-nya. Paling aman: `SELECT kolom::text` secara eksplisit.
13. **`db:seed:demo` RUSAK oleh dua migrasi sendiri, dan tidak ada yang menyadarinya
   karena data demo sudah ada.** Keduanya baru terlihat saat DB dibangun dari nol:
   - `ON CONFLICT (company_id, code)` pada `price_list` gagal setelah 0041 menggantinya
     dengan indeks **PARSIAL** `price_list_one_open (… WHERE valid_to IS NULL)`.
     PostgreSQL tidak bisa menyimpulkan indeks parsial tanpa predikat yang sama:
     `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
     Perbaikan: tambahkan `WHERE valid_to IS NULL` pada klausa ON CONFLICT-nya.
   - INSERT `agri_input_chemicals` masih mengisi `stock_qty` yang sudah DIHAPUS 0043:
     `column "stock_qty" does not exist`. Perbaikan: kolomnya dibuang dan saldo awal
     ditulis sebagai baris mutasi di `agri_input_stock_movements`, meniru cara 0043
     memindahkan saldo lama.

   Ini bukan cacat kosmetik: `db:purge:demo` → `db:seed:demo` adalah jalur pemulihan yang
   didokumentasikan, dan `check_production_readiness()` **menyuruh** menjalankan
   `db:purge:demo`. Purge tanpa seed yang bisa jalan berarti data demo hilang permanen.
   **Pelajaran: setiap migrasi yang menghapus kolom atau mengubah unique constraint wajib
   diikuti satu kali `db:seed:demo` dari DB kosong**, karena suite `db:test` membuat
   fixture-nya sendiri dan tidak pernah menyentuh jalur seed.
14. **Akun multi-entitas berbahaya untuk fixture uji.** `resolveLogin` menaruh akun ber-2-entitas di
   mode "semua entitas" (`companyId` null); di mode itu form tulis hilang dan `createMasterItem`
   menulis `company_id = NULL` (item jadi GLOBAL lintas tenant). `admin@agrovision.local` sudah
   begitu (DEV + PILOT dari `db:import:pilot`) — itu yang mematikan `at:verify` di AT2 sampai
   harness-nya memilih entitas sendiri. Akun multi-entitas khusus: `admin.multi@demo.invalid`.

---

## 4. Sisa pekerjaan

### Sprint 2 — SELESAI
AI-05 dan AI-44a keduanya selesai (docs/13 §10c). AI-44a membuka K-03: baris revenue
per grade sekarang bisa dibuat dari UI tanpa migrasi.

Satu temuan menyusul saat mengerjakannya: **AI-02 ditandai selesai padahal separuhnya
tidak dikerjakan.** `DRIVER_SQL` di `src/lib/repo/pricing.ts` tidak ikut diperluas
setelah 0041, dan `reflectedCosts()` melewati driver tak dikenal tanpa suara — layar
Refleksi understate Rp 37 jt (DEMO) / Rp 414 jt (PILOT) sementara `cost_transactions`
sudah benar. Sudah diperbaiki; detail terukur di docs/13 §10c.

### Sprint 3 & 4
Belum tersentuh. Yang terbesar: **AI-24** filter dashboard (~5 hari, ketiga `page.tsx` masih nol
`searchParams`), **AI-47** satukan jalur laporan layar vs ekspor (~4 hari), **AI-48** batas 8 kolom
(~4,5 hari), **AI-51** aktifkan `tree_survey_points` (~4 hari), **AI-07** revenue per grade (~4 hari).

### Yang menunggu KEPUTUSAN pemilik produk (bukan pekerjaan koding)
1. **Kategori `SPRAY-L` dan `MAP-HA`** belum punya kategori akuntansi, jadi baris biayanya tidak match
   anggaran mana pun. Usul: penyemprotan dipecah — bahan ke kategori baru `PESTICIDE` (sejajar
   FERTILIZER), tenaga ke `LABOR`; pemetaan ke `SERVICE` yang sudah ada.
   Bisa diisi lewat `app.update_price_meta()` **tanpa migrasi**.
2. **Granularitas kategori.** 34 sub-kategori (Bibit Durian, Land Clearing, Pupuk Tunggal, …) belum
   dipakai sama sekali — anggaran maupun tarif keduanya di tingkat induk. Memakai sub-kategori
   menuntut tarif per sub-kategori DAN anggaran per sub-kategori.
3. **Pengecualian self-approval untuk super_admin**: saat ini DIIZINKAN dan dicatat ke `audit_log`.
   §4 dokumen 13 membuka dua-duanya.
4. **B-13** (infinite loading) — server, form bersarang, dan galat console semuanya sudah dikecualikan;
   sisa dugaan hanya iPhone Safari. Kalau tidak reproduce di perangkat itu, tutup sebagai *tidak dapat
   direproduksi* dengan catatan, jangan ditambal spekulatif.

---

## 5. Sebelum memakai `--dangerously-skip-permissions`

Flag itu mematikan SEMUA konfirmasi tool. Di pekerjaan ini yang perlu diwaspadai:

- **`npm run db:purge:demo`** menghapus tenant demo tanpa tanya. Sudah terjadi sekali tanpa backup.
  Ambil dump lebih dulu:
  `docker exec -i agrovision-db pg_dump -U postgres --no-owner agrovision > db/backups/agrovision-$(date +%Y%m%d-%H%M).sql`
- **Migrasi ber-`DROP COLUMN`/`DROP INDEX`** tidak bisa dibatalkan tanpa restore. 0043 sudah menghapus
  `stock_qty`; sisa rencana tidak ada lagi yang menghapus kolom, tapi periksa tiap migrasi baru.
- **Tabel append-only** (`price_list`, `agri_input_stock_movements`, `audit_log`, `evidence_files`)
  tidak bisa di-UPDATE/DELETE oleh aplikasi. Koreksi = baris pembalik, bukan menulis ulang.

## 6. Cara memverifikasi cepat (satu blok)

```bash
docker compose up -d db
npm run db:migrate && npm run db:verify        # 46 migrasi, tanpa drift
npm run db:test && npm run db:test:adversarial # 34/0 dan 54/0
npx tsc --noEmit && npm run lint              # 0 error
npm run dev                                    # terminal lain
npm run at:verify                              # 65/0
npm run db:check                               # 4 penghalang diketahui
TZ=Asia/Jakarta node --env-file=.env.local db/verify-dates.mjs   # tanggal tidak bergeser
TZ=UTC          node --env-file=.env.local db/verify-dates.mjs   # 0 FAIL; 1 cek SKIP di offset 0
```

Turun dari angka mana pun di atas = regresi.
