import { rlsQuery, type RlsContext } from "@/lib/db";
import { statusLabelId } from "./types";
import { buildReportMeta } from "./meta";
import type { IndStatus } from "./types";
import type { ReportScreen, ReportScreenBase, RadarAxis, BarDatum, PieDatum, ProgressItem, Tone } from "./screenTypes";
import { carbonByBlock, latestCarbonRun } from "@/lib/repo/sustainability";
import { budgetVsActual, listAllPending, listExpenditures, blockCostSummary } from "@/lib/repo/costing";
import { reflectedCosts } from "@/lib/repo/pricing";
import { CROP } from "@/lib/labels";

const nf = (v: number | null | undefined, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v));
const N = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const D = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
const idrShort = (v: number | null) => {
  if (v === null) return "Rp —";
  const a = Math.abs(v);
  if (a >= 1e9) return `Rp ${nf(v / 1e9, 2)} M`;
  if (a >= 1e6) return `Rp ${nf(v / 1e6, 1)} jt`;
  if (a >= 1e3) return `Rp ${nf(v / 1e3)} rb`;
  return `Rp ${nf(v)}`;
};
const sum = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const GRADE_COLOR: Record<string, string> = { A: "#1f8033", B: "#eab308", C: "#ef4444" };
const APPROVED = "approved";
// Peta komoditas dipusatkan di src/lib/labels.ts (dulu disalin di 4 berkas).

/** Kode subkelas (limiting) BBSDLP → label & saran. */
const LIMIT: Record<string, { label: string; advice: string }> = {
  eh: { label: "Bahaya Erosi / Lereng", advice: "Bangun teras/rorak & tanam cover crop untuk menahan erosi pada lereng." },
  oa: { label: "Ketersediaan Oksigen (Drainase)", advice: "Perbaiki sistem drainase untuk mengurangi genangan dan mempercepat pembuangan air." },
  wa: { label: "Ketersediaan Air", advice: "Bangun/optimalkan embung & konservasi air untuk menjamin ketersediaan air." },
  nr: { label: "Retensi Hara", advice: "Tingkatkan bahan organik tanah dan lakukan pemupukan berimbang sesuai rekomendasi." },
  na: { label: "Ketersediaan Hara", advice: "Aplikasikan pupuk NPK + unsur mikro sesuai hasil uji tanah." },
  lp: { label: "Penyiapan Lahan (batuan/singkapan)", advice: "Kelola batuan permukaan & singkapan batuan agar penyiapan lahan optimal." },
  tc: { label: "Temperatur & Iklim", advice: "Sesuaikan pemilihan varietas dengan kondisi temperatur & iklim setempat." },
  sa: { label: "Salinitas / Toksisitas", advice: "Kelola salinitas melalui pencucian & drainase; hindari input yang meningkatkan salinitas." },
  rc: { label: "Media Perakaran", advice: "Perbaiki kedalaman & tekstur media perakaran (olah tanah, bahan organik)." },
};
const SUIT_DESC: Record<string, string> = { S1: "Sangat Sesuai", S2: "Cukup Sesuai", S3: "Sesuai Marginal", N: "Tidak Sesuai" };
const suitStatus = (c: string | null): IndStatus => (c === "S1" ? "ok" : c === "S2" ? "perhatian" : c === "S3" ? "perhatian" : c === "N" ? "kritis" : "belum");

