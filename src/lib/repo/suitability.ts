import { rlsQuery, withRls, type RlsContext } from "@/lib/db";

/**
 * Mesin kesesuaian lahan — metode MATCHING + hukum minimum Liebig (BBSDLP).
 * Lihat docs/07-kesesuaian-lahan §4.1.
 *
 * Kriteria kelas dibaca dari app.land_suit_criteria (data, bisa diedit).
 * Logika di sini murni: cocokkan tiap karakteristik ke kelas terbaik, lalu
 * kelas lahan = kelas TERENDAH di antara semua karakteristik (hukum minimum).
 * Subkelas = kelas + simbol karakteristik yang berada di kelas terendah itu.
 *
 * Ini kesesuaian FISIK, bukan kelayakan ekonomi — UI wajib menyatakannya.
 */

export type Band =
  | { cls: SuitClass; min: number | null; max: number | null }
  | { cls: SuitClass; set: string[] };

export type Criterion = {
  charCode: string;
  charLabel: string;
  symbol: string;
  unit: string | null;
  isNumeric: boolean;
  sortOrder: number;
  bands: Band[];
};

export type SuitClass = "S1" | "S2" | "S3" | "N";
const ORDER: SuitClass[] = ["S1", "S2", "S3", "N"];
const RANK: Record<SuitClass, number> = { S1: 0, S2: 1, S3: 2, N: 3 };

export async function getCriteria(ctx: RlsContext, cropCode: string): Promise<Criterion[]> {
  const rows = await rlsQuery<{
    char_code: string; char_label: string; symbol: string; unit: string | null;
    is_numeric: boolean; sort_order: number; bands: Band[];
  }>(
    ctx,
    `SELECT lsc.char_code, lsc.char_label, lsc.symbol, lsc.unit, lsc.is_numeric,
            lsc.sort_order, lsc.bands
       FROM app.land_suit_criteria lsc
       JOIN app.crops c ON c.id = lsc.crop_id
      WHERE c.code = $1
      ORDER BY lsc.sort_order`,
    [cropCode],
  );
  return rows.map((r) => ({
    charCode: r.char_code,
    charLabel: r.char_label,
    symbol: r.symbol,
    unit: r.unit,
    isNumeric: r.is_numeric,
    sortOrder: r.sort_order,
    bands: r.bands,
  }));
}

function matchClass(crit: Criterion, value: number | string | null): SuitClass | null {
  if (value === null || value === "") return null;
  // Cari kelas TERBAIK (S1 dulu) yang salah satu band-nya cocok.
  for (const cls of ORDER) {
    for (const b of crit.bands) {
      if (b.cls !== cls) continue;
      if ("set" in b) {
        if (typeof value === "string" && b.set.includes(value)) return cls;
      } else {
        const v = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(v)) continue;
        const okMin = b.min === null || v >= b.min;
        const okMax = b.max === null || v <= b.max;
        if (okMin && okMax) return cls;
      }
    }
  }
  // Nilai diberikan tapi tak masuk band mana pun → di luar seluruh kriteria = N.
  return "N";
}

export type PerChar = {
  charCode: string;
  charLabel: string;
  symbol: string;
  unit: string | null;
  value: number | string | null;
  cls: SuitClass | null;
};

export type Classification = {
  overall: SuitClass | null;
  subclass: string | null;
  limiting: string[];
  perChar: PerChar[];
  assessedCount: number;
};

/** Hukum minimum: kelas = terendah dari karakteristik yang dinilai. */
export function classify(
  criteria: Criterion[],
  params: Record<string, number | string | null | undefined>,
): Classification {
  const perChar: PerChar[] = criteria.map((c) => {
    const raw = params[c.charCode];
    const value = raw === undefined || raw === "" ? null : raw;
    return {
      charCode: c.charCode,
      charLabel: c.charLabel,
      symbol: c.symbol,
      unit: c.unit,
      value,
      cls: matchClass(c, value ?? null),
    };
  });

  const assessed = perChar.filter((p) => p.cls !== null);
  if (assessed.length === 0) {
    return { overall: null, subclass: null, limiting: [], perChar, assessedCount: 0 };
  }

  const worst = assessed.reduce<SuitClass>(
    (w, p) => (RANK[p.cls!] > RANK[w] ? p.cls! : w),
    "S1",
  );
  // Simbol unik dari karakteristik yang berada di kelas terendah.
  const limiting = [
    ...new Set(assessed.filter((p) => p.cls === worst).map((p) => p.symbol)),
  ].sort();
  const subclass = worst === "S1" ? "S1" : `${worst}${limiting.join(",")}`;

  return { overall: worst, subclass, limiting, perChar, assessedCount: assessed.length };
}

