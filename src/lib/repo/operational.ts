import { rlsQuery, withRls, type RlsContext } from "@/lib/db";
import { EMPTY } from "@/lib/format";
import { CROP, PREP_STATUS, WEEDING_METHOD, labelOf } from "@/lib/labels";
import type { Page } from "./blocks";

/**
 * Modul operasional lapangan: pemupukan, persiapan lahan, kesesuaian lahan,
 * pruning, inspeksi bibit.
 *
 * Semua tabelnya berbagi bentuk: milik satu blok (atau batch), punya
 * approval_status, dan dicatat creator lalu disetujui approver. Jadi
 * pembacaannya diseragamkan lewat satu helper daripada mengulang lima kali.
 */

export type OpRecord = {
  id: string;
  blockCode: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  eventDate: string | null;
  /** null = tidak ada rincian yang bisa dirakit; dirender EMPTY, bukan string kosong. */
  detail: string | null;
  createdByName: string | null;
  /**
   * Kolom mentah (bukan string tampilan) untuk mengisi ulang OpRecordEditor
   * (B-21) — alias sama dengan nama field di halaman masing-masing modul.
   * Hanya diisi bila baris ini bisa diedit pemiliknya (draft/rejected); untuk
   * baris lain berupa objek kosong supaya query tidak sia-sia.
   */
  editValues: Record<string, string | number | null>;
};

type OpTable = {
  table: string;
  dateCol: string;
  ownerCol: string;
  /**
   * Ekspresi SQL untuk kolom "detail" yang ditampilkan. Hanya untuk tabel yang
   * rinciannya TIDAK memuat nilai enum — begitu ada enum, pakai extraCols +
   * buildDetail supaya labelnya dipetakan di TypeScript (lihat src/lib/labels.ts).
   */
  detailExpr?: string;
  /** alias -> ekspresi SQL kolom mentah tambahan yang ikut di-SELECT. */
  extraCols?: Record<string, string>;
  /** Perakitan detail di TypeScript dari kolom mentah. Menang atas detailExpr. */
  buildDetail?: (r: Record<string, unknown>) => string | null;
  /** join tambahan (mis. ke fertilizer_types) */
  join?: string;
  /**
   * B-21: alias (nama field di form) -> ekspresi SQL kolom mentah UNTUK EDIT —
   * nilai asli (bukan ::text tampilan), dipakai mengisi ulang OpRecordEditor.
   */
  editCols: Record<string, string>;
};

/** Gabung bagian rincian yang ada; null bila tidak ada satu pun (jangan "" ). */
const joinParts = (parts: (string | null)[]): string | null => {
  const ada = parts.filter((x): x is string => x !== null && x !== "");
  return ada.length ? ada.join(" · ") : null;
};
const txt = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

const TABLES: Record<string, OpTable> = {
  fertilizer_applications: {
    table: "fertilizer_applications",
    dateCol: "applied_on",
    ownerCol: "created_by",
    detailExpr: "ft.name || ' — ' || t.total_quantity || ' ' || COALESCE(uom.name,'')",
    join: `JOIN app.fertilizer_types ft ON ft.id = t.fertilizer_type_id
           LEFT JOIN app.master_items uom ON uom.id = t.uom_item_id`,
    editCols: {
      blockId: "t.block_id::text", fertilizerTypeId: "t.fertilizer_type_id::text",
      cropCode: "t.crop_code", growthPhase: "t.growth_phase::text", appliedOn: "t.applied_on::text",
      totalQuantity: "t.total_quantity", uomItemId: "t.uom_item_id::text", treeCount: "t.tree_count",
      note: "t.note",
    },
  },
  land_preparations: {
    table: "land_preparations",
    dateCol: "checked_at",
    ownerCol: "created_by",
    // `t.status` dulu dirangkai mentah di sini sehingga "in_progress" /
    // "ready_to_plant" tampil apa adanya di UI (catatan.md §3).
    extraCols: {
      soil_ph: "t.soil_ph::text",
      hole_count: "t.planting_hole_count::text",
      prep_status: "t.status::text",
    },
    buildDetail: (r) =>
      joinParts([
        `pH ${txt(r.soil_ph) ?? EMPTY}`,
        txt(r.hole_count) ? `${txt(r.hole_count)} lubang` : null,
        labelOf(PREP_STATUS, txt(r.prep_status)),
      ]),
    editCols: {
      blockId: "t.block_id::text", checkedAt: "t.checked_at::date::text", soilPh: "t.soil_ph",
      holeCount: "t.planting_hole_count", effectiveAreaHa: "t.effective_area_ha",
      status: "t.status::text", note: "t.note", plantingLayoutItemId: "t.planting_layout_item_id::text",
    },
  },
  land_suitability_assessments: {
    table: "land_suitability_assessments",
    dateCol: "assessed_at",
    ownerCol: "created_by",
    detailExpr:
      "'Durian ' || COALESCE(t.score_durian::text,'—') || ' · Kelapa ' || COALESCE(t.score_coconut::text,'—')",
    editCols: {
      blockId: "t.block_id::text", assessedAt: "t.assessed_at::date::text", slopePct: "t.slope_pct",
      elevationM: "t.elevation_m", rainfallMmYear: "t.rainfall_mm_year",
      scoreDurian: "t.score_durian", scoreCoconut: "t.score_coconut", note: "t.note",
    },
  },
  pruning_records: {
    table: "pruning_records",
    dateCol: "pruned_on",
    ownerCol: "created_by",
    detailExpr: "COALESCE(t.tree_count::text || ' pohon','Pruning')",
    editCols: {
      blockId: "t.block_id::text", prunedOn: "t.pruned_on::date::text", treeCount: "t.tree_count", note: "t.note",
    },
  },
  weeding_records: {
    table: "weeding_records",
    dateCol: "weeded_on",
    ownerCol: "created_by",
    // "penutup_tanah" tidak layak tampil; dilabeli di TypeScript.
    extraCols: { method: "t.method", area_ha: "t.area_ha::text" },
    buildDetail: (r) =>
      joinParts([
        labelOf(WEEDING_METHOD, txt(r.method)),
        txt(r.area_ha) ? `${txt(r.area_ha)} ha` : null,
      ]),
    editCols: {
      blockId: "t.block_id::text", weededOn: "t.weeded_on::date::text", method: "t.method",
      areaHa: "t.area_ha", laborCount: "t.labor_count", note: "t.note",
    },
  },
  spraying_records: {
    table: "spraying_records",
    dateCol: "sprayed_on",
    ownerCol: "created_by",
    detailExpr: "COALESCE(ch.name,'Semprot') || COALESCE(' · ' || t.target,'')",
    join: "LEFT JOIN app.agri_input_chemicals ch ON ch.id = t.chemical_id",
    editCols: {
      blockId: "t.block_id::text", sprayedOn: "t.sprayed_on::date::text", chemicalId: "t.chemical_id::text",
      target: "t.target", dosePerHa: "t.dose_per_ha", totalVolume: "t.total_volume", unit: "t.unit", note: "t.note",
    },
  },
  harvest_records: {
    table: "harvest_records",
    dateCol: "harvested_on",
    ownerCol: "created_by",
    // crop_code ('DURIAN'/'COCONUT') adalah kode, bukan label.
    extraCols: {
      crop_code: "t.crop_code",
      quantity_ton: "t.quantity_ton::text",
      grade: "t.grade",
    },
    buildDetail: (r) =>
      joinParts([
        labelOf(CROP, txt(r.crop_code)),
        txt(r.quantity_ton) ? `${txt(r.quantity_ton)} ton` : null,
        txt(r.grade) ? `Grade ${txt(r.grade)}` : null,
      ]),
    editCols: {
      blockId: "t.block_id::text", harvestedOn: "t.harvested_on::date::text", cropCode: "t.crop_code",
      quantityTon: "t.quantity_ton", grade: "t.grade", note: "t.note",
    },
  },
  dbh_measurements: {
    table: "dbh_measurements",
    dateCol: "measured_at",
    ownerCol: "measured_by",
    // Hanya MEREKAM hasil ukur. Biomassa/serapan dihitung carbon run memakai
    // koefisien alometrik yang masih requires_validation — bukan di daftar ini.
    extraCols: {
      crop_name: "c.name",
      dbh_cm: "t.dbh_cm::text",
      height_m: "t.height_m::text",
    },
    editCols: {
      blockId: "t.block_id::text", cropId: "t.crop_id::text", measuredAt: "t.measured_at::date::text",
      dbhCm: "t.dbh_cm", heightM: "t.height_m",
    },
    buildDetail: (r) =>
      joinParts([
        txt(r.crop_name),
        txt(r.dbh_cm) ? `DBH ${txt(r.dbh_cm)} cm` : null,
        txt(r.height_m) ? `tinggi ${txt(r.height_m)} m` : null,
      ]),
    join: "JOIN app.crops c ON c.id = t.crop_id",
  },
};

