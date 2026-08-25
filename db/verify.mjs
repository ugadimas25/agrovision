// Verifikasi SEBAGAI app_rw -- bukan superuser.
// Uji sebagai postgres hanya membuktikan sintaks DDL, bukan perilaku keamanan.
import pg from 'pg'

const SUPER = 'postgres://postgres:dev@localhost:55433/agrovision'
const APP = 'postgres://app_user:apppass@localhost:55433/agrovision'

const C1 = '11111111-1111-1111-1111-111111111111' // company A
const C2 = '11111111-1111-1111-1111-111111111112' // company B
const E1 = '22222222-2222-2222-2222-222222222221'
const E2 = '22222222-2222-2222-2222-222222222222'
const U_CREATOR = '33333333-3333-3333-3333-333333333331'
const U_APPROVER = '33333333-3333-3333-3333-333333333332'
const U_ADMIN = '33333333-3333-3333-3333-333333333333' // super_admin: satu-satunya yang boleh menyentuh tarif (K-06 Keputusan 3)

let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  PASS  ${n}${extra && ' — ' + extra}`)) : (fail++, console.log(`  FAIL  ${n}${extra && ' — ' + extra}`)) }

async function setup() {
  const c = new pg.Client({ connectionString: SUPER })
  await c.connect()
  // Role app_user dibuat `npm run db:bootstrap`, BUKAN di sini. Versi sebelumnya
  // melakukan DROP/CREATE ROLE dan menghapus pencabutan hak dari ledger 0019 --
  // tepat kelas bug yang ledger itu ada untuk mencegah.

  // Idempoten: suite ini berbagi database dengan db/verify-adversarial.mjs,
  // jadi fixture run sebelumnya dibersihkan lebih dulu, dalam urutan FK.
  for (const sql of [
    `DELETE FROM app.cost_transactions WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.budgets WHERE company_id IN ($1,$2)`,
    // price_list menunjuk companies; tanpa baris ini DELETE companies gagal FK
    // begitu bagian AI-44a di bawah pernah membuat satu baris tarif.
    `DELETE FROM app.price_list WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.land_suitability_assessments WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.evidence_verifications WHERE evidence_id IN (SELECT id FROM app.evidence_files WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.evidence_files WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.emission_factors WHERE code = 'EF-N2O'`,
    `DELETE FROM app.master_items WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.fiscal_periods WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.boundary_overlaps WHERE block_a_id IN (SELECT id FROM app.blocks WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.blocks WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.user_estate_access WHERE user_id IN (SELECT id FROM app.users WHERE company_id IN ($1,$2))`,
    `DELETE FROM app.user_company_access WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.audit_log WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.users WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.estates WHERE company_id IN ($1,$2)`,
    `DELETE FROM app.companies WHERE id IN ($1,$2)`,
  ]) await c.query(sql, sql.includes('$1') ? [C1, C2] : [])

  await c.query(`INSERT INTO app.companies (id,code,name) VALUES ($1,'A','PT A'),($2,'B','PT B')`, [C1, C2])
  await c.query(`INSERT INTO app.estates (id,company_id,code,name) VALUES ($1,$3,'E1','Estate 1'),($2,$4,'E2','Estate 2')`, [E1, E2, C1, C1])
  await c.query(`INSERT INTO app.users (id,company_id,external_id,email,full_name,app_role)
                 VALUES ($1,$4,'idp|c','c@x.co','Creator','creator'),
                        ($2,$4,'idp|a','a@x.co','Approver','approver'),
                        ($3,$4,'idp|s','s@x.co','Super','super_admin')`,
                [U_CREATOR, U_APPROVER, U_ADMIN, C1])
  // creator hanya boleh Estate 1
  await c.query(`INSERT INTO app.user_estate_access VALUES ($1,$2)`, [U_CREATOR, E1])
  // kedua user punya akses company A; approver JUGA company B (uji multi-tenant)
  await c.query(`INSERT INTO app.user_company_access (user_id,company_id) VALUES ($1,$4),($2,$4),($2,$5),($3,$4)
                 ON CONFLICT DO NOTHING`, [U_CREATOR, U_APPROVER, U_ADMIN, C1, C2])

  const g = (lon, lat) => `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat},${lon + 0.009} ${lat},${lon + 0.009} ${lat - 0.009},${lon} ${lat - 0.009},${lon} ${lat}))',4326))`
  await c.query(`INSERT INTO app.blocks (company_id,estate_id,code,geom,boundary_source)
                 VALUES ($1,$2,'BLK-E1',${g(114, -2)},'gps_survey'),
                        ($1,$3,'BLK-E2',${g(115, -3)},'gps_survey')`, [C1, E1, E2])
  // blok tanpa geom -- uji geom nullable
  await c.query(`INSERT INTO app.blocks (company_id,estate_id,code,boundary_source)
                 VALUES ($1,$2,'BLK-NOGEO','shapefile_import')`, [C1, E1])
  await c.query(`INSERT INTO app.evidence_files (company_id,evidence_type,file_name,storage_path,sha256)
                 VALUES ($1,'photo','r.jpg','gs://x/r.jpg','abc')`, [C1])
  await c.end()
}