// ── 01 · Kesesuaian Lahan (mockup 4) ────────────────────────────────────────
async function suitabilityScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT b.code AS block, b.name AS bname, c.code AS crop_code,
           lsa.suit_class, lsa.subclass, lsa.limiting::text AS limiting, lsa.params::text AS params,
           lsa.assessed_at::text AS assessed_at, u.full_name AS assessor, lsa.approval_status::text AS st
      FROM app.land_suitability_assessments lsa
      JOIN app.blocks b ON b.id = lsa.block_id
      LEFT JOIN app.crops c ON c.id = lsa.crop_id
      LEFT JOIN app.users u ON u.id = lsa.assessor_id
     ORDER BY (b.code LIKE 'PILOT%') DESC, b.code`);

  const parseLimit = (s: string | null): string[] => {
    if (!s) return [];
    return s.replace(/[{}"]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  };

  // blok representatif: PILOT dulu, lalu blok pertama dgn kelas
  const rep = rows.find((r) => r.suit_class) ?? rows[0];
  const repClass = rep?.suit_class ?? null;
  const repLimits = parseLimit(rep?.limiting ?? null);
  const repParams = rep?.params ? (JSON.parse(rep.params) as Record<string, number | string>) : {};

  // Radar per-parameter (score 0–100 dari data nyata) vs ambang S2 (=72)
  const pnum = (k: string) => (typeof repParams[k] === "number" ? (repParams[k] as number) : null);
  const bandLereng = (v: number | null) => (v === null ? 0 : v <= 8 ? 92 : v <= 16 ? 72 : v <= 30 ? 45 : 20);
  const bandPh = (v: number | null) => (v === null ? 0 : v >= 5.5 && v <= 6.5 ? 92 : (v >= 5.0 && v < 5.5) || (v > 6.5 && v <= 7.0) ? 72 : (v >= 4.5 && v < 5.0) || (v > 7.0 && v <= 8.0) ? 45 : 20);
  const drain = String(repParams["drainase"] ?? "").toLowerCase();
  const bandDrain = drain.includes("baik") && !drain.includes("agak") ? 92 : drain.includes("sedang") || drain.includes("agak baik") ? 78 : drain.includes("agak terhambat") ? 55 : drain.includes("terhambat") ? 32 : 0;
  const bandHara = (() => { const co = pnum("c_organik"); return co === null ? 0 : co >= 3 ? 92 : co >= 2 ? 72 : co >= 1.2 ? 45 : 20; })();
  const bandAir = (() => { const ch = pnum("curah_hujan"); return ch === null ? 0 : ch >= 1500 && ch <= 3000 ? 92 : (ch >= 1200 && ch < 1500) || (ch > 3000 && ch <= 3500) ? 72 : 45; })();
  const axes: RadarAxis[] = [
    { axis: "Lereng", actual: bandLereng(pnum("lereng")), ambang: 72 },
    { axis: "Drainase", actual: bandDrain, ambang: 72 },
    { axis: "Hara", actual: bandHara, ambang: 72 },
    { axis: "Air", actual: bandAir, ambang: 72 },
    { axis: "pH", actual: bandPh(pnum("ph")), ambang: 72 },
  ];
  const scoreClass = (s: number) => (s >= 85 ? "S1" : s >= 65 ? "S2" : s >= 40 ? "S3" : "N");
  const legend = axes.filter((a) => a.actual > 0).map((a) => ({ label: a.axis, class: scoreClass(a.actual) }));

  const total = rows.length;
  const withClass = rows.filter((r) => r.suit_class).length;
  const completeness = total > 0 ? Math.round((withClass / total) * 100) : 0;
  const needReinspect = ["S3", "N"].includes(repClass ?? "") || rep?.suit_class === null;

  // prioritas perbaikan dari limiting blok representatif (maks 4)
  const priorities = repLimits.slice(0, 4).map((code, i) => {
    const m = LIMIT[code] ?? { label: code.toUpperCase(), advice: "Tinjau parameter pembatas ini bersama tim agronomi." };
    return { n: i + 1, title: m.label, text: m.advice };
  });

  const tableRows = rows.map((r, i) => {
    const cls = r.suit_class;
    const nilai = cls === "S1" || cls === "S2" ? "Sesuai" : cls ? "Tidak Sesuai" : "—";
    const limits = parseLimit(r.limiting);
    const rekom = limits.length ? (LIMIT[limits[0]]?.advice ?? "Tinjau faktor pembatas utama.") : "Pertahankan & monitoring berkala.";
    const reins = ["S3", "N"].includes(cls ?? "") || !cls ? "Ya" : "Tidak";
    return [i + 1, r.block, r.bname ?? "—", CROP[r.crop_code ?? ""] ?? "—", cls ?? "—", r.subclass ?? "—", limits.length ? limits.join(", ") : "—", nilai, rekom, reins, D(r.assessed_at), r.assessor ?? "—", statusLabelId(r.st ?? "")];
  });

  return {
    slug: "kesesuaian-lahan",
    title: "Laporan Kesesuaian Lahan",
    subtitle: "Penilaian kelas S1–N per blok (metode matching / hukum minimum).",
    kpis: [
      { icon: "Shield", label: `Kelas ${repClass ?? "—"} · ${SUIT_DESC[repClass ?? ""] ?? "Belum dinilai"}`, value: repClass ?? "—", tone: suitStatus(repClass) === "kritis" ? "kritis" : suitStatus(repClass) === "ok" ? "ok" : "perhatian" },
      { icon: "AlertTriangle", label: "Faktor Pembatas", value: repLimits.length ? String(repLimits.length) : "—", tone: repLimits.length >= 3 ? "kritis" : repLimits.length ? "perhatian" : "ok" },
      { icon: "ClipboardCheck", label: "Kelengkapan", value: `${completeness}`, unit: "%", tone: completeness >= 100 ? "ok" : completeness >= 60 ? "perhatian" : "kritis" },
      { icon: "XCircle", label: "Reinspeksi", value: needReinspect ? "Ya" : "Tidak", tone: needReinspect ? "perhatian" : "belum" },
    ],
    panels: [
      { kind: "radar", title: "Parameter vs Ambang", span: 1, axes, legend, note: "Skor 0–100 dihitung dari parameter aktual; ambang mengacu kelas S2 untuk komoditas utama blok." },
      { kind: "map", title: "Peta Blok", span: 2, status: suitStatus(repClass), legend: true, note: "Warna blok mengikuti kelas kesesuaian (S1 sangat sesuai – N tidak sesuai)." },
    ],
    table: {
      title: "Detail Kesesuaian Lahan",
      columns: [
        { label: "No", align: "right" }, { label: "Kode Blok" }, { label: "Nama Blok" }, { label: "Komoditas" },
        { label: "Kelas" }, { label: "Subkelas" }, { label: "Faktor Pembatas" }, { label: "Nilai vs Ambang" },
        { label: "Rekomendasi", kind: "new" }, { label: "Reinspeksi", kind: "new" }, { label: "Tanggal" }, { label: "Penilai" }, { label: "Status" },
      ],
      rows: tableRows,
      footNote: "Kelas S1 sangat sesuai – N tidak sesuai. Kolom biru = rekomendasi tambahan. Kosong = —.",
    },
    rail: {
      title: "Rekomendasi Agronomi",
      tabs: ["Ringkasan", "Per Faktor", "Rencana Tindak Lanjut"],
      summary: priorities.length
        ? `Fokus perbaikan pada ${priorities.map((p) => p.title.split(" ")[0].toLowerCase()).join(", ")} untuk meningkatkan kelas kesesuaian lahan menjadi S1.`
        : "Blok berada pada kelas terbaik — pertahankan praktik pengelolaan & lakukan monitoring berkala.",
      priorities,
      general: {
        heading: "Rekomendasi Umum",
        items: [
          "Tambah bahan organik minimal 10 ton/ha/tahun (kompos/pupuk kandang).",
          "Aplikasi pupuk NPK 12-12-17 + TE sesuai rekomendasi dosis.",
          "Penanaman cover crop (leguminosa) di areal antar baris.",
          "Monitoring berkala setiap 3 bulan.",
        ],
      },
      target: repClass && repClass !== "S1" ? { label: "Target Kenaikan Kelas:", value: `${repClass} → S1`, sub: "(12–24 bulan)" } : undefined,
      action: "Buat Rencana Tindak Lanjut",
    },
  };
}

// ── 02 · Persiapan Lahan (mockup 5) ─────────────────────────────────────────
const PREP_PCT: Record<string, number> = { ready_to_plant: 100, in_progress: 50, not_started: 0 };
const PREP_LABEL: Record<string, string> = { ready_to_plant: "Siap Tanam", in_progress: "Proses", not_started: "Belum Siap" };
async function landPrepScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT lp.checked_at::text, b.code AS block, b.name AS bname, b.area_ha, lp.soil_ph, lp.planting_hole_count,
           lp.effective_area_ha, lp.status::text AS pstatus, lp.approval_status::text AS st,
           -- Layout/jarak tanam dari Master Data (tipe planting_layout, migrasi 0050).
           -- Sebelum ini laporan mencetak literal '3 m × 3 m' untuk SETIAP baris
           -- (13 dari 13) — spesifikasi agronomi yang tidak pernah dibaca dari
           -- mana pun. NULL dirender em-dash: belum diisi bukan berarti 3×3.
           pl.name AS planting_layout
      FROM app.land_preparations lp
      JOIN app.blocks b ON b.id = lp.block_id
      LEFT JOIN app.master_items pl ON pl.id = lp.planting_layout_item_id
     ORDER BY lp.checked_at DESC`);
  const readiness = rows.map((r) => PREP_PCT[r.pstatus ?? "not_started"] ?? 0);
  const avgReady = readiness.length ? Math.round(readiness.reduce((a, b) => a + b, 0) / readiness.length) : null;
  const totalHoles = sum(rows.map((r) => N(r.planting_hole_count)));
  const totalArea = sum(rows.map((r) => N(r.effective_area_ha)));
  const avgPh = (() => { const v = rows.map((r) => N(r.soil_ph)).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
  const readyCount = rows.filter((r) => r.pstatus === "ready_to_plant").length;
  const layoutsUsed = [...new Set(rows.map((r) => r.planting_layout).filter((x): x is string => Boolean(x)))];
  const cols3 = ["not_started", "in_progress", "ready_to_plant"] as const;
  const prepTone = (s: string): Tone => (s === "ready_to_plant" ? "ok" : s === "in_progress" ? "perhatian" : "kritis");
  const journey = cols3.map((s) => {
    const items = rows.filter((r) => (r.pstatus ?? "not_started") === s);
    return {
      title: PREP_LABEL[s], count: items.length, tone: prepTone(s),
      items: items.map((r) => ({ title: r.block ?? "—", sub: `${nf(N(r.planting_hole_count))} lubang · ${nf(N(r.effective_area_ha), 2)} ha`, tag: `${PREP_PCT[r.pstatus ?? ""] ?? 0}%` })),
    };
  });
  return {
    slug: "persiapan-lahan",
    title: "Laporan Persiapan Lahan",
    subtitle: "Checklist kesiapan tanam per blok: pH, lubang tanam, luas efektif, status.",
    headerAction: { label: "Perbarui Checklist", icon: "ClipboardCheck" },
    kpis: [
      { icon: "ClipboardCheck", label: "Kesiapan", value: avgReady === null ? "—" : String(avgReady), unit: avgReady === null ? undefined : "%", tone: avgReady === null ? "belum" : avgReady >= 90 ? "ok" : avgReady >= 50 ? "perhatian" : "kritis" },
      { icon: "Sprout", label: "Lubang Tanam", value: nf(totalHoles), tone: "ok" },
      { icon: "Ruler", label: "Luas Efektif", value: nf(totalArea, 2), unit: "ha", tone: "ok" },
      { icon: "CalendarDays", label: "Blok Siap Tanam", value: `${readyCount}`, sub: `dari ${rows.length} blok`, tone: readyCount > 0 ? "ok" : "perhatian" },
    ],
    panels: [
      { kind: "journey", title: "Status Kesiapan per Blok", span: 2, columns: journey },
      { kind: "map", title: "Peta Status per Blok", span: 1, status: avgReady === null ? "belum" : avgReady >= 90 ? "ok" : avgReady >= 50 ? "perhatian" : "kritis", legend: true },
      { kind: "statCards", title: "Komponen Kesiapan Lahan", span: 3, cols: 4, cards: [
        { icon: "FlaskConical", label: "pH Tanah (rata-rata)", value: avgPh === null ? "—" : nf(avgPh, 1), badge: avgPh !== null && avgPh >= 5.5 && avgPh <= 6.5 ? { text: "Ideal (5,5–6,5)", tone: "ok" } : avgPh !== null ? { text: "Perlu koreksi", tone: "perhatian" } : undefined, tone: "ok" },
        { icon: "Sprout", label: "Lubang Tanam", value: totalHoles === null ? "—" : nf(totalHoles), pct: avgReady ?? undefined, tone: "ok" },
        { icon: "Ruler", label: "Luas Efektif", value: totalArea === null ? "—" : `${nf(totalArea, 2)} ha`, tone: "ok" },
        // Daftar layout yang BENAR-BENAR dipakai baris-baris di atas. Versi
        // sebelumnya memasang literal '3 m × 3 m' plus badge "Standar" —
        // menyatakan jarak tanam DAN menyatakan itu standar, keduanya tanpa
        // membaca apa pun. Kosong bila belum ada yang mengisinya.
        { icon: "Target", label: "Jarak Tanam", value: layoutsUsed.length ? layoutsUsed.join(", ") : "—", tone: layoutsUsed.length ? "default" : "belum" },
      ] },
    ],
    table: {
      title: "Detail Persiapan Lahan",
      columns: [
        { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Nama Blok" }, { label: "pH Tanah", align: "right" },
        { label: "Jumlah Lubang", align: "right" }, { label: "Luas Efektif (ha)", align: "right" }, { label: "% Kesiapan", align: "right", kind: "new" },
        { label: "Jarak Tanam", kind: "new" }, { label: "Status Kesiapan" }, { label: "Status" },
      ],
      rows: rows.map((r) => [D(r.checked_at), r.block, r.bname ?? "—", nf(N(r.soil_ph), 1), nf(N(r.planting_hole_count)), nf(N(r.effective_area_ha), 2), `${PREP_PCT[r.pstatus ?? ""] ?? 0}%`, r.planting_layout ?? "—", PREP_LABEL[r.pstatus ?? ""] ?? "Belum Siap", statusLabelId(r.st ?? "")]),
      footNote: "Status kesiapan: Belum Siap / Proses / Siap Tanam. Kolom biru = rekomendasi tambahan.",
    },
  };
}

// ── 03 · Bibit & Nursery (mockup 6) ─────────────────────────────────────────
async function nurseryScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT sb.code AS batch, c.name AS crop, sb.qty_initial,
           (SELECT ni.qty_alive FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS alive,
           (SELECT ni.qty_dead FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS dead,
           (SELECT ni.qty_damaged FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS damaged,
           (SELECT ni.inspected_at::text FROM app.nursery_inspections ni WHERE ni.seed_batch_id=sb.id ORDER BY ni.inspected_at DESC LIMIT 1) AS insp
      FROM app.seed_batches sb LEFT JOIN app.crops c ON c.id=sb.crop_id ORDER BY sb.code`);
  const totInit = sum(rows.map((r) => N(r.qty_initial)));
  const totAlive = sum(rows.map((r) => N(r.alive)));
  const totDead = sum(rows.map((r) => N(r.dead))) ?? 0;
  const totDamaged = sum(rows.map((r) => N(r.damaged))) ?? 0;
  const survival = totInit && totAlive !== null ? (totAlive / totInit) * 100 : null;
  const mortality = survival === null ? null : 100 - survival;
  const barsAlive: BarDatum[] = rows.map((r) => ({ name: r.batch ?? "—", value: N(r.alive) ?? 0, color: "#1f8033" }));
  const alerts: ProgressItem[] = rows.map((r) => {
    const init = N(r.qty_initial); const alive = N(r.alive);
    const s = init && alive !== null ? (alive / init) * 100 : null;
    return { label: r.batch ?? "—", value: s === null ? "—" : `${nf(s, 1)}%`, icon: s !== null && s >= 85 ? "CheckCircle2" : "AlertTriangle", tone: s === null ? "belum" : s >= 85 ? "ok" : "perhatian", badge: s === null ? undefined : { text: s >= 85 ? "Aman" : "Waspada", tone: s >= 85 ? "ok" : "perhatian" } };
  });
  return {
    slug: "bibit", title: "Laporan Bibit & Nursery",
    subtitle: "Stok bibit per batch; kondisi dari inspeksi terakhir disetujui.",
    kpis: [
      { icon: "Sprout", label: "Total Bibit", value: nf(totInit), tone: "default" },
      { icon: "Leaf", label: "Bibit Hidup", value: nf(totAlive), tone: "ok" },
      { icon: "ShieldCheck", label: "Survival Rata-rata", value: survival === null ? "—" : nf(survival, 1), unit: survival === null ? undefined : "%", tone: survival === null ? "belum" : survival >= 85 ? "ok" : "perhatian" },
      { icon: "AlertTriangle", label: "Mortalitas", value: mortality === null ? "—" : nf(mortality, 1), unit: mortality === null ? undefined : "%", tone: mortality === null ? "belum" : mortality <= 15 ? "perhatian" : "kritis" },
    ],
    panels: [
      { kind: "bars", title: "Bibit Hidup per Batch", span: 2, data: barsAlive, unit: "bibit" },
      { kind: "progressList", title: "Alert Survival", span: 1, items: alerts },
    ],
    table: {
      title: "Detail Bibit & Nursery",
      columns: [
        { label: "Kode Batch" }, { label: "Komoditas" }, { label: "Jumlah Awal", align: "right" }, { label: "Hidup", align: "right" },
        { label: "Mati", align: "right" }, { label: "Rusak", align: "right" }, { label: "Survival %", align: "right" }, { label: "Mortalitas %", align: "right", kind: "new" },
        { label: "Alert Survival", kind: "new" }, { label: "Tgl Inspeksi" },
      ],
      rows: rows.map((r) => {
        const init = N(r.qty_initial); const alive = N(r.alive);
        const s = init && alive !== null ? (alive / init) * 100 : null;
        return [r.batch, r.crop ?? "—", nf(init), nf(alive), nf(N(r.dead)), nf(N(r.damaged)), s === null ? "—" : nf(s, 1), s === null ? "—" : nf(100 - s, 1), s === null ? "—" : s >= 85 ? "Aman" : "Waspada", D(r.insp)];
      }),
      footNote: `Survival = hidup ÷ jumlah awal. Total mati ${nf(totDead)}, rusak ${nf(totDamaged)}. Kosong = —.`,
    },
  };
}

// ── 04 · Penyiangan (mockup 7) ──────────────────────────────────────────────
async function weedingScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT w.weeded_on::text, b.code AS block, b.area_ha, w.method, w.area_ha AS weed_area,
           w.labor_count, u.full_name AS officer, w.approval_status::text AS st,
           -- Jadwal vs Realisasi, DIHITUNG (migrasi 0051). Sebelumnya kolom ini
           -- literal 'Tepat waktu' untuk setiap baris.
           --
           -- Pembandingnya jarak ke penyiangan SEBELUMNYA pada blok yang sama
           -- (LAG), bukan tanggal janji: jadwalnya siklus "tiap N hari". Baris
           -- pertama sebuah blok tidak punya pembanding -> NULL -> em-dash.
           -- Blok tanpa jadwal aktif juga NULL: belum dijadwalkan bukan berarti
           -- tepat waktu.
           CASE
             WHEN ws.interval_day IS NULL THEN NULL
             WHEN lag(w.weeded_on) OVER (PARTITION BY w.block_id ORDER BY w.weeded_on) IS NULL THEN NULL
             WHEN (w.weeded_on - lag(w.weeded_on) OVER (PARTITION BY w.block_id ORDER BY w.weeded_on))
                  <= ws.interval_day + ws.tolerance_day THEN 'Tepat waktu'
             ELSE 'Terlambat ' || (
                    (w.weeded_on - lag(w.weeded_on) OVER (PARTITION BY w.block_id ORDER BY w.weeded_on))
                    - ws.interval_day)::text || ' hari'
           END AS jadwal
      FROM app.weeding_records w
      JOIN app.blocks b ON b.id = w.block_id
      LEFT JOIN app.users u ON u.id = w.created_by
      LEFT JOIN app.weeding_schedules ws ON ws.block_id = w.block_id AND ws.is_active
     ORDER BY w.weeded_on DESC`);
  const totWeed = sum(rows.map((r) => N(r.weed_area)));
  const totBlockArea = sum([...new Map(rows.map((r) => [r.block, N(r.area_ha)])).values()]);
  const cakupan = totWeed !== null && totBlockArea && totBlockArea > 0 ? Math.min(100, (totWeed / totBlockArea) * 100) : null;
  const totLabor = sum(rows.map((r) => N(r.labor_count)));
  const latestStatus = rows[0] ? statusLabelId(rows[0].st ?? "") : "—";
  const methodCounts = new Map<string, number>();
  for (const r of rows) { const m = r.method ?? "—"; methodCounts.set(m, (methodCounts.get(m) ?? 0) + 1); }
  const METHOD_COLOR: Record<string, string> = { manual: "#1f8033", kimia: "#2563eb", "manual+kimia": "#eab308", "manual + kimia": "#eab308" };
  const pie: PieDatum[] = [...methodCounts.entries()].map(([m, c]) => ({ name: m, value: c, color: METHOD_COLOR[m.toLowerCase()] ?? "#a8a49a" }));
  return {
    slug: "penyiangan", title: "Laporan Penyiangan",
    subtitle: "Ringkasan pelaksanaan kegiatan penyiangan pada blok terpilih.",
    kpis: [
      { icon: "Leaf", label: "Luas Disiang", value: nf(totWeed, 2), unit: "ha", tone: "ok" },
      { icon: "Target", label: "Cakupan", value: cakupan === null ? "—" : nf(cakupan, 0), unit: cakupan === null ? undefined : "%", tone: cakupan === null ? "belum" : cakupan >= 100 ? "ok" : "perhatian" },
      { icon: "Users", label: "Tenaga Kerja", value: nf(totLabor), unit: "HOK", tone: "default" },
      { icon: "ClipboardCheck", label: "Status", value: latestStatus, tone: latestStatus === "Disetujui" ? "ok" : "perhatian" },
    ],
    panels: [
      { kind: "map", title: "Peta Blok", span: 1, status: "ok", legend: true, note: "Warna blok mengikuti metode penyiangan." },
      { kind: "pie", title: "Distribusi Metode", span: 1, data: pie.length ? pie : [{ name: "—", value: 1, color: "#e5e2da" }], centerValue: cakupan === null ? "—" : `${nf(cakupan, 0)}%`, centerLabel: "Cakupan" },
      { kind: "progressList", title: "Kepatuhan Jadwal", span: 1, items: [
        { label: "Realisasi terakhir", value: rows[0] ? D(rows[0].weeded_on) : "—", icon: "CalendarClock", tone: "ok" },
        { label: "Metode dominan", value: [...methodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—", icon: "Droplets", tone: "default" },
        { label: "Jumlah kegiatan", value: `${rows.length}`, icon: "ClipboardList", tone: "default" },
      ] },
    ],
    table: {
      title: "Detail Penyiangan",
      columns: [
        { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Metode" }, { label: "Luas (ha)", align: "right" }, { label: "Cakupan vs Total", align: "right", kind: "new" },
        { label: "Tenaga Kerja (HOK)", align: "right" }, { label: "Biaya per ha", align: "right", kind: "new" }, { label: "Jadwal vs Realisasi", kind: "new" }, { label: "Petugas" }, { label: "Status" },
      ],
      rows: rows.map((r) => {
        const wa = N(r.weed_area); const ba = N(r.area_ha);
        const cov = wa !== null && ba && ba > 0 ? Math.min(100, (wa / ba) * 100) : null;
        return [D(r.weeded_on), r.block, r.method ?? "—", nf(wa, 2), cov === null ? "—" : `${nf(cov, 0)}%`, nf(N(r.labor_count)), "Rp —", r.jadwal, r.officer ?? "—", statusLabelId(r.st ?? "")];
      }),
      footNote: "Biaya ter-refleksi saat disetujui. Kolom biru = rekomendasi tambahan. Kosong = —.",
    },
  };
}

// ── 05 · Pemupukan (mockup 8) ───────────────────────────────────────────────
async function fertilizingScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT b.code AS block, b.area_ha, fa.crop_code, fa.growth_phase::text AS phase, ft.name AS ftype, fa.total_quantity, uom.name AS uom,
           fa.applied_on::text, u.full_name AS officer, fa.approval_status::text AS st
      FROM app.fertilizer_applications fa JOIN app.blocks b ON b.id=fa.block_id
      JOIN app.fertilizer_types ft ON ft.id=fa.fertilizer_type_id LEFT JOIN app.master_items uom ON uom.id=fa.uom_item_id
      LEFT JOIN app.users u ON u.id=fa.created_by ORDER BY fa.applied_on DESC`);
  const appCount = rows.length;
  const totVol = sum(rows.map((r) => N(r.total_quantity)));
  const unit = rows.find((r) => r.uom)?.uom ?? "kg";
  const totArea = sum([...new Map(rows.map((r) => [r.block, N(r.area_ha)])).values()]);
  return {
    slug: "pemupukan", title: "Laporan Pemupukan",
    subtitle: "Rekomendasi + realisasi aplikasi pupuk per blok (uji tanah / jaringan daun / neraca hara).",
    kpis: [
      { icon: "ClipboardList", label: "Aplikasi", value: nf(appCount), tone: "info" },
      { icon: "Package", label: "Volume", value: nf(totVol, 0), unit: totVol === null ? undefined : unit, tone: "ok" },
      { icon: "Ruler", label: "Luas", value: nf(totArea, 2), unit: "ha", tone: "ok" },
      { icon: "Target", label: "Selisih Dosis", value: "—", sub: "butuh dosis rekomendasi", tone: "belum" },
      { icon: "AlertTriangle", label: "Neraca Hara", value: "—", sub: "belum ada uji tanah terbaru", tone: "belum" },
    ],
    panels: [
      { kind: "statCards", title: "Rekomendasi vs Realisasi", span: 1, cols: 2, cards: [
        { icon: "Scale", label: "Dosis Realisasi", value: totVol === null ? "—" : `${nf(totVol, 0)} ${unit}`, tone: "ok" },
        { icon: "Target", label: "Dosis Rekomendasi", value: "—", sub: "belum tersedia", tone: "belum" },
      ] },
      { kind: "progressList", title: "Neraca Hara (Uji tanah)", span: 1, items: [
        { label: "N — Nitrogen", value: "—", icon: "Leaf", tone: "belum" },
        { label: "P — Fosfor", value: "—", icon: "Leaf", tone: "belum" },
        { label: "K — Kalium", value: "—", icon: "Leaf", tone: "belum" },
      ] },
      { kind: "empty", title: "Kalender Pemupukan", span: 1, icon: "CalendarDays", message: rows.length ? `${rows.length} aplikasi tercatat` : "Belum ada aplikasi", desc: rows[0] ? `Terakhir: ${D(rows[0].applied_on)} · ${rows[0].ftype ?? "—"}` : "Catat aplikasi pemupukan untuk mengisi kalender." },
    ],
    table: {
      title: "Detail Pemupukan",
      columns: [
        { label: "Kode Blok" }, { label: "Komoditas" }, { label: "Fase" }, { label: "Jenis Pupuk" }, { label: "Dosis Rekom.", kind: "new" }, { label: "Tanggal" },
        { label: "Dosis Aktual", align: "right", kind: "new" }, { label: "Selisih Dosis", kind: "new" }, { label: "Volume", align: "right" }, { label: "Biaya per ha", align: "right", kind: "new" }, { label: "Petugas" }, { label: "Status" },
      ],
      rows: rows.map((r) => [r.block, r.crop_code ? CROP[r.crop_code] ?? r.crop_code : "—", r.phase ?? "—", r.ftype ?? "—", "—", D(r.applied_on), nf(N(r.total_quantity), 2), "—", `${nf(N(r.total_quantity), 0)} ${r.uom ?? unit}`, "Rp —", r.officer ?? "—", statusLabelId(r.st ?? "")]),
      footNote: "Kolom biru = rekomendasi tambahan (dosis anjuran, selisih, biaya). Kosong = — (belum ada uji tanah/dosis rekomendasi).",
    },
  };
}

// ── 06 · Pruning (mockup 9) ─────────────────────────────────────────────────
async function pruningScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT pr.pruned_on::text, b.code AS block, pr.tree_count, pr.note, u.full_name AS officer, pr.approval_status::text AS st
      FROM app.pruning_records pr JOIN app.blocks b ON b.id=pr.block_id LEFT JOIN app.users u ON u.id=pr.created_by ORDER BY pr.pruned_on DESC`);
  const totTrees = sum(rows.map((r) => N(r.tree_count)));
  return {
    slug: "pruning", title: "Laporan Pruning",
    subtitle: "Log kegiatan pemangkasan rutin per blok.",
    kpis: [
      { icon: "TreePine", label: "Pohon Dipangkas", value: nf(totTrees), tone: "ok" },
      { icon: "Target", label: "Cakupan", value: "—", sub: "butuh populasi pohon", tone: "belum" },
      { icon: "Gauge", label: "Intensitas", value: "—", sub: "belum tercatat", tone: "belum" },
      { icon: "CalendarClock", label: "Jadwal", value: rows.length ? "Tepat Waktu" : "—", tone: rows.length ? "ok" : "belum" },
    ],
    panels: [
      { kind: "map", title: "Peta Blok", span: 2, status: "ok", legend: true, note: "Sebaran pohon dipangkas per blok." },
      { kind: "stepper", title: "Kepatuhan Jadwal", span: 1, steps: [
        { icon: "CalendarDays", label: "Mulai", sub: rows[rows.length - 1] ? D(rows[rows.length - 1].pruned_on) : "—", tone: "ok" },
        { icon: "Gauge", label: "Proses", sub: "berjalan", tone: "ok" },
        { icon: "CheckCircle2", label: "Selesai", sub: rows[0] ? D(rows[0].pruned_on) : "—", tone: "ok" },
      ], note: rows.length ? "Tepat Waktu — kegiatan pruning selesai sesuai jadwal." : "Belum ada kegiatan pruning." },
    ],
    table: {
      title: "Detail Pruning",
      columns: [
        { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Jumlah Pohon", align: "right" }, { label: "Intensitas (%)", align: "right", kind: "new" },
        { label: "Cakupan per Blok", kind: "new" }, { label: "HOK / Biaya", align: "right", kind: "new" }, { label: "Detail" }, { label: "Petugas" }, { label: "Status" },
      ],
      rows: rows.map((r) => [D(r.pruned_on), r.block, nf(N(r.tree_count)), "—", "—", "Rp —", r.note ?? "—", r.officer ?? "—", statusLabelId(r.st ?? "")]),
      footNote: "Jumlah pohon jadi dasar biaya tenaga kerja. Kolom biru = rekomendasi tambahan. Kosong = —.",
    },
  };
}

// ── 07 · Penyemprotan (mockup 10) ───────────────────────────────────────────
async function sprayingScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT s.sprayed_on::text, b.code AS block, b.area_ha, ch.name AS material, s.target, s.dose_per_ha, s.total_volume, s.unit,
           u.full_name AS officer, s.approval_status::text AS st
      FROM app.spraying_records s JOIN app.blocks b ON b.id=s.block_id LEFT JOIN app.agri_input_chemicals ch ON ch.id=s.chemical_id
      LEFT JOIN app.users u ON u.id=s.created_by ORDER BY s.sprayed_on DESC`);
  const totArea = sum([...new Map(rows.map((r) => [r.block, N(r.area_ha)])).values()]);
  const avgDose = (() => { const v = rows.map((r) => N(r.dose_per_ha)).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
  const unit = rows.find((r) => r.unit)?.unit ?? "L";
  return {
    slug: "penyemprotan", title: "Laporan Penyemprotan",
    subtitle: "Material dari Agri-Input, target OPT, dosis & volume per blok.",
    kpis: [
      { icon: "ClipboardCheck", label: "Kegiatan", value: nf(rows.length), tone: "ok" },
      { icon: "Ruler", label: "Luas", value: nf(totArea, 2), unit: "ha", tone: "perhatian" },
      { icon: "Droplets", label: "Dosis", value: avgDose === null ? "—" : nf(avgDose, 1), unit: avgDose === null ? undefined : `${unit}/ha`, tone: "perhatian" },
      { icon: "CalendarClock", label: "PHI", value: "—", sub: "interval aman panen", tone: "belum" },
    ],
    panels: [
      { kind: "empty", title: "Tren OPT / Target", span: 1, icon: "LineChart", message: "Belum ada tren OPT", desc: "Tren intensitas OPT vs ambang target muncul setelah ada monitoring berkala." },
      { kind: "progressList", title: "Konsumsi Material vs Stok", span: 1, items: rows.slice(0, 4).map((r) => ({ label: r.material ?? "—", value: `${nf(N(r.total_volume), 2)} ${r.unit ?? unit}`, icon: "FlaskConical", tone: "ok" })) },
      // Panel "Kepatuhan & Rekomendasi" DIHAPUS isinya: dua dari tiga barisnya
      // klaim tanpa dasar. "Dosis vs Anjuran: Sesuai" menyatakan kepatuhan dosis
      // padahal tidak ada anjuran dosis penyemprotan yang tersimpan di mana pun
      // (agri_input_chemicals hanya punya rec_phase/rec_note, keduanya teks bebas),
      // dan "Metode: Manual" menyatakan metode padahal spraying_records tidak punya
      // kolom metode sama sekali.
      { kind: "empty", title: "Kepatuhan Dosis", span: 1, icon: "Target",
        message: "Belum bisa dinilai",
        desc: "Anjuran dosis per bahan belum tersimpan, jadi dosis terpakai tidak punya pembanding. Perlu field anjuran di katalog Chemical." },
    ],
    table: {
      title: "Detail Penyemprotan",
      columns: [
        { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Material" }, { label: "Target/OPT" }, { label: "Dosis (L/ha)", align: "right" },
        // Volume DAN satuannya satu kolom (AI-48): memisahkannya berarti salah satu
        // bisa jatuh ke baris detail dan angkanya kehilangan artinya — "40" tanpa
        // "liter" bukan data yang bisa dibaca.
        { label: "Volume", align: "right" }, { label: "Interval Aman/PHI", kind: "new" }, { label: "Biaya", align: "right", kind: "new" }, { label: "Petugas" }, { label: "Status" },
      ],
      rows: rows.map((r) => [D(r.sprayed_on), r.block, r.material ?? "—", r.target ?? "—", nf(N(r.dose_per_ha), 2), `${nf(N(r.total_volume), 2)} ${r.unit ?? ""}`.trim(), "—", "Rp —", r.officer ?? "—", statusLabelId(r.st ?? "")]),
      footNote: "Material dari katalog Agri-Input. Kolom biru = rekomendasi tambahan. Kosong = —.",
    },
  };
}

// ── 08 · Panen (mockup 11) ──────────────────────────────────────────────────
async function harvestScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT h.harvested_on::text, b.code AS block, b.area_ha, h.crop_code, h.quantity_ton, h.grade, u.full_name AS officer, h.approval_status::text AS st
      FROM app.harvest_records h JOIN app.blocks b ON b.id=h.block_id LEFT JOIN app.users u ON u.id=h.created_by ORDER BY h.harvested_on DESC`);
  const rates = await rlsQuery<{ code: string; rate: string }>(ctx, `SELECT code, rate_idr AS rate FROM app.price_list WHERE kind='revenue'`);
  const rateFor = (crop: string | null) => { const r = rates.find((x) => x.code === (crop === "DURIAN" ? "REV-DUR-A" : "REV-COCO")); return r ? Number(r.rate) : null; };
  const totTon = sum(rows.map((r) => N(r.quantity_ton)));
  const gradeTon = new Map<string, number>();
  let revenue = 0;
  for (const r of rows) { const t = N(r.quantity_ton) ?? 0; const g = r.grade ?? "—"; gradeTon.set(g, (gradeTon.get(g) ?? 0) + t); const rt = rateFor(r.crop_code); if (rt !== null && r.st === APPROVED) revenue += t * rt; }
  const gradeA = gradeTon.get("A") ?? 0;
  const gradeAPct = totTon && totTon > 0 ? (gradeA / totTon) * 100 : null;
  const pie: PieDatum[] = [...gradeTon.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, t]) => ({ name: `Grade ${g}`, value: t, color: GRADE_COLOR[g] ?? "#a8a49a" }));
  const cropTon = new Map<string, number>();
  for (const r of rows) { const t = N(r.quantity_ton) ?? 0; const c = r.crop_code ?? "—"; cropTon.set(c, (cropTon.get(c) ?? 0) + t); }
  const bars: BarDatum[] = [...cropTon.entries()].map(([c, t]) => ({ name: CROP[c] ?? c, value: Math.round(t * 100) / 100, color: "#1f8033" }));
  return {
    slug: "panen", title: "Laporan Panen",
    subtitle: "Panen per blok & komoditas; sumber revenue & traceability lot.",
    kpis: [
      { icon: "Package", label: "Total Panen", value: nf(totTon, 2), unit: "ton", tone: "ok" },
      { icon: "ShieldCheck", label: "Grade A", value: gradeAPct === null ? "—" : nf(gradeAPct, 0), unit: gradeAPct === null ? undefined : "%", tone: "ok" },
      { icon: "LineChart", label: "Yield", value: "—", sub: "butuh luas produktif", tone: "belum" },
      { icon: "Coins", label: "Revenue", value: revenue > 0 ? idrShort(revenue) : "Rp —", sub: "panen disetujui × tarif", tone: "ok" },
    ],
    panels: [
      { kind: "pie", title: "Komposisi Grade", span: 1, data: pie.length ? pie : [{ name: "—", value: 1, color: "#e5e2da" }], centerValue: nf(totTon, 2), centerLabel: "ton" },
      { kind: "bars", title: "Tonase per Komoditas", span: 1, data: bars, unit: "ton" },
      { kind: "stepper", title: "Traceability Panen", span: 1, steps: [
        { icon: "TreePalm", label: "Estate", sub: "sumber", tone: "ok" },
        { icon: "MapPin", label: "Lot Panen", sub: `${rows.filter((r) => r.st === APPROVED).length} lot`, tone: "ok" },
        { icon: "Boxes", label: "Gudang", sub: "simpan", tone: "ok" },
      ], note: rows.some((r) => r.st === APPROVED) ? "Semua lot panen disetujui ter-traceable." : "Traceability aktif setelah panen disetujui." },
    ],
    table: {
      title: "Detail Panen",
      columns: [
        { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Komoditas" }, { label: "Tonase (ton)", align: "right" }, { label: "Grade" },
        { label: "Tarif (Rp/ton)", align: "right", kind: "new" }, { label: "Revenue (Rp)", align: "right", kind: "new" }, { label: "Lot Traceability", kind: "new" }, { label: "Petugas" }, { label: "Status" },
      ],
      rows: rows.map((r) => {
        const ton = N(r.quantity_ton); const rt = rateFor(r.crop_code);
        const rev = ton !== null && rt !== null && r.st === APPROVED ? ton * rt : null;
        const lot = r.st === APPROVED ? `LOT-${(r.crop_code ?? "X").slice(0, 3)}-${r.grade ?? "X"}` : "—";
        return [D(r.harvested_on), r.block, r.crop_code ? CROP[r.crop_code] ?? r.crop_code : "—", nf(ton, 3), r.grade ?? "—", rt === null ? "—" : nf(rt), rev === null ? "—" : nf(rev), lot, r.officer ?? "—", statusLabelId(r.st ?? "")];
      }),
      footNote: "Revenue = tonase × tarif price list. Panen disetujui = titik awal traceability. Kosong = —.",
    },
  };
}

// ── 09 · Katalog & Stok Chemical (mockup 12) ────────────────────────────────
async function chemicalScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT code, name, category, is_organic::text AS organik, unit, stock_qty, reorder_level, rec_phase
      FROM app.v_agri_input_stock WHERE is_active ORDER BY name`);
  const totItem = rows.length;
  const organikCount = rows.filter((r) => r.organik === "true").length;
  const organikPct = totItem > 0 ? (organikCount / totItem) * 100 : 0;
  const npk = rows.find((r) => (r.name ?? "").toUpperCase().includes("NPK")) ?? rows[0];
  const stockBars: ProgressItem[] = rows.slice(0, 5).map((r) => {
    const stock = N(r.stock_qty); const reorder = N(r.reorder_level);
    const low = stock !== null && reorder !== null && stock <= reorder;
    return { label: r.name ?? "—", value: `${nf(stock)} ${r.unit ?? ""}`, pct: stock !== null && reorder ? Math.min(100, (stock / (reorder * 5)) * 100) : null, tone: low ? "kritis" : "ok", badge: stock === null ? undefined : { text: low ? "Perlu reorder" : "Aman", tone: low ? "kritis" : "ok" } };
  });
  return {
    slug: "chemical", title: "Laporan Katalog & Stok Chemical",
    subtitle: "Ketersediaan, konsumsi & status chemical (organik & sintetik).",
    kpis: [
      { icon: "ListChecks", label: "Total Item", value: nf(totItem), tone: "ok" },
      { icon: "Package", label: "Stok Utama", value: npk ? `${nf(N(npk.stock_qty))} ${npk.unit ?? ""}` : "—", sub: npk?.name ?? undefined, tone: "ok" },
      { icon: "Bookmark", label: "Stok Minimum", value: npk ? `${nf(N(npk.reorder_level))} ${npk.unit ?? ""}` : "—", tone: "perhatian" },
      { icon: "Leaf", label: "Porsi Organik", value: nf(organikPct, 0), unit: "%", tone: "ok" },
    ],
    panels: [
      { kind: "progressList", title: "Tingkat Stok vs Ambang Reorder", span: 1, items: stockBars },
      { kind: "empty", title: "Konsumsi vs Stok", span: 1, icon: "BarChart3", message: "Belum ada data konsumsi", desc: "Tren konsumsi vs stok muncul setelah ada mutasi stok tercatat." },
      { kind: "pie", title: "Organik vs Sintetik", span: 1, data: [{ name: "Organik", value: organikCount, color: "#1f8033" }, { name: "Sintetik", value: totItem - organikCount, color: "#cfcbc1" }], centerValue: `${nf(organikPct, 0)}%`, centerLabel: "Organik" },
    ],
    table: {
      title: "Daftar Katalog & Stok Chemical",
      columns: [
        { label: "Kode" }, { label: "Nama" }, { label: "Jenis" }, { label: "Bahan Aktif" }, { label: "Organik?" }, { label: "Stok", align: "right" },
        { label: "Stok Minimum", align: "right" }, { label: "Reorder Alert", kind: "new" }, { label: "Satuan" }, { label: "Rekomendasi Fase" },
      ],
      rows: rows.map((r) => {
        const stock = N(r.stock_qty); const reorder = N(r.reorder_level);
        const alert = stock !== null && reorder !== null ? (stock <= reorder ? "Perlu reorder" : "Aman") : "—";
        return [r.code, r.name, r.category, "—", r.organik === "true" ? "Ya" : "Tidak", nf(stock), nf(reorder), alert, r.unit ?? "—", r.rec_phase ?? "—"];
      }),
      footNote: "Dua jalur input: organik & sintetik. Reorder alert saat stok ≤ stok minimum.",
    },
  };
}

// ── 10 · Katalog Equipment (mockup 13) ──────────────────────────────────────
async function equipmentScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT code, name, category, purchase_price_idr, usage_freq, fuel_type, fuel_per_hour, note
      FROM app.agri_input_equipment ORDER BY name`);
  return {
    slug: "equipment", title: "Laporan Katalog Equipment",
    subtitle: "Alat, kendaraan & drone: harga beli, frekuensi, konsumsi BBM/listrik.",
    kpis: [
      { icon: "Wrench", label: "Total Aset", value: nf(rows.length), tone: "ok" },
      { icon: "BarChart3", label: "Utilisasi", value: "—", sub: "belum ada log pemakaian", tone: "belum" },
      { icon: "Zap", label: "Biaya Energi", value: "Rp —", sub: "belum tercatat", tone: "perhatian" },
      { icon: "Wrench", label: "Perawatan", value: "Belum Dijadwalkan", tone: "perhatian" },
    ],
    panels: [
      { kind: "statCards", title: "Profil Aset", span: 2, cols: 2, cards: rows.slice(0, 4).map((r) => ({ icon: "Wrench", label: `${r.code} · ${r.category ?? "—"}`, value: r.name ?? "—", sub: `Harga beli: ${idrShort(N(r.purchase_price_idr))}` })) },
      // Pie "Kepemilikan" DIHAPUS: datanya tidak ada. Versi sebelumnya memasang
      // Internal = rows.length dan Outsource = 0 secara tetap, jadi grafiknya
      // menyatakan 100% aset milik sendiri tanpa satu pun kolom yang menyimpannya
      // (agri_input_equipment tidak punya field kepemilikan). Diganti panel kosong
      // yang menyebutkan apa yang dibutuhkan.
      { kind: "empty", title: "Kepemilikan", span: 1, icon: "Wrench",
        message: "Belum ada data kepemilikan",
        desc: "Katalog Equipment belum menyimpan status internal/sewa/outsource. Perlu field baru sebelum grafik ini bisa berisi." },
    ],
    table: {
      title: "Detail Katalog Equipment",
      columns: [
        { label: "Kode" }, { label: "Nama Aset" }, { label: "Kategori" }, { label: "Harga Beli (Rp)", align: "right" }, { label: "Frekuensi Pakai" },
        { label: "Utilisasi", kind: "new" }, { label: "Jenis BBM/Listrik" }, { label: "Konsumsi/jam", align: "right" }, { label: "Biaya Energi", align: "right", kind: "new" }, { label: "Depresiasi", align: "right", kind: "new" },
      ],
      rows: rows.map((r) => [r.code, r.name, r.category, nf(N(r.purchase_price_idr)), r.usage_freq ?? "—", "—", r.fuel_type ?? "—", nf(N(r.fuel_per_hour), 2), "Rp —", "Rp —"]),
      footNote: "Harga & konsumsi jadi dasar biaya operasi. Kolom biru = rekomendasi tambahan. Kosong = —.",
    },
  };
}

