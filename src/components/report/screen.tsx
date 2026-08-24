"use client";

/**
 * Renderer layar Laporan (mockup docs/Dashboard & Reports/4–18.png). Menerima
 * model data murni (ReportScreen) dan menyusun: baris KPI besar, grid panel
 * (radar/bar/pie/progress/journey/stepper/map/empty), tabel detail dengan badge
 * status berwarna, tombol Export PDF/Excel, dan rail rekomendasi opsional.
 */
import { useState, type ComponentType } from "react";
import {
  ShieldAlert, ShieldCheck, Shield, ClipboardCheck, ClipboardList, XCircle, CheckCircle2, Sprout, Leaf,
  Target, Users, FileText, FileSpreadsheet, Package, Boxes, Bookmark, Factory, Scale, PieChart as PieIcon,
  Wallet, Clock, Briefcase, AlertTriangle, TrendingUp, TrendingDown, Map as MapIcon, Ruler, Pentagon,
  Droplets, CalendarDays, CalendarClock, Gauge, TreePine, TreePalm, FlaskConical, Beaker, Info, Wrench,
  Zap, BarChart3, LineChart as LineIcon, Landmark, Coins, ListChecks, ChevronRight, X, Trees, MapPin,
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie,
} from "recharts";
import { EstateMap } from "@/components/dashboard/EstateMap";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import type { ReportScreen, ScreenPanel, ScreenKpi, Tone, ProgressItem, RecoRail } from "@/lib/report/screenTypes";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  ShieldAlert, ShieldCheck, Shield, ClipboardCheck, ClipboardList, XCircle, CheckCircle2, Sprout, Leaf,
  Target, Users, FileText, Package, Boxes, Bookmark, Factory, Scale, PieIcon, Wallet, Clock, Briefcase,
  AlertTriangle, TrendingUp, TrendingDown, Map: MapIcon, Ruler, Pentagon, Droplets, CalendarDays,
  CalendarClock, Gauge, TreePine, TreePalm, FlaskConical, Beaker, Info, Wrench, Zap, BarChart3,
  LineChart: LineIcon, Landmark, Coins, ListChecks, Trees, MapPin,
};
const Icon = ({ name, className }: { name?: string; className?: string }) => {
  const C = (name && ICONS[name]) || Info;
  return <C className={className} />;
};

const TONE: Record<Tone, { fg: string; bg: string; ring: string }> = {
  ok: { fg: "text-emerald-700", bg: "bg-emerald-50", ring: "text-emerald-600" },
  perhatian: { fg: "text-amber-700", bg: "bg-amber-50", ring: "text-amber-600" },
  kritis: { fg: "text-red-700", bg: "bg-red-50", ring: "text-red-600" },
  belum: { fg: "text-slate-500", bg: "bg-slate-50", ring: "text-slate-500" },
  info: { fg: "text-sky-700", bg: "bg-sky-50", ring: "text-sky-600" },
  default: { fg: "text-slate-800", bg: "bg-slate-50", ring: "text-emerald-600" },
};

// ── Deteksi tone dari teks status pada sel tabel ─────────────────────────────
const GREEN = ["approved", "disetujui", "submitted", "aman", "cukup", "sesuai", "terdaftar", "net sink", "traceable", "tepat waktu", "seimbang", "internal", "ada", "s1", "grade a", "a", "sangat sesuai", "favorable"];
const AMBER = ["diajukan", "menunggu", "draft", "on track", "proses", "perlu validasi lokal", "s2", "grade b", "b", "cukup sesuai", "belum dijadwalkan"];
const RED = ["ditolak", "terlambat", "tidak tersedia", "kurang", "tidak sesuai", "belum siap", "unfavorable", "s3", "n", "grade c", "c", "kritis"];
function textTone(s: string): Tone | null {
  const t = s.trim().toLowerCase();
  if (!t || t === "—") return null;
  if (GREEN.includes(t)) return "ok";
  if (AMBER.includes(t)) return "perhatian";
  if (RED.includes(t)) return "kritis";
  return null;
}
const PILL: Record<Tone, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  perhatian: "bg-amber-50 text-amber-700 border-amber-200",
  kritis: "bg-red-50 text-red-700 border-red-200",
  belum: "bg-slate-50 text-slate-500 border-slate-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  default: "bg-slate-50 text-slate-600 border-slate-200",
};

