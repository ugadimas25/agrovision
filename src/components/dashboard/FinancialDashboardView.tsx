"use client";

import Link from "next/link";
import {
  TrendingUp, ArrowDownRight, Wallet, ClipboardList, Info, BarChart3, LineChart as LineIcon, Sprout, TreePine, CalendarClock,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { KpiCard, Panel, EmptyPanel, InsightTable } from "@/components/dashboard/shared";
import type { FinDashboard, FinKpi } from "@/lib/report/finDashboard";
import { formatIdr, formatIdrShort } from "@/lib/format";
import { FilterBar, CATATAN_KOMODITAS_DASHBOARD } from "@/components/dashboard/FilterBar";
import { ringkasBatasan, type DashboardFilter } from "@/lib/report/filters";

type Opt = { value: string; label: string };

const num = (v: number, d = 0) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v);

const KPI_ICON = { revenue: TrendingUp, expense: ArrowDownRight, profit: Wallet, budget: ClipboardList } as const;
// Palet irisan struktur biaya. Jumlah kategori tidak tetap (datang dari master
// data), jadi warnanya di-modulo -- bukan dipetakan per nama, yang akan membuat
// kategori baru tampil tanpa warna.
const SLICE_COLOR = ["#1a6c2c", "#2f8f43", "#4f9d5d", "#7bb885", "#a3cfa9", "#fbbf24", "#f59e0b", "#d97706", "#a8a49a", "#78716c"];
const GRADE_COLOR: Record<string, string> = { "Grade A": "#1a6c2c", "Grade B": "#4f9d5d", "Grade C": "#fbbf24", "Grade —": "#a8a49a" };

