#!/usr/bin/env node
/**
 * Penyediaan Identity Platform untuk B-27 -- docs/12-deploy-gcp.md §9.
 *
 * Verifikasi ID token sudah ada di kode (src/lib/auth/identity-platform.ts).
 * Yang TIDAK bisa dikerjakan kode adalah bagian operasionalnya: mengaktifkan
 * Identity Platform, membuat akun, dan menautkan `sub` tiap akun ke
 * app.users.external_id. Berkas ini mengerjakan bagian itu -- sekali jalan,
 * bisa diulang, dan bisa dibaca sebelum dijalankan.
 *
 *   # 1. proxy ke Cloud SQL produksi (terminal terpisah)
 *   cloud-sql-proxy --port 55435 PROJECT:asia-southeast2:agrovision-db
 *
 *   # 2. kredensial superuser dari Secret Manager
 *   export MIGRATION_DATABASE_URL="$(gcloud secrets versions access latest \
 *     --secret=MIGRATION_DATABASE_URL --project=PROJECT \
 *     | sed 's#@/agrovision?host=[^ ]*#@127.0.0.1:55435/agrovision#')"
 *
 *   # 3. lihat rencananya dulu, baru kerjakan
 *   node scripts/setup-identity-platform.mjs --project=PROJECT
 *   node scripts/setup-identity-platform.mjs --project=PROJECT --apply
 *
 * Tanpa --apply tidak ada satu pun perubahan; ia hanya melaporkan apa yang
 * AKAN dikerjakan. Dijalankan ulang setelah --apply aman: akun yang sudah ada
 * dipakai kembali (password TIDAK direset), penautan yang sudah benar dilewati.
 */

import pg from 'pg'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, chmodSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const PROJECT = (process.argv.find(a => a.startsWith('--project=')) || '').split('=')[1]
if (!PROJECT) { console.error('Wajib: --project=<PROJECT_ID>'); process.exit(1) }

const DB = process.env.MIGRATION_DATABASE_URL
if (!DB) { console.error('MIGRATION_DATABASE_URL belum diset (lihat header berkas ini).'); process.exit(1) }
if (!/127\.0\.0\.1|localhost/.test(DB)) {
  console.error('MIGRATION_DATABASE_URL harus lewat cloud-sql-proxy di localhost, bukan socket /cloudsql.')
  process.exit(1)
}

const gcloud = (...args) => execFileSync('gcloud', args, { encoding: 'utf8' }).trim()
const token = () => gcloud('auth', 'print-access-token')
const step = (n, s) => console.log(`\n[${n}] ${s}`)
const plan = (s) => console.log(`   ${APPLY ? '→' : 'akan:'} ${s}`)

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      'content-type': 'application/json',
      'x-goog-user-project': PROJECT,   // identitytoolkit menuntut quota project
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { ok: res.ok, status: res.status, json }
}

/** Password: 20 karakter base64url dari CSPRNG. Email demo berakhiran .invalid
 *  (tidak bisa menerima email), jadi TIDAK ADA alur reset password -- password
 *  yang hilang berarti akunnya dibuat ulang. Simpan di password manager. */
const newPassword = () => randomBytes(15).toString('base64url')

// ---------------------------------------------------------------------------
console.log(`\nIdentity Platform · proyek ${PROJECT} · mode ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

step(1, 'API identitytoolkit')
const enabled = gcloud('services', 'list', '--enabled', `--project=${PROJECT}`,
  '--filter=config.name:identitytoolkit', '--format=value(config.name)')
if (enabled) console.log('   sudah aktif')
else if (!APPLY) plan('gcloud services enable identitytoolkit.googleapis.com')
else { gcloud('services', 'enable', 'identitytoolkit.googleapis.com', `--project=${PROJECT}`); console.log('   diaktifkan') }

step(2, 'Inisialisasi Identity Platform + provider email/password')
let cfg = await api('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`)
if (cfg.status === 404 || (!cfg.ok && /not.*initialized/i.test(JSON.stringify(cfg.json)))) {
  if (!APPLY) plan('initializeAuth (Identity Platform belum pernah dinyalakan)')
  else { await api('POST', `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/identityPlatform:initializeAuth`, {}); console.log('   diinisialisasi') }
} else if (!cfg.ok) {
  console.error('   gagal membaca config:', JSON.stringify(cfg.json).slice(0, 300)); process.exit(1)
}
const emailOn = cfg.json?.signIn?.email?.enabled === true
if (emailOn) console.log('   provider email/password sudah aktif')
else if (!APPLY) plan('aktifkan signIn.email (passwordRequired = true)')
else {
  const r = await api('PATCH',
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=signIn.email`,
    { signIn: { email: { enabled: true, passwordRequired: true } } })
  console.log(r.ok ? '   provider email/password diaktifkan' : `   GAGAL: ${JSON.stringify(r.json).slice(0,200)}`)
}

step(3, 'Web API key (dikirim ke peramban -- publik menurut desain)')
let keyString = ''
const keys = gcloud('services', 'api-keys', 'list', `--project=${PROJECT}`, '--format=value(name,displayName)')
  .split('\n').filter(Boolean).map(l => l.split('\t'))
const existing = keys.find(([, name]) => (name || '').includes('agrovision-web'))
if (existing) {
  keyString = APPLY ? gcloud('services', 'api-keys', 'get-key-string', existing[0], `--project=${PROJECT}`, '--format=value(keyString)') : '(dibaca saat --apply)'
  console.log('   memakai key yang sudah ada: agrovision-web')
} else if (!APPLY) plan('buat API key "agrovision-web"')
else {
  const name = gcloud('services', 'api-keys', 'create', `--project=${PROJECT}`, '--display-name=agrovision-web', '--format=value(response.name)')
  keyString = gcloud('services', 'api-keys', 'get-key-string', name, `--project=${PROJECT}`, '--format=value(keyString)')
  console.log('   API key dibuat')
}

step(4, 'Akun per pengguna aktif di app.users')
const c = new pg.Client({ connectionString: DB })
await c.connect()
const { rows: users } = await c.query(
  `SELECT u.id, u.email::text AS email, u.full_name, u.app_role::text AS app_role, u.external_id,
          c.code AS company
     FROM app.users u JOIN app.companies c ON c.id = u.company_id
    WHERE u.is_active ORDER BY c.code, u.app_role, u.email`)
console.log(`   ${users.length} pengguna aktif`)

const creds = []
for (const u of users) {
  // Sudah tertaut ke subject Identity Platform sungguhan? (uid IdP tidak
  // memakai pola 'demo|...' / 'dev|...' bawaan seed.)
  const looksLinked = u.external_id && !/^(demo|dev|pilot|idp)\|/.test(u.external_id)
  if (looksLinked) { console.log(`   - ${u.email.padEnd(30)} sudah tertaut (${u.external_id})`); continue }

  if (!APPLY) { plan(`buat akun IdP untuk ${u.email} (${u.app_role}) lalu tautkan external_id`); continue }

  // Akun mungkin sudah ada dari percobaan sebelumnya -- cari dulu.
  let uid = null
  const look = await api('POST', `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { email: [u.email] })
  if (look.ok && look.json.users?.length) {
    uid = look.json.users[0].localId
    console.log(`   - ${u.email.padEnd(30)} akun IdP sudah ada, password tidak diubah`)
  } else {
    const password = newPassword()
    const mk = await api('POST', `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`,
      { email: u.email, password, emailVerified: true, displayName: u.full_name })
    if (!mk.ok) { console.error(`   - ${u.email}: GAGAL membuat akun -- ${JSON.stringify(mk.json).slice(0,200)}`); continue }
    uid = mk.json.localId
    creds.push({ email: u.email, password, role: u.app_role, company: u.company, nama: u.full_name })
    console.log(`   - ${u.email.padEnd(30)} akun dibuat`)
  }

  await c.query(`UPDATE app.users SET external_id = $1 WHERE id = $2`, [uid, u.id])
  console.log(`     external_id -> ${uid}`)
}

