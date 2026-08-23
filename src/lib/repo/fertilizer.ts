import { rlsQuery, type RlsContext } from "@/lib/db";

export type FertRecommendation = {
  id: string;
  blockId: string;
  blockCode: string;
  blockName: string | null;
  cropCode: "DURIAN" | "COCONUT";
  phase: string;
  approach: string;
  params: Record<string, string | number>;
  doseN: number | null;
  doseP2o5: number | null;
  doseK2o: number | null;
  doseMgo: number | null;
  doseS: number | null;
  kSource: string | null;
  splitCount: number | null;
  isProvisional: boolean;
  note: string | null;
  recommendedAt: string;
};

/** Seluruh rekomendasi pemupukan pada entitas aktif, terbaru dulu. */
export async function listRecommendations(ctx: RlsContext): Promise<FertRecommendation[]> {
  const rows = await rlsQuery<{
    id: string; block_id: string; block_code: string; block_name: string | null;
    crop_code: "DURIAN" | "COCONUT"; phase: string; approach: string;
    params: Record<string, string | number>;
    dose_n_g: string | null; dose_p2o5_g: string | null; dose_k2o_g: string | null;
    dose_mgo_g: string | null; dose_s_g: string | null;
    k_source: string | null; split_count: number | null; is_provisional: boolean;
    note: string | null; recommended_at: string;
  }>(
    ctx,
    `SELECT r.id, r.block_id, b.code AS block_code, b.name AS block_name,
            r.crop_code, r.phase::text, r.approach::text, r.params,
            r.dose_n_g, r.dose_p2o5_g, r.dose_k2o_g, r.dose_mgo_g, r.dose_s_g,
            r.k_source, r.split_count, r.is_provisional, r.note, r.recommended_at
       FROM app.fertilizer_recommendations r
       JOIN app.blocks b ON b.id = r.block_id
      ORDER BY b.code, r.crop_code, r.phase`,
  );
  const num = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    id: r.id,
    blockId: r.block_id,
    blockCode: r.block_code,
    blockName: r.block_name,
    cropCode: r.crop_code,
    phase: r.phase,
    approach: r.approach,
    params: r.params ?? {},
    doseN: num(r.dose_n_g),
    doseP2o5: num(r.dose_p2o5_g),
    doseK2o: num(r.dose_k2o_g),
    doseMgo: num(r.dose_mgo_g),
    doseS: num(r.dose_s_g),
    kSource: r.k_source,
    splitCount: r.split_count,
    isProvisional: r.is_provisional,
    note: r.note,
    recommendedAt: r.recommended_at ?? "",
  }));
}

export type SaveRecommendationInput = {
  blockId: string;
  cropCode: "DURIAN" | "COCONUT";
  phase: string;
  approach: string;
  params: Record<string, string | number>;
  doseN: number | null;
  doseP2o5: number | null;
  doseK2o: number | null;
  doseMgo: number | null;
  doseS: number | null;
  kSource: string | null;
  splitCount: number | null;
  isProvisional: boolean;
  note: string | null;
  recommendedAt: string;
};

/** Buat/perbarui rekomendasi (idempoten per blok × komoditas × fase). */
export async function saveRecommendation(ctx: RlsContext, input: SaveRecommendationInput): Promise<void> {
  await rlsQuery(
    ctx,
    `INSERT INTO app.fertilizer_recommendations
       (company_id, block_id, crop_code, phase, approach, params,
        dose_n_g, dose_p2o5_g, dose_k2o_g, dose_mgo_g, dose_s_g,
        k_source, split_count, is_provisional, note, recommended_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4::app.fert_phase,$5::app.fert_approach,$6::jsonb,
             $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
     ON CONFLICT (block_id, crop_code, phase) DO UPDATE SET
       approach = EXCLUDED.approach, params = EXCLUDED.params,
       dose_n_g = EXCLUDED.dose_n_g, dose_p2o5_g = EXCLUDED.dose_p2o5_g,
       dose_k2o_g = EXCLUDED.dose_k2o_g, dose_mgo_g = EXCLUDED.dose_mgo_g,
       dose_s_g = EXCLUDED.dose_s_g, k_source = EXCLUDED.k_source,
       split_count = EXCLUDED.split_count, is_provisional = EXCLUDED.is_provisional,
       note = EXCLUDED.note, recommended_at = EXCLUDED.recommended_at,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [
      ctx.companyId, input.blockId, input.cropCode, input.phase, input.approach,
      JSON.stringify(input.params),
      input.doseN, input.doseP2o5, input.doseK2o, input.doseMgo, input.doseS,
      input.kSource, input.splitCount, input.isProvisional, input.note,
      input.recommendedAt, ctx.userId,
    ],
  );
}

/** Hapus satu rekomendasi (dibatasi RLS tenant + writer). */
export async function deleteRecommendation(ctx: RlsContext, id: string): Promise<void> {
  await rlsQuery(ctx, `DELETE FROM app.fertilizer_recommendations WHERE id = $1`, [id]);
}
