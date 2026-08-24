#!/usr/bin/env node
/**
 * Data DEMO — untuk menilai tampilan, bukan untuk produksi.
 *
 * Entitasnya ditandai `companies.is_demo = true`, sehingga
 * app.check_production_readiness() melaporkannya sebagai PENGHALANG produksi.
 * Itu disengaja: data contoh boleh ada, tapi tidak boleh terbawa diam-diam ke
 * lingkungan sungguhan dan disangka nyata.
 *
 *   npm run db:seed:demo    tambahkan data demo
 *   npm run db:purge:demo   hapus seluruhnya (DEMO + DEMO2)
 *
 * Seed ini membuat DUA entitas demo: 'DEMO' (Kalimantan Tengah, data lengkap)
 * dan 'DEMO2' (Mamuju, data minimal). Hanya admin@demo.invalid yang diberi akses
 * ke keduanya -- itu yang memunculkan switcher entitas di Topbar dan membuat uji
 * isolasi tenant (QA A-07) bisa dijalankan sungguhan.
 *
 * Komponen biaya mengikuti docs/00-refinement-concept.md:158 — delapan
 * kategori yang klien sebut sendiri, beserta sub-kategorinya.
 *
 * Angka biaya di sini ILUSTRATIF. Ia tidak berasal dari data lapangan mana pun
 * dan tidak boleh dipakai sebagai acuan anggaran.
 */

import pg from 'pg'

const url = process.env.MIGRATION_DATABASE_URL
if (!url) { console.error('MIGRATION_DATABASE_URL wajib.'); process.exit(1) }
const PURGE = process.argv.includes('--purge')

const CO = '00000000-0000-4000-8000-0000000000d0'
// Entitas demo KEDUA -- ada khusus supaya isolasi tenant bisa diuji (QA A-07).
// Lihat blok "ENTITAS KEDUA" di bagian akhir seed().
const CO2 = '00000000-0000-4000-8000-0000000000d1'

// ---------------------------------------------------------------------------
// Komponen biaya perkebunan (concept:158)
// ---------------------------------------------------------------------------
const COST_TREE = [
  ['SEEDLING', 'Pengadaan Bibit', ['Bibit Durian', 'Bibit Kelapa', 'Polybag & Media', 'Transport Bibit']],
  ['LANDPREP', 'Persiapan Lahan', ['Land Clearing', 'Pembuatan Lubang Tanam', 'Pembuatan Teras', 'Jalan & Drainase']],
  ['FERTILIZER', 'Pengadaan Pupuk', ['Pupuk Tunggal', 'Pupuk Majemuk', 'Pupuk Organik', 'Kapur / Dolomit']],
  ['TOOLS', 'Alat & Mekanisasi', ['Alat Tangan', 'Sewa Alat Berat', 'Mesin Potong', 'Sparepart']],
  ['VEHICLE', 'Kendaraan & Bahan Bakar', ['Solar', 'Bensin', 'Oli & Pelumas', 'Sewa Kendaraan']],
  ['SERVICE', 'Servis Kendaraan', ['Servis Berkala', 'Perbaikan', 'Penggantian Ban']],
  ['LABOR', 'Tenaga Kerja', ['Upah Harian', 'Upah Borongan', 'Mandor & Supervisi', 'BPJS & Tunjangan']],
  ['LOGISTIC', 'Logistik', ['Angkutan Material', 'Angkutan Antar Blok', 'Gudang & Penyimpanan']],
  // Dua kategori di bawah ditambahkan atas keputusan pemilik produk (23 Agu 2026):
  // tarif SPRAY-L dan MAP-HA tidak punya rumah yang jujur di delapan kategori di
  // atas, jadi biayanya tidak match anggaran mana pun. Penyemprotan TIDAK dipecah
  // menjadi bahan + tenaga: satu tarif per liter larutan tidak memisahkan keduanya,
  // jadi memecahnya menuntut driver volume kedua yang belum ada.
  ['PESTICIDE', 'Pengadaan Pestisida', ['Herbisida', 'Fungisida', 'Insektisida', 'Pestisida Nabati']],
  ['SURVEY', 'Jasa Survei & Pemetaan', ['Pemetaan Drone', 'Survei Tanah', 'Pengukuran Batas']],
]

// Tarif → kategori akuntansi INDUK. Anggaran dipasang di tingkat induk (keputusan
// pemilik produk 23 Agu 2026), dan realisasi WAJIB memakai sumbu yang sama; kalau
// tidak, perbandingan anggaran membandingkan dua taksonomi yang tidak berpotongan.
const PRICE_CATEGORY = {
  'MAP-HA': 'SURVEY', 'PREP-HA': 'LANDPREP', 'SEED-UNIT': 'SEEDLING',
  'FERT-KG': 'FERTILIZER', 'LABOR-DAY': 'LABOR', 'WEED-HA': 'LABOR',
  'SPRAY-L': 'PESTICIDE', 'PRUNE-TREE': 'LABOR',
}

// Driver volume per kode tarif. DISETEL DI SEED, bukan diserahkan ke migrasi:
// migrasi 0041 memang mengisi ketiga driver ini, tetapi pada instalasi BARU
// migrasi jalan SEBELUM seed, sehingga UPDATE-nya tidak menemukan baris apa pun
// dan no-op tanpa suara -- AI-02 batal seluruhnya dan penyiangan/penyemprotan/
// pruning tidak menghasilkan biaya sama sekali. Seed harus menghasilkan keadaan
// akhir yang dimaksud, bukan menunggu ditambal migrasi.
const PRICE_DRIVER = {
  'WEED-HA': 'weeding_area_ha', 'SPRAY-L': 'spraying_volume',
  'PRUNE-TREE': 'pruning_tree_count',
}

const UOM = [
  ['KG', 'Kilogram'], ['TON', 'Ton'], ['LITER', 'Liter'], ['UNIT', 'Unit'],
  ['BATANG', 'Batang'], ['HOK', 'Hari Orang Kerja'], ['KM', 'Kilometer'],
  ['HA', 'Hektar'], ['M3', 'Meter Kubik'], ['PAKET', 'Paket'],
]

const SUPPLIERS = [
  ['SUP-001', 'CV Bibit Nusantara'], ['SUP-002', 'PT Pupuk Kaltim Niaga'],
  ['SUP-003', 'CV Alat Tani Borneo'], ['SUP-004', 'PT Sumber Energi Sawit'],
  ['SUP-005', 'Koperasi Tenaga Kerja Lestari'], ['SUP-006', 'CV Angkutan Barito'],
]

const PHASES = [
  ['FASE-1', 'Fase 1 — Pengadaan Bibit & Persiapan', '2026-01-01', '2026-06-30'],
  ['FASE-2', 'Fase 2 — Penanaman Awal', '2026-07-01', '2026-12-31'],
  ['FASE-3', 'Fase 3 — Pemeliharaan Tahun 1', '2027-01-01', '2027-12-31'],
]

const ESTATES = [
  ['EST-BRT', 'Estate Barito Utara'],
  ['EST-KPS', 'Estate Kapuas Tengah'],
]

/** Polygon persegi ~30 ha di Kalimantan Tengah. 30 ha -> sisi ~548 m ~ 0.00492 derajat. */
function squareAt(lon, lat, hectares = 30) {
  const side = Math.sqrt(hectares * 10000) / 111_320
  const p = [
    [lon, lat], [lon + side, lat], [lon + side, lat - side], [lon, lat - side], [lon, lat],
  ]
  return JSON.stringify({ type: 'Polygon', coordinates: [p] })
}

const c = new pg.Client({ connectionString: url })
await c.connect()