step(5, 'Verifikasi: benarkah bisa masuk?')
if (!APPLY || creds.length === 0) console.log('   dilewati (dry-run, atau tidak ada akun baru)')
else for (const cr of creds) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${keyString}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: cr.email, password: cr.password, returnSecureToken: true }),
  })
  const j = await res.json()
  const sub = j.idToken ? JSON.parse(Buffer.from(j.idToken.split('.')[1], 'base64url').toString()).sub : null
  const { rows } = await c.query(`SELECT user_id FROM app.resolve_session($1)`, [sub ?? ''])
  console.log(`   - ${cr.email.padEnd(30)} ${j.idToken ? 'idToken OK' : 'GAGAL: ' + (j.error?.message ?? '?')} · resolve_session ${rows.length ? 'ketemu' : 'TIDAK ketemu'}`)
}

step(6, 'Gerbang kesiapan produksi')
const { rows: gate } = await c.query(`SELECT item, blocking, detail FROM app.check_production_readiness() WHERE blocking`)
if (gate.length) for (const g of gate) console.log(`   BLOCKING · ${g.item}: ${g.detail}`)
else console.log('   0 baris blocking')
await c.end()

step(7, 'Substitusi trigger Cloud Build')
console.log('   PENTING: cloudbuild.yaml memakai --set-env-vars, yang MENGGANTI seluruh env Cloud Run.')
console.log('   Menyetel env langsung di service akan terhapus deploy berikutnya; nilainya harus ada di TRIGGER.')
if (!APPLY) plan(`_IDENTITY_PROJECT_ID=${PROJECT}, _IDENTITY_API_KEY=<key>`)
else {
  const url = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/locations/asia-southeast2/triggers/agrovision-deploy-v2`
  const cur = await api('GET', url)
  if (!cur.ok) console.error('   trigger tidak terbaca:', JSON.stringify(cur.json).slice(0, 200))
  else {
    cur.json.substitutions = { ...(cur.json.substitutions || {}), _IDENTITY_PROJECT_ID: PROJECT, _IDENTITY_API_KEY: keyString }
    const up = await api('PATCH', `${url}?updateMask=substitutions`, cur.json)
    console.log(up.ok ? '   substitusi trigger dipasang' : `   GAGAL: ${JSON.stringify(up.json).slice(0,200)}`)
  }
}

if (creds.length) {
  const out = 'identity-platform-credentials.txt'
  writeFileSync(out, creds.map(c => `${c.role}\t${c.email}\t${c.password}\t${c.nama} (${c.company})`).join('\n') + '\n')
  chmodSync(out, 0o600)
  console.log(`\n${'='.repeat(72)}\nKREDENSIAL BARU -- ditampilkan SEKALI ini saja\n${'='.repeat(72)}`)
  for (const c of creds) console.log(`  ${c.role.padEnd(12)} ${c.email.padEnd(30)} ${c.password}`)
  console.log(`\nDisimpan juga di ./${out} (chmod 600). Pindahkan ke password manager lalu HAPUS berkasnya.`)
  console.log('Berkas itu ada di .gitignore -- jangan pernah di-commit.')
  console.log('\nEmail .invalid tidak bisa menerima apa pun: tidak ada alur reset password.')
  console.log('Password hilang = akun dibuat ulang lewat skrip ini.')
}
console.log(`\n${APPLY ? 'Selesai.' : 'Dry-run selesai. Ulangi dengan --apply untuk mengerjakannya.'}`)