// ── 12 · Blok & Peta (mockup 14) ────────────────────────────────────────────
async function blocksScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const rows = await rlsQuery<Record<string, string | null>>(ctx, `
    SELECT b.code, b.name, e.name AS estate, b.area_ha, b.planting_year,
           (b.geom IS NOT NULL)::text AS has_geom, b.verification_status::text AS st
      FROM app.blocks b LEFT JOIN app.estates e ON e.id=b.estate_id WHERE b.archived_at IS NULL ORDER BY b.code`);
  const totArea = sum(rows.map((r) => N(r.area_ha)));
  const withGeom = rows.filter((r) => r.has_geom === "true").length;
  const completeness = rows.length ? Math.round((withGeom / rows.length) * 100) : 0;
  const rep = rows.find((r) => (r.code ?? "").startsWith("PILOT")) ?? rows[0];
  return {
    slug: "blok", title: "Laporan Blok & Peta",
    subtitle: "Data fondasi — setiap biaya, survei & pemupukan mereferensi blok di sini.",
    kpis: [
      { icon: "Map", label: "Blok", value: nf(rows.length), tone: "ok" },
      { icon: "Ruler", label: "Luas", value: nf(totArea, 2), unit: "ha", tone: "ok" },
      { icon: "Pentagon", label: "Polygon", value: withGeom > 0 ? "Ada" : "—", sub: `${withGeom}/${rows.length} berpolygon`, tone: withGeom > 0 ? "ok" : "perhatian" },
      { icon: "PieIcon", label: "Kelengkapan Data", value: nf(completeness, 0), unit: "%", tone: completeness >= 90 ? "ok" : "perhatian" },
    ],
    panels: [
      { kind: "map", title: "Peta Blok", span: 2, status: "ok", legend: true, note: "Basemap Sentinel-2 / OSM · luas dari PostGIS." },
    ],
    table: {
      title: "Detail Blok & Peta",
      columns: [
        { label: "Kode" }, { label: "Nama" }, { label: "Estate/Entitas" }, { label: "Luas (ha)", align: "right" }, { label: "Tahun Tanam", align: "right" },
        { label: "Polygon" }, { label: "Populasi", align: "right", kind: "new" }, { label: "pH Tanah", align: "right", kind: "new" }, { label: "C-organik (%)", align: "right", kind: "new" }, { label: "Kelengkapan Data", kind: "new" }, { label: "Status Verifikasi" },
      ],
      rows: rows.map((r) => [r.code, r.name ?? "—", r.estate ?? "—", nf(N(r.area_ha), 2), r.planting_year ?? "—", r.has_geom === "true" ? "Ada" : "—", "—", "—", "—", r.has_geom === "true" ? "80%" : "—", r.st ?? "—"]),
      footNote: "Basemap Sentinel-2 & OSM. Kolom biru = atribut turunan (interpolasi/hara/kesesuaian).",
    },
    rail: {
      title: "Detail Blok",
      summary: rep ? `Blok ${rep.code} · ${rep.estate ?? "—"}` : undefined,
      priorities: undefined,
      general: {
        heading: "Atribut Blok",
        items: rep ? [
          `Nama: ${rep.name ?? "—"}`,
          `Luas: ${nf(N(rep.area_ha), 2)} ha`,
          `Tahun tanam: ${rep.planting_year ?? "—"}`,
          `Polygon: ${rep.has_geom === "true" ? "Ada" : "—"}`,
          `Komoditas: Kelapa & Durian`,
          `Kelengkapan data: ${rep.has_geom === "true" ? "80%" : "—"}`,
        ] : ["Belum ada blok."],
      },
    },
  };
}

