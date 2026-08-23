# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Bahasa

Kode, komentar, pesan commit, dokumen, dan UI ditulis dalam **Bahasa Indonesia**.
Pengecualian: nilai enum database dan nama tabel/kolom memakai bahasa Inggris (keputusan arsitektur #12), dan `docs/technical-documentation.md` ditulis dalam bahasa Inggris.

## Baca dulu

`docs/technical-documentation.md` (901 baris) adalah rujukan utama: arsitektur aplikasi, model data, model keamanan/RLS, modul fungsional, infra GCP, doktrin kejujuran data, dan runbook operasional. Baca bagian yang relevan sebelum mengubah kode di area itu. Keputusan produk/arsitektur ada di `docs/02-keputusan-arsitektur.md`; skema database di `docs/01-desain-skema-database.md`.

## Perintah

```bash
# Dev
docker compose up -d db          # Postgres 16 + PostGIS 3.4 di localhost:55433
npm run dev
npm run lint                     # eslint (wajib 0 error sebelum PR)
npx tsc --noEmit                 # typecheck — CI menjalankan ini, tidak ada npm script-nya
npm run build

# Database (perlu .env.local; skrip memakai `node --env-file=.env.local`)
npm run db:migrate               # terapkan migrasi tertunda (ledger app.schema_migrations)
npm run db:status                # status tanpa mengubah apa pun
npm run db:verify                # deteksi drift checksum file vs ledger
npm run db:bootstrap             # buat app_user + GRANT app_rw + re-apply REVOKE (sekali per lingkungan)
npm run db:seed:dev              # seed minimal (1 company, 1 estate, 4 user per role)
npm run db:seed:demo             # dataset demo kaya (company ditandai is_demo)
npm run db:purge:demo
npm run db:check                 # gate: app.check_production_readiness(), baris blocking harus nol

# Uji
npm run db:test                  # happy-path RLS (~21 cek)
npm run db:test:adversarial      # RLS adversarial (~36 cek, semua harus GAGAL)
node --env-file=.env.local db/verify-suitability.mjs   # classifier kesesuaian lahan (tanpa npm script)
npm run at:verify                # acceptance test lewat HTTP; butuh `npm run dev` hidup + DB Docker
```

Tidak ada framework unit test (no Jest/Vitest). Semua "test" adalah skrip `.mjs` mandiri; untuk menjalankan satu cek saja, edit/komentari di skripnya atau jalankan skrip itu sendiri lewat `node --env-file=.env.local <file>`.

Loop lokal biasa: `docker compose up -d db` → `db:migrate` → `db:bootstrap` → `db:seed:demo` → `db:test` + `db:test:adversarial` → `npm run dev` → `at:verify`.

## Arsitektur

Next.js 16 App Router (React 19, Server Components + Server Actions), TypeScript, Tailwind 4, PostgreSQL 16 + PostGIS. Deploy: Cloud Run + Cloud SQL (`asia-southeast2`), image dari `Dockerfile` (`output: "standalone"`), pipeline di `cloudbuild.yaml` (build → push → **migrasi** → deploy; migrasi gagal ⇒ deploy tidak jalan).

Alur data satu arah, tidak ada state client global:

```
src/app/(app)/**/page.tsx   Server Component, segmen route Bahasa Indonesia
  → requireContext()/requireRole()   src/lib/session.ts
  → src/lib/repo/*.ts        repository tipis; SQL mentah lewat rlsQuery/withRls
  → src/lib/db.ts            pool pg tunggal, konteks RLS per transaksi
form action → src/lib/actions/*.ts  "use server": requireRole → zod → repo → revalidatePath
```

Aturan yang tidak boleh dilanggar (semuanya didokumentasikan di komentar file masing-masing):

- **Aplikasi konek sebagai `app_user`/`app_rw`, bukan `postgres`.** Append-only dan RLS ditegakkan lewat REVOKE + RLS; superuser membuat seluruh lapisan itu tidak berlaku dan membuat uji *false pass*.
- **Setiap query ke tabel ber-RLS wajib lewat `withRls`/`rlsQuery`.** Tanpa konteks, RLS mengembalikan 0 baris tanpa error — terlihat seperti "belum ada data", bukan bug. `withRls` fail-closed bila `userId` kosong. `queryWithoutRlsContext()` hanya untuk hal pra-sesi (resolusi login).
- **Setiap Server Action wajib `requireRole(...)`** di baris awal — action bisa dipanggil POST langsung, bukan hanya dari UI. Otorisasi UI bukan gate.
- **`null` = "belum ada data" dan dirender em-dash (`EMPTY` di `src/lib/format.ts`), BUKAN 0.** Angka fabrikasi di dashboard finansial dianggap kegagalan fatal; repo mempertahankan `null` dari DB, tidak meng-coalesce ke 0. Jangan menaruh literal angka mirip-data di komponen — `at:verify` (AT6) mem-grep dan menggagalkannya.
- **Database adalah batas keamanan yang otoritatif**, lapisan TypeScript hanya defense-in-depth. Detail pola tiga-policy (tenant / viewer_readonly / role_split), fungsi SECURITY DEFINER yang self-gate, dan ledger `app.privilege_revocations` ada di `docs/technical-documentation.md` §"Security Model & RLS".

### Database & migrasi

- Migrasi = file SQL bernomor di `db/migrations/` (`0001_…` dst), dijalankan `db/migrate.mjs`, satu transaksi per file, dicatat di `app.schema_migrations` dengan checksum. **File yang sudah diterapkan tidak boleh diedit** — checksum berubah ⇒ runner menolak. Perbaikan selalu jadi migrasi baru (lihat pola `*_fix.sql`).
- Tabel baru wajib: RLS aktif + policy, atau terdaftar di `app.rls_exempt_tables` dengan alasan. View wajib `security_invoker = true` (regresi nyata: `0035` memperbaiki `0034`). Tabel append-only baru wajib didaftarkan di `app.privilege_revocations`, karena `bootstrap-role.mjs` menjalankan `GRANT ON ALL TABLES` lalu menerapkan ulang revocation dari ledger itu.
- Dua koneksi terpisah di env: `MIGRATION_DATABASE_URL` (superuser, migrasi & seed) dan `DATABASE_URL` (`app_user`, aplikasi & suite RLS). Suite RLS menghardcode password `apppass` untuk koneksi APP.
- Fungsi health-check harus mengembalikan nol baris: `app.check_rls_coverage()`, `app.check_privilege_revocations()`, dan baris `blocking` dari `app.check_production_readiness()`.

### Laporan & dashboard

3 dashboard + 15 laporan modul dilayani **satu** route dinamis `src/app/(app)/laporan/[slug]/` (+ `/pdf` via `@react-pdf/renderer`, `/excel`). Registry: `src/lib/report/registry.ts` (slug → loader). Layar modul kaya dibangun `src/lib/report/screens.ts` (`buildReportScreen`); bila belum ada builder, fallback ke tampilan tabel `ModuleReportView`. Menambah laporan = tambah entry di registry + loader, bukan route baru.

### Autentikasi — scaffold, jangan deploy publik

`resolveLogin()` di `src/lib/session.ts` masih **mencocokkan email ke user aktif tanpa verifikasi kredensial** (TODO: verifikasi ID token Identity Platform). Mekanisme sesinya nyata (cookie httpOnly bertanda HMAC, 12 jam, diverifikasi ulang ke DB tiap request, menyimpan `externalId` bukan uuid internal). `check_production_readiness()` menandai stub ini sebagai blocking.

### Hal lain yang tidak jelas dari struktur file

- i18n buatan sendiri, tanpa dependensi: `src/lib/i18n.ts` (dictionary id/en) + cookie `agrovision_locale`.
- Navigasi didefinisikan satu tempat: `GROUPS` di `src/components/layout/Sidebar.tsx`, dengan flag `ready` (`ready: false` = tampil tapi belum jadi, mis. `/keberlanjutan/deforestation`) dan `roles` opsional. Modul sertifikasi/panen/pendapatan pernah disembunyikan (keputusan #8 & #9) tapi sekarang sudah tampil — cek Sidebar, bukan dokumen keputusan, untuk status terkini.
- Proyeksi produksi 2026–2030 dan estimasi pendapatan/margin/payback **sudah dihapus** karena angka fabrikasi (keputusan #8). Jangan dihidupkan kembali.
- Koefisien IPCC (emission factor, alometrik) sengaja **kosong** dan bertanda `requires_validation`. Jangan mengisi angka koefisien.
- Peta memakai MapLibre GL (client component) dengan basemap gratis dari `NEXT_PUBLIC_BASEMAP_STYLE_URL`; GeoJSON disajikan `src/app/api/blocks|plots/geojson`.
- Bukti (struk/invoice) lewat `src/lib/storage.ts`: GCS bila `GCS_BUCKET_EVIDENCE` diset, jika tidak ke `.evidence/` lokal. `serverActions.bodySizeLimit` dinaikkan ke 8mb untuk unggahan ini.
- `NEXT_PUBLIC_*` di-inline saat build ⇒ harus ada sebagai `ARG`/`ENV` di `Dockerfile`, bukan hanya di runtime Cloud Run.

## Alur kerja PR

Branch dari `main` (mis. `docs/…`, `feat/…`). `.github/pull_request_template.md` mewajibkan: lint 0 error, build sukses, dicoba di layar 375px bila menyentuh UI, tidak mengubah logika RLS/role/approval tanpa dibahas dulu, migrasi idempoten & sudah diuji. CI (`.github/workflows/ci.yml`) menjalankan lint + `tsc --noEmit` + build, lalu migrate + bootstrap + `db:test` + `db:test:adversarial` di atas container PostGIS. Semua PR butuh review @ugadimas25 (CODEOWNERS).