const SPAN: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" };

export function ReportScreenView({ screen, base }: { screen: ReportScreen; base: string }) {
  const hasRail = !!screen.rail;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{screen.title}</h1>
          {screen.subtitle && <p className="text-sm text-slate-500">{screen.subtitle}</p>}
        </div>
        {screen.headerAction && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white">
            <Icon name={screen.headerAction.icon} className="h-4 w-4" /> {screen.headerAction.label}
          </span>
        )}
      </div>

      <div className={hasRail ? "flex flex-col gap-4 xl:flex-row" : ""}>
        <div className={hasRail ? "min-w-0 flex-1 space-y-4" : "space-y-4"}>
          {/* KPI row */}
          <div className={"grid grid-cols-1 gap-4 sm:grid-cols-2 " + (screen.kpis.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
            {screen.kpis.map((k, i) => <KpiCard key={i} kpi={k} />)}
          </div>

          {/* Panels */}
          {screen.panels.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {screen.panels.map((p, i) => (
                <div key={i} className={SPAN[p.span ?? 1]}>
                  <PanelBox panel={p} />
                </div>
              ))}
            </div>
          )}

          {/* Detail table */}
          <DetailTable screen={screen} base={base} />
        </div>

        {hasRail && <aside className="w-full shrink-0 xl:w-[330px]"><Rail rail={screen.rail!} /></aside>}
      </div>
    </div>
  );
}

// ── KPI ───────────────────────────────────────────────────────────────────
function KpiCard({ kpi }: { kpi: ScreenKpi }) {
  const tone = TONE[kpi.tone ?? "default"];
  const alert = kpi.tone === "kritis";
  return (
    <div className={"rounded-xl border bg-white p-4 " + (alert ? "border-red-200 bg-red-50/40" : "border-slate-200")}>
      <div className="flex items-start justify-between">
        <span className={"inline-flex h-10 w-10 items-center justify-center rounded-lg " + tone.bg}>
          <Icon name={kpi.icon} className={"h-5 w-5 " + tone.ring} />
        </span>
        {kpi.sub && <span className={"text-[11px] font-medium " + tone.fg}>{kpi.sub}</span>}
      </div>
      <p className="mt-3 text-xs text-slate-500">{kpi.label}</p>
      <p className={"text-2xl font-bold leading-tight " + (kpi.tone && kpi.tone !== "default" ? tone.fg : "text-slate-800")}>
        {kpi.value}{kpi.unit && <span className="ml-1 text-sm font-medium text-slate-500">{kpi.unit}</span>}
      </p>
    </div>
  );
}

// ── Panel wrapper + renderer ─────────────────────────────────────────────────
function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="h-full rounded-xl border border-slate-200 bg-white p-4">
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>}
      {children}
    </section>
  );
}

function PanelBox({ panel }: { panel: ScreenPanel }) {
  switch (panel.kind) {
    case "radar": return <Panel title={panel.title}><RadarPanel panel={panel} /></Panel>;
    case "bars": return <Panel title={panel.title}><BarsPanel panel={panel} /></Panel>;
    case "pie": return <Panel title={panel.title}><PiePanel panel={panel} /></Panel>;
    case "progressList": return <Panel title={panel.title}><ProgressList items={panel.items} scroll={panel.scroll} /></Panel>;
    case "statCards": return <Panel title={panel.title}><StatCards cards={panel.cards} cols={panel.cols} /></Panel>;
    case "journey": return <Panel title={panel.title}><Journey columns={panel.columns} /></Panel>;
    case "stepper": return <Panel title={panel.title}><Stepper steps={panel.steps} note={panel.note} /></Panel>;
    case "map": return <Panel title={panel.title}><EstateMap status={panel.status} heightClass="h-[240px]" />{panel.note && <p className="mt-2 text-[11px] text-slate-500">{panel.note}</p>}</Panel>;
    case "empty": return <Panel title={panel.title}><EmptyBox icon={panel.icon} message={panel.message} desc={panel.desc} /></Panel>;
  }
}