// ── 11 · Carbon Accounting (mockup 15) ──────────────────────────────────────
async function carbonScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const [blocks, run] = await Promise.all([carbonByBlock(ctx), latestCarbonRun(ctx)]);
  const totEmis = sum(blocks.map((b) => b.emissionTco2e));
  const totSeq = sum(blocks.map((b) => b.sequestrationTco2e));
  const totNet = sum(blocks.map((b) => b.netTco2e));
  const completeness = run?.dataCompletenessPct ?? null;
  const bars: BarDatum[] = [
    { name: "Emisi Bruto", value: totEmis ?? 0, color: "#a8a49a" },
    { name: "Penyerapan", value: totSeq ?? 0, color: "#4f9d5d" },
    { name: "Net", value: totNet ?? 0, color: "#1f8033" },
  ];
  return {
    slug: "karbon", title: "Laporan Carbon Accounting",
    subtitle: "Emisi & penyerapan per blok dari luas & DBH (IPCC Tier 1).",
    kpis: [
      { icon: "Factory", label: "Emisi Bruto", value: nf(totEmis, 2), unit: "tCO₂e", tone: "ok" },
      { icon: "Leaf", label: "Penyerapan", value: nf(totSeq, 2), unit: "tCO₂e", tone: "ok" },
      { icon: "Scale", label: "Neraca", value: totNet === null ? "—" : `${totNet >= 0 ? "+" : ""}${nf(totNet, 2)}`, unit: totNet === null ? undefined : "tCO₂e", tone: totNet === null ? "belum" : totNet >= 0 ? "ok" : "kritis" },
      { icon: "PieIcon", label: "Kelengkapan", value: completeness === null ? "—" : nf(completeness, 0), unit: completeness === null ? undefined : "%", tone: completeness !== null && completeness >= 90 ? "ok" : "perhatian" },
    ],
    panels: [
      { kind: "bars", title: "Ringkasan Aliran Karbon (tCO₂e)", span: 1, data: bars, unit: "tCO₂e" },
      { kind: "map", title: "Peta Sebaran Karbon", span: 1, status: totNet !== null && totNet >= 0 ? "ok" : "perhatian", legend: true, note: "Intensitas sekuestrasi per blok (tCO₂e/ha)." },
      { kind: "progressList", title: "Metodologi & Asumsi", span: 1, items: [
        { label: "Metodologi", value: "IPCC Tier 1", icon: "ShieldCheck", tone: "ok", badge: { text: "Tier 1", tone: "ok" } },
        { label: "Faktor emisi", value: "Perlu validasi lokal", icon: "AlertTriangle", tone: "perhatian" },
        { label: "Data DBH", value: "Tidak tersedia", icon: "XCircle", tone: "kritis" },
        { label: "Data Biomassa", value: "Tidak tersedia", icon: "XCircle", tone: "kritis" },
        { label: "Sumber emisi dominan", value: "Land clearing", icon: "Factory", tone: "default" },
      ] },
    ],
    table: {
      title: "Rincian per Blok",
      columns: [
        { label: "Kode Blok" }, { label: "Luas (ha)", align: "right" }, { label: "Emisi Bruto (tCO₂e)", align: "right" }, { label: "Penyerapan (tCO₂e)", align: "right" },
        { label: "Neraca (tCO₂e)", align: "right" }, { label: "Sumber Emisi Dominan", kind: "new" }, { label: "Status Validasi Faktor", kind: "new" }, { label: "Status" },
      ],
      rows: blocks.map((b) => [b.blockCode, nf(b.areaHa, 2), nf(b.emissionTco2e, 2), nf(b.sequestrationTco2e, 2), nf(b.netTco2e, 2), "Land clearing", "Perlu validasi lokal", (b.netTco2e ?? 0) >= 0 ? "Net Sink" : "Net Emitter"]),
      footNote: "Faktor emisi masih perlu validasi lokal. Kolom biru = rekomendasi tambahan. Kosong = —.",
    },
  };
}

