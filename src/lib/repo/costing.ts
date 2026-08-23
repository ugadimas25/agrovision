import { rlsQuery, withRls, type RlsContext } from "@/lib/db";
import type { Page } from "./blocks";

/**
 * Akses data costing.
 *
 * Titik penting: SEMUA agregasi dibaca dari view `v_block_cost_summary` dan
 * `v_budget_vs_actual` (migrasi 0017/0018), bukan dihitung ulang di TypeScript.
 * Satu definisi angka, di satu tempat -- kalau tidak, laporan dan dashboard
 * akan menampilkan nilai berbeda dan tak ada yang tahu mana yang benar.
 *
 * View memakai security_invoker=true, jadi RLS pemanggil tetap berlaku.
 */

export type ExpenditureRow = {
  id: string;
  transactionDate: string;
  blockCode: string | null;
  costCategoryName: string | null;
  /** Dibutuhkan editor AI-11 (defaultValue dropdown), bukan hanya namanya. */
  costCategoryId: string | null;
  note: string | null;
  supplierName: string | null;
  quantity: number | null;
  unitName: string | null;
  amountIdr: number;
  approvalStatus: string;
  rejectionReason: string | null;
  isOverhead: boolean;
  evidenceCount: number;
  /** Bukti pertama yang tertaut (satu transaksi = satu bukti saat ini) -- untuk link "lihat". */
  evidenceId: string | null;
  createdByName: string | null;
};

const EXP_SELECT = `
  SELECT ct.id, ct.transaction_date, b.code AS block_code, cat.name AS cost_category_name,
         s.name AS supplier_name, ct.quantity, uom.name AS unit_name, ct.amount_idr,
         ct.approval_status, ct.rejection_reason, ct.is_overhead,
         u.full_name AS created_by_name,
         (SELECT count(*) FROM app.evidence_links el
           WHERE el.entity_type = 'cost_transaction' AND el.entity_id = ct.id) AS evidence_count,
         (SELECT el.evidence_id FROM app.evidence_links el
           WHERE el.entity_type = 'cost_transaction' AND el.entity_id = ct.id
           ORDER BY el.evidence_id LIMIT 1) AS evidence_id
    FROM app.cost_transactions ct
    LEFT JOIN app.blocks b        ON b.id = ct.block_id
    LEFT JOIN app.master_items cat ON cat.id = ct.cost_category_id
    LEFT JOIN app.master_items uom ON uom.id = ct.uom_item_id
    LEFT JOIN app.suppliers s     ON s.id = ct.supplier_id
    LEFT JOIN app.users u         ON u.id = ct.created_by`;

function mapExp(r: Record<string, unknown>): ExpenditureRow {
  return {
    id: String(r.id),
    transactionDate: String(r.transaction_date),
    blockCode: (r.block_code as string) ?? null,
    costCategoryName: (r.cost_category_name as string) ?? null,
    costCategoryId: (r.cost_category_id as string) ?? null,
    note: (r.note as string) ?? null,
    supplierName: (r.supplier_name as string) ?? null,
    quantity: r.quantity === null ? null : Number(r.quantity),
    unitName: (r.unit_name as string) ?? null,
    amountIdr: Number(r.amount_idr),
    approvalStatus: String(r.approval_status),
    rejectionReason: (r.rejection_reason as string) ?? null,
    isOverhead: Boolean(r.is_overhead),
    evidenceCount: Number(r.evidence_count),
    evidenceId: (r.evidence_id as string) ?? null,
    createdByName: (r.created_by_name as string) ?? null,
  };
}