export async function listOpRecords(
  ctx: RlsContext,
  key: keyof typeof TABLES,
  opts: { page?: number; pageSize?: number } = {},
): Promise<Page<OpRecord>> {
  const t = TABLES[key];
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  return withRls(ctx, async (client) => {
    const total = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.${t.table} t`,
    );
    // Alias & ekspresi extraCols/editCols didefinisikan di TABLES (konstanta di
    // berkas ini), bukan dari input pengguna — tidak ada jalur injeksi di sini.
    const extra = Object.entries(t.extraCols ?? {})
      .map(([alias, expr]) => `, (${expr}) AS ${alias}`)
      .join("");
    // Prefiks edit__ supaya alias editCols tidak pernah bentrok dengan extraCols
    // (mis. keduanya sama-sama punya "note" di beberapa modul).
    const editSel = Object.entries(t.editCols)
      .map(([alias, expr]) => `, (${expr}) AS "edit__${alias}"`)
      .join("");
    const rows = await client.query(
      `SELECT t.id, b.code AS block_code, t.approval_status, t.rejection_reason,
              t.${t.dateCol}::date AS event_date,
              ${t.detailExpr ? `(${t.detailExpr})` : "NULL"} AS detail,
              u.full_name AS created_by_name${extra}${editSel}
         FROM app.${t.table} t
         JOIN app.blocks b ON b.id = t.block_id
         LEFT JOIN app.users u ON u.id = t.${t.ownerCol}
         ${t.join ?? ""}
        ORDER BY t.${t.dateCol} DESC, t.id DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    const editKeys = Object.keys(t.editCols);
    return {
      rows: rows.rows.map((r) => {
        const editValues: Record<string, string | number | null> = {};
        for (const k of editKeys) {
          const v = (r as Record<string, unknown>)[`edit__${k}`];
          editValues[k] = v === null || v === undefined ? null : typeof v === "number" ? v : String(v);
        }
        return {
          id: String(r.id),
          blockCode: (r.block_code as string) ?? null,
          approvalStatus: String(r.approval_status),
          rejectionReason: (r.rejection_reason as string) ?? null,
          // event_date sudah ::date di SQL → string 'YYYY-MM-DD' (lihat parser di src/lib/db.ts).
          eventDate: (r.event_date as string) ?? null,
          // buildDetail menang; null dipertahankan supaya UI merender EMPTY, bukan "".
          detail: t.buildDetail ? t.buildDetail(r as Record<string, unknown>) : txt(r.detail),
          createdByName: (r.created_by_name as string) ?? null,
          editValues,
        };
      }),
      total: Number(total.rows[0].n),
      page,
      pageSize,
    };
  });
}

/** submit draft/rejected -> submitted, untuk modul mana pun. */
export async function submitOpRecord(
  ctx: RlsContext,
  key: keyof typeof TABLES | "nursery_inspections",
  id: string,
): Promise<number> {
  // nursery_inspections tidak masuk TABLES karena induknya seed_batches, bukan
  // blocks (listOpRecords meng-JOIN app.blocks). Jalur Ajukan-nya tetap lewat
  // satu pintu ini supaya konsisten dengan app.decide_record di sisi approval.
  const table = key === "nursery_inspections" ? "nursery_inspections" : TABLES[key].table;
  return withRls(ctx, async (client) => {
    const res = await client.query(
      `UPDATE app.${table}
          SET approval_status = 'submitted', rejection_reason = NULL
        WHERE id = $1 AND approval_status IN ('draft','rejected')`,
      [id],
    );
    return res.rowCount ?? 0;
  });
}

/**
 * B-21: perbaiki record draft/rejected milik sendiri, generik 9 modul
 * operasional. Pola persis updateExpenditure (src/lib/repo/costing.ts):
 * approval_status DIKEMBALIKAN ke 'draft' (bukan gaya, tapi tuntutan policy
 * <table>_role_split — USING menguji baris LAMA, WITH CHECK baris BARU, dan
 * WITH CHECK hanya meloloskan draft/submitted, bukan rejected). WHERE di sini
 * hanya mengulang syarat status supaya pemanggil dapat rowCount 0 yang bisa
 * dijelaskan; batas kepemilikan sudah ditegakkan RLS (role_split + B-23).
 *
 * rejection_reason TIDAK dihapus di sini — tetap terbaca sampai benar-benar
 * diajukan ulang lewat submitOpRecord, sama seperti pengeluaran.
 */
