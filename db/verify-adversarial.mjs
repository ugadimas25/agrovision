// Uji ADVERSARIAL — pelengkap db/verify.mjs.
//
// verify.mjs menguji jalur bahagia sebagai peran istimewa, dan DUA KALI memberi
// false pass: sekali karena berjalan sebagai superuser (melewati REVOKE), sekali
// karena hanya menguji budget scope 'block' (melewati bug fan-out view).
//
// Berkas ini menguji sebaliknya: peran terendah, tenant lain, scope non-blok,
// nilai mundur, dan hak yang seharusnya TIDAK dimiliki. Setiap uji di sini
// mengharapkan operasinya GAGAL.
import pg from 'pg'

const SUPER = process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres:dev@localhost:55433/agrovision'
const APP = process.env.DATABASE_URL ?? 'postgres://app_user:apppass@localhost:55433/agrovision'

const CA = '11111111-0000-0000-0000-00000000000a'
const CB = '11111111-0000-0000-0000-00000000000b'
const EA = '22222222-0000-0000-0000-00000000000a'
const EB = '22222222-0000-0000-0000-00000000000b'
const U_CREATOR = '33333333-0000-0000-0000-000000000001'
const U_APPROVER = '33333333-0000-0000-0000-000000000002'
const U_VIEWER = '33333333-0000-0000-0000-000000000003'
const U_ADMIN = '33333333-0000-0000-0000-000000000004'
const U_TENANT_B = '33333333-0000-0000-0000-000000000005'
const U_AGRO = '33333333-0000-0000-0000-000000000006'   // 0058: penyusun RAB, BUKAN pencatat realisasi

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  PASS  ${n}${extra ? ' — ' + extra : ''}`)) : (fail++, console.log(`  FAIL  ${n}${extra ? ' — ' + extra : ''}`)) }

/** Uji bahwa operasi DITOLAK. Berhasil = ditolak. */
async function mustFail(c, name, sql, params = [], matcher = null) {
  try {
    await c.query('SAVEPOINT sp')
    await c.query(sql, params)
    await c.query('ROLLBACK TO SAVEPOINT sp')
    ok(name, false, 'operasi BERHASIL padahal seharusnya ditolak')
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT sp').catch(() => {})
    const good = matcher ? matcher.test(e.message) : true
    ok(name, good, good ? '' : `ditolak tapi alasan tak sesuai: ${e.message.slice(0, 90)}`)
  }
}

/**
 * B-27: keadaan saklar login stub sebelum suite ini mengubahnya.
 *
 * Suite ini menguji keadaan PRODUKSI (saklar mati), tapi berbagi database
 * dengan lingkungan pengembangan yang justru butuh saklar itu menyala --
 * scripts/at-verify.mjs masuk lewat login stub. Mematikannya tanpa memulihkan
 * akan membuat suite HTTP mati setelahnya, dengan gejala "email tidak
 * terdaftar" yang menyesatkan.
 */
let stubSwitchBefore = false

async function restoreStubSwitch() {
  const c = new pg.Client({ connectionString: SUPER })
  await c.connect()
  try {
    await c.query(`UPDATE app.auth_settings SET stub_login_enabled = $1, updated_at = now() WHERE singleton`,
      [stubSwitchBefore])
  } finally {
    await c.end()
  }
}

async function setup() {
  const c = new pg.Client({ connectionString: SUPER })
  await c.connect()
  const q = (s, p) => c.query(s, p)

  // Saklar login stub dimatikan lebih dulu: seluruh bagian B-27 di bawah
  // menguji perilaku produksi. Nilai sebelumnya dipulihkan di akhir run().
  stubSwitchBefore = (await q(`SELECT stub_login_enabled FROM app.auth_settings WHERE singleton`))
    .rows[0]?.stub_login_enabled === true
  await q(`UPDATE app.auth_settings SET stub_login_enabled = false WHERE singleton`)

  // Idempoten: fixture run sebelumnya dibersihkan lebih dulu, dalam urutan FK.
  // Uji utama berjalan di dalam transaksi yang di-ROLLBACK, tapi setup ini tidak.
  for (const sql of [
    `DELETE FROM app.cost_transactions WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.budgets WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.land_preparations WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.dbh_measurements WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.emission_factors WHERE code IN ('EF-TEST','EF-X','EF-Y','EF-Z','EF-W','EF-VIEWER','EF-NEG')`,
    `DELETE FROM app.master_items WHERE company_id IN ($1,$2) OR code IN ('UOMKG','GLOB')`,
    `DELETE FROM app.report_definitions WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.seed_distributions WHERE seed_batch_id IN (SELECT id FROM app.seed_batches WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.seed_batches WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.fiscal_periods WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.blocks WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.estates WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.user_estate_access WHERE user_id IN (SELECT id FROM app.users WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.user_company_access WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.audit_log WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.users WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.companies WHERE id IN ($1,$2)`,
    `DELETE FROM app.cost_centers WHERE code = 'PLT'`,
  ]) {
    // Hanya kirim parameter bila statement memang memakainya.
    await q(sql, sql.includes('$1') ? [CA, CB] : [])
  }

  await q(`INSERT INTO app.companies (id,code,name) VALUES ($1,'CA','Tenant A'),($2,'CB','Tenant B')`, [CA, CB])
  await q(`INSERT INTO app.estates (id,company_id,code,name) VALUES ($1,$3,'EA','Estate A'),($2,$4,'EB','Estate B')`, [EA, EB, CA, CB])
  await q(`INSERT INTO app.users (id,company_id,external_id,email,full_name,app_role) VALUES
      ($1,$6,'idp|cr','cr@a.co','Creator A','creator'),
      ($2,$6,'idp|ap','ap@a.co','Approver A','approver'),
      ($3,$6,'idp|vw','vw@a.co','Viewer A','viewer'),
      ($4,$6,'idp|ad','ad@a.co','Admin A','super_admin'),
      ($5,$7,'idp|tb','tb@b.co','User B','creator'),
      ($8,$6,'idp|ag','ag@a.co','Agronomis A','agronomist')`,
    [U_CREATOR, U_APPROVER, U_VIEWER, U_ADMIN, U_TENANT_B, CA, CB, U_AGRO])
  await q(`INSERT INTO app.user_company_access (user_id,company_id) VALUES ($1,$5),($2,$5),($3,$5),($4,$5),($6,$7),($8,$5) ON CONFLICT DO NOTHING`,
    [U_CREATOR, U_APPROVER, U_VIEWER, U_ADMIN, CA, U_TENANT_B, CB, U_AGRO])
  await q(`INSERT INTO app.user_estate_access VALUES ($1,$2)`, [U_CREATOR, EA])

  const g = (lon, lat) => `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat},${lon + 0.009} ${lat},${lon + 0.009} ${lat - 0.009},${lon} ${lat - 0.009},${lon} ${lat}))',4326))`
  await q(`INSERT INTO app.blocks (id,company_id,estate_id,code,geom,boundary_source) VALUES
     ('44444444-0000-0000-0000-00000000000a',$1,$3,'A-BLK1',${g(114, -2)},'gps_survey'),
     ('44444444-0000-0000-0000-00000000000c',$1,$3,'A-BLK2',${g(114.1, -2)},'gps_survey'),
     ('44444444-0000-0000-0000-00000000000b',$2,$4,'B-BLK1',${g(115, -3)},'gps_survey')`, [CA, CB, EA, EB])

  await q(`INSERT INTO app.fiscal_periods (id,company_id,code,name,starts_on,ends_on)
           VALUES ('55555555-0000-0000-0000-00000000000a',$1,'P1','Fase 1','2026-01-01','2026-12-31')`, [CA])
  await q(`INSERT INTO app.master_items (id,master_type_id,company_id,code,name)
           SELECT '66666666-0000-0000-0000-00000000000a',id,$1,'SEED','Bibit' FROM app.master_types WHERE code='cost_category'`, [CA])
  await q(`INSERT INTO app.cost_centers (id,code,name) VALUES ('77777777-0000-0000-0000-00000000000a','PLT','Plantation')`)
  await q(`INSERT INTO app.seed_batches (id,company_id,code,crop_id,received_on,qty_initial)
           SELECT '99999999-0000-0000-0000-00000000000a',$1,'NRS-ADV',id,'2026-01-01',100 FROM app.crops ORDER BY code LIMIT 1`, [CA])
  await c.end()
}