function RadarPanel({ panel }: { panel: Extract<ScreenPanel, { kind: "radar" }> }) {
  return (
    <>
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={panel.axes} outerRadius="72%">
          <PolarGrid stroke="#e5e2da" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "#45443f" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#cfcbc1" }} />
          <Radar name="Nilai Aktual" dataKey="actual" stroke="#1a6c2c" fill="#1a6c2c" fillOpacity={0.28} />
          <Radar name="Ambang S2" dataKey="ambang" stroke="#a8a49a" strokeDasharray="4 4" fill="none" />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </RadarChart>
      </ResponsiveContainer>
      {panel.legend && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px]">
          {panel.legend.map((l) => (
            <li key={l.label} className="flex items-center justify-between">
              <span className="text-slate-600">{l.label}</span>
              <span className={"rounded px-1.5 py-0.5 font-medium border " + (PILL[textTone(l.class) ?? "default"])}>{l.class}</span>
            </li>
          ))}
        </ul>
      )}
      {panel.note && <p className="mt-2 text-[11px] text-slate-500">{panel.note}</p>}
    </>
  );
}

function BarsPanel({ panel }: { panel: Extract<ScreenPanel, { kind: "bars" }> }) {
  const horizontal = panel.horizontal;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={panel.data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        {horizontal ? (
          <>
            <XAxis type="number" tick={{ fontSize: 10, fill: "#a8a49a" }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#45443f" }} width={90} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#5c5a55" }} />
            <YAxis tick={{ fontSize: 10, fill: "#a8a49a" }} width={44} />
          </>
        )}
        <Tooltip formatter={(v) => (panel.unit ? `${v} ${panel.unit}` : v)} />
        <Bar dataKey="value" radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}>
          {panel.data.map((d, i) => <Cell key={i} fill={d.color ?? "#1f8033"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PiePanel({ panel }: { panel: Extract<ScreenPanel, { kind: "pie" }> }) {
  const total = panel.data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <ResponsiveContainer width={150} height={150}>
          <PieChart>
            <Pie data={total > 0 ? panel.data : [{ name: "—", value: 1, color: "#e5e2da" }]} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={68}>
              {(total > 0 ? panel.data : [{ color: "#e5e2da" }]).map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            {total > 0 && <Tooltip />}
          </PieChart>
        </ResponsiveContainer>
        {(panel.centerValue || panel.centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {panel.centerValue && <span className="text-sm font-bold text-slate-700">{panel.centerValue}</span>}
            {panel.centerLabel && <span className="text-[10px] text-slate-500">{panel.centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex-1 space-y-1.5 text-xs">
        {panel.data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} /> {d.name}</span>
            <span className="tabular-nums font-medium text-slate-700">{total > 0 ? `${Math.round((d.value / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgressList({ items, scroll }: { items: ProgressItem[]; scroll?: boolean }) {
  return (
    <ul className={"space-y-2.5 " + (scroll ? "max-h-[220px] overflow-y-auto pr-1" : "")}>
      {items.map((it, i) => {
        const tone = TONE[it.tone ?? "default"];
        return (
          <li key={i} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-600">
                {it.icon && <Icon name={it.icon} className={"h-4 w-4 " + tone.ring} />}{it.label}
              </span>
              <span className="flex items-center gap-2">
                {it.value && <span className={"tabular-nums font-medium " + (it.tone ? tone.fg : "text-slate-700")}>{it.value}</span>}
                {it.badge && <span className={"rounded border px-1.5 py-0.5 text-[10px] font-medium " + PILL[it.badge.tone]}>{it.badge.text}</span>}
              </span>
            </div>
            {typeof it.pct === "number" && (
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                <div className={"h-1.5 rounded-full " + (it.tone === "kritis" ? "bg-red-500" : it.tone === "perhatian" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.max(0, Math.min(100, it.pct))}%` }} />
              </div>
            )}
            {it.sub && <p className="mt-0.5 text-[11px] text-slate-500">{it.sub}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function StatCards({ cards, cols = 2 }: { cards: ProgressItem[]; cols?: 2 | 3 | 4 }) {
  const cls = cols === 4 ? "sm:grid-cols-4" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div className={"grid grid-cols-1 gap-3 " + cls}>
      {cards.map((c, i) => {
        const tone = TONE[c.tone ?? "default"];
        return (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <div className="flex items-center gap-2">
              {c.icon && <span className={"inline-flex h-8 w-8 items-center justify-center rounded-lg " + tone.bg}><Icon name={c.icon} className={"h-4 w-4 " + tone.ring} /></span>}
              <span className="text-xs text-slate-500">{c.label}</span>
            </div>
            <p className={"mt-1.5 text-lg font-bold " + (c.tone && c.tone !== "default" ? tone.fg : "text-slate-800")}>{c.value ?? "—"}</p>
            {typeof c.pct === "number" && (
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, c.pct))}%` }} />
              </div>
            )}
            {c.badge && <span className={"mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium " + PILL[c.badge.tone]}>{c.badge.text}</span>}
            {c.sub && <p className="mt-0.5 text-[11px] text-slate-500">{c.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Journey({ columns }: { columns: Extract<ScreenPanel, { kind: "journey" }>["columns"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {columns.map((col, i) => {
        const tone = TONE[col.tone];
        return (
          <div key={i} className="rounded-lg border border-slate-100">
            <div className={"flex items-center justify-between rounded-t-lg px-3 py-2 " + tone.bg}>
              <span className={"text-xs font-semibold " + tone.fg}>{col.title}</span>
              <span className={"text-sm font-bold " + tone.fg}>{col.count}</span>
            </div>
            <div className="space-y-2 p-3">
              {col.items.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-slate-500"><ClipboardList className="mx-auto mb-1 h-6 w-6 text-slate-300" />Tidak ada tugas</div>
              ) : col.items.map((it, j) => (
                <div key={j} className="rounded-md border border-slate-100 bg-white p-2 text-[11px]">
                  <div className="flex items-center justify-between"><span className="font-semibold text-slate-700">{it.title}</span>{it.tag && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{it.tag}</span>}</div>
                  {it.sub && <p className="mt-0.5 text-slate-500">{it.sub}</p>}
                  {it.target && <p className="mt-1 flex items-center gap-1 text-slate-500"><CalendarDays className="h-3 w-3" />{it.target}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stepper({ steps, note }: { steps: Extract<ScreenPanel, { kind: "stepper" }>["steps"]; note?: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-1 py-2">
        {steps.map((s, i) => {
          const tone = TONE[s.tone ?? "ok"];
          return (
            <div key={i} className="flex flex-1 items-center gap-1">
              <div className="flex flex-1 flex-col items-center gap-1 text-center">
                <span className={"inline-flex h-9 w-9 items-center justify-center rounded-full " + tone.bg}><Icon name={s.icon} className={"h-4 w-4 " + tone.ring} /></span>
                <span className="text-[11px] font-medium text-slate-600">{s.label}</span>
                {s.sub && <span className="text-[9px] text-slate-500">{s.sub}</span>}
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
            </div>
          );
        })}
      </div>
      {note && <p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700">{note}</p>}
    </>
  );
}

function EmptyBox({ icon, message, desc }: { icon: string; message: string; desc?: string }) {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-1.5 text-center">
      <Icon name={icon} className="h-9 w-9 text-slate-300" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
      {desc && <p className="max-w-[80%] text-[11px] text-slate-500">{desc}</p>}
    </div>
  );
}

// ── Tabel detail ─────────────────────────────────────────────────────────────
function DetailTable({ screen, base }: { screen: ReportScreen; base: string }) {
  const { columns, rows, title, footNote } = screen.table;
  // AI-48: kolom sekunder dikumpulkan sekali, bukan per baris.
  const kolomDetail = columns
    .map((c, i) => ({ i, label: c.label, detail: c.detail }))
    .filter((c) => c.detail);
  const adaDetail = kolomDetail.length > 0;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <div className="flex items-center gap-2">
          <a href={`${base}/pdf`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <FileText className="h-3.5 w-3.5 text-red-500" /> Export PDF
          </a>
          <a href={`${base}/excel`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Export Excel
          </a>
        </div>
      </div>
      <ResponsiveTable>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {columns.map((c, i) => (
                <th key={i} data-detail={c.detail || undefined} className={"whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-slate-500 " + (c.align === "right" ? "text-right" : "text-left")}>{c.label}</th>
              ))}
              {/* AI-48: sel pengungkap khusus kartu mobile. Hanya tampil di bawah
                  768px (lihat .rt-cards td[data-more] di globals.css), jadi tabel
                  desktop persis seperti sebelumnya — termasuk jumlah kolomnya. */}
              {adaDetail && <th data-more aria-hidden />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">Belum ada data.</td></tr>
            ) : rows.map((row, ri) => (
              <tr key={ri} className="border-t border-slate-50 hover:bg-slate-50/40">
                {row.map((cell, ci) => (
                  <Td key={ci} cell={cell} label={columns[ci]?.label} align={columns[ci]?.align}
                      isNew={columns[ci]?.kind === "new"} isDetail={columns[ci]?.detail} />
                ))}
                {adaDetail && (
                  <td data-more className="px-3 py-2">
                    {/* <details> native: tanpa JavaScript pun bisa dibuka. */}
                    <details className="text-xs">
                      <summary className="cursor-pointer list-none font-medium text-emerald-700 [&::-webkit-details-marker]:hidden">
                        Detail ({kolomDetail.length}) ▾
                      </summary>
                      <dl className="mt-1.5 space-y-1">
                        {kolomDetail.map(({ i, label }) => (
                          <div key={i} className="flex justify-between gap-3">
                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                            <dd className="text-right text-slate-700">{row[i] === null || row[i] === "" ? "—" : String(row[i])}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
      {footNote && <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">{footNote}</p>}
    </section>
  );
}

function Td({ cell, label, align, isNew, isDetail }: { cell: string | number | null; label?: string; align?: "left" | "right"; isNew?: boolean; isDetail?: boolean }) {
  const txt = cell === null || cell === "" ? "—" : String(cell);
  const tone = typeof cell === "string" ? textTone(cell) : null;
  return (
    <td data-label={label} data-empty={txt === "—"} data-detail={isDetail || undefined} className={"whitespace-nowrap px-3 py-2 " + (align === "right" ? "text-right tabular-nums " : "") + (isNew ? "bg-blue-50/30 text-slate-600" : "text-slate-700")}>
      {tone ? <span className={"inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium " + PILL[tone]}>{txt}</span> : txt}
    </td>
  );
}

// ── Rail rekomendasi ─────────────────────────────────────────────────────────
function Rail({ rail }: { rail: RecoRail }) {
  const [tab, setTab] = useState(0);
  return (
    <section className="sticky top-4 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-base font-bold text-slate-800">{rail.title}</h3>
        <X className="h-4 w-4 text-slate-300" />
      </div>
      {rail.tabs && (
        <div className="flex gap-1 border-b border-slate-100 px-3 pt-2 text-xs">
          {rail.tabs.map((t, i) => (
            <button key={i} onClick={() => setTab(i)} className={"rounded-t-md px-2.5 py-1.5 font-medium " + (i === tab ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-600")}>{t}</button>
          ))}
        </div>
      )}
      <div className="space-y-4 p-4">
        {rail.summary && (
          <div className="flex gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
            <Leaf className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-xs leading-relaxed text-slate-600">{rail.summary}</p>
          </div>
        )}
        {rail.priorities && (
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Prioritas Perbaikan</p>
            <ol className="space-y-3">
              {rail.priorities.map((p) => (
                <li key={p.n} className="flex gap-2.5">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{p.n}</span>
                  <div><p className="text-xs font-semibold text-slate-700">{p.title}</p><p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{p.text}</p></div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {rail.general && (
          <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
            <p className="mb-1.5 text-xs font-semibold text-amber-800">{rail.general.heading}</p>
            <ul className="space-y-1 text-[11px] text-slate-600">
              {rail.general.items.map((it, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-500">•</span>{it}</li>)}
            </ul>
          </div>
        )}
        {rail.target && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs">
            <Target className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="text-slate-600">{rail.target.label} <span className="font-bold text-emerald-700">{rail.target.value}</span> {rail.target.sub && <span className="text-slate-500">{rail.target.sub}</span>}</span>
          </div>
        )}
        {rail.action && (
          <button className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
            <CalendarClock className="h-4 w-4" /> {rail.action}
          </button>
        )}
      </div>
    </section>
  );
}