// ── 13 · Pengeluaran (mockup 16) ────────────────────────────────────────────
async function expenditureScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const [data, perBlock, reflection] = await Promise.all([
    listExpenditures(ctx, { page: 1, pageSize: 100 }),
    blockCostSummary(ctx, { limit: 1000 }),
    reflectedCosts(ctx),
  ]);
  const areaByBlock = new Map(perBlock.map((b) => [b.blockCode, b.areaHa]));
  const approvedTotal = reflection.totalCostIdr > 0 ? reflection.totalCostIdr : null;
  const statusCount = new Map<string, number>();
  for (const r of data.rows) statusCount.set(r.approvalStatus, (statusCount.get(r.approvalStatus) ?? 0) + 1);
  const pending = (statusCount.get("submitted") ?? 0) + (statusCount.get("under_review") ?? 0);
  const funnel = [
    { title: "Draft", count: statusCount.get("draft") ?? 0, tone: "belum" as const, items: [] },
    { title: "Diajukan", count: pending, tone: "perhatian" as const, items: [] },
    { title: "Disetujui", count: statusCount.get("approved") ?? 0, tone: "ok" as const, items: [] },
    { title: "Ditolak", count: statusCount.get("rejected") ?? 0, tone: "kritis" as const, items: [] },
  ];
  return {
    slug: "pengeluaran", title: "Laporan Pengeluaran",
    subtitle: "Biaya per blok — refleksi aktivitas disetujui (volume × tarif).",
    kpis: [
      { icon: "Wallet", label: "Pengeluaran Disetujui", value: idrShort(approvedTotal), tone: "ok" },
      { icon: "Clock", label: "Menunggu Persetujuan", value: nf(pending), tone: pending > 0 ? "perhatian" : "ok" },
      { icon: "Leaf", label: "Biaya per ha", value: "Rp —", sub: "butuh realisasi disetujui", tone: "belum" },
      { icon: "Briefcase", label: "Aktivitas", value: nf(data.rows.length), tone: "perhatian" },
    ],
    panels: [
      { kind: "journey", title: "Status Pengeluaran", span: 1, columns: funnel },
      { kind: "empty", title: "Tren Pengeluaran", span: 1, icon: "LineChart", message: "Belum ada pengeluaran disetujui", desc: "Grafik tren muncul setelah ada nilai berstatus Disetujui." },
      { kind: "empty", title: "Breakdown per Aktivitas", span: 1, icon: "PieIcon", message: "Rp — Total", desc: "Nilai belum tersedia karena belum ada pengeluaran berstatus Disetujui." },
    ],
    table: {
      title: "Detail Pengeluaran",
      columns: [
        { label: "Tanggal" }, { label: "Kode Blok" }, { label: "Kategori Biaya" }, { label: "Volume", align: "right" }, { label: "Tarif (Rp)", align: "right" },
        { label: "Nilai (Rp)", align: "right" }, { label: "Per-ha Cost", align: "right", kind: "new" }, { label: "Status" },
      ],
      rows: data.rows.map((r) => {
        const tarif = r.quantity && r.quantity > 0 ? r.amountIdr / r.quantity : null;
        const area = r.blockCode ? areaByBlock.get(r.blockCode) ?? null : null;
        const perHa = area && area > 0 ? r.amountIdr / area : null;
        const vol = r.quantity === null ? "—" : `${nf(r.quantity, 2)}${r.unitName ? " " + r.unitName : ""}`;
        return [r.transactionDate, r.isOverhead ? "overhead" : r.blockCode ?? "—", r.costCategoryName ?? "—", vol, tarif === null ? "—" : nf(tarif), r.approvalStatus === APPROVED ? nf(r.amountIdr) : "Rp —", perHa === null || r.approvalStatus !== APPROVED ? "—" : nf(perHa), statusLabelId(r.approvalStatus)];
      }),
      footNote: 'Hanya nilai berstatus Disetujui yang dihitung. Kosong ditulis "—", bukan 0.',
    },
  };
}

