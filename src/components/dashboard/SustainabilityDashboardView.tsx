"use client";

import {
  Cloud, ClipboardCheck, Award, ShieldCheck, TreePalm, MapPin, Warehouse, Factory, ArrowRight, Leaf,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { KpiCard, Panel, EmptyPanel } from "@/components/dashboard/shared";
import { EstateMap } from "@/components/dashboard/EstateMap";
import type { SustDashboard, SustKpi } from "@/lib/report/sustDashboard";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { ringkasBatasan, type DashboardFilter } from "@/lib/report/filters";

type Opt = { value: string; label: string };

const num = (v: number, d = 0) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v);

const KPI_ICON = { carbon: Cloud, complete: ClipboardCheck, cert: Award, trace: ShieldCheck } as const;
const INS_TONE = { emerald: "border-emerald-200 bg-emerald-50/50", sky: "border-sky-200 bg-sky-50/50", amber: "border-amber-200 bg-amber-50/50" };
const INS_FG = { emerald: "text-emerald-700", sky: "text-sky-700", amber: "text-amber-700" };

export function SustainabilityDashboardView({
  data, filter, basePath, estates, blocks, periods, crops,
}: {
  data: SustDashboard;
  // `company` dibuang: dulu ia nilai chip "Estate" pada bilah mati.
  filter: DashboardFilter;
  basePath: string;
  estates: Opt[];
  blocks: Opt[];
  periods: Opt[];
  crops: Opt[];
}) {
  const carbonData = [
    { name: "Emisi Bruto", value: data.carbon.gross ?? 0, c: "#a8a49a" },
    { name: "Penyerapan", value: data.carbon.sequestration ?? 0, c: "#4f9d5d" },
    { name: "Net", value: data.carbon.net ?? 0, c: "#1f8033" },
  ];
  const organicData = data.organic ? [
    { name: "Organik", value: data.organic.organic, c: "#1f8033" },
    { name: "Sintetik", value: data.organic.synthetic, c: "#cfcbc1" },
  ] : [];
  const organicPct = data.organic && data.organic.total > 0 ? (data.organic.organic / data.organic.total) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* AI-24: bilah filter bersama — menggantikan DashboardFilterBar yang isinya
          <div> mati. Metrik yang tidak bisa mengikuti filter dinyatakan di bawahnya,
          bukan dibiarkan tampak seolah sudah dipersempit. */}
      <FilterBar basePath={basePath} filter={filter}
                 estates={estates} blocks={blocks} periods={periods} crops={crops} />
      {ringkasBatasan(data.terbatas) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <strong>Tidak mengikuti filter:</strong> {ringkasBatasan(data.terbatas)}. Nilainya
          ditandai <strong>—</strong> agar tidak terbaca sebagai nol.
        </p>
      )}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard Sustainability</h1>
        <p className="text-sm text-slate-500">Capaian dampak lingkungan: karbon, sertifikasi/kepatuhan, ketertelusuran, biodiversitas.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((k) => <KpiCard key={k.key} icon={KPI_ICON[k.key]} label={k.label} value={k.value} unit={k.unit} note={k.note} tone={k.tone} iconTone={iconTone(k)}  testId={`kpi-${k.key}`} />)}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Neraca Karbon (tCO₂e)">
          {!data.hasCarbon ? (
            <EmptyPanel icon={Cloud} title="Belum ada perhitungan karbon" desc="Jalankan perhitungan karbon (IPCC Tier 1) untuk melihat neraca." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={carbonData} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#5c5a55" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#a8a49a" }} width={40} />
                  <Tooltip formatter={(v) => `${num(Number(v), 2)} tCO₂e`} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {carbonData.map((d, i) => <Cell key={i} fill={d.c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" /> IPCC Tier 1 · Perlu validasi lokal
              </div>
            </>
          )}
        </Panel>

        <Panel title="Peta Intensitas Karbon & Biodiversitas">
          <EstateMap status={data.mapStatus} heightClass="h-[240px]" />
        </Panel>

        <Panel title="Kesiapan Sertifikasi">
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-red-800">Riwayat Lahan K1–K7</p>
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Kritis</span>
            </div>
            <p className="mt-0.5 text-[11px] text-red-700">Bukti riwayat lahan belum lengkap · {data.landHistoryDone}/{data.landHistoryTotal}</p>
          </div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">Progress 9 Standar</p>
          <ul className="max-h-[180px] space-y-1.5 overflow-y-auto pr-1">
            {data.certReady.map((s, i) => (
              <li key={s.name} className="text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">{i + 1}. {s.name}</span>
                  <span className="tabular-nums text-slate-500">{s.pct === null ? "— belum ada program" : `${s.pct}%`}</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full rounded-full bg-slate-100">
                  {s.pct !== null && <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }} />}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Traceability Rantai Pasok">
          <div className="flex items-center justify-between gap-1 py-3">
            {[{ i: TreePalm, l: "Blok", s: "sumber" }, { i: MapPin, l: "Collection Pt", s: "kumpul" }, { i: Warehouse, l: "Gudang", s: "simpan" }, { i: Factory, l: "Pabrik", s: "olah" }].map((n, idx) => (
              <div key={n.l} className="flex items-center gap-1">
                <div className="flex flex-col items-center gap-1 text-center">
                  <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600"><n.i className="h-4 w-4" /></span>
                  <span className="text-[11px] font-medium text-slate-600">{n.l}</span>
                  <span className="text-[9px] text-slate-500">{n.s}</span>
                </div>
                {idx < 3 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
              </div>
            ))}
          </div>
          <p className="border-t border-slate-100 pt-2 text-[11px] text-slate-500">Rantai terpetakan. Status per lot panen: aktif saat ada panen disetujui.</p>
        </Panel>

        <Panel title="Input: Organik vs Sintetik">
          {!data.organic ? (
            <EmptyPanel icon={Leaf} title="Belum ada input tercatat" desc="Porsi organik muncul setelah ada aplikasi pupuk disetujui." />
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-start">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={organicData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={60}>
                    {organicData.map((d, i) => <Cell key={i} fill={d.c} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${num(Number(v), 2)} ton`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-xs">
                <p className="text-2xl font-bold text-emerald-700">{num(organicPct, 0)}%</p>
                <p className="text-slate-500">Organik</p>
                <ul className="mt-2 space-y-1">
                  <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Organik {num(data.organic.organic, 1)} ton</li>
                  <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /> Sintetik {num(data.organic.synthetic, 1)} ton</li>
                </ul>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Insight & Rekomendasi">
          <div className="space-y-2">
            {data.insights.map((ins, i) => (
              <div key={i} className={"rounded-lg border p-2.5 " + INS_TONE[ins.tone]}>
                <p className="text-sm font-semibold text-slate-700">{ins.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{ins.text}</p>
                <p className={"mt-1 text-[11px] font-medium " + INS_FG[ins.tone]}>{ins.action} →</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function iconTone(k: SustKpi): "emerald" | "red" | "amber" | "sky" {
  return k.key === "cert" ? "amber" : "emerald";
}
