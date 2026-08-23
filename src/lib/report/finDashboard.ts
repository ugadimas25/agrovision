import { rlsQuery, type RlsContext } from "@/lib/db";
import { budgetVsActual, totalApprovedSpend } from "@/lib/repo/costing";
import { reflectedCosts } from "@/lib/repo/pricing";
import { formatIdrShort, formatIdr } from "@/lib/format";
import type { InsightRow } from "@/components/dashboard/shared";
import { CROP } from "@/lib/labels";

// Realisasi kini boleh NULL (migrasi 0039: "belum ada realisasi" != "realisasi 0").
// Menjumlahkan dengan `?? 0` akan mengembalikan angka fabrikasi yang baru saja
// dibuang di lapisan SQL, jadi: jumlahkan yang DIKETAHUI saja, dan bila tidak ada
// satu pun yang diketahui, hasilnya null supaya dirender "—".
const sumKnown = (xs: (number | null)[]): number | null => {
  const ada = xs.filter((x): x is number => x !== null);
  return ada.length ? ada.reduce((a, b) => a + b, 0) : null;
};


const EMPTY = "—";
const nf = (v: number, d = 0) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v);
// Peta komoditas dipusatkan di src/lib/labels.ts (dulu disalin di 4 berkas).

export type FinKpi = { key: "revenue" | "expense" | "profit" | "budget"; label: string; value: string; unit?: string; note?: string; tone?: "default" | "pos" | "neg"; badge?: { text: string; tone: "warn" | "ok" } };
export type RevenueCommodity = { commodity: string; total: number; grades: { grade: string; value: number; pct: number }[] };
/** realisasi null = fase itu belum punya realisasi (migrasi 0039), bukan nol. */
export type BudgetFase = { fase: string; anggaran: number; realisasi: number | null };

export type FinDashboard = {
  kpis: FinKpi[];
  dataIncomplete: boolean;
  budgetFases: BudgetFase[];
  hasBudget: boolean;
  revenue: RevenueCommodity[];
  totalRevenue: number | null;
  totalVolume: number | null;
  hasCostStructure: boolean;
  insights: InsightRow[];
};