export type UpdateOpInput = {
  fertilizer_applications: {
    blockId: string; fertilizerTypeId: string; cropCode: string | null; growthPhase: string; appliedOn: string;
    totalQuantity: number; uomItemId: string | null; treeCount: number | null; note: string | null;
  };
  land_preparations: {
    blockId: string; checkedAt: string; soilPh: number | null; holeCount: number | null;
    effectiveAreaHa: number | null; status: string; note: string | null; plantingLayoutItemId: string | null;
  };
  land_suitability_assessments: {
    blockId: string; assessedAt: string; slopePct: number | null; elevationM: number | null;
    rainfallMmYear: number | null; scoreDurian: number | null; scoreCoconut: number | null; note: string | null;
  };
  pruning_records: { blockId: string; prunedOn: string; treeCount: number | null; note: string | null };
  weeding_records: {
    blockId: string; weededOn: string; method: string; areaHa: number | null;
    laborCount: number | null; note: string | null;
  };
  spraying_records: {
    blockId: string; sprayedOn: string; chemicalId: string | null; target: string | null;
    dosePerHa: number | null; totalVolume: number; unit: string; note: string | null;
  };
  harvest_records: {
    blockId: string; harvestedOn: string; cropCode: string; quantityTon: number;
    grade: string | null; note: string | null;
  };
  nursery_inspections: { seedBatchId: string; inspectedOn: string; qtyAlive: number; qtyDead: number; qtyDamaged: number };
  dbh_measurements: { blockId: string; cropId: string; measuredAt: string; dbhCm: number; heightM: number | null };
};
export type OpModule = keyof UpdateOpInput;

export async function updateOpRecord<M extends OpModule>(
  ctx: RlsContext,
  module: M,
  id: string,
  input: UpdateOpInput[M],
): Promise<number> {
  return withRls(ctx, async (client) => {
    let res;
    switch (module) {
      case "fertilizer_applications": {
        const i = input as UpdateOpInput["fertilizer_applications"];
        res = await client.query(
          `UPDATE app.fertilizer_applications
              SET block_id = $2, fertilizer_type_id = $3, crop_code = $4, growth_phase = $5::app.growth_phase,
                  applied_on = $6, total_quantity = $7, uom_item_id = $8, tree_count = $9, note = $10,
                  approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.fertilizerTypeId, i.cropCode, i.growthPhase, i.appliedOn,
           i.totalQuantity, i.uomItemId, i.treeCount, i.note],
        );
        break;
      }
      case "land_preparations": {
        const i = input as UpdateOpInput["land_preparations"];
        res = await client.query(
          `UPDATE app.land_preparations
              SET block_id = $2, checked_at = $3, soil_ph = $4, planting_hole_count = $5,
                  effective_area_ha = $6, status = $7::app.prep_status, note = $8,
                  planting_layout_item_id = $9, approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.checkedAt, i.soilPh, i.holeCount, i.effectiveAreaHa,
           i.status, i.note, i.plantingLayoutItemId],
        );
        break;
      }
      case "land_suitability_assessments": {
        const i = input as UpdateOpInput["land_suitability_assessments"];
        res = await client.query(
          `UPDATE app.land_suitability_assessments
              SET block_id = $2, assessed_at = $3, slope_pct = $4, elevation_m = $5,
                  rainfall_mm_year = $6, score_durian = $7, score_coconut = $8, note = $9,
                  approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.assessedAt, i.slopePct, i.elevationM, i.rainfallMmYear,
           i.scoreDurian, i.scoreCoconut, i.note],
        );
        break;
      }
      case "pruning_records": {
        const i = input as UpdateOpInput["pruning_records"];
        res = await client.query(
          `UPDATE app.pruning_records
              SET block_id = $2, pruned_on = $3, tree_count = $4, note = $5, approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.prunedOn, i.treeCount, i.note],
        );
        break;
      }
      case "weeding_records": {
        const i = input as UpdateOpInput["weeding_records"];
        res = await client.query(
          `UPDATE app.weeding_records
              SET block_id = $2, weeded_on = $3, method = $4, area_ha = $5, labor_count = $6,
                  note = $7, approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.weededOn, i.method, i.areaHa, i.laborCount, i.note],
        );
        break;
      }
      case "spraying_records": {
        const i = input as UpdateOpInput["spraying_records"];
        res = await client.query(
          `UPDATE app.spraying_records
              SET block_id = $2, sprayed_on = $3, chemical_id = $4, target = $5, dose_per_ha = $6,
                  total_volume = $7, unit = $8, note = $9, approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.sprayedOn, i.chemicalId, i.target, i.dosePerHa, i.totalVolume, i.unit, i.note],
        );
        break;
      }
      case "harvest_records": {
        const i = input as UpdateOpInput["harvest_records"];
        res = await client.query(
          `UPDATE app.harvest_records
              SET block_id = $2, harvested_on = $3, crop_code = $4, quantity_ton = $5, grade = $6,
                  note = $7, approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.harvestedOn, i.cropCode, i.quantityTon, i.grade, i.note],
        );
        break;
      }
      case "nursery_inspections": {
        const i = input as UpdateOpInput["nursery_inspections"];
        const sum = i.qtyAlive + i.qtyDead + i.qtyDamaged;
        const batch = await client.query<{ qty_initial: number }>(
          `SELECT qty_initial FROM app.seed_batches WHERE id = $1 AND archived_at IS NULL`,
          [i.seedBatchId],
        );
        if (!batch.rows[0]) throw new Error("Batch tidak ditemukan atau di luar akses Anda.");
        if (sum > Number(batch.rows[0].qty_initial)) {
          throw new Error(
            `Hidup + mati + rusak (${sum}) melebihi jumlah awal batch (${batch.rows[0].qty_initial}) — survival rate akan menyesatkan. Periksa lagi hitungannya.`,
          );
        }
        res = await client.query(
          `UPDATE app.nursery_inspections
              SET seed_batch_id = $2, inspected_at = $3::date, qty_alive = $4, qty_dead = $5, qty_damaged = $6,
                  approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.seedBatchId, i.inspectedOn, i.qtyAlive, i.qtyDead, i.qtyDamaged],
        );
        break;
      }
      case "dbh_measurements": {
        const i = input as UpdateOpInput["dbh_measurements"];
        res = await client.query(
          `UPDATE app.dbh_measurements
              SET block_id = $2, crop_id = $3, measured_at = $4::timestamptz, dbh_cm = $5, height_m = $6,
                  approval_status = 'draft'
            WHERE id = $1 AND approval_status IN ('draft','rejected')`,
          [id, i.blockId, i.cropId, i.measuredAt, i.dbhCm, i.heightM],
        );
        break;
      }
    }
    return res?.rowCount ?? 0;
  });
}

// --- Insert per modul (bentuk kolom berbeda, jadi tidak digeneralisasi) ---

