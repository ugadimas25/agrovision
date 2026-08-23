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
| `npm run db:test` | **23 PASS / 0 FAIL** | naik dari 21 (3 cek baru K-04) |
| `npm run db:test:adversarial` | **37 PASS / 0 FAIL** | naik dari 36 (cek policy 0040) |
| `npm run at:verify` | **43 PASS / 0 FAIL** | **awal sesi: mati sebelum menguji apa pun** |
| `app.check_rls_coverage()` | 0 baris | |
| `app.check_privilege_revocations()` | 0 baris | |
| `npm run db:verify` | tanpa drift | 44 migrasi terpasang |
| `npm run db:check` | 4 penghalang | stub login + 3 tenant demo — semuanya diketahui |

**Belum di-commit.** Semua perubahan ada di working tree, branch `docs/refine-tiket-ridwan`.
CLAUDE.md meminta kode branch dari `main` — pindahkan ke `feat/…` sebelum commit.

`npm run dev` mungkin masih hidup di port 3000 (`pkill -f "next dev"` untuk mematikan).

---

## 2. Migrasi yang ditambahkan sesi ini (0038–0044)

| Berkas | Isi |
|---|---|
| `0038_honest_null_cost_views.sql` | Hapus `COALESCE(...,0)` per kolom pada `v_block_cost_summary` & `v_budget_vs_actual`. `remaining_idr` & `is_over_budget` SENGAJA tetap COALESCE |
| `0039_inbox_enum_codes.sql` | Inbox berhenti merangkai kode enum ke `detail`; dua kolom baru `crop_code`/`method_code` |
| `0040_seed_distribution_input.sql` | `seed_distributions`: kolom `created_by` + policy viewer_readonly yang tadinya luput |
| `0041_price_list_versioning.sql` | K-02 §14: `version`/`valid_from`/`valid_to`, `app.price_at()`, `app.publish_price()`, `app.update_price_meta()`, append-only + ledger, driver diperluas, kolom `cost_category_id`/`chemical_id` |
| `0042_agri_input_stock_ledger.sql` | K-06 §17: `agri_input_stock_movements` (append-only), saldo awal dimigrasikan, **`stock_qty` DIHAPUS**, view `v_agri_input_stock` |
| `0043_decide_record_materialization.sql` | `app.decide_record()` ditulis ulang SEKALI: materialisasi biaya (K-01 §13), larangan self-approval (AI-17), supersede kesesuaian (K-04 §16) |
| `0044_backfill_reflected_costs.sql` | Materialisasi mundur 20 record approved (Rp 1,397 M) |

**Peringatan penting:** 0041–0044 **diterapkan tanpa telaah adversarial**. Empat dari lima agen
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
7. **Editor tarif & beberapa editor inline tidak jalan tanpa JavaScript.** `PriceRateEditor`,
   `OrganicTracker`, `RegistryGroup` memakai toggle `useState`, jadi form-nya tidak ada di HTML
   server. Pola yang benar: `<details>` native (lihat `ExpenditureForm`, `ExpenditureEditor`).
8. **`CREATE OR REPLACE VIEW` menjatuhkan `security_invoker`.** Selalu `ALTER VIEW … SET
   (security_invoker = true)` sesudahnya, dan akhiri migrasi dengan kanari `check_rls_coverage()`.
9. **Akun multi-entitas berbahaya untuk fixture uji.** `resolveLogin` menaruh akun ber-2-entitas di
   mode "semua entitas" (`companyId` null); di mode itu form tulis hilang dan `createMasterItem`
   menulis `company_id = NULL` (item jadi GLOBAL lintas tenant). `admin@agrovision.local` sudah
   begitu (DEV + PILOT dari `db:import:pilot`) — itu yang mematikan `at:verify` di AT2 sampai
   harness-nya memilih entitas sendiri. Akun multi-entitas khusus: `admin.multi@demo.invalid`.

---

## 4. Sisa pekerjaan

### Sprint 2 — tinggal dua
| Item | Isi | Catatan |
|---|---|---|
| **AI-05** | Form anggaran dinamis per scope | `costing/anggaran/Forms.tsx` sudah punya select scope + estate + block; yang kurang: tampil/sembunyi sesuai scope + zod yang menegakkan pasangannya. Harus tetap jalan tanpa JS |
| **AI-44a** | Tambah baris tarif baru + kolom `driver`/`unit`/`is_active` | §19. `app.publish_price()` sudah ada (11 parameter) — tinggal action + form. **Prasyarat K-03** |

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
- **Migrasi ber-`DROP COLUMN`/`DROP INDEX`** tidak bisa dibatalkan tanpa restore. 0042 sudah menghapus
  `stock_qty`; sisa rencana tidak ada lagi yang menghapus kolom, tapi periksa tiap migrasi baru.
- **Tabel append-only** (`price_list`, `agri_input_stock_movements`, `audit_log`, `evidence_files`)
  tidak bisa di-UPDATE/DELETE oleh aplikasi. Koreksi = baris pembalik, bukan menulis ulang.

## 6. Cara memverifikasi cepat (satu blok)

```bash
docker compose up -d db
npm run db:migrate && npm run db:verify        # 44 migrasi, tanpa drift
npm run db:test && npm run db:test:adversarial # 23/0 dan 37/0
npx tsc --noEmit && npm run lint              # 0 error
npm run dev                                    # terminal lain
npm run at:verify                              # 43/0
npm run db:check                               # 4 penghalang diketahui
TZ=Asia/Jakarta node --env-file=.env.local db/verify-dates.mjs   # tanggal tidak bergeser
TZ=UTC          node --env-file=.env.local db/verify-dates.mjs   # hasil harus sama
```

Turun dari angka mana pun di atas = regresi.