async function purge() {
  // Dua entitas demo: 'DEMO' (Kalimantan) + 'DEMO2' (Mamuju). Keduanya WAJIB ikut
  // terhapus; kalau tidak, app.check_production_readiness() tetap menandai sisa
  // data demo sebagai penghalang produksi. Daftar eksplisit -- bukan LIKE 'DEMO%'
  // -- supaya entitas 'DEV' dan 'PILOT' (yang juga is_demo) tidak ikut terhapus.
  const ids = (await c.query(`SELECT id FROM app.companies WHERE is_demo AND code IN ('DEMO','DEMO2')`)).rows.map(r => r.id)
  if (ids.length === 0) { console.log('Tidak ada data demo.'); return }
  await c.query('BEGIN')
  for (const t of [
    `DELETE FROM app.evidence_links WHERE evidence_id IN (SELECT id FROM app.evidence_files WHERE company_id = ANY($1))`,
    `DELETE FROM app.evidence_verifications WHERE evidence_id IN (SELECT id FROM app.evidence_files WHERE company_id = ANY($1))`,
    `DELETE FROM app.evidence_files WHERE company_id = ANY($1)`,
    `DELETE FROM app.cost_transactions WHERE company_id = ANY($1)`,
    `DELETE FROM app.budgets WHERE company_id = ANY($1)`,
    `DELETE FROM app.nursery_inspections WHERE seed_batch_id IN (SELECT id FROM app.seed_batches WHERE company_id = ANY($1))`,
    `DELETE FROM app.seed_distributions WHERE seed_batch_id IN (SELECT id FROM app.seed_batches WHERE company_id = ANY($1))`,
    `DELETE FROM app.seed_batches WHERE company_id = ANY($1)`,
    `DELETE FROM app.certificates WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.cert_decisions WHERE assessment_id IN (SELECT a.id FROM app.cert_assessments a JOIN app.cert_programs p ON p.id=a.program_id WHERE p.company_id = ANY($1))`,
    `DELETE FROM app.capa WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.cert_findings WHERE assessment_id IN (SELECT a.id FROM app.cert_assessments a JOIN app.cert_programs p ON p.id=a.program_id WHERE p.company_id = ANY($1))`,
    `DELETE FROM app.cert_assessments WHERE program_id IN (SELECT id FROM app.cert_programs WHERE company_id = ANY($1))`,
    `DELETE FROM app.cert_program_blocks WHERE program_id IN (SELECT id FROM app.cert_programs WHERE company_id = ANY($1))`,
    `DELETE FROM app.cert_programs WHERE company_id = ANY($1)`,
    `DELETE FROM app.compliance_tracking WHERE company_id = ANY($1)`,
    `DELETE FROM app.fertilizer_recommendations WHERE company_id = ANY($1)`,
    `DELETE FROM app.organic_tracking WHERE company_id = ANY($1)`,
    `DELETE FROM app.price_list WHERE company_id = ANY($1)`,
    `DELETE FROM app.spraying_records WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.weeding_records WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.harvest_records WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.agri_input_chemicals WHERE company_id = ANY($1)`,
    `DELETE FROM app.agri_input_equipment WHERE company_id = ANY($1)`,
    `DELETE FROM app.dbh_measurements WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.carbon_run_blocks WHERE run_id IN (SELECT id FROM app.carbon_runs WHERE company_id = ANY($1))`,
    `DELETE FROM app.carbon_runs WHERE company_id = ANY($1)`,
    `DELETE FROM app.plot_crop_layers WHERE plot_id IN (SELECT pl.id FROM app.plots pl JOIN app.blocks b ON b.id=pl.block_id WHERE b.company_id = ANY($1))`,
    `DELETE FROM app.plots WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.submission_values WHERE submission_id IN (SELECT ss.id FROM app.survey_submissions ss JOIN app.form_versions fv ON fv.id=ss.form_version_id JOIN app.forms f ON f.id=fv.form_id WHERE f.company_id = ANY($1))`,
    `DELETE FROM app.survey_submissions WHERE form_version_id IN (SELECT fv.id FROM app.form_versions fv JOIN app.forms f ON f.id=fv.form_id WHERE f.company_id = ANY($1))`,
    `DELETE FROM app.form_fields WHERE form_version_id IN (SELECT fv.id FROM app.form_versions fv JOIN app.forms f ON f.id=fv.form_id WHERE f.company_id = ANY($1))`,
    `DELETE FROM app.form_versions WHERE form_id IN (SELECT id FROM app.forms WHERE company_id = ANY($1))`,
    `DELETE FROM app.forms WHERE company_id = ANY($1)`,
    `DELETE FROM app.fertilizer_applications WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.pruning_records WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.fertilizer_types WHERE company_id = ANY($1)`,
    `DELETE FROM app.land_preparations WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.land_suitability_assessments WHERE block_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.boundary_overlaps WHERE block_a_id IN (SELECT id FROM app.blocks WHERE company_id = ANY($1))`,
    `DELETE FROM app.blocks WHERE company_id = ANY($1)`,
    `DELETE FROM app.fiscal_periods WHERE company_id = ANY($1)`,
    `DELETE FROM app.master_items WHERE company_id = ANY($1)`,
    `DELETE FROM app.suppliers WHERE company_id = ANY($1)`,
    `DELETE FROM app.audit_log WHERE company_id = ANY($1)`,
    `DELETE FROM app.user_estate_access WHERE estate_id IN (SELECT id FROM app.estates WHERE company_id = ANY($1))`,
    `DELETE FROM app.user_company_access WHERE company_id = ANY($1)`,
    `DELETE FROM app.users WHERE company_id = ANY($1)`,
    `DELETE FROM app.estates WHERE company_id = ANY($1)`,
    `DELETE FROM app.companies WHERE id = ANY($1)`,
  ]) await c.query(t, [ids])
  await c.query('COMMIT')
  console.log('Data demo dihapus.')
}