export async function listExpenditures(
  ctx: RlsContext,
  opts: {
    page?: number;
    pageSize?: number;
    status?: string;
    blockId?: string;
    search?: string;
  } = {},
): Promise<Page<ExpenditureRow>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  return withRls(ctx, async (client) => {
    const where = `
      WHERE ($1::text IS NULL OR ct.approval_status::text = $1)
        AND ($2::uuid IS NULL OR ct.block_id = $2)
        AND ($3::text IS NULL OR b.code ILIKE '%' || $3 || '%'
                              OR cat.name ILIKE '%' || $3 || '%'
                              OR s.name ILIKE '%' || $3 || '%')`;
    const params = [opts.status ?? null, opts.blockId ?? null, opts.search?.trim() || null];

    const total = await client.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM app.cost_transactions ct
         LEFT JOIN app.blocks b ON b.id = ct.block_id
         LEFT JOIN app.master_items cat ON cat.id = ct.cost_category_id
         LEFT JOIN app.suppliers s ON s.id = ct.supplier_id
        ${where}`,
      params,
    );

    const rows = await client.query(
      `${EXP_SELECT} ${where} ORDER BY ct.transaction_date DESC, ct.id DESC LIMIT $4 OFFSET $5`,
      [...params, pageSize, offset],
    );

    return {
      rows: rows.rows.map(mapExp),
      total: Number(total.rows[0].n),
      page,
      pageSize,
    };
  });
}

export async function createExpenditure(
  ctx: RlsContext,
  input: {
    blockId: string | null;
    isOverhead: boolean;
    costCategoryId: string;
    costCenterId: string | null;
    supplierId?: string | null;
    uomItemId?: string | null;
    fiscalPeriodId?: string | null;
    transactionDate: string;
    quantity?: number | null;
    unitPriceIdr?: number | null;
    amountIdr: number;
    note?: string | null;
    externalDocumentNo?: string | null;
    evidence: {
      storagePath: string;
      sha256: string;
      sizeBytes: number;
      mimeType: string;
      fileName: string;
    };
  },
): Promise<string> {
  return withRls(ctx, async (client) => {
    const ct = await client.query<{ id: string }>(
      `INSERT INTO app.cost_transactions
         (company_id, cost_center_id, block_id, cost_category_id, uom_item_id, supplier_id,
          fiscal_period_id, transaction_date, quantity, unit_price_idr, amount_idr, unit,
          is_overhead, external_document_no, note, approval_status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,
               -- Periode fiskal diturunkan dari TANGGAL bila tidak diberikan.
               -- Tanpa ini, pengeluaran tanpa periode tidak akan pernah cocok
               -- dengan anggaran periode, dan perbandingannya diam-diam nol --
               -- pengguna melihat "belum terserap" padahal uangnya sudah keluar.
               COALESCE($7, (SELECT fp.id FROM app.fiscal_periods fp
                              WHERE fp.company_id = $1 AND NOT fp.is_closed
                                AND $8::date BETWEEN fp.starts_on AND fp.ends_on
                              ORDER BY fp.starts_on LIMIT 1)),
               $8,$9,$10,$11,
               (SELECT code FROM app.master_items WHERE id = $5),
               $12,$13,$14,'draft',$15,$15)
       RETURNING id`,
      [
        ctx.companyId,
        input.costCenterId ?? null,
        input.blockId,
        input.costCategoryId,
        input.uomItemId ?? null,
        input.supplierId ?? null,
        input.fiscalPeriodId ?? null,
        input.transactionDate,
        input.quantity ?? null,
        input.unitPriceIdr ?? null,
        input.amountIdr,
        input.isOverhead,
        input.externalDocumentNo ?? null,
        input.note ?? null,
        ctx.userId,
      ],
    );
    const id = ct.rows[0].id;

    // Bukti pembelian WAJIB (concept:160). Disimpan sebagai evidence_files +
    // evidence_links supaya berkas yang sama bisa dipakai lintas modul.
    const ev = await client.query<{ id: string }>(
      `INSERT INTO app.evidence_files
         (company_id, block_id, evidence_type, file_name, storage_path, mime_type,
          size_bytes, sha256, uploaded_by)
       VALUES ($1,$2,'document',$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        ctx.companyId,
        input.blockId,
        input.evidence.fileName,
        input.evidence.storagePath,
        input.evidence.mimeType,
        input.evidence.sizeBytes,
        input.evidence.sha256,
        ctx.userId,
      ],
    );

    // Tautkan bukti ke transaksinya -- tanpa ini, evidenceCount selalu 0 dan
    // bukti tidak bisa ditelusuri dari daftar Pengeluaran maupun Inbox Approval.
    await client.query(
      `INSERT INTO app.evidence_links (evidence_id, entity_type, entity_id)
       VALUES ($1, 'cost_transaction', $2)`,
      [ev.rows[0].id, id],
    );

    return id;
  });
}

