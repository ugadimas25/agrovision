import { rlsQuery, withRls, type RlsContext } from "@/lib/db";

/**
 * Rencana Anggaran (RAB Kebun) — migrasi 0060.
 *
 * Rantai yang disepakati rapat Fadli 26 Agu 2026:
 *   agronomis menyusun → finance (approver) menyetujui → master anggaran
 *
 * Repo ini berhenti di anak panah kedua. Materialisasi ke app.budgets belum
 * dikerjakan dan TIDAK boleh ditambal di sini: dua sumber untuk angka anggaran
 * adalah cara termurah membuat dua layar menampilkan angka berbeda.
 *
 * Total TIDAK dihitung ulang di TypeScript. amount_idr sudah kolom GENERATED di
 * database (volume × harga satuan), dan penjumlahannya ikut SQL — supaya angka
 * di layar, PDF, dan Excel berasal dari perkalian yang sama.
 */

export type BudgetPlanRow = {
  id: string;
  code: string;
  name: string;
  areaHa: number | null;
  horizonMonths: number;
  contingencyPct: number;
  /** Catatan penyusun. Seed demo memakainya untuk peringatan "angka ilustratif"
   *  — dan peringatan yang tidak sampai ke layar sama saja tidak ada. */
  note: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  createdByName: string | null;
  decidedByName: string | null;
  itemCount: number;
  /** Jumlah baris. null = belum ada baris sama sekali — BUKAN 0 rupiah. */
  subtotalIdr: number | null;
  /** Investasi awal (08_CAPEX_RAB). null = belum ada baris capex. */
  capexIdr: number | null;
  /** Biaya operasional berulang (09_OPEX_10Y). null = belum ada baris opex. */
  opexIdr: number | null;
  /** Nilai kontingensi. Dihitung dari subtotal DIKURANGI baris yang
   *  dikecualikan (mis. akuisisi lahan) — aturan 02_Assumptions C14. */
  contingencyIdr: number | null;
  /** subtotal + kontingensi. null bila subtotal null. */
  totalIdr: number | null;
};

/**
 * Registri sumber (0063) — padanan 16_Sources pada model Banyumas.
 *
 * `url` null berarti sumbernya memang tidak punya tautan (keputusan lisan,
 * penawaran di atas kertas), BUKAN "belum diisi menyusul". Layar merendernya
 * sebagai teks biasa, bukan tautan mati — tautan yang tidak menuju ke mana pun
 * lebih buruk daripada tidak ada tautan, karena ia mengaku bisa diperiksa.
 */
export type BudgetSourceRow = {
  id: string;
  code: string;
  topic: string | null;
  title: string;
  url: string | null;
  publishedOn: string | null;
  accessedOn: string | null;
  confidence: "high" | "medium" | "low" | null;
  note: string | null;
  /** Berapa baris RAB + asumsi (seluruh entitas) yang mengutip sumber ini. */
  citedBy: number;
};

/** Potongan sumber yang ikut menempel pada baris RAB / asumsi yang mengutipnya. */
export type BudgetSourceRef = {
  id: string;
  code: string;
  title: string;
  url: string | null;
};

export type BudgetAssumptionRow = {
  id: string;
  code: string;
  label: string;
  value: number;
  unit: string | null;
  sourceRef: string | null;
  confidence: "high" | "medium" | "low" | null;
  note: string | null;
  /** Berapa baris RAB yang volumenya bergantung pada asumsi ini. */
  usedBy: number;
  /** 0063. null = tidak ada sumber yang bisa ditautkan — periksa juga sourceRef,
   *  keduanya berdampingan dan tidak saling menggantikan. */
  source: BudgetSourceRef | null;
};