async function run() {
  await setup()
  const c = new pg.Client({ connectionString: APP })
  await c.connect()

  const asUser = async (uid, role, companyId = null) => {
    await c.query(`SELECT set_config('app.current_user_id',$1,false)`, [uid])
    await c.query(`SELECT set_config('app.current_role',$1,false)`, [role])
    await c.query(`SELECT set_config('app.current_company_id',$1,false)`, [companyId ?? ''])
  }

  // Konteks WAJIB diset sebelum menyentuh tabel ber-RLS. Tanpa ini
  // company_in_scope() mengembalikan false dan semua query mengembalikan 0 baris --
  // yang justru bukti RLS aktif.
  await asUser(U_APPROVER, 'approver', C1)

  console.log('\n=== RLS aktif tanpa konteks? ===')
  await c.query(`SELECT set_config('app.current_user_id','',false)`)
  let r0 = await c.query(`SELECT count(*)::int n FROM app.blocks`)
  ok('tanpa konteks user, 0 baris terlihat', r0.rows[0].n === 0, `${r0.rows[0].n} baris`)
  await asUser(U_APPROVER, 'approver', C1)

  console.log('\n=== CACAT 1: emission_factor bisa di-supersede? ===')
  try {
    await c.query(`SELECT app.publish_emission_factor('EF-N2O','N2O pupuk',0.01,'kg','IPCC 2019 Vol.4 Ch.11','2024-01-01')`)
    await c.query(`SELECT app.publish_emission_factor('EF-N2O','N2O pupuk rev',0.012,'kg','IPCC 2019 Vol.4 Ch.11','2026-01-01')`)
    const r = await c.query(`SELECT version, valid_from, valid_to FROM app.emission_factors WHERE code='EF-N2O' ORDER BY version`)
    ok('versi 2 terbit lewat SECURITY DEFINER', r.rows.length === 2 && r.rows[0].valid_to !== null && r.rows[1].valid_to === null,
      `v1 ditutup ${r.rows[0]?.valid_to?.toISOString?.().slice(0, 10)}, v2 aktif`)
  } catch (e) { ok('versi 2 terbit', false, e.message) }

  try {
    await c.query(`UPDATE app.emission_factors SET value=9 WHERE code='EF-N2O'`)
    ok('UPDATE langsung tetap DITOLAK', false, 'seharusnya gagal tapi berhasil')
  } catch (e) { ok('UPDATE langsung tetap DITOLAK', /permission denied/i.test(e.message), 'append-only utuh') }

  console.log('\n=== CACAT 2: evidence bisa diverifikasi? ===')
  try {
    const ev = await c.query(`SELECT id FROM app.evidence_files LIMIT 1`)
    await c.query(`INSERT INTO app.evidence_verifications (evidence_id,outcome,verified_by) VALUES ($1,'verified',$2)`, [ev.rows[0].id, U_APPROVER])
    ok('verifikasi tercatat', true)
  } catch (e) { ok('verifikasi tercatat', false, e.message) }
  try {
    await c.query(`INSERT INTO app.evidence_verifications (evidence_id,outcome)
                   SELECT id,'rejected' FROM app.evidence_files LIMIT 1`)
    ok('reject tanpa alasan DITOLAK', false, 'seharusnya gagal')
  } catch (e) { ok('reject tanpa alasan DITOLAK', /ev_rejected_needs_note/.test(e.message)) }

  console.log('\n=== CACAT 3: RLS creator dibatasi per estate? ===')
  await asUser(U_CREATOR, 'creator', C1)
  let r = await c.query(`SELECT code FROM app.blocks ORDER BY code`)
  const seen = r.rows.map(x => x.code)
  ok('creator HANYA lihat blok Estate 1', seen.length === 2 && !seen.includes('BLK-E2'), `lihat: ${seen.join(',') || '(kosong)'}`)

  await asUser(U_APPROVER, 'approver', C1)
  r = await c.query(`SELECT code FROM app.blocks ORDER BY code`)
  ok('approver lihat semua blok company A', r.rows.length === 3, `lihat ${r.rows.length} blok`)

  console.log('\n=== MULTI-TENANCY ===')
  await asUser(U_APPROVER, 'approver', null)
  r = await c.query(`SELECT count(*)::int n FROM app.companies WHERE app.company_in_scope(id)`)
  ok('approver akses 2 entitas (mode semua)', r.rows[0].n === 2, `${r.rows[0].n} entitas`)
  await asUser(U_CREATOR, 'creator', null)
  r = await c.query(`SELECT count(*)::int n FROM app.companies WHERE app.company_in_scope(id)`)
  ok('creator akses 1 entitas', r.rows[0].n === 1, `${r.rows[0].n} entitas`)
  await asUser(U_CREATOR, 'creator', C2)
  r = await c.query(`SELECT count(*)::int n FROM app.blocks`)
  ok('creator TIDAK bisa pinjam company B', r.rows[0].n === 0, `${r.rows[0].n} blok`)

  console.log('\n=== geom NULLABLE + area_ha generated ===')
  await asUser(U_APPROVER, 'approver', C1)
  r = await c.query(`SELECT code, area_ha FROM app.blocks ORDER BY code`)
  const nogeo = r.rows.find(x => x.code === 'BLK-NOGEO')
  const withgeo = r.rows.find(x => x.code === 'BLK-E1')
  ok('blok tanpa geom terdaftar, area_ha NULL', nogeo && nogeo.area_ha === null)
  ok('blok bergeom, area_ha terhitung', withgeo && Math.abs(Number(withgeo.area_ha) - 99.64) < 0.5, `${withgeo?.area_ha} ha`)

  console.log('\n=== ENUM sudah Inggris ===')
  r = await c.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                     WHERE t.typname IN ('tree_condition','growth_phase','field_type','priority','evidence_type')
                       AND enumlabel ~ '^(baik|sedang|buruk|mati|bibit|vegetatif|produktif|teks|angka|tanggal|foto|dokumen|rendah|tinggi|tanda_tangan)$'`)
  ok('tidak ada sisa label Indonesia', r.rows.length === 0, r.rows.map(x => x.enumlabel).join(',') || 'bersih')

  console.log('\n=== AT3: cost per ha & budget vs actual dari view ===')
  const blk = (await c.query(`SELECT id, area_ha FROM app.blocks WHERE code='BLK-E1'`)).rows[0]
  await c.query(`INSERT INTO app.master_items (master_type_id,company_id,code,name)
                 SELECT id,$1,'SEEDLING','Pengadaan Bibit' FROM app.master_types WHERE code='cost_category'`, [C1])
  const cat = (await c.query(`SELECT id FROM app.master_items WHERE code='SEEDLING'`)).rows[0]
  await c.query(`INSERT INTO app.fiscal_periods (company_id,code,name,starts_on,ends_on)
                 VALUES ($1,'PHASE-1','Fase 1','2026-01-01','2026-12-31')`, [C1])
  const per = (await c.query(`SELECT id FROM app.fiscal_periods WHERE code='PHASE-1'`)).rows[0]
  const cc = (await c.query(
    `INSERT INTO app.cost_centers (code,name) VALUES ('PLT-HP','Plantation')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`)).rows[0]
  await c.query(`INSERT INTO app.budgets (company_id,fiscal_period_id,cost_category_id,scope_type,block_id,amount_idr)
                 VALUES ($1,$2,$3,'block',$4,10000000)`, [C1, per.id, cat.id, blk.id])
  for (const amt of [3000000, 4000000, 5000000]) {
    await c.query(`INSERT INTO app.cost_transactions
      (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status,created_by)
      VALUES ($1,$2,$3,$4,$5,'2026-03-01',$6,'approved',$7)`, [C1, cc.id, blk.id, cat.id, per.id, amt, U_APPROVER])
  }
  r = await c.query(`SELECT total_cost_idr, cost_per_ha_idr FROM app.v_block_cost_summary WHERE block_id=$1`, [blk.id])
  const total = Number(r.rows[0].total_cost_idr), cph = Number(r.rows[0].cost_per_ha_idr)
  ok('total 3 pengeluaran = 12.000.000', total === 12000000, total.toLocaleString('id-ID'))
  ok('cost per ha dihitung dari area_ha', Math.abs(cph - total / Number(blk.area_ha)) < 1, `Rp ${Math.round(cph).toLocaleString('id-ID')}/ha`)
  r = await c.query(`SELECT budget_idr,actual_idr,remaining_idr,is_over_budget FROM app.v_budget_vs_actual WHERE block_id=$1`, [blk.id])
  ok('budget vs actual bergerak', Number(r.rows[0].actual_idr) === 12000000 && r.rows[0].is_over_budget === true,
    `anggaran 10jt, aktual 12jt, over=${r.rows[0].is_over_budget}`)

  console.log('\n=== AT4: record rejected dikecualikan dari laporan ===')
  await c.query(`INSERT INTO app.cost_transactions
    (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status,rejection_reason)
    VALUES ($1,$2,$3,$4,$5,'2026-03-02',9999999,'rejected','Foto struk tidak terbaca')`, [C1, cc.id, blk.id, cat.id, per.id])
  r = await c.query(`SELECT total_cost_idr FROM app.v_block_cost_summary WHERE block_id=$1`, [blk.id])
  ok('rejected TIDAK masuk total', Number(r.rows[0].total_cost_idr) === 12000000, `tetap ${Number(r.rows[0].total_cost_idr).toLocaleString('id-ID')}`)
  try {
    await c.query(`INSERT INTO app.cost_transactions
      (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status)
      VALUES ($1,$2,$3,$4,$5,'2026-03-03',100,'rejected')`, [C1, cc.id, blk.id, cat.id, per.id])
    ok('reject tanpa alasan DITOLAK', false, 'seharusnya gagal')
  } catch (e) { ok('reject tanpa alasan DITOLAK', /ct_rejection_needs_reason/.test(e.message)) }

  console.log('\n=== Constraint overhead vs per-blok ===')
  try {
    await c.query(`INSERT INTO app.cost_transactions
      (company_id,cost_center_id,block_id,cost_category_id,transaction_date,amount_idr,is_overhead)
      VALUES ($1,$2,$3,$4,'2026-03-04',500,true)`, [C1, cc.id, blk.id, cat.id])
    ok('overhead + block_id DITOLAK', false, 'seharusnya gagal')
  } catch (e) { ok('overhead + block_id DITOLAK', /ct_overhead_scope/.test(e.message)) }

  console.log('\n=== Laporan sebagai BARIS definisi ===')
  r = await c.query(`SELECT code,is_stub FROM app.report_definitions WHERE is_builtin ORDER BY code`)
  ok('3 laporan built-in sebagai baris', r.rows.length === 3, r.rows.map(x => `${x.code}${x.is_stub ? '(stub)' : ''}`).join(' '))

  console.log('\n=== A3 satu penilaian AKTIF per blok PER KOMODITAS (K-04, migrasi 0044) ===')
  // Kontrak ini BERUBAH di 0044. Indeks lama `lsa_one_per_block` hanya memakai
  // block_id, sehingga blok yang sudah dinilai untuk durian tidak bisa dinilai
  // untuk kelapa -- padahal 0028 menyeed kriteria per komoditas justru untuk
  // dibandingkan. Itu bug (akar QA B-08), bukan aturan bisnis; docs/13 §16
  // menggantinya dengan: satu penilaian AKTIF (approved & belum digeser) per
  // (block_id, crop_id). Draft ganda kini SAH -- creator harus bisa memperbaiki
  // salah input tanpa minta approver menolak dulu.
  const crops = await c.query(`SELECT id, code FROM app.crops ORDER BY code`)
  const cropA = crops.rows[0], cropB = crops.rows[1]

  const lsaIns = `INSERT INTO app.land_suitability_assessments
                    (block_id, crop_id, assessed_at, approval_status)
                  VALUES ($1,$2,now(),$3)`
  await c.query(lsaIns, [blk.id, cropA.id, 'draft'])
  await c.query(lsaIns, [blk.id, cropA.id, 'draft'])
  ok('dua DRAFT komoditas sama BOLEH (koreksi salah input, B-08)', true, cropA.code)

  await c.query(lsaIns, [blk.id, cropA.id, 'approved'])
  try {
    await c.query(lsaIns, [blk.id, cropA.id, 'approved'])
    ok('penilaian AKTIF kedua komoditas sama DITOLAK', false, 'seharusnya gagal')
  } catch (e) {
    ok('penilaian AKTIF kedua komoditas sama DITOLAK',
       /lsa_one_active_per_block_crop/.test(e.message), e.message.slice(0, 60))
  }

  await c.query(lsaIns, [blk.id, cropB.id, 'approved'])
  ok('blok yang sama BOLEH dinilai komoditas berbeda (K-04)', true,
     `${cropA.code} + ${cropB.code}`)

  console.log('\n=== Jadwal penyiangan (0051) ===')
  await asUser(U_APPROVER, 'approver', C1)
  await c.query(`INSERT INTO app.weeding_schedules (company_id, block_id, interval_day, tolerance_day, created_by)
                 VALUES ($1,$2,30,7,$3)`, [C1, blk.id, U_APPROVER])
  ok('approver bisa menyetel jadwal penyiangan', true, '30 hari, toleransi 7')

  // Satu jadwal AKTIF per blok: dua yang aktif membuat laporan memilih berdasarkan
  // urutan baris (pelajaran indeks 0046 pada price_list).
  try {
    await c.query(`INSERT INTO app.weeding_schedules (company_id, block_id, interval_day, created_by)
                   VALUES ($1,$2,45,$3)`, [C1, blk.id, U_APPROVER])
    ok('jadwal AKTIF kedua untuk blok sama DITOLAK', false, 'berhasil padahal seharusnya ditolak')
  } catch (e) {
    ok('jadwal AKTIF kedua untuk blok sama DITOLAK',
       /ws_one_active_per_block/.test(e.message), e.message.slice(0, 60))
  }

  // Cek "blok entitas lain" ADA di db/verify-adversarial.mjs, bukan di sini:
  // entitas C2 pada fixture ini tidak punya blok, jadi cek bersyarat di sini akan
  // diam-diam dilompati — dan cek yang dilompati tanpa suara lebih buruk daripada
  // tidak ada cek, karena hitungan PASS-nya tetap terlihat naik.

  // Interval nol/negatif tidak bermakna.
  try {
    await c.query(`INSERT INTO app.weeding_schedules (company_id, block_id, interval_day, created_by)
                   VALUES ($1,$2,0,$3)`, [C1, blk.id, U_APPROVER])
    ok('interval 0 hari DITOLAK', false, 'diterima')
  } catch (e) {
    ok('interval 0 hari DITOLAK', /ws_interval_positive|ws_one_active/.test(e.message), e.message.slice(0, 60))
  }

  // =========================================================================
  // Temuan telaah adversarial 0041–0047 (24 Agu 2026).
  // Keputusan pemilik produk: TAMPILKAN, jangan blokir.
  // =========================================================================
  console.log('\n=== Temuan telaah adversarial: biaya tak cocok & koreksi tarif ===')
  await asUser(U_APPROVER, 'approver', C1)

  // Biaya approved TANPA kategori harus terdaftar sebagai "belum bisa dibandingkan",
  // bukan hilang tanpa jejak dari perbandingan anggaran.
  //
  // source_table WAJIB diisi: CHECK ct_category_required (0044) menuntut biaya
  // MANUAL selalu berkategori, jadi kategori NULL hanya bisa lahir dari
  // materialisasi. Itu persis kasus nyatanya — tarif nonaktif saat approval.
  await c.query(`INSERT INTO app.cost_transactions
    (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status,created_by,source_table,source_record_id)
    VALUES ($1,$2,$3,NULL,$4,'2026-03-09',2000000,'approved',$5,'weeding_records',gen_random_uuid())`,
    [C1, cc.id, blk.id, per.id, U_APPROVER])
  r = await c.query(`SELECT reason FROM app.v_cost_unmatched WHERE company_id=$1 AND amount_idr=2000000`, [C1])
  ok('biaya tanpa kategori terdaftar sebagai tak-cocok', r.rows[0]?.reason === 'kategori belum dipetakan',
     r.rows[0]?.reason ?? 'TIDAK TERDAFTAR')

  // Tanpa periode fiskal: alasannya berbeda, dan nilainya tetap terlihat.
  await c.query(`INSERT INTO app.cost_transactions
    (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status,created_by)
    VALUES ($1,$2,$3,$4,NULL,'2026-03-10',3000000,'approved',$5)`,
    [C1, cc.id, blk.id, cat.id, U_APPROVER])
  // catatan: yang ini berkategori, jadi ct_category_required lolos tanpa source_table.
  r = await c.query(`SELECT reason FROM app.v_cost_unmatched WHERE company_id=$1 AND amount_idr=3000000`, [C1])
  ok('biaya di luar periode terdaftar sebagai tak-cocok', r.rows[0]?.reason === 'di luar periode anggaran',
     r.rows[0]?.reason ?? 'TIDAK TERDAFTAR')

  // Isolasi tenant: view baru WAJIB security_invoker, kalau tidak satu tenant
  // melihat biaya tenant lain.
  r = await c.query(`SELECT reloptions FROM pg_class WHERE oid='app.v_cost_unmatched'::regclass`)
  ok('v_cost_unmatched security_invoker aktif',
     (r.rows[0]?.reloptions ?? []).includes('security_invoker=true'), String(r.rows[0]?.reloptions))

  // Koreksi tarif pada hari penerbitannya (migrasi 0049) -- lihat bagian K-09 di
  // bawah untuk fixture tarifnya; di sini yang diuji SEMANTIKnya.
  await asUser(U_ADMIN, 'super_admin', C1)
  await c.query(`SELECT app.publish_price(
                   p_code => 'UJI-KOREKSI', p_rate_idr => 100, p_valid_from => (now() AT TIME ZONE 'Asia/Jakarta')::date,
                   p_unit => 'ha', p_kind => 'cost', p_category => 'Uji koreksi')`)
  await c.query(`SELECT app.publish_price('UJI-KOREKSI', 175, (now() AT TIME ZONE 'Asia/Jakarta')::date)`)
  r = await c.query(`SELECT count(*)::int n, max(rate_idr)::float8 rate FROM app.price_list
                      WHERE company_id=$1 AND code='UJI-KOREKSI'`, [C1])
  ok('koreksi tarif hari yang sama MENIMPA, tidak menambah versi',
     r.rows[0].n === 1 && r.rows[0].rate === 175, `${r.rows[0].n} versi, tarif ${r.rows[0].rate}`)

  // Yang TIDAK boleh: menyentuh versi yang mulai tanggal lain.
  await c.query(`SELECT app.publish_price('UJI-KOREKSI', 200,
                   ((now() AT TIME ZONE 'Asia/Jakarta')::date + 1))`)
  try {
    await c.query(`SELECT app.publish_price('UJI-KOREKSI', 999,
                     ((now() AT TIME ZONE 'Asia/Jakarta')::date - 30))`)
    ok('backdating ke tanggal lain tetap DITOLAK', false, 'diterima padahal seharusnya ditolak')
  } catch (e) {
    ok('backdating ke tanggal lain tetap DITOLAK', /backdating dilarang/.test(e.message), e.message.slice(0, 60))
  }

  // =========================================================================
  // AI-44a / K-09 §19: tiga kelas field pada price_list.
  //
  // Sebelum ini tidak ada jalur create sama sekali (INSERT hanya di seed-demo),
  // jadi belum ada satu pun cek yang membuktikan kelas mana yang boleh berubah.
  // Yang dibuktikan di sini persis daftar "Cara membuktikan" §19.
  // =========================================================================
  // =========================================================================
  // Realisasi digulung ke kategori INDUK (migrasi 0047, QA B-20).
  //
  // Keputusan pemilik produk: anggaran dikelola di tingkat induk, tapi biaya
  // dicatat di tingkat ANAK. Sebelum 0047 keduanya tidak pernah berpotongan dan
  // actual_idr selalu NULL -- "realisasi anggaran selalu 0".
  // =========================================================================
  console.log('\n=== Realisasi digulung ke kategori INDUK (0047, B-20) ===')
  const anak = (await c.query(
    `INSERT INTO app.master_items (master_type_id, company_id, code, name, parent_id)
     SELECT mt.id, $1, 'SEEDLING-SUB', 'Bibit Durian', $2 FROM app.master_types mt
      WHERE mt.code = 'cost_category' RETURNING id`, [C1, cat.id])).rows[0]

  // Anggaran per BLOK sudah ada di kategori INDUK (10 jt) dengan realisasi 12 jt.
  // Satu transaksi lagi, kali ini dicatat di ANAK-nya.
  await c.query(`INSERT INTO app.cost_transactions
    (company_id,cost_center_id,block_id,cost_category_id,fiscal_period_id,transaction_date,amount_idr,approval_status,created_by)
    VALUES ($1,$2,$3,$4,$5,'2026-03-05',1500000,'approved',$6)`,
    [C1, cc.id, blk.id, anak.id, per.id, U_APPROVER])
  r = await c.query(`SELECT actual_idr::float8 a FROM app.v_budget_vs_actual WHERE block_id=$1`, [blk.id])
  ok('biaya di kategori ANAK ikut dihitung pada anggaran INDUK',
     r.rows[0]?.a === 13500000, `Rp ${(r.rows[0]?.a ?? 0).toLocaleString('id-ID')} (12jt induk + 1,5jt anak)`)

  // Arah gulungnya SATU arah: anggaran di tingkat anak tidak boleh menyerap
  // saudara-saudaranya. Anggaran baru di ANAK, lingkup blok yang sama.
  const anak2 = (await c.query(
    `INSERT INTO app.master_items (master_type_id, company_id, code, name, parent_id)
     SELECT mt.id, $1, 'SEEDLING-SUB2', 'Bibit Kelapa', $2 FROM app.master_types mt
      WHERE mt.code = 'cost_category' RETURNING id`, [C1, cat.id])).rows[0]
  await c.query(`INSERT INTO app.budgets (company_id,fiscal_period_id,cost_category_id,scope_type,block_id,amount_idr)
                 VALUES ($1,$2,$3,'block',$4,9000000)`, [C1, per.id, anak2.id, blk.id])
  r = await c.query(`SELECT actual_idr FROM app.v_budget_vs_actual
                      WHERE block_id=$1 AND cost_category_id=$2`, [blk.id, anak2.id])
  ok('anggaran di tingkat ANAK tidak menyerap biaya saudaranya',
     r.rows[0]?.actual_idr === null, `actual_idr = ${r.rows[0]?.actual_idr ?? 'NULL'}`)

  // security_invoker WAJIB masih menyala: CREATE OR REPLACE VIEW menjatuhkannya.
  r = await c.query(`SELECT reloptions FROM pg_class WHERE oid='app.v_budget_vs_actual'::regclass`)
  ok('v_budget_vs_actual tetap security_invoker sesudah ditulis ulang',
     (r.rows[0]?.reloptions ?? []).includes('security_invoker=true'),
     String(r.rows[0]?.reloptions))

  console.log('\n=== AI-44a jalur create + tiga kelas field (K-09 §19) ===')
  await asUser(U_ADMIN, 'super_admin', C1)

  await c.query(`SELECT app.publish_price(
                   p_code => 'UJI-WEED', p_rate_idr => 750000, p_valid_from => '2026-01-01',
                   p_unit => 'ha', p_kind => 'cost', p_category => 'Penyiangan uji',
                   p_driver => 'weeding_area_ha')`)
  let pr = await c.query(`SELECT id, version, valid_to, is_active, driver, unit, rate_idr
                            FROM app.price_list WHERE company_id=$1 AND code='UJI-WEED'`, [C1])
  ok('super_admin bisa MEMBUAT baris tarif baru', pr.rows.length === 1,
     pr.rows.length ? `versi ${pr.rows[0].version}, valid_to ${pr.rows[0].valid_to ?? 'NULL'}` : 'tidak ada baris')

  const priceId = pr.rows[0]?.id

  // Kelas KEKAL: code, kind, driver. app_rw tidak punya UPDATE pada price_list
  // (ledger 0041 §7), jadi yang membuktikan kekalnya adalah revocation itu --
  // bukan sekadar kesepakatan lapisan aplikasi.
  const kekal = [['code', `code='UJI-WEED-2'`], ['kind', `kind='revenue'`], ['driver', `driver='block_area_ha'`]]
  for (const [nama, setSql] of kekal) {
    try {
      await c.query(`UPDATE app.price_list SET ${setSql} WHERE id=$1`, [priceId])
      ok(`ubah ${nama} langsung DITOLAK`, false, 'UPDATE berhasil padahal seharusnya ditolak')
    } catch (e) {
      ok(`ubah ${nama} langsung DITOLAK`, /permission denied|row-level security/i.test(e.message),
         e.message.slice(0, 60))
    }
  }

  // Kelas BERVERSI: rate_idr + unit hanya lewat publish_price.
  try {
    await c.query(`UPDATE app.price_list SET rate_idr=1 WHERE id=$1`, [priceId])
    ok('ubah rate_idr langsung (bukan publish_price) DITOLAK', false, 'UPDATE berhasil')
  } catch (e) {
    ok('ubah rate_idr langsung (bukan publish_price) DITOLAK',
       /permission denied|row-level security/i.test(e.message), e.message.slice(0, 60))
  }
  await c.query(`SELECT app.publish_price('UJI-WEED', 825000, '2026-08-01')`)
  pr = await c.query(`SELECT version, rate_idr::float8 r, valid_from, valid_to
                        FROM app.price_list WHERE company_id=$1 AND code='UJI-WEED' ORDER BY version`, [C1])
  ok('publish_price menutup versi lama dan membuka versi baru',
     pr.rows.length === 2 && pr.rows[0].valid_to !== null && pr.rows[1].valid_to === null,
     pr.rows.map(x => `v${x.version} ${x.r}`).join(' → '))
  // Inti K-02: harga historis TIDAK ikut berubah.
  let at = await c.query(`SELECT rate_idr::float8 r FROM app.price_at('UJI-WEED','2026-03-01',$1)`, [C1])
  ok('tarif per tanggal LAMA tetap nilai lama', at.rows[0]?.r === 750000, `Rp ${at.rows[0]?.r}`)
  at = await c.query(`SELECT rate_idr::float8 r FROM app.price_at('UJI-WEED','2026-08-15',$1)`, [C1])
  ok('tarif per tanggal BARU memakai nilai baru', at.rows[0]?.r === 825000, `Rp ${at.rows[0]?.r}`)

  // Indeks 0046: satu tarif AKTIF per (entitas, driver, bahan). Tanpa ini
  // app.price_for_driver() memilih pemenang berdasarkan urutan KODE.
  try {
    await c.query(`SELECT app.publish_price(
                     p_code => 'UJI-WEED-LAIN', p_rate_idr => 1, p_valid_from => '2026-09-01',
                     p_unit => 'ha', p_kind => 'cost', p_category => 'Penyiangan dobel',
                     p_driver => 'weeding_area_ha')`)
    ok('tarif AKTIF kedua untuk driver sama DITOLAK', false, 'berhasil padahal seharusnya ditolak')
  } catch (e) {
    ok('tarif AKTIF kedua untuk driver sama DITOLAK',
       /price_list_one_active_per_driver_idx/.test(e.message), e.message.slice(0, 70))
  }

  // Kelas EDIT IN-PLACE: category/note/is_active lewat update_price_meta, dan
  // menonaktifkan baris lama HARUS membebaskan drivernya (aturan K-09 "driver
  // salah = baris baru + baris lama is_active false").
  await c.query(`SELECT app.update_price_meta($1, p_category => 'Penyiangan (label diperbaiki)')`, [priceId])
  pr = await c.query(`SELECT DISTINCT category FROM app.price_list WHERE company_id=$1 AND code='UJI-WEED'`, [C1])
  ok('category bisa diedit in-place, ke SEMUA versi',
     pr.rows.length === 1 && pr.rows[0].category === 'Penyiangan (label diperbaiki)', pr.rows[0]?.category)

  await c.query(`SELECT app.update_price_meta($1, p_is_active => false)`, [priceId])
  await c.query(`SELECT app.publish_price(
                   p_code => 'UJI-WEED-BARU', p_rate_idr => 900000, p_valid_from => '2026-09-01',
                   p_unit => 'ha', p_kind => 'cost', p_category => 'Penyiangan pengganti',
                   p_driver => 'weeding_area_ha')`)
  pr = await c.query(`SELECT count(*)::int n FROM app.price_list
                       WHERE company_id=$1 AND code='UJI-WEED-BARU'`, [C1])
  ok('nonaktifkan baris lama MEMBEBASKAN drivernya untuk baris baru', pr.rows[0].n === 1)

  // =========================================================================
  // B-27: dua mode login, dan saklar yang membedakannya
  //
  // Sisi "harus ditolak" ada di db/verify-adversarial.mjs. Di sini sisi
  // sebaliknya: saat saklar menyala, stub memang bekerja DAN gerbang produksi
  // memang melaporkannya; saat mati, keduanya berbalik. Tanpa pasangan ini,
  // "gerbang bersih" bisa berarti "gerbangnya memang tidak pernah melihat".
  // =========================================================================
  console.log('\n=== B-27: gerbang login stub (app.auth_settings) ===')
  const su = new pg.Client({ connectionString: SUPER })
  await su.connect()
  const stubBefore = (await su.query(`SELECT stub_login_enabled FROM app.auth_settings WHERE singleton`))
    .rows[0]?.stub_login_enabled === true
  const setStub = (v) => su.query(`UPDATE app.auth_settings SET stub_login_enabled = $1 WHERE singleton`, [v])

  let ar = await c.query(`SELECT count(*)::int n FROM app.auth_settings`)
  ok('app.auth_settings persis satu baris (PK konstan + CHECK)', ar.rows[0].n === 1, `${ar.rows[0].n} baris`)

  await setStub(true)
  ar = await c.query(`SELECT external_id FROM app.lookup_login_stub('c@x.co')`)
  ok('saklar ON: lookup_login_stub memetakan email -> external_id',
    ar.rows[0]?.external_id === 'idp|c', ar.rows[0]?.external_id ?? 'kosong')

  ar = await c.query(`SELECT external_id FROM app.lookup_login_stub('bukan-siapa-siapa@x.co')`)
  ok('email tak terdaftar mengembalikan nol baris, bukan galat', ar.rows.length === 0)

  ar = await c.query(`SELECT detail FROM app.check_production_readiness()
                       WHERE blocking AND item = 'login stub masih aktif'`)
  ok('saklar ON dilaporkan sebagai PENGHALANG produksi', ar.rows.length === 1,
    ar.rows[0]?.detail ?? 'tidak dilaporkan')

  await setStub(false)
  try {
    await c.query(`SELECT external_id FROM app.lookup_login_stub('c@x.co')`)
    ok('saklar OFF: lookup_login_stub ditolak', false, 'berhasil padahal seharusnya ditolak')
  } catch (e) {
    ok('saklar OFF: lookup_login_stub ditolak', /login stub dimatikan/.test(e.message), e.message.slice(0, 70))
  }

  ar = await c.query(`SELECT item FROM app.check_production_readiness() WHERE blocking AND item LIKE 'login stub%'`)
  ok('saklar OFF: penghalang login hilang dari gerbang produksi', ar.rows.length === 0,
    ar.rows.map(x => x.item).join(' | ') || 'bersih')

  ar = await c.query(`SELECT user_id FROM app.resolve_session('idp|c')`)
  ok('jalur produksi (klaim sub -> resolve_session) tidak bergantung pada saklar',
    ar.rows[0]?.user_id === U_CREATOR)

  ar = await c.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE n.nspname = 'app' AND p.proname = 'lookup_login_email'`)
  ok('fungsi stub warisan app.lookup_login_email sudah dihapus (0057)', ar.rows.length === 0)

  // Dipulihkan: db:test dan at:verify berbagi database, dan suite HTTP itu
  // masuk lewat login stub.
  await setStub(stubBefore)
  await su.end()

  await c.end()
  console.log(`\n${'='.repeat(52)}\nPASS ${pass}   FAIL ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
