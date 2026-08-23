import { FlaskConical, TriangleAlert, Sprout } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { InfoBox } from "@/components/ui/InfoBox";
import { EmptyState } from "@/components/ui/EmptyState";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { listOpRecords, listFertilizerTypeOptions } from "@/lib/repo/operational";
import { listRecommendations } from "@/lib/repo/fertilizer";
import { listOptions } from "@/lib/repo/master";
import { createFertilizerAction } from "@/lib/actions/operational";
import { RecommendationForm } from "./RecommendationForm";
import { RecommendationTable } from "@/components/fertilizer/RecommendationTable";
import { todayInOperationalZone } from "@/lib/date";

export const metadata = { title: "Pemupukan — AgroVision" };

// concept:120 — bedakan fase vegetatif (pupuk tunggal) & generatif (majemuk).
const PHASES = [
  { value: "seedling", label: "Bibit" },
  { value: "vegetative", label: "Vegetatif" },
  { value: "productive", label: "Produktif / Generatif" },
];

// Zona operasional (WIB), BUKAN UTC: server Cloud Run berjalan di UTC, jadi
// toISOString() memberi tanggal KEMARIN bagi pengguna WIB antara 00:00-07:00 --
// dan nilai itu ikut TERSIMPAN sebagai tanggal rekomendasi, bukan hanya tampil.
function today(): string {
  return todayInOperationalZone();
}

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());

  const [rows, blocks, ferts, units, recos] = await Promise.all([
    listOpRecords(ctx, "fertilizer_applications"),
    searchBlockOptions(ctx),
    listFertilizerTypeOptions(ctx),
    listOptions(ctx, "unit_of_measure"),
    listRecommendations(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const readyReco = canWrite && ctx.companyId && blocks.length > 0;
  const ready = canWrite && ctx.companyId && blocks.length > 0 && ferts.length > 0;

  return (
    <div>
      <PageHeader
        title={t("nav.fertilizer")}
        subtitle={t("sub.fertilizer")}
        titleAdornment={
          <InfoBox title="Metodologi rekomendasi (docs/09)" label="Metodologi pemupukan">
            <p>
              Rekomendasi disusun menurut <strong>pendekatan</strong>: uji tanah menetapkan amelioran,
              analisis daun mendiagnosis hara pembatas (utama untuk tanaman tahunan), neraca hara
              menetapkan dosis. Parameter mengikuti Balai Penelitian Tanah (2009) dan Eviati &amp;
              Sulaeman (2009).
            </p>
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              Tidak ada dosis valid tanpa data lokasi sendiri. Angka yang dimasukkan bersifat
              <strong> provisional</strong> sampai terkalibrasi omission plot (3–5 tahun) — docs/09 §11.
            </p>
            <p className="text-xs">
              Sumber K berbeda per komoditas &amp; fase: <strong>kelapa</strong> membutuhkan Cl → KCl
              (von Uexküll 1990); <strong>durian</strong> pada fase generatif memakai K₂SO₄/KNO₃ demi
              mutu buah (Poovarodom dkk. 2006). docs/09 §6.
            </p>
          </InfoBox>
        }
      />

      {/* ---- Rekomendasi Pemupukan (refine docs/09) ---- */}
      <h2 className="mb-2 text-sm font-semibold text-slate-800">Rekomendasi Pemupukan</h2>
      {readyReco ? (
        <div className="mb-5">
          <RecommendationForm blocks={blocks} today={today()} />
        </div>
      ) : (
        <div className="mb-5 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {blocks.length === 0
            ? "Belum ada blok. Tambahkan blok dulu di menu Blok & Peta."
            : "Peran Anda hanya dapat melihat rekomendasi di bawah."}
        </div>
      )}

      <section className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Daftar rekomendasi per blok
        </h3>
        {recos.length === 0 ? (
          <EmptyState icon={Sprout} title="Belum ada rekomendasi" description="Rekomendasi yang disimpan muncul di sini, dikelompokkan per blok, komoditas, dan fase." />
        ) : (
          <>
            <RecommendationTable recos={recos} />
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Klik satu baris untuk melihat nilai tiap parameter + <strong>dosis produk pupuk</strong> (mis. K₂O → KNO₃ dalam g/pohon).
            </p>
          </>
        )}
      </section>

      {/* ---- Catatan aplikasi pupuk (realisasi) ---- */}
      <h2 className="mb-2 text-sm font-semibold text-slate-800">
        Catatan aplikasi pupuk <span className="font-normal text-slate-500">— realisasi di lapangan</span>
      </h2>
      {canWrite && ctx.companyId && ferts.length === 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">Belum ada jenis pupuk. <Link href="/pengaturan/master-data" className="font-medium underline">Tambah di Master Data</Link> dulu.</p>
        </div>
      )}
      {ready && (
        <div className="mb-5">
          <OpRecordForm
            title="Catat pemupukan"
            action={createFertilizerAction}
            fields={[
              { kind: "select", name: "blockId", label: "Blok", options: blocks, required: true },
              { kind: "select", name: "cropCode", label: "Komoditas", options: [{ value: "DURIAN", label: "Durian" }, { value: "COCONUT", label: "Kelapa" }], allowEmpty: true },
              { kind: "select", name: "fertilizerTypeId", label: "Jenis pupuk", options: ferts, required: true, hint: "Dari master data" },
              { kind: "select", name: "growthPhase", label: "Fase pertumbuhan", options: PHASES, required: true },
              { kind: "text", name: "appliedOn", label: "Tanggal aplikasi", type: "date", required: true },
              { kind: "text", name: "totalQuantity", label: "Jumlah total", type: "number", step: "0.001", min: "0", required: true },
              { kind: "select", name: "uomItemId", label: "Satuan", options: units, allowEmpty: true },
              { kind: "text", name: "treeCount", label: "Jumlah pohon (opsional)", type: "number", min: "0" },
              { kind: "textarea", name: "note", label: "Catatan (opsional)" },
            ]}
          />
        </div>
      )}
      <OpRecordTable rows={rows.rows} moduleKey="fertilizer_applications" emptyIcon={FlaskConical} emptyTitle="Belum ada catatan pemupukan" canWrite={canWrite} />
    </div>
  );
}
