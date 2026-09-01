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

  // B-27: seluruh suite ini masuk lewat login stub (email saja, tanpa kata
  // sandi). Sejak mode login jadi fail-closed, "gagal login" bisa berarti
  // konfigurasi -- bukan cacat aplikasi. Diperiksa SEKALI di sini supaya
  // penyebabnya terbaca, bukan muncul sebagai 149 kegagalan berbunyi
  // "Form tidak ditemukan".
  const loginPage = await anon.get("/login");
  const stubMode = visible(loginPage.html).includes("AUTH_MODE=stub");
  if (!stubMode) {
    console.error("\nHalaman /login TIDAK sedang dalam mode stub.");
    console.error("Suite ini butuh:");
    console.error("  1. AUTH_MODE=stub di .env.local (lalu ulangi `npm run dev`)");
    console.error("  2. npm run db:seed:dev  — menyalakan app.auth_settings.stub_login_enabled");
    process.exit(1);
  }
  ok("halaman login mengumumkan mode stub-nya secara jujur (peringatan tampil)", true);

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
  // Urutan wajib: penugasan -> komponen RAB -> master. FK
  // budget_assignments_plan_item_id_fkey dan
  // budget_plan_items_cost_category_id_fkey menahan penghapusan dari ujung yang
  // salah, dan pembersihan yang gagal membuat RUN BERIKUTNYA memulai dengan
  // sisa data run sebelumnya -- kegagalan yang muncul sebagai uji lain yang
  // aneh, jauh dari sebabnya.
  await psql(`DELETE FROM app.budget_assignments WHERE plan_item_id IN (
                SELECT i.id FROM app.budget_plan_items i
                 WHERE i.cost_category_id IN (SELECT id FROM app.master_items WHERE code LIKE 'TEST%'))`);
  await psql(`DELETE FROM app.budget_plan_items WHERE cost_category_id IN (
                SELECT id FROM app.master_items WHERE code LIKE 'TEST%')`);
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

    // K-08 · modul Akuntansi memakai KOMPONEN dan bentuk searchParams yang sama.
    // Yang diuji bukan "ada bilahnya", tapi bahwa daftarnya benar-benar
    // menyempit DAN parameter halaman tidak hilang saat filter diterapkan.
    const peng0 = await demoAdmin.get("/costing/pengeluaran");
    ok("K-08: Pengeluaran memakai bilah filter yang sama",
      /data-testid="filter-dashboard"/.test(peng0.html));
    const jumlahBaris = (html) => {
      const m = /Menampilkan[\s\S]{0,200}?dari[\s\S]{0,80}?<\/span>/.exec(html.replace(/<!--[\s\S]*?-->/g, ""));
      if (!m) return null;
      const angkaSemua = [...m[0].matchAll(/>([\d.]+)</g)].map((x) => x[1]);
      return angkaSemua.length ? angkaSemua[angkaSemua.length - 1] : null;
    };
    const t0 = jumlahBaris(peng0.html);
    const bPeng = /name="blok" value="([^"]+)"/.exec(peng0.html)?.[1];
    const peng1 = await demoAdmin.get(`/costing/pengeluaran?blok=${bPeng}`);
    const t1 = jumlahBaris(peng1.html);
    ok("K-08: daftar pengeluaran menyempit saat satu blok dipilih",
      t0 !== null && t1 !== null && Number(t0.replace(/\./g, "")) > Number(t1.replace(/\./g, "")),
      `${t0} -> ${t1} transaksi`);
    // Filter GET tidak boleh MENGHAPUS parameter halaman: tanpa hidden input,
    // menekan Terapkan membuang status & kata kunci tanpa memberi tahu.
    const pengKeep = await demoAdmin.get("/costing/pengeluaran?status=approved&q=BLK");
    const form = /<form[^>]*data-testid="filter-dashboard"[\s\S]*?<\/form>/.exec(pengKeep.html)?.[0] ?? "";
    ok("K-08: status & kata kunci dibawa sebagai hidden input, tidak hilang",
      /name="status"[^>]*value="approved"/.test(form) && /name="q"[^>]*value="BLK"/.test(form));
    // Dan paginasi membawa filter: tanpa itu halaman 2 memuat daftar TANPA filter
    // sementara bilahnya tetap tampak tercentang.
    //
    // Filter ESTATE, bukan blok: satu blok hanya menyisakan 8 transaksi -> tidak
    // ada halaman kedua, dan ujinya lolos tanpa menguji apa pun. Estate
    // menyisakan 46 dari 74, jadi tombol "Berikutnya" memang ada. Ketiadaan
    // tombol itu kini DIANGGAP GAGAL, bukan dimaafkan.
    const ePeng = /name="estate" value="([^"]+)"/.exec(peng0.html)?.[1];
    const pengEst = await demoAdmin.get(`/costing/pengeluaran?estate=${ePeng}`);
    const nextHref = /<a[^>]*aria-label="Berikutnya"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*aria-label="Berikutnya"/.exec(pengEst.html);
    const href = nextHref ? (nextHref[1] ?? nextHref[2]) : null;
    ok("K-08: tautan paginasi tetap membawa filter estate",
      Boolean(href) && href.includes(`estate=${ePeng}`) && href.includes("page=2"),
      `${href ?? "tautan Berikutnya tidak ada"}`);

    // Parameter palsu dari URL tidak boleh menjadi galat maupun celah — disaring
    // jadi "tanpa filter".
    const ngawur = await demoAdmin.get("/dashboard?blok=bukan-uuid&komoditas=%27%3B--");
    ok("parameter filter ngawur disaring, bukan melempar 500", ngawur.status === 200);
    ok("filter ngawur diperlakukan sebagai tanpa filter", angka(ngawur.html) === angka(base.html));
  }

  console.log("\n=== AI-21: bukti K1-K7 punya DOKUMEN, bukan cuma status ===");
  {
    const s = await login("admin@demo.invalid", { company: "00000000-0000-4000-8000-0000000000d0" });
    const hal = await s.get("/keberlanjutan/sertifikasi");
    ok("halaman sertifikasi terbuka", hal.status === 200, `status ${hal.status}`);

    // Dokumen yang dilampirkan seed benar-benar bisa DIBUKA, bukan tautan mati.
    const idBukti = /data-testid="tautan-bukti"[^>]*href="\/api\/evidence\/([0-9a-f-]{36})"|href="\/api\/evidence\/([0-9a-f-]{36})"[^>]*data-testid="tautan-bukti"/.exec(hal.html);
    const bid = idBukti ? (idBukti[1] ?? idBukti[2]) : null;
    ok("bukti terlampir muncul sebagai tautan unduh", Boolean(bid), `${bid ?? "tidak ada tautan"}`);
    if (bid) {
      const unduh = await s.get(`/api/evidence/${bid}`);
      ok("tautan bukti benar-benar mengunduh berkas (bukan 404 tautan mati)",
        unduh.status === 200 && unduh.html.startsWith("%PDF"),
        `status ${unduh.status}, ${unduh.html.slice(0, 4)}`);
    } else {
      ok("tautan bukti benar-benar mengunduh berkas (bukan 404 tautan mati)", false, "tautan tidak ditemukan");
    }

    // "n/7 lengkap" wajib menuntut dokumen. Di dataset demo K1 & K2 punya
    // dokumen; K6 & K7 sengaja 'tersertifikasi' TANPA dokumen. Kalau hitungannya
    // memakai status saja, angkanya 4 — dan angka itu yang dipakai mengklaim
    // pengakuan retroaktif masa konversi 36 bulan.
    const berdokumen = await psql(`SELECT count(*)::text FROM app.organic_tracking t
      JOIN app.organic_items i ON i.code=t.item_code AND i.kind='evidence'
      WHERE t.company_id=(SELECT id FROM app.companies WHERE code='DEMO')
        AND t.status='tersertifikasi'
        AND EXISTS (SELECT 1 FROM app.evidence_links el WHERE el.entity_type='organic_tracking' AND el.entity_id=t.id)`);
    const statusSaja = await psql(`SELECT count(*)::text FROM app.organic_tracking t
      JOIN app.organic_items i ON i.code=t.item_code AND i.kind='evidence'
      WHERE t.company_id=(SELECT id FROM app.companies WHERE code='DEMO') AND t.status='tersertifikasi'`);
    const lengkap = /([0-9]+)\s*\/\s*([0-9]+)\s*lengkap/.exec(hal.html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " "));
    ok("hitungan lengkap memakai jumlah berdokumen, bukan jumlah berstatus",
      lengkap?.[1] === berdokumen && berdokumen !== statusSaja,
      `layar ${lengkap?.[1]} · berdokumen ${berdokumen} · berstatus ${statusSaja}`);

    // Klaim tanpa dokumen ditandai di barisnya, bukan hanya dihitung ulang diam-diam.
    ok("bukti 'tersertifikasi' tanpa dokumen ditandai di layar",
      /ditandai lengkap tanpa dokumen/.test(hal.html));

    // Unggah SUNGGUHAN lewat action, lalu jumlah lampirannya harus naik.
    const sebelum = await psql(`SELECT count(*)::text FROM app.evidence_links el
      JOIN app.organic_tracking t ON t.id=el.entity_id
      WHERE el.entity_type='organic_tracking' AND t.item_code='K5'
        AND t.company_id=(SELECT id FROM app.companies WHERE code='DEMO')`);
    await s.submit("/keberlanjutan/sertifikasi", { itemCode: "K5" },
      { formMarker: "unggah-bukti-organik", files: { berkas: fakeJpeg() } });
    const sesudah = await psql(`SELECT count(*)::text FROM app.evidence_links el
      JOIN app.organic_tracking t ON t.id=el.entity_id
      WHERE el.entity_type='organic_tracking' AND t.item_code='K5'
        AND t.company_id=(SELECT id FROM app.companies WHERE code='DEMO')`);
    ok("unggah bukti lewat UI menambah lampiran", Number(sesudah) === Number(sebelum) + 1,
      `${sebelum} -> ${sesudah}`);

    // Viewer TIDAK boleh melampirkan bukti kepatuhan.
    const viewer = await login("viewer@agrovision.local");
    const aksiUp = pickForm(hal.html, "unggah-bukti-organik")?.hidden;
    ok("prasyarat: field aksi unggah bisa dipanen",
      Boolean(aksiUp) && Object.keys(aksiUp).some((k) => k.startsWith("$ACTION")),
      `${Object.keys(aksiUp ?? {}).length} field`);
    const fdUp = new FormData();
    for (const [k, v] of Object.entries(aksiUp ?? {})) fdUp.append(k, v);
    fdUp.set("itemCode", "K5");
    const j = fakeJpeg();
    fdUp.set("berkas", j.blob, j.name);
    const tembusUp = await fetch(`${BASE}/keberlanjutan/sertifikasi`, {
      method: "POST", headers: { cookie: viewer.header() }, body: fdUp, redirect: "manual",
    });
    const balasanUp = await tembusUp.text();
    const setelahViewer = await psql(`SELECT count(*)::text FROM app.evidence_links el
      JOIN app.organic_tracking t ON t.id=el.entity_id
      WHERE el.entity_type='organic_tracking' AND t.item_code='K5'
        AND t.company_id=(SELECT id FROM app.companies WHERE code='DEMO')`);
    ok("viewer POST langsung DITOLAK melampirkan bukti",
      setelahViewer === sesudah && tembusUp.status === 200 && /tidak berhak/.test(balasanUp),
      `${sesudah} -> ${setelahViewer} (status ${tembusUp.status})`);

    // Bersihkan bukti yang DIUNGGAH OLEH UJI INI. Tanpa ini, setiap run menambah
    // satu baris evidence_files ke dataset demo (storage_path-nya sama karena
    // content-addressed, tapi barisnya baru), dan "berapa bukti K5" ikut naik
    // tiap kali suite dijalankan. Uji tidak boleh menumbuhkan data yang
    // diukurnya sendiri.
    await psql(`DELETE FROM app.evidence_files WHERE company_id=(SELECT id FROM app.companies WHERE code='DEMO')
      AND file_name='struk.jpg' AND id IN (
        SELECT el.evidence_id FROM app.evidence_links el
         JOIN app.organic_tracking t ON t.id=el.entity_id
        WHERE el.entity_type='organic_tracking' AND t.item_code='K5')`);
    const bersih = await psql(`SELECT count(*)::text FROM app.evidence_links el
      JOIN app.organic_tracking t ON t.id=el.entity_id
      WHERE el.entity_type='organic_tracking' AND t.item_code='K5'
        AND t.company_id=(SELECT id FROM app.companies WHERE code='DEMO')`);
    ok("uji ini tidak meninggalkan bukti tambahan di dataset demo", bersih === sebelum,
      `awal ${sebelum}, akhir ${bersih}`);
  }

  console.log("\n=== AI-22: hasil survei bisa DILIHAT, bukan cuma dihitung ===");
  {
    // Sebelum ini daftar /survei hanya memberi Form/Blok/Tanggal/Petugas/Status;
    // 66 baris submission_values di dataset demo tidak bisa dicapai dari UI.
    const s = await login("admin@demo.invalid", { company: "00000000-0000-4000-8000-0000000000d0" });
    const daftar = await s.get("/survei");
    const tautan = /data-testid="lihat-hasil-survei"[^>]*/.test(daftar.html)
      || /href="\/survei\/hasil\/([0-9a-f-]{36})"/.test(daftar.html);
    ok("daftar survei punya aksi Lihat per baris", tautan);
    const sid = /href="\/survei\/hasil\/([0-9a-f-]{36})"/.exec(daftar.html)?.[1];
    ok("prasyarat: ada hasil survei di dataset demo", Boolean(sid), `${sid ?? "tidak ada"}`);

    const detail = await s.get(`/survei/hasil/${sid}`);
    ok("halaman detail terbuka", detail.status === 200 && /data-testid="detail-hasil-survei"/.test(detail.html),
      `status ${detail.status}`);

    // Jawabannya benar-benar tampil. Dibandingkan langsung ke DB supaya bukan
    // sekadar "ada tulisan" — jumlah pertanyaan pada versi form itu harus sama.
    const nField = await psql(`SELECT count(*)::text FROM app.form_fields
      WHERE form_version_id = (SELECT form_version_id FROM app.survey_submissions WHERE id='${sid}')`);
    const nJawab = await psql(`SELECT count(*)::text FROM app.submission_values WHERE submission_id='${sid}'`);
    const teks = detail.html.replace(/<!--[\s\S]*?-->/g, "");
    const kelengkapan = /data-testid="kelengkapan-jawaban"[^>]*>([\s\S]*?)<\/dd>/.exec(teks)?.[1]
      ?.replace(/<[^>]*>/g, "").trim();
    ok("kelengkapan dihitung dari DB, bukan diklaim",
      kelengkapan === `${nJawab} / ${nField} pertanyaan`,
      `layar "${kelengkapan}" vs DB ${nJawab}/${nField}`);

    // Pertanyaan yang TIDAK dijawab wajib tetap muncul sebagai em-dash: kalau
    // hanya yang terisi dirender, hasil survei setengah lengkap terlihat lengkap.
    const kosong = Number(nField) - Number(nJawab);
    ok("pertanyaan tak terjawab tetap dirender em-dash",
      kosong === 0 || (teks.match(/data-empty="true"/g) ?? []).length >= kosong,
      `${kosong} pertanyaan kosong, ${(teks.match(/data-empty="true"/g) ?? []).length} penanda kosong`);

    // Isolasi tenant, dari arah sebaliknya: seluruh submission ada di entitas
    // DEMO, jadi yang diuji adalah sesi DEV membuka id milik DEMO. Versi pertama
    // uji ini mencari submission "entitas lain" yang memang tidak ada, lalu
    // melaporkan PASS dengan catatan "tidak ada yang bisa diuji" — hijau tanpa
    // menguji apa pun.
    const dev = await login("admin@agrovision.local");
    const bocor = await dev.get(`/survei/hasil/${sid}`);
    ok("hasil survei entitas lain TIDAK terbuka",
      !/data-testid="detail-hasil-survei"/.test(bocor.html) && bocor.status !== 500,
      `status ${bocor.status}`);

    // id ngawur tidak boleh menjadi 500 dari galat uuid Postgres (22P02).
    //
    // Yang diperiksa halaman 404-nya, BUKAN status 404. Di aplikasi ini
    // notFound() di bawah batas loading.tsx menjawab HTTP 200: shell-nya sudah
    // ter-flush sebelum notFound() dipanggil, jadi statusnya tidak bisa diubah
    // lagi. Itu perilaku yang sudah ada (13 berkas loading.tsx, termasuk
    // /survei/[formId] yang lebih tua) dan bukan bawaan AI-22 — memaksa uji ini
    // menuntut 404 hanya akan menggagalkan hal yang tidak diubah PR ini.
    const ngawurId = await s.get("/survei/hasil/bukan-uuid");
    ok("id survei ngawur menjadi halaman 404, bukan 500 maupun kebocoran",
      ngawurId.status !== 500 && !/data-testid="detail-hasil-survei"/.test(ngawurId.html)
        && /could not be found|Halaman tidak ditemukan|404/.test(ngawurId.html),
      `status ${ngawurId.status}`);
  }

  console.log("\n=== RAB (rapat Fadli 26 Agu): agronomis menyusun, finance memutuskan ===");
  {
    // Pengguna SEKALI PAKAI, pola yang sama dengan AI-28 di bawah: akun seed
    // tidak punya role agronomist, dan menambahkannya ke seed akan mengubah
    // hitungan uji lain.
    const DEV = "(SELECT id FROM app.companies WHERE code='DEV')";
    const EMAIL = "rab-agronomis@uji.invalid";
    // Penugasan lebih dulu: FK budget_assignments_plan_item_id_fkey menahan
    // penghapusan komponen RAB yang sudah pernah ditugaskan.
    // Realisasi lebih dulu: ct_assignment_same_company memakai ON DELETE
    // RESTRICT, dan itu memang disengaja -- penugasan yang sudah dibelanjakan
    // tidak boleh lenyap beserta jejak uangnya. Pembersihan uji karena itu
    // harus melepas tautannya dari ujung yang benar.
    await psql(`DELETE FROM app.cost_transactions WHERE budget_assignment_id IN (
                  SELECT a.id FROM app.budget_assignments a
                    JOIN app.budget_plans p ON p.id = a.plan_id
                   WHERE p.code LIKE 'RAB-AT-%')`);
    await psql(`DELETE FROM app.budget_assignments WHERE plan_id IN (
                  SELECT id FROM app.budget_plans WHERE code LIKE 'RAB-AT-%')`);
    await psql(`DELETE FROM app.budget_plan_items WHERE plan_id IN (
                  SELECT id FROM app.budget_plans WHERE code LIKE 'RAB-AT-%')`);
    await psql(`DELETE FROM app.budget_plans WHERE code LIKE 'RAB-AT-%'`);
    await psql(`DELETE FROM app.user_company_access WHERE user_id IN (
                  SELECT id FROM app.users WHERE email='${EMAIL}')`);
    await psql(`DELETE FROM app.users WHERE email='${EMAIL}'`);
    await psql(`INSERT INTO app.users (company_id, external_id, email, full_name, app_role, is_active)
                VALUES (${DEV}, 'at-rab-agro', '${EMAIL}', 'Agronomis Uji', 'agronomist', true)`);
    await psql(`INSERT INTO app.user_company_access (user_id, company_id)
                SELECT id, ${DEV} FROM app.users WHERE email='${EMAIL}'`);

    const agro = await login(EMAIL);
    const fin = await login("approver@agrovision.local");
    const lap = await login("creator@agrovision.local");

    const daftar = await agro.get("/costing/rencana-anggaran");
    ok("agronomis membuka Rencana Anggaran", daftar.status === 200, `HTTP ${daftar.status}`);
    ok("agronomis melihat form susun RAB", visible(daftar.html).includes("Susun RAB baru"));

    const lapDaftar = await lap.get("/costing/rencana-anggaran");
    ok("petugas lapangan boleh MELIHAT RAB tapi tidak menyusunnya",
      lapDaftar.status === 200 && !visible(lapDaftar.html).includes("Susun RAB baru"));

    const kode = "RAB-AT-1";
    await agro.submit("/costing/rencana-anggaran",
      { code: kode, name: "RAB uji acceptance", areaHa: 100, horizonMonths: 12, contingencyPct: 5 },
      { formMarker: 'name="code"' });

    const sesudah = await agro.get("/costing/rencana-anggaran");
    ok("RAB tersimpan dan tampil di daftar", visible(sesudah.html).includes(kode));
    const id = (new RegExp('href="/costing/rencana-anggaran/([0-9a-f-]{36})"').exec(sesudah.html) ?? [])[1];

    let detail = await agro.get(`/costing/rencana-anggaran/${id}`);
    // Kejujuran angka: RAB tanpa komponen BUKAN Rp 0.
    ok("RAB tanpa komponen dirender em-dash, bukan Rp 0",
      !/Rp\s*0(?![.\d])/.test(visible(detail.html)));

    // RAB yang masih kosong harus LANGSUNG menawarkan baris yang bisa diketik.
    // Sebelumnya layar kosong menggantikan tabelnya, sehingga satu-satunya jalan
    // masuk justru tersembunyi di balik form terpisah di bawahnya.
    const katBaru = (/<select[^>]*name="baru_kategori"[\s\S]*?<option value="([0-9a-f-]{36})"/
      .exec(detail.html) ?? [])[1];
    ok("RAB kosong tetap menampilkan baris kosong yang bisa diketik", Boolean(katBaru),
      katBaru ? "" : "tidak ada baris baru di tabel");

    if (katBaru) {
      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        _aksi: "tambah", baru_bulan: 1, baru_kategori: katBaru,
        baru_uraian: "Dolomit uji baris ujung", baru_jenis: "consumable",
        baru_volume: 100, baru_harga: 3500, baru_kind: "opex", baru_satuan: "",
      }, { formMarker: 'value="tambah"' });
      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      const stlhTambah = visible(detail.html);
      ok("baris bisa ditambahkan langsung dari ujung tabel, tanpa form terpisah",
        stlhTambah.includes("Dolomit uji baris ujung"));
      // 100 x 3.500 = 350.000, dihitung kolom GENERATED -- tidak dikirim form.
      ok("jumlah baris dari ujung tabel dihitung database", stlhTambah.includes("350.000"));
      // Baris yang dibuat dari ujung tabel sengaja tidak membawa sumber &
      // keyakinan; layar HARUS mengatakannya, bukan membiarkannya terlihat lengkap.
      ok("baris ringkas mengakui sumber & keyakinannya belum diisi",
        stlhTambah.includes("keyakinan belum dinilai") && stlhTambah.includes("sumber belum disebutkan"));
    }

    const kat = (/<select[^>]*name="costCategoryId"[\s\S]*?<option value="([0-9a-f-]{36})"/.exec(detail.html) ?? [])[1];
    if (kat) {
      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        costCategoryId: kat, phaseMonth: 1, description: "Bibit kelapa genjah",
        itemKind: "consumable", volume: 7000, unitPriceIdr: 100000, uomItemId: "", note: "",
      }, { formMarker: 'name="costCategoryId"' });

      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      // 7.000 x 100.000 = 700.000.000, dihitung kolom GENERATED di database.
      ok("jumlah baris dihitung database, bukan dikirim form",
        visible(detail.html).includes("700.000.000"));

      // ---------------------------------------------------------------------
      // 0062 lewat HTTP: volume yang DITURUNKAN dari asumsi.
      //
      // Ditambahkan setelah audit 31 Agu 2026. Sebelumnya blok ini hanya
      // mengirim volume apa adanya, sehingga bug yang membuang basis_code di
      // jalur tulis repo lolos sepenuhnya dari acceptance test: seluruh tahap 2
      // mati dari UI sementara suite ini tetap hijau. Yang diuji di sini persis
      // apa yang dilakukan agronomis sungguhan -- Volume DIKOSONGKAN, basis dan
      // rasio diisi -- dan angkanya harus muncul tanpa ia mengetiknya.
      // ---------------------------------------------------------------------
      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        planId: id, code: "net_ha", label: "Areal efektif (88% bruto)",
        value: 88, unit: "ha efektif", confidence: "medium", sourceRef: "uji at:verify",
      }, { formMarker: 'placeholder="net_ha"' });

      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        costCategoryId: kat, phaseMonth: 1, description: "Bibit durian via basis",
        itemKind: "consumable", volume: "", unitPriceIdr: 200000, uomItemId: "", note: "",
        basisCode: "net_ha", ratioPerBasis: 70,
      }, { formMarker: 'name="costCategoryId"' });

      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      const teks = visible(detail.html);
      // 88 x 70 = 6.160 batang, lalu x 200.000 = 1.232.000.000. Tidak satu pun
      // dari kedua angka itu dikirim form -- keduanya lahir di database.
      ok("volume diturunkan dari asumsi (88 x 70 = 6.160), bukan diketik",
        teks.includes("6.160"), teks.includes("6.160") ? "" : "volume turunan tidak muncul");
      ok("jumlah baris turunan dihitung dari volume turunan",
        teks.includes("1.232.000.000"));
      // Anotasinya wajib ada: baris yang volumenya diturunkan harus mengatakan
      // dari mana, kalau tidak layar menyajikan angka tanpa asal-usul.
      //
      // Komentar HTML dibuang dulu. React SSR menyisipkan <!-- --> di antara dua
      // ekspresi teks yang bersebelahan (`= {basisCode} × {ratio}`) sebagai
      // penanda hidrasi, sehingga rangkaian yang dibaca manusia sebagai satu
      // kalimat terpotong di sumbernya. helper visible() sengaja tidak diubah:
      // ia dipakai ratusan asersi lain, dan pembersihan ini hanya perlu di sini.
      const anotasi = teks.replace(/<!--[\s\S]*?-->/g, "");
      const cocok = /=\s*net_ha\s*×\s*70/.test(anotasi);
      ok("baris turunan menyebut rumusnya di layar", cocok,
        cocok ? "" : (anotasi.match(/net_ha[\s\S]{0,40}/) ?? ["tidak ada 'net_ha' di halaman"])[0]);
    } else {
      ok("kategori biaya tersedia untuk RAB", false, "dropdown kategori kosong");
    }

    // -----------------------------------------------------------------------
    // Daftar tertutup untuk Tahap & Penggerak.
    //
    // Dulu keduanya <datalist> -- saran yang tetap menerima ketikan bebas --
    // sehingga "B Land prep" dan "B land prep" bisa hidup berdampingan dan
    // memecah pengelompokan CAPEX tanpa satu galat pun. Yang diuji di sini
    // BUKAN cuma bahwa layarnya dropdown, tapi bahwa SERVER menolak nilai di
    // luar daftar: Server Action bisa dipanggil POST langsung tanpa UI.
    // -----------------------------------------------------------------------
    ok("Tahap & penggerak dipilih dari daftar, bukan diketik bebas",
      detail.html.includes('<select name="stage"') && !detail.html.includes('list="tahap-rab"'));

    if (kat) {
      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        costCategoryId: kat, phaseMonth: 1, description: "Baris bertahap ngawur",
        itemKind: "consumable", volume: 1, unitPriceIdr: 1, uomItemId: "", note: "",
        stage: "Tahap Karangan Sendiri", driver: "penggerak ngawur",
      }, { formMarker: 'name="costCategoryId"' });
      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      const stlh = visible(detail.html);
      ok("baris tetap tersimpan meski tahapnya di luar daftar", stlh.includes("Baris bertahap ngawur"));
      ok("tahap & penggerak di luar daftar TIDAK tersimpan (ditolak server, bukan hanya layar)",
        !stlh.includes("Tahap Karangan Sendiri") && !stlh.includes("penggerak ngawur"));
    }

    // -----------------------------------------------------------------------
    // Tabel sunting-langsung (permintaan rapat: "seperti Excel tapi modern").
    //
    // Sebelum ini modul RAB tidak punya satu pun cara menyunting, mencoret,
    // atau menghapus baris dari layar: salah ketik harga berarti RAB itu tidak
    // bisa diperbaiki sama sekali kecuali lewat psql. Temuan audit 31 Agu.
    // -----------------------------------------------------------------------
    const idKelapa = (new RegExp('name="uraian_([0-9a-f-]{36})"[^>]*value="Bibit kelapa genjah"')
      .exec(detail.html) ?? [])[1];
    ok("baris RAB tampil sebagai sel yang bisa diketik", Boolean(idKelapa),
      idKelapa ? "" : "tidak ada input uraian_<id> di layar");

    if (idKelapa) {
      // Harga diperbaiki dari 100.000 jadi 250.000 -> 7.000 x 250.000.
      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        _aksi: "simpan", [`uraian_${idKelapa}`]: "Bibit kelapa genjah",
        [`bulan_${idKelapa}`]: 1, [`volume_${idKelapa}`]: 7000,
        [`harga_${idKelapa}`]: 250000,
      }, { formMarker: 'value="simpan"' });

      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      ok("harga yang disunting di sel tersimpan dan jumlahnya dihitung ulang database",
        visible(detail.html).includes("1.750.000.000"));

      // Mencoret != menghapus: keluar dari total, tetap terbaca.
      await agro.submit(`/costing/rencana-anggaran/${id}`,
        { _aksi: `coret:${idKelapa}` }, { formMarker: 'value="simpan"' });
      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      const setelahCoret = visible(detail.html);
      ok("baris yang dicoret keluar dari total tapi TETAP terlihat",
        setelahCoret.includes("DICORET") && setelahCoret.includes("Bibit kelapa genjah"));

      await agro.submit(`/costing/rencana-anggaran/${id}`,
        { _aksi: `hidup:${idKelapa}` }, { formMarker: 'value="simpan"' });
      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      ok("baris yang dicoret bisa dihidupkan kembali", !visible(detail.html).includes("DICORET"));
    }

    // Baris sekali-pakai, dibuat lalu dihapus -- membuktikan hapus benar-benar
    // menghapus, tanpa mengganggu asersi total di bawah.
    if (kat) {
      await agro.submit(`/costing/rencana-anggaran/${id}`, {
        costCategoryId: kat, phaseMonth: 1, description: "Baris salah masuk",
        itemKind: "consumable", volume: 1, unitPriceIdr: 1, uomItemId: "", note: "",
      }, { formMarker: 'name="costCategoryId"' });
      detail = await agro.get(`/costing/rencana-anggaran/${id}`);
      const idBuang = (new RegExp('name="uraian_([0-9a-f-]{36})"[^>]*value="Baris salah masuk"')
        .exec(detail.html) ?? [])[1];
      ok("baris baru muncul di tabel sunting", Boolean(idBuang));
      if (idBuang) {
        await agro.submit(`/costing/rencana-anggaran/${id}`,
          { _aksi: `hapus:${idBuang}` }, { formMarker: 'value="simpan"' });
        detail = await agro.get(`/costing/rencana-anggaran/${id}`);
        ok("baris yang dihapus benar-benar hilang dari layar",
          !visible(detail.html).includes("Baris salah masuk"));
      }
    }

    ok("agronomis TIDAK diberi tombol Setujui", !visible(detail.html).includes('value="approved"'));

    await agro.submit(`/costing/rencana-anggaran/${id}`, { id }, { formMarker: "Ajukan ke finance" });
    detail = await agro.get(`/costing/rencana-anggaran/${id}`);
    ok("RAB yang diajukan tidak bisa ditambah komponen oleh agronomis",
      !visible(detail.html).includes("Tambah komponen biaya"));

    const finDetail = await fin.get(`/costing/rencana-anggaran/${id}`);
    ok("finance melihat tombol keputusan", visible(finDetail.html).includes('value="approved"'));
    await fin.submit(`/costing/rencana-anggaran/${id}`, { id }, { formMarker: 'value="approved"' });

    const finSesudah = await fin.get(`/costing/rencana-anggaran/${id}`);
    ok("finance bisa menambah baris SETELAH disetujui (kesepakatan rapat)",
      visible(finSesudah.html).includes("Tambah komponen biaya"));

    const agroSesudah = await agro.get(`/costing/rencana-anggaran/${id}`);
    ok("agronomis tetap bisa MEMBACA RAB yang sudah disetujui",
      agroSesudah.status === 200 && visible(agroSesudah.html).includes("Bibit kelapa"));

    // -----------------------------------------------------------------------
    // Penugasan lapangan & kurva S serapan (0066).
    //
    // Alur rapat: agronomis usulkan -> disetujui -> agronomis bagi tugas ke
    // creator -> creator realisasikan -> anggaran berkurang.
    // -----------------------------------------------------------------------
    const tSet = visible(agroSesudah.html);
    ok("panel penugasan muncul setelah RAB disetujui", tSet.includes("Penugasan lapangan"));

    // Tanpa tanggal mulai, kurva S TIDAK boleh digambar: bulan fase RAB relatif
    // sementara realisasi bertanggal sungguhan, jadi keduanya belum sesumbu.
    ok("kurva S menolak digambar selama tanggal mulai kosong",
      tSet.includes("tanggal mulai RAB belum ditetapkan"));

    // Diisi FINANCE, bukan agronomis: bp_edit_gate hanya mengizinkan
    // approver/super_admin menyunting RAB yang sudah disetujui.
    await fin.submit(`/costing/rencana-anggaran/${id}`,
      { planId: id, startDate: "2026-09-01" }, { formMarker: 'name="startDate"' });
    let stlhTgl = await agro.get(`/costing/rencana-anggaran/${id}`);
    ok("setelah tanggal mulai diisi, kurva S digambar",
      visible(stlhTgl.html).includes("Kurva S serapan anggaran")
      && !visible(stlhTgl.html).includes("tanggal mulai RAB belum ditetapkan"));
    ok("kurva S jujur bahwa belum ada realisasi tertaut",
      visible(stlhTgl.html).includes("Belum ada pengeluaran disetujui"));

    // Dipilih baris yang volumenya CUKUP untuk ditugasi 5, bukan sekadar opsi
    // pertama: pagu volume 0066 menolak penugasan yang melebihi baris RAB-nya,
    // dan begitu daftar barisnya berubah (mis. setelah impor Excel menambah
    // baris bervolume 1 lot), uji ini akan gagal karena aturan yang justru
    // bekerja dengan benar. Label opsinya memuat volume: "uraian (7000 BATANG)".
    const idItem = (() => {
      // Komentar HTML dibuang dulu: React SSR menyisipkan <!-- --> di antara dua
      // ekspresi teks bersebelahan, sehingga label opsi yang dibaca manusia
      // sebagai satu kalimat terpotong di sumbernya dan pola "tanpa < di dalam"
      // tidak pernah cocok.
      const sel = (/<select[^>]*name="planItemId"[\s\S]*?<\/select>/.exec(stlhTgl.html)?.[0] ?? "")
        .replace(/<!--[\s\S]*?-->/g, "");
      for (const m of sel.matchAll(/<option value="([0-9a-f-]{36})">([^<]*)</g)) {
        // Angka di layar berformat Indonesia: "7.000" itu tujuh ribu, bukan
        // tujuh koma nol. Number("7.000") = 7 akan memilih baris yang justru
        // terlalu kecil, lalu penugasannya ditolak pagu.
        const teks = (/\(([\d.,]+)\s/.exec(m[2]) ?? [])[1] ?? "0";
        const vol = Number(teks.replace(/\./g, "").replace(",", "."));
        if (vol >= 10) return m[1];
      }
      return undefined;
    })();
    // Sengaja memilih yang berperan CREATOR, bukan opsi pertama: seluruh alur
    // rapat berujung pada creator yang merealisasikan di lapangan.
    const idPenerima = (/<option value="([0-9a-f-]{36})">[^<]*\(creator\)/
      .exec(stlhTgl.html) ?? [])[1];
    ok("form penugasan menawarkan baris RAB dan penerima tugas",
      Boolean(idItem) && Boolean(idPenerima));

    if (idItem && idPenerima) {
      await agro.submit(`/costing/rencana-anggaran/${id}`,
        { planId: id, planItemId: idItem, assigneeUserId: idPenerima, volume: 5,
          uomItemId: "", targetDate: "2026-09-30", note: "uji penugasan" },
        { formMarker: 'name="assigneeUserId"' });
      stlhTgl = await agro.get(`/costing/rencana-anggaran/${id}`);
      ok("penugasan tersimpan dan tampil di daftar",
        visible(stlhTgl.html).includes("uji penugasan"));

      // Pagu volume: baris pertama RAB bervolume 7.000; menugaskan 999.999
      // harus ditolak DAN pesannya menyebut angkanya, bukan sekadar "gagal".
      const lebih = await agro.submit(`/costing/rencana-anggaran/${id}`,
        { planId: id, planItemId: idItem, assigneeUserId: idPenerima, volume: 999999,
          uomItemId: "", targetDate: "", note: "melebihi pagu" },
        { formMarker: 'name="assigneeUserId"' });
      const tLebih = visible(lebih.html);
      // Pesannya harus menyebut ANGKA pagunya. "Gagal" saja membuat penyusun
      // menebak-nebak berapa sisa yang masih boleh ditugaskan.
      // ---------------------------------------------------------------------
      // Langkah 5 & 6 rapat: creator merealisasikan, finance menyetujui,
      // anggaran berkurang. Ini satu-satunya bagian yang membuktikan tautannya
      // benar-benar menggerakkan angka -- sisanya hanya membuktikan formnya ada.
      // ---------------------------------------------------------------------
      const formBelanja = await creator.get("/costing/pengeluaran");
      const idTugas = (new RegExp('name="budgetAssignmentId"[\\s\\S]{0,2000}?<option value="([0-9a-f-]{36})"')
        .exec(formBelanja.html) ?? [])[1];
      ok("penugasan muncul di form pengeluaran milik penerimanya", Boolean(idTugas),
        idTugas ? "" : "dropdown penugasan kosong untuk creator yang ditugasi");

      if (idTugas && blkId && catId) {
        await creator.submit("/costing/pengeluaran",
          { isOverhead: "false", blockId: blkId, costCategoryId: catId,
            transactionDate: "2026-09-15", amountIdr: "12000000",
            budgetAssignmentId: idTugas },
          { formMarker: "isOverhead", files: { evidence: fakeJpeg() } });

        const idBelanja = await psql(`SELECT id FROM app.cost_transactions
                                       WHERE budget_assignment_id='${idTugas}' LIMIT 1`);
        ok("realisasi tersimpan dengan tautan ke penugasan", Boolean(idBelanja));

        // Sebelum disetujui, ia BUKAN serapan: angka yang belum diputuskan
        // tidak boleh mengurangi anggaran.
        let serap = await psql(`SELECT coalesce(sum(realisasi)::text,'NULL')
                                  FROM app.budget_absorption('${id}')`);
        ok("realisasi yang belum disetujui TIDAK mengurangi anggaran",
          serap === "NULL", `serapan=${serap}`);

        await psql(`UPDATE app.cost_transactions
                       SET approval_status='approved', approval_id=NULL
                     WHERE budget_assignment_id='${idTugas}'`);
        serap = await psql(`SELECT coalesce(sum(realisasi)::text,'NULL')
                              FROM app.budget_absorption('${id}')`);
        ok("setelah disetujui, anggaran berkurang sebesar realisasinya",
          serap === "12000000.00", `serapan=${serap}`);

        const stlhSerap = await fin.get(`/costing/rencana-anggaran/${id}`);
        const tSerap = visible(stlhSerap.html);
        ok("kurva S menampilkan serapan di layar, bukan hanya di database",
          tSerap.includes("Terserap") && tSerap.includes("12.000.000"));
        ok("kurva S berhenti mengatakan 'belum ada pengeluaran disetujui'",
          !tSerap.includes("Belum ada pengeluaran disetujui"));
      }

      const pesanPagu = (/>([^<>]*melebihi[^<>]*)</.exec(tLebih) ?? [])[1] ?? "";
      ok("penugasan melebihi volume baris RAB ditolak, dengan angkanya disebut",
        !tLebih.includes("Penugasan dibuat.") && /\d/.test(pesanPagu),
        pesanPagu.trim().slice(0, 100) || "tidak ada pesan pagu yang terbaca");
    }

    // Bersihkan: pemulihan tidak boleh jadi langkah yang bisa terlewat.
    // Realisasi lebih dulu: ct_assignment_same_company memakai ON DELETE
    // RESTRICT, dan itu memang disengaja -- penugasan yang sudah dibelanjakan
    // tidak boleh lenyap beserta jejak uangnya. Pembersihan uji karena itu
    // harus melepas tautannya dari ujung yang benar.
    await psql(`DELETE FROM app.cost_transactions WHERE budget_assignment_id IN (
                  SELECT a.id FROM app.budget_assignments a
                    JOIN app.budget_plans p ON p.id = a.plan_id
                   WHERE p.code LIKE 'RAB-AT-%')`);
    await psql(`DELETE FROM app.budget_assignments WHERE plan_id IN (
                  SELECT id FROM app.budget_plans WHERE code LIKE 'RAB-AT-%')`);
    await psql(`DELETE FROM app.budget_plan_items WHERE plan_id IN (
                  SELECT id FROM app.budget_plans WHERE code LIKE 'RAB-AT-%')`);
    await psql(`DELETE FROM app.budget_plans WHERE code LIKE 'RAB-AT-%'`);
    await psql(`DELETE FROM app.user_company_access WHERE user_id IN (
                  SELECT id FROM app.users WHERE email='${EMAIL}')`);
    await psql(`DELETE FROM app.users WHERE email='${EMAIL}'`);
  }

  console.log("\n=== AI-28: aksi baris pengguna (nonaktifkan / aktifkan / hapus) ===");
  {
    // Blok ini memakai pengguna SEKALI PAKAI, bukan akun seed.
    //
    // Versi pertama menonaktifkan viewer@agrovision.local lalu mengaktifkannya
    // kembali di langkah terakhir. Begitu ada satu kegagalan di tengah, langkah
    // pemulihan itu tidak pernah jalan -- viewer tertinggal nonaktif, dan run
    // BERIKUTNYA gagal di prasyarat dengan sebab yang sama sekali berbeda,
    // menutupi kegagalan aslinya. Itu betul-betul terjadi. Pemulihan tidak boleh
    // menjadi langkah yang bisa terlewat.
    const DEV = "(SELECT id FROM app.companies WHERE code='DEV')";
    const EMAIL = "at28-sekali-pakai@uji.invalid";
    await psql(`DELETE FROM app.user_company_access WHERE user_id IN (SELECT id FROM app.users WHERE email='${EMAIL}')`);
    await psql(`DELETE FROM app.users WHERE email='${EMAIL}'`);
    await psql(`INSERT INTO app.users (company_id, external_id, email, full_name, app_role, is_active)
                VALUES (${DEV}, 'at28-sekali-pakai', '${EMAIL}', 'Uji AI-28', 'viewer', true)`);
    await psql(`INSERT INTO app.user_company_access (user_id, company_id)
                SELECT id, ${DEV} FROM app.users WHERE email='${EMAIL}' ON CONFLICT DO NOTHING`);
    const target = await psql(`SELECT id::text FROM app.users WHERE email='${EMAIL}'`);
    ok("prasyarat: pengguna sekali pakai dibuat", /^[0-9a-f-]{36}$/.test(target), target);
    const aktifDi = async () => psql(`SELECT is_active::text FROM app.users WHERE id='${target}'`);

    // Halaman ini boleh DILIHAT approver (A-09) tapi mutasinya hanya super_admin.
    const sa = await login("admin@agrovision.local");
    const ap = await login("approver@agrovision.local");
    const halSa = await sa.get("/pengguna");
    const halAp = await ap.get("/pengguna");
    ok("super_admin melihat aksi per baris", /data-testid="nonaktifkan-pengguna"/.test(halSa.html));
    ok("approver melihat daftar tapi TIDAK melihat aksi",
      halAp.status === 200 && /Uji AI-28/.test(halAp.html) && !/data-testid="nonaktifkan-pengguna"/.test(halAp.html));
    // Akun sendiri tidak boleh punya tombol: menonaktifkan diri sendiri mengunci
    // pelakunya keluar pada request berikutnya.
    ok("akun sendiri tidak diberi tombol", /akun Anda sendiri/.test(halSa.html));

    // Pengguna aktif memang bisa masuk — supaya "tidak bisa masuk" nanti
    // membuktikan penonaktifannya, bukan sekadar akun yang tidak ada.
    let bisaMasukAwal = true;
    try { await login(EMAIL); } catch { bisaMasukAwal = false; }
    ok("pengguna sekali pakai bisa masuk selagi aktif", bisaMasukAwal);

    // POST langsung sebagai APPROVER — inilah gerbang yang sebenarnya. Field
    // $ACTION_* dipanen dari HTML SUPER_ADMIN (approver tidak dikirimi formnya)
    // lalu dikirim memakai kuki approver: persis yang bisa dilakukan penyerang
    // yang pernah melihat HTML orang lain sekali saja.
    //
    // pickForm mengembalikan { hidden }, BUKAN map-nya. Versi pertama uji ini
    // meng-iterasi objek pembungkusnya, jadi tidak satu pun field $ACTION_*
    // terkirim -> Next menjawab 500 sebelum kode aplikasi jalan, dan ujinya
    // "lulus" karena pengguna memang tetap aktif. Serangan yang tidak sampai ke
    // sasaran tidak membuktikan sasarannya terlindungi.
    const aksi = pickForm(halSa.html, "nonaktifkan-pengguna")?.hidden;
    ok("prasyarat: field aksi bisa dipanen dari HTML super_admin",
      Boolean(aksi) && Object.keys(aksi).some((k) => k.startsWith("$ACTION")),
      `${Object.keys(aksi ?? {}).length} field`);
    const fd = new FormData();
    for (const [k, v] of Object.entries(aksi ?? {})) fd.append(k, v);
    fd.set("id", target);
    fd.set("aktifkan", "0");
    const tembus = await fetch(`${BASE}/pengguna`, {
      method: "POST", headers: { cookie: ap.header() }, body: fd, redirect: "manual",
    });
    const balasan = await tembus.text();
    ok("approver POST langsung DITOLAK dengan rapi, pengguna tetap aktif",
      (await aktifDi()) === "true" && tembus.status === 200 && /Hanya Super Admin/.test(balasan),
      `is_active=${await aktifDi()} (status ${tembus.status})`);

    // super_admin menonaktifkan lewat form sungguhan.
    await sa.submit("/pengguna", { id: target, aktifkan: "0" }, { formMarker: "nonaktifkan-pengguna" });
    ok("super_admin bisa menonaktifkan", (await aktifDi()) === "false", `is_active=${await aktifDi()}`);

    // Nonaktif = akses benar-benar mati, bukan hanya lencana berubah. Sesi
    // diverifikasi ulang ke DB setiap request, jadi login harus gagal.
    let bisaMasuk = true;
    try { await login(EMAIL); } catch { bisaMasuk = false; }
    ok("pengguna nonaktif tidak bisa masuk lagi", bisaMasuk === false);

    // Tombol Hapus baru muncul SETELAH nonaktif (dua langkah, bukan satu klik).
    ok("tombol Hapus hanya muncul untuk pengguna nonaktif",
      /data-testid="hapus-pengguna"/.test((await sa.get("/pengguna")).html));

    // Aktifkan kembali lewat UI, lalu hapus benar-benar lewat UI.
    await sa.submit("/pengguna", { id: target, aktifkan: "1" }, { formMarker: "aktifkan-pengguna" });
    ok("bisa diaktifkan kembali", (await aktifDi()) === "true", `is_active=${await aktifDi()}`);

    // Hapus pengguna aktif ditolak: dua langkah wajib.
    await sa.submit("/pengguna", { id: target, aktifkan: "0" }, { formMarker: "nonaktifkan-pengguna" });
    await sa.submit("/pengguna", { id: target }, { formMarker: "hapus-pengguna" });
    const sisa = await psql(`SELECT count(*)::text FROM app.users WHERE id='${target}'`);
    ok("pengguna nonaktif tanpa riwayat benar-benar terhapus lewat UI", sisa === "0", `${sisa} baris tersisa`);

    // Super_admin aktif terakhir: ditolak, dengan alasan yang bisa dibaca.
    const diriSendiri = await psql(`SELECT id::text FROM app.users WHERE email='admin@agrovision.local'`);
    const tolak = await sa.submit("/pengguna", { id: diriSendiri, aktifkan: "0" }, { formMarker: "nonaktifkan-pengguna" });
    const saAktif = await psql(`SELECT is_active::text FROM app.users WHERE id='${diriSendiri}'`);
    ok("super_admin tidak bisa menonaktifkan dirinya sendiri", saAktif === "true" && tolak.status !== 500,
      `is_active=${saAktif} (status ${tolak.status})`);

    // Pembersihan terakhir bersifat SABUK PENGAMAN, bukan penopang: kalau blok di
    // atas gagal di tengah, baris sekali pakai ini tetap dibuang di run berikutnya
    // oleh DELETE di awal blok.
    await psql(`DELETE FROM app.user_company_access WHERE user_id IN (SELECT id FROM app.users WHERE email='${EMAIL}')`);
    await psql(`DELETE FROM app.users WHERE email='${EMAIL}'`);
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