async function seed() {
  await c.query('BEGIN')

  // Pastikan faktor referensi karbon global ada. Diseed migrasi 0026, tetapi
  // suite uji sempat menghapusnya; blok idempoten ini memulihkannya.
  await c.query(`
    INSERT INTO app.emission_factors (code,version,name,value,unit_numerator,unit_denominator,scope,source_standard,source_citation,uncertainty_pct,valid_from)
    VALUES
     ('EF-LANDCLEAR',1,'Land clearing hutan sekunder → kebun',210.0,'tCO2e','ha','scope1','IPCC 2019 AFOLU Vol.4 (perkiraan Tier 1 — perlu validasi)','Perkiraan kehilangan biomassa konversi lahan; WAJIB divalidasi ahli MRV',50,'2026-01-01'),
     ('EF-DIESEL',1,'Solar alat berat & transport',2.68,'kgCO2e','liter','scope1','IPCC 2006 Energy Vol.2 (perkiraan — perlu validasi)','Faktor pembakaran solar',5,'2026-01-01'),
     ('EF-FERT-N2O',1,'N2O dari aplikasi pupuk N',4.42,'kgCO2e','kg','scope1','IPCC 2019 Vol.4 Ch.11 (perkiraan — perlu validasi)','N2O per kg N ke CO2e',60,'2026-01-01')
    ON CONFLICT DO NOTHING`)

  await c.query(
    `INSERT INTO app.companies (id, code, name, is_demo) VALUES ($1,'DEMO','PT Demo Agro Kalimantan', true)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_demo = true`, [CO])

  // Pengguna: satu per peran, memakai domain .invalid supaya tak mungkin nyata.
  const users = [
    ['00000000-0000-4000-8000-0000000000e1', 'demo|admin', 'admin@demo.invalid', 'Sari Admin', 'super_admin'],
    ['00000000-0000-4000-8000-0000000000e2', 'demo|approver', 'approver@demo.invalid', 'Budi Approver', 'approver'],
    ['00000000-0000-4000-8000-0000000000e3', 'demo|creator', 'creator@demo.invalid', 'Rizky Lapangan', 'creator'],
    ['00000000-0000-4000-8000-0000000000e4', 'demo|viewer', 'direktur@demo.invalid', 'Dewi Direktur', 'viewer'],
  ]
  for (const [id, sub, email, name, role] of users) {
    await c.query(
      `INSERT INTO app.users (id, company_id, external_id, email, full_name, role, app_role)
       VALUES ($1,$2,$3,$4,$5,'viewer',$6)
       ON CONFLICT (id) DO UPDATE SET app_role = EXCLUDED.app_role`, [id, CO, sub, email, name, role])
    await c.query(
      `INSERT INTO app.user_company_access (user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, CO])
  }

  // Estate & blok
  const estateIds = {}
  for (const [i, [code, name]] of ESTATES.entries()) {
    const r = await c.query(
      `INSERT INTO app.estates (company_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [CO, code, name])
    estateIds[code] = r.rows[0].id
    if (i === 1) {
      // creator dibatasi ke estate kedua -- supaya pembatasan RLS terlihat saat demo
      await c.query(
        `INSERT INTO app.user_estate_access (user_id, estate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        ['00000000-0000-4000-8000-0000000000e3', r.rows[0].id])
    }
  }

  const blockIds = []
  let n = 0
  for (const [code, ] of ESTATES) {
    for (let i = 0; i < 6; i++) {
      const lon = 114.2 + (n % 4) * 0.0055
      const lat = -1.85 - Math.floor(n / 4) * 0.0055
      const withGeom = true // semua blok punya polygon agar tampil di peta
      const r = await c.query(
        `INSERT INTO app.blocks (company_id, estate_id, code, name, planting_year, boundary_source, geom, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,
                 CASE WHEN $7::text IS NULL THEN NULL
                      ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7),4326)) END,
                 $8) RETURNING id`,
        [CO, estateIds[code], `${code.slice(4)}-${String(i + 1).padStart(2, '0')}`,
         `Blok ${i + 1}`, 2026, withGeom ? 'gps_survey' : 'shapefile_import',
         withGeom ? squareAt(lon, lat) : null, users[0][0]])
      blockIds.push(r.rows[0].id)
      n++
    }
  }

  // Plot per blok: tiap blok dibagi 2 plot (produktif + konservasi) dengan
  // geometry yang membagi kotak blok jadi dua. concept: setiap blok punya
  // beberapa plot; petanya menampilkan keduanya.
  const cropRows = (await c.query(`SELECT id, code FROM app.crops`)).rows
  const durian = cropRows.find(r => r.code === 'DURIAN')?.id
  const coconut = cropRows.find(r => r.code === 'COCONUT')?.id
  let plotCount = 0
  const plotIds = []
  for (const [bi, blockId] of blockIds.entries()) {
    const geo = (await c.query(`SELECT ST_AsGeoJSON(geom) g, ST_XMin(geom) x0, ST_XMax(geom) x1,
                                       ST_YMin(geom) y0, ST_YMax(geom) y1
                                  FROM app.blocks WHERE id=$1`, [blockId])).rows[0]
    if (!geo?.g) continue
    const xmid = (Number(geo.x0) + Number(geo.x1)) / 2
    const half = (lon0, lon1) => JSON.stringify({ type: 'Polygon', coordinates: [[
      [lon0, Number(geo.y0)], [lon1, Number(geo.y0)],
      [lon1, Number(geo.y1)], [lon0, Number(geo.y1)], [lon0, Number(geo.y0)],
    ]] })
    // Plot A: produktif (durian+kelapa tumpang sari). Plot B: konservasi buffer.
    const specs = [
      { code: 'A', use: 'productive', geo: half(Number(geo.x0), xmid) },
      { code: 'B', use: bi % 3 === 0 ? 'conservation' : 'productive', geo: half(xmid, Number(geo.x1)) },
    ]
    for (const sp of specs) {
      const r = await c.query(
        `INSERT INTO app.plots (block_id, code, geom, land_use)
         VALUES ($1,$2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3),4326)), $4::app.land_use)
         RETURNING id`, [blockId, sp.code, sp.geo, sp.use])
      plotIds.push({ id: r.rows[0].id, use: sp.use, blockId })
      if (sp.use === 'productive') {
        for (const [lo, cid] of [[1, durian], [2, coconut]]) {
          if (cid) await c.query(
            `INSERT INTO app.plot_crop_layers (plot_id, crop_id, layer_order, trees_per_ha)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [r.rows[0].id, cid, lo, lo === 1 ? 100 : 143])
        }
      }
      plotCount++
    }
  }

  // Pengukuran DBH juvenil (fase bibit lanjut) -- kecil, ~2-6 cm. Ini yang
  // membuat sequestration nyata tapi mendekati nol, sesuai fase proyek.
  let dbhCount = 0
  for (const [pi, pl] of plotIds.entries()) {
    if (pl.use !== 'productive') continue
    for (const [k, cid] of [[0, durian], [1, coconut]]) {
      if (!cid) continue
      const dbh = 2 + ((pi * 2 + k) % 5) // 2..6 cm, deterministik
      await c.query(
        `INSERT INTO app.dbh_measurements
           (block_id, plot_id, crop_id, measured_at, dbh_cm, height_m, measured_by, approval_status)
         VALUES ($1,$2,$3,'2026-06-01',$4,$5,$6,'approved')`,
        [pl.blockId, pl.id, cid, dbh, 1 + dbh * 0.3, users[2][0]])
      dbhCount++
    }
  }

  // Master data: satuan
  const uomType = (await c.query(`SELECT id FROM app.master_types WHERE code='unit_of_measure'`)).rows[0].id
  const uomIds = {}
  for (const [i, [code, name]] of UOM.entries()) {
    const r = await c.query(
      `INSERT INTO app.master_items (master_type_id, company_id, code, name, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [uomType, CO, code, name, i, users[0][0]])
    uomIds[code] = r.rows[0].id
  }

  // Master data: komponen biaya berjenjang (concept:158)
  const catType = (await c.query(`SELECT id FROM app.master_types WHERE code='cost_category'`)).rows[0].id
  // Layout tanam (tipe master dari migrasi 0050). Hanya untuk tenant DEMO —
  // tenant sungguhan membuatnya sendiri lewat UI Master Data, sama seperti tipe
  // master lain. Tanpa item ini dropdown "Layout tanam" kosong dan laporan
  // Persiapan Lahan merender em-dash (jujur, tapi demo jadi tidak bercerita).
  for (const [i, name] of ['3 m × 3 m', '4 m × 4 m', '6 m × 6 m', '8 m × 8 m', '9 m × 9 m'].entries()) {
    await c.query(
      `INSERT INTO app.master_items (master_type_id, company_id, code, name, sort_order)
       SELECT mt.id, $1, $2, $3, $4 FROM app.master_types mt WHERE mt.code = 'planting_layout'
       ON CONFLICT (master_type_id, company_id, code) DO NOTHING`,
      [CO, `LAY-${i + 1}`, name, i + 1])
  }

  const leafIds = []   // sub-kategori; transaksi dicatat pada level ini
  for (const [i, [code, name, subs]] of COST_TREE.entries()) {
    const p = await c.query(
      `INSERT INTO app.master_items (master_type_id, company_id, code, name, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [catType, CO, code, name, i * 10, users[0][0]])
    for (const [j, sub] of subs.entries()) {
      const subCode = `${code}-${String(j + 1).padStart(2, '0')}`
      const r = await c.query(
        `INSERT INTO app.master_items (master_type_id, company_id, parent_id, code, name, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [catType, CO, p.rows[0].id, subCode, sub, i * 10 + j + 1, users[0][0]])
      leafIds.push({ id: r.rows[0].id, parent: name, name: sub })
    }
  }

  // Supplier
  const supIds = []
  for (const [code, name] of SUPPLIERS) {
    const r = await c.query(
      `INSERT INTO app.suppliers (company_id, code, name, is_vendor) VALUES ($1,$2,$3,true) RETURNING id`,
      [CO, code, name])
    supIds.push(r.rows[0].id)
  }

  // Fase proyek
  const phaseIds = []
  for (const [i, [code, name, s, e]] of PHASES.entries()) {
    const r = await c.query(
      `INSERT INTO app.fiscal_periods (company_id, code, name, starts_on, ends_on, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [CO, code, name, s, e, i])
    phaseIds.push(r.rows[0].id)
  }

  // Anggaran per fase x komponen induk (level induk, bukan sub-kategori)
  const parents = (await c.query(
    `SELECT id, name FROM app.master_items
      WHERE master_type_id=$1 AND company_id=$2 AND parent_id IS NULL ORDER BY sort_order`,
    [catType, CO])).rows
  const budgetPlan = {
    'Pengadaan Bibit': 900_000_000, 'Persiapan Lahan': 1_400_000_000,
    'Pengadaan Pupuk': 350_000_000, 'Alat & Mekanisasi': 250_000_000,
    'Kendaraan & Bahan Bakar': 300_000_000, 'Servis Kendaraan': 80_000_000,
    'Tenaga Kerja': 1_100_000_000, 'Logistik': 220_000_000,
    // Dua kategori dari keputusan 24 Agu 2026; tanpa entri di sini keduanya jatuh
    // ke default 100jt dan serapannya jadi ekstrem.
    'Pengadaan Pestisida': 180_000_000, 'Jasa Survei & Pemetaan': 120_000_000,
  }

  // Serapan yang DITUJU per kategori induk.
  //
  // Sebelum ini nilai pengeluaran (15jt-112,5jt) tidak punya hubungan apa pun
  // dengan anggaran induknya, jadi kategori beranggaran kecil PASTI terlampaui
  // jauh: Servis Kendaraan 346%, Pengadaan Pestisida 305%, Jasa Survei 247%.
  // Bagi orang yang melihat demo itu terbaca seperti aplikasinya salah hitung.
  //
  // Dua kategori SENGAJA dibiarkan di atas 100% supaya jalur peringatan "anggaran
  // terlampaui" tetap teruji — kalau semuanya wajar, jalur itu tidak pernah jalan.
  // Persiapan Lahan dipatok 68% mengikuti angka yang sudah dikutip di docs/13.
  const serapanTarget = {
    'Persiapan Lahan': 0.68, 'Pengadaan Bibit': 0.44, 'Pengadaan Pupuk': 0.61,
    'Tenaga Kerja': 0.39, 'Alat & Mekanisasi': 0.82, 'Kendaraan & Bahan Bakar': 0.73,
    'Pengadaan Pestisida': 0.55, 'Jasa Survei & Pemetaan': 0.91,
    'Logistik': 1.18, 'Servis Kendaraan': 1.27,   // <- terlampaui, disengaja
  }
  for (const p of parents) {
    await c.query(
      `INSERT INTO app.budgets (company_id, fiscal_period_id, cost_category_id, scope_type, amount_idr, created_by)
       VALUES ($1,$2,$3,'company',$4,$5)`,
      [CO, phaseIds[0], p.id, budgetPlan[p.name] ?? 100_000_000, users[0][0]])
  }

  // Pengeluaran: deterministik (tanpa acak) supaya angkanya bisa direproduksi.
  const cc = (await c.query(
    `INSERT INTO app.cost_centers (code, name) VALUES ('DEMO-PLT','Plantation')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`)).rows[0].id

  const STATUSES = ['approved', 'approved', 'approved', 'submitted', 'draft', 'rejected']

  // Nilai per transaksi diturunkan DARI anggaran induknya, bukan dari deret bebas.
  // Hanya transaksi 'approved' yang dihitung v_budget_vs_actual, jadi pembaginya
  // adalah jumlah transaksi approved yang akan mendarat di induk itu — dihitung
  // lebih dulu dari deret status yang deterministik.
  const approvedPerParent = {}
  for (const [i, leaf] of leafIds.entries()) {
    for (let k = 0; k < 2; k++) {
      if (STATUSES[(i * 2 + k) % STATUSES.length] === 'approved') {
        approvedPerParent[leaf.parent] = (approvedPerParent[leaf.parent] ?? 0) + 1
      }
    }
  }
  const nilaiPerTx = (parent) => {
    const anggaran = budgetPlan[parent] ?? 100_000_000
    const n = approvedPerParent[parent] ?? 0
    const target = serapanTarget[parent] ?? 0.6
    // Tanpa transaksi approved, serapan memang kosong — pakai nilai wajar saja.
    return n === 0 ? 20_000_000 : Math.round((anggaran * target) / n / 500_000) * 500_000
  }

  let txCount = 0
  for (const [i, leaf] of leafIds.entries()) {
    // dua transaksi per sub-komponen, tersebar ke blok & supplier
    for (let k = 0; k < 2; k++) {
      const idx = i * 2 + k
      const status = STATUSES[idx % STATUSES.length]
      const blockId = blockIds[idx % 10]                       // hanya blok berpolygon
      const amount = nilaiPerTx(leaf.parent)
      const day = String((idx % 27) + 1).padStart(2, '0')
      const uom = Object.values(uomIds)[idx % UOM.length]

      const ev = await c.query(
        `INSERT INTO app.evidence_files (company_id, block_id, evidence_type, file_name, storage_path,
                                         mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1,$2,'document',$3,$4,'image/jpeg',102400,$5,$6) RETURNING id`,
        [CO, blockId, `struk-${idx + 1}.jpg`, `file://demo/struk-${idx + 1}.jpg`,
         `demo${String(idx).padStart(60, '0')}`, users[2][0]])

      const tx = await c.query(
        `INSERT INTO app.cost_transactions
           (company_id, cost_center_id, block_id, cost_category_id, uom_item_id, supplier_id,
            fiscal_period_id, transaction_date, quantity, unit_price_idr, amount_idr, unit,
            approval_status, rejection_reason, submitted_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 (SELECT code FROM app.master_items WHERE id=$5),
                 -- $12 dicast eksplisit: dipakai sebagai enum record_status pada
                 -- assignment sekaligus dibandingkan ke literal teks. Tanpa cast,
                 -- Postgres menolak dengan "inconsistent types deduced for parameter".
                 $12::app.record_status,$13,
                 CASE WHEN $12::text = 'draft' THEN NULL ELSE now() END,
                 $14,$14) RETURNING id`,
        [CO, cc, blockId, leaf.id, uom, supIds[idx % supIds.length], phaseIds[0],
         `2026-0${(idx % 6) + 1}-${day}`, 10 + (idx % 90), Math.round(amount / (10 + (idx % 90))),
         amount, status,
         status === 'rejected' ? 'Foto struk tidak terbaca, mohon unggah ulang' : null,
         users[2][0]])

      await c.query(
        `INSERT INTO app.evidence_links (evidence_id, entity_type, entity_id, link_note)
         VALUES ($1,'cost_transaction',$2,'Bukti pembelian')`, [ev.rows[0].id, tx.rows[0].id])
      txCount++
    }
  }

  // Jenis pupuk -- untuk form Pemupukan
  // Jenis pupuk HARUS mencakup semua "Sumber K" yang bisa dihasilkan generator
  // rekomendasi (KCl | K2SO4 | KNO3, lihat src/lib/fertGenerate.ts) agar
  // rekomendasi per blok bisa langsung dipilih saat mencatat aplikasi pupuk.
  const FERTS = [
    ['UREA', 'Urea', 'single', 46, 0, 0],
    ['KCL', 'KCl', 'single', 0, 0, 60],
    ['KNO3', 'KNO₃', 'single', 13, 0, 46],
    ['K2SO4', 'ZK (K₂SO₄)', 'single', 0, 0, 50],
    ['NPK151515', 'NPK 15-15-15', 'compound', 15, 15, 15],
    ['KOMPOS', 'Kompos Organik', 'organic', null, null, null],
  ]
  for (const [code, name, kind, nP, pP, kP] of FERTS) {
    await c.query(
      `INSERT INTO app.fertilizer_types (company_id, code, name, kind, n_pct, p2o5_pct, k2o_pct)
       VALUES ($1,$2,$3,$4::app.fertilizer_kind,$5,$6,$7)`,
      [CO, code, name, kind, nP, pP, kP])
  }

  // Form survei published -- bukti rendering schema-driven (concept:62-66):
  // form didefinisikan sebagai BARIS, renderer membacanya saat runtime.
  const form = await c.query(
    `INSERT INTO app.forms (company_id, code, name, module) VALUES ($1,'SRV-BIBIT','Survei Kondisi Bibit','survei')
     RETURNING id`, [CO])
  const fv = await c.query(
    `INSERT INTO app.form_versions (form_id, version, status, published_at)
     VALUES ($1,1,'published',now()) RETURNING id`, [form.rows[0].id])
  const FIELDS = [
    ['kondisi_umum', 'Kondisi umum bibit', 'single_choice', true, { choices: ['Baik', 'Sedang', 'Buruk'] }],
    ['jumlah_rusak', 'Jumlah bibit rusak', 'number', true, null],
    ['tanggal_periksa', 'Tanggal pemeriksaan', 'date', true, null],
    ['ada_hama', 'Ditemukan hama?', 'yes_no', false, null],
    ['catatan', 'Catatan', 'text', false, null],
  ]
  for (const [i, [code, label, type, req, opts]] of FIELDS.entries()) {
    await c.query(
      `INSERT INTO app.form_fields (form_version_id, code, label, field_type, is_required, options, sort_order)
       VALUES ($1,$2,$3,$4::app.field_type,$5,$6,$7)`,
      [fv.rows[0].id, code, label, type, req, opts ? JSON.stringify(opts) : null, i])
  }

  // Form "Adoption & Observation" (docs/Adoption-Observations) — diadaptasi ke
  // kelapa + durian. 6 field plot + 14 indikator (rating Baik/Sedang/Buruk +
  // komentar). Rating: Good/Medium/Bad → Baik/Sedang/Buruk.
  const RATE = { choices: ['Baik', 'Sedang', 'Buruk'] }
  const INDICATORS = [
    ['Pencapaian target hasil (kelapa >2 ton/ha; durian per pohon sesuai umur)'],
    ['Struktur umur tanaman (bibit muda, dewasa, tua)'],
    ['Kerapatan tanam kelapa + sisipan durian (agroforestri) sesuai anjuran'],
    ['Kondisi umum pohon terhadap hama, penyakit, atau kerusakan'],
    ['Penyakit berat tak tersembuhkan (mis. busuk pucuk kelapa / Phytophthora durian)'],
    ['Optimasi kanopi & pelepah/cabang (pruning) untuk cahaya & pertumbuhan'],
    ['Hama/penyakit/sanitasi yang membatasi potensi bahan tanam'],
    ['Reduksi habitat hama & kompetisi gulma (sanitasi/penyiangan)'],
    ['Panen tepat waktu, teratur, dan tuntas'],
    ['Optimasi tingkat naungan pada sistem agroforestri'],
    ['Kondisi fisik tanah yang mendukung atau membatasi hasil'],
    ['Kesehatan tanah: bahan organik, aktivitas mikroba, dan pH'],
    ['Rasio hara (input organik + anorganik) yang optimal'],
    ['Volume pengisian ulang hara yang efisien'],
  ]
  const aform = await c.query(
    `INSERT INTO app.forms (company_id, code, name, module) VALUES ($1,'SRV-ADOPT','Adoption & Observation','survei') RETURNING id`, [CO])
  const afv = await c.query(
    `INSERT INTO app.form_versions (form_id, version, status, published_at) VALUES ($1,1,'published',now()) RETURNING id`, [aform.rows[0].id])
  const AFIELDS = [
    ['Plot & Rehabilitasi', 'survey_year', 'Tahun survei', 'number', true, null],
    ['Plot & Rehabilitasi', 'plot_number', 'Nomor plot', 'number', false, null],
    ['Plot & Rehabilitasi', 'rehab_method', 'Metode rehabilitasi', 'single_choice', true, { choices: ['Non Rehabilitasi', 'Replanting', 'Grafting (sambung)'] }],
    ['Plot & Rehabilitasi', 'year_planted', 'Tahun tanam', 'number', false, null],
    ['Plot & Rehabilitasi', 'self_area_ha', 'Luas lapor sendiri (ha)', 'number', false, null],
    ['Plot & Rehabilitasi', 'polygon_area_ha', 'Luas plot – polygon (ha)', 'number', false, null],
  ]
  INDICATORS.forEach(([label], i) => {
    const n = i + 1
    AFIELDS.push(['Indikator Adopsi & Observasi', `ind${n}_rating`, `${n}. ${label}`, 'single_choice', true, RATE])
    AFIELDS.push(['Indikator Adopsi & Observasi', `ind${n}_comment`, `${n}. Catatan tambahan`, 'text', false, null])
  })
  const afieldIds = {}
  for (const [i, [section, code, label, type, req, opts]] of AFIELDS.entries()) {
    const r = await c.query(
      `INSERT INTO app.form_fields (form_version_id, section_name, code, label, field_type, is_required, options, sort_order)
       VALUES ($1,$2,$3,$4,$5::app.field_type,$6,$7,$8) RETURNING id`,
      [afv.rows[0].id, section, code, label, type, req, opts ? JSON.stringify(opts) : null, i])
    afieldIds[code] = r.rows[0].id
  }

  // Contoh submission Adoption & Observation (agar Hasil Survei terisi).
  const SAMPLES = [
    { block: 0, status: 'approved',  year: 2025, rehab: 'Non Rehabilitasi', planted: 2011, self: 0.34, poly: 0.34, base: 'Baik' },
    { block: 1, status: 'approved',  year: 2025, rehab: 'Replanting',       planted: 2019, self: 1.20, poly: 1.15, base: 'Sedang' },
    { block: 2, status: 'submitted', year: 2024, rehab: 'Grafting (sambung)', planted: 2016, self: 0.80, poly: 0.78, base: 'Baik' },
  ]
  const cycle = ['Baik', 'Sedang', 'Buruk']
  for (const sp of SAMPLES) {
    const sub = await c.query(
      `INSERT INTO app.survey_submissions (client_uuid, form_version_id, block_id, submitted_by, submitted_at, synced_at, approval_status)
       VALUES (gen_random_uuid(),$1,$2,$3,now(),now(),$4) RETURNING id`,
      [afv.rows[0].id, blockIds[sp.block], users[2][0], sp.status])
    const subId = sub.rows[0].id
    const setVal = async (code, { text, num } = {}) => {
      const fid = afieldIds[code]; if (!fid) return
      await c.query(
        `INSERT INTO app.submission_values (submission_id, field_id, value_text, value_num) VALUES ($1,$2,$3,$4)`,
        [subId, fid, text ?? null, num ?? null])
    }
    await setVal('survey_year', { num: sp.year })
    await setVal('plot_number', { num: 1 })
    await setVal('rehab_method', { text: sp.rehab })
    await setVal('year_planted', { num: sp.planted })
    await setVal('self_area_ha', { num: sp.self })
    await setVal('polygon_area_ha', { num: sp.poly })
    for (let n = 1; n <= INDICATORS.length; n++) {
      await setVal(`ind${n}_rating`, { text: n % 4 === 0 ? cycle[(n) % 3] : sp.base })
    }
    await setVal('ind5_comment', { text: 'Tidak ditemukan gejala penyakit berat.' })
    await setVal('ind9_comment', { text: 'Panen mingguan berjalan teratur.' })
  }

  // Batch bibit + inspeksi -> mengisi v_seedling_stock
  const crops = (await c.query(`SELECT id, code FROM app.crops`)).rows
  for (const [i, crop] of crops.entries()) {
    const b = await c.query(
      `INSERT INTO app.seed_batches (company_id, code, crop_id, supplier_id, variety, received_on, qty_initial)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [CO, `NRS-${String(i + 1).padStart(4, '0')}`, crop.id, supIds[0],
       crop.code === 'DURIAN' ? 'Musang King' : 'Kelapa Genjah', '2026-02-15', 12_000 + i * 3_000])
    await c.query(
      `INSERT INTO app.nursery_inspections
         (seed_batch_id, inspected_at, qty_alive, qty_dead, qty_damaged, inspector_id, approval_status)
       VALUES ($1,'2026-03-20',$2,$3,$4,$5,'approved')`,
      [b.rows[0].id, 11_400 + i * 2_800, 380 + i * 120, 220 + i * 80, users[2][0]])
    // Distribusi ke 3 blok -- mata rantai traceability (bibit → blok).
    for (let d = 0; d < 3; d++) {
      await c.query(
        `INSERT INTO app.seed_distributions (seed_batch_id, block_id, qty, distributed_on)
         VALUES ($1,$2,$3,'2026-04-10')`,
        [b.rows[0].id, blockIds[(i * 3 + d) % blockIds.length], 1500 + d * 200])
    }
  }

  // --- Sertifikasi: standar + program + assessment + temuan + CAPA + keputusan + sertifikat ---
  // Standar itu GLOBAL (tanpa company_id) -- purge:demo tidak menyentuhnya.
  // Jadi fetch-or-create, dan hanya isi kriteria bila versinya baru dibuat.
  const std = await c.query(
    `INSERT INTO app.standards (code, name, issuer, validity_months)
     VALUES ('RA-2020','Rainforest Alliance 2020','Rainforest Alliance',36)
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`)
  let svId, svFresh = false
  const svExist = await c.query(
    `SELECT id FROM app.standard_versions WHERE standard_id=$1 AND version='v1.3'`, [std.rows[0].id])
  if (svExist.rows[0]) { svId = svExist.rows[0].id }
  else {
    const sv = await c.query(
      `INSERT INTO app.standard_versions (standard_id, version, status, published_at)
       VALUES ($1,'v1.3','active','2026-01-01') RETURNING id`, [std.rows[0].id])
    svId = sv.rows[0].id; svFresh = true
  }
  const sv = { rows: [{ id: svId }] }
  // Kriteria hanya dibuat sekali (saat versi baru).
  let crit = (await c.query(
    `SELECT id FROM app.standard_criteria WHERE standard_version_id=$1 AND parent_id IS NOT NULL ORDER BY sort_order`,
    [svId])).rows.map(r => r.id)
  if (svFresh)
  for (const [pi, [pcode, ptitle, subs]] of [
    ['P1','Manajemen Lahan',[['1.1','Batas lahan terverifikasi',false],['1.2','Tidak ada konversi area konservasi',true]]],
    ['P3','Lingkungan & Konservasi',[['3.1','Area buffer riparian terjaga',false],['3.2','Pengelolaan limbah',false]]],
  ].entries()) {
    const parent = await c.query(
      `INSERT INTO app.standard_criteria (standard_version_id, code, title, is_critical, max_score, sort_order)
       VALUES ($1,$2,$3,false,0,$4) RETURNING id`, [sv.rows[0].id, pcode, ptitle, pi*10])
    for (const [j,[ccode,ctitle,crit_]] of subs.entries()) {
      const r = await c.query(
        `INSERT INTO app.standard_criteria (standard_version_id, parent_id, code, title, is_critical, max_score, sort_order)
         VALUES ($1,$2,$3,$4,$5,10,$6) RETURNING id`,
        [sv.rows[0].id, parent.rows[0].id, ccode, ctitle, crit_, pi*10+j+1])
      crit.push(r.rows[0].id)
    }
  }
  const prog = await c.query(
    `INSERT INTO app.cert_programs (company_id, code, name, standard_version_id, period_start, period_end, status)
     VALUES ($1,'PRG-2026-01','Program RA 2026',$2,'2026-01-01','2026-12-31','berjalan') RETURNING id`,
    [CO, sv.rows[0].id])
  // 5 blok pertama masuk program dengan readiness bervariasi
  const assessStatus = ['reviewed','submitted','in_progress','revision_required','assigned']
  for (let i = 0; i < 5; i++) {
    const ready = 92 - i * 9
    await c.query(
      `INSERT INTO app.cert_program_blocks (program_id, block_id, readiness_pct, eligibility, missing_items)
       VALUES ($1,$2,$3,$4,$5)`,
      [prog.rows[0].id, blockIds[i], ready, ready >= 70 ? 'eligible' : 'missing_data',
       ready >= 70 ? null : ['Tree inventory','Foto geotag']])
    const a = await c.query(
      `INSERT INTO app.cert_assessments (code, program_id, block_id, auditor_id, due_date, status, score_pct, has_critical_failure)
       VALUES ($1,$2,$3,$4,'2026-08-30',$5::app.assessment_status,$6,$7) RETURNING id`,
      [`ASG-CRT-${String(i+1).padStart(3,'0')}`, prog.rows[0].id, blockIds[i], users[1][0],
       assessStatus[i], ready, i === 3])
    if (i === 3) {
      const f = await c.query(
        `INSERT INTO app.cert_findings (assessment_id, criterion_id, description, severity)
         VALUES ($1,$2,'Pestisida tidak terdaftar lengkap','major') RETURNING id`,
        [a.rows[0].id, crit[0]])
      await c.query(
        `INSERT INTO app.capa (code, finding_id, block_id, pic_user_id, action_plan, due_date, status)
         VALUES ('CAPA-001',$1,$2,$3,'Lengkapi dokumen pestisida','2026-09-15','in_progress')`,
        [f.rows[0].id, blockIds[3], users[2][0]])
    }
    if (i === 0) {
      const dec = await c.query(
        `INSERT INTO app.cert_decisions (code, assessment_id, decision, rationale, approver_id, decided_at)
         VALUES ('DEC-001',$1,'certified','Memenuhi seluruh kriteria',$2,now()) RETURNING id`,
        [a.rows[0].id, users[1][0]])
      await c.query(
        `INSERT INTO app.certificates (code, decision_id, standard_version_id, block_id, valid_from, valid_until)
         VALUES ('CERT-2026-0001',$1,$2,$3,'2026-07-01','2029-07-01')`,
        [dec.rows[0].id, sv.rows[0].id, blockIds[0]])
    }
  }

  // Persiapan lahan (land clearing) untuk 9 blok -- ini sumber emisi terbesar
  // di fase ini. Membuat carbon run jujur menunjukkan NET EMITTER, bukan sink.
  for (let i = 0; i < 9; i++) {
    await c.query(
      `INSERT INTO app.land_preparations
         (block_id, checked_at, soil_ph, planting_hole_count, effective_area_ha, status,
          officer_id, approval_status, created_by)
       VALUES ($1,'2026-02-20',$2,$3,$4,$5::app.prep_status,$6,'approved',$6)`,
      [blockIds[i], 5.2 + (i % 5) * 0.3, 500 + i * 90, 25 + i, i < 5 ? 'ready_to_plant' : 'in_progress', users[2][0]])
  }

  // Carbon run: dihitung dari blok + DBH + faktor referensi.
  // generate_carbon_run (0027) bergerbang peran+akses, jadi konteks sesi harus
  // diset ke admin demo lebih dulu — seed berjalan sebagai postgres tanpa konteks.
  await c.query(`SELECT set_config('app.current_user_id',$1,true)`, [users[0][0]])
  await c.query(`SELECT set_config('app.current_role','super_admin',true)`)
  await c.query(`SELECT app.generate_carbon_run($1,'CR-2026-H1','2026-01-01','2026-06-30')`, [CO])

  // Persiapan lahan untuk 4 blok pertama
  for (let i = 0; i < 4; i++) {
    await c.query(
      `INSERT INTO app.land_preparations
         (block_id, checked_at, soil_ph, planting_hole_count, hole_length_cm, hole_width_cm,
          hole_depth_cm, effective_area_ha, status, officer_id, approval_status, created_by)
       VALUES ($1,'2026-03-10',$2,$3,60,60,60,$4,$5,$6,'approved',$6)`,
      [blockIds[i], 5.4 + i * 0.2, 600 + i * 120, 28.5 + i, i < 2 ? 'ready_to_plant' : 'in_progress',
       users[2][0]])
  }

  // Registri kepatuhan (docs/08): status contoh untuk sebagian item A–H.
  // Menunjukkan campuran terbit / dalam proses / prasyarat belum lengkap.
  const compliance = [
    ['A1', 'terbit',       'NIB-2026-0912-0001', '2025-06-01', null,        'NIB terbit via OSS-RBA'],
    ['A2', 'terbit',       'KKPR-KALTIM-114',     '2025-07-15', null,        null],
    ['A3', 'dalam_proses', null,                  null,          null,        'AMDAL dalam penyusunan RKL-RPL'],
    ['A4', 'akan_berakhir','HGU-35-2019',         '2019-04-01', '2054-04-01', 'HGU 35 tahun'],
    ['A9', 'dalam_proses', null,                  null,          null,        'FPKM 20% — kajian lokasi kebun masyarakat'],
    ['B1', 'terbit',       'NRK-DUR-2026-07',     '2026-03-10', '2028-03-10', 'Registrasi kebun durian'],
    ['E2', 'dalam_proses', null,                  null,          null,        'Rainforest Alliance — assessment kesiapan berjalan'],
    ['G1', 'dalam_proses', null,                  null,          null,        'Pendaftaran SRN-PPI (wajib mutlak)'],
    ['H5', 'terbit',       'HCV-2025-KALTIM',     '2025-02-20', null,        'HCV assessment oleh assessor HCVRN'],
  ]
  for (const [code, status, ref, obt, exp, note] of compliance) {
    await c.query(
      `INSERT INTO app.compliance_tracking
         (company_id, item_code, status, reference_no, obtained_on, expires_on, note, updated_by)
       VALUES ($1,$2,$3::app.compliance_status,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, item_code) DO NOTHING`,
      [CO, code, status, ref, obt, exp, note, users[0][0]])
  }

  // Rekomendasi pemupukan (docs/09): contoh per pendekatan & fase.
  // Dosis PROVISIONAL — ilustratif, bukan hasil kalibrasi lapangan.
  const recos = [
    // [block idx, crop, phase, approach, params, N, P2O5, K2O, MgO, S, kSource, split, note]
    [0, 'DURIAN', 'vegetatif', 'analisis_jaringan',
      { organ: 'Daun matang tunas non-berbuah', daun_n: 1.9, daun_p: 0.16, daun_k: 1.1, daun_mg: 0.28, daun_cl: 0.05 },
      600, 300, 500, 120, null, 'KCl', 3, 'Diagnosis daun: K & Mg pembatas. Provisional.'],
    [1, 'COCONUT', 'vegetatif', 'uji_tanah',
      { ph_h2o: 5.4, c_organik: 1.6, k_dd: 0.22, cl_tanah: 180, bobot_isi: 1.15, drainase: 'Baik' },
      500, 250, 900, 200, null, 'KCl', 4, 'Kelapa butuh Cl → KCl. Kapur untuk pH.'],
    [0, 'DURIAN', 'generatif', 'neraca_hara',
      { umur_tanaman: 8, fase_pertumbuhan: 'TM awal', varietas: 'Musang King', populasi_ha: 100, target_hasil: 12 },
      450, 350, 800, 150, 60, 'KNO3', 4, 'Fase pembuahan: KNO3/K2SO4 demi mutu buah (docs/09 §6.3).'],
  ]
  for (const [bi, crop, phase, approach, params, n, p, k, mg, s, ks, split, note] of recos) {
    await c.query(
      `INSERT INTO app.fertilizer_recommendations
         (company_id, block_id, crop_code, phase, approach, params,
          dose_n_g, dose_p2o5_g, dose_k2o_g, dose_mgo_g, dose_s_g,
          k_source, split_count, is_provisional, note, recommended_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4::app.fert_phase,$5::app.fert_approach,$6::jsonb,
               $7,$8,$9,$10,$11,$12,$13,true,$14,'2026-07-15',$15,$15)
       ON CONFLICT (block_id, crop_code, phase) DO NOTHING`,
      [CO, blockIds[bi], crop, phase, approach, JSON.stringify(params),
       n, p, k, mg, s, ks, split, note, users[2][0]])
  }

  // Sertifikasi organik (docs/10): status contoh standar & bukti riwayat lahan.
  const organic = [
    // [item_code, status, ref, obtained_on, expires_on, note]
    ['SNI', 'dalam_proses',   null,             null,         null,         'Mulai dari SNI (domestik, biaya rendah) untuk bangun sistem'],
    ['EU',  'in_conversion',  null,             null,         null,         'Masa konversi 36 bln — menunggu pengakuan retroaktif dari bukti K'],
    ['NOP', 'belum_mulai',    null,             null,         null,         'Menunggu pembeli AS aktual sebelum audit'],
    ['GBT', 'belum_mulai',    null,             null,         null,         'Wajib untuk klaim organik durian beku di China (CNCA)'],
    ['K1',  'tersertifikasi', 'CIT-TS-2011-25', '2025-01-10', null,         'Citra Sentinel/Landsat 2011–2025 terkumpul'],
    ['K2',  'tersertifikasi', 'KLHK-TL-2024',   '2025-01-20', null,         'Peta tutupan lahan historis dari KLH'],
    ['K5',  'dalam_proses',   null,             null,         null,         'Sampling residu pestisida tanah baseline berjalan'],
    ['K6',  'tersertifikasi', 'HGU-35-2019',    '2025-02-01', null,         'Alas hak & riwayat penguasaan lengkap'],
    ['K7',  'tersertifikasi', null,             '2025-02-15', null,         'Peta batas blok berkoordinat tersimpan permanen'],
  ]
  for (const [code, status, ref, obt, exp, note] of organic) {
    await c.query(
      `INSERT INTO app.organic_tracking
         (company_id, item_code, status, reference_no, obtained_on, expires_on, note, updated_by)
       VALUES ($1,$2,$3::app.organic_status,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, item_code) DO NOTHING`,
      [CO, code, status, ref, obt, exp, note, users[0][0]])
  }

  // Contoh penilaian kesesuaian lahan (docs/07) untuk mengisi Riwayat Penilaian.
  // Kelas dihitung dari params agar konsisten (port ringkas dari classifier).
  const critOf = async (code) => (await c.query(
    `SELECT lsc.char_code AS "charCode", lsc.symbol, lsc.is_numeric AS "isNumeric", lsc.bands
       FROM app.land_suit_criteria lsc JOIN app.crops cr ON cr.id=lsc.crop_id
       WHERE cr.code=$1 ORDER BY lsc.sort_order`, [code])).rows
  const RANK = { S1: 0, S2: 1, S3: 2, N: 3 }, ORDER = ['S1', 'S2', 'S3', 'N']
  const matchClass = (bands, v) => {
    if (v === null || v === undefined || v === '') return null
    for (const cls of ORDER) for (const b of bands) {
      if (b.cls !== cls) continue
      if (b.set) { if (typeof v === 'string' && b.set.includes(v)) return cls }
      else { const n = Number(v); if (Number.isNaN(n)) continue; if ((b.min === null || n >= b.min) && (b.max === null || n <= b.max)) return cls }
    }
    return 'N'
  }
  const classifyJs = (criteria, params) => {
    const per = criteria.map((k) => ({ sym: k.symbol, cls: matchClass(k.bands, params[k.charCode] ?? null) }))
    const ass = per.filter((p) => p.cls)
    if (!ass.length) return { overall: null, subclass: null, limiting: [] }
    const worst = ass.reduce((w, p) => RANK[p.cls] > RANK[w] ? p.cls : w, 'S1')
    const limiting = [...new Set(ass.filter((p) => p.cls === worst).map((p) => p.sym))].sort()
    return { overall: worst, subclass: worst === 'S1' ? 'S1' : `${worst}${limiting.join(',')}`, limiting }
  }
  const durianC = await critOf('DURIAN'), coconutC = await critOf('COCONUT')
  const cropId = async (code) => (await c.query(`SELECT id FROM app.crops WHERE code=$1`, [code])).rows[0]?.id
  const durianId = await cropId('DURIAN'), coconutId = await cropId('COCONUT')

  const suitExamples = [
    { block: 2, cid: durianId, crit: durianC, status: 'approved', at: '2026-03-05',
      params: { temperatur: 27, curah_hujan: 2752, drainase: 'agak terhambat', tekstur: 'sedang', ktk: 23.75, kejenuhan_basa: 43.11, ph: 6.10, lereng: 5, batuan_permukaan: 2 } },
    { block: 3, cid: coconutId, crit: coconutC, status: 'approved', at: '2026-03-06',
      params: { temperatur: 26, curah_hujan: 2500, drainase: 'baik', tekstur: 'sedang', bahan_kasar: 5, kedalaman_tanah: 120, ktk: 30, ph: 6.0, c_organik: 1.2, lereng: 3, batuan_permukaan: 2 } },
    { block: 4, cid: coconutId, crit: coconutC, status: 'submitted', at: '2026-03-07',
      params: { temperatur: 40, curah_hujan: 500, lereng: 45 } },
  ]
  let suitCount = 0
  for (const ex of suitExamples) {
    const cl = classifyJs(ex.crit, ex.params)
    await c.query(
      `INSERT INTO app.land_suitability_assessments
         (block_id, assessed_at, crop_id, suit_class, subclass, limiting, params, note,
          approval_status, created_by, assessor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT DO NOTHING`,
      [blockIds[ex.block], ex.at, ex.cid, cl.overall, cl.subclass, cl.limiting,
       JSON.stringify(ex.params), 'Contoh penilaian (docs/07)', ex.status, users[2][0]])
    suitCount++
  }

  // Price list (docs/11 §4): tarif untuk refleksi biaya = volume × tarif.
  // Angka ILUSTRATIF (titik awal), bukan tarif final klien.
  const priceRows = [
    ['MAP-HA',   'cost',    'Pemetaan / mapping',        'block_area_ha',    'ha',    35000,     'Tarif pemetaan per ha'],
    ['PREP-HA',  'cost',    'Persiapan lahan',           'landprep_area_ha', 'ha',    2500000,   'Land clearing + lubang tanam + dolomit'],
    ['SEED-UNIT','cost',    'Pengadaan bibit',           'seedling_qty',     'batang',5000,      'Harga bibit per batang'],
    ['FERT-KG',  'cost',    'Pupuk (agri-input)',        'fertilizer_qty',   'kg',    8000,      'Rata-rata harga pupuk per kg'],
    ['LABOR-DAY','cost',    'Tenaga kerja harian',       null,               'hari',  200000,    'Rp4,4jt ÷ 22 hari kerja'],
    // Tarif per-aktivitas untuk refleksi Nilai di Inbox Approval (per-record).
    ['WEED-HA',  'cost',    'Penyiangan',                null,               'ha',    750000,    'Tenaga penyiangan per ha'],
    ['SPRAY-L',  'cost',    'Penyemprotan',              null,               'liter', 25000,     'Bahan + tenaga per liter larutan'],
    ['PRUNE-TREE','cost',   'Pruning',                   null,               'pohon', 15000,     'Tenaga pruning per pohon'],
    ['REV-DUR-A','revenue', 'Durian Musang King grade A',null,               'ton',   10000000,  '10 ton = Rp100 juta (docs/11 §4)'],
    ['REV-COCO', 'revenue', 'Kelapa (butir/kopra)',      null,               'ton',   3000000,   'Ilustratif'],
  ]
  // Peta kode kategori INDUK -> id, untuk menautkan tarif ke sumbu anggaran.
  const parentCatIds = Object.fromEntries((await c.query(
    `SELECT mi.code, mi.id FROM app.master_items mi
       JOIN app.master_types mt ON mt.id = mi.master_type_id AND mt.code = 'cost_category'
      WHERE mi.company_id = $1 AND mi.parent_id IS NULL`, [CO])).rows.map((r) => [r.code, r.id]))

  for (const [code, kind, category, driverSeed, unit, rate, note] of priceRows) {
    const driver = PRICE_DRIVER[code] ?? driverSeed
    const catId = parentCatIds[PRICE_CATEGORY[code]] ?? null
    await c.query(
      `INSERT INTO app.price_list (company_id, code, kind, category, driver, unit, rate_idr, note, updated_by, cost_category_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       -- Indeks unik (company_id, code) diganti indeks PARSIAL price_list_one_open
       -- (… WHERE valid_to IS NULL) oleh migrasi 0041, karena satu kode kini punya
       -- banyak versi. ON CONFLICT tidak bisa menyimpulkan indeks parsial tanpa
       -- predikat yang sama, jadi tanpa WHERE di bawah seed ini GAGAL dengan
       -- "no unique or exclusion constraint matching the ON CONFLICT specification".
       ON CONFLICT (company_id, code) WHERE valid_to IS NULL DO NOTHING`,
      [CO, code, kind, category, driver, unit, rate, note, users[0][0], catId])
  }

  // Agri-Input: katalog chemical (stok + rekomendasi) & equipment.
  const chemRows = [
    ['UREA',    'Urea 46% N',            'pupuk',      false, 'kg', 12000, 3000, 'vegetatif', 'N tinggi untuk fase vegetatif'],
    ['KCL',     'KCl (MOP)',             'pupuk',      false, 'kg', 9000,  2000, 'generatif', 'Sumber K + Cl untuk kelapa'],
    ['DOLOMIT', 'Dolomit',               'pupuk',      false, 'kg', 1500,  5000, null,        'Amelioran pH & Mg'],
    ['BIOPEST', 'Pestisida nabati neem', 'pestisida',  true,  'liter', 45000, 100, null,      'Jalur organik'],
    ['MANCOZEB','Fungisida Mancozeb',    'fungisida',  false, 'kg', 65000, 50,   null,        'Antisipasi antraknosa'],
  ]
  const chemIds = {}
  for (const [code, name, cat, org, unit, , reorder, phase, note] of chemRows) {
    // stock_qty DIHAPUS oleh migrasi 0043: stok kini turunan buku besar mutasi,
    // bukan kolom yang bisa ditulis ulang. Seed ini sempat GAGAL total karena
    // masih mengisi kolom itu ("column stock_qty does not exist") -- dan itu
    // mematikan jalur pemulihan yang didokumentasikan
    // (db:purge:demo -> db:seed:demo), termasuk yang disarankan
    // check_production_readiness().
    const r = await c.query(
      `INSERT INTO app.agri_input_chemicals
         (company_id, code, name, category, is_organic, unit, reorder_level, rec_phase, rec_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (company_id, code) DO NOTHING RETURNING id`,
      [CO, code, name, cat, org, unit, reorder, phase, note, users[0][0]])
    if (r.rows[0]) {
      chemIds[code] = r.rows[0].id
      // Saldo awal sebagai BARIS MUTASI, meniru cara 0043 memindahkan saldo lama.
      // Tanpa ini v_agri_input_stock nol untuk semua item dan alert reorder demo
      // kehilangan artinya.
      await c.query(
        `INSERT INTO app.agri_input_stock_movements
           (company_id, chemical_id, moved_on, direction, quantity, note, created_by)
         VALUES ($1,$2,CURRENT_DATE,'adjustment',$3,'Saldo awal demo',$4)`,
        [CO, r.rows[0].id, 500, users[0][0]])
    }
  }
  const equipRows = [
    ['DRONE-01', 'Drone survei DJI',      'drone',     45000000, '2×/minggu', 'listrik', 0.5],
    ['MOWER-01', 'Mesin pangkas rumput',  'mesin',     3500000,  'harian',    'bensin',  1.5],
    ['PICKUP-01','Pickup angkut',         'kendaraan', 220000000,'harian',    'solar',   4.0],
    ['SPRAY-01', 'Power sprayer',         'alat',      2800000,  'mingguan',  'bensin',  0.8],
  ]
  for (const [code, name, cat, price, freq, fuel, fph] of equipRows) {
    await c.query(
      `INSERT INTO app.agri_input_equipment
         (company_id, code, name, category, purchase_price_idr, usage_freq, fuel_type, fuel_per_hour, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [CO, code, name, cat, price, freq, fuel, fph, users[0][0]])
  }

  // Farm Activities: weeding, spraying, harvest (approved agar terhitung).
  for (let i = 0; i < 3; i++) {
    await c.query(
      `INSERT INTO app.weeding_records (block_id, weeded_on, method, area_ha, labor_count, approval_status, created_by)
       VALUES ($1,$2,$3,$4,$5,'approved',$6)`,
      [blockIds[i], '2026-04-1' + i, ['manual','mekanis','mulsa'][i], 12 + i, 4 + i, users[2][0]])
  }
  for (let i = 0; i < 2; i++) {
    await c.query(
      `INSERT INTO app.spraying_records (block_id, sprayed_on, chemical_id, target, dose_per_ha, total_volume, unit, approval_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'liter','approved',$7)`,
      [blockIds[i], '2026-04-2' + i, chemIds['BIOPEST'] ?? null, ['ulat penggerek','antraknosa'][i], 2.5, 30 + i * 10, users[2][0]])
  }
  const harvestRows = [
    [0, '2026-06-15', 'DURIAN',  12.5, 'A',     'approved'],
    [1, '2026-06-20', 'COCONUT', 30.0, 'butir', 'approved'],
    [2, '2026-06-25', 'DURIAN',  8.2,  'B',     'submitted'],
  ]
  for (const [bi, on, crop, ton, grade, status] of harvestRows) {
    await c.query(
      `INSERT INTO app.harvest_records (block_id, harvested_on, crop_code, quantity_ton, grade, approval_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [blockIds[bi], on, crop, ton, grade, status, users[2][0]])
  }

  // =========================================================================
  // ENTITAS KEDUA -- prasyarat uji isolasi tenant (QA A-07)
  //
  // Switcher entitas di Topbar sudah ada, tapi hanya tampil bila pengguna punya
  // lebih dari satu entitas (`multi = companies.length > 1`,
  // src/components/layout/Topbar.tsx:62). Dengan satu entitas saja, A-07 tidak
  // bisa dijalankan dan terpaksa di-SKIP.
  //
  // Yang diberi akses ganda HANYA admin@demo.invalid. approver, creator, dan
  // direktur tetap satu entitas: kalau semua orang multi-entitas, "uji isolasi"
  // tidak menguji apa pun lagi. Sebagai pembanding arah sebaliknya ditambahkan
  // satu viewer yang MEMANG milik entitas kedua -- ia tidak boleh melihat
  // sebutir pun data 'DEMO'.
  //
  // Datanya dibuat berbeda dengan sengaja: pulau lain (Mamuju, Sulawesi Barat),
  // kode blok MJU-xx, luas 18 ha (bukan 30), tahun tanam 2024 (bukan 2026),
  // satuan "Butir", kategori biaya khas kelapa, dan nilai rupiah satu orde lebih
  // kecil. Kebocoran lintas tenant jadi terlihat mata, tanpa perlu membandingkan
  // uuid. Angkanya ILUSTRATIF, sama seperti seluruh isi seed ini.
  //
  // Catatan keamanan: INSERT langsung ke app.user_company_access DISENGAJA di
  // sini karena seed berjalan sebagai superuser (MIGRATION_DATABASE_URL) --
  // polanya sama dengan blok user entitas pertama di atas. Dari aplikasi
  // (app_rw) hak tulis tabel ini tetap dicabut dan satu-satunya pintu tetap
  // app.grant_company_access(); lihat ledger app.privilege_revocations (0019).
  // =========================================================================
  await c.query(
    `INSERT INTO app.companies (id, code, name, is_demo) VALUES ($1,'DEMO2','PT Demo Kelapa Mamuju', true)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_demo = true`, [CO2])

  // Akun multi-entitas SENGAJA akun BARU, bukan admin@demo.invalid.
  //
  // Alasannya bukan selera: resolveLogin() (src/lib/session.ts) hanya memilih
  // entitas otomatis bila pengguna punya SATU entitas. Begitu akun punya dua, ia
  // selalu mendarat di mode "semua entitas" (companyId null), dan di mode itu:
  //   - form tulis yang bersyarat `ctx.companyId` HILANG dari layar (mis. form
  //     blok baru di /operasional/blok), dan
  //   - createMasterItem menulis company_id = NULL, yang diloloskan policy
  //     master_items_global_admin_only untuk super_admin -> item master menjadi
  //     GLOBAL dan terlihat oleh SETIAP tenant. Justru kebocoran lintas tenant,
  //     di seed yang dibuat untuk membuktikan isolasi.
  // Ini bukan kekhawatiran teoretis: hal yang sama sudah terjadi pada
  // admin@agrovision.local (DEV + PILOT dari db:import:pilot) dan membuat
  // scripts/at-verify.mjs mati di AT2 sampai harness-nya memilih entitas sendiri.
  // Karena admin@demo.invalid dipakai skenario QA A-01/A-05/AT1, perilakunya
  // tidak diubah.
  const U_ADMIN_MULTI = '00000000-0000-4000-8000-0000000000e6'
  await c.query(
    `INSERT INTO app.users (id, company_id, external_id, email, full_name, role, app_role)
     VALUES ($1,$2,'demo|admin-multi','admin.multi@demo.invalid','Sari Admin (Dua Entitas)','viewer','super_admin')
     ON CONFLICT (id) DO UPDATE SET app_role = EXCLUDED.app_role`, [U_ADMIN_MULTI, CO])
  for (const co of [CO, CO2]) {
    await c.query(
      `INSERT INTO app.user_company_access (user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [U_ADMIN_MULTI, co])
  }

  // Viewer milik entitas kedua -- satu entitas saja, jadi ia pembuktian arah
  // sebaliknya: tidak boleh melihat data 'DEMO'.
  const U_VIEWER_B = '00000000-0000-4000-8000-0000000000e5'
  await c.query(
    `INSERT INTO app.users (id, company_id, external_id, email, full_name, role, app_role)
     VALUES ($1,$2,'demo|viewer-b','direktur.mamuju@demo.invalid','Rina Direktur Mamuju','viewer','viewer')
     ON CONFLICT (id) DO UPDATE SET app_role = EXCLUDED.app_role`, [U_VIEWER_B, CO2])
  await c.query(
    `INSERT INTO app.user_company_access (user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [U_VIEWER_B, CO2])

  const estateB = (await c.query(
    `INSERT INTO app.estates (company_id, code, name) VALUES ($1,'EST-MJU','Estate Mamuju Pesisir') RETURNING id`,
    [CO2])).rows[0].id

  // 4 blok di pesisir Mamuju -- ratusan kilometer dari blok 'DEMO' di Kalimantan
  // Tengah, sehingga kebocoran lintas tenant langsung terlihat di peta.
  const blockIdsB = []
  for (let i = 0; i < 4; i++) {
    const r = await c.query(
      `INSERT INTO app.blocks (company_id, estate_id, code, name, planting_year, boundary_source, geom, created_by)
       VALUES ($1,$2,$3,$4,2024,'shapefile_import',
               ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)), $6) RETURNING id`,
      [CO2, estateB, `MJU-${String(i + 1).padStart(2, '0')}`, `Blok Pesisir ${i + 1}`,
       squareAt(118.87 + i * 0.0045, -2.68, 18), users[0][0]])
    blockIdsB.push(r.rows[0].id)
  }

  // Master data milik entitas kedua SENDIRI. Memakai master_items entitas
  // pertama akan membuat kategori & satuan tampil kosong bagi pengguna entitas
  // kedua (master_items ber-RLS per company) -- persis kebocoran yang sedang diuji.
  const uomIdsB = {}
  for (const [i, [code, name]] of [['BUTIR', 'Butir'], ['HOK', 'Hari Orang Kerja'], ['TON', 'Ton']].entries()) {
    const r = await c.query(
      `INSERT INTO app.master_items (master_type_id, company_id, code, name, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [uomType, CO2, code, name, i, users[0][0]])
    uomIdsB[code] = r.rows[0].id
  }

  const parentIdsB = []
  const leafIdsB = []
  for (const [i, [code, name, subs]] of [
    ['COCOPREP', 'Persiapan Kebun Kelapa', ['Pembersihan Lahan Pesisir', 'Pembuatan Saluran Air']],
    ['COCOHARV', 'Panen & Pascapanen Kelapa', ['Upah Pemanen', 'Angkut ke Gudang Kopra']],
  ].entries()) {
    const p = await c.query(
      `INSERT INTO app.master_items (master_type_id, company_id, code, name, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [catType, CO2, code, name, i * 10, users[0][0]])
    parentIdsB.push({ id: p.rows[0].id, name })
    for (const [j, sub] of subs.entries()) {
      const r = await c.query(
        `INSERT INTO app.master_items (master_type_id, company_id, parent_id, code, name, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [catType, CO2, p.rows[0].id, `${code}-${String(j + 1).padStart(2, '0')}`, sub,
         i * 10 + j + 1, users[0][0]])
      leafIdsB.push(r.rows[0].id)
    }
  }

  const supIdsB = []
  for (const [code, name] of [
    ['SUP-MJU-01', 'CV Kopra Mandar Sejahtera'],
    ['SUP-MJU-02', 'UD Angkutan Mamuju'],
  ]) {
    const r = await c.query(
      `INSERT INTO app.suppliers (company_id, code, name, is_vendor) VALUES ($1,$2,$3,true) RETURNING id`,
      [CO2, code, name])
    supIdsB.push(r.rows[0].id)
  }

  const periodB = (await c.query(
    `INSERT INTO app.fiscal_periods (company_id, code, name, starts_on, ends_on, sort_order)
     VALUES ($1,'TB-2026','Tahun Buku 2026','2026-01-01','2026-12-31',0) RETURNING id`, [CO2])).rows[0].id

  for (const [i, p] of parentIdsB.entries()) {
    await c.query(
      `INSERT INTO app.budgets (company_id, fiscal_period_id, cost_category_id, scope_type, amount_idr, created_by)
       VALUES ($1,$2,$3,'company',$4,$5)`,
      [CO2, periodB, p.id, i === 0 ? 175_000_000 : 260_000_000, users[0][0]])
  }

  // created_by = admin demo, satu-satunya pengguna yang memang punya akses ke
  // entitas ini. creator 'DEMO' sengaja TIDAK dipakai: ia tak boleh menyentuh
  // entitas kedua sama sekali.
  const STATUSES_B = ['approved', 'approved', 'submitted', 'draft', 'rejected', 'approved']
  let txCountB = 0
  for (let i = 0; i < STATUSES_B.length; i++) {
    const status = STATUSES_B[i]
    const amount = 3_100_000 + i * 900_000        // 3,1jt - 7,6jt; deterministik
    const qty = 25 * (i + 1)
    await c.query(
      `INSERT INTO app.cost_transactions
         (company_id, cost_center_id, block_id, cost_category_id, uom_item_id, supplier_id,
          fiscal_period_id, transaction_date, quantity, unit_price_idr, amount_idr, unit,
          approval_status, rejection_reason, submitted_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               (SELECT code FROM app.master_items WHERE id=$5),
               -- $12 dicast eksplisit, alasannya sama dengan blok pengeluaran di atas.
               $12::app.record_status,$13,
               CASE WHEN $12::text = 'draft' THEN NULL ELSE now() END,
               $14,$14)`,
      [CO2, cc, blockIdsB[i % blockIdsB.length], leafIdsB[i % leafIdsB.length],
       Object.values(uomIdsB)[i % 3], supIdsB[i % supIdsB.length], periodB,
       `2026-0${(i % 6) + 1}-1${i}`, qty, Math.round(amount / qty), amount, status,
       status === 'rejected' ? 'Nota angkut kopra belum dilampirkan' : null,
       users[0][0]])
    txCountB++
  }

  await c.query('COMMIT')

  console.log('\nData DEMO ditambahkan.\n')
  console.log(`  entitas            PT Demo Agro Kalimantan (DEMO, ditandai is_demo)`)
  console.log(`  entitas kedua      PT Demo Kelapa Mamuju (DEMO2, ditandai is_demo)`)
  console.log(`                     1 estate · ${blockIdsB.length} blok MJU-xx · ${txCountB} pengeluaran · 2 anggaran`)
  console.log(`  estate             ${ESTATES.length}`)
  console.log(`  blok               12 (semua berpolygon)`)
  console.log(`  komponen biaya     ${COST_TREE.length} kategori, ${leafIds.length} sub-kategori`)
  console.log(`  satuan             ${UOM.length}`)
  console.log(`  supplier           ${SUPPLIERS.length}`)
  console.log(`  fase proyek        ${PHASES.length}`)
  console.log(`  anggaran           ${parents.length} (fase 1)`)
  console.log(`  pengeluaran        ${txCount} lintas status`)
  console.log(`  jenis pupuk        4`)
  console.log(`  form survei        1 (published, 5 field)`)
  console.log(`  plot               ${plotCount} (2 per blok, dengan crop layer)`)
  console.log(`  DBH juvenil        ${dbhCount} pengukuran`)
  console.log(`  sertifikasi        1 standar · 1 program · 5 assessment · 1 sertifikat · 1 CAPA`)
  console.log(`  carbon run         CR-2026-H1 (dihitung dari blok + DBH)`)
  console.log(`  registri kepatuhan ${compliance.length} item berstatus (dari 50 item A–H)`)
  console.log(`  rekomendasi pupuk  ${recos.length} (provisional, per pendekatan & fase)`)
  console.log(`  sertifikasi organik ${organic.length} status (standar + bukti K1–K7)`)
  console.log(`  kesesuaian lahan   ${suitCount} contoh penilaian (durian S2, kelapa S1 & N)`)
  console.log(`  price list         ${priceRows.length} tarif (refleksi biaya docs/11 §4)`)
  console.log(`  agri-input         ${chemRows.length} chemical · ${equipRows.length} equipment`)
  console.log(`  farm activities    3 weeding · 2 spraying · ${harvestRows.length} harvest (2 approved → revenue)`)
  console.log('\nLogin demo (tanpa password):')
  for (const [, , email, name, role] of users) console.log(`  ${role.padEnd(12)} ${email.padEnd(26)} ${name}`)
  console.log(`  ${'viewer'.padEnd(12)} ${'direktur.mamuju@demo.invalid'} Rina Direktur Mamuju (entitas DEMO2)`)
  console.log('\nUji isolasi tenant (QA A-07):')
  console.log('  admin.multi@demo.invalid     2 entitas (DEMO+DEMO2) -> switcher muncul di Topbar')
  console.log('  admin@demo.invalid           1 entitas (DEMO)  -> perilaku lama, tidak diubah')
  console.log('  approver/creator/direktur    1 entitas (DEMO)  -> tanpa switcher')
  console.log('  direktur.mamuju@demo.invalid 1 entitas (DEMO2) -> tanpa switcher')
  console.log('  Catatan: admin.multi masuk mode "Semua Entitas" setelah login. Pilih satu')
  console.log('  entitas dulu sebelum MEMBUAT data -- di mode itu entitas aktif kosong.')
  console.log('\n⚠️  Angka biaya di sini ILUSTRATIF, bukan data lapangan.')
  console.log('   check_production_readiness() akan melaporkannya sebagai penghalang produksi.')
  console.log('   Hapus dengan: npm run db:purge:demo')
}

try {
  if (PURGE) await purge()
  else await seed()
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('Gagal:', e.message)
  process.exit(1)
} finally {
  await c.end()
}
