// Bukti tanggal kalender TIDAK bergeser -- dan buktinya tidak bergantung zona
// waktu mesin penguji. Jalankan DUA kali; keluaran cek harus identik:
//
//   TZ=Asia/Jakarta node --env-file=.env.local db/verify-dates.mjs
//   TZ=UTC          node --env-file=.env.local db/verify-dates.mjs
//
// Latar: driver `pg` mem-parse DATE (OID 1082) menjadi Date pada tengah malam
// waktu LOKAL proses. Di WIB, `2026-08-23` jadi `2026-08-22T17:00:00Z`, dan
// pola lama `new Date(v).toISOString().slice(0, 10)` mengembalikan `2026-08-22`.
// Aplikasi kini memasang parser identitas di src/lib/db.ts, jadi DATE tetap
// string 'YYYY-MM-DD' dan tidak pernah menyentuh zona waktu.
//
// Koneksi memakai MIGRATION_DATABASE_URL (superuser): yang diuji di sini adalah
// marshalling tipe, bukan RLS -- dan pemeriksaan butuh semua baris, lintas tenant.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const ROOT = process.cwd()
let pass = 0, fail = 0
const ok = (n, c, extra = '') => {
  if (c) pass++; else fail++
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${extra && ' — ' + extra}`)
}
const src = (p) => readFileSync(join(ROOT, p), 'utf8')

// Kolom DATE yang benar-benar dirender aplikasi (lihat src/lib/repo/*).
const SOURCES = [
  ['weeding_records.weeded_on', 'SELECT weeded_on AS d, weeded_on::text AS truth FROM app.weeding_records'],
  ['fertilizer_applications.applied_on', 'SELECT applied_on AS d, applied_on::text AS truth FROM app.fertilizer_applications'],
  ['pruning_records.pruned_on', 'SELECT pruned_on AS d, pruned_on::text AS truth FROM app.pruning_records'],
  ['spraying_records.sprayed_on', 'SELECT sprayed_on AS d, sprayed_on::text AS truth FROM app.spraying_records'],
  ['harvest_records.harvested_on', 'SELECT harvested_on AS d, harvested_on::text AS truth FROM app.harvest_records'],
  ['cost_transactions.transaction_date', 'SELECT transaction_date AS d, transaction_date::text AS truth FROM app.cost_transactions'],
  ['fiscal_periods.starts_on', 'SELECT starts_on AS d, starts_on::text AS truth FROM app.fiscal_periods'],
  ['fiscal_periods.ends_on', 'SELECT ends_on AS d, ends_on::text AS truth FROM app.fiscal_periods'],
  ['fertilizer_recommendations.recommended_at', 'SELECT recommended_at AS d, recommended_at::text AS truth FROM app.fertilizer_recommendations'],
  ['carbon_runs.period_start', 'SELECT period_start AS d, period_start::text AS truth FROM app.carbon_runs'],
  ['carbon_runs.period_end', 'SELECT period_end AS d, period_end::text AS truth FROM app.carbon_runs'],
  ['cert_programs.period_start', 'SELECT period_start AS d, period_start::text AS truth FROM app.cert_programs'],
  ['certificates.valid_until', 'SELECT valid_until AS d, valid_until::text AS truth FROM app.certificates'],
  ['capa.due_date', 'SELECT due_date AS d, due_date::text AS truth FROM app.capa'],
  ['seed_distributions.distributed_on', 'SELECT distributed_on AS d, distributed_on::text AS truth FROM app.seed_distributions'],
  ['v_pending_approvals.event_date', 'SELECT event_date AS d, event_date::text AS truth FROM app.v_pending_approvals WHERE event_date IS NOT NULL'],
]

async function run() {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) { console.error('MIGRATION_DATABASE_URL belum diset. Jalankan lewat `node --env-file=.env.local`.'); process.exit(1) }

  const zona = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetMenit = -new Date().getTimezoneOffset()
  console.log(`\nZona proses: ${zona} (offset ${offsetMenit >= 0 ? '+' : ''}${offsetMenit} menit)`)

  // Parser bawaan disimpan SEBELUM override, untuk kontrol negatif di bawah.
  const parserBawaan = pg.types.getTypeParser(1082)
  // Persis seperti src/lib/db.ts.
  pg.types.setTypeParser(1082, (v) => v)

  console.log('\n=== Sumber kebenaran: src/lib/db.ts & src/lib/format.ts ===')
  const db = src('src/lib/db.ts')
  ok('src/lib/db.ts memasang parser identitas DATE (OID 1082)',
    /setTypeParser\(\s*(1082|PG_OID_DATE)/.test(db))
  ok('src/lib/format.ts merender tanggal kalender di UTC (bukan zona lokal)',
    /timeZone:\s*"UTC"/.test(src('src/lib/format.ts')))
  const pelanggar = ['operational', 'costing', 'fertilizer', 'suitability', 'sustainability']
    .filter((f) => /toISOString\(\)\.slice\(0,\s*10\)/.test(src(`src/lib/repo/${f}.ts`)))
  ok('tidak ada lagi pola penggeser di src/lib/repo/*', pelanggar.length === 0, pelanggar.join(', '))

  const c = new pg.Client({ connectionString: url })
  await c.connect()

  console.log('\n=== Jalur aplikasi: DATE dari Postgres = DATE yang dirender ===')
  let totalBaris = 0, geserLama = 0
  for (const [nama, sql] of SOURCES) {
    const r = await c.query(sql)
    if (r.rows.length === 0) { ok(`${nama} (0 baris, tidak diuji)`, true); continue }
    let salah = 0, salahLama = 0, diuji = 0
    for (const { d, truth } of r.rows) {
      if (truth === null) continue          // null = belum ada data, bukan tanggal
      diuji++
      if (typeof d !== 'string' || d !== truth) salah++
      // Kontrol negatif: pola lama diterapkan pada nilai yang sama.
      if (parserBawaan(truth).toISOString().slice(0, 10) !== truth) salahLama++
    }
    totalBaris += diuji
    geserLama += salahLama
    ok(`${nama} — ${diuji} baris cocok persis dengan ::text`, salah === 0, salah ? `${salah} baris bergeser` : '')
  }

  console.log('\n=== Kontrol negatif (memastikan uji ini sensitif) ===')
  if (offsetMenit > 0) {
    ok('pola lama TERBUKTI menggeser di zona offset positif', geserLama === totalBaris,
      `${geserLama}/${totalBaris} baris bergeser dengan pola lama`)
  } else {
    console.log(`  SKIP  zona offset ${offsetMenit} menit: pola lama kebetulan benar di sini` +
      ` (${geserLama}/${totalBaris} bergeser) — jalankan ulang dengan TZ=Asia/Jakarta`)
  }

  await c.end()
  console.log(`\n${'='.repeat(52)}\nPASS ${pass}   FAIL ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
