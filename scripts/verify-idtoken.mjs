#!/usr/bin/env node
// Uji verifikasi ID token Identity Platform — B-27.
//
// Bagian keamanan dari B-27 seluruhnya ada di satu fungsi:
// verifyIdTokenWithCerts() (src/lib/auth/identity-platform.ts). Berkas ini
// membuat kunci penandatangan SENDIRI, mencetak token yang cacat satu per satu,
// dan membuktikan setiap cacat itu DITOLAK. Tanpa uji negatif, "login sudah
// pakai Identity Platform" hanyalah klaim: token yang tanda tangannya diabaikan
// tetap terlihat bekerja sempurna pada jalur bahagia.
//
//   npm run auth:verify
//
// Tidak menyentuh database, tidak menyentuh jaringan, tidak butuh .env.local.
// Kunci publik Google diganti sertifikat lokal lewat parameter `certs`, dan
// waktu diganti lewat `nowSeconds` -- karena itu "token kedaluwarsa" bisa diuji
// tanpa menunggu satu jam.
//
// Prasyarat: Node >= 22.18 (import berkas .ts langsung) dan `openssl` di PATH
// (membuat sertifikat self-signed; node:crypto hanya bisa MEMBACA X.509).

import { createSign, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE = fileURLToPath(new URL('../src/lib/auth/identity-platform.ts', import.meta.url))

let mod
try {
  mod = await import(MODULE)
} catch (e) {
  console.error('Gagal meng-import src/lib/auth/identity-platform.ts:', e.message)
  console.error('Butuh Node >= 22.18 (type stripping). Versi sekarang:', process.version)
  process.exit(1)
}
const { verifyIdTokenWithCerts, cacheSecondsFromHeader, IdTokenError } = mod

let pass = 0, fail = 0
const ok = (n, c, extra = '') => {
  const suffix = extra ? ' — ' + extra : ''
  if (c) { pass++; console.log(`  PASS  ${n}${suffix}`) }
  else { fail++; console.log(`  FAIL  ${n}${suffix}`) }
}

/** Berhasil = DITOLAK, dengan alasan yang cocok. */
function mustReject(name, fn, matcher) {
  try {
    fn()
    ok(name, false, 'token DITERIMA padahal seharusnya ditolak')
  } catch (e) {
    const good = e instanceof IdTokenError && (!matcher || matcher.test(e.message))
    ok(name, good, good ? '' : `ditolak tapi alasan tak sesuai: ${e.message.slice(0, 80)}`)
  }
}

// ---------------------------------------------------------------------------
// Sertifikat penandatangan tiruan (pengganti kunci publik Google)
// ---------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'agrovision-idtoken-'))
const certFor = (name) => {
  const key = join(dir, `${name}.key`), crt = join(dir, `${name}.crt`)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', key, '-out', crt, '-subj', `/CN=${name}.agrovision.test`], { stdio: 'ignore' })
  return { privateKey: readFileSync(key, 'utf8'), cert: readFileSync(crt, 'utf8') }
}

const PROJECT = 'agrovision-uji'
const KID = 'kunci-1'
const signer = certFor('signer')
const penyusup = certFor('penyusup')   // kunci lain, kid yang sama
const certs = { [KID]: signer.cert }

const NOW = 1_800_000_000            // waktu tetap; tidak ada Date.now() di sini
const base = () => ({
  iss: `https://securetoken.google.com/${PROJECT}`,
  aud: PROJECT,
  sub: 'uid-abc123',
  email: 'orang@perusahaan.co.id',
  email_verified: true,
  auth_time: NOW - 30,
  iat: NOW - 30,
  exp: NOW + 3600,
})

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

function mint(payload, { header = { alg: 'RS256', kid: KID }, privateKey = signer.privateKey } = {}) {
  const data = `${b64(header)}.${b64(payload)}`
  return `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url')}`
}

const check = (token, nowSeconds = NOW) =>
  verifyIdTokenWithCerts(token, { certs, projectId: PROJECT, nowSeconds })

// ---------------------------------------------------------------------------
console.log('\n=== Jalur bahagia ===')
const claims = check(mint(base()))
ok('token sah diterima, klaim sub dikembalikan', claims.subject === 'uid-abc123', claims.subject)
ok('email & email_verified ikut terbaca',
  claims.email === 'orang@perusahaan.co.id' && claims.emailVerified === true, JSON.stringify(claims))
ok('email_verified false tidak dipalsukan jadi true',
  check(mint({ ...base(), email_verified: false })).emailVerified === false)
ok('token tanpa klaim email menghasilkan email null',
  check(mint({ ...base(), email: undefined })).email === null)

console.log('\n=== Serangan tanda tangan ===')
mustReject('alg "none" DITOLAK', () =>
  check(`${b64({ alg: 'none', kid: KID })}.${b64(base())}.`), /RS256/)

mustReject('HS256 dengan sertifikat publik sebagai rahasia HMAC DITOLAK', () => {
  const data = `${b64({ alg: 'HS256', kid: KID })}.${b64(base())}`
  const mac = createHmac('sha256', signer.cert).update(data).digest('base64url')
  return check(`${data}.${mac}`)
}, /RS256/)

mustReject('token ditandatangani kunci LAIN (kid dipalsukan) DITOLAK', () =>
  check(mint(base(), { privateKey: penyusup.privateKey })), /tanda tangan/)

mustReject('payload diubah setelah ditandatangani DITOLAK', () => {
  const token = mint(base())
  const [h, , s] = token.split('.')
  return check(`${h}.${b64({ ...base(), sub: 'uid-super-admin' })}.${s}`)
}, /tanda tangan/)

mustReject('kid tak dikenal DITOLAK', () =>
  check(mint(base(), { header: { alg: 'RS256', kid: 'kunci-entah' } })), /kid/)

try {
  check(mint(base(), { header: { alg: 'RS256', kid: 'kunci-entah' } }))
  ok('kid tak dikenal ditandai unknownKeyId (agar bisa dicoba ulang setelah rotasi)', false)
} catch (e) {
  ok('kid tak dikenal ditandai unknownKeyId (agar bisa dicoba ulang setelah rotasi)',
    e instanceof IdTokenError && e.unknownKeyId === true)
}

mustReject('header tanpa kid DITOLAK', () =>
  check(mint(base(), { header: { alg: 'RS256' } })), /kid/)
mustReject('token bukan tiga bagian DITOLAK', () => check('bukan.jwt'), /tiga bagian/)
mustReject('token kosong DITOLAK', () => check(''), /kosong/)

console.log('\n=== Klaim: proyek, umur, subject ===')
mustReject('aud proyek lain DITOLAK (token sah milik proyek Firebase lain)', () =>
  check(mint({ ...base(), aud: 'proyek-orang-lain' })), /aud/)
mustReject('iss selain securetoken.google.com/<project> DITOLAK', () =>
  check(mint({ ...base(), iss: 'https://securetoken.google.com/proyek-orang-lain' })), /iss/)
mustReject('token kedaluwarsa DITOLAK', () =>
  check(mint({ ...base(), exp: NOW - 120 })), /kedaluwarsa/)
ok('kedaluwarsa 30 detik masih diterima (toleransi jam 60 detik)',
  check(mint({ ...base(), exp: NOW - 30 })).subject === 'uid-abc123')
mustReject('iat jauh di masa depan DITOLAK', () =>
  check(mint({ ...base(), iat: NOW + 600 })), /iat/)
mustReject('auth_time di masa depan DITOLAK', () =>
  check(mint({ ...base(), auth_time: NOW + 600 })), /auth_time/)
mustReject('token tanpa exp DITOLAK', () =>
  check(mint({ ...base(), exp: undefined })), /exp/)
mustReject('token tanpa iat DITOLAK', () =>
  check(mint({ ...base(), iat: undefined })), /iat/)
mustReject('sub kosong DITOLAK', () =>
  check(mint({ ...base(), sub: '' })), /sub/)
mustReject('sub berlebihan panjang DITOLAK', () =>
  check(mint({ ...base(), sub: 'x'.repeat(129) })), /sub/)
mustReject('projectId kosong di sisi server DITOLAK (salah konfigurasi, bukan diterima diam-diam)', () =>
  verifyIdTokenWithCerts(mint(base()), { certs, projectId: '', nowSeconds: NOW }), /projectId/)

console.log('\n=== Cache kunci publik ===')
ok('max-age dipakai apa adanya', cacheSecondsFromHeader('public, max-age=1800') === 1800)
ok('max-age raksasa dibatasi 24 jam', cacheSecondsFromHeader('max-age=999999') === 86400)
ok('max-age nol dinaikkan ke batas bawah 60 detik', cacheSecondsFromHeader('max-age=0') === 60)
ok('tanpa header memakai bawaan 1 jam', cacheSecondsFromHeader(null) === 3600)

// ---------------------------------------------------------------------------
// Pemilihan mode login (src/lib/auth/config.ts)
//
// Yang diuji di sini adalah SATU keputusan: kapan login tanpa kata sandi boleh
// terjadi. Salah di sini membuat seluruh verifikasi token di atas tidak ada
// artinya -- pintu sampingnya tetap terbuka.
// ---------------------------------------------------------------------------
console.log('\n=== Mode login (fail-closed) ===')
const { getAuthConfig } = await import(
  fileURLToPath(new URL('../src/lib/auth/config.ts', import.meta.url)))

const withEnv = (vars) => {
  const before = { ...process.env }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try { return getAuthConfig() } finally { process.env = before }
}

const IDP = { IDENTITY_PLATFORM_PROJECT_ID: 'proyek-x', IDENTITY_PLATFORM_API_KEY: 'kunci-x' }

let cfg = withEnv({ AUTH_MODE: undefined, NODE_ENV: 'production', ...IDP })
ok('AUTH_MODE tidak diset = identity-platform (BUKAN stub)', cfg.mode === 'identity-platform', cfg.mode)
ok('projectId & apiKey diteruskan apa adanya',
  cfg.projectId === 'proyek-x' && cfg.apiKey === 'kunci-x')

cfg = withEnv({ AUTH_MODE: 'stub', NODE_ENV: 'production', ...IDP })
ok('AUTH_MODE=stub DITOLAK saat NODE_ENV=production', cfg.mode === 'misconfigured', cfg.reason ?? cfg.mode)

cfg = withEnv({ AUTH_MODE: '  StUb ', NODE_ENV: 'development' })
ok('AUTH_MODE=stub diterima di luar produksi (spasi & huruf besar diabaikan)', cfg.mode === 'stub', cfg.mode)

cfg = withEnv({ AUTH_MODE: undefined, NODE_ENV: 'development', IDENTITY_PLATFORM_PROJECT_ID: undefined, IDENTITY_PLATFORM_API_KEY: undefined })
ok('env Identity Platform kosong = misconfigured, bukan jatuh ke stub', cfg.mode === 'misconfigured', cfg.mode)
ok('pesannya menyebut variabel mana yang kurang',
  /IDENTITY_PLATFORM_PROJECT_ID/.test(cfg.reason) && /IDENTITY_PLATFORM_API_KEY/.test(cfg.reason), cfg.reason)

cfg = withEnv({ AUTH_MODE: undefined, NODE_ENV: 'development', ...IDP, IDENTITY_PLATFORM_API_KEY: '' })
ok('satu variabel kosong sudah cukup untuk menolak melayani', cfg.mode === 'misconfigured', cfg.mode)

cfg = withEnv({ AUTH_MODE: 'apa-saja', NODE_ENV: 'development', ...IDP })
ok('AUTH_MODE tak dikenal DITOLAK (tidak diam-diam dianggap salah satu mode)',
  cfg.mode === 'misconfigured', cfg.reason ?? cfg.mode)

rmSync(dir, { recursive: true, force: true })
console.log(`\n${'='.repeat(56)}\nID TOKEN:  PASS ${pass}   FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
