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
  /** Kunci pembanding anggaran. null = biaya dari tarif ini tidak match anggaran mana pun. */
  costCategoryId: string | null;
};

export async function getPriceList(ctx: RlsContext): Promise<PriceRow[]> {
  const rows = await rlsQuery<{
    id: string; code: string; kind: "cost" | "revenue"; category: string;
    driver: string | null; unit: string; rate_idr: string; is_active: boolean; note: string | null;
    cost_category_id: string | null;
  }>(
    ctx,
    // valid_to IS NULL = versi yang masih berlaku. WAJIB sejak migrasi 0041:
    // app.publish_price() menutup versi lama (valid_to terisi) lalu menyisipkan
    // versi baru, jadi satu kode punya BANYAK baris. Tanpa filter ini
    // reflectedCosts() menjumlahkan tarif lama DAN baru — biaya berganda.
    `SELECT id, code, kind, category, driver, unit, rate_idr, is_active, note, cost_category_id
       FROM app.price_list
      WHERE valid_to IS NULL
      ORDER BY kind, category`,
  );
  return rows.map((r) => ({
    id: r.id, code: r.code, kind: r.kind, category: r.category, driver: r.driver,
    unit: r.unit, rateIdr: Number(r.rate_idr), isActive: r.is_active, note: r.note,
    costCategoryId: r.cost_category_id,
  }));
}

// Metrik volume operasional per driver. Semua di-scope RLS lewat join ke blocks
// (aman walau tabel sumber punya kebijakan berbeda).
//
// Daftar ini WAJIB sama dengan CASE modul di app.decide_record() (migrasi 0044
// §1) dan dengan CHECK price_list_driver_check (0041 §2). Kalau kedua daftar
// berbeda, layar Refleksi dan realisasi anggaran menyebut angka berbeda untuk
// hal yang sama: baris tarif ber-driver yang tidak dikenal di sini dilewati
// oleh reflectedCosts() -- dulu tanpa suara. Itulah yang terjadi antara 0041
// dan perbaikan ini: WEED-HA/SPRAY-L/PRUNE-TREE mendapat driver di database,
// DRIVER_SQL tidak ikut diperluas, dan Rp 37 jt (DEMO) / Rp 414 jt (PILOT)
// hilang dari layar sementara app.decide_record() memateralisasikannya dengan
// benar. Sekarang driver tak dikenal dilaporkan lewat `unknownDrivers`.
//
// TANPA COALESCE(...,0), sengaja: SUM atas nol baris mengembalikan NULL, dan
// NULL berarti "belum ada volume" -- dirender em-dash. COALESCE membuat tarif
// yang belum punya aktivitas apa pun tampil sebagai "Rp 0", yaitu angka
// fabrikasi yang dilarang concept:40 (AI-06, tapi di sisi TypeScript).
const DRIVER_SQL: Record<string, string> = {
  block_area_ha: `SELECT SUM(area_ha)::float8 AS v FROM app.blocks WHERE archived_at IS NULL`,
  landprep_area_ha: `SELECT SUM(lp.effective_area_ha)::float8 AS v
                       FROM app.land_preparations lp JOIN app.blocks b ON b.id = lp.block_id
                      WHERE lp.approval_status = 'approved'`,
  seedling_qty: `SELECT SUM(sd.qty)::float8 AS v
                   FROM app.seed_distributions sd JOIN app.blocks b ON b.id = sd.block_id
                  WHERE b.archived_at IS NULL`,
  fertilizer_qty: `SELECT SUM(fa.total_quantity)::float8 AS v
                     FROM app.fertilizer_applications fa JOIN app.blocks b ON b.id = fa.block_id
                    WHERE fa.approval_status = 'approved'`,
  // Tiga di bawah menyusul migrasi 0041/0044 (AI-02). Kolom sumbernya dipilih
  // supaya IDENTIK dengan yang dipakai app.decide_record() saat materialisasi:
  // weeding_records.area_ha, spraying_records.total_volume, pruning_records
  // .tree_count -- keduanya harus mengukur hal yang sama.
  weeding_area_ha: `SELECT SUM(w.area_ha)::float8 AS v
                      FROM app.weeding_records w JOIN app.blocks b ON b.id = w.block_id
                     WHERE w.approval_status = 'approved'`,
  spraying_volume: `SELECT SUM(s.total_volume)::float8 AS v
                      FROM app.spraying_records s JOIN app.blocks b ON b.id = s.block_id
                     WHERE s.approval_status = 'approved'`,
  pruning_tree_count: `SELECT SUM(pr.tree_count)::float8 AS v
                         FROM app.pruning_records pr JOIN app.blocks b ON b.id = pr.block_id
                        WHERE pr.approval_status = 'approved'`,
};

