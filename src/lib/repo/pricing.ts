import { rlsQuery, type RlsContext } from "@/lib/db";

/**
 * Price list + refleksi biaya (docs/11 §4). Biaya ter-refleksi dihitung dari
 * VOLUME operasional nyata × TARIF katalog. Tidak ada input biaya manual.
 */

export type PriceRow = {
  id: string;
  code: string;
  kind: "cost" | "revenue";
  category: string;
  driver: string | null;
  unit: string;
  rateIdr: number;
  isActive: boolean;
  note: string | null;
};

export async function getPriceList(ctx: RlsContext): Promise<PriceRow[]> {
  const rows = await rlsQuery<{
    id: string; code: string; kind: "cost" | "revenue"; category: string;
    driver: string | null; unit: string; rate_idr: string; is_active: boolean; note: string | null;
  }>(
    ctx,
    // valid_to IS NULL = versi yang masih berlaku. WAJIB sejak migrasi 0041:
    // app.publish_price() menutup versi lama (valid_to terisi) lalu menyisipkan
    // versi baru, jadi satu kode punya BANYAK baris. Tanpa filter ini
    // reflectedCosts() menjumlahkan tarif lama DAN baru — biaya berganda.
    `SELECT id, code, kind, category, driver, unit, rate_idr, is_active, note
       FROM app.price_list
      WHERE valid_to IS NULL
      ORDER BY kind, category`,
  );
  return rows.map((r) => ({
    id: r.id, code: r.code, kind: r.kind, category: r.category, driver: r.driver,
    unit: r.unit, rateIdr: Number(r.rate_idr), isActive: r.is_active, note: r.note,
  }));
}

// Metrik volume operasional per driver. Semua di-scope RLS lewat join ke blocks
// (aman walau tabel sumber punya kebijakan berbeda).
const DRIVER_SQL: Record<string, string> = {
  block_area_ha: `SELECT COALESCE(SUM(area_ha), 0)::float8 AS v FROM app.blocks WHERE archived_at IS NULL`,
  landprep_area_ha: `SELECT COALESCE(SUM(lp.effective_area_ha), 0)::float8 AS v
                       FROM app.land_preparations lp JOIN app.blocks b ON b.id = lp.block_id
                      WHERE lp.approval_status = 'approved'`,
  seedling_qty: `SELECT COALESCE(SUM(sd.qty), 0)::float8 AS v
                   FROM app.seed_distributions sd JOIN app.blocks b ON b.id = sd.block_id
                  WHERE b.archived_at IS NULL`,
  fertilizer_qty: `SELECT COALESCE(SUM(fa.total_quantity), 0)::float8 AS v
                     FROM app.fertilizer_applications fa JOIN app.blocks b ON b.id = fa.block_id
                    WHERE fa.approval_status = 'approved'`,
};

const DRIVER_LABEL: Record<string, string> = {
  block_area_ha: "Total luas blok",
  landprep_area_ha: "Luas persiapan lahan (disetujui)",
  seedling_qty: "Bibit terdistribusi",
  fertilizer_qty: "Pupuk diaplikasikan (disetujui)",
};

export type ReflectedLine = {
  code: string;
  category: string;
  driverLabel: string;
  volume: number;
  unit: string;
  rateIdr: number;
  amountIdr: number;
};

export type RevenueLine = {
  cropCode: string;
  category: string;
  tonnage: number;
  rateIdr: number;
  amountIdr: number;
};

export type Reflection = {
  lines: ReflectedLine[];
  totalCostIdr: number;
  /** Baris biaya tarif-manual (mis. upah) yang butuh input volume terpisah. */
  manualCost: PriceRow[];
  revenueRates: PriceRow[];
  revenueLines: RevenueLine[];
  totalRevenueIdr: number;
  /** null bila belum ada panen disetujui — jangan tampilkan 0 sebagai fakta. */
  balanceIdr: number | null;
};

// Komoditas panen → kode tarif revenue di price_list.
const REVENUE_CODE: Record<string, string> = { DURIAN: "REV-DUR-A", COCONUT: "REV-COCO" };