export async function financialDashboardView(ctx: RlsContext): Promise<FinDashboard> {
  const [budgets, spend, reflection, harvest, rates] = await Promise.all([
    budgetVsActual(ctx),
    totalApprovedSpend(ctx),
    reflectedCosts(ctx),
    rlsQuery<{ crop_code: string; grade: string | null; ton: string }>(ctx,
      `SELECT crop_code, grade, COALESCE(SUM(quantity_ton),0)::text AS ton
         FROM app.harvest_records WHERE approval_status='approved' GROUP BY crop_code, grade`),
    rlsQuery<{ code: string; rate: string }>(ctx, `SELECT code, rate_idr AS rate FROM app.price_list WHERE kind='revenue'`),
  ]);

  const rateFor = (crop: string) => {
    const code = crop === "DURIAN" ? "REV-DUR-A" : "REV-COCO";
    const r = rates.find((x) => x.code === code);
    return r ? Number(r.rate) : 0;
  };
  // revenue per komoditas × grade
  const byCommodity = new Map<string, { grade: string; value: number }[]>();
  let totalVolume = 0;
  for (const h of harvest) {
    const ton = Number(h.ton);
    totalVolume += ton;
    const val = Math.round(ton * rateFor(h.crop_code));
    const arr = byCommodity.get(h.crop_code) ?? [];
    arr.push({ grade: h.grade ?? "—", value: val });
    byCommodity.set(h.crop_code, arr);
  }
  const revenue: RevenueCommodity[] = [...byCommodity.entries()].map(([crop, grades]) => {
    const total = grades.reduce((s, g) => s + g.value, 0);
    return {
      commodity: CROP[crop] ?? crop, total,
      grades: grades.sort((a, b) => a.grade.localeCompare(b.grade)).map((g) => ({ grade: g.grade, value: g.value, pct: total > 0 ? (g.value / total) * 100 : 0 })),
    };
  });
  const hasRevenue = reflection.revenueLines.length > 0;
  const totalRevenue = hasRevenue ? reflection.totalRevenueIdr : null;

  const sumBudget = budgets.reduce((a, b) => a + b.budgetIdr, 0);
  const sumActual = sumKnown(budgets.map((b) => b.actualIdr));
  const hasBudget = budgets.length > 0;
  const serapan =
    hasBudget && sumBudget > 0 && sumActual !== null ? (sumActual / sumBudget) * 100 : null;
  const laba = reflection.balanceIdr;
  const labaSemu = hasRevenue && reflection.totalCostIdr < (totalRevenue ?? 0) * 0.05;

  // anggaran vs realisasi per fase (pakai periodName sebagai fase)
  // realisasi per fase dijumlahkan dari yang DIKETAHUI saja; fase yang belum
  // punya realisasi bernilai null, bukan 0 (grafik tidak menggambar batangnya).
  const faseMap = new Map<string, { anggaran: number; realisasi: (number | null)[] }>();
  for (const b of budgets) {
    const f = faseMap.get(b.periodName) ?? { anggaran: 0, realisasi: [] };
    f.anggaran += b.budgetIdr; f.realisasi.push(b.actualIdr);
    faseMap.set(b.periodName, f);
  }
  const budgetFases: BudgetFase[] = [...faseMap.entries()].map(([fase, v]) => ({
    fase, anggaran: v.anggaran, realisasi: sumKnown(v.realisasi),
  }));

  const kpis: FinKpi[] = [
    { key: "revenue", label: "Revenue", value: totalRevenue === null ? EMPTY : formatIdrShort(totalRevenue), note: hasRevenue ? "dari panen disetujui" : "menunggu panen disetujui", tone: "pos" },
    { key: "expense", label: "Pengeluaran", value: spend === null ? EMPTY : formatIdrShort(spend), note: spend === null ? "belum ada realisasi" : "disetujui" },
    { key: "profit", label: "Laba / Rugi", value: laba === null ? EMPTY : formatIdrShort(laba), note: labaSemu ? undefined : laba !== null && laba < 0 ? "rugi periode ini" : "revenue − biaya", tone: laba === null ? "default" : laba < 0 ? "neg" : "pos", badge: labaSemu ? { text: "Belum realistis (biaya tidak lengkap)", tone: "warn" } : undefined },
    { key: "budget", label: "Serapan Anggaran", value: serapan === null ? EMPTY : nf(serapan, 1), unit: serapan === null ? undefined : "%", note: hasBudget ? "vs target anggaran" : "anggaran belum disusun" },
  ];

  const insights: InsightRow[] = [
    { area: "Pengendalian Biaya", temuan: labaSemu ? "Refleksi biaya ter-approved belum aktif sehingga data biaya belum lengkap." : "Pantau akurasi refleksi biaya.", rekomendasi: "Aktifkan refleksi biaya ter-approved ke buku besar.", dampak: "Akurasi laba/rugi, pelaporan finansial", status: "Belum Ditindaklanjuti" },
    { area: "Perencanaan Anggaran", temuan: hasBudget ? "Beberapa pos anggaran perlu ditinjau." : "Anggaran per fase belum disusun.", rekomendasi: "Buat anggaran per fase (Persiapan, Tanam, Pemeliharaan, Panen).", dampak: "Kontrol biaya, serapan anggaran", status: "Belum Ditindaklanjuti" },
    { area: "Harga & Pendapatan", temuan: "Daftar harga (price list) belum divalidasi/dikunci.", rekomendasi: "Validasi & kunci daftar harga komoditas & grade.", dampak: "Akurasi revenue", status: "Belum Ditindaklanjuti" },
    { area: "Pengendalian Pembayaran", temuan: "Kontrol approval pembayaran belum berlaku.", rekomendasi: "Terapkan kontrol approval pembayaran maker-checker.", dampak: "Mitigasi risiko fraud, kepatuhan", status: "Belum Ditindaklanjuti" },
  ];

  return {
    kpis, dataIncomplete: labaSemu || spend === null,
    budgetFases, hasBudget,
    revenue, totalRevenue, totalVolume: totalVolume > 0 ? totalVolume : null,
    hasCostStructure: false,
    insights,
  };
}

// util re-export (dipakai view untuk tooltip)
export const fmtIdr = formatIdr;
