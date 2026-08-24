import { rlsQuery, type RlsContext } from "@/lib/db";
import type { DashboardFilter, ResolvedFilter } from "./filters";

/**
 * Bagian filter yang BUTUH database — dipisah dari ./filters.ts dengan sengaja.
 *
 * `filters.ts` dipakai komponen "use client"; menaruh `rlsQuery` di sana akan
 * membawa modul `pg` ke bundle peramban dan mematikan seluruh aplikasi dengan
 * galat di pg/lib/connection-parameters.js. Galat itu tidak menyebut penyebabnya,
 * jadi pemisahan ini bukan kerapian — ia mencegah kelas kegagalan yang mahal
 * ditemukan.
 */
export async function resolveFilter(
  ctx: RlsContext,
  f: DashboardFilter,
): Promise<ResolvedFilter> {
  let blockIds: string[] | null = null;

  if (f.blockIds.length > 0 || f.estateIds.length > 0) {
    const rows = await rlsQuery<{ id: string }>(
      ctx,
      `SELECT id FROM app.blocks
        WHERE archived_at IS NULL
          AND ( ($1::uuid[] IS NOT NULL AND id = ANY($1))
             OR ($2::uuid[] IS NOT NULL AND estate_id = ANY($2)) )`,
      [f.blockIds.length ? f.blockIds : null, f.estateIds.length ? f.estateIds : null],
    );
    blockIds = rows.map((r) => r.id);
  }

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (f.periodIds.length > 0) {
    // Beberapa fase sekaligus dipadatkan menjadi SATU rentang menyeluruh.
    // Itu memang lebih longgar daripada gabungan rentang terpisah bila fasenya
    // tidak bersambung — tapi fase proyek di sini berurutan, dan satu rentang
    // membuat tiap subquery cukup punya dua parameter alih-alih daftar rentang.
    const [r] = await rlsQuery<{ from: string | null; to: string | null }>(
      ctx,
      `SELECT min(starts_on)::text AS from, max(ends_on)::text AS to
         FROM app.fiscal_periods WHERE id = ANY($1)`,
      [f.periodIds],
    );
    dateFrom = r?.from ?? null;
    dateTo = r?.to ?? null;
  }

  return {
    blockIds,
    dateFrom,
    dateTo,
    cropCodes: f.cropCodes.length ? f.cropCodes : null,
    komoditasDipilih: f.cropCodes.length > 0,
  };
}
