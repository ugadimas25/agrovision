#!/usr/bin/env node
// Seed untuk development. BUKAN migrasi -- isinya bergantung lingkungan.
//
// Yang diseed HANYA yang tidak bisa dibuat lewat UI:
//   - satu entitas korporat placeholder (jumlah sebenarnya masih TBC)
//   - satu estate
//   - empat user, satu per peran
//
// Yang SENGAJA TIDAK diseed:
//   - master_items (satuan, kategori biaya, jenis pupuk) -- justru harus dibuat
//     super_admin lewat UI, karena itulah bukti acceptance test 1 lulus.
//     Menyeednya akan menghapus artinya.
//   - fiscal_periods -- nama & rentang fase proyek harus dari klien (keputusan #6)
//   - angka apa pun. Tidak ada nilai biaya, luas, atau karbon yang difabrikasi.
//
// Jalankan: npm run db:seed:dev

import pg from 'pg'

const url = process.env.MIGRATION_DATABASE_URL
if (!url) { console.error('MIGRATION_DATABASE_URL wajib.'); process.exit(1) }

const CO = '00000000-0000-4000-8000-000000000001'
const ES = '00000000-0000-4000-8000-000000000011'

const USERS = [
  { id: '00000000-0000-4000-8000-000000000101', sub: 'dev|admin',    email: 'admin@agrovision.local',    name: 'Dev Super Admin', appRole: 'super_admin' },
  { id: '00000000-0000-4000-8000-000000000102', sub: 'dev|approver', email: 'approver@agrovision.local', name: 'Dev Approver',    appRole: 'approver' },
  { id: '00000000-0000-4000-8000-000000000103', sub: 'dev|creator',  email: 'creator@agrovision.local',  name: 'Dev Creator',     appRole: 'creator' },
  { id: '00000000-0000-4000-8000-000000000104', sub: 'dev|viewer',   email: 'viewer@agrovision.local',   name: 'Dev Viewer',      appRole: 'viewer' },
]

const c = new pg.Client({ connectionString: url })
await c.connect()

try {
  await c.query('BEGIN')

  await c.query(
    `INSERT INTO app.companies (id, code, name) VALUES ($1,'DEV','Entitas Pengembangan')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [CO])

  await c.query(
    `INSERT INTO app.estates (id, company_id, code, name) VALUES ($1,$2,'EST-1','Estate 1')
     ON CONFLICT (id) DO NOTHING`, [ES, CO])

  for (const u of USERS) {
    await c.query(
      `INSERT INTO app.users (id, company_id, external_id, email, full_name, app_role)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET app_role = EXCLUDED.app_role, full_name = EXCLUDED.full_name`,
      [u.id, CO, u.sub, u.email, u.name, u.appRole])
    await c.query(
      `INSERT INTO app.user_company_access (user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [u.id, CO])
  }

  // creator dibatasi ke satu estate -- supaya pembatasan RLS terlihat saat demo.
  await c.query(
    `INSERT INTO app.user_estate_access (user_id, estate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    ['00000000-0000-4000-8000-000000000103', ES])

  await c.query('COMMIT')

  console.log('Seed dev selesai.\n')
  console.log('Login (email apa pun di bawah, tanpa password -- login stub):')
  for (const u of USERS) console.log(`  ${u.appRole.padEnd(12)} ${u.email}`)
  console.log('\nMaster data sengaja KOSONG. Buat lewat UI sebagai super_admin —')
  console.log('itulah bukti acceptance test 1 lulus tanpa perubahan kode.')
} catch (e) {
  await c.query('ROLLBACK')
  console.error('Seed gagal:', e.message)
  process.exit(1)
} finally {
  await c.end()
}
