import { redirect } from "next/navigation";
import { Cloud, Info, Ruler } from "lucide-react";
import { requireContext } from "@/lib/session";
import {
  carbonByBlock, carbonNeedsValidation, latestCarbonRun, listEmissionFactors,
} from "@/lib/repo/sustainability";
import { listCropOptions, listOpRecords } from "@/lib/repo/operational";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { createDbhAction } from "@/lib/actions/operational";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { InfoBox } from "@/components/ui/InfoBox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatHa, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Karbon — AgroVision" };

const tco2e = (v: number | null) =>
  v === null ? EMPTY : `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(v)} tCO₂e`;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  net_sink: { label: "Net Sink", cls: "bg-emerald-50 text-emerald-700" },
  net_emitter: { label: "Net Emitter", cls: "bg-red-50 text-red-700" },
  neutral: { label: "Netral", cls: "bg-slate-100 text-slate-600" },
  data_incomplete: { label: "Data belum lengkap", cls: "bg-amber-50 text-amber-700" },
};

export default async function KarbonPage() {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const t = getDict(await getLocale());

  const [run, blocks, factors, needsValidation, dbhRows, blockOptions, cropOptions] = await Promise.all([
    latestCarbonRun(ctx),
    carbonByBlock(ctx),
    listEmissionFactors(ctx),
    carbonNeedsValidation(ctx),
    listOpRecords(ctx, "dbh_measurements"),
    searchBlockOptions(ctx),
    listCropOptions(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const dbhReady = canWrite && ctx.companyId && blockOptions.length > 0 && cropOptions.length > 0;

  const net = run?.netBalanceTco2e ?? null;

  return (
    <div>
      <PageHeader
        title={t("nav.carbon")}
        subtitle={t("sub.carbon")}
        titleAdornment={
          <InfoBox title="Metodologi & sumber perhitungan karbon" label="Metodologi karbon">
            <p>
              Perhitungan mengikuti metodologi <strong>IPCC Guidelines for National Greenhouse Gas
              Inventories</strong>: emisi konversi lahan (AFOLU) dan biomassa pohon dari persamaan
              alometrik berbasis diameter batang (DBH).
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-xs">
              <li>
                <a
                  href="https://www.ipcc-nggip.iges.or.jp/public/2019rf/vol4.html"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 underline"
                >
                  IPCC 2019 Refinement — Vol. 4 (AFOLU)
                </a>{" "}
                — konversi lahan & biomassa.
              </li>
              <li>
                <a
                  href="https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-700 underline"
                >
                  IPCC 2006 — Vol. 2 (Energy)
                </a>{" "}
                — pembakaran bahan bakar.
              </li>
            </ul>
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              Koefisien yang dipakai masih <strong>Tier&nbsp;1 (default global) dan belum
              divalidasi</strong> untuk kondisi lokal Kalimantan. Cukup untuk gambaran fase awal,
              belum untuk pelaporan MRV resmi — validasi ahli diperlukan sebelum angka
              dipublikasikan.
            </p>
          </InfoBox>
        }
      />

      {!run ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={Cloud}
            title="Belum ada perhitungan karbon"
            description="Carbon run dihitung dari data blok, persiapan lahan, dan pengukuran DBH."
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Emisi bruto" value={tco2e(run.grossEmissionTco2e)} tone="bad" />
            <Kpi label="Penyerapan" value={tco2e(run.sequestrationTco2e)} tone="good" />
            <Kpi
              label="Neraca bersih"
              value={tco2e(net)}
              tone={net !== null && net < 0 ? "bad" : net !== null && net > 0 ? "good" : "neutral"}
              badge={
                net !== null ? (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      net < 0 ? STATUS_LABEL.net_emitter.cls : STATUS_LABEL.net_sink.cls,
                    )}
                  >
                    {net < 0 ? "Net Emitter" : "Net Sink"}
                  </span>
                ) : null
              }
            />
            <Kpi
              label="Kelengkapan data"
              value={run.dataCompletenessPct === null ? EMPTY : `${run.dataCompletenessPct}%`}
              tone="neutral"
            />
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <p className="text-sm leading-relaxed text-sky-900">
              Proyek saat ini <strong>net emitter</strong> — wajar untuk fase pengadaan bibit: emisi
              didominasi land clearing, sedangkan penyerapan masih mendekati nol karena tanaman
              belum tumbuh. Neraca akan membaik seiring pertumbuhan tegakan.
            </p>
          </div>

          <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
              Karbon per Blok &mdash; {run.code}
            </h2>
            <ResponsiveTable>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Blok</th>
                    <th className="px-4 py-2.5 text-right font-medium">Luas</th>
                    <th className="px-4 py-2.5 text-right font-medium">Emisi</th>
                    <th className="px-4 py-2.5 text-right font-medium">Serapan</th>
                    <th className="px-4 py-2.5 text-right font-medium">Neraca</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((b) => {
                    const st = STATUS_LABEL[b.status] ?? STATUS_LABEL.neutral;
                    return (
                      <tr key={b.blockCode} className="border-b border-slate-50 last:border-0">
                        <td data-label="Blok" className="px-4 py-2.5 font-mono text-xs text-slate-600">{b.blockCode}</td>
                        <td data-label="Luas" className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatHa(b.areaHa)}</td>
                        <td data-label="Emisi" className="px-4 py-2.5 text-right tabular-nums text-red-700">{tco2e(b.emissionTco2e)}</td>
                        <td data-label="Serapan" className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{tco2e(b.sequestrationTco2e)}</td>
                        <td data-label="Neraca" className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">{tco2e(b.netTco2e)}</td>
                        <td data-label="Status" className="px-4 py-2.5">
                          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ResponsiveTable>
          </section>
        </>
      )}

      {/* AI-20: jalur input DBH — dasar sisi serapan carbon run (QA B-11). */}
      <section className="mt-5">
        <h2 className="text-sm font-semibold text-slate-800">Pengukuran DBH</h2>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-slate-500">
          Diameter batang setinggi dada (standar 1,3 m). Form ini hanya merekam hasil
          ukur lapangan — biomassa dan serapan dihitung carbon run, bukan di sini.
        </p>
        {dbhReady && (
          <div className="mb-4">
            <OpRecordForm
              title="Catat pengukuran DBH"
              action={createDbhAction}
              fields={[
                { kind: "select", name: "blockId", label: "Blok", options: blockOptions, required: true },
                { kind: "select", name: "cropId", label: "Tanaman", options: cropOptions, required: true },
                { kind: "text", name: "measuredAt", label: "Tanggal ukur", type: "date", required: true },
                { kind: "text", name: "dbhCm", label: "DBH (cm)", type: "number", step: "0.01", min: "0.01", required: true, hint: "Diukur pada ketinggian 1,3 m dari tanah" },
                { kind: "text", name: "heightM", label: "Tinggi pohon (m) — opsional", type: "number", step: "0.01", min: "0.01" },
              ]}
            />
          </div>
        )}
        <OpRecordTable
          rows={dbhRows.rows}
          moduleKey="dbh_measurements"
          emptyIcon={Ruler}
          emptyTitle="Belum ada pengukuran DBH"
          canWrite={canWrite}
        />
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Faktor Emisi
        </h2>
        {factors.length === 0 ? (
          <EmptyState icon={Cloud} title="Belum ada faktor emisi" />
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Kode</th>
                  <th className="px-4 py-2.5 font-medium">Nama</th>
                  <th className="px-4 py-2.5 text-right font-medium">Nilai</th>
                  <th className="px-4 py-2.5 font-medium">Sumber</th>
                </tr>
              </thead>
              <tbody>
                {factors.map((f) => (
                  <tr key={f.code} className="border-b border-slate-50 last:border-0">
                    <td data-label="Kode" className="px-4 py-2.5 font-mono text-xs text-slate-500">{f.code}</td>
                    <td data-label="Nama" className="px-4 py-2.5 text-slate-700">{f.name}</td>
                    <td data-label="Nilai" className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {formatNumber(f.value)} {f.unitNumerator}/{f.unitDenominator}
                    </td>
                    <td data-label="Sumber" className="px-4 py-2.5 text-xs text-slate-500">
                      {f.sourceStandard}
                      {f.requiresNote && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          perlu validasi
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  badge,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          value === EMPTY
            ? "text-slate-300"
            : tone === "bad"
              ? "text-red-700"
              : tone === "good"
                ? "text-emerald-700"
                : "text-slate-800",
        )}
      >
        {value}
      </p>
      {badge && <div className="mt-1">{badge}</div>}
    </div>
  );
}
