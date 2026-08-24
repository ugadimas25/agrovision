// Building2/CalendarDays/Tag/ChevronDown/Bell dulu dipakai FilterBar privat yang
// isinya <div> mati; ikon-ikonnya pindah ke komponen FilterBar bersama (AI-24).
import {
  Leaf, ChevronRight,
  Sprout, Wheat, Database, MapPin, Shovel, TreePine, Droplets, FlaskConical,
} from "lucide-react";
import { EstateMap } from "@/components/dashboard/EstateMap";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/report/types";
import type { OpDashboardView, Kpi, JourneyStage, TimelineRow, OpInsight, StageStatus } from "@/lib/report/opDashboard";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/dashboard/FilterBar";
import type { DashboardFilter } from "@/lib/report/filters";

type Opt = { value: string; label: string };

const KPI_ICON = { seedprep: Sprout, survival: Leaf, harvest: Wheat, data: Database };
const STAGE_ICON = { map: MapPin, prep: Shovel, seed: Sprout, grow: TreePine, harvest: Wheat };
const INS_ICON = { water: Droplets, k: FlaskConical, data: Database, leaf: Leaf };
const STATE_COLOR = { selesai: "#1f8033", berjalan: "#2563eb", planned: "#a8a49a" };
const PRIO = {
  Tinggi: { fg: "#b91c1c", bg: "#fef2f2" },
  Menengah: { fg: "#b45309", bg: "#fffbeb" },
  Rendah: { fg: "#45443f", bg: "#f2f0eb" },
};

export function OperationalDashboardView({
  data, filter, estates, blocks, periods, crops,
}: {
  data: OpDashboardView;
  // `company` DIHAPUS dari props: dulu ia nilai chip "Estate" pada FilterBar
  // privat. Bilah filter bersama membaca daftar estate yang sungguhan, jadi nama
  // entitas tidak lagi punya tempat di sini.
  filter: DashboardFilter;
  estates: Opt[];
  blocks: Opt[];
  periods: Opt[];
  crops: Opt[];
}) {
  return (
    <div className="space-y-4">
      {/* AI-24: bilah filter SUNGGUHAN, satu komponen bersama. Yang digantinya
          adalah salinan lokal berisi <div> ber-ikon ChevronDown — terlihat seperti
          dropdown tapi diklik tidak melakukan apa pun. */}
      <FilterBar basePath="/dashboard" filter={filter}
                 estates={estates} blocks={blocks} periods={periods} crops={crops} />

      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard Operasional</h1>
        <p className="text-sm text-slate-500">Ringkasan kinerja operasional estate dan status budidaya terkini.</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
      </div>

      {/* Perjalanan Budidaya + Peta */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-3">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Perjalanan Budidaya</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {data.journey.map((s, i) => (
              <div key={s.name} className="flex flex-1 items-start gap-2">
                <Stage stage={s} />
                {i < data.journey.length - 1 && <ChevronRight className="mt-8 hidden h-4 w-4 shrink-0 text-slate-300 sm:block" />}
              </div>
            ))}
          </div>
          <Legend />
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800">Peta Blok Estate</h2>
          </div>
          <div className="px-3 pb-3">
            <EstateMap status={data.journey[0]?.status ?? "belum"} heightClass="h-[300px]" />
          </div>
        </section>
      </div>

      {/* Timeline + Insight */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Aktivitas Lapangan (Timeline)</h2>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <Dot c={STATE_COLOR.selesai} /> Selesai <Dot c={STATE_COLOR.berjalan} /> Berjalan <Dot c={STATE_COLOR.planned} /> Planned
            </div>
          </div>
          <Timeline data={data} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Insight &amp; Rekomendasi</h2>
          <div className="space-y-2">
            {data.insights.map((ins, i) => <InsightRow key={i} ins={ins} />)}
          </div>
        </section>
      </div>
    </div>
  );
}


function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = KPI_ICON[kpi.icon];
  const empty = kpi.value === "—";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-emerald-50 p-2.5 text-emerald-600"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{kpi.label}</p>
          <p className={cn("mt-0.5 text-3xl font-bold tabular-nums", empty ? "text-slate-300" : "text-slate-800")}>
            {kpi.value}{!empty && kpi.unit ? <span className="ml-1 text-base font-semibold text-slate-500">{kpi.unit}</span> : null}
          </p>
        </div>
      </div>
      {kpi.note && <p className="mt-2 text-xs text-slate-500">{kpi.note}</p>}
    </div>
  );
}

function StageBadge({ status }: { status: StageStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ color: c.fg, backgroundColor: c.bg, border: `1px solid ${c.border}` }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Stage({ stage }: { stage: JourneyStage }) {
  const Icon = STAGE_ICON[stage.icon];
  return (
    <div className="flex-1">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="rounded-lg bg-slate-100 p-1.5 text-slate-500"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mb-1.5 text-xs font-medium text-slate-600">{stage.name}</p>
      <div className="mb-2"><StageBadge status={stage.status} /></div>
      <dl className="space-y-1">
        {stage.metrics.map((m) => (
          <div key={m.label} className="text-[11px] leading-tight">
            <dt className="text-slate-500">{m.label}</dt>
            <dd className={cn("font-semibold", m.value === "—" ? "text-slate-300" : "text-slate-700")}>{m.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Legend() {
  const items: [StageStatus, string][] = [["ok", "OK"], ["perhatian", "Perhatian"], ["kritis", "Kritis"], ["belum", "Belum ada data"]];
  return (
    <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
      {items.map(([s, l]) => (
        <span key={s} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[s].fg }} />{l}</span>
      ))}
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: c }} />;
}

function Timeline({ data }: { data: OpDashboardView }) {
  return (
    <div>
      <p className="mb-2 text-[11px] text-slate-500">{data.timelineLabel}</p>
      <div className="space-y-2.5">
        {data.timeline.map((row) => <TimelineRowView key={row.activity} row={row} />)}
      </div>
    </div>
  );
}

function TimelineRowView({ row }: { row: TimelineRow }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-slate-600">{row.activity}</span>
      <div className="relative h-3 flex-1 rounded-full bg-slate-100">
        {"empty" in row && row.empty ? (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-300">— belum ada</span>
        ) : (
          <span
            className="absolute top-0 h-3 rounded-full"
            style={{ left: `${Math.max(0, Math.min(97, row.startPct))}%`, width: `${Math.max(3, Math.min(100, row.widthPct))}%`, backgroundColor: STATE_COLOR[row.state] }}
            title={row.state}
          />
        )}
      </div>
    </div>
  );
}

function InsightRow({ ins }: { ins: OpInsight }) {
  const Icon = INS_ICON[ins.icon];
  const p = PRIO[ins.priority];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <span className="rounded-lg bg-white p-1.5 text-emerald-600 ring-1 ring-slate-100"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">{ins.title}</p>
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color: p.fg, backgroundColor: p.bg }}>Prioritas {ins.priority}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{ins.text}</p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
    </div>
  );
}