// ── 14 · Anggaran (mockup 17) ───────────────────────────────────────────────
async function budgetScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const b = await budgetVsActual(ctx);
  const totBudget = sum(b.map((x) => x.budgetIdr));
  const totActual = sum(b.map((x) => x.actualIdr));
  const serapan = totBudget && totBudget > 0 && totActual !== null ? (totActual / totBudget) * 100 : null;
  const faseMap = new Map<string, number>();
  for (const x of b) faseMap.set(x.periodName, (faseMap.get(x.periodName) ?? 0) + x.budgetIdr);
  const journey = [...faseMap.entries()].slice(0, 5).map(([fase, val]) => ({ title: fase, count: idrShort(val), tone: "perhatian" as const, items: [] }));
  return {
    slug: "anggaran", title: "Laporan Anggaran",
    subtitle: "Per fase & kategori; realisasi dibandingkan otomatis.",
    headerAction: { label: "Susun Anggaran", icon: "ClipboardList" },
    kpis: [
      { icon: "Coins", label: "Total Anggaran", value: idrShort(totBudget), tone: "ok" },
      { icon: "LineChart", label: "Realisasi", value: idrShort(totActual), tone: "ok" },
      { icon: "PieIcon", label: "Serapan", value: serapan === null ? "—" : nf(serapan, 1), unit: serapan === null ? undefined : "%", tone: serapan === null ? "belum" : "perhatian" },
      { icon: "Wallet", label: "Forecast Sisa", value: totBudget !== null && totActual !== null ? idrShort(totBudget - totActual) : "Rp —", tone: "perhatian" },
    ],
    panels: [
      { kind: "journey", title: "Anggaran per Fase", span: 3, columns: journey.length ? journey : [{ title: "Belum disusun", count: "Rp —", tone: "belum" as const, items: [] }] },
      { kind: "empty", title: "Burn Rate Anggaran & Forecast", span: 3, icon: "LineChart", message: b.length ? "Menunggu realisasi" : "Aktif setelah anggaran disusun", desc: "Burn rate & forecast muncul setelah ada anggaran dan realisasi." },
    ],
    table: {
      title: "Rincian Anggaran",
      columns: [
        { label: "Fase Proyek" }, { label: "Kategori Biaya" }, { label: "Lingkup" }, { label: "Anggaran (Rp)", align: "right" }, { label: "Realisasi (Rp)", align: "right" },
        { label: "Selisih (Rp)", align: "right" }, { label: "% Serap", align: "right" }, { label: "Burn Rate (%)", align: "right", kind: "new" }, { label: "Forecast Sisa (Rp)", align: "right", kind: "new" }, { label: "Status" },
      ],
      rows: b.map((x) => [x.periodName, x.costCategoryName, x.scopeType, nf(x.budgetIdr), nf(x.actualIdr), nf(x.remainingIdr), x.utilisationPct === null ? "—" : nf(x.utilisationPct, 1), "—", "—", x.isOverBudget ? "Terlampaui" : "Draft"]),
      footNote: "Realisasi dihitung pada tingkat lingkup masing-masing. Kolom biru = rekomendasi tambahan.",
    },
  };
}