export type BudgetPlanItemRow = {
  id: string;
  phaseMonth: number;
  categoryName: string | null;
  description: string;
  itemKind: string;
  volume: number;
  uomName: string | null;
  unitPriceIdr: number;
  amountIdr: number;
  addedAfterApproval: boolean;
  note: string | null;
  /** 0061, mengikuti model Banyumas. */
  costKind: "capex" | "opex";
  stage: string | null;
  driver: string | null;
  sourceRef: string | null;
  confidence: "high" | "medium" | "low" | null;
  excludeFromContingency: boolean;
  /** false = dicoret, tetap ditampilkan tapi tidak ikut total mana pun. */
  isActive: boolean;
  /** 0062: volume diturunkan dari asumsi. null = diketik tangan. */
  basisCode: string | null;
  ratioPerBasis: number | null;
  /** 0063. Berdampingan dengan sourceRef di atas: yang ini bisa dibuka ulang,
   *  yang itu menampung keterangan bebas. null pada keduanya = belum disebutkan. */
  source: BudgetSourceRef | null;
};

const PLAN_SELECT = `
  SELECT p.id, p.code, p.name, p.area_ha, p.horizon_months, p.contingency_pct,
         p.note, p.approval_status, p.rejection_reason,
         cu.full_name AS created_by_name, du.full_name AS decided_by_name,
         COALESCE(i.n, 0) AS item_count,
         i.subtotal, i.capex, i.opex, i.dasar_cadangan
    FROM app.budget_plans p
    LEFT JOIN app.users cu ON cu.id = p.created_by
    LEFT JOIN app.users du ON du.id = p.decided_by
    LEFT JOIN LATERAL (
      -- Seluruh angka hanya dari baris AKTIF. Baris nonaktif tetap ada dan
      -- tetap terlihat, tapi tidak boleh ikut menggerakkan total mana pun.
      SELECT count(*) FILTER (WHERE is_active)::int AS n,
             sum(amount_idr) FILTER (WHERE is_active) AS subtotal,
             sum(amount_idr) FILTER (WHERE is_active AND cost_kind = 'capex') AS capex,
             sum(amount_idr) FILTER (WHERE is_active AND cost_kind = 'opex')  AS opex,
             -- Dasar kontingensi mengecualikan baris bertanda (akuisisi lahan).
             sum(amount_idr) FILTER (WHERE is_active AND NOT exclude_from_contingency) AS dasar_cadangan
        FROM app.budget_plan_items WHERE plan_id = p.id
    ) i ON true`;

type PlanDb = {
  id: string; code: string; name: string; area_ha: string | null;
  horizon_months: number; contingency_pct: string; note: string | null; approval_status: string;
  rejection_reason: string | null; created_by_name: string | null;
  decided_by_name: string | null; item_count: number; subtotal: string | null;
  capex: string | null; opex: string | null; dasar_cadangan: string | null;
};

function toPlan(r: PlanDb): BudgetPlanRow {
  // null dipertahankan apa adanya: RAB tanpa baris berarti "belum diisi",
  // bukan "nol rupiah". Layar merender em-dash untuk itu.
  const subtotal = r.subtotal === null ? null : Number(r.subtotal);
  const pct = Number(r.contingency_pct);
  // Kontingensi dihitung dari baris yang TIDAK dikecualikan, bukan dari
  // seluruh subtotal — 0060 melakukan yang kedua dan melebih-lebihkan
  // anggaran tepat pada komponen termahal (harga tanah).
  const dasar = r.dasar_cadangan === null ? null : Number(r.dasar_cadangan);
  const cadangan = dasar === null ? null : Math.round(dasar * pct / 100);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    areaHa: r.area_ha === null ? null : Number(r.area_ha),
    horizonMonths: r.horizon_months,
    contingencyPct: pct,
    note: r.note,
    approvalStatus: r.approval_status,
    rejectionReason: r.rejection_reason,
    createdByName: r.created_by_name,
    decidedByName: r.decided_by_name,
    itemCount: r.item_count,
    subtotalIdr: subtotal,
    capexIdr: r.capex === null ? null : Number(r.capex),
    opexIdr: r.opex === null ? null : Number(r.opex),
    contingencyIdr: cadangan,
    totalIdr: subtotal === null ? null : subtotal + (cadangan ?? 0),
  };
}