/** draft -> submitted. Hanya pembuatnya, dan hanya dari draft/rejected. */
/**
 * Perbaiki pengeluaran yang masih draft ATAU sudah ditolak (AI-11, catatan 6.5).
 *
 * Tanpa ini, record yang ditolak jadi jalan buntu: creator melihat alasannya
 * tetapi tidak punya cara memperbaikinya, sehingga satu-satunya jalan adalah
 * membuat record baru dan meninggalkan yang lama menggantung.
 *
 * Yang menjaga batasnya adalah policy `ct_role_split` (migrasi 0018/0025):
 * `USING` menguji baris LAMA, jadi creator hanya lolos untuk barisnya sendiri
 * yang berstatus draft/rejected. Klausa WHERE di sini mengulang syarat itu supaya
 * pemanggil mendapat rowCount 0 yang bisa dijelaskan, bukan "0 baris" senyap dari
 * RLS. Baris yang sudah approved tidak bisa disentuh — koreksinya lewat baris
 * pembalik (§13 aturan 3), bukan menulis ulang sejarah.
 *
 * rejection_reason TIDAK dihapus di sini: alasannya harus tetap terbaca sampai
 * record benar-benar diajukan ulang (submitExpenditure yang membersihkannya).
 */
export async function updateExpenditure(
  ctx: RlsContext,
  id: string,
  input: {
    costCategoryId: string;
    transactionDate: string;
    amountIdr: number;
    quantity: number | null;
    unitPriceIdr: number | null;
    note: string | null;
  },
): Promise<number> {
  return withRls(ctx, async (client) => {
    const res = await client.query(
      // approval_status DIKEMBALIKAN ke 'draft' — bukan pilihan gaya, tapi tuntutan
      // policy ct_role_split: `USING` menguji baris LAMA (creator boleh menyentuh
      // draft/rejected miliknya) sementara `WITH CHECK` menguji baris BARU dan hanya
      // meloloskan draft/submitted. Mempertahankan 'rejected' membuat UPDATE ditolak
      // RLS. Semantiknya pun benar: begitu diperbaiki, record itu bukan lagi
      // "ditolak" — ia draft yang menunggu diajukan ulang.
      //
      // rejection_reason SENGAJA dipertahankan supaya creator tetap membaca apa yang
      // harus diperbaiki; submitExpenditure yang membersihkannya saat diajukan ulang.
      `UPDATE app.cost_transactions
          SET cost_category_id = $2,
              transaction_date = $3::date,
              amount_idr       = $4,
              quantity         = $5,
              unit_price_idr   = $6,
              note             = $7,
              approval_status  = 'draft',
              updated_at = now(), updated_by = $8
        WHERE id = $1 AND approval_status IN ('draft','rejected')`,
      [id, input.costCategoryId, input.transactionDate, input.amountIdr,
       input.quantity, input.unitPriceIdr, input.note, ctx.userId],
    );
    return res.rowCount ?? 0;
  });
}

export async function submitExpenditure(ctx: RlsContext, id: string): Promise<number> {
  return withRls(ctx, async (client) => {
    const res = await client.query(
      `UPDATE app.cost_transactions
          SET approval_status = 'submitted', submitted_at = now(),
              rejection_reason = NULL, updated_at = now(), updated_by = $2
        WHERE id = $1 AND approval_status IN ('draft','rejected')`,
      [id, ctx.userId],
    );
    return res.rowCount ?? 0;
  });
}

/**
 * Keputusan approval. Hanya approver/super_admin -- ditegakkan RLS policy
 * ct_role_split (0018 §9), bukan hanya oleh pemeriksaan di Server Action.
 */