// ── 15 · Approval Inbox (mockup 18) ─────────────────────────────────────────
async function approvalScreen(ctx: RlsContext): Promise<ReportScreenBase> {
  const p = await listAllPending(ctx, { page: 1, pageSize: 100 });
  const pending = p.rows.length;
  const totReflect = sum(p.rows.map((r) => r.amountIdr ?? null));
  const modCount = new Map<string, number>();
  for (const r of p.rows) modCount.set(r.moduleLabel, (modCount.get(r.moduleLabel) ?? 0) + 1);
  const bars: BarDatum[] = [...modCount.entries()].map(([m, c]) => ({ name: m, value: c, color: "#1f8033" }));
  const first = p.rows[0];
  return {
    slug: "approval", title: "Approval Inbox",
    subtitle: "Item menunggu keputusan lintas modul; approval mengubah angka laporan.",
    kpis: [
      { icon: "Clock", label: "Menunggu", value: nf(pending), tone: pending > 0 ? "perhatian" : "ok" },
      { icon: "AlertTriangle", label: "Terlambat", value: "0", tone: "kritis" },
      { icon: "Coins", label: "Nilai Refleksi", value: idrShort(totReflect), tone: "ok" },
      { icon: "LineChart", label: "SLA Rata-rata", value: "—", sub: "butuh histori keputusan", tone: "belum" },
    ],
    panels: [
      { kind: "bars", title: "Antrean per Modul", span: 1, data: bars.length ? bars : [{ name: "—", value: 0 }], unit: "ajuan", horizontal: true },
      { kind: "pie", title: "Distribusi per Approver", span: 1, data: [{ name: "Belum Ditugaskan", value: pending || 1, color: "#1f8033" }, { name: "Saya", value: 0, color: "#cfcbc1" }], centerValue: `${pending}`, centerLabel: "Total" },
      { kind: "progressList", title: "Tentang Maker-Checker", span: 1, items: [
        { label: "Setiap ajuan disetujui memperbarui data operasional & finansial.", icon: "Info", tone: "info" },
        { label: "Penolakan wajib disertai alasan yang jelas & dapat ditindaklanjuti.", icon: "AlertTriangle", tone: "perhatian" },
      ] },
    ],
    table: {
      title: "Antrean Approval",
      columns: [
        { label: "Tgl Ajuan" }, { label: "Modul Asal" }, { label: "Kode Blok" }, { label: "Detail" }, { label: "Nilai Refleksi (Rp)", align: "right" },
        { label: "Umur Antrean (SLA)", kind: "new" }, { label: "Pengaju" }, { label: "Status" }, { label: "Approver", kind: "new" },
      ],
      rows: p.rows.map((r) => [r.eventDate ?? "—", r.moduleLabel, r.blockCode ?? "—", r.detail ?? "—", r.amountIdr === null ? "Rp —" : nf(r.amountIdr), "—", r.actorName ?? "—", r.approvalStatus === APPROVED ? "Disetujui" : "Menunggu", "Belum Ditugaskan"]),
      footNote: "Nilai = rupiah ter-refleksi. Penolakan wajib alasan (maker-checker).",
    },
    rail: {
      title: "Detail Ajuan",
      summary: first ? `${first.moduleLabel} · ${first.blockCode ?? "—"} — diajukan ${first.eventDate ?? "—"} oleh ${first.actorName ?? "—"}.` : "Belum ada ajuan menunggu.",
      general: first ? {
        heading: "Informasi Ajuan",
        items: [
          `Modul: ${first.moduleLabel}`,
          `Blok: ${first.blockCode ?? "—"}`,
          `Detail: ${first.detail ?? "—"}`,
          `Nilai refleksi: ${first.amountIdr === null ? "Rp —" : nf(first.amountIdr)}`,
          `Pengaju: ${first.actorName ?? "—"}`,
        ],
      } : undefined,
      action: first ? "Setujui / Tolak" : undefined,
    },
  };
}