async function run() {
  await setup()
  const c = new pg.Client({ connectionString: APP })
  await c.connect()
  await c.query('BEGIN')

  const A_BLK1 = '44444444-0000-0000-0000-00000000000a'
  const A_BLK2 = '44444444-0000-0000-0000-00000000000c'
  const B_BLK1 = '44444444-0000-0000-0000-00000000000b'
  const PER = '55555555-0000-0000-0000-00000000000a'
  const CAT = '66666666-0000-0000-0000-00000000000a'
  const CC = '77777777-0000-0000-0000-00000000000a'

  const as = async (uid, role, companyId = null) => {
    await c.query(`SELECT set_config('app.current_user_id',$1,true)`, [uid])
    await c.query(`SELECT set_config('app.current_role',$1,true)`, [role])
    await c.query(`SELECT set_config('app.current_company_id',$1,true)`, [companyId ?? ''])
  }

  console.log('\n=== #6/#2 CRITICAL: bisakah user memberi dirinya akses tenant lain? ===')
  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'INSERT ke user_company_access DITOLAK',
    `INSERT INTO app.user_company_access (user_id,company_id) VALUES ($1,$2)`, [U_CREATOR, CB], /permission denied|row-level security/i)
  await mustFail(c, 'creator memanggil grant_company_access DITOLAK',
    `SELECT app.grant_company_access($1,$2)`, [U_CREATOR, CB], /super_admin/i)
  await as(U_ADMIN, 'super_admin', CA)
  await mustFail(c, 'super_admin beri akses ke entitas yang tak ia akses DITOLAK',
    `SELECT app.grant_company_access($1,$2)`, [U_CREATOR, CB], /ia sendiri akses/i)

  console.log('\n=== #7: bisakah creator memberi dirinya estate lain? ===')
  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'INSERT ke user_estate_access DITOLAK',
    `INSERT INTO app.user_estate_access VALUES ($1,$2)`, [U_CREATOR, EB], /permission denied|row-level security/i)

  console.log('\n=== #10 CRITICAL: RLS pada survey_submissions & nursery_inspections ===')
  let r = await c.query(`SELECT * FROM app.check_rls_coverage()`)
  ok('cakupan RLS bersih (tabel, policy, view security_invoker)', r.rows.length === 0,
    r.rows.map(x => `${x.table_name}: ${x.issue}`).join(' | ') || 'bersih')

  console.log('\n=== B-8: trigger audit terpasang di seluruh tabel approval_status ===')
  r = await c.query(`SELECT * FROM app.check_audit_coverage()`)
  ok('cakupan audit bersih (tiap tabel approval_status punya trigger write_audit)', r.rows.length === 0,
    r.rows.map(x => `${x.table_name}: ${x.issue}`).join(' | ') || 'bersih')

  await as(U_CREATOR, 'creator', CA)
  const wr = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by) VALUES ($1, now(), 'manual', 1.5, $2) RETURNING id`,
    [A_BLK1, U_CREATOR])
  const W_AUDIT_ID = wr.rows[0].id
  await c.query(`UPDATE app.weeding_records SET approval_status = 'submitted' WHERE id = $1`, [W_AUDIT_ID])
  await as(U_APPROVER, 'approver', CA)
  await c.query(`SELECT app.decide_record('weeding_record', $1, 'approved', NULL)`, [W_AUDIT_ID])
  // occurred_at pakai now() = waktu MULAI transaksi, sama untuk semua baris di
  // sesi ini -- urutkan pakai id (bigserial), bukan occurred_at, untuk dapat
  // baris UPDATE approve-nya, bukan baris INSERT draft-nya.
  r = await c.query(
    `SELECT actor_id, action FROM app.audit_log
      WHERE entity_type = 'weeding_records' AND entity_id = $1 AND action = 'update'
      ORDER BY id DESC LIMIT 1`, [W_AUDIT_ID])
  ok('approve penyiangan tercatat di audit_log dengan aktor yang benar',
    r.rows.length === 1 && r.rows[0].actor_id === U_APPROVER,
    r.rows[0] ? `action=${r.rows[0].action}, actor=${r.rows[0].actor_id}` : 'tidak ada baris UPDATE di audit_log')

  console.log('\n=== Isolasi tenant: tenant A tidak melihat apa pun milik B ===')
  await as(U_APPROVER, 'approver', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.blocks WHERE company_id=$1`, [CB])
  ok('blok tenant B tak terlihat', r.rows[0].n === 0)
  r = await c.query(`SELECT count(*)::int n FROM app.users WHERE company_id = $1`, [CB])
  ok('user tenant B tak terlihat', r.rows[0].n === 0, `${r.rows[0].n} user tenant B bocor`)
  r = await c.query(`SELECT count(*)::int n FROM app.companies`)
  ok('company tenant B tak terlihat', r.rows[0].n === 1)

  console.log('\n=== #21: uang tenant A tidak boleh mendarat di blok tenant B ===')
  await mustFail(c, 'cost_transaction ke blok tenant lain DITOLAK',
    `INSERT INTO app.cost_transactions (company_id,cost_center_id,block_id,cost_category_id,transaction_date,amount_idr)
     VALUES ($1,$2,$3,$4,'2026-03-01',1000)`, [CA, CC, B_BLK1, CAT], /ct_block_same_company|violates foreign key/i)

  console.log('\n=== #1/#16: publish_emission_factor sudah digerbang? ===')
  await as(U_APPROVER, 'approver', CA)
  await c.query(`SELECT app.publish_emission_factor('EF-X','N2O',0.01,'kg','IPCC 2019 Vol.4 Ch.11','2024-01-01')`)
  await as(U_VIEWER, 'viewer', CA)
  await mustFail(c, 'viewer menerbitkan factor DITOLAK',
    `SELECT app.publish_emission_factor('EF-Y','y',1,'kg','IPCC','2026-01-01')`, [], /approver atau super_admin/i)
  await as(U_APPROVER, 'approver', CA)
  await mustFail(c, 'valid_from mundur DITOLAK',
    `SELECT app.publish_emission_factor('EF-X','backdate',9,'kg','IPCC','1900-01-01')`, [], /harus setelah versi aktif/i)
  await mustFail(c, 'nilai negatif DITOLAK',
    `SELECT app.publish_emission_factor('EF-Z','z',-5,'kg','IPCC','2026-01-01')`, [], /harus > 0/i)
  await mustFail(c, 'nama kosong DITOLAK',
    `SELECT app.publish_emission_factor('EF-W','',1,'kg','IPCC','2026-01-01')`, [], /name wajib/i)
  r = await c.query(`SELECT approved_by FROM app.emission_factors WHERE code='EF-X'`)
  ok('approved_by diambil dari sesi, tak bisa dipalsukan', r.rows[0].approved_by === U_APPROVER)

  // =========================================================================
  // AI-44a / K-09 §19 — jalur create tarif baru dibuka, jadi gerbangnya harus
  // dibuktikan dari sisi penyerang: tarif adalah pengendali SELURUH angka
  // keuangan (K-06 Keputusan 3 menyempitkannya ke super_admin saja).
  // =========================================================================
  console.log('\n=== 0051: jadwal penyiangan tidak boleh disetel viewer/creator ===')
  // URUTAN PENTING: penolakan peran diuji SEBELUM super_admin menyetel apa pun.
  // Versi pertama uji ini menyetel jadwal lebih dulu, sehingga creator ditolak oleh
  // indeks ws_one_active_per_block -- bukan oleh RLS. Ia "lulus" tanpa membuktikan
  // gerbang perannya sama sekali; matcher mustFail yang menangkapnya.
  for (const [peran, uid] of [['viewer', U_VIEWER], ['creator', U_CREATOR]]) {
    await as(uid, peran, CA)
    await mustFail(c, `${peran} menyetel jadwal penyiangan DITOLAK RLS`,
      `INSERT INTO app.weeding_schedules (company_id, block_id, interval_day, created_by)
       VALUES ($1,(SELECT id FROM app.blocks WHERE company_id=$1 LIMIT 1),14,$2)`,
      [CA, uid], /row-level security/)
  }
  await as(U_ADMIN, 'super_admin', CA)
  await c.query(`INSERT INTO app.weeding_schedules (company_id, block_id, interval_day, created_by)
                 VALUES ($1,(SELECT id FROM app.blocks WHERE company_id=$1 LIMIT 1),30,$2)`, [CA, U_ADMIN])
  ok('super_admin bisa menyetel jadwal penyiangan', true)
  // Trigger ws_block_same_company: blok entitas LAIN tidak boleh dijadwalkan,
  // walau company_id yang dikirim benar. Tanpa trigger ini, RLS meloloskannya
  // karena company_id-nya memang milik pemanggil.
  await as(U_ADMIN, 'super_admin', CA)
  await mustFail(c, 'menjadwalkan blok entitas lain DITOLAK trigger',
    `INSERT INTO app.weeding_schedules (company_id, block_id, interval_day, created_by)
     VALUES ($1,(SELECT id FROM app.blocks WHERE company_id=$2 LIMIT 1),30,$3)`,
    [CA, CB, U_ADMIN], /bukan milik entitas/)

  // Isolasi tenant: jadwal entitas lain tidak terlihat.
  await as(U_TENANT_B, 'approver', CB)
  r = await c.query(`SELECT count(*)::int n FROM app.weeding_schedules`)
  ok('jadwal penyiangan entitas lain tidak terlihat', r.rows[0].n === 0, `${r.rows[0].n} baris terlihat`)

  // =========================================================================
  // AI-28 / migrasi 0052 — penonaktifan pengguna. Yang diserang di sini bukan
  // tombolnya (itu urusan at:verify), tapi invariannya: entitas TIDAK BOLEH
  // kehilangan super_admin aktif terakhirnya. Kalau bisa, pemulihannya butuh
  // akses SQL langsung ke produksi.
  // =========================================================================
  console.log('\n=== 0052: entitas tidak boleh kehilangan super_admin aktif terakhir ===')
  await as(U_ADMIN, 'super_admin', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.users WHERE company_id=$1 AND app_role='super_admin' AND is_active`, [CA])
  const jml = r.rows[0].n
  ok('prasyarat: entitas uji punya tepat satu super_admin aktif', jml === 1, `${jml} super_admin aktif`)
  await mustFail(c, 'menonaktifkan super_admin aktif terakhir DITOLAK trigger',
    `UPDATE app.users SET is_active=false WHERE id=$1`, [U_ADMIN], /super_admin aktif terakhir/)
  await mustFail(c, 'menghapus super_admin aktif terakhir DITOLAK trigger',
    `DELETE FROM app.users WHERE id=$1`, [U_ADMIN], /super_admin aktif terakhir/)
  // Menurunkan perannya adalah jalan memutar yang sama akibatnya: nol super_admin.
  await mustFail(c, 'menurunkan peran super_admin terakhir DITOLAK juga',
    `UPDATE app.users SET app_role='viewer' WHERE id=$1`, [U_ADMIN], /super_admin aktif terakhir/)
  // Penjaganya bukan "super_admin tidak bisa disentuh": dengan dua super_admin
  // aktif, satu boleh dinonaktifkan. Tanpa cek ini, trigger yang menolak SEMUA
  // perubahan akan lolos uji di atas tanpa memberi tahu bahwa fiturnya mati.
  await c.query(`INSERT INTO app.users (company_id, external_id, email, full_name, app_role, is_active)
                 VALUES ($1,'adv-sa2','adv-sa2@uji.invalid','Adv SA2','super_admin',true)`, [CA])
  await c.query(`UPDATE app.users SET is_active=false WHERE company_id=$1 AND external_id='adv-sa2'`, [CA])
  ok('dengan dua super_admin aktif, satu boleh dinonaktifkan', true)
  // Riwayat melindungi dirinya sendiri: pengguna yang pernah mencatat tidak bisa
  // dihapus, jadi jejak "siapa yang melakukan ini" tidak bisa dihilangkan.
  //
  // Riwayatnya DIBUAT lebih dulu di sini. Versi pertama uji ini langsung menghapus
  // U_CREATOR dan LOLOS -- fixture-nya masih bersih, jadi tidak ada FK yang
  // dilanggar. Ia membuktikan hal sebaliknya dari yang dimaksud: bahwa pengguna
  // tanpa jejak MEMANG bisa dihapus. Keduanya kini diuji terpisah.
  await as(U_ADMIN, 'super_admin', CA)
  await c.query(`INSERT INTO app.cost_transactions
                   (company_id, cost_center_id, block_id, cost_category_id, fiscal_period_id,
                    transaction_date, amount_idr, created_by)
                 VALUES ($1,'77777777-0000-0000-0000-00000000000a',
                         '44444444-0000-0000-0000-00000000000a',
                         '66666666-0000-0000-0000-00000000000a',
                         '55555555-0000-0000-0000-00000000000a',
                         '2026-03-01', 1000000, $2)`, [CA, U_CREATOR])
  await mustFail(c, 'menghapus pengguna yang punya riwayat DITOLAK foreign key',
    `DELETE FROM app.users WHERE id=$1`, [U_CREATOR], /foreign key/)
  // Dan pengguna yang belum meninggalkan jejak apa pun MEMANG boleh dihapus --
  // kalau tidak, tombol "Hapus" di /pengguna tidak akan pernah berguna.
  await c.query(`INSERT INTO app.users (id, company_id, external_id, email, full_name, app_role)
                 VALUES ('4d4d4d4d-0000-0000-0000-00000000000e',$1,'adv-baru','baru@uji.invalid','Belum Berjejak','viewer')`, [CA])
  await c.query(`DELETE FROM app.users WHERE id='4d4d4d4d-0000-0000-0000-00000000000e'`)
  ok('pengguna tanpa riwayat memang bisa dihapus', true)

  console.log('\n=== AI-44a: tarif hanya boleh disentuh super_admin ===')
  await as(U_ADMIN, 'super_admin', CA)
  await c.query(`SELECT app.publish_price(
                   p_code => 'ADV-WEED', p_rate_idr => 500000, p_valid_from => '2026-01-01',
                   p_unit => 'ha', p_kind => 'cost', p_category => 'Penyiangan',
                   p_driver => 'weeding_area_ha')`)
  r = await c.query(`SELECT id FROM app.price_list WHERE company_id=$1 AND code='ADV-WEED'`, [CA])
  const advPrice = r.rows[0]?.id
  ok('super_admin bisa membuat baris tarif', Boolean(advPrice))

  for (const [peran, uid] of [['approver', U_APPROVER], ['creator', U_CREATOR], ['viewer', U_VIEWER]]) {
    await as(uid, peran, CA)
    await mustFail(c, `${peran} MEMBUAT baris tarif DITOLAK`,
      `SELECT app.publish_price(p_code => 'ADV-${peran.toUpperCase()}', p_rate_idr => 1,
                               p_valid_from => '2026-09-01', p_unit => 'ha',
                               p_kind => 'cost', p_category => 'x')`, [], /super_admin/i)
    await mustFail(c, `${peran} MENERBITKAN versi tarif DITOLAK`,
      `SELECT app.publish_price('ADV-WEED', 9999, '2026-09-01')`, [], /super_admin/i)
    await mustFail(c, `${peran} MENGEDIT metadata tarif DITOLAK`,
      `SELECT app.update_price_meta($1, p_category => 'disusupi')`, [advPrice], /super_admin/i)
    await mustFail(c, `${peran} UPDATE langsung ke price_list DITOLAK`,
      `UPDATE app.price_list SET rate_idr = 1 WHERE id = $1`, [advPrice], /permission denied|row-level security/i)
  }

  // Bahkan super_admin tidak boleh menulis LANGSUNG: satu-satunya pintu adalah
  // fungsi bergerbang, dan itu ditegakkan REVOKE (ledger 0041 §7) -- bukan oleh
  // kesepakatan lapisan aplikasi.
  await as(U_ADMIN, 'super_admin', CA)
  await mustFail(c, 'super_admin pun tidak bisa INSERT langsung ke price_list',
    `INSERT INTO app.price_list (company_id,code,kind,category,unit,rate_idr,version,valid_from)
     VALUES ($1,'ADV-DIRECT','cost','x','ha',1,1,'2026-09-01')`, [CA], /permission denied|row-level security/i)
  await mustFail(c, 'super_admin pun tidak bisa DELETE baris tarif',
    `DELETE FROM app.price_list WHERE id = $1`, [advPrice], /permission denied|row-level security/i)
  // Backdating: tarif tidak boleh dimundurkan ke periode yang sudah dilewati.
  await mustFail(c, 'menerbitkan tarif dengan tanggal mundur DITOLAK',
    `SELECT app.publish_price('ADV-WEED', 1, '2025-01-01')`, [], /backdating dilarang/i)
  // Tenant lain: tarif entitas B tidak boleh disentuh dari sesi entitas A.
  await mustFail(c, 'menerbitkan tarif untuk entitas di luar akses DITOLAK',
    `SELECT app.publish_price(p_code => 'ADV-LINTAS', p_rate_idr => 1, p_valid_from => '2026-09-01',
                             p_unit => 'ha', p_company_id => $1, p_kind => 'cost', p_category => 'x')`,
    [CB], /di luar akses/i)

  console.log('\n=== #14 BLOCKER: v_budget_vs_actual fan-out pada scope non-blok ===')
  await as(U_APPROVER, 'approver', CA)
  // 1 budget company-scope, 3 pengeluaran di 2 blok berbeda
  await c.query(`INSERT INTO app.budgets (company_id,fiscal_period_id,cost_category_id,scope_type,amount_idr)
                 VALUES ($1,$2,$3,'company',10000000)`, [CA, PER, CAT])
  for (const [blk, amt] of [[A_BLK1, 3000000], [A_BLK1, 1000000], [A_BLK2, 5000000]]) {
    await c.query(`INSERT INTO app.cost_transactions
      (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status,created_by)
      VALUES ($1,$2,$3,$4,$5,'2026-03-01',$6,'approved',$7)`, [CA, CC, blk, CAT, PER, amt, U_APPROVER])
  }
  r = await c.query(`SELECT count(*)::int n, sum(budget_idr) b, sum(actual_idr) a
                     FROM app.v_budget_vs_actual WHERE scope_type='company'`)
  ok('company-scope keluar TEPAT 1 baris', r.rows[0].n === 1, `${r.rows[0].n} baris`)
  ok('budget tidak terkali', Number(r.rows[0].b) === 10000000, `Rp ${Number(r.rows[0].b).toLocaleString('id-ID')}`)
  ok('actual = 9jt (bukan subtotal per blok)', Number(r.rows[0].a) === 9000000, `Rp ${Number(r.rows[0].a).toLocaleString('id-ID')}`)

  console.log('\n=== #15: budget estate tidak dibebani blok estate lain ===')
  await c.query(`INSERT INTO app.budgets (company_id,fiscal_period_id,cost_category_id,scope_type,estate_id,amount_idr)
                 VALUES ($1,$2,$3,'estate',$4,20000000)`, [CA, PER, CAT, EA])
  r = await c.query(`SELECT count(*)::int n, sum(actual_idr) a FROM app.v_budget_vs_actual WHERE scope_type='estate'`)
  ok('estate-scope keluar TEPAT 1 baris', r.rows[0].n === 1, `${r.rows[0].n} baris`)
  ok('actual estate A = 9jt (kedua blok memang di EA)', Number(r.rows[0].a) === 9000000)

  console.log('\n=== #27: creator tidak boleh menyentuh uang yang sudah approved ===')
  await as(U_CREATOR, 'creator', CA)
  // Catatan: RLS pada UPDATE MENYARING baris lewat USING, tidak melempar error.
  // Jadi yang benar diperiksa adalah rowCount = 0, bukan adanya exception.
  const upd = await c.query(`UPDATE app.cost_transactions SET amount_idr = 1 WHERE approval_status='approved'`)
  ok('creator UPDATE record approved: 0 baris terdampak', upd.rowCount === 0, `${upd.rowCount} baris`)
  const cnt = await c.query(`SELECT count(*)::int n FROM app.cost_transactions WHERE amount_idr = 1`)
  ok('tidak ada baris yang berubah', cnt.rows[0].n === 0)

  console.log('\n=== viewer read-only ===')
  await as(U_VIEWER, 'viewer', CA)
  await mustFail(c, 'viewer INSERT blok DITOLAK',
    `INSERT INTO app.blocks (company_id,estate_id,code,boundary_source) VALUES ($1,$2,'V-BLK','gps_survey')`,
    [CA, EA], /row-level security/i)
  // seed_distributions luput dari daftar writable 0018; policy-nya baru dipasang 0042.
  await mustFail(c, 'viewer INSERT distribusi bibit DITOLAK',
    `INSERT INTO app.seed_distributions (seed_batch_id,block_id,qty,distributed_on)
     VALUES ('99999999-0000-0000-0000-00000000000a',$1,10,'2026-02-01')`,
    ['44444444-0000-0000-0000-00000000000a'], /row-level security/i)

  console.log('\n=== #4/#5: laporan built-in & master sistem terlindungi ===')
  await as(U_CREATOR, 'creator', CA)
  const del = await c.query(`DELETE FROM app.report_definitions WHERE is_builtin`)
  ok('creator hapus laporan built-in: 0 baris terdampak', del.rowCount === 0, `${del.rowCount} baris`)
  const still = await c.query(`SELECT count(*)::int n FROM app.report_definitions WHERE is_builtin`)
  ok('3 laporan built-in masih utuh', still.rows[0].n === 3, `${still.rows[0].n} laporan`)
  await mustFail(c, 'hapus master_type sistem DITOLAK',
    `DELETE FROM app.master_types WHERE is_system`, [], /permission denied|tipe sistem/i)

  console.log('\n=== #12: baris global hanya boleh dibuat super_admin ===')
  await mustFail(c, 'creator buat master_item global DITOLAK',
    `INSERT INTO app.master_items (master_type_id,company_id,code,name)
     SELECT id,NULL,'GLOB','Global' FROM app.master_types WHERE code='cost_category'`, [], /row-level security/i)

  console.log('\n=== #23: duplikat baris global tertangkap ===')
  await as(U_ADMIN, 'super_admin', CA)
  await c.query(`INSERT INTO app.master_items (master_type_id,company_id,code,name)
                 SELECT id,NULL,'UOMKG','Kilogram' FROM app.master_types WHERE code='unit_of_measure'`)
  await mustFail(c, 'master_item global duplikat DITOLAK',
    `INSERT INTO app.master_items (master_type_id,company_id,code,name)
     SELECT id,NULL,'UOMKG','Kilogram lagi' FROM app.master_types WHERE code='unit_of_measure'`, [], /mi_global_uniq/i)

  console.log('\n=== #22: base_view harus ada di whitelist ===')
  await mustFail(c, 'base_view di luar whitelist DITOLAK',
    `INSERT INTO app.report_definitions (company_id,code,name,kind,base_view)
     VALUES ($1,'RPT-EVIL','Evil','custom','pg_shadow')`, [CA], /rd_base_view_fk|violates foreign key/i)

  console.log('\n=== #17: budget tidak jadi yatim saat blok dihapus ===')
  await c.query(`INSERT INTO app.budgets (company_id,fiscal_period_id,cost_category_id,scope_type,block_id,amount_idr)
                 VALUES ($1,$2,$3,'block',$4,1000)`, [CA, PER, CAT, A_BLK2])
  await c.query(`DELETE FROM app.cost_transactions WHERE block_id=$1`, [A_BLK2])
  await c.query(`DELETE FROM app.blocks WHERE id=$1`, [A_BLK2])
  r = await c.query(`SELECT count(*)::int n FROM app.budgets WHERE block_id=$1`, [A_BLK2])
  ok('budget ikut terhapus (ON DELETE CASCADE), tidak yatim', r.rows[0].n === 0)

  console.log('\n=== #18: rejection_reason ditegakkan di semua tabel approval ===')
  await mustFail(c, 'land_preparation rejected tanpa alasan DITOLAK',
    `INSERT INTO app.land_preparations (block_id,checked_at,approval_status)
     VALUES ($1,now(),'rejected')`, [A_BLK1], /rejection_needs_reason/i)
  await mustFail(c, 'dbh rejected tanpa alasan DITOLAK',
    `INSERT INTO app.dbh_measurements (block_id,crop_id,measured_at,dbh_cm,approval_status)
     SELECT $1,id,now(),10,'rejected' FROM app.crops LIMIT 1`, [A_BLK1], /rejection_needs_reason|null value/i)

  console.log('\n=== 0019: ledger pencabutan hak benar-benar berlaku ===')
  r = await c.query(`SELECT * FROM app.check_privilege_revocations()`)
  ok('tidak ada pencabutan yang bocor', r.rows.length === 0,
    r.rows.map(x => `${x.table_name}.${x.privilege}`).join(', ') || 'bersih')
  r = await c.query(`SELECT count(*)::int n FROM app.privilege_revocations`)
  ok('ledger terisi', r.rows[0].n >= 7, `${r.rows[0].n} entri`)

  console.log('\n=== #3: resolusi sesi tanpa konteks (bootstrap) ===')
  await c.query(`SELECT set_config('app.current_user_id','',true)`)
  await c.query(`SELECT set_config('app.current_role','',true)`)
  r = await c.query(`SELECT user_id, app_role FROM app.resolve_session('idp|ap')`)
  ok('resolve_session bekerja tanpa konteks', r.rows.length === 1 && r.rows[0].user_id === U_APPROVER)
  r = await c.query(`SELECT count(*)::int n FROM app.users`)
  ok('app.users tetap tertutup tanpa konteks', r.rows[0].n === 0)
  r = await c.query(`SELECT count(*)::int n FROM app.session_companies($1)`, [U_APPROVER])
  ok('session_companies bekerja tanpa konteks', r.rows[0].n === 1)

  console.log('\n=== B-23: creator hanya SELECT baris miliknya sendiri ===')
  r = await c.query(`SELECT * FROM app.check_creator_scope_coverage()`)
  ok('cakupan creator-scope bersih (tiap tabel role_split punya restrictive SELECT per-pembuat)', r.rows.length === 0,
    r.rows.map(x => `${x.table_name}: ${x.issue}`).join(' | ') || 'bersih')

  await as(U_ADMIN, 'super_admin', CA)
  const wrOwn = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by)
     VALUES ($1, now(), 'manual', 1, $2) RETURNING id`, [A_BLK1, U_CREATOR])
  const wrOther = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by)
     VALUES ($1, now(), 'manual', 2, $2) RETURNING id`, [A_BLK1, U_ADMIN])
  await as(U_CREATOR, 'creator', CA)
  r = await c.query(`SELECT id FROM app.weeding_records WHERE id IN ($1,$2)`, [wrOwn.rows[0].id, wrOther.rows[0].id])
  ok('creator hanya melihat baris miliknya sendiri (1 dari 2)',
    r.rows.length === 1 && r.rows[0].id === wrOwn.rows[0].id, `${r.rows.length} baris terlihat`)
  await as(U_APPROVER, 'approver', CA)
  r = await c.query(`SELECT id FROM app.weeding_records WHERE id IN ($1,$2)`, [wrOwn.rows[0].id, wrOther.rows[0].id])
  ok('approver melihat kedua baris (tidak dibatasi per-pembuat)', r.rows.length === 2, `${r.rows.length} baris terlihat`)

  console.log('\n=== B-25: kolom driver biaya wajib NOT NULL di DB ===')
  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'weeding_records.area_ha NULL DITOLAK',
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, created_by) VALUES ($1, now(), 'manual', $2)`,
    [A_BLK1, U_CREATOR], /null value|violates not-null/i)
  await mustFail(c, 'pruning_records.tree_count NULL DITOLAK',
    `INSERT INTO app.pruning_records (block_id, pruned_on, created_by) VALUES ($1, now(), $2)`,
    [A_BLK1, U_CREATOR], /null value|violates not-null/i)
  await mustFail(c, 'spraying_records.total_volume NULL DITOLAK',
    `INSERT INTO app.spraying_records (block_id, sprayed_on, unit, created_by) VALUES ($1, now(), 'liter', $2)`,
    [A_BLK1, U_CREATOR], /null value|violates not-null/i)
  await mustFail(c, 'spraying_records.unit NULL DITOLAK',
    `INSERT INTO app.spraying_records (block_id, sprayed_on, total_volume, created_by) VALUES ($1, now(), 5, $2)`,
    [A_BLK1, U_CREATOR], /null value|violates not-null/i)
  // land_preparations BUKAN NOT NULL polos -- CHECK bersyarat (status = 'not_started'
  // membolehkan NULL, status lain mewajibkan angka). Kedua sisinya harus diuji,
  // bukan cuma sisi "harus gagal" -- versi pertama uji ini cuma menembak status
  // in_progress dan tidak pernah membuktikan not_started tetap boleh NULL.
  await mustFail(c, 'land_preparations.effective_area_ha NULL saat status in_progress DITOLAK',
    `INSERT INTO app.land_preparations (block_id, checked_at, status, created_by) VALUES ($1, now(), 'in_progress', $2)`,
    [A_BLK1, U_CREATOR], /land_preparations_area_required_unless_not_started/i)
  await c.query(`SAVEPOINT sp_lsa_notstarted`)
  await c.query(
    `INSERT INTO app.land_preparations (block_id, checked_at, status, created_by) VALUES ($1, now(), 'not_started', $2)`,
    [A_BLK1, U_CREATOR])
  ok('land_preparations.effective_area_ha NULL diizinkan saat status not_started', true)
  await c.query(`ROLLBACK TO SAVEPOINT sp_lsa_notstarted`)

  console.log('\n=== B-21: creator memperbaiki record ditolak miliknya sendiri, bukan milik orang lain ===')
  await as(U_CREATOR, 'creator', CA)
  const wrFix = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by)
     VALUES ($1, now(), 'manual', 1, $2) RETURNING id`, [A_BLK1, U_CREATOR])
  const WR_FIX_ID = wrFix.rows[0].id
  await c.query(`UPDATE app.weeding_records SET approval_status = 'submitted' WHERE id = $1`, [WR_FIX_ID])
  await as(U_APPROVER, 'approver', CA)
  await c.query(`SELECT app.decide_record('weeding_record', $1, 'rejected', 'perlu perbaikan')`, [WR_FIX_ID])

  // Pola persis updateOpRecord: WHERE hanya mengulang syarat status; RLS
  // (role_split + B-23) yang menegakkan kepemilikan sesungguhnya.
  await as(U_CREATOR, 'creator', CA)
  const editOwn = await c.query(
    `UPDATE app.weeding_records SET area_ha = 9, approval_status = 'draft'
      WHERE id = $1 AND approval_status IN ('draft','rejected')`, [WR_FIX_ID])
  ok('creator bisa perbaiki record ditolak miliknya sendiri', editOwn.rowCount === 1, `${editOwn.rowCount} baris`)
  r = await c.query(`SELECT area_ha, approval_status FROM app.weeding_records WHERE id = $1`, [WR_FIX_ID])
  ok('nilai baru tersimpan dan status kembali draft',
    Number(r.rows[0].area_ha) === 9 && r.rows[0].approval_status === 'draft')

  await as(U_ADMIN, 'super_admin', CA)
  const wrOther2 = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, approval_status, rejection_reason, created_by)
     VALUES ($1, now(), 'manual', 1, 'rejected', 'x', $2) RETURNING id`, [A_BLK1, U_ADMIN])
  await as(U_CREATOR, 'creator', CA)
  const editOther = await c.query(
    `UPDATE app.weeding_records SET area_ha = 99, approval_status = 'draft'
      WHERE id = $1 AND approval_status IN ('draft','rejected')`, [wrOther2.rows[0].id])
  ok('creator TIDAK bisa mengedit record ditolak milik orang lain', editOther.rowCount === 0, `${editOther.rowCount} baris`)

  console.log('\n=== B-22: riwayat approval (v_approval_history) — lingkup & isi benar ===')
  await as(U_CREATOR, 'creator', CA)
  const histX = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by)
     VALUES ($1, now(), 'manual', 3, $2) RETURNING id`, [A_BLK1, U_CREATOR])
  const HIST_X = histX.rows[0].id
  await c.query(`UPDATE app.weeding_records SET approval_status = 'submitted' WHERE id = $1`, [HIST_X])
  await as(U_ADMIN, 'super_admin', CA)
  const histY = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, approval_status, created_by)
     VALUES ($1, now(), 'manual', 4, 'submitted', $2) RETURNING id`, [A_BLK1, U_ADMIN])
  const HIST_Y = histY.rows[0].id
  await as(U_APPROVER, 'approver', CA)
  await c.query(`SELECT app.decide_record('weeding_record', $1, 'approved', NULL)`, [HIST_X])
  await c.query(`SELECT app.decide_record('weeding_record', $1, 'rejected', 'volume tidak masuk akal')`, [HIST_Y])

  await as(U_CREATOR, 'creator', CA)
  r = await c.query(
    `SELECT record_id FROM app.v_approval_history WHERE record_id IN ($1,$2)`, [HIST_X, HIST_Y])
  ok('creator hanya melihat riwayat miliknya sendiri di v_approval_history',
    r.rows.length === 1 && r.rows[0].record_id === HIST_X, `${r.rows.length} baris terlihat`)

  await as(U_APPROVER, 'approver', CA)
  r = await c.query(
    `SELECT record_id, decision, rejection_reason, decided_by_name, current_status
       FROM app.v_approval_history WHERE record_id IN ($1,$2) ORDER BY decision`, [HIST_X, HIST_Y])
  ok('approver melihat kedua riwayat (miliknya sendiri + orang lain)', r.rows.length === 2, `${r.rows.length} baris`)
  const approved = r.rows.find(x => x.record_id === HIST_X)
  const rejected = r.rows.find(x => x.record_id === HIST_Y)
  ok('baris disetujui: decision benar, tanpa alasan penolakan, decided_by terisi',
    approved?.decision === 'approved' && approved?.rejection_reason === null && approved?.decided_by_name === 'Approver A',
    JSON.stringify(approved))
  ok('baris ditolak: decision + alasan penolakan tercatat benar',
    rejected?.decision === 'rejected' && rejected?.rejection_reason === 'volume tidak masuk akal',
    JSON.stringify(rejected))

  r = await c.query(`SELECT record_id FROM app.v_pending_approvals WHERE record_id IN ($1,$2)`, [HIST_X, HIST_Y])
  ok('record yang sudah diputuskan TIDAK lagi muncul di Inbox (v_pending_approvals) -- perilaku default tak berubah',
    r.rows.length === 0, `${r.rows.length} baris tersisa di Inbox`)

  // =========================================================================
  // B-27: gerbang login stub
  //
  // setup() sudah mematikan saklarnya (app.auth_settings.stub_login_enabled =
  // false) lewat koneksi superuser, karena itulah keadaan produksi. Yang diuji
  // di sini: dalam keadaan itu, bisakah aplikasi (app_rw) menyalakannya sendiri,
  // dan bisakah ia tetap memakai login tanpa kredensial.
  // =========================================================================
  console.log('\n=== B-27: login stub tidak bisa dinyalakan atau dipakai dari aplikasi ===')
  await as(U_ADMIN, 'super_admin', CA)

  await mustFail(c, 'super_admin TIDAK bisa menyalakan login stub (UPDATE auth_settings)',
    `UPDATE app.auth_settings SET stub_login_enabled = true WHERE singleton`, [], /permission denied/i)
  await mustFail(c, 'app_rw TIDAK bisa menyisipkan baris auth_settings kedua',
    `INSERT INTO app.auth_settings (singleton, stub_login_enabled) VALUES (true, true)`, [], /permission denied/i)
  await mustFail(c, 'app_rw TIDAK bisa menghapus baris auth_settings',
    `DELETE FROM app.auth_settings WHERE singleton`, [], /permission denied/i)

  await mustFail(c, 'saklar mati: app.lookup_login_stub DITOLAK (login tanpa kredensial mustahil)',
    `SELECT external_id FROM app.lookup_login_stub($1)`, ['ad@a.co'], /login stub dimatikan/i)

  await mustFail(c, 'fungsi warisan app.lookup_login_email sudah TIDAK ADA',
    `SELECT external_id FROM app.lookup_login_email($1)`, ['ad@a.co'], /does not exist/i)

  // Saklar harus tetap BISA DIBACA aplikasi -- kalau tidak, halaman login mati
  // total dan kegagalannya akan terlihat seperti "email salah".
  r = await c.query(`SELECT stub_login_enabled FROM app.auth_settings WHERE singleton`)
  ok('app_rw tetap boleh MEMBACA saklar (read-only, bukan buta)',
    r.rows.length === 1 && r.rows[0].stub_login_enabled === false, JSON.stringify(r.rows[0]))

  // Jalur produksi tidak lewat stub sama sekali: klaim `sub` dari ID token yang
  // sudah diverifikasi -> resolve_session. Harus tetap jalan saat saklar mati.
  r = await c.query(`SELECT user_id FROM app.resolve_session($1)`, ['idp|ad'])
  ok('jalur produksi (resolve_session dari klaim sub) tetap jalan saat saklar mati',
    r.rows[0]?.user_id === U_ADMIN)

  r = await c.query(`SELECT item FROM app.check_production_readiness() WHERE blocking AND item LIKE 'login stub%'`)
  ok('gerbang produksi bersih dari penghalang login saat saklar mati',
    r.rows.length === 0, r.rows.map(x => x.item).join(' | ') || 'bersih')

  // =========================================================================
  // 0058/0059: role `agronomist` menyusun RAB, TIDAK mencatat realisasi
  //
  // Policy *_viewer_readonly dulu berbunyi "siapa pun KECUALI viewer boleh
  // menulis" -- daftar larangan, bukan daftar izin. Artinya setiap role baru
  // otomatis dapat hak tulis ke seluruh tabel operasional begitu ditambahkan
  // ke enum. Bagian ini membuktikan lubang itu tertutup untuk agronomist, dan
  // -- sama pentingnya -- membuktikan ia tidak jadi buta.
  // =========================================================================
  console.log('\n=== 0058/0059: agronomist hanya membaca di luar RAB ===')
  await as(U_AGRO, 'agronomist', CA)

  await mustFail(c, 'agronomist TIDAK bisa mencatat penyiangan',
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by)
     VALUES ($1, now(), 'manual', 1, $2)`, [A_BLK1, U_AGRO], /row-level security|permission denied/i)

  await mustFail(c, 'agronomist TIDAK bisa mengajukan pengeluaran',
    `INSERT INTO app.cost_transactions (company_id, block_id, cost_category_id, cost_center_id,
       fiscal_period_id, transaction_date, amount_idr, created_by)
     VALUES ($1,$2,$3,$4,$5, now(), 1000, $6)`,
    [CA, A_BLK1, CAT, CC, PER, U_AGRO], /row-level security|permission denied/i)

  await mustFail(c, 'agronomist TIDAK bisa mengubah master data',
    `UPDATE app.master_items SET name = 'diubah agronomis' WHERE id = $1`, [CAT],
    /row-level security|permission denied/i)

  await mustFail(c, 'agronomist TIDAK bisa membuat blok',
    `INSERT INTO app.blocks (company_id, estate_id, code, boundary_source)
     VALUES ($1,$2,'AGRO-BLK','gps_survey')`, [CA, EA], /row-level security|permission denied/i)

  // decide_record() tidak melempar untuk role yang tidak berhak: policy
  // RESTRICTIVE role_split membuat barisnya TIDAK TERLIHAT untuk UPDATE, jadi
  // hasilnya nol baris -- pola yang sama dengan "creator tidak bisa mengubah
  // uang yang sudah disetujui". Yang diuji karena itu bukan exception-nya,
  // melainkan bahwa tidak ada yang berubah.
  const wrSebelum = await c.query(`SELECT approval_status FROM app.weeding_records WHERE id = $1`, [WR_FIX_ID])
  const putusan = await c.query(`SELECT app.decide_record('weeding_record', $1, 'approved', NULL) AS n`, [WR_FIX_ID])
  const wrSesudah = await c.query(`SELECT approval_status FROM app.weeding_records WHERE id = $1`, [WR_FIX_ID])
  ok('agronomist TIDAK bisa memutuskan approval (nol baris, status tak berubah)',
    putusan.rows[0].n === 0 && wrSesudah.rows[0].approval_status === wrSebelum.rows[0].approval_status,
    `n=${putusan.rows[0].n}, status ${wrSebelum.rows[0].approval_status} -> ${wrSesudah.rows[0].approval_status}`)

  // Arah sebaliknya: pembatasan tidak boleh kebablasan jadi kebutaan. Agronomis
  // menyusun RAB dari kondisi kebun -- ia HARUS bisa membaca blok & kategori.
  r = await c.query(`SELECT count(*)::int n FROM app.blocks WHERE company_id = $1`, [CA])
  ok('agronomist TETAP bisa membaca blok entitasnya', r.rows[0].n > 0, `${r.rows[0].n} blok`)
  r = await c.query(`SELECT count(*)::int n FROM app.master_items WHERE id = $1`, [CAT])
  ok('agronomist TETAP bisa membaca kategori biaya', r.rows[0].n === 1)

  // Role yang memang menulis tidak boleh ikut terkunci oleh predikat baru.
  await as(U_CREATOR, 'creator', CA)
  const wrAfter = await c.query(
    `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, created_by)
     VALUES ($1, now(), 'manual', 2, $2) RETURNING id`, [A_BLK1, U_CREATOR])
  ok('creator TETAP bisa menulis setelah predikat policy diganti', wrAfter.rowCount === 1)

  r = await c.query(`SELECT app.role_may_write_records() AS boleh`)
  ok('role_may_write_records() memakai daftar IZIN, bukan daftar larangan', r.rows[0].boleh === true)
  await as(U_VIEWER, 'viewer', CA)
  r = await c.query(`SELECT app.role_may_write_records() AS boleh`)
  ok('viewer tetap ditolak oleh fungsi yang sama', r.rows[0].boleh === false)

  // =========================================================================
  // 0060: RAB (app.budget_plans) -- siapa boleh menyusun, siapa boleh memutus
  // =========================================================================
  console.log('\n=== 0060: Rencana Anggaran (RAB) ===')

  await as(U_AGRO, 'agronomist', CA)
  const rab = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, area_ha, horizon_months, created_by)
     VALUES ($1, 'RAB-UJI', 'RAB Uji 100 ha', 100, 12, $2) RETURNING id`, [CA, U_AGRO])
  const RAB_ID = rab.rows[0].id
  ok('agronomist BISA menyusun RAB', rab.rowCount === 1)

  const baris = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       item_kind, volume, unit_price_idr, created_by)
     VALUES ($1, 1, $2, 'Bibit kelapa', 'consumable', 7000, 100000, $3)
     RETURNING amount_idr`, [RAB_ID, CAT, U_AGRO])
  ok('amount_idr dihitung database, bukan dikirim aplikasi',
    Number(baris.rows[0].amount_idr) === 700000000, `Rp ${baris.rows[0].amount_idr}`)

  await mustFail(c, 'fase melewati horizon RAB DITOLAK',
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description, volume, unit_price_idr, created_by)
     VALUES ($1, 13, $2, 'Di luar horizon', 1, 1, $3)`, [RAB_ID, CAT, U_AGRO], /horizon/i)

  // Inti pemisahan wewenang: penyusun tidak boleh menyetujui susunannya sendiri.
  await mustFail(c, 'agronomist TIDAK bisa menyetujui RAB-nya sendiri (self-approval)',
    `UPDATE app.budget_plans SET approval_status = 'approved' WHERE id = $1`, [RAB_ID],
    /row-level security/i)

  await c.query(`UPDATE app.budget_plans SET approval_status = 'submitted' WHERE id = $1`, [RAB_ID])
  r = await c.query(`SELECT approval_status FROM app.budget_plans WHERE id = $1`, [RAB_ID])
  ok('agronomist BISA mengajukan RAB (draft -> submitted)', r.rows[0].approval_status === 'submitted')

  // Setelah diajukan, barisnya tidak lagi terlihat untuk UPDATE (klausa USING),
  // jadi hasilnya NOL BARIS -- bukan exception. Bedanya penting: pelanggaran
  // WITH CHECK melempar, penyaringan USING diam. Yang diuji karena itu bahwa
  // tidak ada yang berubah.
  const suntingSetelahAjukan = await c.query(
    `UPDATE app.budget_plans SET name = 'diubah setelah diajukan' WHERE id = $1`, [RAB_ID])
  r = await c.query(`SELECT name FROM app.budget_plans WHERE id = $1`, [RAB_ID])
  ok('agronomist TIDAK bisa menyunting RAB yang sudah diajukan (nol baris, nama utuh)',
    suntingSetelahAjukan.rowCount === 0 && r.rows[0].name === 'RAB Uji 100 ha',
    `${suntingSetelahAjukan.rowCount} baris, nama "${r.rows[0].name}"`)

  // creator = pencatat realisasi, bukan perencana.
  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'creator TIDAK bisa menyusun RAB',
    `INSERT INTO app.budget_plans (company_id, code, name, created_by) VALUES ($1,'RAB-CR','RAB creator',$2)`,
    [CA, U_CREATOR], /row-level security/i)

  await as(U_VIEWER, 'viewer', CA)
  await mustFail(c, 'viewer TIDAK bisa menyusun RAB',
    `INSERT INTO app.budget_plans (company_id, code, name, created_by) VALUES ($1,'RAB-VW','RAB viewer',$2)`,
    [CA, U_VIEWER], /row-level security/i)

  // Finance = approver. Ia memutuskan, dan rapat menyepakati ia boleh menambah
  // baris SETELAH disetujui (mis. menyewa ahli hidrologi).
  await as(U_APPROVER, 'approver', CA)
  const putus = await c.query(
    `UPDATE app.budget_plans SET approval_status = 'approved', decided_by = $2, decided_at = now()
      WHERE id = $1`, [RAB_ID, U_APPROVER])
  ok('approver (finance) BISA menyetujui RAB', putus.rowCount === 1)

  const tambahan = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       item_kind, volume, unit_price_idr, added_after_approval, created_by)
     VALUES ($1, 2, $2, 'Ahli hidrologi', 'service', 1, 25000000, true, $3) RETURNING id`,
    [RAB_ID, CAT, U_APPROVER])
  ok('approver BISA menambah baris setelah RAB disetujui', tambahan.rowCount === 1)

  // =========================================================================
  // 0064: RAB yang sudah diputuskan TIDAK BISA dihapus oleh siapa pun
  //
  // Audit 31 Agu 2026: app.budget_plans sama sekali tidak punya policy DELETE.
  // bp_writer_roles adalah RESTRICTIVE FOR ALL USING (true) -- untuk DELETE
  // hanya USING yang dikonsultasi, sehingga WITH CHECK-nya tidak pernah
  // dievaluasi -- dan bp_edit_gate dibatasi FOR UPDATE. Akibatnya viewer pun
  // bisa menghapus RAB yang sudah disetujui, dan ON DELETE CASCADE ikut
  // membawa seluruh komponen biaya beserta asumsinya. Terbukti di DB lokal:
  // 1 RAB / 11 komponen / 3 asumsi -> nol, sebagai viewer.
  //
  // Penolakannya DIAM: klausa USING menyaring baris, tidak melempar exception.
  // Karena itu yang diuji bukan galat, melainkan dua hal sekaligus -- nol baris
  // terhapus DAN RAB beserta komponennya masih utuh. Menguji rowCount saja
  // tidak cukup: DELETE yang menyaring dan DELETE yang berhasil atas nol baris
  // tidak bisa dibedakan tanpa memeriksa sisanya.
  // =========================================================================
  console.log('\n=== 0064: RAB yang sudah diputuskan tidak bisa dihapus ===')

  const nKomponenSebelum = (await c.query(
    `SELECT count(*)::int n FROM app.budget_plan_items WHERE plan_id = $1`, [RAB_ID])).rows[0].n

  for (const [uid, role] of [[U_VIEWER, 'viewer'], [U_CREATOR, 'creator'],
                             [U_APPROVER, 'approver'], [U_ADMIN, 'super_admin'],
                             [U_AGRO, 'agronomist']]) {
    await as(uid, role, CA)
    const hapus = await c.query(`DELETE FROM app.budget_plans WHERE id = $1`, [RAB_ID])
    const sisa = await c.query(
      `SELECT (SELECT count(*)::int FROM app.budget_plans WHERE id = $1) AS rab,
              (SELECT count(*)::int FROM app.budget_plan_items WHERE plan_id = $1) AS komponen`, [RAB_ID])
    ok(`${role} TIDAK bisa menghapus RAB yang sudah disetujui`,
       hapus.rowCount === 0 && sisa.rows[0].rab === 1 && sisa.rows[0].komponen === nKomponenSebelum,
       `${hapus.rowCount} baris terhapus, ${sisa.rows[0].komponen}/${nKomponenSebelum} komponen tersisa`)
  }

  // Kontrol positif -- tambalan tidak boleh ikut mematikan jalur yang sah.
  // Tanpa uji ini, policy yang menolak SEMUA penghapusan akan lolos diam-diam.
  await as(U_AGRO, 'agronomist', CA)
  const draftSendiri = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, area_ha, horizon_months,
       contingency_pct, approval_status, created_by)
     VALUES ($1, 'RAB-UJI-HAPUS', 'Draft percobaan', 1, 12, 0, 'draft', $2) RETURNING id`,
    [CA, U_AGRO])
  const hapusDraft = await c.query(
    `DELETE FROM app.budget_plans WHERE id = $1`, [draftSendiri.rows[0].id])
  ok('penyusun TETAP bisa menghapus draft-nya sendiri', hapusDraft.rowCount === 1)

  await as(U_APPROVER, 'approver', CA)

  await mustFail(c, 'penolakan RAB tanpa alasan DITOLAK',
    `UPDATE app.budget_plans SET approval_status = 'rejected', rejection_reason = NULL WHERE id = $1`,
    [RAB_ID], /rejection_needs_reason/i)

  // Isolasi tenant tetap berlaku untuk tabel baru.
  await as(U_TENANT_B, 'creator', CB)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_plans WHERE id = $1`, [RAB_ID])
  ok('RAB tenant A TIDAK terlihat oleh tenant B', r.rows[0].n === 0)

  await as(U_AGRO, 'agronomist', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_plan_items WHERE plan_id = $1`, [RAB_ID])
  ok('agronomist tetap melihat seluruh baris RAB entitasnya', r.rows[0].n === 2, `${r.rows[0].n} baris`)

  // =========================================================================
  // 0062: pusat asumsi — satu angka menggerakkan banyak baris, dan terkunci
  //       begitu RAB diajukan
  // =========================================================================
  console.log('\n=== 0062: asumsi RAB (basis × rasio) ===')
  await as(U_AGRO, 'agronomist', CA)

  const rab2 = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, horizon_months, created_by)
     VALUES ($1,'RAB-ASUMSI','RAB uji asumsi',12,$2) RETURNING id`, [CA, U_AGRO])
  const RAB2 = rab2.rows[0].id

  await c.query(
    `INSERT INTO app.budget_assumptions (plan_id, code, label, value, unit, created_by)
     VALUES ($1,'net_ha','Areal efektif',88,'ha',$2)`, [RAB2, U_AGRO])

  const turunan = await c.query(
    `INSERT INTO app.budget_plan_items
       (plan_id, phase_month, cost_category_id, description, volume, unit_price_idr,
        basis_code, ratio_per_basis, created_by)
     VALUES ($1, 1, $2, 'Bibit dari basis', 1, 100000, 'net_ha', 70, $3)
     RETURNING volume, amount_idr`, [RAB2, CAT, U_AGRO])
  ok('volume diturunkan database, bukan dari angka yang dikirim (1 → 88×70)',
    Number(turunan.rows[0].volume) === 6160, `volume ${turunan.rows[0].volume}`)
  ok('amount_idr ikut turunannya', Number(turunan.rows[0].amount_idr) === 616000000,
    `Rp ${turunan.rows[0].amount_idr}`)

  await mustFail(c, 'basis tanpa rasio DITOLAK (harus berpasangan)',
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       volume, unit_price_idr, basis_code, created_by)
     VALUES ($1,1,$2,'Basis yatim',1,1,'net_ha',$3)`, [RAB2, CAT, U_AGRO],
    /rasio per basis kosong/i)

  await mustFail(c, 'basis menunjuk asumsi yang tidak ada DITOLAK',
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       volume, unit_price_idr, basis_code, ratio_per_basis, created_by)
     VALUES ($1,1,$2,'Basis ngawur',1,1,'entah_apa',2,$3)`, [RAB2, CAT, U_AGRO],
    /tidak ada di RAB ini/i)

  // Inti tahap 2: ubah satu angka, seluruh baris turunannya bergerak.
  await c.query(`UPDATE app.budget_assumptions SET value = 70 WHERE plan_id = $1 AND code = 'net_ha'`, [RAB2])
  r = await c.query(`SELECT volume, amount_idr FROM app.budget_plan_items WHERE plan_id = $1`, [RAB2])
  ok('mengubah asumsi menghitung ulang baris yang memakainya (88→70 ha ⇒ 4900)',
    Number(r.rows[0].volume) === 4900 && Number(r.rows[0].amount_idr) === 490000000,
    `volume ${r.rows[0].volume}, Rp ${r.rows[0].amount_idr}`)

  r = await c.query(`SELECT count(*)::int n FROM app.check_budget_derived_volume()`)
  ok('check_budget_derived_volume() bersih setelah perhitungan ulang', r.rows[0].n === 0)

  // Setelah diajukan, asumsi TERKUNCI — untuk semua peran, termasuk finance.
  await c.query(`UPDATE app.budget_plans SET approval_status = 'submitted' WHERE id = $1`, [RAB2])

  const kunciAgro = await c.query(
    `UPDATE app.budget_assumptions SET value = 999 WHERE plan_id = $1 AND code = 'net_ha'`, [RAB2])
  ok('agronomist TIDAK bisa mengubah asumsi setelah RAB diajukan', kunciAgro.rowCount === 0)

  await as(U_APPROVER, 'approver', CA)
  const kunciFin = await c.query(
    `UPDATE app.budget_assumptions SET value = 999 WHERE plan_id = $1 AND code = 'net_ha'`, [RAB2])
  ok('finance pun TIDAK bisa mengubah asumsi RAB yang sudah diajukan',
    kunciFin.rowCount === 0, 'persetujuan atas angka yang berubah sendiri bukan persetujuan')

  r = await c.query(`SELECT volume FROM app.budget_plan_items WHERE plan_id = $1`, [RAB2])
  ok('nilai turunan tidak bergeser setelah penguncian', Number(r.rows[0].volume) === 4900)

  // Tapi finance TETAP boleh menambah baris setelah disetujui — kesepakatan
  // rapat 26 Agu, dan menambah baris tidak mengubah angka yang sudah ada.
  await c.query(`UPDATE app.budget_plans SET approval_status = 'approved' WHERE id = $1`, [RAB2])
  const tambah = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       volume, unit_price_idr, added_after_approval, created_by)
     VALUES ($1,2,$2,'Ahli hidrologi',1,25000000,true,$3) RETURNING id`, [RAB2, CAT, U_APPROVER])
  ok('finance tetap bisa menambah baris setelah disetujui', tambah.rowCount === 1)

  await as(U_VIEWER, 'viewer', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_assumptions WHERE plan_id = $1`, [RAB2])
  ok('viewer tetap bisa MEMBACA asumsi (dasar angka tidak disembunyikan)', r.rows[0].n === 1)

  // =========================================================================
  // 0063: registri sumber — kutipan yang bisa diperiksa ulang
  //
  // Tiga hal yang diuji di sini, semuanya soal kejujuran dan bukan sekadar hak
  // akses: (1) tautan yang mengaku bisa dibuka harus benar-benar bisa dibuka,
  // (2) kutipan tidak boleh berpindah entitas, dan (3) bukti di balik RAB yang
  // sudah diajukan tidak boleh diganti diam-diam.
  // =========================================================================
  console.log('\n=== 0063: registri sumber ===')
  await as(U_AGRO, 'agronomist', CA)

  const src = await c.query(
    `INSERT INTO app.budget_sources
       (company_id, code, topic, title, url, published_on, accessed_on, confidence, created_by)
     VALUES ($1,'S07','Labor','Keputusan Gubernur Jateng 100.3.3.1/505/2025',
             'https://jdih.jatengprov.go.id/kepgub_505_2025','2025-12-24','2026-08-26','high',$2)
     RETURNING id`, [CA, U_AGRO])
  const SRC = src.rows[0].id
  ok('agronomist BISA mendaftarkan sumber', src.rowCount === 1)

  // Sumber tanpa tautan SAH: keputusan rapat memang tidak punya URL, dan
  // memaksanya punya hanya akan melahirkan tautan karangan.
  const srcLisan = await c.query(
    `INSERT INTO app.budget_sources (company_id, code, title, url, created_by)
     VALUES ($1,'USR','Keputusan pemilik proyek (rapat 26 Agu)',NULL,$2) RETURNING id`,
    [CA, U_AGRO])
  ok('sumber TANPA tautan boleh masuk (url NULL → em-dash di layar)', srcLisan.rowCount === 1)

  // ...tapi KALIMAT di kolom url ditolak. 16_Sources sendiri menulis
  // "User-provided" di sana; kalau itu masuk, layar merendernya sebagai tautan
  // yang bisa diklik dan tidak menuju ke mana pun.
  await mustFail(c, 'kalimat "User-provided" di kolom URL DITOLAK',
    `INSERT INTO app.budget_sources (company_id, code, title, url, created_by)
     VALUES ($1,'S99','Sumber lisan','User-provided',$2)`, [CA, U_AGRO],
    /budget_sources_url_check/i)

  await mustFail(c, 'kode sumber ganda dalam satu entitas DITOLAK',
    `INSERT INTO app.budget_sources (company_id, code, title, created_by)
     VALUES ($1,'S07','Duplikat',$2)`, [CA, U_AGRO],
    /budget_sources_company_id_code_key/i)

  const rab3 = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, horizon_months, created_by)
     VALUES ($1,'RAB-SUMBER','RAB uji sumber',12,$2) RETURNING id`, [CA, U_AGRO])
  const RAB3 = rab3.rows[0].id

  const kutip = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       volume, unit_price_idr, source_id, source_ref, created_by)
     VALUES ($1,1,$2,'Upah harian',1,150000,$3,'Angka lisan rapat 26 Agu',$4) RETURNING id`,
    [RAB3, CAT, SRC, U_AGRO])
  r = await c.query(`SELECT source_id, source_ref FROM app.budget_plan_items WHERE id=$1`,
    [kutip.rows[0].id])
  ok('source_id dan source_ref hidup BERDAMPINGAN, tidak saling menggantikan',
    r.rows[0].source_id === SRC && r.rows[0].source_ref === 'Angka lisan rapat 26 Agu')

  // -------------------------------------------------------------------------
  // Gerbang tulis. Dipecah per perintah, jadi DELETE ikut tergerbang — bentuk
  // RESTRICTIVE FOR ALL + USING(true) yang dipakai bp_writer_roles (0060) TIDAK
  // menggerbang DELETE sama sekali, karena DELETE tidak pernah membaca
  // WITH CHECK.
  // -------------------------------------------------------------------------
  await as(U_VIEWER, 'viewer', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_sources WHERE company_id=$1`, [CA])
  ok('viewer TETAP bisa membaca registri (dasar angka tidak disembunyikan)',
    r.rows[0].n === 2, `${r.rows[0].n} sumber`)

  await mustFail(c, 'viewer TIDAK bisa mendaftarkan sumber',
    `INSERT INTO app.budget_sources (company_id, code, title, created_by)
     VALUES ($1,'VW','Sumber viewer',$2)`, [CA, U_VIEWER], /row-level security/i)

  const suntingViewer = await c.query(
    `UPDATE app.budget_sources SET title='diubah viewer' WHERE id=$1`, [SRC])
  ok('viewer TIDAK bisa menyunting sumber (nol baris)', suntingViewer.rowCount === 0)

  const hapusViewer = await c.query(`DELETE FROM app.budget_sources WHERE id=$1`, [SRC])
  ok('viewer TIDAK bisa MENGHAPUS sumber (nol baris)', hapusViewer.rowCount === 0,
    'gerbang tulis dipecah per perintah, jadi DELETE tidak lolos')

  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'creator TIDAK bisa mendaftarkan sumber',
    `INSERT INTO app.budget_sources (company_id, code, title, created_by)
     VALUES ($1,'CR','Sumber creator',$2)`, [CA, U_CREATOR], /row-level security/i)

  // -------------------------------------------------------------------------
  // Isolasi tenant. Yang penting di sini BUKAN cuma "tidak terlihat": FK
  // dievaluasi mesin dan melewati policy, jadi RLS saja tidak cukup untuk
  // mencegah tenant A menuliskan uuid sumber tenant B ke barisnya sendiri.
  // -------------------------------------------------------------------------
  await as(U_TENANT_B, 'creator', CB)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_sources WHERE id=$1`, [SRC])
  ok('sumber tenant A TIDAK terlihat oleh tenant B', r.rows[0].n === 0)

  await as(U_TENANT_B, 'super_admin', CB)
  const srcB = await c.query(
    `INSERT INTO app.budget_sources (company_id, code, title, created_by)
     VALUES ($1,'B01','Sumber tenant B',$2) RETURNING id`, [CB, U_TENANT_B])
  const SRC_B = srcB.rows[0].id

  await as(U_AGRO, 'agronomist', CA)
  await mustFail(c, 'RAB tenant A TIDAK bisa mengutip sumber tenant B (FK melewati RLS)',
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       volume, unit_price_idr, source_id, created_by)
     VALUES ($1,1,$2,'Kutipan lintas entitas',1,1,$3,$4)`, [RAB3, CAT, SRC_B, U_AGRO],
    /tidak terdaftar di entitas/i)

  await mustFail(c, 'asumsi tenant A TIDAK bisa mengutip sumber tenant B',
    `INSERT INTO app.budget_assumptions (plan_id, code, label, value, source_id, created_by)
     VALUES ($1,'lintas','Asumsi lintas entitas',1,$2,$3)`, [RAB3, SRC_B, U_AGRO],
    /tidak terdaftar di entitas/i)

  // -------------------------------------------------------------------------
  // Identitas sumber membeku begitu dikutip RAB yang bukan lagi draft.
  // Angkanya tidak bergerak; yang diganti buktinya — dan itu justru lebih sulit
  // ketahuan daripada angka yang berubah.
  // -------------------------------------------------------------------------
  const suntingDraft = await c.query(
    `UPDATE app.budget_sources SET title='Kepgub Jateng 100.3.3.1/505/2025 (judul dirapikan)'
      WHERE id=$1`, [SRC])
  ok('identitas sumber MASIH bisa diperbaiki selama RAB pengutipnya draft',
    suntingDraft.rowCount === 1)

  await c.query(`UPDATE app.budget_plans SET approval_status='submitted' WHERE id=$1`, [RAB3])

  await mustFail(c, 'judul sumber TIDAK bisa diubah setelah dikutip RAB yang diajukan',
    `UPDATE app.budget_sources SET title='diganti diam-diam' WHERE id=$1`, [SRC],
    /sudah dikutip RAB/i)

  await mustFail(c, 'tautan sumber TIDAK bisa diubah setelah dikutip RAB yang diajukan',
    `UPDATE app.budget_sources SET url='https://contoh.invalid/lain' WHERE id=$1`, [SRC],
    /sudah dikutip RAB/i)

  // Penurunan keyakinan sengaja DIBIARKAN lewat: mengetahui sebuah sumber lebih
  // lemah daripada yang dikira adalah informasi yang harus mengalir, bukan
  // ditahan. Begitu pula tanggal akses — sumber daring bisa hilang.
  const segarkan = await c.query(
    `UPDATE app.budget_sources SET accessed_on='2026-08-31', confidence='low' WHERE id=$1`, [SRC])
  ok('tanggal akses & keyakinan TETAP bisa disunting pada sumber yang identitasnya beku',
    segarkan.rowCount === 1)

  await mustFail(c, 'sumber yang sedang dikutip TIDAK bisa dihapus (ON DELETE RESTRICT)',
    `DELETE FROM app.budget_sources WHERE id=$1`, [SRC], /violates foreign key/i)

  r = await c.query(`SELECT count(*)::int n FROM app.check_budget_source_scope()`)
  ok('check_budget_source_scope() bersih — tidak ada kutipan lintas entitas', r.rows[0].n === 0)

  // =========================================================================
  // 0065: baris RAB yang sudah disetujui BEKU — untuk semua peran
  //
  // 0060 memasang bpi_edit_update sebagai RESTRICTIVE FOR UPDATE dengan cabang
  // approver TANPA syarat status dan TANPA WITH CHECK. Akibatnya approver (dan
  // super_admin) bisa menulis ulang unit_price_idr / volume / is_active pada RAB
  // yang SUDAH disetujui: amount_idr ikut karena GENERATED, total bergeser,
  // added_after_approval tetap false, decided_at tidak bergerak. Terbukti pada
  // dataset demo: RAB-2026-01, 11 baris, Rp 2.185.200.000 → Rp 5.463.000.000
  // hanya dengan satu UPDATE, lalu 11 baris itu bisa dicoret dan dihapus.
  //
  // Penolakannya DIAM (klausa USING menyaring, tidak melempar), jadi setiap uji
  // di bawah memeriksa DUA hal: nol baris terubah/terhapus DAN angkanya masih
  // utuh. rowCount saja tidak membuktikan apa pun — UPDATE yang tersaring dan
  // UPDATE yang kebetulan tidak menemukan baris terlihat sama persis.
  //
  // Yang melempar hanya pelanggaran WITH CHECK (dua mustFail di bawah): baris
  // lama lolos USING, baris barunya yang dilarang.
  //
  // Tiga kontrol positif ikut dijaga di sini, karena tambalan yang menolak
  // segalanya juga "lulus" uji penolakan: approver tetap bisa MENAMBAH baris
  // setelah persetujuan (kesepakatan rapat 26 Agu), penyusun tetap bisa
  // menyunting draft-nya, dan cascade asumsi lintas peran tetap menggerakkan
  // baris turunannya.
  // =========================================================================
  console.log('\n=== 0065: baris RAB yang sudah disetujui tidak bisa disunting ===')

  await as(U_AGRO, 'agronomist', CA)
  const rab4 = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, horizon_months, created_by)
     VALUES ($1,'RAB-SUNTING','RAB uji gerbang sunting',12,$2) RETURNING id`, [CA, U_AGRO])
  const RAB4 = rab4.rows[0].id

  const barisLama = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       item_kind, volume, unit_price_idr, created_by)
     VALUES ($1,1,$2,'Pupuk NPK','consumable',1000,50000,$3) RETURNING id`, [RAB4, CAT, U_AGRO])
  const B_LAMA = barisLama.rows[0].id

  // Baris yang HILANG dikembalikan sebagai serba-null, bukan undefined: kalau
  // tambalannya dilepas, DELETE-nya berhasil dan pembacaan berikutnya akan
  // mematikan seluruh suite dengan TypeError — kegagalan yang menyembunyikan
  // sisa ujinya sendiri. Serba-null membuat setiap perbandingan di bawah
  // tetap FAIL, bukan meledak.
  const KOSONG = { volume: null, unit_price_idr: null, amount_idr: null,
                   is_active: null, added_after_approval: null }
  const bacaBaris = async (id) => (await c.query(
    `SELECT volume::text, unit_price_idr::text, amount_idr::text, is_active, added_after_approval
       FROM app.budget_plan_items WHERE id = $1`, [id])).rows[0] ?? KOSONG

  // Kontrol positif: pada draft-nya sendiri, penyusun menyunting dan mencoret.
  const suntingDraftSendiri = await c.query(
    `UPDATE app.budget_plan_items SET unit_price_idr = 60000 WHERE id = $1`, [B_LAMA])
  let sBaris = await bacaBaris(B_LAMA)
  ok('penyusun TETAP bisa menyunting baris pada draft-nya sendiri',
    suntingDraftSendiri.rowCount === 1 && Number(sBaris.unit_price_idr) === 60000
      && Number(sBaris.amount_idr) === 60000000, `Rp ${sBaris.amount_idr}`)

  const coret = await c.query(
    `UPDATE app.budget_plan_items SET is_active = false WHERE id = $1`, [B_LAMA])
  sBaris = await bacaBaris(B_LAMA)
  ok('penyusun TETAP bisa mencoret baris pada draft-nya sendiri (is_active)',
    coret.rowCount === 1 && sBaris.is_active === false)
  await c.query(`UPDATE app.budget_plan_items SET is_active = true WHERE id = $1`, [B_LAMA])

  // Diajukan: tidak ada yang boleh menyunting baris — termasuk pemutusnya,
  // yang justru sedang menimbang angka itu.
  await c.query(`UPDATE app.budget_plans SET approval_status = 'submitted' WHERE id = $1`, [RAB4])

  for (const [uid, role] of [[U_AGRO, 'agronomist'], [U_APPROVER, 'approver'],
                             [U_ADMIN, 'super_admin']]) {
    await as(uid, role, CA)
    const sunting = await c.query(
      `UPDATE app.budget_plan_items SET unit_price_idr = 250000 WHERE id = $1`, [B_LAMA])
    const st = await bacaBaris(B_LAMA)
    ok(`${role} TIDAK bisa menyunting baris RAB yang sudah diajukan (nol baris, harga utuh)`,
      sunting.rowCount === 0 && Number(st.unit_price_idr) === 60000,
      `${sunting.rowCount} baris, Rp ${st.unit_price_idr}`)
  }

  await as(U_APPROVER, 'approver', CA)
  await c.query(
    `UPDATE app.budget_plans SET approval_status = 'approved', decided_by = $2, decided_at = now()
      WHERE id = $1`, [RAB4, U_APPROVER])

  // Kontrol positif — kesepakatan rapat 26 Agu tidak boleh ikut mati.
  const tambahSetelah = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       item_kind, volume, unit_price_idr, added_after_approval, created_by)
     VALUES ($1,2,$2,'Ahli hidrologi','service',1,25000000,true,$3) RETURNING id`,
    [RAB4, CAT, U_APPROVER])
  const B_BARU = tambahSetelah.rows[0].id
  ok('approver TETAP bisa menambah baris setelah RAB disetujui (rapat 26 Agu)',
    tambahSetelah.rowCount === 1)

  // Inti tambalan: baris yang IKUT disetujui beku bagi semua peran.
  for (const [uid, role] of [[U_APPROVER, 'approver'], [U_ADMIN, 'super_admin'],
                             [U_AGRO, 'agronomist']]) {
    await as(uid, role, CA)
    const sblm = await bacaBaris(B_LAMA)

    // `st.x !== null` BUKAN hiasan: kalau peran sebelumnya berhasil MENGHAPUS
    // baris ini (persis yang terjadi tanpa tambalan), pembacaan berikutnya
    // serba-null dan "nilai lama === nilai baru" menjadi benar karena keduanya
    // null — uji yang lulus justru karena datanya sudah lenyap.
    const uHarga = await c.query(
      `UPDATE app.budget_plan_items SET unit_price_idr = 250000 WHERE id = $1`, [B_LAMA])
    let st = await bacaBaris(B_LAMA)
    ok(`${role} TIDAK bisa mengubah unit_price_idr baris RAB yang sudah disetujui`,
      uHarga.rowCount === 0 && st.unit_price_idr !== null
        && st.unit_price_idr === sblm.unit_price_idr && st.amount_idr === sblm.amount_idr,
      `${uHarga.rowCount} baris, Rp ${st.amount_idr} (semula Rp ${sblm.amount_idr})`)

    const uVolume = await c.query(
      `UPDATE app.budget_plan_items SET volume = 9999 WHERE id = $1`, [B_LAMA])
    st = await bacaBaris(B_LAMA)
    ok(`${role} TIDAK bisa mengubah volume baris RAB yang sudah disetujui`,
      uVolume.rowCount === 0 && st.volume !== null && st.volume === sblm.volume
        && st.amount_idr === sblm.amount_idr,
      `${uVolume.rowCount} baris, volume ${st.volume}`)

    // is_active bukan kolom rupiah, tapi mencoret baris mengeluarkan angkanya
    // dari SELURUH total — akibatnya sama dengan menyetel nilainya jadi nol.
    const uAktif = await c.query(
      `UPDATE app.budget_plan_items SET is_active = false WHERE id = $1`, [B_LAMA])
    st = await bacaBaris(B_LAMA)
    ok(`${role} TIDAK bisa mencoret baris RAB yang sudah disetujui (is_active)`,
      uAktif.rowCount === 0 && st.is_active === true,
      `${uAktif.rowCount} baris, is_active ${st.is_active}`)

    const hapus = await c.query(`DELETE FROM app.budget_plan_items WHERE id = $1`, [B_LAMA])
    const masih = await c.query(
      `SELECT count(*)::int n FROM app.budget_plan_items WHERE id = $1`, [B_LAMA])
    ok(`${role} TIDAK bisa menghapus baris RAB yang sudah disetujui`,
      hapus.rowCount === 0 && masih.rows[0].n === 1,
      `${hapus.rowCount} baris terhapus, ${masih.rows[0].n} tersisa`)
  }

  // Yang ia tambahkan sendiri sesudah persetujuan tetap miliknya untuk
  // diperbaiki — baris itu memang bukan bagian dari angka yang disetujui.
  await as(U_APPROVER, 'approver', CA)
  const suntingTambahan = await c.query(
    `UPDATE app.budget_plan_items SET unit_price_idr = 30000000 WHERE id = $1`, [B_BARU])
  sBaris = await bacaBaris(B_BARU)
  ok('approver BISA menyunting baris yang ia tambahkan setelah persetujuan',
    suntingTambahan.rowCount === 1 && Number(sBaris.unit_price_idr) === 30000000,
    `Rp ${sBaris.amount_idr}`)

  // WITH CHECK, bukan USING: baris lamanya boleh disunting, keadaan barunya yang
  // dilarang. Tanpa WITH CHECK kedua UPDATE ini BERHASIL.
  await mustFail(c, 'baris tambahan TIDAK bisa melebur jadi baris yang disetujui (added_after_approval → false)',
    `UPDATE app.budget_plan_items SET added_after_approval = false WHERE id = $1`, [B_BARU],
    /row-level security/i)

  await mustFail(c, 'baris tambahan TIDAK bisa dipindahkan ke RAB lain yang sudah diajukan',
    `UPDATE app.budget_plan_items SET plan_id = $2 WHERE id = $1`, [B_BARU, RAB3],
    /row-level security/i)

  const hapusTambahan = await c.query(
    `DELETE FROM app.budget_plan_items WHERE id = $1`, [B_BARU])
  const sisaTambahan = await c.query(
    `SELECT count(*)::int n FROM app.budget_plan_items WHERE id = $1`, [B_BARU])
  ok('approver BISA menghapus baris yang ia tambahkan setelah persetujuan',
    hapusTambahan.rowCount === 1 && sisaTambahan.rows[0].n === 0)

  // Kontrol positif terakhir, dan alasan teknis kenapa cabang draft/rejected
  // TIDAK dipersempit jadi "hanya penyusunnya": app.budget_assumption_cascade()
  // (0062) meng-UPDATE budget_plan_items dari trigger pada asumsi. Kalau
  // approver tidak boleh menyentuh baris draft orang lain, mengubah asumsi akan
  // berhasil sementara baris turunannya diam di tempat — RAB yang setengah
  // berubah, dan check_budget_derived_volume() menandainya blocking sesudahnya.
  await as(U_AGRO, 'agronomist', CA)
  const rab5 = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, horizon_months, created_by)
     VALUES ($1,'RAB-CASCADE','RAB uji cascade lintas peran',12,$2) RETURNING id`, [CA, U_AGRO])
  const RAB5 = rab5.rows[0].id
  await c.query(
    `INSERT INTO app.budget_assumptions (plan_id, code, label, value, unit, created_by)
     VALUES ($1,'net_ha','Areal efektif',88,'ha',$2)`, [RAB5, U_AGRO])
  await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       volume, unit_price_idr, basis_code, ratio_per_basis, created_by)
     VALUES ($1,1,$2,'Bibit dari basis',1,100000,'net_ha',70,$3)`, [RAB5, CAT, U_AGRO])

  await as(U_APPROVER, 'approver', CA)
  await c.query(
    `UPDATE app.budget_assumptions SET value = 100 WHERE plan_id = $1 AND code = 'net_ha'`, [RAB5])
  r = await c.query(`SELECT volume::text FROM app.budget_plan_items WHERE plan_id = $1`, [RAB5])
  ok('cascade asumsi TETAP menggerakkan baris draft orang lain (88→100 ha ⇒ 7000)',
    Number(r.rows[0].volume) === 7000, `volume ${r.rows[0].volume}`)

  r = await c.query(`SELECT count(*)::int n FROM app.check_budget_derived_volume()`)
  ok('check_budget_derived_volume() bersih setelah cascade lintas peran', r.rows[0].n === 0)

  // =========================================================================
  // 0066: penugasan RAB dan serapan anggaran
  //
  // Rantai yang diuji di sini adalah rantai uang: RAB disetujui -> agronomis
  // menugaskan sebagian volume ke satu orang -> orang itu mencatat
  // pengeluarannya -> anggarannya berkurang. Setiap sambungan punya cara
  // gagalnya sendiri, dan hampir semuanya gagal DIAM kalau tidak dijaga:
  //
  //   - penugasan dari RAB yang belum disetujui  -> orang membelanjakan angka
  //     yang belum diputuskan siapa pun;
  //   - penugasan melebihi volume barisnya       -> satu baris 10 kg ditugaskan
  //     tiga kali penuh, dan RAB yang disetujui berubah tanpa keputusan baru;
  //   - penugasan lintas entitas                 -> FK dievaluasi mesin dan
  //     MELEWATI policy (pelajaran 0063), jadi RLS saja tidak menutupnya;
  //   - realisasi ditaut ke penugasan orang lain -> "siapa membelanjakan jatah
  //     ini" kehilangan jawabannya;
  //   - realisasi draft dihitung sebagai serapan -> angka yang belum diputuskan
  //     siapa pun muncul sebagai uang yang sudah terpakai.
  //
  // Dua bentuk penolakan dibedakan sepanjang blok ini. Pelanggaran WITH CHECK
  // dan RAISE dari trigger MELEMPAR (mustFail). Penyaringan klausa USING DIAM:
  // nol baris, tanpa galat. Untuk yang diam, yang diperiksa selalu DUA hal --
  // nol baris berubah DAN datanya masih utuh. rowCount saja tidak membuktikan
  // apa pun: UPDATE yang tersaring dan UPDATE yang kebetulan tidak menemukan
  // barisnya terlihat sama persis.
  // =========================================================================
  console.log('\n=== 0066: penugasan RAB (pagu volume, assignee, serapan) ===')

  await as(U_AGRO, 'agronomist', CA)
  const rab6 = await c.query(
    `INSERT INTO app.budget_plans (company_id, code, name, horizon_months, created_by)
     VALUES ($1,'RAB-TUGAS','RAB uji penugasan',12,$2) RETURNING id`, [CA, U_AGRO])
  const RAB6 = rab6.rows[0].id

  const itemA = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       item_kind, volume, unit_price_idr, created_by)
     VALUES ($1,1,$2,'Pupuk KCL','consumable',10,50000,$3) RETURNING id`,
    [RAB6, CAT, U_AGRO])
  const ITEM_A = itemA.rows[0].id                       // anggaran Rp 500.000, volume 10

  const itemB = await c.query(
    `INSERT INTO app.budget_plan_items (plan_id, phase_month, cost_category_id, description,
       item_kind, volume, unit_price_idr, created_by)
     VALUES ($1,3,$2,'Bibit kelapa','consumable',100,1000,$3) RETURNING id`,
    [RAB6, CAT, U_AGRO])
  const ITEM_B = itemB.rows[0].id                       // anggaran Rp 100.000, tanpa penugasan

  // --- RAB belum disetujui: tidak boleh ada penugasan sama sekali -----------
  await mustFail(c, 'penugasan pada RAB yang BELUM disetujui DITOLAK',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,2,$5)`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_AGRO], /belum disetujui/i)

  await c.query(`UPDATE app.budget_plans SET approval_status = 'submitted' WHERE id = $1`, [RAB6])
  await mustFail(c, 'penugasan pada RAB yang baru DIAJUKAN juga DITOLAK',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,2,$5)`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_AGRO], /belum disetujui/i)

  await as(U_APPROVER, 'approver', CA)
  await c.query(
    `UPDATE app.budget_plans SET approval_status = 'approved', decided_by = $2, decided_at = now()
      WHERE id = $1`, [RAB6, U_APPROVER])

  // --- Kontrol positif: inti alurnya harus tetap hidup ----------------------
  // Tanpa uji ini, tambalan yang menolak SEGALANYA juga "lulus" seluruh uji
  // penolakan di bawah.
  await as(U_AGRO, 'agronomist', CA)
  const tugasDede = await c.query(
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, uom_item_id, target_date, note, created_by)
     VALUES ($1,$2,$3,$4,2,NULL,'2026-01-20','Siapkan 2 kg KCL',$5) RETURNING id, status`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_AGRO])
  const TUGAS_DEDE = tugasDede.rows[0].id
  ok('agronomist BISA menugaskan pada RAB yang sudah disetujui',
    tugasDede.rowCount === 1 && tugasDede.rows[0].status === 'assigned')

  // --- Pagu volume: total penugasan aktif tidak boleh melewati barisnya -----
  // Pesannya wajib MENYEBUT angkanya: "melebihi pagu" tanpa angka memaksa orang
  // membuka layar lain untuk tahu berapa yang masih tersisa.
  await mustFail(c, 'total penugasan melebihi volume baris RAB DITOLAK (dengan angkanya)',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,9,$5)`,
    [CA, RAB6, ITEM_A, U_ADMIN, U_AGRO],
    /volume baris 10, sudah ditugaskan 2, sisa 8, diminta 9/s)

  // Menaikkan volume penugasan yang sudah ada tunduk pagu yang sama -- kalau
  // hanya INSERT yang digerbang, jalan pintasnya tinggal "buat kecil lalu ubah".
  await mustFail(c, 'MENAIKKAN volume penugasan sampai melewati pagu DITOLAK',
    `UPDATE app.budget_assignments SET volume = 11 WHERE id = $1`, [TUGAS_DEDE],
    /melebihi volume baris RAB/i)

  // --- Assignee: lintas entitas, peran yang tak bisa menutup tugasnya -------
  await mustFail(c, 'assignee dari entitas lain DITOLAK',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,1,$5)`,
    [CA, RAB6, ITEM_A, U_TENANT_B, U_AGRO], /tidak terdaftar di entitas ini/i)

  await mustFail(c, 'assignee berperan viewer DITOLAK (tugas yang tak akan pernah bisa ditutup)',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,1,$5)`,
    [CA, RAB6, ITEM_A, U_VIEWER, U_AGRO], /tidak boleh mencatat realisasi/i)

  // --- Volume nol / negatif ------------------------------------------------
  // "Nol kg KCL" bukan penugasan; volume negatif akan MENGEMBALIKAN jatah ke
  // baris RAB dan membuat pagu bisa dilewati lewat penjumlahan.
  await mustFail(c, 'penugasan bervolume 0 DITOLAK',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,0,$5)`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_AGRO], /volume_check|violates check/i)

  await mustFail(c, 'penugasan bervolume negatif DITOLAK',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,-5,$5)`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_AGRO], /volume_check|violates check/i)

  // --- Baris RAB milik RAB lain: ditutup composite FK, bukan trigger --------
  await mustFail(c, 'penugasan menunjuk baris RAB milik RAB lain DITOLAK',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,1,$5)`,
    [CA, RAB6, B_LAMA, U_CREATOR, U_AGRO], /bas_item_in_plan|violates foreign key/i)

  // --- creator = pencatat realisasi, bukan penugas --------------------------
  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'creator TIDAK bisa membuat penugasan',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,1,$5)`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_CREATOR], /row-level security/i)

  await as(U_VIEWER, 'viewer', CA)
  await mustFail(c, 'viewer TIDAK bisa membuat penugasan',
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,1,$5)`,
    [CA, RAB6, ITEM_A, U_CREATOR, U_VIEWER], /row-level security/i)

  // Penugasan kedua, untuk orang lain -- dipakai menguji penyempitan SELECT.
  await as(U_AGRO, 'agronomist', CA)
  const tugasAdmin = await c.query(
    `INSERT INTO app.budget_assignments (company_id, plan_id, plan_item_id, assignee_user_id,
       volume, created_by) VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
    [CA, RAB6, ITEM_A, U_ADMIN, U_AGRO])
  const TUGAS_ADMIN = tugasAdmin.rows[0].id

  // --- Penyempitan SELECT per penerima (sejajar B-23 / 0054) ---------------
  r = await c.query(`SELECT count(*)::int n FROM app.budget_assignments WHERE plan_id = $1`, [RAB6])
  ok('agronomist melihat SELURUH penugasan RAB entitasnya', r.rows[0].n === 2, `${r.rows[0].n} penugasan`)

  await as(U_CREATOR, 'creator', CA)
  r = await c.query(
    `SELECT count(*)::int n, count(*) FILTER (WHERE id = $2)::int mine
       FROM app.budget_assignments WHERE plan_id = $1`, [RAB6, TUGAS_DEDE])
  ok('creator HANYA melihat penugasan yang diberikan kepadanya',
    r.rows[0].n === 1 && r.rows[0].mine === 1, `${r.rows[0].n} penugasan terlihat`)

  await as(U_TENANT_B, 'creator', CB)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_assignments WHERE plan_id = $1`, [RAB6])
  ok('penugasan tenant A TIDAK terlihat oleh tenant B', r.rows[0].n === 0)

  // --- Apa yang boleh diubah PENERIMA tugas --------------------------------
  await as(U_CREATOR, 'creator', CA)
  await mustFail(c, 'penerima tugas TIDAK bisa menaikkan volumenya sendiri',
    `UPDATE app.budget_assignments SET volume = 8 WHERE id = $1`, [TUGAS_DEDE],
    /hanya boleh mengubah status dan catatan/i)

  await mustFail(c, 'penerima tugas TIDAK bisa membatalkan penugasannya (itu melepas anggaran)',
    `UPDATE app.budget_assignments SET status = 'cancelled' WHERE id = $1`, [TUGAS_DEDE],
    /wewenang penugas/i)

  const tandaiSelesai = await c.query(
    `UPDATE app.budget_assignments SET status = 'done' WHERE id = $1`, [TUGAS_DEDE])
  ok('penerima tugas BISA menandai tugasnya selesai', tandaiSelesai.rowCount === 1)

  // Diam, bukan melempar: baris lama bukan miliknya, jadi klausa USING
  // menyaringnya sebelum trigger mana pun sempat berbicara.
  const ambilAlih = await c.query(
    `UPDATE app.budget_assignments SET assignee_user_id = $2 WHERE id = $1`,
    [TUGAS_ADMIN, U_CREATOR])
  await as(U_AGRO, 'agronomist', CA)
  r = await c.query(`SELECT assignee_user_id FROM app.budget_assignments WHERE id = $1`, [TUGAS_ADMIN])
  ok('creator TIDAK bisa mengambil alih penugasan orang lain (nol baris, penerima utuh)',
    ambilAlih.rowCount === 0 && r.rows[0].assignee_user_id === U_ADMIN,
    `${ambilAlih.rowCount} baris, penerima ${r.rows[0].assignee_user_id === U_ADMIN ? 'utuh' : 'BERPINDAH'}`)

  // --- Tautan realisasi ----------------------------------------------------
  await as(U_CREATOR, 'creator', CA)
  const realisasi1 = await c.query(
    `INSERT INTO app.cost_transactions (company_id, cost_center_id, block_id, cost_category_id,
       transaction_date, quantity, unit, amount_idr, budget_assignment_id, created_by)
     VALUES ($1,$2,$3,$4,'2026-01-10',2,'kg',120000,$5,$6) RETURNING id, approval_status`,
    [CA, CC, A_BLK1, CAT, TUGAS_DEDE, U_CREATOR])
  const REAL1 = realisasi1.rows[0].id
  ok('Pak Dede BISA menaut realisasinya ke penugasan yang diberikan kepadanya',
    realisasi1.rowCount === 1 && realisasi1.rows[0].approval_status === 'draft')

  await mustFail(c, 'creator TIDAK bisa menaut realisasi ke penugasan orang lain',
    `INSERT INTO app.cost_transactions (company_id, cost_center_id, block_id, cost_category_id,
       transaction_date, amount_idr, budget_assignment_id, created_by)
     VALUES ($1,$2,$3,$4,'2026-01-11',50000,$5,$6)`,
    [CA, CC, A_BLK1, CAT, TUGAS_ADMIN, U_CREATOR], /diberikan kepada/i)

  await mustFail(c, 'creator TIDAK bisa MEMINDAHKAN realisasinya ke penugasan orang lain',
    `UPDATE app.cost_transactions SET budget_assignment_id = $2 WHERE id = $1`,
    [REAL1, TUGAS_ADMIN], /diberikan kepada/i)

  await as(U_TENANT_B, 'creator', CB)
  await mustFail(c, 'realisasi tenant B TIDAK bisa ditaut ke penugasan tenant A',
    `INSERT INTO app.cost_transactions (company_id, cost_center_id, block_id, cost_category_id,
       transaction_date, amount_idr, budget_assignment_id, created_by)
     VALUES ($1,$2,$3,$4,'2026-01-12',50000,$5,$6)`,
    [CB, CC, B_BLK1, CAT, TUGAS_DEDE, U_TENANT_B], /tidak ditemukan di entitas ini/i)

  // --- Serapan: hanya realisasi APPROVED yang dihitung ---------------------
  const serapan = async (itemId) => {
    const s = await c.query(
      `SELECT anggaran::text, ditugaskan::text, realisasi::text,
              belum_diputuskan::text, sisa::text
         FROM app.budget_absorption($1) WHERE item_id = $2`, [RAB6, itemId])
    return s.rows[0] ?? {}
  }

  await as(U_AGRO, 'agronomist', CA)
  let sA = await serapan(ITEM_A)
  ok('realisasi berstatus draft TIDAK dihitung sebagai serapan (realisasi NULL)',
    sA.realisasi === null && sA.belum_diputuskan === '120000.00',
    `realisasi ${sA.realisasi}, belum_diputuskan ${sA.belum_diputuskan}`)
  ok('sisa ikut NULL selama belum ada realisasi yang diputuskan (bukan "sisa = anggaran")',
    sA.sisa === null, `sisa ${sA.sisa}`)
  ok('ditugaskan menjumlahkan penugasan aktif (2 + 1)', Number(sA.ditugaskan) === 3, `${sA.ditugaskan}`)

  const sB = await serapan(ITEM_B)
  ok('baris tanpa realisasi tertaut mengembalikan NULL, BUKAN 0',
    sB.realisasi === null && sB.sisa === null && sB.ditugaskan === null,
    `realisasi ${sB.realisasi}, ditugaskan ${sB.ditugaskan}, sisa ${sB.sisa}`)

  await as(U_APPROVER, 'approver', CA)
  await c.query(
    `UPDATE app.cost_transactions SET approval_status = 'approved' WHERE id = $1`, [REAL1])

  await as(U_AGRO, 'agronomist', CA)
  sA = await serapan(ITEM_A)
  ok('realisasi berstatus approved DIHITUNG sebagai serapan',
    sA.realisasi === '120000.00' && sA.belum_diputuskan === null,
    `realisasi ${sA.realisasi}, belum_diputuskan ${sA.belum_diputuskan}`)
  ok('sisa = anggaran - realisasi (500.000 - 120.000)', Number(sA.sisa) === 380000, `sisa ${sA.sisa}`)

  // Serapan yang MELEWATI anggaran harus terlihat, bukan dijepit ke nol.
  await as(U_CREATOR, 'creator', CA)
  const realisasi2 = await c.query(
    `INSERT INTO app.cost_transactions (company_id, cost_center_id, block_id, cost_category_id,
       transaction_date, amount_idr, budget_assignment_id, created_by)
     VALUES ($1,$2,$3,$4,'2026-03-05',600000,$5,$6) RETURNING id`,
    [CA, CC, A_BLK1, CAT, TUGAS_DEDE, U_CREATOR])
  await as(U_APPROVER, 'approver', CA)
  await c.query(`UPDATE app.cost_transactions SET approval_status = 'approved' WHERE id = $1`,
    [realisasi2.rows[0].id])

  await as(U_AGRO, 'agronomist', CA)
  sA = await serapan(ITEM_A)
  ok('serapan melebihi anggaran terlihat sebagai sisa NEGATIF, tidak dijepit ke nol',
    Number(sA.realisasi) === 720000 && Number(sA.sisa) === -220000,
    `realisasi ${sA.realisasi}, sisa ${sA.sisa}`)

  // --- Penugasan yang sudah punya realisasi tidak boleh dihapus ------------
  // FK, bukan policy: pemeriksaan referensial berjalan di dalam mesin dan
  // melewati RLS, jadi realisasi yang tak terlihat si penghapus tetap menahan.
  await mustFail(c, 'penugasan yang sudah punya realisasi TIDAK bisa dihapus',
    `DELETE FROM app.budget_assignments WHERE id = $1`, [TUGAS_DEDE],
    /violates foreign key|ct_assignment_same_company/i)

  await as(U_CREATOR, 'creator', CA)
  const hapusSendiri = await c.query(
    `DELETE FROM app.budget_assignments WHERE id = $1`, [TUGAS_DEDE])
  await as(U_AGRO, 'agronomist', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.budget_assignments WHERE id = $1`, [TUGAS_DEDE])
  ok('penerima tugas TIDAK bisa menghapus penugasannya (nol baris, penugasan utuh)',
    hapusSendiri.rowCount === 0 && r.rows[0].n === 1,
    `${hapusSendiri.rowCount} baris terhapus, ${r.rows[0].n} tersisa`)

  // --- Kurva S -------------------------------------------------------------
  r = await c.query(`SELECT count(*)::int n FROM app.budget_s_curve($1)`, [RAB6])
  ok('kurva S mengembalikan NOL BARIS selama start_date RAB masih kosong',
    r.rows[0].n === 0, `${r.rows[0].n} baris — menebak titik nol adalah mengarang jadwal`)

  await as(U_APPROVER, 'approver', CA)
  await c.query(`UPDATE app.budget_plans SET start_date = '2026-01-01' WHERE id = $1`, [RAB6])

  await as(U_AGRO, 'agronomist', CA)
  const kurva = await c.query(
    `SELECT bulan_ke, rencana_kumulatif::text AS rencana, realisasi_kumulatif::text AS realisasi
       FROM app.budget_s_curve($1) ORDER BY bulan_ke`, [RAB6])
  const bulan = Object.fromEntries(kurva.rows.map(x => [x.bulan_ke, x]))
  ok('kurva S digambar setelah start_date ditetapkan (12 bulan sesuai horizon)',
    kurva.rows.length === 12, `${kurva.rows.length} baris`)
  ok('rencana kumulatif mengikuti phase_month (bulan 1: 500.000; bulan 3: 600.000)',
    Number(bulan[1]?.rencana) === 500000 && Number(bulan[3]?.rencana) === 600000,
    `b1 ${bulan[1]?.rencana}, b3 ${bulan[3]?.rencana}`)
  ok('realisasi kumulatif memakai indeks bulan dari start_date (b1 120.000, b3 720.000)',
    Number(bulan[1]?.realisasi) === 120000 && Number(bulan[3]?.realisasi) === 720000,
    `b1 ${bulan[1]?.realisasi}, b3 ${bulan[3]?.realisasi}`)
  ok('bulan tanpa belanja DI ANTARA data tetap membawa kumulatifnya (b2 = 120.000)',
    Number(bulan[2]?.realisasi) === 120000, `b2 ${bulan[2]?.realisasi}`)
  ok('setelah bulan terakhir yang berdata, realisasi kumulatif NULL — bukan garis datar',
    bulan[4]?.realisasi === null && bulan[12]?.realisasi === null
      && Number(bulan[12]?.rencana) === 600000,
    `b4 ${bulan[4]?.realisasi}, b12 ${bulan[12]?.realisasi}`)

  // --- Kontrol positif penutup --------------------------------------------
  const batal = await c.query(
    `UPDATE app.budget_assignments SET status = 'cancelled' WHERE id = $1`, [TUGAS_ADMIN])
  sA = await serapan(ITEM_A)
  ok('penugas BISA membatalkan penugasan, dan jatah volumenya kembali (3 → 2)',
    batal.rowCount === 1 && Number(sA.ditugaskan) === 2, `ditugaskan ${sA.ditugaskan}`)

  const hapusPenugas = await c.query(
    `DELETE FROM app.budget_assignments WHERE id = $1`, [TUGAS_ADMIN])
  ok('penugas BISA menghapus penugasan yang belum punya realisasi', hapusPenugas.rowCount === 1)

  r = await c.query(`SELECT count(*)::int n FROM app.check_budget_assignment_integrity()`)
  ok('check_budget_assignment_integrity() bersih', r.rows[0].n === 0)

  await c.query('ROLLBACK')
  await c.end()
  await restoreStubSwitch()
  console.log(`\n${'='.repeat(56)}\nADVERSARIAL:  PASS ${pass}   FAIL ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
run().catch(async e => {
  console.error('ERROR:', e.message)
  // Saklar login stub dikembalikan juga saat suite mati di tengah jalan --
  // kalau tidak, kegagalan di sini akan menular ke at:verify sebagai
  // "email tidak terdaftar".
  await restoreStubSwitch().catch(() => {})
  process.exit(1)
})
