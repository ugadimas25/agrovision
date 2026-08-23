#!/usr/bin/env node
// Gate kesiapan produksi: app.check_production_readiness().
//
// Baris ber-`blocking = true` HARUS nol sebelum deploy publik.
//
// Dulu ini one-liner `node -e` di package.json, tapi tanda kutipnya bertumpuk
// (JSON di dalam shell di dalam JS) sehingga shell memecahnya dan perintahnya
// gagal parse -- gate yang tidak bisa dijalankan sama dengan tidak ada gate.
//
//   node --env-file=.env.local db/check-readiness.mjs
//
// Keluar dengan kode 1 bila ada baris blocking, supaya bisa dipakai di pipeline.

import pg from 'pg'

const url = process.env.MIGRATION_DATABASE_URL
if (!url) {
  console.error('MIGRATION_DATABASE_URL belum diset (koneksi superuser). Lihat .env.example')
  process.exit(1)
}

const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  const { rows } = await c.query('SELECT item, blocking, detail FROM app.check_production_readiness()')
  if (rows.length === 0) {
    console.log('Tidak ada catatan kesiapan produksi. Bersih.')
  } else {
    console.table(rows)
  }
  const blocking = rows.filter((r) => r.blocking)
  console.log(`\n${blocking.length} penghalang · ${rows.length - blocking.length} catatan non-blocking`)
  if (blocking.length > 0) {
    console.log('\nPenghalang deploy publik:')
    for (const r of blocking) console.log(`  - ${r.item}: ${r.detail}`)
    process.exitCode = 1
  }
} finally {
  await c.end()
}
