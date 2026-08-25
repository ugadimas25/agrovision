import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { getCriteria, listSuitabilityAssessments, classify } from "@/lib/repo/suitability";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { InfoBox } from "@/components/ui/InfoBox";
import { SuitabilityForm } from "./SuitabilityForm";
import { AssessmentHistory, type HistoryRow } from "./AssessmentHistory";

export const metadata = { title: "Kesesuaian Lahan — AgroVision" };

export default async function KesesuaianLahanPage() {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const t = getDict(await getLocale());

  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const [blocks, durianCrit, coconutCrit, existing] = await Promise.all([
    searchBlockOptions(ctx),
    getCriteria(ctx, "DURIAN"),
    getCriteria(ctx, "COCONUT"),
    listSuitabilityAssessments(ctx),
  ]);

  // Gabungan karakteristik dua komoditas -> satu set field input.
  const byCode = new Map<string, { label: string; unit: string | null; isNumeric: boolean; options?: string[] }>();
  for (const c of [...durianCrit, ...coconutCrit]) {
    if (byCode.has(c.charCode)) continue;
    const options = c.isNumeric
      ? undefined
      : [...new Set(c.bands.flatMap((b) => ("set" in b ? b.set : [])))];
    byCode.set(c.charCode, { label: c.charLabel, unit: c.unit, isNumeric: c.isNumeric, options });
  }
  const fields = [...byCode.entries()].map(([code, f]) => ({ code, ...f }));

  // Rincian per karakteristik untuk tiap riwayat: dihitung ulang dari params
  // tersimpan memakai kriteria komoditas yang sesuai (sama seperti saat menilai).
  const historyRows: HistoryRow[] = existing.map((r) => {
    const crit = r.cropCode === "COCONUT" ? coconutCrit : durianCrit;
    const { perChar } = classify(crit, r.params);
    return {
      id: r.id,
      blockCode: r.blockCode,
      cropName: r.cropName,
      suitClass: r.suitClass,
      subclass: r.subclass,
      assessedAt: r.assessedAt,
      approvalStatus: r.approvalStatus,
      rejectionReason: r.rejectionReason,
      limiting: r.limiting,
      perChar,
      isDemo: (r.note ?? "").toLowerCase().includes("contoh"),
    };
  });

  return (
    <div>
      <PageHeader
        title={t("nav.suitability")}
        subtitle={t("sub.suitability")}
        titleAdornment={
          <InfoBox title="Catatan metodologi & sumber" label="Catatan metodologi kesesuaian lahan">
            <p>
              Kriteria kelas mengacu kerangka BBSDLP/Djaenudin. Ambang yang dipakai dihimpun dari
              publikasi jurnal berikut:
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-xs">
              <li>Kelapa — Jawang dkk. (2018), modifikasi Djaenudin dkk. (2003).</li>
              <li>Durian — Taiyeb (2023), mengacu Djaenudin dkk. (2011).</li>
            </ul>
            <p>
              Antar-sumber ada perbedaan ambang, terutama iklim durian. Untuk laporan resmi, kutip
              langsung Ritung dkk. (2011) atau pedoman BBSDLP 2019 dan sebutkan versi kriteria yang
              dipakai.
            </p>
            <p className="rounded-md bg-sky-50 px-2.5 py-2 text-xs text-sky-900">
              Hasil ini adalah <strong>kesesuaian fisik lahan</strong>, bukan kelayakan ekonomi.
              Keputusan investasi memerlukan analisis usaha tani (R/C, B/C, NPV) tersendiri.
            </p>
          </InfoBox>
        }
      />

      {canWrite && ctx.companyId && blocks.length > 0 ? (
        <SuitabilityForm blocks={blocks} fields={fields} />
      ) : (
        <div className="mb-5 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {blocks.length === 0
            ? "Belum ada blok. Tambahkan blok dulu di menu Blok & Peta."
            : "Peran Anda hanya bisa melihat hasil penilaian di bawah."}
        </div>
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Riwayat Penilaian <span className="font-normal text-slate-500">— klik baris untuk melihat parameter</span>
        </h2>
        <AssessmentHistory rows={historyRows} canWrite={canWrite} />
      </section>
    </div>
  );
}
