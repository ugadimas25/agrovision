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
  approvalStatus: string;
  rejectionReason: string | null;
  createdByName: string | null;
  decidedByName: string | null;
  itemCount: number;
  /** Jumlah baris. null = belum ada baris sama sekali — BUKAN 0 rupiah. */
  subtotalIdr: number | null;
  /** subtotal + kontingensi. null bila subtotal null. */
  totalIdr: number | null;
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
};

const PLAN_SELECT = `
  SELECT p.id, p.code, p.name, p.area_ha, p.horizon_months, p.contingency_pct,
         p.approval_status, p.rejection_reason,
         cu.full_name AS created_by_name, du.full_name AS decided_by_name,
         COALESCE(i.n, 0) AS item_count,
         i.subtotal
    FROM app.budget_plans p
    LEFT JOIN app.users cu ON cu.id = p.created_by
    LEFT JOIN app.users du ON du.id = p.decided_by
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n, sum(amount_idr) AS subtotal
        FROM app.budget_plan_items WHERE plan_id = p.id
    ) i ON true`;

type PlanDb = {
  id: string; code: string; name: string; area_ha: string | null;
  horizon_months: number; contingency_pct: string; approval_status: string;
  rejection_reason: string | null; created_by_name: string | null;
  decided_by_name: string | null; item_count: number; subtotal: string | null;
};

function toPlan(r: PlanDb): BudgetPlanRow {
  // null dipertahankan apa adanya: RAB tanpa baris berarti "belum diisi",
  // bukan "nol rupiah". Layar merender em-dash untuk itu.
  const subtotal = r.subtotal === null ? null : Number(r.subtotal);
  const pct = Number(r.contingency_pct);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    areaHa: r.area_ha === null ? null : Number(r.area_ha),
    horizonMonths: r.horizon_months,
    contingencyPct: pct,
    approvalStatus: r.approval_status,
    rejectionReason: r.rejection_reason,
    createdByName: r.created_by_name,
    decidedByName: r.decided_by_name,
    itemCount: r.item_count,
    subtotalIdr: subtotal,
    totalIdr: subtotal === null ? null : Math.round(subtotal * (1 + pct / 100)),
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
  }>(
    ctx,
    `SELECT i.id, i.phase_month, cat.name AS category_name, i.description, i.item_kind,
            i.volume, uom.name AS uom_name, i.unit_price_idr, i.amount_idr,
            i.added_after_approval, i.note
       FROM app.budget_plan_items i
       LEFT JOIN app.master_items cat ON cat.id = i.cost_category_id
       LEFT JOIN app.master_items uom ON uom.id = i.uom_item_id
      WHERE i.plan_id = $1
      ORDER BY i.phase_month, i.sort_order, i.created_at`,
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
  }));
}

/** Ringkasan per fase — dasar simulasi drawdown yang dibahas rapat. */
export async function budgetPlanByPhase(
  ctx: RlsContext,
  planId: string,
): Promise<{ phaseMonth: number; amountIdr: number }[]> {
  const rows = await rlsQuery<{ phase_month: number; amount: string }>(
    ctx,
    `SELECT phase_month, sum(amount_idr) AS amount
       FROM app.budget_plan_items WHERE plan_id = $1
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
  },
): Promise<void> {
  // added_after_approval ditentukan DARI STATUS RAB-nya, bukan dari kiriman
  // form: rapat mengizinkan finance menambah baris setelah disetujui, dan
  // penanda itu harus jujur tanpa bergantung pada apa yang dikirim klien.
  await rlsQuery(
    ctx,
    `INSERT INTO app.budget_plan_items
       (plan_id, phase_month, cost_category_id, description, item_kind, volume,
        uom_item_id, unit_price_idr, note, created_by, added_after_approval)
     SELECT $1,$2,$3,$4,$5::app.budget_item_kind,$6,$7,$8,$9,$10,
            (p.approval_status = 'approved')
       FROM app.budget_plans p WHERE p.id = $1`,
    [input.planId, input.phaseMonth, input.costCategoryId, input.description, input.itemKind,
     input.volume, input.uomItemId, input.unitPriceIdr, input.note, ctx.userId],
  );
}

export async function deleteBudgetPlanItem(ctx: RlsContext, itemId: string): Promise<number> {
  return withRls(ctx, async (c) => {
    const r = await c.query(`DELETE FROM app.budget_plan_items WHERE id = $1`, [itemId]);
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