export async function decideExpenditure(
  ctx: RlsContext,
  id: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<number> {
  return withRls(ctx, async (client) => {
    const res = await client.query(
      // $2 dicast eksplisit: dipakai sebagai enum record_status pada assignment
      // sekaligus dibandingkan ke literal teks. Tanpa cast, Postgres menolak
      // dengan "inconsistent types deduced for parameter $2".
      `UPDATE app.cost_transactions
          SET approval_status = $2::app.record_status,
              rejection_reason = CASE WHEN $2::text = 'rejected' THEN $3 ELSE NULL END,
              updated_at = now(), updated_by = $4
        WHERE id = $1 AND approval_status IN ('submitted','under_review')`,
      [id, decision, reason ?? null, ctx.userId],
    );
    return res.rowCount ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Agregasi -- dibaca dari view, tidak dihitung ulang di sini
// ---------------------------------------------------------------------------

export type BlockCostRow = {
  blockId: string;
  blockCode: string;
  areaHa: number | null;
  transactionCount: number;
  /** null bila belum ada transaksi disetujui. JANGAN diganti 0 (migrasi 0039). */
  totalCostIdr: number | null;
  /** null bila luas belum ada. JANGAN diganti 0 -- itu angka fabrikasi. */
  costPerHaIdr: number | null;
};

export async function blockCostSummary(
  ctx: RlsContext,
  opts: { limit?: number } = {},
): Promise<BlockCostRow[]> {
  const rows = await rlsQuery<{
    block_id: string; block_code: string; area_ha: string | null;
    transaction_count: string; total_cost_idr: string | null; cost_per_ha_idr: string | null;
  }>(
    ctx,
    `SELECT block_id, block_code, area_ha, transaction_count, total_cost_idr, cost_per_ha_idr
       FROM app.v_block_cost_summary
      WHERE transaction_count > 0
      -- NULLS LAST wajib: pada DESC, Postgres menaruh NULL di ATAS, jadi blok
      -- "belum ada biaya" akan memimpin daftar "biaya tertinggi".
      ORDER BY total_cost_idr DESC NULLS LAST
      LIMIT $1`,
    [opts.limit ?? 50],
  );
  return rows.map((r) => ({
    blockId: r.block_id,
    blockCode: r.block_code,
    areaHa: r.area_ha === null ? null : Number(r.area_ha),
    transactionCount: Number(r.transaction_count),
    // null = belum ada transaksi disetujui. JANGAN `Number(null)` -> 0.
    totalCostIdr: r.total_cost_idr === null ? null : Number(r.total_cost_idr),
    costPerHaIdr: r.cost_per_ha_idr === null ? null : Number(r.cost_per_ha_idr),
  }));
}

export type BudgetVsActualRow = {
  budgetId: string;
  periodName: string;
  costCategoryName: string;
  scopeType: string;
  budgetIdr: number;
  /** null = belum ada realisasi. Bukan 0 — lihat migrasi 0039. */
  actualIdr: number | null;
  remainingIdr: number;
  utilisationPct: number | null;
  isOverBudget: boolean;
};

export async function budgetVsActual(ctx: RlsContext): Promise<BudgetVsActualRow[]> {
  const rows = await rlsQuery<{
    budget_id: string; period_name: string; cost_category_name: string; scope_type: string;
    budget_idr: string; actual_idr: string | null; remaining_idr: string;
    utilisation_pct: string | null; is_over_budget: boolean;
  }>(
    ctx,
    `SELECT budget_id, period_name, cost_category_name, scope_type,
            budget_idr, actual_idr, remaining_idr, utilisation_pct, is_over_budget
       FROM app.v_budget_vs_actual
      ORDER BY period_name, cost_category_name, scope_type`,
  );
  return rows.map((r) => ({
    budgetId: r.budget_id,
    periodName: r.period_name,
    costCategoryName: r.cost_category_name,
    scopeType: r.scope_type,
    budgetIdr: Number(r.budget_idr),
    actualIdr: r.actual_idr === null ? null : Number(r.actual_idr),
    remainingIdr: Number(r.remaining_idr),
    utilisationPct: r.utilisation_pct === null ? null : Number(r.utilisation_pct),
    isOverBudget: r.is_over_budget,
  }));
}

/** Total pengeluaran approved. Dipakai KPI; null bila belum ada data sama sekali. */
export async function totalApprovedSpend(ctx: RlsContext): Promise<number | null> {
  const rows = await rlsQuery<{ total: string | null; n: string }>(
    ctx,
    `SELECT sum(amount_idr) AS total, count(*) AS n
       FROM app.cost_transactions WHERE approval_status = 'approved'`,
  );
  const n = Number(rows[0]?.n ?? 0);
  return n === 0 ? null : Number(rows[0].total ?? 0);
}

export async function listCostCenterOptions(
  ctx: RlsContext,
): Promise<{ value: string; label: string }[]> {
  const rows = await rlsQuery<{ id: string; name: string }>(
    ctx,
    `SELECT id, name FROM app.cost_centers ORDER BY name`,
  );
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function listFiscalPeriodOptions(
  ctx: RlsContext,
): Promise<{ value: string; label: string }[]> {
  const rows = await rlsQuery<{ id: string; name: string }>(
    ctx,
    `SELECT id, name FROM app.fiscal_periods WHERE NOT is_closed ORDER BY starts_on`,
  );
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function listSupplierOptions(
  ctx: RlsContext,
): Promise<{ value: string; label: string }[]> {
  const rows = await rlsQuery<{ id: string; name: string }>(
    ctx,
    `SELECT id, name FROM app.suppliers WHERE is_active ORDER BY name`,
  );
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

// ---------------------------------------------------------------------------
// Inbox approval
// ---------------------------------------------------------------------------

export type PendingApproval = {
  id: string;
  module: string;
  transactionDate: string;
  blockCode: string | null;
  costCategoryName: string | null;
  amountIdr: number;
  submittedAt: string | null;
  createdByName: string | null;
  evidenceCount: number;
  approvalStatus: string;
};

/**
 * Item yang menunggu keputusan.
 *
 * Saat ini hanya pengeluaran -- satu-satunya modul yang sudah punya form.
 * Bentuk kembaliannya sengaja generik (kolom `module`) supaya modul berikutnya
 * (survei, persiapan lahan, DBH) tinggal di-UNION di sini tanpa mengubah layar:
 * concept:185 meminta approval jadi lapisan lintas-modul, bukan silo.
 */
export async function listPendingApprovals(
  ctx: RlsContext,
  opts: { page?: number; pageSize?: number } = {},
): Promise<Page<PendingApproval>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  return withRls(ctx, async (client) => {
    const cond = `WHERE ct.approval_status IN ('submitted','under_review')`;

    const total = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.cost_transactions ct ${cond}`,
    );

    const rows = await client.query(
      `SELECT ct.id, 'Pengeluaran' AS module, ct.transaction_date, b.code AS block_code,
              cat.name AS cost_category_name, ct.amount_idr, ct.submitted_at,
              ct.approval_status, u.full_name AS created_by_name,
              (SELECT count(*) FROM app.evidence_links el
                WHERE el.entity_type = 'cost_transaction' AND el.entity_id = ct.id) AS evidence_count
         FROM app.cost_transactions ct
         LEFT JOIN app.blocks b ON b.id = ct.block_id
         LEFT JOIN app.master_items cat ON cat.id = ct.cost_category_id
         LEFT JOIN app.users u ON u.id = ct.created_by
        ${cond}
        ORDER BY ct.submitted_at NULLS LAST, ct.id
        LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    return {
      rows: rows.rows.map((r) => ({
        id: String(r.id),
        module: String(r.module),
        transactionDate: String(r.transaction_date),
        blockCode: (r.block_code as string) ?? null,
        costCategoryName: (r.cost_category_name as string) ?? null,
        amountIdr: Number(r.amount_idr),
        submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
        createdByName: (r.created_by_name as string) ?? null,
        evidenceCount: Number(r.evidence_count),
        approvalStatus: String(r.approval_status),
      })),
      total: Number(total.rows[0].n),
      page,
      pageSize,
    };
  });
}

// ---------------------------------------------------------------------------
// Periode fiskal & anggaran
// ---------------------------------------------------------------------------

export type FiscalPeriod = {
  id: string;
  code: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  isClosed: boolean;
};

export async function listFiscalPeriods(ctx: RlsContext): Promise<FiscalPeriod[]> {
  const rows = await rlsQuery<{
    id: string; code: string; name: string; kind: string;
    starts_on: string; ends_on: string; is_closed: boolean;
  }>(
    ctx,
    `SELECT id, code, name, kind, starts_on, ends_on, is_closed
       FROM app.fiscal_periods ORDER BY starts_on, sort_order`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    isClosed: r.is_closed,
  }));
}

export async function createFiscalPeriod(
  ctx: RlsContext,
  input: { code: string; name: string; startsOn: string; endsOn: string; kind?: string },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.fiscal_periods (company_id, kind, code, name, starts_on, ends_on)
     VALUES ($1,$2::app.period_kind,$3,$4,$5,$6) RETURNING id`,
    [ctx.companyId, input.kind ?? "project_phase", input.code, input.name, input.startsOn, input.endsOn],
  );
  return rows[0].id;
}

/**
 * Buat anggaran. Lingkupnya company / estate / block -- kolomnya ber-FK nyata
 * sejak migrasi 0018 §7, jadi anggaran tidak bisa menunjuk blok tenant lain
 * maupun jadi yatim saat bloknya dihapus.
 */
export async function createBudget(
  ctx: RlsContext,
  input: {
    fiscalPeriodId: string;
    costCategoryId: string;
    scopeType: "company" | "estate" | "block";
    estateId?: string | null;
    blockId?: string | null;
    amountIdr: number;
    note?: string | null;
  },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.budgets
       (company_id, fiscal_period_id, cost_category_id, scope_type, estate_id, block_id,
        amount_idr, note, created_by, updated_by)
     VALUES ($1,$2,$3,$4::app.budget_scope,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [
      ctx.companyId,
      input.fiscalPeriodId,
      input.costCategoryId,
      input.scopeType,
      input.scopeType === "estate" ? input.estateId : null,
      input.scopeType === "block" ? input.blockId : null,
      input.amountIdr,
      input.note ?? null,
      ctx.userId,
    ],
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Rincian biaya per komponen perkebunan (concept:158)
// ---------------------------------------------------------------------------

export type CategorySpend = {
  categoryId: string;
  categoryName: string;
  subcategoryName: string | null;
  transactionCount: number;
  totalIdr: number;
  sharePct: number | null;
  /** Total komponen INDUK — sama nilainya pada setiap baris satu grup. */
  categoryTotalIdr: number;
  categoryCount: number;
  categorySharePct: number | null;
};

/**
 * Rincian biaya per komponen, dari view v_spend_by_category (migrasi 0024).
 *
 * Rollup ke induk dilakukan di SQL dengan window function, BUKAN di TypeScript.
 * Dua alasan:
 *   1. View hanya memancarkan baris induk bila ada transaksi yang dicatat
 *      langsung di level induk. Karena transaksi normalnya dicatat pada
 *      sub-komponen, menjumlah "baris induk" saja menghasilkan Rp 0.
 *   2. Porsi persen dihitung di sini juga, sehingga komponen React tidak
 *      melakukan aritmetika apa pun — itu yang membuat AT6 lulus jujur.
 */
export async function spendByCategory(ctx: RlsContext): Promise<CategorySpend[]> {
  const rows = await rlsQuery<{
    category_id: string; category_name: string; subcategory_name: string | null;
    transaction_count: string; total_idr: string; share_pct: string | null;
    category_total_idr: string; category_count: string; category_share_pct: string | null;
  }>(
    ctx,
    `WITH agg AS (
       SELECT category_id, category_name, subcategory_name,
              sum(transaction_count) AS tc, sum(total_idr) AS ti
         FROM app.v_spend_by_category
        GROUP BY category_id, category_name, subcategory_name
     ), tot AS (
       SELECT COALESCE(sum(ti), 0) AS g FROM agg
     )
     SELECT a.category_id, a.category_name, a.subcategory_name,
            a.tc AS transaction_count, a.ti AS total_idr,
            sum(a.ti) OVER (PARTITION BY a.category_id) AS category_total_idr,
            sum(a.tc) OVER (PARTITION BY a.category_id) AS category_count,
            CASE WHEN t.g = 0 THEN NULL ELSE round(a.ti * 100.0 / t.g, 2) END AS share_pct,
            CASE WHEN t.g = 0 THEN NULL
                 ELSE round(sum(a.ti) OVER (PARTITION BY a.category_id) * 100.0 / t.g, 2)
            END AS category_share_pct
       FROM agg a CROSS JOIN tot t
      ORDER BY a.category_name, a.subcategory_name NULLS FIRST`,
  );
  return rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    subcategoryName: r.subcategory_name,
    transactionCount: Number(r.transaction_count),
    totalIdr: Number(r.total_idr),
    sharePct: r.share_pct === null ? null : Number(r.share_pct),
    categoryTotalIdr: Number(r.category_total_idr),
    categoryCount: Number(r.category_count),
    categorySharePct: r.category_share_pct === null ? null : Number(r.category_share_pct),
  }));
}

// ---------------------------------------------------------------------------
// Inbox approval lintas-modul (view v_pending_approvals, migrasi 0025)
// ---------------------------------------------------------------------------

export type PendingItem = {
  moduleKey: string;
  moduleLabel: string;
  recordId: string;
  blockCode: string | null;
  detail: string | null;
  amountIdr: number | null;
  eventDate: string | null;
  actorName: string | null;
  approvalStatus: string;
  /**
   * Kode enum yang sengaja TIDAK dirangkai ke `detail` oleh view (migrasi 0040):
   * labelnya dipasang di lapisan tampilan lewat src/lib/labels.ts. null untuk
   * modul yang tidak punya.
   */
  cropCode: string | null;
  methodCode: string | null;
  /** Nilai tiap parameter record (untuk detail saat baris diklik). */
  params: Record<string, string | number | null>;
  /** Bukti tertaut (baru ada untuk modul Pengeluaran) -- null bila tak ada/modul lain. */
  evidenceId: string | null;
};

export async function listAllPending(
  ctx: RlsContext,
  opts: { page?: number; pageSize?: number } = {},
): Promise<Page<PendingItem>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  return withRls(ctx, async (client) => {
    const total = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.v_pending_approvals`,
    );
    const rows = await client.query(
      `SELECT module_key, module_label, record_id, block_code, detail, amount_idr,
              event_date, actor_name, approval_status, params,
              evidence_id, crop_code, method_code
         FROM app.v_pending_approvals
        ORDER BY module_label, event_date NULLS LAST, record_id
        LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    return {
      rows: rows.rows.map((r) => ({
        moduleKey: String(r.module_key),
        moduleLabel: String(r.module_label),
        recordId: String(r.record_id),
        blockCode: (r.block_code as string) ?? null,
        detail: (r.detail as string) ?? null,
        amountIdr: r.amount_idr === null ? null : Number(r.amount_idr),
        eventDate: (r.event_date as string) ?? null,
        actorName: (r.actor_name as string) ?? null,
        approvalStatus: String(r.approval_status),
        cropCode: (r.crop_code as string) ?? null,
        methodCode: (r.method_code as string) ?? null,
        params: (r.params as Record<string, string | number | null>) ?? {},
        evidenceId: (r.evidence_id as string) ?? null,
      })),
      total: Number(total.rows[0].n),
      page,
      pageSize,
    };
  });
}

/** Keputusan approval lintas-modul lewat satu pintu app.decide_record(). */
export async function decideRecord(
  ctx: RlsContext,
  moduleKey: string,
  recordId: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<number> {
  const rows = await rlsQuery<{ decide_record: number }>(
    ctx,
    `SELECT app.decide_record($1,$2,$3,$4) AS decide_record`,
    [moduleKey, recordId, decision, reason ?? null],
  );
  return rows[0]?.decide_record ?? 0;
}