export async function createFertilizerApplication(
  ctx: RlsContext,
  input: {
    blockId: string; fertilizerTypeId: string; cropCode?: string | null; growthPhase: string; appliedOn: string;
    totalQuantity: number; uomItemId?: string | null; treeCount?: number | null; note?: string | null;
  },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.fertilizer_applications
       (block_id, fertilizer_type_id, crop_code, growth_phase, applied_on, total_quantity, uom_item_id,
        tree_count, note, approval_status, created_by)
     VALUES ($1,$2,$3,$4::app.growth_phase,$5,$6,$7,$8,$9,'draft',$10) RETURNING id`,
    [input.blockId, input.fertilizerTypeId, input.cropCode ?? null, input.growthPhase, input.appliedOn,
     input.totalQuantity, input.uomItemId ?? null, input.treeCount ?? null, input.note ?? null,
     ctx.userId],
  );
  return rows[0].id;
}

export async function createLandPreparation(
  ctx: RlsContext,
  input: {
    blockId: string; checkedAt: string; soilPh?: number | null; holeCount?: number | null;
    effectiveAreaHa?: number | null; status: string; note?: string | null;
    /** Layout/jarak tanam dari Master Data (tipe planting_layout, migrasi 0050). */
    plantingLayoutItemId?: string | null;
  },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.land_preparations
       (block_id, checked_at, soil_ph, planting_hole_count, effective_area_ha, status,
        note, planting_layout_item_id, approval_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::app.prep_status,$7,$8,'draft',$9) RETURNING id`,
    [input.blockId, input.checkedAt, input.soilPh ?? null, input.holeCount ?? null,
     input.effectiveAreaHa ?? null, input.status, input.note ?? null,
     input.plantingLayoutItemId ?? null, ctx.userId],
  );
  return rows[0].id;
}

export async function createPruningRecord(
  ctx: RlsContext,
  input: { blockId: string; prunedOn: string; treeCount?: number | null; note?: string | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.pruning_records
       (block_id, pruned_on, tree_count, note, approval_status, created_by)
     VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id`,
    [input.blockId, input.prunedOn, input.treeCount ?? null, input.note ?? null, ctx.userId],
  );
  return rows[0].id;
}

export async function createWeedingRecord(
  ctx: RlsContext,
  input: { blockId: string; weededOn: string; method: string; areaHa?: number | null; laborCount?: number | null; note?: string | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.weeding_records
       (block_id, weeded_on, method, area_ha, labor_count, note, approval_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id`,
    [input.blockId, input.weededOn, input.method, input.areaHa ?? null, input.laborCount ?? null, input.note ?? null, ctx.userId],
  );
  return rows[0].id;
}

