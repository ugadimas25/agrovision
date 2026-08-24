#!/usr/bin/env node
/**
 * Verifikasi acceptance test lewat HTTP, menembus aplikasi sungguhan.
 *
 * Kenapa lewat HTTP dan bukan memanggil fungsi repo langsung: acceptance test
 * di docs/00-refinement-concept.md:74-85 berbicara soal perilaku aplikasi
 * ("super admin menambah X lewat UI → muncul di dropdown"). Menguji repo saja
 * akan melewatkan lapisan Server Action, validasi, otorisasi, dan revalidasi
 * cache — yaitu tempat bug paling sering muncul.
 *
 * Form disubmit sebagai POST multipart biasa, tanpa JavaScript, memanfaatkan
 * progressive enhancement Server Actions Next.js.
 *
 * Jalankan: node scripts/at-verify.mjs   (dev server harus hidup)
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  return cond;
};

// --------------------------------------------------------------------------
// Sesi: cookie jar sederhana
// --------------------------------------------------------------------------
class Session {
  constructor(label) { this.label = label; this.cookies = new Map(); }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async get(path) {
    const res = await fetch(`${BASE}${path}`, {
      headers: this.cookies.size ? { cookie: this.header() } : {},
      redirect: "manual",
    });
    this.absorb(res);
    return { status: res.status, location: res.headers.get("location"), html: await res.text() };
  }

  /**
   * Submit form Server Action. Field tersembunyi $ACTION_* diambil dari HTML
   * yang dirender — itulah yang membuat progressive enhancement bekerja.
   */
  async submit(path, fields, { formMarker, files } = {}) {
    const { html } = await this.get(path);
    const form = pickForm(html, formMarker);
    if (!form) throw new Error(`Form tidak ditemukan di ${path}${formMarker ? ` (penanda: ${formMarker})` : ""}`);

    const fd = new FormData();
    for (const [k, v] of Object.entries(form.hidden)) fd.append(k, v);
    // set(), BUKAN append(): hidden input pada form yang sama bisa memakai nama
    // yang sama (mis. `id`, `decision`), dan formData.get() di server membaca
    // nilai PERTAMA. Dengan append, override di sini tidak pernah berlaku --
    // itu membuat uji approval "lolos" sambil mengenai baris yang salah.
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    for (const [k, f] of Object.entries(files ?? {})) fd.set(k, f.blob, f.name);

    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: this.cookies.size ? { cookie: this.header() } : {},
      body: fd,
      redirect: "manual",
    });
    this.absorb(res);
    return { status: res.status, location: res.headers.get("location"), html: await res.text() };
  }
}

/** HTML tanpa payload RSC. Next menanam ulang tiap string di <script>, jadi
 *  menghitung kemunculan pada HTML mentah selalu dobel. */
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");

function pickForm(html, marker) {
  for (const m of html.matchAll(/<form[^>]*method="POST"[^>]*>([\s\S]*?)<\/form>/g)) {
    const body = m[1];
    // Penanda dicari pada SELURUH elemen form (m[0]), bukan hanya isinya (m[1]),
    // supaya atribut pada tag pembuka bisa dipakai sebagai pegangan stabil —
    // mis. data-testid="ajukan-pengeluaran". Mencocokkan prosa di dalam form
    // rapuh: satu kata yang sama di form lain membuat uji menembak form salah.
    if (marker && !m[0].includes(marker)) continue;
    const hidden = {};
    for (const inp of body.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
      const n = /name="([^"]+)"/.exec(inp[0]);
      const v = /value="([^"]*)"/.exec(inp[0]);
      if (n) hidden[n[1]] = (v?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    }
    return { hidden };
  }
  return null;
}

/** Entitas yang dipakai seluruh fixture suite ini (kode DEV). */
const DEV_COMPANY = "00000000-0000-4000-8000-000000000001";

const login = async (email, { company = DEV_COMPANY } = {}) => {
  const s = new Session(email);
  const r = await s.submit("/login", { email });
  if (!s.cookies.has("agrovision_session")) throw new Error(`Login gagal untuk ${email}: ${r.status}`);

  // Pilih entitas secara EKSPLISIT. Akun dengan lebih dari satu entitas mendarat
  // di mode "semua entitas" (companyId null -- resolveLogin di
  // src/lib/session.ts), dan di mode itu setiap form tulis disembunyikan karena
  // syaratnya `ctx.companyId && ...`. `npm run db:import:pilot` memberi
  // admin@agrovision.local akses ke DEV + PILOT, jadi sejak dataset pilot
  // diimpor SELURUH suite ini mati di AT2 dengan "Form tidak ditemukan" --
  // kegagalan harness, bukan kegagalan aplikasi. Memilih entitas di sini membuat
  // uji tidak lagi bergantung pada jumlah entitas yang dimiliki akun.
  if (company) {
    try {
      await s.submit("/dashboard", { companyId: company }, { formMarker: "companyId" });
    } catch {
      // Satu entitas: switcher memang tidak dirender, dan tidak perlu dipilih.
    }
  }
  return s;
};

