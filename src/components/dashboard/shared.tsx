// Building2/CalendarDays/Tag/ChevronDown/Bell dulu milik DashboardFilterBar —
// bilah "filter" yang isinya <div> tanpa <select>/<form>/tautan, jadi diklik tidak
// melakukan apa pun. Digantikan FilterBar bersama (AI-24) dan dihapus di sini.
import type { LucideIcon } from "lucide-react";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { cn } from "@/lib/utils";

/** KPI card: ikon bulat + angka besar + catatan. */
export function KpiCard({ icon: Icon, label, value, unit, note, tone = "default", badge, iconTone = "emerald", testId }: {
  icon: LucideIcon; label: string; value: string; unit?: string; note?: string;
  tone?: "default" | "pos" | "neg"; badge?: { text: string; tone: "warn" | "ok" }; iconTone?: "emerald" | "red" | "amber" | "sky";
  /**
   * Pegangan uji untuk NILAI kartu ini. Ada karena scripts/at-verify.mjs perlu
   * membaca satu angka tertentu, dan mencocokkan prosa di sekitarnya rapuh.
   * Sebelum penanda ini, uji "angka berubah saat difilter" membandingkan seluruh
   * pola `>angka<` di halaman -- pola itu TIDAK menangkap nilai KPI (dirender
   * sebagai "Rp 1,2 jt" dalam satu node), jadi ujinya melaporkan "tidak berubah"
   * padahal berubah. Uji yang salah baca sama buruknya dengan fitur yang rusak.
   */
  testId?: string;
}) {
  const empty = value === "—";
  const iconCls = {
    emerald: "bg-emerald-50 text-emerald-600", red: "bg-red-50 text-red-500",
    amber: "bg-amber-50 text-amber-600", sky: "bg-sky-50 text-sky-600",
  }[iconTone];
  const valueCls = empty ? "text-slate-300" : tone === "neg" ? "text-red-700" : tone === "pos" ? "text-emerald-700" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className={cn("rounded-full p-2.5", iconCls)}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">{label}</p>
          <p data-testid={testId} className={cn("mt-0.5 text-2xl font-bold tabular-nums", valueCls)}>
            {value}{!empty && unit ? <span className="ml-1 text-sm font-semibold text-slate-500">{unit}</span> : null}
          </p>
        </div>
      </div>
      {(note || badge) && (
        <div className="mt-2 flex items-center gap-2">
          {badge && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", badge.tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{badge.text}</span>}
          {note && <p className="text-xs text-slate-500">{note}</p>}
        </div>
      )}
    </div>
  );
}

/** Panel bertajuk. */
export function Panel({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white", className)}>
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {right}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

/** Empty-state di dalam panel. */
export function EmptyPanel({ icon: Icon, title, desc, action }: { icon: LucideIcon; title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="rounded-full bg-slate-100 p-3 text-slate-300"><Icon className="h-6 w-6" /></span>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-slate-500">{desc}</p>
      {action}
    </div>
  );
}

export type InsightRow = { area: string; temuan: string; rekomendasi: string; dampak: string; status: string };

/** Tabel Insight & Rekomendasi (Prioritas ber-badge angka). */
export function InsightTable({ rows }: { rows: InsightRow[] }) {
  const rankColor = ["#dc2626", "#f59e0b", "#eab308", "#1f8033", "#5c5a55"];
  return (
    <ResponsiveTable>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Prioritas</th>
            <th className="px-3 py-2 font-medium">Area</th>
            <th className="px-3 py-2 font-medium">Temuan</th>
            <th className="px-3 py-2 font-medium">Rekomendasi</th>
            <th className="px-3 py-2 font-medium">Dampak</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 align-top last:border-0">
              <td data-label="Prioritas" className="px-3 py-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white" style={{ backgroundColor: rankColor[Math.min(i, 4)] }}>{i + 1}</span>
              </td>
              <td data-label="Area" className="px-3 py-2 font-medium text-slate-700">{r.area}</td>
              <td data-label="Temuan" className="max-w-[260px] px-3 py-2 text-slate-600">{r.temuan}</td>
              <td data-label="Rekomendasi" className="max-w-[260px] px-3 py-2 text-slate-600">{r.rekomendasi}</td>
              <td data-label="Dampak" className="px-3 py-2 text-xs text-slate-500">↓ {r.dampak}</td>
              <td data-label="Status" className="px-3 py-2"><span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}
