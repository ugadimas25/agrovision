import { redirect } from "next/navigation";
import { TrendingUp, Scale, Wheat, Info } from "lucide-react";
import { requireContext } from "@/lib/session";
import { reflectedCosts } from "@/lib/repo/pricing";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatIdr, formatIdrShort, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Revenue — AgroVision" };

/**
 * Pendapatan (Revenue) — ter-refleksi dari PANEN DISETUJUI × tarif komoditas
 * (price list). Tidak ada input pendapatan manual (docs/11 §4): angka muncul
 * sendiri saat panen disetujui di Inbox Approval. Kosong = "—", bukan 0.
 */
export default async function RevenuePage() {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const t = getDict(await getLocale());
  const reflection = await reflectedCosts(ctx);

  const hasRevenue = reflection.revenueLines.length > 0;
  const totalTon = reflection.revenueLines.reduce((s, l) => s + l.tonnage, 0);
  const balance = reflection.balanceIdr;

  return (
    <div>
      <PageHeader title={t("nav.revenue")} subtitle={t("sub.revenue")} />

      <div className="mb-5 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p className="text-sm leading-relaxed text-sky-900">
          Tidak ada input pendapatan manual. Pendapatan = <strong>tonase panen yang disetujui × tarif
          komoditas</strong> di price list. Angka muncul otomatis begitu panen pertama disetujui di
          Inbox Approval, dan ikut menghitung laba/rugi di Refleksi Biaya.
        </p>
      </div>

      {/* KPI */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi icon={TrendingUp} label="Total pendapatan" value={hasRevenue ? formatIdrShort(reflection.totalRevenueIdr) : EMPTY} title={hasRevenue ? formatIdr(reflection.totalRevenueIdr) : undefined} hint={hasRevenue ? "dari panen disetujui" : "menunggu panen disetujui"} />
        <Kpi icon={Wheat} label="Total tonase" value={hasRevenue ? `${formatNumber(totalTon)} ton` : EMPTY} />
        <Kpi icon={Scale} label="Laba / rugi" value={balance === null ? EMPTY : formatIdrShort(balance)} title={balance === null ? undefined : formatIdr(balance)} tone={balance === null ? undefined : balance < 0 ? "neg" : "pos"} hint={balance === null ? "butuh pendapatan" : "pendapatan − biaya ter-refleksi"} />
      </div>

      {/* Rincian pendapatan per komoditas */}
      <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Pendapatan per komoditas = tonase × tarif
        </h2>
        {!hasRevenue ? (
          <EmptyState
            icon={TrendingUp}
            title="Belum ada pendapatan"
            description="Setujui panen di Inbox Approval untuk melihat pendapatan muncul di sini — otomatis dari tonase × tarif komoditas."
          />
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Komoditas</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tonase</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tarif / ton</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pendapatan</th>
                </tr>
              </thead>
              <tbody>
                {reflection.revenueLines.map((l) => (
                  <tr key={l.cropCode} className="border-b border-slate-50 last:border-0">
                    <td data-label="Komoditas" className="px-4 py-2.5 text-slate-700">{l.category}</td>
                    <td data-label="Tonase" className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(l.tonnage)} ton</td>
                    <td data-label="Tarif / ton" className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatIdrShort(l.rateIdr)}</td>
                    <td data-label="Pendapatan" className="px-4 py-2.5 text-right font-medium tabular-nums text-emerald-700">{formatIdr(l.amountIdr)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2.5 text-slate-700" colSpan={3}>Total pendapatan</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-800">{formatIdr(reflection.totalRevenueIdr)}</td>
                </tr>
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </section>

      {/* Tarif komoditas (price list) */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Tarif komoditas <span className="font-normal text-slate-500">— diterbitkan di Refleksi Biaya (super admin)</span>
        </h2>
        <ResponsiveTable>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Kode</th>
                <th className="px-4 py-2.5 font-medium">Komoditas</th>
                <th className="px-4 py-2.5 text-right font-medium">Tarif</th>
              </tr>
            </thead>
            <tbody>
              {reflection.revenueRates.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td data-label="Kode" className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.code}</td>
                  <td data-label="Komoditas" className="px-4 py-2.5 text-slate-700">{p.category}{p.note ? <span className="ml-1 text-xs text-slate-500">· {p.note}</span> : null}</td>
                  <td data-label="Tarif" className="px-4 py-2.5 text-right tabular-nums text-slate-800">{formatIdr(p.rateIdr)}<span className="text-xs text-slate-500"> / {p.unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  title,
  hint,
  tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  title?: string;
  hint?: string;
  tone?: "pos" | "neg";
}) {
  const empty = value === EMPTY;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-emerald-600" />
        <p className="text-xs text-slate-500">{label}</p>
      </div>
      <p
        className={cn(
          "mt-1.5 text-xl font-bold tabular-nums",
          empty ? "text-slate-300" : tone === "neg" ? "text-red-700" : tone === "pos" ? "text-emerald-700" : "text-slate-800",
        )}
        title={title}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
