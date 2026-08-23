import { rlsQuery, type RlsContext } from "@/lib/db";
import { companyName } from "@/lib/repo/reports";
import { statusLabelId, type ModuleReport, type ModuleColumn, type ReportMeta } from "./types";
import { CROP } from "@/lib/labels";

const nf = (v: number | null, d = 0) => (v === null ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v));
const N = (v: string | null) => (v === null ? null : Number(v));
const D = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

async function meta(ctx: RlsContext, o: { title: string; subtitle: string; source: string; note: string }): Promise<ReportMeta> {
  return {
    title: o.title, subtitle: o.subtitle, entity: await companyName(ctx),
    period: "Seluruh data s.d. tanggal cetak", blockScope: "Semua blok",
    commodity: "Kelapa & Durian", dataStatus: "Semua status (lihat kolom Status)",
    printedAt: new Date(), source: o.source, note: o.note,
  };
}
// Peta komoditas dipusatkan di src/lib/labels.ts (dulu disalin di 4 berkas).

// 01 Kesesuaian Lahan ────────────────────────────────────────────────────────
export async function suitabilityReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT b.code AS block, b.name AS bname, lsa.score_durian, lsa.score_coconut, lsa.slope_pct,
           lsa.rainfall_mm_year, lsa.elevation_m, lsa.assessed_at::text, u.full_name AS assessor, lsa.approval_status::text AS st
    FROM app.land_suitability_assessments lsa JOIN app.blocks b ON b.id=lsa.block_id
    LEFT JOIN app.users u ON u.id=lsa.assessor_id ORDER BY b.code`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode Blok" }, { label: "Nama Blok" },
    { label: "Skor Durian", align: "right" }, { label: "Skor Kelapa", align: "right" },
    { label: "Lereng (%)", align: "right" }, { label: "Curah hujan (mm/th)", align: "right" }, { label: "Elevasi (m)", align: "right" },
    { label: "Rekomendasi perbaikan", kind: "new" }, { label: "Reinspection?", kind: "new" },
    { label: "Tanggal" }, { label: "Penilai" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Kesesuaian Lahan (Land Suitability)", subtitle: "Penilaian kelas S1–N per blok, metode matching (hukum minimum).", source: "modul Land Suitability.", note: "Kelas S1 sangat sesuai – N tidak sesuai. Kosong = \"—\"." }),
    columns,
    rows: rows.map((r, i) => [i + 1, r.block, r.bname ?? "—", nf(N(r.score_durian), 1), nf(N(r.score_coconut), 1), nf(N(r.slope_pct), 1), nf(N(r.rainfall_mm_year)), nf(N(r.elevation_m)), "—", "—", D(r.assessed_at), r.assessor ?? "—", statusLabelId(r.st ?? "")]),
    visual: "Radar parameter vs ambang · peta choropleth kelas kesesuaian.",
  };
}

// 02 Persiapan Lahan ──────────────────────────────────────────────────────────
export async function landPrepReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT lp.checked_at::text, b.code AS block, b.name AS bname, lp.soil_ph, lp.planting_hole_count,
           lp.effective_area_ha, lp.status::text AS pstatus, lp.approval_status::text AS st
    FROM app.land_preparations lp JOIN app.blocks b ON b.id=lp.block_id ORDER BY lp.checked_at DESC`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Nama Blok" },
    { label: "pH tanah", align: "right" }, { label: "Jumlah lubang tanam", align: "right" }, { label: "Luas efektif (ha)", align: "right" },
    { label: "% Kesiapan", align: "right", kind: "new" }, { label: "Tanggal siap tanam", kind: "new" },
    { label: "Status kesiapan" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Persiapan Lahan (Land Preparation)", subtitle: "Checklist kesiapan tanam per blok: pH, lubang tanam, luas efektif, status.", source: "modul Land Preparation.", note: "Status kesiapan: Belum siap / Proses / Siap tanam." }),
    columns,
    rows: rows.map((r, i) => [i + 1, D(r.checked_at), r.block, r.bname ?? "—", nf(N(r.soil_ph), 1), nf(N(r.planting_hole_count)), nf(N(r.effective_area_ha), 2), "—", "—", r.pstatus ?? "—", statusLabelId(r.st ?? "")]),
    visual: "Papan kanban status kesiapan · peta status per blok.",
  };
}