/** Klasifikasi kedua komoditas sekaligus untuk satu set parameter. */
export async function classifyBoth(
  ctx: RlsContext,
  params: Record<string, number | string | null | undefined>,
): Promise<{ durian: Classification; coconut: Classification }> {
  const [dc, cc] = await Promise.all([getCriteria(ctx, "DURIAN"), getCriteria(ctx, "COCONUT")]);
  return { durian: classify(dc, params), coconut: classify(cc, params) };
}

export type SuitabilityRow = {
  id: string;
  blockCode: string;
  assessedAt: string;
  cropName: string | null;
  cropCode: string | null;
  suitClass: string | null;
  subclass: string | null;
  limiting: string[];
  params: Record<string, string | number>;
  note: string | null;
  approvalStatus: string;
  rejectionReason: string | null;
  createdBy: string | null;
};

export async function listSuitabilityAssessments(ctx: RlsContext): Promise<SuitabilityRow[]> {
  const rows = await rlsQuery<{
    id: string; block_code: string; assessed_at: string; crop_name: string | null;
    crop_code: string | null; suit_class: string | null; subclass: string | null;
    limiting: string[] | null; params: Record<string, string | number> | null;
    note: string | null; approval_status: string; rejection_reason: string | null;
    created_by: string | null;
  }>(
    ctx,
    `SELECT lsa.id, b.code AS block_code,
            (lsa.assessed_at AT TIME ZONE 'Asia/Jakarta')::date::text AS assessed_at,
            cr.name AS crop_name,
            cr.code AS crop_code, lsa.suit_class, lsa.subclass, lsa.limiting,
            lsa.params, lsa.note, lsa.approval_status, lsa.rejection_reason, lsa.created_by::text
       FROM app.land_suitability_assessments lsa
       JOIN app.blocks b ON b.id = lsa.block_id
       LEFT JOIN app.crops cr ON cr.id = lsa.crop_id
      ORDER BY lsa.assessed_at DESC, lsa.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    blockCode: r.block_code,
    assessedAt: r.assessed_at,
    cropName: r.crop_name,
    cropCode: r.crop_code,
    suitClass: r.suit_class,
    subclass: r.subclass,
    limiting: r.limiting ?? [],
    params: r.params ?? {},
    note: r.note,
    approvalStatus: r.approval_status,
    rejectionReason: r.rejection_reason,
    createdBy: r.created_by,
  }));
}

/** Simpan hasil klasifikasi (satu baris per komoditas yang dinilai). */
export async function saveSuitability(
  ctx: RlsContext,
  input: {
    blockId: string;
    assessedAt: string;
    cropCode: "DURIAN" | "COCONUT";
    result: Classification;
    params: Record<string, unknown>;
    note?: string | null;
  },
): Promise<string> {
  return withRls(ctx, async (client) => {
    const crop = await client.query<{ id: string }>(`SELECT id FROM app.crops WHERE code = $1`, [
      input.cropCode,
    ]);
    const rows = await client.query<{ id: string }>(
      `INSERT INTO app.land_suitability_assessments
         (block_id, assessed_at, crop_id, suit_class, subclass, limiting, params, note,
          approval_status, created_by, assessor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$9) RETURNING id`,
      [
        input.blockId,
        input.assessedAt,
        crop.rows[0]?.id ?? null,
        input.result.overall,
        input.result.subclass,
        input.result.limiting,
        JSON.stringify(input.params),
        input.note ?? null,
        ctx.userId,
      ],
    );
    return rows.rows[0].id;
  });
}
