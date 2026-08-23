import { redirect } from "next/navigation";
import { Calculator, Info, TrendingUp, Scale } from "lucide-react";
import { requireContext } from "@/lib/session";
import { getPriceList, reflectedCosts } from "@/lib/repo/pricing";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatIdr, formatIdrShort, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriceRateEditor } from "./PriceRateEditor";

export const metadata = { title: "Refleksi Biaya — AgroVision" };

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  // §17 Keputusan 3: menerbitkan tarif = super_admin SAJA. Ditegakkan berlapis —
  // policy price_list_writer_* (0041), self-gate app.publish_price(), dan
  // requireRole di setPriceRateAction. Ini hanya menyembunyikan tombol yang
  // pasti gagal.
  const canEdit = ctx.session.role === "super_admin";

  const [prices, reflection] = await Promise.all([getPriceList(ctx), reflectedCosts(ctx)]);
  const costRates = prices.filter((p) => p.kind === "cost");
  const revenueRates = prices.filter((p) => p.kind === "revenue");

  // Revenue nyata dari panen disetujui × tarif; null bila belum ada panen.
  const hasRevenue = reflection.revenueLines.length > 0;
  const balance = reflection.balanceIdr;

  return (
    <div>
      <PageHeader
        title="Refleksi Biaya"
        subtitle="Accounting sebagai refleksi: biaya = volume operasional × price list."
        titleAdornment={<span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">konsep docs/11 §4</span>}
      />

      <div className="mb-5 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p className="text-sm leading-relaxed text-sky-900">
          Tidak ada input biaya manual. Setiap biaya di bawah dihitung otomatis dari <strong>volume
          operasional nyata</strong> (luas blok, luas persiapan lahan, jumlah bibit, jumlah pupuk)
          dikalikan <strong>tarif</strong> di price list. Ubah tarif → seluruh angka ikut berubah.
          Price list adalah <em>single point of failure</em> (docs/11 §10a): hanya approver/super
          admin yang boleh mengubah, dan idealnya di-versioning per periode.
        </p>
      </div>

      {/* KPI ringkas */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5"><Calculator className="h-4 w-4 text-emerald-600" /><p className="text-xs text-slate-500">Biaya ter-refleksi</p></div>
          <p className="mt-1.5 text-xl font-bold tabular-nums text-slate-800">{formatIdr(reflection.totalCostIdr)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-emerald-600" /><p className="text-xs text-slate-500">Revenue</p></div>
          <p className={cn("mt-1.5 text-xl font-bold tabular-nums", hasRevenue ? "text-slate-800" : "text-slate-300")}>{hasRevenue ? formatIdr(reflection.totalRevenueIdr) : EMPTY}</p>
          <p className="mt-0.5 text-xs text-slate-500">{hasRevenue ? "dari panen disetujui" : "menunggu panen disetujui"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5"><Scale className="h-4 w-4 text-emerald-600" /><p className="text-xs text-slate-500">Laba / rugi</p></div>
          <p className={cn("mt-1.5 text-xl font-bold tabular-nums", balance === null ? "text-slate-300" : balance < 0 ? "text-red-700" : "text-emerald-700")}>{balance === null ? EMPTY : formatIdr(balance)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{balance === null ? "butuh revenue" : "revenue − biaya"}</p>
        </div>
      </div>

      {hasRevenue && (
        <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Revenue ter-refleksi = tonase panen × tarif</h2>
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2 font-medium">Komoditas</th><th className="px-4 py-2 text-right font-medium">Tonase</th><th className="px-4 py-2 text-right font-medium">Tarif/ton</th><th className="px-4 py-2 text-right font-medium">Revenue</th></tr>
              </thead>
              <tbody>
                {reflection.revenueLines.map((l) => (
                  <tr key={l.cropCode} className="border-b border-slate-50 last:border-0">
                    <td data-label="Komoditas" className="px-4 py-2 text-slate-700">{l.category}</td>
                    <td data-label="Tonase" className="px-4 py-2 text-right tabular-nums text-slate-600">{formatNumber(l.tonnage)} ton</td>
                    <td data-label="Tarif/ton" className="px-4 py-2 text-right tabular-nums text-slate-500">{formatIdrShort(l.rateIdr)}</td>
                    <td data-label="Revenue" className="px-4 py-2 text-right tabular-nums font-medium text-emerald-700">{formatIdr(l.amountIdr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </section>
      )}

      {/* Biaya ter-refleksi (volume × tarif) */}
      <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Biaya ter-refleksi = volume × tarif</h2>
        {reflection.lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Belum ada volume operasional untuk direfleksikan.</p>
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Komponen</th>
                  <th className="px-4 py-2 font-medium">Sumber volume</th>
                  <th className="px-4 py-2 text-right font-medium">Volume</th>
                  <th className="px-4 py-2 text-right font-medium">Tarif</th>
                  <th className="px-4 py-2 text-right font-medium">Biaya</th>
                </tr>
              </thead>
              <tbody>
                {reflection.lines.map((l) => (
                  <tr key={l.code} className="border-b border-slate-50 last:border-0">
                    <td data-label="Komponen" className="px-4 py-2 text-slate-700">{l.category}</td>
                    <td data-label="Sumber volume" className="px-4 py-2 text-xs text-slate-500">{l.driverLabel}</td>
                    <td data-label="Volume" className="px-4 py-2 text-right tabular-nums text-slate-600">{formatNumber(l.volume)} {l.unit}</td>
                    <td data-label="Tarif" className="px-4 py-2 text-right tabular-nums text-slate-500">{formatIdrShort(l.rateIdr)}</td>
                    <td data-label="Biaya" className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">{formatIdr(l.amountIdr)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-700" colSpan={4}>Total biaya ter-refleksi</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatIdr(reflection.totalCostIdr)}</td>
                </tr>
              </tbody>
            </table>
          </ResponsiveTable>
        )}
        {reflection.manualCost.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Tarif manual (butuh volume input terpisah, mis. hari kerja):{" "}
            {reflection.manualCost.map((m) => `${m.category} (${formatIdrShort(m.rateIdr)}/${m.unit})`).join(", ")}.
          </p>
        )}
      </section>

      {/* Price list — tarif diterbitkan berversi oleh super_admin (K-02 §14) */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Price List <span className="font-normal text-slate-500">— {canEdit ? "klik tarif untuk menerbitkan versi baru; nilai historis tidak berubah" : "hanya super admin yang bisa menerbitkan tarif"}</span>
        </h2>
        <ResponsiveTable>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Kode</th>
                <th className="px-4 py-2 font-medium">Kategori</th>
                <th className="px-4 py-2 font-medium">Jenis</th>
                <th className="px-4 py-2 text-right font-medium">Tarif</th>
              </tr>
            </thead>
            <tbody>
              {[...costRates, ...revenueRates].map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td data-label="Kode" className="px-4 py-2 font-mono text-xs text-slate-500">{p.code}</td>
                  <td data-label="Kategori" className="px-4 py-2 text-slate-700">{p.category}{p.note ? <span className="ml-1 text-xs text-slate-500">· {p.note}</span> : null}</td>
                  <td data-label="Jenis" className="px-4 py-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", p.kind === "revenue" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                      {p.kind === "revenue" ? "Revenue" : "Biaya"}
                    </span>
                  </td>
                  <td data-label="Tarif" className="px-4 py-2 text-right">
                    <PriceRateEditor code={p.code} rateIdr={p.rateIdr} unit={p.unit} canEdit={canEdit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </section>
    </div>
  );
}