// 03 Bibit & Nursery ──────────────────────────────────────────────────────────
export async function nurseryReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT sb.code AS batch, c.name AS crop, sb.qty_initial,
           (SELECT ni.qty_alive FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS alive,
           (SELECT ni.qty_dead FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS dead,
           (SELECT ni.qty_damaged FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS damaged,
           (SELECT ni.inspected_at::text FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS insp
    FROM app.seed_batches sb LEFT JOIN app.crops c ON c.id=sb.crop_id ORDER BY sb.code`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode Batch" }, { label: "Komoditas" },
    { label: "Jumlah awal", align: "right" }, { label: "Hidup", align: "right" }, { label: "Mati", align: "right" }, { label: "Rusak", align: "right" },
    { label: "Survival %", align: "right" }, { label: "Alert survival", kind: "new" }, { label: "Tren survival", kind: "new" }, { label: "Tgl inspeksi" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Bibit & Nursery (Seedling)", subtitle: "Stok bibit per batch; kondisi dari inspeksi terakhir disetujui.", source: "modul Seedling/Nursery.", note: "Survival = hidup ÷ jumlah awal batch. Batch tanpa inspeksi ditandai —." }),
    columns,
    rows: rows.map((r, i) => {
      const init = N(r.qty_initial); const alive = N(r.alive);
      const surv = init && alive !== null ? (alive * 100) / init : null;
      return [i + 1, r.batch, r.crop ?? "—", nf(init), nf(alive), nf(N(r.dead)), nf(N(r.damaged)), surv === null ? "—" : nf(surv, 1), surv === null ? "—" : surv >= 85 ? "Aman" : "Waspada", "—", D(r.insp)];
    }),
    visual: "Kartu KPI (total bibit, survival rata-rata) · sparkline tren survival.",
  };
}

// generic activity query helper
async function activity(ctx: RlsContext, sql: string) {
  return rlsQuery<Record<string, string | null>>(ctx, sql);
}

// 04 Penyiangan ───────────────────────────────────────────────────────────────
export async function weedingReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await activity(ctx, `
    SELECT w.weeded_on::text, b.code AS block, w.method, w.area_ha, w.labor_count, u.full_name AS officer, w.approval_status::text AS st
    FROM app.weeding_records w JOIN app.blocks b ON b.id=w.block_id LEFT JOIN app.users u ON u.id=w.created_by ORDER BY w.weeded_on DESC`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Metode" }, { label: "Luas (ha)", align: "right" },
    { label: "Tenaga kerja (HOK)", align: "right" }, { label: "Biaya per ha", align: "right", kind: "new" }, { label: "Jadwal vs realisasi", kind: "new" }, { label: "Petugas" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Penyiangan (Weeding)", subtitle: "Catatan penyiangan per blok: metode, luas, tenaga kerja.", source: "modul Weeding.", note: "Biaya ter-refleksi saat disetujui. Kosong = \"—\"." }),
    columns,
    rows: rows.map((r, i) => [i + 1, D(r.weeded_on), r.block, r.method ?? "—", nf(N(r.area_ha), 2), nf(N(r.labor_count)), "—", "—", r.officer ?? "—", statusLabelId(r.st ?? "")]),
    visual: "Peta cakupan penyiangan · distribusi metode.",
  };
}

// 05 Pemupukan ────────────────────────────────────────────────────────────────
export async function fertilizingReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await activity(ctx, `
    SELECT b.code AS block, fa.crop_code, fa.growth_phase::text AS phase, ft.name AS ftype, fa.total_quantity, uom.name AS uom,
           fa.applied_on::text, u.full_name AS officer, fa.approval_status::text AS st
    FROM app.fertilizer_applications fa JOIN app.blocks b ON b.id=fa.block_id
    JOIN app.fertilizer_types ft ON ft.id=fa.fertilizer_type_id LEFT JOIN app.master_items uom ON uom.id=fa.uom_item_id
    LEFT JOIN app.users u ON u.id=fa.created_by ORDER BY fa.applied_on DESC`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode Blok" }, { label: "Komoditas" }, { label: "Fase" }, { label: "Jenis pupuk" },
    { label: "Jumlah", align: "right" }, { label: "Satuan" }, { label: "Tanggal" },
    { label: "Dosis rekom.", kind: "new" }, { label: "Selisih dosis", kind: "new" }, { label: "Biaya per ha", align: "right", kind: "new" }, { label: "Petugas" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Pemupukan (Fertilizing)", subtitle: "Rekomendasi + realisasi aplikasi pupuk per blok.", source: "modul Fertilizing.", note: "Tiga pendekatan rekomendasi: uji tanah, analisis jaringan daun, neraca hara." }),
    columns,
    rows: rows.map((r, i) => [i + 1, r.block, r.crop_code ? CROP[r.crop_code] ?? r.crop_code : "—", r.phase ?? "—", r.ftype ?? "—", nf(N(r.total_quantity), 2), r.uom ?? "—", D(r.applied_on), "—", "—", "—", r.officer ?? "—", statusLabelId(r.st ?? "")]),
    visual: "Kalender aplikasi · panel banding rekomendasi vs realisasi.",
  };
}

// 06 Pruning ──────────────────────────────────────────────────────────────────
export async function pruningReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await activity(ctx, `
    SELECT pr.pruned_on::text, b.code AS block, pr.tree_count, pr.note, u.full_name AS officer, pr.approval_status::text AS st
    FROM app.pruning_records pr JOIN app.blocks b ON b.id=pr.block_id LEFT JOIN app.users u ON u.id=pr.created_by ORDER BY pr.pruned_on DESC`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Jumlah pohon", align: "right" },
    { label: "Cakupan per blok", kind: "new" }, { label: "HOK / biaya", align: "right", kind: "new" }, { label: "Detail" }, { label: "Petugas" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Pruning (Pemangkasan)", subtitle: "Log kegiatan pemangkasan rutin per blok.", source: "modul Pruning.", note: "Jumlah pohon jadi dasar biaya tenaga kerja." }),
    columns,
    rows: rows.map((r, i) => [i + 1, D(r.pruned_on), r.block, nf(N(r.tree_count)), "—", "—", r.note ?? "—", r.officer ?? "—", statusLabelId(r.st ?? "")]),
    visual: "Distribusi cakupan per blok.",
  };
}

// 07 Penyemprotan ─────────────────────────────────────────────────────────────
export async function sprayingReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await activity(ctx, `
    SELECT s.sprayed_on::text, b.code AS block, ch.name AS material, s.target, s.dose_per_ha, s.total_volume, s.unit,
           u.full_name AS officer, s.approval_status::text AS st
    FROM app.spraying_records s JOIN app.blocks b ON b.id=s.block_id LEFT JOIN app.agri_input_chemicals ch ON ch.id=s.chemical_id
    LEFT JOIN app.users u ON u.id=s.created_by ORDER BY s.sprayed_on DESC`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Material" }, { label: "Target/OPT" },
    { label: "Dosis/ha", align: "right" }, { label: "Volume", align: "right" }, { label: "Satuan" },
    { label: "Interval aman/PHI", kind: "new" }, { label: "Biaya", align: "right", kind: "new" }, { label: "Petugas" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Penyemprotan (Spraying)", subtitle: "Material dari Agri-Input, target, dosis, volume.", source: "modul Spraying.", note: "Material dari katalog Agri-Input; metode bisa manual/drone/outsource." }),
    columns,
    rows: rows.map((r, i) => [i + 1, D(r.sprayed_on), r.block, r.material ?? "—", r.target ?? "—", nf(N(r.dose_per_ha), 2), nf(N(r.total_volume), 2), r.unit ?? "—", "—", "—", r.officer ?? "—", statusLabelId(r.st ?? "")]),
    visual: "Tren OPT/target · konsumsi material vs stok.",
  };
}

// 08 Panen ────────────────────────────────────────────────────────────────────
export async function harvestReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await activity(ctx, `
    SELECT h.harvested_on::text, b.code AS block, h.crop_code, h.quantity_ton, h.grade, u.full_name AS officer, h.approval_status::text AS st
    FROM app.harvest_records h JOIN app.blocks b ON b.id=h.block_id LEFT JOIN app.users u ON u.id=h.created_by ORDER BY h.harvested_on DESC`);
  const rate = await rlsQuery<{ code: string; rate: string }>(ctx, `SELECT code, rate_idr AS rate FROM app.price_list WHERE kind='revenue'`);
  const rateFor = (crop: string | null) => {
    const code = crop === "DURIAN" ? "REV-DUR-A" : "REV-COCO";
    const row = rate.find((x) => x.code === code);
    return row ? Number(row.rate) : null;
  };
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Komoditas" },
    { label: "Tonase (ton)", align: "right" }, { label: "Grade" }, { label: "Tarif (Rp/ton)", align: "right", kind: "new" },
    { label: "Revenue (Rp)", align: "right", kind: "new" }, { label: "Petugas" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Panen (Harvesting)", subtitle: "Panen per blok & komoditas; sumber revenue & traceability.", source: "modul Harvesting → Accounting & Traceability.", note: "Revenue = tonase × tarif price list per komoditas. Panen disetujui = titik awal Traceability." }),
    columns,
    rows: rows.map((r, i) => {
      const ton = N(r.quantity_ton); const rt = rateFor(r.crop_code);
      const rev = ton !== null && rt !== null && r.st === "approved" ? ton * rt : null;
      return [i + 1, D(r.harvested_on), r.block, r.crop_code ? CROP[r.crop_code] ?? r.crop_code : "—", nf(ton, 3), r.grade ?? "—", rt === null ? "—" : nf(rt), rev === null ? "—" : nf(rev), r.officer ?? "—", statusLabelId(r.st ?? "")];
    }),
    visual: "Komposisi grade (donut) · yield per ha per komoditas.",
  };
}

// 09 Agri-Input Chemical ──────────────────────────────────────────────────────
export async function chemicalReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT code, name, category, is_organic::text, unit, stock_qty, reorder_level, rec_phase
    FROM app.v_agri_input_stock WHERE is_active ORDER BY name`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode" }, { label: "Nama" }, { label: "Jenis" }, { label: "Organik?" },
    { label: "Stok", align: "right" }, { label: "Stok minimum", align: "right" }, { label: "Reorder alert", kind: "new" }, { label: "Satuan" }, { label: "Rekomendasi fase" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Katalog & Stok Chemical", subtitle: "Katalog pupuk/pestisida organik & sintetik: stok + rekomendasi fase.", source: "modul Agri-Input / Chemical.", note: "Dua jalur input: organik & sintetik." }),
    columns,
    rows: rows.map((r, i) => {
      const stock = N(r.stock_qty); const reorder = N(r.reorder_level);
      const alert = stock !== null && reorder !== null ? (stock <= reorder ? "Perlu reorder" : "Aman") : "—";
      return [i + 1, r.code, r.name, r.category, r.is_organic === "true" ? "Ya" : "Tidak", nf(stock), nf(reorder), alert, r.unit ?? "—", r.rec_phase ?? "—"];
    }),
    visual: "Bar level stok & reorder alert · tren konsumsi vs stok.",
  };
}

// 10 Agri-Input Equipment ─────────────────────────────────────────────────────
export async function equipmentReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT code, name, category, purchase_price_idr, usage_freq, fuel_type, fuel_per_hour, note
    FROM app.agri_input_equipment ORDER BY name`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode" }, { label: "Nama aset" }, { label: "Kategori" }, { label: "Harga beli (Rp)", align: "right" },
    { label: "Frekuensi pakai" }, { label: "Jenis BBM" }, { label: "Konsumsi/jam", align: "right" }, { label: "Biaya energi", align: "right", kind: "new" }, { label: "Kepemilikan/outsource", kind: "new" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Katalog Equipment", subtitle: "Alat, kendaraan & drone: harga beli, frekuensi, konsumsi BBM/listrik.", source: "modul Agri-Input / Equipment.", note: "Harga & konsumsi jadi dasar biaya operasi." }),
    columns,
    rows: rows.map((r, i) => [i + 1, r.code, r.name, r.category, nf(N(r.purchase_price_idr)), r.usage_freq ?? "—", r.fuel_type ?? "—", nf(N(r.fuel_per_hour), 2), "—", r.note ?? "—"]),
    visual: "—",
  };
}

// 11 Carbon Accounting ────────────────────────────────────────────────────────
export async function carbonReport(ctx: RlsContext): Promise<ModuleReport> {
  const blocks = await import("@/lib/repo/sustainability").then((m) => m.carbonByBlock(ctx));
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode Blok" }, { label: "Luas (ha)", align: "right" },
    { label: "Emisi bruto (tCO₂e)", align: "right" }, { label: "Penyerapan (tCO₂e)", align: "right" }, { label: "Neraca (tCO₂e)", align: "right" },
    { label: "Sumber emisi dominan", kind: "new" }, { label: "Status validasi faktor", kind: "new" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Carbon Accounting (Karbon)", subtitle: "Emisi & penyerapan per blok dari luas & DBH (IPCC Tier 1).", source: "modul Carbon Accounting.", note: "Faktor emisi masih perlu validasi lokal (EF-LANDCLEAR dll)." }),
    columns,
    rows: blocks.map((b, i) => [i + 1, b.blockCode, nf(b.areaHa, 2), nf(b.emissionTco2e, 2), nf(b.sequestrationTco2e, 2), nf(b.netTco2e, 2), "Land clearing", "Perlu validasi lokal", (b.netTco2e ?? 0) >= 0 ? "Net Sink" : "Net Emitter"]),
    visual: "Waterfall neraca karbon · heatmap karbon per blok.",
  };
}

// 12 Blok & Peta ──────────────────────────────────────────────────────────────
export async function blocksReport(ctx: RlsContext): Promise<ModuleReport> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT b.code, b.name, e.name AS estate, b.area_ha, b.planting_year,
           (b.geom IS NOT NULL)::text AS has_geom, b.verification_status::text AS st
    FROM app.blocks b LEFT JOIN app.estates e ON e.id=b.estate_id WHERE b.archived_at IS NULL ORDER BY b.code`);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Kode" }, { label: "Nama" }, { label: "Estate/Entitas" }, { label: "Luas (ha)", align: "right" },
    { label: "Tahun tanam", align: "right" }, { label: "Polygon" }, { label: "Populasi (pohon/ha)", align: "right", kind: "new" }, { label: "Kelengkapan data", kind: "new" }, { label: "Status verifikasi" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Blok & Peta (Blocks & Map)", subtitle: "Data fondasi. Setiap biaya, survei, pemupukan mereferensi blok di sini.", source: "modul Blocks & Map.", note: "Basemap Sentinel-2 & OSM. Luas dari PostGIS." }),
    columns,
    rows: rows.map((r, i) => [i + 1, r.code, r.name ?? "—", r.estate ?? "—", nf(N(r.area_ha), 2), r.planting_year ?? "—", r.has_geom === "true" ? "Ada" : "—", "—", "—", r.st ?? "—"]),
    visual: "Scorecard blok saat klik-baris (parameter interpolasi tanah, hara daun, kesesuaian).",
  };
}

// 14 Anggaran ─────────────────────────────────────────────────────────────────
export async function budgetReport(ctx: RlsContext): Promise<ModuleReport> {
  const { budgetVsActual } = await import("@/lib/repo/costing");
  const b = await budgetVsActual(ctx);
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Periode" }, { label: "Kategori biaya" }, { label: "Lingkup" },
    { label: "Anggaran (Rp)", align: "right" }, { label: "Realisasi (Rp)", align: "right" }, { label: "Selisih (Rp)", align: "right" }, { label: "% Serap", align: "right" },
    { label: "Burn rate", kind: "new" }, { label: "Forecast sisa", kind: "new" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Anggaran (Budget)", subtitle: "Per fase & kategori; realisasi dibandingkan otomatis.", source: "modul Costing/Anggaran vs Pengeluaran disetujui.", note: "Realisasi dihitung pada tingkat lingkup masing-masing." }),
    columns,
    rows: b.map((x, i) => [i + 1, x.periodName, x.costCategoryName, x.scopeType, nf(x.budgetIdr), nf(x.actualIdr), nf(x.remainingIdr), x.utilisationPct === null ? "—" : nf(x.utilisationPct, 1), "—", "—", x.isOverBudget ? "Terlampaui" : "Dalam anggaran"]),
    visual: "Gauge realisasi per fase · heatmap varians.",
  };
}

// 15 Approval Inbox ───────────────────────────────────────────────────────────
export async function approvalReport(ctx: RlsContext): Promise<ModuleReport> {
  const { listAllPending } = await import("@/lib/repo/costing");
  const p = await listAllPending(ctx, { page: 1, pageSize: 100 });
  const columns: ModuleColumn[] = [
    { label: "No", align: "right" }, { label: "Tgl ajuan" }, { label: "Modul asal" }, { label: "Kode Blok" }, { label: "Detail" },
    { label: "Nilai refleksi (Rp)", align: "right" }, { label: "Umur antrean (SLA)", kind: "new" }, { label: "Pengaju" }, { label: "Status" },
  ];
  return {
    meta: await meta(ctx, { title: "Laporan Approval Inbox", subtitle: "Item menunggu keputusan lintas modul; approval mengubah angka laporan.", source: "modul Approval.", note: "Nilai = rupiah ter-refleksi. Penolakan wajib alasan (maker-checker)." }),
    columns,
    rows: p.rows.map((r, i) => [i + 1, r.eventDate ?? "—", r.moduleLabel, r.blockCode ?? "—", r.detail ?? "—", r.amountIdr === null ? "—" : nf(r.amountIdr), "—", r.actorName ?? "—", statusLabelId(r.approvalStatus)]),
    visual: "Distribusi antrean per modul/approver · aksi massal.",
  };
}