/** Hitung biaya + revenue ter-refleksi = Σ (volume operasional × tarif). */
export async function reflectedCosts(ctx: RlsContext): Promise<Reflection> {
  const prices = await getPriceList(ctx);
  const lines: ReflectedLine[] = [];

  for (const p of prices) {
    if (p.kind !== "cost" || !p.isActive || !p.driver) continue;
    const sql = DRIVER_SQL[p.driver];
    if (!sql) continue;
    const res = await rlsQuery<{ v: number }>(ctx, sql);
    const volume = res[0]?.v ?? 0;
    lines.push({
      code: p.code, category: p.category, driverLabel: DRIVER_LABEL[p.driver] ?? p.driver,
      volume, unit: p.unit, rateIdr: p.rateIdr, amountIdr: Math.round(volume * p.rateIdr),
    });
  }
  const totalCostIdr = lines.reduce((a, l) => a + l.amountIdr, 0);

  // Revenue dari panen DISETUJUI × tarif per komoditas.
  const harvest = await rlsQuery<{ crop_code: string; ton: number }>(
    ctx,
    `SELECT h.crop_code, COALESCE(SUM(h.quantity_ton), 0)::float8 AS ton
       FROM app.harvest_records h JOIN app.blocks b ON b.id = h.block_id
      WHERE h.approval_status = 'approved'
      GROUP BY h.crop_code`,
  );
  const rateByCode = new Map(prices.filter((p) => p.kind === "revenue").map((p) => [p.code, p]));
  const revenueLines: RevenueLine[] = [];
  for (const h of harvest) {
    if (h.ton <= 0) continue;
    const price = rateByCode.get(REVENUE_CODE[h.crop_code]);
    if (!price) continue;
    revenueLines.push({
      cropCode: h.crop_code, category: price.category, tonnage: h.ton,
      rateIdr: price.rateIdr, amountIdr: Math.round(h.ton * price.rateIdr),
    });
  }
  const totalRevenueIdr = revenueLines.reduce((a, l) => a + l.amountIdr, 0);
  const hasRevenue = revenueLines.length > 0;

  return {
    lines,
    totalCostIdr,
    manualCost: prices.filter((p) => p.kind === "cost" && p.isActive && !p.driver),
    revenueRates: prices.filter((p) => p.kind === "revenue" && p.isActive),
    revenueLines,
    totalRevenueIdr,
    balanceIdr: hasRevenue ? totalRevenueIdr - totalCostIdr : null,
  };
}

/**
 * TERBITKAN tarif baru — bukan mengubah yang lama.
 *
 * Sejak migrasi 0041 (K-02 §14) price_list append-only: UPDATE dicabut dari
 * app_rw dan tercatat di ledger app.privilege_revocations. Perubahan tarif
 * berjalan lewat app.publish_price() yang menutup versi lama (valid_to) lalu
 * menyisipkan versi baru — sehingga biaya historis TIDAK ikut berubah saat
 * tarif naik. Fungsinya SECURITY DEFINER dan self-gate ke super_admin
 * (§17 Keputusan 3), jadi lapisan ini tidak perlu — dan tidak boleh — menebak
 * otorisasinya sendiri.
 *
 * `berlakuDari` default hari ini di zona operasional: tarif berlaku ke depan,
 * backdating dilarang oleh fungsinya (K-02 aturan 2).
 */
export async function publishPriceRate(
  ctx: RlsContext,
  input: { code: string; rateIdr: number; berlakuDari: string },
): Promise<void> {
  await rlsQuery(
    ctx,
    `SELECT app.publish_price($1, $2, $3::date)`,
    [input.code, input.rateIdr, input.berlakuDari],
  );
}

/**
 * Kategori biaya yang sudah TER-MATERIALISASI OTOMATIS saat approval — yaitu
 * kategori yang ditunjuk baris tarif ber-driver (migrasi 0041/0044).
 *
 * Dipakai form pengeluaran manual (AI-52) untuk memperingatkan pencatat: biaya
 * kategori ini lahir sendiri dari aktivitas yang disetujui, jadi mencatatnya
 * manual akan MENGGANDAKAN realisasi anggaran. Daftarnya diturunkan dari data,
 * bukan dihardcode, supaya tetap benar saat tarif/pemetaan berubah.
 *
 * Catatan penting: satu kategori bisa otomatis DAN manual sekaligus. LABOR
 * misalnya lahir otomatis dari penyiangan & pruning, tetapi upah harian
 * (LABOR-DAY, tanpa driver) memang harus dicatat manual. Karena itu ini
 * peringatan, bukan larangan — memblokir kategorinya akan mematikan justru
 * kebutuhan yang membuat form ini ada.
 */
export async function autoMaterializedCategories(
  ctx: RlsContext,
): Promise<{ name: string; adaJalurManual: boolean }[]> {
  const rows = await rlsQuery<{ name: string; ada_manual: boolean }>(
    ctx,
    `SELECT mi.name,
            bool_or(p.driver IS NULL) AS ada_manual
       FROM app.price_list p
       JOIN app.master_items mi ON mi.id = p.cost_category_id
      WHERE p.valid_to IS NULL AND p.is_active
      GROUP BY mi.name
     HAVING bool_or(p.driver IS NOT NULL)
      ORDER BY mi.name`,
  );
  return rows.map((r) => ({ name: r.name, adaJalurManual: r.ada_manual }));
}