/**
 * Driver yang boleh dipilih saat membuat baris tarif (AI-44a).
 *
 * Diturunkan dari kunci DRIVER_SQL, BUKAN daftar terpisah: driver yang tidak
 * punya query volume tidak akan pernah menghasilkan biaya di layar Refleksi,
 * jadi menawarkannya di form hanya membuat baris tarif yang diam. CHECK
 * price_list_driver_check (0041 §2) adalah gerbang otoritatifnya; ini
 * penyaring di depan supaya pesannya enak dibaca.
 */
export function driverOptions(): { value: string; label: string }[] {
  return Object.keys(DRIVER_SQL).map((d) => ({ value: d, label: DRIVER_LABEL[d] ?? d }));
}

const DRIVER_LABEL: Record<string, string> = {
  block_area_ha: "Total luas blok",
  landprep_area_ha: "Luas persiapan lahan (disetujui)",
  seedling_qty: "Bibit terdistribusi",
  fertilizer_qty: "Pupuk diaplikasikan (disetujui)",
  weeding_area_ha: "Luas penyiangan (disetujui)",
  spraying_volume: "Volume semprot (disetujui)",
  pruning_tree_count: "Pohon dipruning (disetujui)",
};

export type ReflectedLine = {
  code: string;
  category: string;
  driverLabel: string;
  /** null = belum ada volume sumber sama sekali (SUM atas nol baris), BUKAN 0. */
  volume: number | null;
  unit: string;
  rateIdr: number;
  /** null bila volumenya null — tarif tanpa volume bukan biaya Rp 0. */
  amountIdr: number | null;
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
  /** Jumlah baris yang volumenya DIKETAHUI. Baris ber-volume null tidak ikut. */
  totalCostIdr: number;
  /** Baris biaya tarif-manual (mis. upah) yang butuh input volume terpisah. */
  manualCost: PriceRow[];
  /**
   * Baris tarif aktif yang drivernya tidak dikenal DRIVER_SQL. Sebelumnya
   * dilewati tanpa suara; ditampilkan supaya selisih dengan realisasi anggaran
   * terlihat, bukan menghilang.
   */
  unknownDrivers: { code: string; category: string; driver: string }[];
  /**
   * Baris tarif aktif yang drivernya sudah dipakai baris lain. Volume driver
   * hanya boleh dihitung SEKALI: mengalikannya ke dua baris menggandakan biaya.
   * Baris yang kalah dilaporkan di sini, bukan dijumlahkan diam-diam.
   */
  driverConflicts: { code: string; category: string; driver: string; dipakaiOleh: string }[];
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
  const unknownDrivers: Reflection["unknownDrivers"] = [];
  const driverConflicts: Reflection["driverConflicts"] = [];

  // Urut per kode supaya pemenang konflik driver deterministik (bukan bergantung
  // pada ORDER BY kind, category di getPriceList yang bisa berubah).
  const costRows = prices
    .filter((p) => p.kind === "cost" && p.isActive && p.driver)
    .sort((a, b) => a.code.localeCompare(b.code));

  // Volume di-query SEKALI per driver, bukan per baris tarif: dua baris yang
  // berbagi driver mengukur volume yang SAMA, jadi mengalikannya dua kali
  // menggandakan biaya. Baris kedua dilaporkan sebagai konflik.
  const volumeByDriver = new Map<string, number | null>();
  const winnerByDriver = new Map<string, string>();

  for (const p of costRows) {
    const driver = p.driver!;
    const sql = DRIVER_SQL[driver];
    if (!sql) {
      unknownDrivers.push({ code: p.code, category: p.category, driver });
      continue;
    }
    const pemenang = winnerByDriver.get(driver);
    if (pemenang) {
      driverConflicts.push({ code: p.code, category: p.category, driver, dipakaiOleh: pemenang });
      continue;
    }
    winnerByDriver.set(driver, p.code);

    if (!volumeByDriver.has(driver)) {
      const res = await rlsQuery<{ v: number | null }>(ctx, sql);
      // res[0].v null = SUM atas nol baris. Dipertahankan sebagai null: "belum
      // ada volume" bukan "volumenya nol".
      volumeByDriver.set(driver, res[0]?.v ?? null);
    }
    const volume = volumeByDriver.get(driver) ?? null;
    lines.push({
      code: p.code, category: p.category, driverLabel: DRIVER_LABEL[driver] ?? driver,
      volume, unit: p.unit, rateIdr: p.rateIdr,
      amountIdr: volume === null ? null : Math.round(volume * p.rateIdr),
    });
  }
  const totalCostIdr = lines.reduce((a, l) => a + (l.amountIdr ?? 0), 0);

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
    unknownDrivers,
    driverConflicts,
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
 * BUAT baris tarif baru (AI-44a, K-09 §19).
 *
 * Sebelum ini `INSERT INTO app.price_list` hanya ada di `db/seed-demo.mjs` —
 * tarif hanya bisa lahir dari seed atau SQL manual, dan itu memblokir K-03
 * (harga per grade butuh satu baris revenue per grade).
 *
 * Jalurnya SAMA dengan penerbitan versi: app.publish_price(). Fungsi itu
 * mengenali "kode belum ada" dan menempuh cabang versi 1, tempat kind/category/
 * unit menjadi WAJIB. Tidak ada INSERT langsung di sini — app_rw tidak punya
 * privilege INSERT ke price_list (ledger app.privilege_revocations, 0041 §7),
 * jadi satu pintu tulis itu bukan kesepakatan lapisan aplikasi tapi ditegakkan
 * database.
 *
 * `chemical_id` SENGAJA tidak diekspos. Tarif per bahan adalah kemampuan nyata
 * (app.price_for_driver memilih baris ber-chemical_id di atas baris generik),
 * tetapi "bahan mana yang pantas punya tarif sendiri" adalah keputusan produk
 * yang belum diambil — dan indeks 0046 membuat pilihan yang salah tidak bisa
 * diperbaiki dengan menimpa. Biarkan seed/migrasi yang mengisinya sampai
 * keputusannya ada.
 */
export async function createPriceRow(
  ctx: RlsContext,
  input: {
    code: string;
    kind: "cost" | "revenue";
    category: string;
    unit: string;
    rateIdr: number;
    berlakuDari: string;
    driver: string | null;
    costCategoryId: string | null;
    note: string | null;
  },
): Promise<void> {
  await rlsQuery(
    ctx,
    `SELECT app.publish_price(
              p_code             => $1,
              p_rate_idr         => $2,
              p_valid_from       => $3::date,
              p_unit             => $4,
              p_kind             => $5,
              p_category         => $6,
              p_driver           => $7,
              p_cost_category_id => $8::uuid,
              p_note             => $9)`,
    [
      input.code, input.rateIdr, input.berlakuDari, input.unit, input.kind,
      input.category, input.driver, input.costCategoryId, input.note,
    ],
  );
}

/**
 * UBAH METADATA tarif (AI-44b, kelas "edit in-place" K-09 §19).
 *
 * Hanya `category`, `note`, `is_active`, dan `cost_category_id` — kelas yang boleh
 * diperbaiki tanpa membuat versi baru, karena mengubahnya tidak mengubah pernyataan
 * ekonomi apa pun. `rate_idr` + `unit` TIDAK di sini (itu versi baru lewat
 * publishPriceRate), dan `code`/`kind`/`driver` kekal.
 *
 * Berlaku ke SELURUH versi kode itu, bukan satu baris. Itu disengaja (0041 §6):
 * label dan pemetaan akuntansi adalah sifat KODE-nya, bukan sifat versi tarifnya,
 * jadi riwayat harus terbaca konsisten.
 *
 * Kenapa ini penting melebihi kenyamanan: `cost_category_id` adalah kunci yang
 * dipakai perbandingan anggaran. Tanpa jalur ini, satu-satunya cara memetakan
 * tarif ke kategori adalah seed atau SQL manual — artinya SETIAP tenant baru
 * butuh developer sebelum serapan anggarannya bisa terisi.
 *
 * NULL = "jangan ubah" (fungsinya memakai COALESCE), jadi field yang tidak diisi
 * tidak akan menimpa nilai yang sudah ada.
 */
export async function updatePriceMeta(
  ctx: RlsContext,
  input: {
    id: string;
    category: string | null;
    note: string | null;
    isActive: boolean | null;
    costCategoryId: string | null;
  },
): Promise<number> {
  const rows = await rlsQuery<{ n: number }>(
    ctx,
    `SELECT app.update_price_meta(
              p_id               => $1::uuid,
              p_category         => $2,
              p_note             => $3,
              p_is_active        => $4::boolean,
              p_cost_category_id => $5::uuid) AS n`,
    [input.id, input.category, input.note, input.isActive, input.costCategoryId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Kode tarif yang sudah dipakai entitas ini — untuk pesan galat yang menyebut sebabnya. */
export async function priceCodeExists(ctx: RlsContext, code: string): Promise<boolean> {
  const rows = await rlsQuery<{ ada: boolean }>(
    ctx,
    `SELECT EXISTS (SELECT 1 FROM app.price_list WHERE code = $1) AS ada`,
    [code],
  );
  return rows[0]?.ada ?? false;
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