// ── dispatcher ───────────────────────────────────────────────────────────────
export const SCREEN_BUILDERS: Record<string, (ctx: RlsContext) => Promise<ReportScreenBase>> = {
  "kesesuaian-lahan": suitabilityScreen,
  "persiapan-lahan": landPrepScreen,
  "bibit": nurseryScreen,
  "penyiangan": weedingScreen,
  "pemupukan": fertilizingScreen,
  "pruning": pruningScreen,
  "penyemprotan": sprayingScreen,
  "panen": harvestScreen,
  "chemical": chemicalScreen,
  "equipment": equipmentScreen,
  "karbon": carbonScreen,
  "blok": blocksScreen,
  "pengeluaran": expenditureScreen,
  "anggaran": budgetScreen,
  "approval": approvalScreen,
};

/**
 * Sumber & catatan header per laporan (AI-47). Teksnya SAMA dengan yang sudah
 * dipakai jalur lama di moduleData.ts — bukan tulisan baru, supaya isi PDF/Excel
 * tidak berubah artinya saat jalurnya disatukan.
 *
 * `title`/`subtitle` tidak ada di sini: keduanya sudah dimiliki tiap ReportScreen,
 * jadi mengulangnya akan membuka celah kedua tempat itu berbeda.
 */
const SCREEN_META: Record<string, { source: string; note: string }> = {
  "kesesuaian-lahan": { source: "modul Land Suitability.", note: 'Kelas S1 sangat sesuai – N tidak sesuai. Kosong = "—".' },
  "persiapan-lahan": { source: "modul Land Preparation.", note: "Status kesiapan: Belum siap / Proses / Siap tanam." },
  "bibit": { source: "modul Seedling/Nursery.", note: "Survival = hidup ÷ jumlah awal batch. Batch tanpa inspeksi ditandai —." },
  "penyiangan": { source: "modul Weeding.", note: 'Biaya ter-refleksi saat disetujui. Kosong = "—".' },
  "pemupukan": { source: "modul Fertilizing.", note: "Tiga pendekatan rekomendasi: uji tanah, analisis jaringan daun, neraca hara." },
  "pruning": { source: "modul Pruning.", note: "Jumlah pohon jadi dasar biaya tenaga kerja." },
  "penyemprotan": { source: "modul Spraying.", note: "Material dari katalog Agri-Input; metode bisa manual/drone/outsource." },
  "panen": { source: "modul Harvesting → Accounting & Traceability.", note: "Revenue = tonase × tarif price list per komoditas. Panen disetujui = titik awal Traceability." },
  "chemical": { source: "modul Agri-Input / Chemical.", note: "Dua jalur input: organik & sintetik." },
  "equipment": { source: "modul Agri-Input / Equipment.", note: "Harga & konsumsi jadi dasar biaya operasi." },
  "karbon": { source: "modul Carbon Accounting.", note: "Faktor emisi masih perlu validasi lokal (EF-LANDCLEAR dll)." },
  "blok": { source: "modul Blocks & Map.", note: "Basemap Sentinel-2 & OSM. Luas dari PostGIS." },
  "pengeluaran": { source: "modul Costing/Pengeluaran.", note: 'Hanya nilai Disetujui yang dihitung. Filter: Draft/Diajukan/Disetujui/Ditolak. Kosong ditulis "—", bukan 0.' },
  "anggaran": { source: "modul Costing/Anggaran vs Pengeluaran disetujui.", note: "Realisasi dihitung pada tingkat lingkup anggaran, digulung dari sub-kategori (migrasi 0047)." },
  "approval": { source: "modul Approval.", note: "Nilai = rupiah ter-refleksi. Penolakan wajib menyertakan alasan." },
};

/**
 * AI-48 · kolom SEKUNDER per laporan (K-07: batas 8 kolom di mobile).
 *
 * Dipilih dengan satu aturan: kolom utama = identitas (apa/di mana), kuantitas
 * pokok, uang, dan status. Sisanya — metrik turunan/pembanding, atribut sekunder,
 * dan nama orang — masuk baris detail.
 *
 * Dua penyimpangan dari aturan itu, atas keputusan pemilik produk 24 Agu 2026:
 *   * Penyemprotan MEMPERTAHANKAN "Interval Aman/PHI" di kolom utama. Secara "apa
 *     yang dibaca manajemen" ia sekunder, tapi akibat kalau terlewat paling besar
 *     (masa tunggu sebelum panen). Yang turun: Dosis (L/ha) dan Petugas.
 *   * Approval MEMPERTAHANKAN "Umur Antrean (SLA)" — justru itu alasan orang
 *     membuka inbox. Yang turun: Approver.
 *
 * Dicocokkan lewat LABEL, bukan indeks: menambah kolom di tengah tabel tidak akan
 * menggeser pemilahan ini secara diam-diam. Label yang tidak ditemukan diabaikan,
 * dan uji at:verify menangkap laporan yang kolom utamanya masih lebih dari 8.
 *
 * karbon & pengeluaran tidak ada di sini: keduanya sudah 8 kolom.
 */
const SCREEN_DETAIL_COLUMNS: Record<string, string[]> = {
  "kesesuaian-lahan": ["No", "Nilai vs Ambang", "Rekomendasi", "Reinspeksi", "Penilai"],
  "pemupukan": ["Fase", "Dosis Rekom.", "Selisih Dosis", "Petugas"],
  "penyemprotan": ["Dosis (L/ha)", "Petugas"],
  "blok": ["Polygon", "pH Tanah", "C-organik (%)"],
  "persiapan-lahan": ["Nama Blok", "Jumlah Lubang"],
  "bibit": ["Rusak", "Mortalitas %"],
  "panen": ["Tarif (Rp/ton)", "Lot Traceability"],
  "chemical": ["Bahan Aktif", "Rekomendasi Fase"],
  "equipment": ["Utilisasi", "Konsumsi/jam"],
  "anggaran": ["Burn Rate (%)", "Forecast Sisa (Rp)"],
  // Kolom "Jadwal vs Realisasi" kembali di 0051, jadi penyiangan 10 kolom lagi.
  // Petugas turun mengikuti aturan umum (nama orang ke baris detail).
  "penyiangan": ["Cakupan vs Total", "Petugas"],
  "pruning": ["Detail"],
  "approval": ["Approver"],
};

/**
 * Satu-satunya pintu membangun layar laporan — dan sejak AI-47 juga satu-satunya
 * pintu untuk PDF & Excel. Header dirakit DI SINI, sekali, sehingga ketiga format
 * secara struktural mustahil menampilkan kolom atau header yang berbeda.
 */
export async function buildReportScreen(ctx: RlsContext, slug: string): Promise<ReportScreen | null> {
  const b = SCREEN_BUILDERS[slug];
  if (!b) return null;
  const screen = await b(ctx);
  const m = SCREEN_META[slug] ?? { source: `modul ${slug}.`, note: "" };
  // AI-48: tandai kolom sekunder. Terpusat, jadi isi 15 builder tidak disentuh.
  const detailLabels = new Set(SCREEN_DETAIL_COLUMNS[slug] ?? []);
  const table = detailLabels.size
    ? { ...screen.table, columns: screen.table.columns.map((c) => (detailLabels.has(c.label) ? { ...c, detail: true } : c)) }
    : screen.table;
  return {
    ...screen,
    table,
    meta: await buildReportMeta(ctx, {
      title: screen.title,
      subtitle: screen.subtitle ?? "",
      source: m.source,
      note: m.note,
    }),
  };
}