/** Ambil id opsi <select> berdasarkan label yang tampil. */
function optionId(html, selectName, labelSubstring) {
  const sel = new RegExp(`<select[^>]*name="${selectName}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (!sel) return null;
  for (const o of sel[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</g)) {
    if (o[1] && o[2].includes(labelSubstring)) return o[1];
  }
  return null;
}

const money = (html, label) => {
  // Ambil angka rupiah pada baris tabel yang memuat `label`.
  const row = new RegExp(`${label}[\\s\\S]{0,600}?`).exec(html);
  return row ? [...row[0].matchAll(/Rp\s([\d.]+)/g)].map((m) => m[1]) : [];
};

async function psql(sql) {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("docker", ["compose", "exec", "-T", "db", "psql", "-U", "postgres",
    "-d", "agrovision", "-tAc", sql], { encoding: "utf8" });
  return out.trim();
}

// ORDER BY wajib: tanpa urutan deterministik, uji "setujui 2 dari 3" akan
// menyetujui baris berbeda tiap run dan angka harapannya jadi tidak stabil.
// Run sebelumnya lolos hanya karena kebetulan urutannya cocok.
const pendingIds = async (blkCode) =>
  (await psql(`SELECT ct.id FROM app.cost_transactions ct JOIN app.blocks b ON b.id=ct.block_id
               WHERE b.code='${blkCode}' AND ct.approval_status='submitted'
               ORDER BY ct.amount_idr`))
    .split("\n").filter(Boolean);

const approvedTotal = async (blkCode) => {
  const v = await psql(`SELECT COALESCE(total_cost_idr,0) FROM app.v_block_cost_summary
                        WHERE block_code='${blkCode}'`);
  return v ? Number(v) : null;
};

const fakeJpeg = () => {
  // JPEG minimal yang sah: SOI + APP0 + EOI. Cukup untuk lolos pemeriksaan MIME.
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  return { blob: new Blob([bytes], { type: "image/jpeg" }), name: "struk.jpg" };
};

// --------------------------------------------------------------------------

async function main() {
  console.log(`\nAcceptance test terhadap ${BASE}\n`);

  console.log("=== AT5 (bagian 1): tanpa sesi, halaman terlindungi ===");
  const anon = new Session("anon");
  const guard = await anon.get("/costing/pengeluaran");
  ok("tanpa login → redirect ke /login", guard.status === 307 && guard.location?.includes("/login"),
    `HTTP ${guard.status}`);

  console.log("\n=== Login tiga peran ===");
  const admin = await login("admin@agrovision.local");
  const creator = await login("creator@agrovision.local");
  const approver = await login("approver@agrovision.local");
  ok("super_admin, creator, approver semuanya bisa masuk", true);

  // Isolasi: bersihkan fixture run sebelumnya supaya hitungan tidak menumpuk.
  await psql(`DELETE FROM app.evidence_links WHERE entity_id IN (
                SELECT ct.id FROM app.cost_transactions ct JOIN app.blocks b ON b.id=ct.block_id
                 WHERE b.code LIKE 'UJI-%')`);
  await psql(`DELETE FROM app.cost_transactions WHERE block_id IN (
                SELECT id FROM app.blocks WHERE code LIKE 'UJI-%')`);
  // boundary_overlaps merujuk blok dua arah (block_a_id & block_b_id) tanpa
  // ON DELETE CASCADE -- disengaja, temuan overlap tidak boleh hilang sendiri.
  await psql(`DELETE FROM app.boundary_overlaps WHERE block_a_id IN (
                SELECT id FROM app.blocks WHERE code LIKE 'UJI-%')
                OR block_b_id IN (SELECT id FROM app.blocks WHERE code LIKE 'UJI-%')`);
  await psql(`DELETE FROM app.evidence_files WHERE block_id IN (
                SELECT id FROM app.blocks WHERE code LIKE 'UJI-%')`);
  await psql(`DELETE FROM app.blocks WHERE code LIKE 'UJI-%'`);
  // Terbatas ke entitas uji. Versi sebelumnya menghapus SEMUA anggaran lintas
  // tenant — dan benar-benar menyapu data demo saat suite ini dijalankan.
  await psql(`DELETE FROM app.budgets WHERE company_id='00000000-0000-4000-8000-000000000001'`);
  await psql(`DELETE FROM app.fiscal_periods WHERE code LIKE 'FASE-UJI%'`);
  // URUTAN PENTING: baris tarif fixture dihapus SEBELUM master_items, karena sejak
  // AI-44b tarif bisa menunjuk kategori uji (price_list_cost_category_id_fkey) dan
  // menghapus kategorinya lebih dulu akan gagal FK.
  // audit_log lebih dulu lagi: trigger price_list_audit (0041 §8) menulis satu baris
  // per perubahan dengan entity_id yang menunjuk ke sini. price_list append-only
  // untuk aplikasi, tapi psql ini superuser.
  await psql(`DELETE FROM app.audit_log WHERE entity_type='price_list' AND entity_id IN (
                SELECT id FROM app.price_list WHERE code LIKE 'UJITARIF%')`);
  await psql(`DELETE FROM app.price_list WHERE code LIKE 'UJITARIF%'`);
  await psql(`DELETE FROM app.master_items WHERE code LIKE 'TEST%'`);
  // Inbox harus terisolasi: sisa transaksi 'submitted' dari run lama akan
  // membuat hitungan item dan pemilihan baris ikut kacau.
  await psql(`DELETE FROM app.evidence_links WHERE entity_id IN (
                SELECT id FROM app.cost_transactions WHERE approval_status='submitted'
                  AND company_id='00000000-0000-4000-8000-000000000001')`);
  await psql(`DELETE FROM app.cost_transactions WHERE approval_status='submitted'
                AND company_id='00000000-0000-4000-8000-000000000001'`);

  const stamp = Date.now().toString().slice(-6);

  // URUTAN PENTING: form Pengeluaran sengaja disembunyikan selama prasyarat
  // (kategori biaya + blok) belum ada. Jadi blok dibuat lebih dulu, baru
  // dropdown diperiksa -- kalau tidak, yang terlihat "hilang" hanyalah form
  // yang memang belum dirender.
  console.log("\n=== AT2: blok baru + luas dihitung PostGIS ===");
  const blkCode = `UJI-${stamp}`;
  const blokPage = await creator.get("/operasional/blok");
  const estId = optionId(blokPage.html, "estateId", "Estate");
  ok("dropdown estate terisi dari database", Boolean(estId));

  const geo = JSON.stringify({
    type: "Polygon",
    coordinates: [[[114, -2], [114.009, -2], [114.009, -2.009], [114, -2.009], [114, -2]]],
  });
  await creator.submit("/operasional/blok",
    { estateId: estId, code: blkCode, name: "Blok Uji", boundarySource: "gps_survey", geojson: geo },
    { formMarker: "estateId" });

  const blokAfter = await creator.get("/operasional/blok");
  ok("blok baru tampil di daftar", blokAfter.html.includes(blkCode));
  ok("luas dihitung PostGIS (~99,64 ha)", /99,64/.test(blokAfter.html),
    /(\d+,\d+) ha/.exec(blokAfter.html)?.[0] ?? "tidak ditemukan");

  console.log("\n=== AT1: super_admin menambah master -> muncul di dropdown form lain ===");
  const catCode = `TEST${stamp}`;
  const catName = `Kategori Uji ${stamp}`;
  await admin.submit("/pengaturan/master-data?tipe=cost_category",
    { code: catCode, name: catName, sortOrder: 9 }, { formMarker: "masterTypeCode" });
  const mdAfter = await admin.get("/pengaturan/master-data?tipe=cost_category");
  ok("item baru tampil di layar master data", mdAfter.html.includes(catName));

  const expPage = await creator.get("/costing/pengeluaran");
  const catId = optionId(expPage.html, "costCategoryId", catName);
  const blkId = optionId(expPage.html, "blockId", blkCode);
  ok("kategori baru muncul di dropdown Pengeluaran", Boolean(catId), "tanpa perubahan kode");
  ok("blok baru muncul di dropdown Pengeluaran", Boolean(blkId));

  console.log("\n=== Fase proyek (prasyarat perbandingan anggaran) ===");
  await admin.submit("/costing/anggaran",
    { code: `FASE-UJI${stamp}`, name: `Fase Uji ${stamp}`,
      startsOn: "2026-01-01", endsOn: "2026-12-31" },
    { formMarker: 'name="startsOn"' });
  ok("fase proyek dibuat lewat UI",
    Number(await psql(`SELECT count(*) FROM app.fiscal_periods WHERE code='FASE-UJI${stamp}'`)) === 1);

  console.log("\n=== AT3: 3 pengeluaran -> total & cost/ha bergerak ===");
  if (!catId || !blkId) {
    ok("prasyarat AT3 tersedia", false, "kategori atau blok tidak ada di dropdown");
  } else {
    for (const amount of [3000000, 4000000, 5000000]) {
      await creator.submit("/costing/pengeluaran",
        { isOverhead: "false", blockId: blkId, costCategoryId: catId,
          transactionDate: "2026-03-01", amountIdr: String(amount) },
        { formMarker: "isOverhead", files: { evidence: fakeJpeg() } });
    }

    let page = await creator.get(`/costing/pengeluaran?status=draft&q=${blkCode}`);
    // Hanya badge status, bukan <option> pada filter status.
    const draftCount = (visible(page.html).match(/>Draft</g) ?? []).length - 1; // -1: <option> di filter
    ok("3 transaksi tersimpan sebagai draft", draftCount === 3, `${draftCount} draft`);
    ok("bukti pembelian terlampir tiap transaksi",
      (page.html.match(/aria-hidden="true"[^>]*><path[^>]*\/><\/svg>\s*1/g) ?? []).length >= 0);

    // Draft belum boleh mempengaruhi angka.
    const beforeApprove = await creator.get("/costing/pengeluaran");
    ok("draft BELUM masuk total disetujui",
      beforeApprove.html.includes("Belum ada pengeluaran disetujui"), "KPI masih em dash");

    console.log("\n=== AT4: ajukan -> setujui -> angka masuk perhitungan ===");
    let submitted = 0;
    for (let i = 0; i < 3; i++) {
      page = await creator.get(`/costing/pengeluaran?status=draft&q=${blkCode}`);
      if (!pickForm(page.html, 'ajukan-pengeluaran')) break;
      const r = await creator.submit(`/costing/pengeluaran?status=draft&q=${blkCode}`, {},
        // Penanda HARUS spesifik: sejak AI-11 baris draft/ditolak punya DUA form
        // ber-`name="id"` (editor "Ubah" dan tombol "Ajukan"), dan editor muncul
        // lebih dulu di DOM. Penanda `name="id"` akan menembak editornya sehingga
        // record tidak pernah diajukan -- dan kegagalannya muncul jauh di AT4
        // sebagai "0 approved", bukan di sini.
        { formMarker: 'ajukan-pengeluaran' });
      if (r.status < 400) submitted++;
    }
    ok("3 draft diajukan", submitted === 3, `${submitted} diajukan`);

    const ids = await pendingIds(blkCode);
    ok("3 transaksi berstatus submitted di database", ids.length === 3, `${ids.length} submitted`);

    // Muncul di Inbox Approval milik approver.
    const inbox = await approver.get("/approval");
    const inboxRows = (visible(inbox.html).match(new RegExp(blkCode, "g")) ?? []).length;
    ok("3 item blok uji tampil di Inbox Approval", inboxRows === 3, `${inboxRows} item`);

    // creator TIDAK boleh memutuskan.
    const creatorInbox = await creator.get("/approval");
    ok("creator tidak melihat tombol keputusan",
      !creatorInbox.html.includes("Setujui"), "hanya bisa melihat");

    console.log("\n=== AT4: setujui 2, tolak 1 -> angka laporan mengikuti ===");
    for (const id of ids.slice(0, 2)) {
      await approver.submit("/approval", { id, decision: "approved" },
        { formMarker: 'value="approved"' });
    }
    // Diverifikasi ke DATABASE, bukan dari HTTP status: Server Action yang
    // menolak tetap mengembalikan HTTP 200 dengan {ok:false}.
    const approvedCount = Number(await psql(
      `SELECT count(*) FROM app.cost_transactions ct JOIN app.blocks b ON b.id=ct.block_id
        WHERE b.code='${blkCode}' AND ct.approval_status='approved'`));
    ok("2 transaksi benar-benar disetujui di database", approvedCount === 2,
      `${approvedCount} approved`);

    const rejectId = ids[2];
    await approver.submit("/approval",
      { id: rejectId, decision: "rejected", reason: "Foto struk tidak terbaca" },
      { formMarker: 'value="rejected"' });
    const rejectedRow = await psql(
      `SELECT rejection_reason FROM app.cost_transactions
        WHERE id='${rejectId}' AND approval_status='rejected'`);
    ok("1 transaksi ditolak beserta alasannya", rejectedRow.includes("tidak terbaca"),
      rejectedRow || "tidak ditolak");

    // Penolakan tanpa alasan HARUS gagal -- ditegakkan CHECK constraint.
    const noReason = await psql(
      `UPDATE app.cost_transactions SET approval_status='rejected', rejection_reason=NULL ` +
      `WHERE id='${ids[0]}' RETURNING 1`).catch((e) => String(e));
    ok("penolakan tanpa alasan ditolak database",
      /ct_rejection_needs_reason|violates check/i.test(String(noReason)),
      "CHECK constraint aktif");

    // INTI AT3+AT4: hanya yang disetujui masuk perhitungan.
    const total = await approvedTotal(blkCode);
    ok("total = 7.000.000 (2 disetujui, 1 ditolak dikecualikan)", total === 7_000_000,
      total === null ? "tidak ada baris" : `Rp ${total.toLocaleString("id-ID")}`);

    const perHa = await psql(`SELECT round(cost_per_ha_idr) FROM app.v_block_cost_summary
                              WHERE block_code='${blkCode}'`);
    // 7.000.000 / 99,6441 ha = 70.250/ha
    ok("cost per ha dihitung dari luas PostGIS", Number(perHa) === 70250,
      `Rp ${Number(perHa).toLocaleString("id-ID")}/ha`);

    const uiAfter = await approver.get("/costing/pengeluaran");
    ok("KPI di UI ikut berubah dari em dash", !uiAfter.html.includes("Belum ada pengeluaran disetujui"));
    ok("nilai yang ditolak TIDAK muncul di ringkasan biaya",
      !uiAfter.html.includes("12.000.000"), "hanya 7.000.000 yang dihitung");

    const inboxAfter = await approver.get("/approval");
    ok("item blok uji hilang dari inbox setelah diputuskan",
      !new RegExp(blkCode).test(visible(inboxAfter.html)));
  }

  console.log("\n=== AT3 lanjutan: anggaran -> Laporan Keuangan bergerak ===");
  {
    const admin2 = admin;
    // Periode transaksi diturunkan otomatis dari tanggalnya -- dibuktikan di sini.
    const derived = await psql(
      `SELECT count(*) FROM app.cost_transactions ct JOIN app.blocks b ON b.id=ct.block_id
        WHERE b.code='${blkCode}' AND ct.fiscal_period_id IS NOT NULL`);
    ok("periode fiskal terisi otomatis dari tanggal transaksi", Number(derived) === 3,
      `${derived} dari 3 transaksi`);

    // Anggaran per BLOK -- inilah lingkup yang dituntut AT3.
    const anggaranPage = await admin2.get("/costing/anggaran");
    const perId = optionId(anggaranPage.html, "fiscalPeriodId", `Fase Uji ${stamp}`);
    const catId2 = optionId(anggaranPage.html, "costCategoryId", `Kategori Uji ${stamp}`);
    const blkId2 = optionId(anggaranPage.html, "blockId", blkCode);
    ok("dropdown anggaran terisi dari database", Boolean(perId && catId2 && blkId2));

    await admin2.submit("/costing/anggaran",
      { fiscalPeriodId: perId, costCategoryId: catId2, scopeType: "block",
        blockId: blkId2, estateId: "", amountIdr: "6000000" },
      { formMarker: 'data-testid="susun-anggaran"' });

    // Anggaran 6jt vs realisasi 7jt -> harus terlampaui.
    const row = await psql(`SELECT budget_idr||'|'||actual_idr||'|'||is_over_budget
                            FROM app.v_budget_vs_actual WHERE block_id='${blkId2}'`);
    ok("satu baris anggaran = satu baris perbandingan", row.split("\n").length === 1, row);
    ok("realisasi 7jt dibandingkan ke anggaran 6jt -> terlampaui",
      row.includes("6000000") && row.includes("7000000") && row.endsWith("|true"), row);

    const rpt = await admin2.get("/laporan/keuangan");
    // Dulu layar mencetak kode definisi & nama base view apa adanya; laporan yang
    // dirancang ulang (registry + screens.ts) sengaja tidak lagi memamerkan nama
    // view SQL ke manajemen. Yang tetap bermakna diuji: halamannya benar dirakit
    // lewat jalur definisi itu — dibuktikan dari isi yang HANYA bisa berasal dari
    // v_budget_vs_actual (pasangan anggaran-realisasi), bukan dari nama viewnya.
    ok("Laporan Keuangan dirakit dari jalur definisi (anggaran vs realisasi)",
      /Anggaran/i.test(rpt.html) && /[Rr]ealisasi/i.test(rpt.html));
    ok("laporan menampilkan anggaran terlampaui", /anggaran terlampaui/i.test(rpt.html));
    ok("laporan menampilkan total & cost per ha nyata",
      rpt.html.includes("7.000.000") && rpt.html.includes("70.250"));
    ok("pendapatan & break-even tetap kosong jujur (belum ada panen)",
      /sengaja kosong/.test(rpt.html));
  }

  console.log("\n=== AI-44b: ubah metadata tarif dari UI (K-09 §19) ===");
  {
    // Kategori akuntansi adalah kunci pembanding anggaran. Sebelum AI-44b ia hanya
    // bisa diisi seed/SQL, jadi setiap tenant baru butuh developer sebelum serapan
    // anggarannya terisi -- itulah B-20 yang muncul lagi di instalasi baru.
    const kode = `UJITARIF-META${stamp}`;
    await admin.submit("/costing/refleksi",
      { code: kode, kind: "cost", category: `Uji meta ${stamp}`, unit: "ha",
        rateIdr: "1000", berlakuDari: "2026-09-02", driver: "", costCategoryId: "", note: "" },
      { formMarker: 'data-testid="tambah-tarif"' });
    const belum = await psql(`SELECT coalesce(cost_category_id::text,'NULL') FROM app.price_list WHERE code='${kode}'`);
    ok("tarif baru lahir tanpa kategori akuntansi", belum === "NULL", belum);

    const MARK = `data-testid="ubah-meta-${kode}"`;
    const page = await admin.get("/costing/refleksi");
    ok("editor metadata ada di HTML server (jalan tanpa JavaScript)", Boolean(pickForm(page.html, MARK)));
    ok("baris tanpa kategori ditandai di layar", /belum dipetakan/.test(page.html));

    // Entitas DEV sengaja bermaster-data KOSONG (db:seed:dev), jadi kategori yang
    // dipakai adalah yang dibuat AT1 di atas -- bukan kategori demo.
    const catId = optionId(page.html, "costCategoryId", `Kategori Uji ${stamp}`);
    ok("dropdown kategori akuntansi terisi kategori INDUK", Boolean(catId), catName);

    await admin.submit("/costing/refleksi",
      { id: await psql(`SELECT id FROM app.price_list WHERE code='${kode}'`),
        category: `Uji meta diperbaiki ${stamp}`, costCategoryId: catId, note: "dipetakan lewat UI", isActive: "true" },
      { formMarker: MARK });
    const sesudah = await psql(`SELECT coalesce(cost_category_id::text,'NULL')||'|'||category FROM app.price_list WHERE code='${kode}'`);
    ok("kategori akuntansi & label tersimpan dari UI",
      sesudah.startsWith(catId) && sesudah.includes("diperbaiki"), sesudah.slice(0, 60));

    // Nonaktifkan: harus benar-benar tersimpan false. Ini yang gagal bila form
    // memakai checkbox -- checkbox tak dicentang tidak terkirim, dan fungsi
    // database memakai COALESCE, jadi terbaca "jangan ubah".
    await admin.submit("/costing/refleksi",
      { id: await psql(`SELECT id FROM app.price_list WHERE code='${kode}'`),
        category: "", costCategoryId: catId, note: "", isActive: "false" },
      { formMarker: MARK });
    // ::text disengaja: psql mencetak kolom boolean apa adanya sebagai `f`/`t`,
    // dan hanya cast ke text yang memberi `false`/`true`.
    ok("status nonaktif benar-benar tersimpan (bukan diabaikan COALESCE)",
      (await psql(`SELECT is_active::text FROM app.price_list WHERE code='${kode}'`)) === "false");

    // Gerbang peran: creator tidak melihat editornya, dan POST langsung ditolak.
    const refCreator = await creator.get("/costing/refleksi");
    ok("creator tidak melihat editor metadata", pickForm(refCreator.html, MARK) === null);
    const f = pickForm(page.html, MARK);
    const fd = new FormData();
    for (const [k, v] of Object.entries(f.hidden)) fd.append(k, v);
    fd.set("id", await psql(`SELECT id FROM app.price_list WHERE code='${kode}'`));
    fd.set("category", "DISUSUPI"); fd.set("isActive", "true");
    await fetch(`${BASE}/costing/refleksi`, {
      method: "POST", headers: { cookie: creator.header() }, body: fd, redirect: "manual",
    });
    ok("POST langsung oleh creator tidak mengubah metadata",
      !(await psql(`SELECT category FROM app.price_list WHERE code='${kode}'`)).includes("DISUSUPI"));
  }

  console.log("\n=== AI-05: form anggaran dinamis + pasangan lingkup↔pengenal ===");
  {
    const MARK = 'data-testid="susun-anggaran"';
    const page = await admin.get("/costing/anggaran");
    const form = pickForm(page.html, MARK);
    ok("form anggaran ada di HTML server", Boolean(form));

    // Inti syarat AI-05: SELURUH field harus ada di HTML server, dan tidak ada
    // yang sudah disabled/hidden sejak render pertama. Kalau show/hide dihitung
    // dari state awal, lingkup estate/blok jadi mustahil diisi tanpa JavaScript.
    const html = /<form[^>]*data-testid="susun-anggaran"[^>]*>[\s\S]*?<\/form>/.exec(page.html)?.[0] ?? "";
    const semuaField = ["fiscalPeriodId", "costCategoryId", "scopeType", "estateId", "blockId", "amountIdr"]
      .filter((n) => !html.includes(`name="${n}"`));
    ok("keenam field anggaran ada di HTML server (jalan tanpa JavaScript)",
      semuaField.length === 0, semuaField.join(", ") || "lengkap");
    ok("tidak ada field yang sudah disembunyikan di HTML server",
      !/<select[^>]*disabled/.test(html) && !/class="hidden"/.test(html));

    const perId = optionId(page.html, "fiscalPeriodId", `Fase Uji ${stamp}`);
    const catId3 = optionId(page.html, "costCategoryId", `Kategori Uji ${stamp}`);
    const estId3 = optionId(page.html, "estateId", "Estate");
    const blkId3 = optionId(page.html, "blockId", blkCode);
    ok("dropdown lingkup terisi dari database", Boolean(perId && catId3 && estId3 && blkId3));

    const jumlah = async () =>
      Number(await psql(`SELECT count(*) FROM app.budgets
                          WHERE company_id='${DEV_COMPANY}' AND fiscal_period_id='${perId}'`));
    const kirim = (extra) => admin.submit("/costing/anggaran",
      { fiscalPeriodId: perId, costCategoryId: catId3, amountIdr: "1500000", note: "", ...extra },
      { formMarker: MARK });

    // Enam pasangan yang HARUS ditolak. Sebelum AI-05 tiga di antaranya
    // "berhasil": createBudget() mem-NULL-kan pengenal yang tidak cocok, jadi
    // pengguna mendapat "Anggaran tersimpan" untuk lingkup yang BUKAN pilihannya.
    const tolak = [
      ["lingkup entitas + estate terisi", { scopeType: "company", estateId: estId3, blockId: "" }, /tidak memakai estate/],
      ["lingkup entitas + blok terisi", { scopeType: "company", estateId: "", blockId: blkId3 }, /tidak memakai blok/],
      ["lingkup estate tanpa estate", { scopeType: "estate", estateId: "", blockId: "" }, /wajib memilih estate/],
      ["lingkup estate + blok terisi", { scopeType: "estate", estateId: estId3, blockId: blkId3 }, /tidak memakai blok/],
      ["lingkup blok tanpa blok", { scopeType: "block", estateId: "", blockId: "" }, /wajib memilih blok/],
      ["lingkup blok + estate terisi", { scopeType: "block", estateId: estId3, blockId: blkId3 }, /tidak memakai estate/],
    ];
    for (const [nama, extra, pesan] of tolak) {
      const sebelum = await jumlah();
      const r = await kirim(extra);
      const sesudah = await jumlah();
      ok(`${nama} DITOLAK dan menyebut sebabnya`,
        sesudah === sebelum && pesan.test(r.html),
        sesudah === sebelum ? "" : "anggaran TERBUAT padahal seharusnya ditolak");
    }

    // Dua pasangan yang sah. Lingkup blok sudah dipakai AT3 di atas dengan grain
    // yang sama, jadi di sini dipakai company & estate supaya tidak menabrak
    // budgets_grain_uniq -- kegagalan itu akan terbaca seperti AI-05 gagal.
    for (const [nama, extra, kolom] of [
      ["lingkup seluruh entitas", { scopeType: "company", estateId: "", blockId: "" }, "estate_id IS NULL AND block_id IS NULL"],
      ["lingkup estate", { scopeType: "estate", estateId: estId3, blockId: "" }, `estate_id='${estId3}' AND block_id IS NULL`],
    ]) {
      const r = await kirim(extra);
      const n = Number(await psql(`SELECT count(*) FROM app.budgets
                                    WHERE company_id='${DEV_COMPANY}' AND fiscal_period_id='${perId}'
                                      AND scope_type='${extra.scopeType}' AND ${kolom}`));
      ok(`${nama} tersimpan dengan pengenal yang benar`, n === 1 && /Anggaran tersimpan/.test(r.html),
        `${n} baris`);
    }
  }

  console.log("\n=== AT2 lengkap: peta merender polygon dari database ===");
  {
    // Endpoint peta harus tertutup tanpa sesi.
    const anonGeo = await fetch(`${BASE}/api/blocks/geojson`, { redirect: "manual" });
    ok("/api/blocks/geojson tanpa sesi -> 401", anonGeo.status === 401, `HTTP ${anonGeo.status}`);

    const geoRes = await fetch(`${BASE}/api/blocks/geojson`, {
      headers: { cookie: creator.header() },
    });
    const fc = await geoRes.json();
    ok("GeoJSON FeatureCollection terbentuk", fc.type === "FeatureCollection");
    const feat = (fc.features ?? []).find((f) => f.properties?.code === blkCode);
    ok("polygon blok uji ada di peta", Boolean(feat));
    ok("luas di properties dari PostGIS", feat && Math.abs(feat.properties.areaHa - 99.6441) < 0.01,
      feat ? `${feat.properties.areaHa} ha` : "tidak ada");
    ok("id tersedia di properties (MapLibre butuh ini untuk klik)",
      Boolean(feat?.properties?.id));

    // Klik blok -> data biaya hidup (concept:46).
    const sumRes = await fetch(`${BASE}/api/blocks/${feat.properties.id}/summary`, {
      headers: { cookie: creator.header() },
    });
    const sum = await sumRes.json();
    // Pesannya WAJIB membedakan null dari 0: `Number(null)` = 0 membuat "belum ada
    // data" tercetak sebagai "Rp 0", dan itu menyesatkan pembaca laporan uji ini
    // persis seperti angka fabrikasi menyesatkan pembaca dashboard.
    const rp = (v) => (v === null || v === undefined ? "—" : `Rp ${Math.round(v).toLocaleString("id-ID")}`);
    ok("klik blok menarik biaya hidupnya", sum.totalCostIdr === 7_000_000, rp(sum.totalCostIdr));
    ok("cost per ha ikut terbawa", Math.round(sum.costPerHaIdr) === 70_250,
      `${rp(sum.costPerHaIdr)}/ha`);

    // Isolasi tenant: 404, bukan 403 -- keberadaan blok tenant lain tidak dibocorkan.
    const other = await psql(
      `SELECT id FROM app.blocks WHERE company_id <> '00000000-0000-4000-8000-000000000001' LIMIT 1`);
    if (other) {
      const r = await fetch(`${BASE}/api/blocks/${other}/summary`, {
        headers: { cookie: creator.header() },
      });
      ok("blok tenant lain -> 404 (bukan 403)", r.status === 404, `HTTP ${r.status}`);
    }

    const bad = await fetch(`${BASE}/api/blocks/bukan-uuid/summary`, {
      headers: { cookie: creator.header() },
    });
    ok("id tidak valid -> 400", bad.status === 400, `HTTP ${bad.status}`);

    const blokPage2 = await creator.get("/operasional/blok");
    ok("halaman blok memuat MapLibre + basemap gratis",
      /maplibre/.test(blokPage2.html) && /Sentinel-2/.test(blokPage2.html));
  }

  console.log("\n=== AI-44a: tambah baris tarif baru (K-09 §19) ===");
  {
    // Penanda form adalah data-testid, BUKAN prosa: halaman ini punya beberapa
    // <form> (satu per baris tarif untuk penerbitan versi), dan mencocokkan
    // kalimat membuat uji menembak form yang salah -- kegagalannya lalu muncul
    // jauh kemudian sebagai angka yang aneh.
    const MARK = 'data-testid="tambah-tarif"';
    const refAdmin = await admin.get("/costing/refleksi");
    ok("form tambah tarif ADA di HTML server (jalan tanpa JavaScript)",
      Boolean(pickForm(refAdmin.html, MARK)));

    // Gerbang peran: tarif adalah pengendali seluruh angka keuangan, jadi
    // creator/approver tidak boleh melihat FORM-nya maupun berhasil POST.
    const refCreator = await creator.get("/costing/refleksi");
    ok("creator tidak melihat form tambah tarif", pickForm(refCreator.html, MARK) === null);
    const refApprover = await approver.get("/costing/refleksi");
    ok("approver tidak melihat form tambah tarif", pickForm(refApprover.html, MARK) === null);

    const kode = `UJITARIF-REV${stamp}`;
    const kodeBiaya = `UJITARIF-WEED${stamp}`;
    const nilai = 7_500_000;

    // POST langsung oleh creator: hidden field $ACTION_* dipinjam dari sesi
    // admin, jadi yang diuji benar-benar gerbang server -- bukan UI yang
    // menyembunyikan tombol.
    const formAdmin = pickForm(refAdmin.html, MARK);
    const fd = new FormData();
    for (const [k, v] of Object.entries(formAdmin.hidden)) fd.append(k, v);
    for (const [k, v] of Object.entries({ code: `${kode}-CURANG`, kind: "revenue",
      category: "Curang", unit: "ton", rateIdr: "1", berlakuDari: "2026-09-01", driver: "" })) fd.set(k, v);
    await fetch(`${BASE}/costing/refleksi`, {
      method: "POST", headers: { cookie: creator.header() }, body: fd, redirect: "manual",
    });
    ok("POST langsung oleh creator tidak membuat baris tarif",
      Number(await psql(`SELECT count(*) FROM app.price_list WHERE code='${kode}-CURANG'`)) === 0);

    // Jalur bahagia: baris revenue baru -- ini kasus yang memblokir K-03
    // (harga per grade = satu baris revenue per grade).
    await admin.submit("/costing/refleksi",
      { code: kode, kind: "revenue", category: `Durian grade B uji ${stamp}`, unit: "ton",
        rateIdr: String(nilai), berlakuDari: "2026-09-01", driver: "", costCategoryId: "", note: "" },
      { formMarker: MARK });
    const dbRow = await psql(`SELECT kind||'|'||unit||'|'||rate_idr::int||'|'||version||'|'||
                                     COALESCE(driver,'-')||'|'||is_active
                                FROM app.price_list WHERE code='${kode}'`);
    ok("baris revenue baru tercatat sebagai versi 1 yang berlaku",
      dbRow === `revenue|ton|${nilai}|1|-|true`, dbRow || "tidak ada baris");

    const refAfter = await admin.get("/costing/refleksi");
    ok("baris baru tampil di tabel Price List", refAfter.html.includes(kode));
    // Tiga kolom yang sebelumnya tidak pernah terlihat (K-09 konsekuensi 2).
    ok("kolom driver/satuan/status tampil di Price List",
      /Driver volume/.test(refAfter.html) && /tarif manual/.test(refAfter.html)
      && /Aktif/.test(refAfter.html));

    // Driver: satu tarif aktif per driver (indeks 0046). Baris pertama boleh,
    // baris kedua dengan driver sama harus ditolak dengan pesan yang menyebut
    // sebabnya -- bukan galat constraint mentah.
    await admin.submit("/costing/refleksi",
      { code: kodeBiaya, kind: "cost", category: `Penyiangan uji ${stamp}`, unit: "ha",
        rateIdr: "1000", berlakuDari: "2026-09-01", driver: "weeding_area_ha",
        costCategoryId: "", note: "" },
      { formMarker: MARK });
    ok("baris biaya ber-driver dibuat",
      Number(await psql(`SELECT count(*) FROM app.price_list WHERE code='${kodeBiaya}'`)) === 1);

    const dobel = await admin.submit("/costing/refleksi",
      { code: `${kodeBiaya}-B`, kind: "cost", category: "Penyiangan dobel", unit: "ha",
        rateIdr: "1", berlakuDari: "2026-09-01", driver: "weeding_area_ha",
        costCategoryId: "", note: "" },
      { formMarker: MARK });
    ok("driver kedua yang sama DITOLAK dengan sebab yang dijelaskan",
      Number(await psql(`SELECT count(*) FROM app.price_list WHERE code='${kodeBiaya}-B'`)) === 0
      && /dihitung dua kali/.test(dobel.html));

    // Pasangan salah (revenue + driver) ditolak zod di server, bukan hanya UI.
    const salah = await admin.submit("/costing/refleksi",
      { code: `${kode}-SALAH`, kind: "revenue", category: "Pasangan salah", unit: "ton",
        rateIdr: "1", berlakuDari: "2026-09-01", driver: "weeding_area_ha",
        costCategoryId: "", note: "" },
      { formMarker: MARK });
    ok("revenue + driver DITOLAK di server",
      Number(await psql(`SELECT count(*) FROM app.price_list WHERE code='${kode}-SALAH'`)) === 0
      && /tidak memakai driver/.test(salah.html));
  }

  console.log("\n=== db:purge:demo tidak boleh menyimpang dari skema ===");
  {
    // `db:purge:demo` adalah daftar DELETE yang dipelihara TANGAN, jadi ia diam-diam
    // menyimpang dari skema setiap kali ada migrasi yang menambah tabel ber-FK ke data
    // demo. Pada 24 Agu 2026 ada 16 tabel yang luput; dua sudah terisi dan benar-benar
    // mematahkan purge dengan "violates foreign key constraint
    // agri_input_stock_movements_chemical_id_fkey".
    //
    // Bukan cacat kosmetik: app.check_production_readiness() MENYURUH menjalankan
    // db:purge:demo untuk membersihkan data demo sebelum deploy publik. Selama purge
    // tidak bisa selesai, penghalang itu tidak pernah bisa dibereskan.
    //
    // Uji ini TIDAK menjalankan purge — itu akan menghapus data yang dipakai cek lain.
    // Ia membandingkan daftar DELETE terhadap tabel yang BENAR-BENAR berisi baris milik
    // entitas demo, jadi penyimpangan berikutnya muncul sebagai uji gagal, bukan sebagai
    // perintah yang mati justru saat dibutuhkan.
    const { readFileSync } = await import("node:fs");
    const seed = readFileSync("db/seed-demo.mjs", "utf8");
    const adaDelete = new Set([...seed.matchAll(/DELETE FROM app\.(\w+)/g)].map((m) => m[1]));

    const berFk = (await psql(`
      SELECT DISTINCT tc.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='app'
         AND ccu.table_name IN ('companies','blocks','plots','agri_input_chemicals','seed_batches')
       ORDER BY 1`)).split("\n").map((x) => x.trim()).filter(Boolean);

    const luput = berFk.filter((t) => !adaDelete.has(t));
    const berisi = [];
    for (const t of luput) {
      const punya = await psql(`SELECT column_name FROM information_schema.columns
                                 WHERE table_schema='app' AND table_name='${t}' AND column_name='company_id'`);
      if (!punya) continue;
      const n = Number(await psql(`SELECT count(*) FROM app.${t}
        WHERE company_id IN (SELECT id FROM app.companies WHERE is_demo AND code IN ('DEMO','DEMO2'))`));
      if (n > 0) berisi.push(`${t} (${n} baris)`);
    }
    ok("nol tabel berisi data demo yang luput dari daftar purge", berisi.length === 0,
      berisi.join(", ") || `${luput.length} tabel luput, semuanya kosong`);
  }

  console.log("\n=== Dataset demo: serapan anggaran masuk akal DAN menguji peringatan ===");
  {
    // Sebelum ini nilai pengeluaran seed tidak punya hubungan dengan anggaran
    // induknya, jadi kategori beranggaran kecil pasti terlampaui jauh — Servis
    // Kendaraan 346%, Pestisida 305%, Jasa Survei 247%. Bagi orang yang melihat
    // demo, itu terbaca seperti aplikasinya salah hitung.
    //
    // Yang dijaga di sini DUA arah sekaligus: angkanya wajar, TAPI tetap ada yang
    // terlampaui — kalau semuanya di bawah 100%, jalur peringatan "anggaran
    // terlampaui" tidak pernah dijalankan demo mana pun.
    const DEMO = "(SELECT id FROM app.companies WHERE code='DEMO')";
    const kosong = Number(await psql(
      `SELECT count(*) FROM app.v_budget_vs_actual WHERE company_id=${DEMO} AND actual_idr IS NULL`));
    ok("setiap baris anggaran demo punya realisasi", kosong === 0, `${kosong} baris tanpa realisasi`);

    const ekstrem = await psql(
      `SELECT coalesce(string_agg(cost_category_name||' '||utilisation_pct||'%', ', '), '')
         FROM app.v_budget_vs_actual
        WHERE company_id=${DEMO} AND (utilisation_pct < 25 OR utilisation_pct > 150)`);
    ok("nol serapan demo di luar rentang wajar 25–150%", ekstrem === "", ekstrem || "seluruhnya wajar");

    const lampau = Number(await psql(
      `SELECT count(*) FROM app.v_budget_vs_actual WHERE company_id=${DEMO} AND is_over_budget`));
    ok("ada anggaran terlampaui, supaya jalur peringatan teruji", lampau >= 1 && lampau <= 3,
      `${lampau} kategori terlampaui`);
  }

  console.log("\n=== AI-24: filter dashboard benar-benar mengubah angka ===");
  {
    // Sebelum ini ketiga dashboard merender bilah filter berisi <div> ber-ikon
    // ChevronDown — terlihat seperti dropdown, tapi tanpa <select>, tanpa <form>,
    // tanpa tautan. Diklik tidak melakukan apa pun dan nilainya dipatok. Jadi yang
    // diuji di sini BUKAN "URL-nya berubah", tapi "angkanya berubah".
    const angka = (html) => [...visible(html).matchAll(/>([0-9][0-9.,]{0,12})</g)].map((m) => m[1]).join("|");

    // Sesi entitas DEMO, bukan DEV: entitas DEV hampir tanpa data operasional, jadi
    // filter apa pun di sana tidak mengubah angka apa pun dan uji "angkanya berubah"
    // akan gagal karena ketiadaan data — bukan karena filternya rusak.
    const demoAdmin = await login("admin@demo.invalid", { company: "00000000-0000-4000-8000-0000000000d0" });

    const base = await demoAdmin.get("/dashboard");
    ok("bilah filter adalah <form method=GET>, bukan div mati",
      /<form[^>]*method="GET"[^>]*data-testid="filter-dashboard"|data-testid="filter-dashboard"[^>]*method="GET"/.test(base.html)
      || (/data-testid="filter-dashboard"/.test(base.html) && /method="GET"/.test(base.html)));
    const kotak = (base.html.match(/type="checkbox"[^>]*name="(estate|blok|periode|komoditas)"/g) ?? []).length;
    ok("keempat dimensi multi-pilih lewat checkbox", kotak >= 4, `${kotak} checkbox`);

    const blok = /name="blok" value="([^"]+)"/.exec(base.html)?.[1];
    const est = /name="estate" value="([^"]+)"/.exec(base.html)?.[1];
    ok("opsi filter terisi dari database", Boolean(blok && est));

    const satuBlok = await demoAdmin.get(`/dashboard?blok=${blok}`);
    ok("angka dashboard BERUBAH saat satu blok dipilih", angka(base.html) !== angka(satuBlok.html));
    ok("pilihan tetap tercentang setelah diterapkan (keadaan ada di URL)",
      (satuBlok.html.match(/name="blok"[^>]*checked/g) ?? []).length === 1);
    ok("tombol Bersihkan hanya muncul saat filter aktif",
      /Bersihkan/.test(satuBlok.html) && !/Bersihkan/.test(base.html));

    const satuEstate = await demoAdmin.get(`/dashboard?estate=${est}`);
    ok("angka dashboard BERUBAH saat satu estate dipilih", angka(base.html) !== angka(satuEstate.html));

    // Kejujuran filter: tiga tabel aktivitas tidak punya dimensi komoditas.
    const kom = await demoAdmin.get("/dashboard?komoditas=DURIAN");
    ok("filter komoditas menjelaskan metrik yang tidak bisa mengikutinya",
      /tidak menyimpan komoditas/.test(kom.html));

    // Bagian 2: dua dashboard lain memakai KOMPONEN dan kontrak yang sama.
    //
    // Di sini nilai KPI dibaca lewat data-testid, BUKAN lewat pola `>angka<`
    // seperti dashboard Operasional di atas. Alasannya konkret: KPI kedua
    // dashboard ini dirender "Rp 1,2 jt" / "12,3" + unit dalam SATU node, jadi
    // pola `>angka<` tidak menangkapnya dan uji melaporkan "tidak berubah"
    // padahal berubah. Yang diperiksa adalah metrik yang memang HARUS berubah:
    // laba menjadi em-dash saat filter aktif (biaya perusahaan-lebar tidak bisa
    // dipersempit -- AKAR-2), demikian pula neraca karbon saat blok dipilih.
    const kpi = (html, key) => {
      const m = new RegExp(`data-testid="kpi-${key}"[^>]*>([\\s\\S]*?)</p>`).exec(html);
      return m ? m[1].replace(/<[^>]*>/g, "").trim() : null;
    };
    for (const [path, nama, key] of [
      ["/dashboard/financial", "Finansial", "profit"],
      ["/dashboard/sustainability", "Keberlanjutan", "carbon"],
    ]) {
      const p0 = await demoAdmin.get(path);
      ok(`${nama}: bilah filter bersama terpasang`, /data-testid="filter-dashboard"/.test(p0.html));
      const b = /name="blok" value="([^"]+)"/.exec(p0.html)?.[1];
      const p1 = await demoAdmin.get(`${path}?blok=${b}`);
      const v0 = kpi(p0.html, key), v1 = kpi(p1.html, key);
      // v0 harus ANGKA, bukan em-dash: kalau tanpa filter pun sudah em-dash,
      // "berubah menjadi em-dash" tidak membuktikan apa pun.
      ok(`${nama}: KPI ${key} punya angka tanpa filter`, Boolean(v0) && v0 !== "—", `${v0}`);
      ok(`${nama}: KPI ${key} jujur em-dash saat filter aktif`, v1 === "—", `${v0} -> ${v1}`);
      // Metrik yang TIDAK bisa mengikuti filter wajib dinyatakan, bukan didiamkan.
      ok(`${nama}: metrik yang tak bisa difilter dinyatakan alasannya`,
        /Tidak mengikuti filter/.test(p1.html));
    }

    // AI-24 bagian 3: panel "Struktur Biaya" dulu dipatok kosong selamanya
    // (hasCostStructure: false, dan view-nya bahkan tidak pernah membacanya),
    // sambil menjanjikan komposisi internal/outsource/kontrak -- sumbu yang tidak
    // ada kolomnya. Sekarang dihitung per kategori induk dari transaksi disetujui.
    const fin0 = await demoAdmin.get("/dashboard/financial");
    const strukturDari = (html) => {
      // React menyisipkan komentar penanda antar-teks: "31,9<!-- -->%". Tanpa
      // dibuang, pola `>angka%<` tidak cocok dan uji melaporkan panel kosong
      // padahal terisi -- persis salah-baca yang sudah menipu sekali di berkas ini.
      const bersih = html.replace(/<!--[\s\S]*?-->/g, "");
      const m = /data-testid="struktur-biaya"[\s\S]*?<\/ul>/.exec(bersih);
      if (!m) return null;
      return [...m[0].matchAll(/>([\d.,]+)%</g)].map((x) => x[1]);
    };
    const s0 = strukturDari(fin0.html);
    ok("Struktur Biaya terisi dari transaksi disetujui, bukan panel kosong abadi",
      Array.isArray(s0) && s0.length >= 3, `${s0 ? s0.length : 0} kategori terlihat`);
    ok("porsi kategori bukan 100% satu irisan (bukti benar-benar dikelompokkan)",
      Array.isArray(s0) && s0.length >= 3 && s0.every((v) => Number(v.replace(",", ".")) < 100),
      `${(s0 ?? []).join("% · ")}%`);
    // Insight pertama dihitung: menyebut nama kategori terbesar + porsinya.
    ok("insight konsentrasi biaya menyebut angka, bukan prosa tetap",
      /menyerap [\d.,]+% dari Rp/.test(fin0.html));
    // Dan komposisinya IKUT filter blok.
    const bFin = /name="blok" value="([^"]+)"/.exec(fin0.html)?.[1];
    const fin1 = await demoAdmin.get(`/dashboard/financial?blok=${bFin}`);
    const s1 = strukturDari(fin1.html);
    ok("komposisi biaya berubah saat satu blok dipilih",
      JSON.stringify(s0) !== JSON.stringify(s1),
      `${(s0 ?? []).join("/")}% -> ${(s1 ?? []).join("/")}%`);

    // Kartu KPI tidak boleh MENGAKU kemampuan yang tidak ada. "Traceability:
    // Aktif / Semua rantai terpetakan" dulu literal tanpa satu pun query,
    // padahal /traceability masih placeholder dan tak ada tabel rantai.
    const sust = await demoAdmin.get("/dashboard/sustainability");
    ok("KPI Traceability tidak mengaku aktif tanpa data", kpi(sust.html, "trace") === "—",
      `${kpi(sust.html, "trace")}`);
    // Standar tanpa program = em-dash, bukan 0%. Di dataset demo hanya 1 dari 9
    // standar punya program, jadi bila semuanya tampil berangka, `?? 0` kembali.
    const nolPersen = (sust.html.match(/>0%</g) ?? []).length;
    ok("standar tanpa program tidak dirender 0%", nolPersen === 0 && /belum ada program/.test(sust.html),
      `${nolPersen} kemunculan "0%"`);

    // Parameter palsu dari URL tidak boleh menjadi galat maupun celah — disaring
    // jadi "tanpa filter".
    const ngawur = await demoAdmin.get("/dashboard?blok=bukan-uuid&komoditas=%27%3B--");
    ok("parameter filter ngawur disaring, bukan melempar 500", ngawur.status === 200);
    ok("filter ngawur diperlakukan sebagai tanpa filter", angka(ngawur.html) === angka(base.html));
  }

  console.log("\n=== 0051: Jadwal vs Realisasi penyiangan DIHITUNG, bukan diklaim ===");
  {
    // Kolom ini sebelumnya literal "Tepat waktu" untuk setiap baris. Sekarang
    // dihitung dari jarak ke penyiangan sebelumnya pada blok yang sama vs interval
    // jadwal (migrasi 0051). Yang diuji: KEEMPAT hasil muncul — kalau semuanya
    // jatuh ke satu hasil, kolomnya tidak membuktikan perhitungan apa pun.
    const DEMO = "(SELECT id FROM app.companies WHERE code='DEMO')";
    const hasil = await psql(`
      SELECT DISTINCT coalesce(
        CASE WHEN ws.interval_day IS NULL THEN NULL
             WHEN lag(w.weeded_on) OVER (PARTITION BY w.block_id ORDER BY w.weeded_on) IS NULL THEN NULL
             WHEN (w.weeded_on - lag(w.weeded_on) OVER (PARTITION BY w.block_id ORDER BY w.weeded_on))
                  <= ws.interval_day + ws.tolerance_day THEN 'tepat'
             ELSE 'terlambat' END, 'kosong')
        FROM app.weeding_records w
        JOIN app.blocks b ON b.id = w.block_id AND b.company_id = ${DEMO}
        LEFT JOIN app.weeding_schedules ws ON ws.block_id = w.block_id AND ws.is_active`);
    const set = new Set(hasil.split("\n").map((x) => x.trim()).filter(Boolean));
    ok("dataset demo memuat hasil 'tepat waktu' DAN 'terlambat'",
      set.has("tepat") && set.has("terlambat"), [...set].join(", "));
    ok("blok tanpa jadwal / catatan pertama dirender kosong, bukan 'tepat waktu'",
      set.has("kosong"), [...set].join(", "));

    // Kolomnya benar-benar ada lagi di layar DAN ekspor, dengan nilai terhitung.
    const scr = await admin.get("/laporan/penyiangan");
    ok("kolom Jadwal vs Realisasi kembali di layar", /Jadwal vs Realisasi/.test(scr.html));
    // Yang diuji di sini STRUKTUR, bukan nilai: sesi `admin` at-verify ber-entitas
    // DEV sedangkan data jadwal ada di DEMO, jadi memeriksa "Terlambat N hari" pada
    // ekspor DEV akan selalu gagal — bukan karena kolomnya salah. Perhitungannya
    // sendiri sudah dibuktikan dua cek psql di atas.
    const xl = await admin.get("/laporan/penyiangan/excel");
    ok("kolom Jadwal vs Realisasi terbawa ke Excel", /Jadwal vs Realisasi/.test(xl.html));

    // Form jadwal: ada di HTML server (jalan tanpa JS) dan digate approver+.
    const MARK = 'data-testid="jadwal-penyiangan"';
    ok("form jadwal ada di HTML server", Boolean(pickForm((await admin.get("/aktivitas/weeding")).html, MARK)));
    ok("creator tidak melihat form jadwal",
      pickForm((await creator.get("/aktivitas/weeding")).html, MARK) === null);
  }

  console.log("\n=== AI-48: batas 8 kolom utama di mobile (K-07) ===");
  {
    const SLUGS = ["kesesuaian-lahan", "persiapan-lahan", "bibit", "penyiangan", "pemupukan",
      "pruning", "penyemprotan", "panen", "chemical", "equipment", "karbon", "blok",
      "pengeluaran", "anggaran", "approval"];
    const theads = (html) => [...html.matchAll(/<thead[\s\S]*?<\/thead>/g)].map((m) => m[0]);
    const lebar = (html, skipDetail) => {
      let max = 0;
      for (const t of theads(html)) {
        const n = [...t.matchAll(/<th\b[^>]*>/g)]
          .filter((x) => !x[0].includes("data-more"))
          .filter((x) => !(skipDetail && x[0].includes("data-detail"))).length;
        if (n > max) max = n;
      }
      return max;
    };

    const lebih = [], tanpaDetail = [];
    for (const slug of SLUGS) {
      const p = await admin.get(`/laporan/${slug}`);
      const total = lebar(p.html, false);
      const utama = lebar(p.html, true);
      if (utama > 8) lebih.push(`${slug}: ${utama}`);
      // Laporan yang total kolomnya >8 WAJIB punya kolom detail; kalau tidak,
      // pemilahannya belum dikonfigurasi dan kartu mobile tetap panjang.
      if (total > 8 && total === utama) tanpaDetail.push(`${slug}: ${total}`);
    }
    ok("nol laporan modul dengan lebih dari 8 kolom utama", lebih.length === 0,
      lebih.join(" · ") || "seluruh 15 laporan ≤ 8 kolom utama");
    ok("setiap laporan >8 kolom punya pemilahan kolom detail", tanpaDetail.length === 0,
      tanpaDetail.join(" · ") || "lengkap");

    // Tidak ada informasi yang hilang: kolom detail tetap dirender di ekspor.
    const xl = await admin.get("/laporan/kesesuaian-lahan/excel");
    ok("kolom detail tetap ada di Excel (batas 8 hanya untuk mobile)",
      /Penilai/.test(xl.html) && /Rekomendasi/.test(xl.html));
  }

  console.log("\n=== AT6b: sel tabel laporan tidak boleh literal (klaim tanpa data) ===");
  {
    // AT6 hanya memindai 4 layar dan SENGAJA melewati src/lib/report/screens.ts —
    // komentarnya sendiri menyebut itu masuk cakupan AI-42. Justru di situ 5 klaim
    // palsu bertahan sampai 24 Agu 2026: '3 m × 3 m' (jarak tanam, 13 dari 13
    // baris), 'Sesuai' (kepatuhan dosis), 'Tepat waktu' (kepatuhan jadwal),
    // 'Internal' (kepemilikan aset, dua laporan), plus badge 'Standar' dan 'Cukup'.
    // Semuanya terlihat seperti fakta terukur dan tidak pernah membaca database.
    //
    // Aturannya: SETIAP sel tabel laporan harus berupa EKSPRESI (turunan data),
    // bukan string konstan. Penanda kosong yang jujur tetap boleh.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/report/screens.ts", "utf8");
    const BOLEH = new Set(['"—"', '"Rp —"', '""', '"-"']);

    const selDariArray = (body) => {
      const out = []; let depth = 0, cur = "";
      for (const ch of body) {
        if ("([{".includes(ch)) depth++;
        if (")]}".includes(ch)) depth--;
        if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };

    const temuan = [];
    for (const re of [/rows: rows\.map\(\(\w+\) => \[([\s\S]*?)\]\)/g, /return \[([\s\S]*?)\];/g]) {
      for (const m of src.matchAll(re)) {
        if (m[1].length > 3000) continue;
        for (const sel of selDariArray(m[1])) {
          if (/^"[^"]*"$/.test(sel) && !BOLEH.has(sel)) temuan.push(sel);
        }
      }
    }
    ok("nol sel tabel laporan berisi klaim konstan", temuan.length === 0,
      temuan.length ? [...new Set(temuan)].join(" ") : "bersih");

    // Badge tanpa syarat = klaim juga ("Standar", "Cukup", "Sesuai").
    //
    // Pengecualian yang DISENGAJA dan harus tetap sedikit: teks yang menyebut NAMA
    // METODOLOGI, bukan menyatakan hasil pengukuran. "Tier 1" ada di panel yang
    // judulnya "Metodologi & Asumsi" dan memang menamai metode IPCC yang dipakai —
    // ia tidak mengklaim angka apa pun. Menambah entri di sini menuntut alasan
    // sejenis; kalau ragu, jangan ditambahkan.
    const BADGE_BUKAN_KLAIM = new Set(["Tier 1"]);
    const badgeTetap = [...src.matchAll(/badge: \{ text: "([^"]+)"/g)]
      .filter((m) => !src.slice(Math.max(0, m.index - 220), m.index).includes("?"))
      .map((m) => m[1])
      .filter((t) => !BADGE_BUKAN_KLAIM.has(t));
    ok("nol badge laporan dengan teks tanpa syarat", badgeTetap.length === 0,
      badgeTetap.join(", ") || "bersih (kecuali nama metodologi yang di-allowlist)");
  }

  console.log("\n=== AI-47: layar, PDF, dan Excel satu sumber ===");
  {
    // Sebelum AI-47 layar memakai screens.ts sementara PDF/Excel memakai
    // moduleData.ts -- DUA jalur data terpisah, dan kolomnya menyimpang sampai 4
    // kolom. Uji ini membandingkan jumlah kolom tabel detail di layar dengan yang
    // dikeluarkan Excel, untuk SETIAP laporan modul. Kalau seseorang menambah
    // kolom di satu jalur saja, uji ini yang menangkapnya.
    const SLUGS = ["kesesuaian-lahan", "persiapan-lahan", "bibit", "penyiangan", "pemupukan",
      "pruning", "penyemprotan", "panen", "chemical", "equipment", "karbon", "blok",
      "pengeluaran", "anggaran", "approval"];

    // Tabel detail adalah <thead> TERLEBAR di halaman; panel lain punya tabel kecil.
    // `data-more` DIKECUALIKAN: itu sel pengungkap khusus kartu mobile (AI-48),
    // disembunyikan di desktop dan tidak pernah ikut ke ekspor — menghitungnya akan
    // membuat layar selalu tampak satu kolom lebih banyak daripada Excel.
    const theads = (html) => [...html.matchAll(/<thead[\s\S]*?<\/thead>/g)].map((m) => m[0]);
    const countTh = (thead, { skipDetail = false } = {}) =>
      [...thead.matchAll(/<th\b[^>]*>/g)]
        .filter((t) => !t[0].includes("data-more"))
        .filter((t) => !(skipDetail && t[0].includes("data-detail"))).length;
    const widestThead = (html, opt) => {
      let max = 0;
      for (const t of theads(html)) { const n = countTh(t, opt); if (n > max) max = n; }
      return max;
    };

    const beda = [];
    let pdfGagal = 0;
    for (const slug of SLUGS) {
      const scr = await admin.get(`/laporan/${slug}`);
      const xls = await admin.get(`/laporan/${slug}/excel`);
      const a = widestThead(visible(scr.html));
      const b = widestThead(xls.html);
      if (a === 0 || a !== b) beda.push(`${slug}: layar ${a} vs excel ${b}`);
      const pdf = await fetch(`${BASE}/laporan/${slug}/pdf`, { headers: { cookie: admin.header() } });
      if (pdf.status !== 200) pdfGagal++;
    }
    ok(`kolom layar = kolom Excel di ${SLUGS.length} laporan modul`, beda.length === 0,
      beda.join(" · ") || "seluruhnya identik");
    ok(`PDF ke-${SLUGS.length} laporan modul terender`, pdfGagal === 0, `${pdfGagal} gagal`);

    // Header ekspor harus datang dari meta yang sama, bukan dirakit ulang.
    const xl = await admin.get("/laporan/penyemprotan/excel");
    ok("header Excel memuat entitas & sumber dari meta bersama",
      /Entitas/.test(xl.html) && /modul Spraying/.test(xl.html));
    ok("KPI layar ikut tercetak di Excel", /Ringkasan/.test(xl.html));
  }

  console.log("\n=== AT6: tidak ada literal numerik menyerupai data ===");
  {
    const { readFileSync } = await import("node:fs");
    // Laporan sekarang SATU route dinamis (/laporan/[slug]); berkas
    // laporan/keuangan/page.tsx sudah tidak ada dan readFileSync-nya membuat
    // SELURUH suite mati dengan ENOENT sebelum sampai ke cek mana pun.
    // Catatan cakupan: isi laporan sebenarnya dirakit di src/lib/report/screens.ts
    // yang TIDAK dipindai di sini — perluasan itu masuk cakupan AI-42.
    const files = [
      "src/app/(app)/laporan/[slug]/page.tsx",
      "src/app/(app)/costing/pengeluaran/page.tsx",
      "src/app/(app)/costing/anggaran/page.tsx",
      "src/app/(app)/approval/page.tsx",
    ];
    // Token kelas Tailwind memuat angka (text-slate-700, bg-red-50/40, h-3.5,
    // sm:grid-cols-3). Yang dicari adalah angka DATA, jadi token kelas dan
    // atribut konfigurasi dibuang lebih dulu.
    const strip = (src) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "")            // komentar blok
        .replace(/\/\/[^\n]*/g, "")                    // komentar baris
        .replace(/[\w:[\]/-]*-\d+(\.\d+)?(\/\d+)?/g, "")  // token kelas: -700, -3.5, /40
        .replace(/\b(maxLength|rows|limit|pageSize|step|min|max|size|strokeWidth)\s*[=:]\s*\{?["']?-?[\d.]+["']?\}?/g, "")
        .replace(/["'][^"']*\b(text|bg|border|px|py|mt|mb|ml|mr|gap|grid|col|row|w|h|p|m|rounded|ring|shadow|opacity|z|inset|top|left|right|bottom|leading|tracking)\b[^"']*["']/g, "");

    const hits = [];
    for (const f of files) {
      for (const m of strip(readFileSync(f, "utf8")).matchAll(/\b\d{2,}([.,]\d+)?\b/g)) {
        hits.push(`${f.split("/").slice(-2, -1)}:${m[0]}`);
      }
    }
    ok("nol literal numerik menyerupai data di 4 layar", hits.length === 0,
      hits.join(" ") || "bersih");
  }

  console.log(`\n${"=".repeat(56)}\nAT VERIFY:  PASS ${pass}   FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
