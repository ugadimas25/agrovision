import { rlsQuery, type RlsContext } from "@/lib/db";

/** Katalog Agri-Input (docs/11 §3): Chemical (stok + rekomendasi) & Equipment. */

export type ChemicalRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  isOrganic: boolean;
  unit: string;
  /** Turunan buku besar mutasi (Σ in − Σ out ± adjustment), bukan kolom (migrasi 0043). */
  stockQty: number;
  reorderLevel: number | null;
  /** null = reorder level belum diisi, jadi "perlu reorder" belum bisa dijawab. */
  needsReorder: boolean | null;
  recPhase: string | null;
  recNote: string | null;
  isActive: boolean;
};

export async function listChemicals(ctx: RlsContext): Promise<ChemicalRow[]> {
  const rows = await rlsQuery<{
    chemical_id: string; code: string; name: string; category: string; is_organic: boolean;
    unit: string; stock_qty: string; reorder_level: string | null; rec_phase: string | null;
    rec_note: string | null; is_active: boolean; needs_reorder: boolean | null;
  }>(
    ctx,
    // v_agri_input_stock, BUKAN tabel katalog: sejak 0043 stok adalah turunan buku
    // besar mutasi dan kolom stock_qty sudah dihapus (dua sumber kebenaran untuk
    // satu fakta adalah cacat — pelajaran migrasi 0023).
    `SELECT chemical_id, code, name, category, is_organic, unit, stock_qty,
            reorder_level, rec_phase, rec_note, is_active, needs_reorder
       FROM app.v_agri_input_stock ORDER BY category, name`,
  );
  return rows.map((r) => ({
    id: r.chemical_id, code: r.code, name: r.name, category: r.category, isOrganic: r.is_organic,
    unit: r.unit, stockQty: Number(r.stock_qty), reorderLevel: r.reorder_level === null ? null : Number(r.reorder_level),
    needsReorder: r.needs_reorder,
    recPhase: r.rec_phase, recNote: r.rec_note, isActive: r.is_active,
  }));
}

export async function createChemical(
  ctx: RlsContext,
  // stockQty TIDAK lagi diterima: stok hanya lahir dari mutasi buku besar, dan
  // mutasi 'in'/'adjustment' adalah wewenang super_admin (§17 Keputusan 1).
  // Katalog baru dimulai dari stok nol — fakta, bukan asumsi.
  input: { code: string; name: string; category: string; isOrganic: boolean; unit: string; reorderLevel?: number | null; recPhase?: string | null; recNote?: string | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.agri_input_chemicals
       (company_id, code, name, category, is_organic, unit, reorder_level, rec_phase, rec_note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [ctx.companyId, input.code, input.name, input.category, input.isOrganic, input.unit,
     input.reorderLevel ?? null, input.recPhase ?? null, input.recNote ?? null, ctx.userId],
  );
  return rows[0].id;
}

export type EquipmentRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  purchasePriceIdr: number | null;
  usageFreq: string | null;
  fuelType: string | null;
  fuelPerHour: number | null;
  isActive: boolean;
  note: string | null;
};

export async function listEquipment(ctx: RlsContext): Promise<EquipmentRow[]> {
  const rows = await rlsQuery<{
    id: string; code: string; name: string; category: string; purchase_price_idr: string | null;
    usage_freq: string | null; fuel_type: string | null; fuel_per_hour: string | null; is_active: boolean; note: string | null;
  }>(
    ctx,
    `SELECT id, code, name, category, purchase_price_idr, usage_freq, fuel_type, fuel_per_hour, is_active, note
       FROM app.agri_input_equipment ORDER BY category, name`,
  );
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, category: r.category,
    purchasePriceIdr: r.purchase_price_idr === null ? null : Number(r.purchase_price_idr),
    usageFreq: r.usage_freq, fuelType: r.fuel_type,
    fuelPerHour: r.fuel_per_hour === null ? null : Number(r.fuel_per_hour),
    isActive: r.is_active, note: r.note,
  }));
}

export async function createEquipment(
  ctx: RlsContext,
  input: { code: string; name: string; category: string; purchasePriceIdr?: number | null; usageFreq?: string | null; fuelType?: string | null; fuelPerHour?: number | null; note?: string | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.agri_input_equipment
       (company_id, code, name, category, purchase_price_idr, usage_freq, fuel_type, fuel_per_hour, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [ctx.companyId, input.code, input.name, input.category, input.purchasePriceIdr ?? null,
     input.usageFreq ?? null, input.fuelType ?? null, input.fuelPerHour ?? null, input.note ?? null, ctx.userId],
  );
  return rows[0].id;
}

/** Opsi chemical untuk dropdown penyemprotan. */
export async function listChemicalOptions(ctx: RlsContext): Promise<{ value: string; label: string }[]> {
  const rows = await listChemicals(ctx);
  return rows.filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.name} (${r.category})` }));
}