export async function createSprayingRecord(
  ctx: RlsContext,
  input: { blockId: string; sprayedOn: string; chemicalId?: string | null; target?: string | null; dosePerHa?: number | null; totalVolume?: number | null; unit?: string | null; note?: string | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.spraying_records
       (block_id, sprayed_on, chemical_id, target, dose_per_ha, total_volume, unit, note, approval_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING id`,
    [input.blockId, input.sprayedOn, input.chemicalId ?? null, input.target ?? null,
     input.dosePerHa ?? null, input.totalVolume ?? null, input.unit ?? null, input.note ?? null, ctx.userId],
  );
  return rows[0].id;
}

export async function createHarvestRecord(
  ctx: RlsContext,
  input: { blockId: string; harvestedOn: string; cropCode: string; quantityTon: number; grade?: string | null; note?: string | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.harvest_records
       (block_id, harvested_on, crop_code, quantity_ton, grade, note, approval_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id`,
    [input.blockId, input.harvestedOn, input.cropCode, input.quantityTon, input.grade ?? null, input.note ?? null, ctx.userId],
  );
  return rows[0].id;
}

export async function createLandSuitability(
  ctx: RlsContext,
  input: {
    blockId: string; assessedAt: string; slopePct?: number | null; elevationM?: number | null;
    rainfallMmYear?: number | null; scoreDurian?: number | null; scoreCoconut?: number | null;
    note?: string | null;
  },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.land_suitability_assessments
       (block_id, assessed_at, slope_pct, elevation_m, rainfall_mm_year, score_durian,
        score_coconut, note, approval_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING id`,
    [input.blockId, input.assessedAt, input.slopePct ?? null, input.elevationM ?? null,
     input.rainfallMmYear ?? null, input.scoreDurian ?? null, input.scoreCoconut ?? null,
     input.note ?? null, ctx.userId],
  );
  return rows[0].id;
}

/** Pengukuran DBH: hanya merekam hasil ukur — tanpa perhitungan biomassa di sini. */
export async function createDbhMeasurement(
  ctx: RlsContext,
  input: { blockId: string; cropId: string; measuredAt: string; dbhCm: number; heightM?: number | null },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.dbh_measurements
       (block_id, crop_id, measured_at, dbh_cm, height_m, approval_status, measured_by)
     VALUES ($1,$2,$3::timestamptz,$4,$5,'draft',$6) RETURNING id`,
    [input.blockId, input.cropId, input.measuredAt, input.dbhCm, input.heightM ?? null, ctx.userId],
  );
  return rows[0].id;
}

/** Opsi tanaman untuk form DBH. app.crops referensi global (rls_exempt, 0018). */
export async function listCropOptions(
  ctx: RlsContext,
): Promise<{ value: string; label: string }[]> {
  const rows = await rlsQuery<{ id: string; name: string; variety: string | null }>(
    ctx,
    `SELECT id, name, variety FROM app.crops WHERE is_tree ORDER BY name`,
  );
  return rows.map((r) => ({ value: r.id, label: r.variety ? `${r.name} — ${r.variety}` : r.name }));
}

/**
 * Opsi komoditas untuk FILTER dashboard (AI-24) — berbeda dari listCropOptions
 * di atas, dan bedanya disengaja:
 *   * `value` = KODE, bukan uuid. Kolom yang difilter adalah `crop_code` pada
 *     harvest_records & fertilizer_applications; memakai uuid akan memaksa join
 *     tambahan di setiap subquery dashboard.
 *   * TANPA saringan `is_tree`. Filter harus menawarkan seluruh komoditas yang
 *     bisa muncul di data, bukan hanya yang berkayu (itu syarat khusus DBH).
 */
export async function listCropCodeOptions(
  ctx: RlsContext,
): Promise<{ value: string; label: string }[]> {
  const rows = await rlsQuery<{ code: string; name: string }>(
    ctx,
    `SELECT code, name FROM app.crops ORDER BY name`,
  );
  return rows.map((r) => ({ value: r.code, label: r.name }));
}

export async function listFertilizerTypeOptions(
  ctx: RlsContext,
): Promise<{ value: string; label: string }[]> {
  const rows = await rlsQuery<{ id: string; name: string; kind: string }>(
    ctx,
    `SELECT id, name, kind FROM app.fertilizer_types WHERE is_active ORDER BY name`,
  );
  const kindLabel: Record<string, string> = { single: "tunggal", compound: "majemuk", organic: "organik" };
  return rows.map((r) => ({ value: r.id, label: `${r.name} (${kindLabel[r.kind] ?? r.kind})` }));
}

// --- Nursery: batch bibit + stok dari view v_seedling_stock ---

export type SeedStock = {
  batchCode: string;
  cropName: string;
  qtyInitial: number;
  qtyAlive: number | null;
  qtyDead: number | null;
  qtyDamaged: number | null;
  survivalPct: number | null;
  lastInspectedAt: string | null;
};

export async function listSeedStock(ctx: RlsContext): Promise<SeedStock[]> {
  const rows = await rlsQuery<{
    batch_code: string; crop_name: string; qty_initial: number;
    qty_alive: number | null; qty_dead: number | null; qty_damaged: number | null;
    survival_pct: string | null; last_inspected_at: string | null;
  }>(
    ctx,
    `SELECT s.batch_code, c.name AS crop_name, s.qty_initial,
            s.qty_alive, s.qty_dead, s.qty_damaged,
            CASE WHEN s.qty_initial = 0 OR s.qty_alive IS NULL THEN NULL
                 ELSE round(s.qty_alive * 100.0 / s.qty_initial, 1) END AS survival_pct,
            -- hari kalender WIB dari instant; dipotong di DB supaya zona proses tidak ikut bermain
            (s.last_inspected_at AT TIME ZONE 'Asia/Jakarta')::date::text AS last_inspected_at
       FROM app.v_seedling_stock s
       JOIN app.crops c ON c.id = s.crop_id
      ORDER BY s.batch_code`,
  );
  return rows.map((r) => ({
    batchCode: r.batch_code,
    cropName: r.crop_name,
    qtyInitial: Number(r.qty_initial),
    qtyAlive: r.qty_alive === null ? null : Number(r.qty_alive),
    qtyDead: r.qty_dead === null ? null : Number(r.qty_dead),
    qtyDamaged: r.qty_damaged === null ? null : Number(r.qty_damaged),
    survivalPct: r.survival_pct === null ? null : Number(r.survival_pct),
    lastInspectedAt: r.last_inspected_at,
  }));
}

// --- Inspeksi bibit (nursery_inspections) ---
// Induknya seed_batches, bukan blocks, jadi tidak ikut TABLES/listOpRecords.
// Bentuk kembaliannya disamakan dengan OpRecord supaya OpRecordTable dipakai
// ulang (kolom "Blok" dilabeli "Batch" lewat prop blockHeader).

export type SeedBatchOption = { value: string; label: string; remaining: number };

/**
 * Pilihan batch bibit — SATU fungsi untuk dua dropdown (inspeksi & distribusi).
 *
 * K-05: form hanya MEMILIH batch, tidak pernah membuatnya. `remaining` =
 * qty_initial − Σ distribusi: fakta turunan, dipakai form distribusi untuk
 * menolak jumlah yang melebihi sisa (kelebihan distribusi menggelembungkan
 * driver seedling_qty di Refleksi Biaya).
 */
export async function listSeedBatchOptions(ctx: RlsContext): Promise<SeedBatchOption[]> {
  const rows = await rlsQuery<{
    id: string; code: string; crop_name: string; variety: string | null;
    qty_initial: number; distributed: string;
  }>(
    ctx,
    `SELECT sb.id, sb.code, c.name AS crop_name, sb.variety, sb.qty_initial,
            COALESCE((SELECT SUM(sd.qty) FROM app.seed_distributions sd
                       WHERE sd.seed_batch_id = sb.id), 0) AS distributed
       FROM app.seed_batches sb
       JOIN app.crops c ON c.id = sb.crop_id
      WHERE sb.archived_at IS NULL
      ORDER BY sb.code`,
  );
  return rows.map((r) => {
    const remaining = Number(r.qty_initial) - Number(r.distributed);
    const nama = `${r.code} — ${r.crop_name}${r.variety ? ` · ${r.variety}` : ""}`;
    return { value: r.id, label: `${nama} (sisa ${remaining} dari ${r.qty_initial})`, remaining };
  });
}

export async function createNurseryInspection(
  ctx: RlsContext,
  input: { seedBatchId: string; inspectedOn: string; qtyAlive: number; qtyDead: number; qtyDamaged: number },
): Promise<string> {
  return withRls(ctx, async (client) => {
    // Batch di luar tenant tersaring RLS -> 0 baris; pesan galatnya jangan
    // menebak-nebak sebab (bisa "tidak ada", bisa "bukan milik Anda").
    const batch = await client.query<{ qty_initial: number }>(
      `SELECT qty_initial FROM app.seed_batches WHERE id = $1 AND archived_at IS NULL`,
      [input.seedBatchId],
    );
    if (!batch.rows[0]) throw new Error("Batch tidak ditemukan atau di luar akses Anda.");
    const initial = Number(batch.rows[0].qty_initial);
    const sum = input.qtyAlive + input.qtyDead + input.qtyDamaged;
    if (sum > initial) {
      throw new Error(
        `Hidup + mati + rusak (${sum}) melebihi jumlah awal batch (${initial}) — survival rate akan menyesatkan. Periksa lagi hitungannya.`,
      );
    }
    // inspector_id = created_by = pencatat (role_split 0025 memakai created_by;
    // inbox 0040 menampilkan inspector_id). inspected_at bertipe timestamptz;
    // string tanggal dikirim apa adanya dan di-cast di SQL, tanpa objek Date.
    const res = await client.query<{ id: string }>(
      `INSERT INTO app.nursery_inspections
         (seed_batch_id, inspected_at, qty_alive, qty_dead, qty_damaged,
          inspector_id, approval_status, created_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, 'draft', $6) RETURNING id`,
      [input.seedBatchId, input.inspectedOn, input.qtyAlive, input.qtyDead, input.qtyDamaged, ctx.userId],
    );
    return res.rows[0].id;
  });
}

export async function listNurseryInspections(
  ctx: RlsContext,
  opts: { page?: number; pageSize?: number } = {},
): Promise<Page<OpRecord>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  return withRls(ctx, async (client) => {
    const total = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.nursery_inspections`,
    );
    // inspected_at::date::text: tanggal keluar sebagai string apa adanya —
    // JANGAN dilewatkan objek Date (bergeser sehari di zona +07:00).
    const rows = await client.query(
      `SELECT ni.id, sb.code AS batch_code, ni.approval_status, ni.rejection_reason,
              ni.inspected_at::date::text AS event_date,
              'Hidup ' || ni.qty_alive || ' · mati ' || ni.qty_dead || ' · rusak ' || ni.qty_damaged AS detail,
              u.full_name AS created_by_name,
              ni.seed_batch_id::text AS "edit__seedBatchId", ni.inspected_at::date::text AS "edit__inspectedOn",
              ni.qty_alive AS "edit__qtyAlive", ni.qty_dead AS "edit__qtyDead", ni.qty_damaged AS "edit__qtyDamaged"
         FROM app.nursery_inspections ni
         JOIN app.seed_batches sb ON sb.id = ni.seed_batch_id
         LEFT JOIN app.users u ON u.id = ni.inspector_id
        ORDER BY ni.inspected_at DESC, ni.id DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    return {
      rows: rows.rows.map((r) => ({
        id: String(r.id),
        blockCode: (r.batch_code as string) ?? null,
        approvalStatus: String(r.approval_status),
        rejectionReason: (r.rejection_reason as string) ?? null,
        eventDate: (r.event_date as string) ?? null,
        detail: txt(r.detail),
        createdByName: (r.created_by_name as string) ?? null,
        editValues: {
          seedBatchId: (r.edit__seedBatchId as string) ?? null,
          inspectedOn: (r.edit__inspectedOn as string) ?? null,
          qtyAlive: r.edit__qtyAlive as number,
          qtyDead: r.edit__qtyDead as number,
          qtyDamaged: r.edit__qtyDamaged as number,
        },
      })),
      total: Number(total.rows[0].n),
      page,
      pageSize,
    };
  });
}