export async function listBudgetPlans(ctx: RlsContext): Promise<BudgetPlanRow[]> {
  const rows = await rlsQuery<PlanDb>(ctx, `${PLAN_SELECT} ORDER BY p.created_at DESC`);
  return rows.map(toPlan);
}

export async function getBudgetPlan(ctx: RlsContext, id: string): Promise<BudgetPlanRow | null> {
  const rows = await rlsQuery<PlanDb>(ctx, `${PLAN_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? toPlan(rows[0]) : null;
}

export async function listBudgetPlanItems(ctx: RlsContext, planId: string): Promise<BudgetPlanItemRow[]> {
  const rows = await rlsQuery<{
    id: string; phase_month: number; category_name: string | null; description: string;
    item_kind: string; volume: string; uom_name: string | null; unit_price_idr: string;
    amount_idr: string; added_after_approval: boolean; note: string | null;
    cost_kind: "capex" | "opex"; stage: string | null; driver: string | null;
    source_ref: string | null; confidence: "high" | "medium" | "low" | null;
    exclude_from_contingency: boolean; is_active: boolean;
    basis_code: string | null; ratio_per_basis: string | null;
    source_id: string | null; source_code: string | null;
    source_title: string | null; source_url: string | null;
  }>(
    ctx,
    `SELECT i.id, i.phase_month, cat.name AS category_name, i.description, i.item_kind,
            i.volume, uom.name AS uom_name, i.unit_price_idr, i.amount_idr,
            i.added_after_approval, i.note, i.cost_kind, i.stage, i.driver,
            i.source_ref, i.confidence, i.exclude_from_contingency, i.is_active,
            i.basis_code, i.ratio_per_basis,
            src.id AS source_id, src.code AS source_code,
            src.title AS source_title, src.url AS source_url
       FROM app.budget_plan_items i
       LEFT JOIN app.master_items cat ON cat.id = i.cost_category_id
       LEFT JOIN app.master_items uom ON uom.id = i.uom_item_id
       LEFT JOIN app.budget_sources src ON src.id = i.source_id
      WHERE i.plan_id = $1
      ORDER BY i.cost_kind, i.stage NULLS LAST, i.phase_month, i.sort_order, i.created_at`,
    [planId],
  );
  return rows.map((r) => ({
    id: r.id,
    phaseMonth: r.phase_month,
    categoryName: r.category_name,
    description: r.description,
    itemKind: r.item_kind,
    volume: Number(r.volume),
    uomName: r.uom_name,
    unitPriceIdr: Number(r.unit_price_idr),
    amountIdr: Number(r.amount_idr),
    addedAfterApproval: r.added_after_approval,
    note: r.note,
    costKind: r.cost_kind,
    stage: r.stage,
    driver: r.driver,
    sourceRef: r.source_ref,
    confidence: r.confidence,
    excludeFromContingency: r.exclude_from_contingency,
    isActive: r.is_active,
    basisCode: r.basis_code,
    ratioPerBasis: r.ratio_per_basis === null ? null : Number(r.ratio_per_basis),
    source: toSourceRef(r.source_id, r.source_code, r.source_title, r.source_url),
  }));
}

/** LEFT JOIN yang tidak ketemu memberi seluruh kolomnya null; itu artinya baris
 *  ini tidak mengutip registri, bukan mengutip sumber tanpa nama. */
function toSourceRef(
  id: string | null, code: string | null, title: string | null, url: string | null,
): BudgetSourceRef | null {
  return id === null ? null : { id, code: code ?? "", title: title ?? "", url };
}

/** Ringkasan per fase — dasar simulasi drawdown yang dibahas rapat. */
export async function budgetPlanByPhase(
  ctx: RlsContext,
  planId: string,
): Promise<{ phaseMonth: number; amountIdr: number }[]> {
  const rows = await rlsQuery<{ phase_month: number; amount: string }>(
    ctx,
    `SELECT phase_month, sum(amount_idr) AS amount
       FROM app.budget_plan_items WHERE plan_id = $1 AND is_active
      GROUP BY phase_month ORDER BY phase_month`,
    [planId],
  );
  return rows.map((r) => ({ phaseMonth: r.phase_month, amountIdr: Number(r.amount) }));
}

export async function createBudgetPlan(
  ctx: RlsContext,
  input: { code: string; name: string; areaHa: number | null; horizonMonths: number; contingencyPct: number },
): Promise<string> {
  return withRls(ctx, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO app.budget_plans (company_id, code, name, area_ha, horizon_months, contingency_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [ctx.companyId, input.code, input.name, input.areaHa, input.horizonMonths, input.contingencyPct, ctx.userId],
    );
    return r.rows[0].id;
  });
}

export async function addBudgetPlanItem(
  ctx: RlsContext,
  input: {
    planId: string; phaseMonth: number; costCategoryId: string; description: string;
    itemKind: string; volume: number; uomItemId: string | null; unitPriceIdr: number; note: string | null;
    costKind: "capex" | "opex"; stage: string | null; driver: string | null;
    sourceRef: string | null; confidence: "high" | "medium" | "low" | null;
    excludeFromContingency: boolean;
    /** 0063. Berdampingan dengan sourceRef, tidak menggantikannya. */
    sourceId: string | null;
    // 0062. Sempat hilang di jalur tulis: form mengumpulkannya, action
    // memvalidasinya berpasangan, lalu repo membuangnya diam-diam karena tipe
    // ini tidak menyebutnya. Akibatnya setiap baris tersimpan basis_code NULL,
    // sehingga seluruh tahap 2 mati dari UI: layar tidak menganotasi rumusnya,
    // dan mengubah asumsi tidak menggerakkan baris mana pun. tsc tidak
    // menangkapnya karena `parsed.data` bukan object literal, jadi properti
    // berlebih diterima tanpa keluhan.
    basisCode: string | null; ratioPerBasis: number | null;
  },
): Promise<void> {
  // Volume sengaja tetap dikirim apa adanya meski basis diisi: trigger
  // budget_item_derive_volume() (0062) BEFORE INSERT menimpanya dengan
  // nilai_asumsi x rasio. Itu juga yang membuat form boleh mengosongkan Volume
  // -- zod mengubah "" jadi 0, dan tanpa basis_code tersimpan angka 0 itu
  // menabrak CHECK (volume > 0) dengan galat Postgres mentah berbahasa Inggris.
  //
  // added_after_approval ditentukan DARI STATUS RAB-nya, bukan dari kiriman
  // form: rapat mengizinkan finance menambah baris setelah disetujui, dan
  // penanda itu harus jujur tanpa bergantung pada apa yang dikirim klien.
  await rlsQuery(
    ctx,
    `INSERT INTO app.budget_plan_items
       (plan_id, phase_month, cost_category_id, description, item_kind, volume,
        uom_item_id, unit_price_idr, note, created_by, added_after_approval,
        cost_kind, stage, driver, source_ref, confidence, exclude_from_contingency,
        source_id, basis_code, ratio_per_basis)
     SELECT $1,$2,$3,$4,$5::app.budget_item_kind,$6,$7,$8,$9,$10,
            (p.approval_status = 'approved'),
            $11::app.budget_cost_kind,$12,$13,$14,$15::app.assumption_confidence,$16,
            $17,$18,$19
       FROM app.budget_plans p WHERE p.id = $1`,
    [input.planId, input.phaseMonth, input.costCategoryId, input.description, input.itemKind,
     input.volume, input.uomItemId, input.unitPriceIdr, input.note, ctx.userId,
     input.costKind, input.stage, input.driver, input.sourceRef, input.confidence,
     input.excludeFromContingency, input.sourceId, input.basisCode, input.ratioPerBasis],
  );
}

/**
 * Nonaktifkan / hidupkan kembali satu baris RAB.
 *
 * TIDAK ada penghapusan. 17_Model_Fleksibel memakai kolom `Aktif` di seluruh
 * bagiannya dan peta ketergantungannya menulis "Jangan hapus baris total":
 * RAB adalah dokumen yang dinegosiasikan, dan baris yang dicoret finance
 * minggu ini bisa dihidupkan lagi bulan depan.
 */
export async function setBudgetPlanItemActive(
  ctx: RlsContext,
  itemId: string,
  aktif: boolean,
): Promise<number> {
  return withRls(ctx, async (c) => {
    const r = await c.query(
      `UPDATE app.budget_plan_items SET is_active = $2, updated_at = now() WHERE id = $1`,
      [itemId, aktif],
    );
    return r.rowCount ?? 0;
  });
}

/**
 * Sunting beberapa baris RAB sekaligus (tabel sunting-langsung).
 *
 * Satu pernyataan untuk semua baris: kalau tiap baris dikirim terpisah, sebagian
 * bisa lolos dan sebagian ditolak policy, dan RAB berakhir setengah tersimpan --
 * keadaan yang paling berbahaya menurut kepala migrasi 0062, karena ia terlihat
 * konsisten.
 *
 * `volume` SENGAJA tidak ditimpa untuk baris turunan. Trigger
 * budget_item_derive_volume() (0062) hanya menyala saat basis_code/ratio_per_basis
 * berubah -- BUKAN saat volume ditulis -- jadi menulis volume langsung ke baris
 * ber-basis akan membuat layar tetap mencetak "= net_ha x 70" untuk angka yang
 * bukan hasil perkalian itu. Penjagaan ini ditaruh di SQL, bukan hanya di layar:
 * baris turunan yang volumenya menyimpang persis yang dicari
 * app.check_budget_derived_volume().
 *
 * Mengembalikan id baris yang benar-benar berubah. Baris yang ditolak policy
 * lewat USING hilang diam-diam dari hasil (tidak melempar), jadi pemanggil wajib
 * membandingkan jumlahnya -- lihat gridAction.
 */
export async function updateBudgetPlanItems(
  ctx: RlsContext,
  planId: string,
  edits: { id: string; phaseMonth: number; description: string; volume: number; unitPriceIdr: number }[],
): Promise<string[]> {
  if (edits.length === 0) return [];
  return withRls(ctx, async (c) => {
    const r = await c.query(
      `UPDATE app.budget_plan_items i
          SET phase_month    = v.bulan,
              description    = v.uraian,
              unit_price_idr = v.harga,
              volume         = CASE WHEN i.basis_code IS NULL THEN v.volume ELSE i.volume END,
              updated_at     = now()
         FROM (SELECT * FROM unnest($2::uuid[], $3::int[], $4::text[], $5::numeric[], $6::numeric[])
                 AS t(id, bulan, uraian, volume, harga)) v
        WHERE i.id = v.id
          AND i.plan_id = $1
          -- Hanya baris yang benar-benar berubah, supaya jumlah kembalian bisa
          -- dipakai membedakan "tidak ada yang diubah" dari "ditolak policy".
          -- Tanda kurungnya WAJIB: tanpa itu presedensi AND/OR membuat cabang
          -- volume ikut mengabaikan syarat plan_id.
          AND (
                (i.phase_month, i.description, i.unit_price_idr)
                  IS DISTINCT FROM (v.bulan, v.uraian, v.harga)
             OR (i.basis_code IS NULL AND i.volume IS DISTINCT FROM v.volume)
              )
        RETURNING i.id`,
      [planId, edits.map((e) => e.id), edits.map((e) => e.phaseMonth), edits.map((e) => e.description),
       edits.map((e) => e.volume), edits.map((e) => e.unitPriceIdr)],
    );
    return r.rows.map((row: { id: string }) => row.id);
  });
}

/**
 * Hapus satu baris RAB. rowCount 0 = policy bpi_edit_delete menyaringnya lewat
 * USING -- diam, tanpa galat.
 */
export async function deleteBudgetPlanItem(
  ctx: RlsContext,
  planId: string,
  itemId: string,
): Promise<number> {
  return withRls(ctx, async (c) => {
    const r = await c.query(
      `DELETE FROM app.budget_plan_items WHERE id = $1 AND plan_id = $2`,
      [itemId, planId],
    );
    return r.rowCount ?? 0;
  });
}

/**
 * Ajukan RAB. rowCount 0 = RLS menolak (bukan penyusunnya, atau statusnya
 * bukan draft/rejected) — policy bp_edit_gate menyaring lewat USING, dan
 * penyaringan USING TIDAK melempar galat, ia diam.
 */
export async function submitBudgetPlan(ctx: RlsContext, id: string): Promise<number> {
  return withRls(ctx, async (c) => {
    const r = await c.query(
      `UPDATE app.budget_plans
          SET approval_status = 'submitted', submitted_at = now(), updated_at = now(),
              rejection_reason = NULL
        WHERE id = $1 AND approval_status IN ('draft','rejected')`,
      [id],
    );
    return r.rowCount ?? 0;
  });
}

export async function decideBudgetPlan(
  ctx: RlsContext,
  id: string,
  decision: "approved" | "rejected",
  reason: string | null,
): Promise<number> {
  return withRls(ctx, async (c) => {
    const r = await c.query(
      `UPDATE app.budget_plans
          SET approval_status = $2::app.record_status,
              rejection_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE NULL END,
              decided_by = $4, decided_at = now(), updated_at = now()
        WHERE id = $1 AND approval_status IN ('submitted','under_review')`,
      [id, decision, reason, ctx.userId],
    );
    return r.rowCount ?? 0;
  });
}

/**
 * Asumsi satu RAB — pusat penggerak, mengikuti 02_Assumptions (tahap 2,
 * docs/19). `usedBy` dihitung di SQL supaya layar bisa memperingatkan sebelum
 * seseorang menghapus asumsi yang masih menggerakkan baris.
 */
export async function listBudgetAssumptions(
  ctx: RlsContext,
  planId: string,
): Promise<BudgetAssumptionRow[]> {
  const rows = await rlsQuery<{
    id: string; code: string; label: string; value: string; unit: string | null;
    source_ref: string | null; confidence: "high" | "medium" | "low" | null;
    note: string | null; used_by: number;
    source_id: string | null; source_code: string | null;
    source_title: string | null; source_url: string | null;
  }>(
    ctx,
    `SELECT a.id, a.code, a.label, a.value, a.unit, a.source_ref, a.confidence, a.note,
            (SELECT count(*)::int FROM app.budget_plan_items i
              WHERE i.plan_id = a.plan_id AND i.basis_code = a.code) AS used_by,
            src.id AS source_id, src.code AS source_code,
            src.title AS source_title, src.url AS source_url
       FROM app.budget_assumptions a
       LEFT JOIN app.budget_sources src ON src.id = a.source_id
      WHERE a.plan_id = $1
      ORDER BY a.sort_order, a.code`,
    [planId],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    value: Number(r.value),
    unit: r.unit,
    sourceRef: r.source_ref,
    confidence: r.confidence,
    note: r.note,
    usedBy: r.used_by,
    source: toSourceRef(r.source_id, r.source_code, r.source_title, r.source_url),
  }));
}

/**
 * Registri sumber satu ENTITAS — bukan satu RAB.
 *
 * Satu SK Gubernur dikutip banyak RAB; menyalinnya per RAB akan melahirkan
 * sepuluh versi yang perlahan berbeda isi (lihat kepala migrasi 0063).
 * `citedBy` dihitung di SQL supaya layar bisa memberi tahu sebuah sumber masih
 * dipakai SEBELUM ada yang mencoba menghapusnya — FK ON DELETE RESTRICT akan
 * menolaknya, dan penolakan yang bisa ditebak lebih baik daripada galat.
 */
export async function listBudgetSources(ctx: RlsContext): Promise<BudgetSourceRow[]> {
  const rows = await rlsQuery<{
    id: string; code: string; topic: string | null; title: string; url: string | null;
    published_on: string | null; accessed_on: string | null;
    confidence: "high" | "medium" | "low" | null; note: string | null; cited_by: number;
  }>(
    ctx,
    `SELECT s.id, s.code, s.topic, s.title, s.url,
            to_char(s.published_on, 'YYYY-MM-DD') AS published_on,
            to_char(s.accessed_on,  'YYYY-MM-DD') AS accessed_on,
            s.confidence, s.note,
            ((SELECT count(*) FROM app.budget_plan_items i WHERE i.source_id = s.id)
           + (SELECT count(*) FROM app.budget_assumptions a WHERE a.source_id = s.id))::int AS cited_by
       FROM app.budget_sources s
      ORDER BY s.topic NULLS LAST, s.code`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    topic: r.topic,
    title: r.title,
    // null dipertahankan: sumber tanpa tautan/tanggal dirender em-dash, bukan
    // string kosong yang terlihat seperti kolom yang lupa diisi.
    url: r.url,
    publishedOn: r.published_on,
    accessedOn: r.accessed_on,
    confidence: r.confidence,
    note: r.note,
    citedBy: r.cited_by,
  }));
}

export async function createBudgetSource(
  ctx: RlsContext,
  input: {
    code: string; topic: string | null; title: string; url: string | null;
    publishedOn: string | null; accessedOn: string | null;
    confidence: "high" | "medium" | "low" | null; note: string | null;
  },
): Promise<void> {
  await rlsQuery(
    ctx,
    `INSERT INTO app.budget_sources
       (company_id, code, topic, title, url, published_on, accessed_on, confidence, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8::app.assumption_confidence,$9,$10)`,
    [ctx.companyId, input.code, input.topic, input.title, input.url,
     input.publishedOn, input.accessedOn, input.confidence, input.note, ctx.userId],
  );
}

export async function addBudgetAssumption(
  ctx: RlsContext,
  input: {
    planId: string; code: string; label: string; value: number; unit: string | null;
    sourceRef: string | null; confidence: "high" | "medium" | "low" | null; note: string | null;
    sourceId: string | null;
  },
): Promise<void> {
  await rlsQuery(
    ctx,
    `INSERT INTO app.budget_assumptions
       (plan_id, code, label, value, unit, source_ref, confidence, note, created_by,
        sort_order, source_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::app.assumption_confidence,$8,$9,
             COALESCE((SELECT max(sort_order) + 1 FROM app.budget_assumptions WHERE plan_id = $1), 0),
             $10)`,
    [input.planId, input.code, input.label, input.value, input.unit, input.sourceRef,
     input.confidence, input.note, ctx.userId, input.sourceId],
  );
}

/**
 * Ubah nilai asumsi. Trigger app.budget_assumption_cascade() (0062) langsung
 * menghitung ulang seluruh baris yang memakainya — itulah inti tahap 2, dan
 * sebabnya nilai TIDAK boleh diubah lewat UPDATE langsung dari tempat lain.
 */
export async function updateBudgetAssumptionValue(
  ctx: RlsContext,
  id: string,
  value: number,
  sourceId: string | null,
): Promise<number> {
  return withRls(ctx, async (c) => {
    const r = await c.query(
      `UPDATE app.budget_assumptions
          SET value = $2, source_id = $3, updated_at = now()
        WHERE id = $1`,
      [id, value, sourceId],
    );
    return r.rowCount ?? 0;
  });
}
