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

async function setup() {
  const c = new pg.Client({ connectionString: SUPER })
  await c.connect()
  const q = (s, p) => c.query(s, p)

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
  await q(`INSERT INTO app.users (id,company_id,external_id,email,full_name,role,app_role) VALUES
      ($1,$6,'idp|cr','cr@a.co','Creator A','surveyor','creator'),
      ($2,$6,'idp|ap','ap@a.co','Approver A','approver','approver'),
      ($3,$6,'idp|vw','vw@a.co','Viewer A','manager','viewer'),
      ($4,$6,'idp|ad','ad@a.co','Admin A','admin','super_admin'),
      ($5,$7,'idp|tb','tb@b.co','User B','surveyor','creator')`,
    [U_CREATOR, U_APPROVER, U_VIEWER, U_ADMIN, U_TENANT_B, CA, CB])
  await q(`INSERT INTO app.user_company_access (user_id,company_id) VALUES ($1,$5),($2,$5),($3,$5),($4,$5),($6,$7) ON CONFLICT DO NOTHING`,
    [U_CREATOR, U_APPROVER, U_VIEWER, U_ADMIN, CA, U_TENANT_B, CB])
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

  console.log('\n=== Isolasi tenant: tenant A tidak melihat apa pun milik B ===')
  await as(U_APPROVER, 'approver', CA)
  r = await c.query(`SELECT count(*)::int n FROM app.blocks WHERE company_id=$1`, [CB])
  ok('blok tenant B tak terlihat', r.rows[0].n === 0)
  r = await c.query(`SELECT count(*)::int n FROM app.users`)
  ok('user tenant B tak terlihat', r.rows[0].n === 4, `${r.rows[0].n} user (4 milik A)`)
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

  await c.query('ROLLBACK')
  await c.end()
  console.log(`\n${'='.repeat(56)}\nADVERSARIAL:  PASS ${pass}   FAIL ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