/**
 * Catat distribusi bibit. Guard stok dilakukan di transaksi yang sama:
 * jumlah melebihi sisa batch akan menggelembungkan driver seedling_qty di
 * Refleksi Biaya (volume × tarif SEED-UNIT), jadi ditolak dengan pesan yang
 * menyebut akibatnya. Penegakan di DB (trigger) sengaja belum — lihat docs/13.
 */
export async function createSeedDistribution(
  ctx: RlsContext,
  input: { seedBatchId: string; blockId: string; qty: number; distributedOn: string },
): Promise<string> {
  return withRls(ctx, async (client) => {
    const stok = await client.query<{ remaining: number }>(
      `SELECT (sb.qty_initial - COALESCE((SELECT SUM(sd.qty) FROM app.seed_distributions sd
                 WHERE sd.seed_batch_id = sb.id), 0))::int AS remaining
         FROM app.seed_batches sb
        WHERE sb.id = $1 AND sb.archived_at IS NULL`,
      [input.seedBatchId],
    );
    if (stok.rows.length === 0) {
      throw new Error("Batch bibit tidak ditemukan atau di luar akses Anda.");
    }
    const remaining = Number(stok.rows[0].remaining);
    if (input.qty > remaining) {
      throw new Error(
        `Jumlah melebihi sisa batch (${remaining} batang) — kelebihan akan menggelembungkan biaya pengadaan bibit di Refleksi.`,
      );
    }
    const res = await client.query<{ id: string }>(
      `INSERT INTO app.seed_distributions (seed_batch_id, block_id, qty, distributed_on, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.seedBatchId, input.blockId, input.qty, input.distributedOn, ctx.userId],
    );
    return res.rows[0].id;
  });
}

export type SeedDistributionRow = {
  id: string;
  batchCode: string;
  blockCode: string;
  qty: number;
  /** 'YYYY-MM-DD' langsung dari SQL (::text) — tanpa objek Date, tidak bergeser di +07:00. */
  distributedOn: string;
  createdByName: string | null;
};

export async function listSeedDistributions(
  ctx: RlsContext,
  limit = 50,
): Promise<SeedDistributionRow[]> {
  const rows = await rlsQuery<{
    id: string; batch_code: string; block_code: string; qty: number;
    distributed_on: string; created_by_name: string | null;
  }>(
    ctx,
    `SELECT sd.id, sb.code AS batch_code, b.code AS block_code, sd.qty,
            sd.distributed_on::text AS distributed_on, u.full_name AS created_by_name
       FROM app.seed_distributions sd
       JOIN app.seed_batches sb ON sb.id = sd.seed_batch_id
       JOIN app.blocks b ON b.id = sd.block_id
       LEFT JOIN app.users u ON u.id = sd.created_by
      ORDER BY sd.distributed_on DESC, sd.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    batchCode: r.batch_code,
    blockCode: r.block_code,
    qty: Number(r.qty),
    distributedOn: r.distributed_on,
    createdByName: r.created_by_name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Survei: submission dari form berversi (renderer schema-driven)
// ---------------------------------------------------------------------------

export type SurveySubmissionRow = {
  id: string;
  formName: string;
  blockCode: string | null;
  approvalStatus: string;
  submittedAt: string | null;
  submittedByName: string | null;
};

export async function listSurveySubmissions(
  ctx: RlsContext,
  opts: { page?: number; pageSize?: number } = {},
): Promise<Page<SurveySubmissionRow>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  return withRls(ctx, async (client) => {
    const total = await client.query<{ n: string }>(`SELECT count(*) AS n FROM app.survey_submissions`);
    const rows = await client.query(
      `SELECT ss.id, f.name AS form_name, b.code AS block_code, ss.approval_status,
              (ss.submitted_at AT TIME ZONE 'Asia/Jakarta')::date::text AS submitted_at,
              u.full_name AS submitted_by_name
         FROM app.survey_submissions ss
         JOIN app.form_versions fv ON fv.id = ss.form_version_id
         JOIN app.forms f ON f.id = fv.form_id
         LEFT JOIN app.blocks b ON b.id = ss.block_id
         LEFT JOIN app.users u ON u.id = ss.submitted_by
        ORDER BY ss.submitted_at DESC NULLS LAST, ss.id
        LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    return {
      rows: rows.rows.map((r) => ({
        id: String(r.id),
        formName: String(r.form_name),
        blockCode: (r.block_code as string) ?? null,
        approvalStatus: String(r.approval_status),
        submittedAt: (r.submitted_at as string) ?? null,
        submittedByName: (r.submitted_by_name as string) ?? null,
      })),
      total: Number(total.rows[0].n),
      page,
      pageSize,
    };
  });
}

/** Form published + fields — untuk daftar form builder (read-only fase ini). */
export async function listPublishedForms(
  ctx: RlsContext,
): Promise<{ id: string; name: string; module: string; version: number; fieldCount: number }[]> {
  const rows = await rlsQuery<{
    id: string; name: string; module: string; version: number; field_count: string;
  }>(
    ctx,
    `SELECT f.id, f.name, f.module, fv.version,
            (SELECT count(*) FROM app.form_fields ff WHERE ff.form_version_id = fv.id) AS field_count
       FROM app.forms f
       JOIN app.form_versions fv ON fv.form_id = f.id AND fv.status = 'published'
      ORDER BY f.name`,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, module: r.module, version: r.version, fieldCount: Number(r.field_count),
  }));
}

export type SurveyField = {
  id: string;
  section: string | null;
  code: string;
  label: string;
  fieldType: string;
  required: boolean;
  choices: string[];
};
export type SurveyForm = {
  formId: string;
  formVersionId: string;
  name: string;
  fields: SurveyField[];
};

/** Skema form terpublikasi + field terurut, untuk dirender & diisi. */
export async function getSurveyForm(ctx: RlsContext, formId: string): Promise<SurveyForm | null> {
  const head = await rlsQuery<{ form_id: string; fv_id: string; name: string }>(
    ctx,
    `SELECT f.id AS form_id, fv.id AS fv_id, f.name
       FROM app.forms f JOIN app.form_versions fv ON fv.form_id = f.id AND fv.status = 'published'
      WHERE f.id = $1 LIMIT 1`,
    [formId],
  );
  if (!head[0]) return null;
  const fields = await rlsQuery<{
    id: string; section_name: string | null; code: string; label: string;
    field_type: string; is_required: boolean; options: { choices?: string[] } | null;
  }>(
    ctx,
    `SELECT id, section_name, code, label, field_type, is_required, options
       FROM app.form_fields WHERE form_version_id = $1 ORDER BY sort_order, code`,
    [head[0].fv_id],
  );
  return {
    formId: head[0].form_id,
    formVersionId: head[0].fv_id,
    name: head[0].name,
    fields: fields.map((f) => ({
      id: f.id, section: f.section_name, code: f.code, label: f.label,
      fieldType: f.field_type, required: f.is_required, choices: f.options?.choices ?? [],
    })),
  };
}

/** Simpan submission survei + nilai per field (langsung berstatus submitted). */
export async function submitSurvey(
  ctx: RlsContext,
  input: {
    formVersionId: string;
    blockId: string | null;
    values: { fieldId: string; fieldType: string; value: string }[];
  },
): Promise<string> {
  return withRls(ctx, async (client) => {
    const sub = await client.query<{ id: string }>(
      `INSERT INTO app.survey_submissions
         (client_uuid, form_version_id, block_id, submitted_by, submitted_at, synced_at, approval_status)
       VALUES (gen_random_uuid(), $1, $2, $3, now(), now(), 'submitted') RETURNING id`,
      [input.formVersionId, input.blockId, ctx.userId],
    );
    const subId = sub.rows[0].id;
    for (const v of input.values) {
      if (v.value === "" || v.value == null) continue;
      const cols = { text: "value_text", num: "value_num", bool: "value_bool", date: "value_date" };
      let col = cols.text;
      let val: string | number | boolean = v.value;
      if (v.fieldType === "number") { col = cols.num; val = Number(v.value); if (Number.isNaN(val)) continue; }
      else if (v.fieldType === "date") { col = cols.date; }
      else if (v.fieldType === "yes_no") { col = cols.bool; val = v.value === "true" || v.value === "Ya"; }
      await client.query(
        `INSERT INTO app.submission_values (submission_id, field_id, ${col}) VALUES ($1,$2,$3)`,
        [subId, v.fieldId, val],
      );
    }
    return subId;
  });
}

/**
 * B-21: perbaiki hasil survei ditolak lalu ajukan ulang -- satu langkah,
 * bukan draft lalu Ajukan terpisah, karena submitSurvey() sendiri tidak
 * pernah mengenal status draft (langsung 'submitted' saat dibuat). Kepemilikan
 * ditegakkan RLS (survey_submissions_role_split memakai submitted_by, 0025),
 * WHERE di sini hanya mengulang syarat status untuk error yang bisa dijelaskan.
 *
 * submission_values tidak punya unique constraint per (submission_id, field_id)
 * yang memungkinkan UPSERT langsung -- hapus semua nilai lama, tulis ulang.
 */
export async function updateSurveySubmission(
  ctx: RlsContext,
  id: string,
  input: {
    blockId: string | null;
    values: { fieldId: string; fieldType: string; value: string }[];
  },
): Promise<number> {
  return withRls(ctx, async (client) => {
    const res = await client.query(
      `UPDATE app.survey_submissions
          SET block_id = $2, submitted_at = now(), approval_status = 'submitted', rejection_reason = NULL
        WHERE id = $1 AND approval_status IN ('draft','rejected')`,
      [id, input.blockId],
    );
    if (res.rowCount === 0) return 0;

    await client.query(`DELETE FROM app.submission_values WHERE submission_id = $1`, [id]);
    for (const v of input.values) {
      if (v.value === "" || v.value == null) continue;
      const cols = { text: "value_text", num: "value_num", bool: "value_bool", date: "value_date" };
      let col = cols.text;
      let val: string | number | boolean = v.value;
      if (v.fieldType === "number") { col = cols.num; val = Number(v.value); if (Number.isNaN(val)) continue; }
      else if (v.fieldType === "date") { col = cols.date; }
      else if (v.fieldType === "yes_no") { col = cols.bool; val = v.value === "true" || v.value === "Ya"; }
      await client.query(
        `INSERT INTO app.submission_values (submission_id, field_id, ${col}) VALUES ($1,$2,$3)`,
        [id, v.fieldId, val],
      );
    }
    return res.rowCount ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Jadwal penyiangan (migrasi 0051)
// ---------------------------------------------------------------------------

export type WeedingSchedule = {
  id: string;
  blockId: string;
  blockCode: string;
  intervalDay: number;
  toleranceDay: number;
  note: string | null;
};

export async function listWeedingSchedules(ctx: RlsContext): Promise<WeedingSchedule[]> {
  const rows = await rlsQuery<{
    id: string; block_id: string; block_code: string;
    interval_day: number; tolerance_day: number; note: string | null;
  }>(
    ctx,
    `SELECT ws.id, ws.block_id, b.code AS block_code, ws.interval_day, ws.tolerance_day, ws.note
       FROM app.weeding_schedules ws JOIN app.blocks b ON b.id = ws.block_id
      WHERE ws.is_active
      ORDER BY b.code`,
  );
  return rows.map((r) => ({
    id: r.id, blockId: r.block_id, blockCode: r.block_code,
    intervalDay: Number(r.interval_day), toleranceDay: Number(r.tolerance_day), note: r.note,
  }));
}

/**
 * Setel jadwal penyiangan sebuah blok.
 *
 * Indeks `ws_one_active_per_block` hanya mengizinkan SATU jadwal aktif per blok,
 * jadi menyetel ulang berarti menonaktifkan yang lama lebih dulu — bukan menimpa.
 * Riwayatnya dipertahankan supaya bisa dilihat kenapa sebuah baris laporan dulu
 * dinilai tepat waktu padahal intervalnya kini berbeda.
 */
export async function setWeedingSchedule(
  ctx: RlsContext,
  input: { blockId: string; intervalDay: number; toleranceDay: number; note: string | null },
): Promise<void> {
  await withRls(ctx, async (client) => {
    await client.query(
      `UPDATE app.weeding_schedules SET is_active = false
        WHERE block_id = $1 AND is_active`,
      [input.blockId],
    );
    await client.query(
      `INSERT INTO app.weeding_schedules
         (company_id, block_id, interval_day, tolerance_day, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [ctx.companyId, input.blockId, input.intervalDay, input.toleranceDay, input.note, ctx.userId],
    );
  });
}

/**
 * AI-22 · satu hasil survei beserta jawabannya.
 *
 * Sebelum ini daftar /survei hanya menampilkan Form/Blok/Tanggal/Petugas/Status —
 * 66 baris submission_values di dataset demo tidak bisa dilihat sama sekali dari
 * UI. Penguji QA (catatan 10) berhenti di situ.
 */
export type SurveyAnswer = {
  fieldId: string;
  /** Kode field (nama input di SurveyForm) -- dipakai mengisi ulang saat edit (B-21). */
  code: string;
  section: string | null;
  label: string;
  fieldType: string;
  /** null = pertanyaan itu tidak dijawab. Dirender em-dash, BUKAN 0/kosong. */
  value: string | null;
};

export type SurveySubmissionDetail = {
  id: string;
  /** forms.id -- dipakai membangun tautan edit /survei/[formId]?editId=... (B-21). */
  formId: string;
  formName: string;
  formModule: string;
  formVersion: number;
  blockId: string | null;
  blockCode: string | null;
  estateName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  deviceId: string | null;
  /** Koordinat titik submission bila perangkat mengirimnya. */
  lat: number | null;
  lon: number | null;
  answers: SurveyAnswer[];
};

export async function surveySubmissionDetail(
  ctx: RlsContext,
  id: string,
): Promise<SurveySubmissionDetail | null> {
  return withRls(ctx, async (client) => {
    const head = await client.query(
      `SELECT ss.id, f.id AS form_id, f.name AS form_name, f.module AS form_module, fv.version,
              ss.block_id::text AS block_id, b.code AS block_code, e.name AS estate_name,
              (ss.submitted_at AT TIME ZONE 'Asia/Jakarta')::date::text AS submitted_at,
              u.full_name AS submitted_by_name, ss.approval_status, ss.rejection_reason,
              ss.device_id,
              ST_Y(ss.geom::geometry) AS lat, ST_X(ss.geom::geometry) AS lon
         FROM app.survey_submissions ss
         JOIN app.form_versions fv ON fv.id = ss.form_version_id
         JOIN app.forms f ON f.id = fv.form_id
         LEFT JOIN app.blocks b ON b.id = ss.block_id
         LEFT JOIN app.estates e ON e.id = b.estate_id
         LEFT JOIN app.users u ON u.id = ss.submitted_by
        WHERE ss.id = $1`,
      [id],
    );
    const h = head.rows[0];
    // null, bukan throw: RLS mengembalikan 0 baris untuk submission entitas lain,
    // dan itu harus terlihat sebagai "tidak ada", bukan galat server.
    if (!h) return null;

    // LEFT JOIN dari form_fields, bukan dari submission_values: pertanyaan yang
    // TIDAK dijawab harus tetap muncul sebagai em-dash. Kalau di-join dari sisi
    // nilai, pertanyaan kosong hilang dari layar dan hasil survei setengah
    // terisi terlihat seperti hasil yang lengkap.
    const vals = await client.query(
      `SELECT ff.id AS field_id, ff.code, ff.section_name, ff.label, ff.field_type::text AS field_type,
              sv.value_text, sv.value_num, sv.value_bool, sv.value_date::text AS value_date,
              sv.value_json,
              CASE WHEN sv.value_geom IS NULL THEN NULL
                   ELSE ST_Y(sv.value_geom::geometry)::text || ', ' || ST_X(sv.value_geom::geometry)::text
              END AS value_geom
         FROM app.form_fields ff
         LEFT JOIN app.submission_values sv
                ON sv.field_id = ff.id AND sv.submission_id = $1
        WHERE ff.form_version_id = (SELECT form_version_id FROM app.survey_submissions WHERE id = $1)
        ORDER BY ff.sort_order, ff.label`,
      [id],
    );

    const answers: SurveyAnswer[] = vals.rows.map((r) => {
      // Kolom dipilih menurut tipe field. Bila kolom itu kosong tapi kolom lain
      // terisi, nilai yang terisi itu tetap ditampilkan — itu jawaban asli
      // petugas, dan menyembunyikannya sebagai em-dash akan MENGHILANGKAN data
      // yang benar-benar ada. Yang tidak boleh adalah sebaliknya: mengarang isi.
      const kandidat: (string | null)[] = [];
      switch (r.field_type) {
        case "number": case "scale": kandidat.push(r.value_num === null ? null : String(r.value_num)); break;
        case "date": kandidat.push(r.value_date as string | null); break;
        case "yes_no": kandidat.push(r.value_bool === null ? null : r.value_bool ? "Ya" : "Tidak"); break;
        case "gps": case "polygon": kandidat.push(r.value_geom as string | null); break;
        case "multi_choice": case "table":
          kandidat.push(r.value_json === null ? null : JSON.stringify(r.value_json)); break;
        default: kandidat.push(r.value_text as string | null);
      }
      kandidat.push(
        r.value_text as string | null,
        r.value_num === null ? null : String(r.value_num),
        r.value_bool === null ? null : r.value_bool ? "Ya" : "Tidak",
        r.value_date as string | null,
        r.value_geom as string | null,
        r.value_json === null ? null : JSON.stringify(r.value_json),
      );
      const value = kandidat.find((v) => v !== null && v !== "") ?? null;
      return {
        fieldId: String(r.field_id),
        code: String(r.code),
        section: (r.section_name as string) ?? null,
        label: String(r.label),
        fieldType: String(r.field_type),
        value,
      };
    });

    return {
      id: String(h.id),
      formId: String(h.form_id),
      formName: String(h.form_name),
      formModule: String(h.form_module),
      formVersion: Number(h.version),
      blockId: (h.block_id as string) ?? null,
      blockCode: (h.block_code as string) ?? null,
      estateName: (h.estate_name as string) ?? null,
      submittedAt: (h.submitted_at as string) ?? null,
      submittedByName: (h.submitted_by_name as string) ?? null,
      approvalStatus: String(h.approval_status),
      rejectionReason: (h.rejection_reason as string) ?? null,
      deviceId: (h.device_id as string) ?? null,
      lat: h.lat === null ? null : Number(h.lat),
      lon: h.lon === null ? null : Number(h.lon),
      answers,
    };
  });
}