export function FinancialDashboardView({
  data, filter, basePath, estates, blocks, periods, crops,
}: {
  data: FinDashboard;
  // `company` dibuang: dulu ia nilai chip "Estate" pada bilah mati.
  filter: DashboardFilter;
  basePath: string;
  estates: Opt[];
  blocks: Opt[];
  periods: Opt[];
  crops: Opt[];
}) {
  const gradeKeys = Array.from(new Set(data.revenue.flatMap((r) => r.grades.map((g) => `Grade ${g.grade}`))));
  const revData = data.revenue.map((r) => {
    const o: Record<string, string | number> = { commodity: r.commodity };
    for (const g of r.grades) o[`Grade ${g.grade}`] = g.value;
    return o;
  });
  const faseData = data.budgetFases.map((f) => ({ fase: f.fase, Anggaran: f.anggaran, Realisasi: f.realisasi }));

  return (
    <div className="space-y-4">
      {/* AI-24: bilah filter bersama — menggantikan DashboardFilterBar yang isinya
          <div> mati. Metrik yang tidak bisa mengikuti filter dinyatakan di bawahnya,
          bukan dibiarkan tampak seolah sudah dipersempit. */}
      <FilterBar basePath={basePath} filter={filter}
                 estates={estates} blocks={blocks} periods={periods} crops={crops}
        catatanKomoditas={CATATAN_KOMODITAS_DASHBOARD} />
      {ringkasBatasan(data.terbatas) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <strong>Tidak mengikuti filter:</strong> {ringkasBatasan(data.terbatas)}. Nilainya
          ditandai <strong>—</strong> agar tidak terbaca sebagai nol.
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard Finansial</h1>
          <p className="text-sm text-slate-500">Refleksi finansial: alokasi anggaran, realisasi/spending, revenue, laba/rugi, forecast.</p>
        </div>
        {data.dataIncomplete && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
            <Info className="h-3.5 w-3.5" /> Data biaya belum lengkap
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((k) => <KpiCard key={k.key} icon={KPI_ICON[k.key]} label={k.label} value={k.value} unit={k.unit} note={k.note} tone={k.tone} badge={k.badge} iconTone={iconTone(k)}  testId={`kpi-${k.key}`} />)}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Anggaran vs Realisasi per Fase">
          {!data.hasBudget ? (
            <EmptyPanel icon={BarChart3} title="Anggaran belum disusun" desc="Susun anggaran per fase untuk melihat perbandingan Anggaran vs Realisasi."
              action={<Link href="/costing/anggaran" className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Buat Anggaran</Link>} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={faseData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <XAxis dataKey="fase" tick={{ fontSize: 10, fill: "#5c5a55" }} />
                <YAxis tick={{ fontSize: 10, fill: "#a8a49a" }} tickFormatter={(v: number) => formatIdrShort(v)} width={64} />
                <Tooltip formatter={(v) => formatIdr(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Anggaran" fill="#cfcbc1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Realisasi" fill="#1f8033" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Revenue per Komoditas & Grade">
          {revData.length === 0 ? (
            <EmptyPanel icon={BarChart3} title="Belum ada revenue" desc="Revenue muncul dari panen yang disetujui × tarif komoditas & grade." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart layout="vertical" data={revData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#a8a49a" }} tickFormatter={(v: number) => formatIdrShort(v)} />
                  <YAxis type="category" dataKey="commodity" tick={{ fontSize: 11, fill: "#45443f" }} width={60} />
                  <Tooltip formatter={(v) => formatIdr(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {gradeKeys.map((k) => <Bar key={k} dataKey={k} stackId="g" fill={GRADE_COLOR[k] ?? "#a8a49a"} radius={[0, 2, 2, 0]} />)}
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-2 text-xs">
                <div><span className="text-slate-500">Total Revenue</span><p className="font-semibold text-emerald-700">{data.totalRevenue === null ? "—" : formatIdr(data.totalRevenue)}</p></div>
                <div><span className="text-slate-500">Total Volume</span><p className="font-semibold text-slate-700">{data.totalVolume === null ? "—" : `${num(data.totalVolume, 2)} ton`}</p></div>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Struktur Biaya per Kategori">
          {data.costStructure.length === 0 ? (
            <EmptyPanel icon={Info} title="Belum ada biaya disetujui" desc="Komposisi muncul dari transaksi biaya yang sudah disetujui, dikelompokkan per kategori induk." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={data.costStructure} dataKey="total" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={1}>
                    {data.costStructure.map((c, i) => <Cell key={c.name} fill={SLICE_COLOR[i % SLICE_COLOR.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatIdr(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <ul data-testid="struktur-biaya" className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
                {data.costStructure.slice(0, 5).map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SLICE_COLOR[i % SLICE_COLOR.length] }} />
                    <span className="min-w-0 flex-1 truncate text-slate-600">{c.name}</span>
                    <span className="tabular-nums font-medium text-slate-700">{num(c.pct, 1)}%</span>
                    <span className="tabular-nums text-slate-500">{formatIdrShort(c.total)}</span>
                  </li>
                ))}
                {data.costStructure.length > 5 && (
                  <li className="text-slate-400">+{data.costStructure.length - 5} kategori lain</li>
                )}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel title="Tren Arus Kas"><EmptyPanel icon={LineIcon} title="Belum tersedia" desc="Lengkapi pemasukan & pengeluaran untuk tren arus kas." /></Panel>
        <Panel title="Biaya per Hektare"><EmptyPanel icon={Sprout} title="Belum tersedia" desc="Butuh data biaya & luas untuk hitung biaya per hektar." /></Panel>
        <Panel title="Biaya per Pohon"><EmptyPanel icon={TreePine} title="Belum tersedia" desc="Butuh data biaya & jumlah pohon per blok." /></Panel>
        <Panel title="Proyeksi (12 Bulan)"><EmptyPanel icon={CalendarClock} title="Belum tersedia" desc="Susun anggaran & lengkapi data untuk proyeksi 12 bulan." /></Panel>
      </div>

      <Panel title="Insight & Rekomendasi (Prioritas)">
        <InsightTable rows={data.insights} />
      </Panel>
    </div>
  );
}

function iconTone(k: FinKpi): "emerald" | "red" | "amber" | "sky" {
  if (k.key === "expense") return "red";
  if (k.key === "budget") return "amber";
  return "emerald";
}
