import { FlaskConical } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { listChemicals } from "@/lib/repo/agriInput";
import { createChemicalAction } from "@/lib/actions/agriInput";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Chemical — AgroVision" };

const CATEGORIES = [
  { value: "pupuk", label: "Pupuk" },
  { value: "pestisida", label: "Pestisida" },
  { value: "herbisida", label: "Herbisida" },
  { value: "fungisida", label: "Fungisida" },
  { value: "insektisida", label: "Insektisida" },
];
const PHASE_LABEL: Record<string, string> = { vegetatif: "Vegetatif", generatif: "Generatif", pemulihan: "Pemulihan" };

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const items = await listChemicals(ctx);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);

  return (
    <div>
      <PageHeader title={t("nav.chemical")} subtitle={t("sub.chemical")} />

      {canWrite && ctx.companyId && (
        <div className="mb-5">
          <OpRecordForm
            title="Tambah item chemical"
            action={createChemicalAction}
            fields={[
              { kind: "text", name: "code", label: "Kode", type: "text", required: true, placeholder: "mis. UREA" },
              { kind: "text", name: "name", label: "Nama", type: "text", required: true },
              { kind: "select", name: "category", label: "Kategori", options: CATEGORIES, required: true },
              { kind: "select", name: "isOrganic", label: "Jalur", options: [{ value: "sintetik", label: "Sintetik" }, { value: "organik", label: "Organik" }], required: true },
              { kind: "text", name: "unit", label: "Satuan", type: "text", placeholder: "kg / liter" },
              // "Stok awal" dihapus (§17 Keputusan 1): stok hanya bergerak lewat buku
              // besar mutasi, dan pemasukan stok adalah wewenang super_admin. Katalog
              // baru mulai dari nol — angka stok tidak boleh lahir dari form katalog.
              { kind: "text", name: "reorderLevel", label: "Titik pesan ulang", type: "number", step: "any", min: "0" },
              { kind: "select", name: "recPhase", label: "Rekomendasi fase", options: [{ value: "vegetatif", label: "Vegetatif" }, { value: "generatif", label: "Generatif" }, { value: "pemulihan", label: "Pemulihan" }], allowEmpty: true },
              { kind: "textarea", name: "recNote", label: "Catatan rekomendasi (opsional)" },
            ]}
          />
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Katalog &amp; stok</h2>
        {items.length === 0 ? (
          <EmptyState icon={FlaskConical} title="Belum ada item chemical" description="Tambahkan pupuk/pestisida beserta stok dan rekomendasi fasenya." />
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Kode</th>
                  <th className="px-4 py-2 font-medium">Nama</th>
                  <th className="px-4 py-2 font-medium">Kategori</th>
                  <th className="px-4 py-2 font-medium">Jalur</th>
                  <th className="px-4 py-2 text-right font-medium">Stok</th>
                  <th className="px-4 py-2 font-medium">Rekomendasi fase</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  // needs_reorder dari view: null bila reorder level belum diisi —
                  // "perlu reorder" memang belum bisa dijawab, bukan "tidak perlu".
                  const low = i.needsReorder === true;
                  return (
                    <tr key={i.id} className="border-b border-slate-50 last:border-0">
                      <td data-label="Kode" className="px-4 py-2 font-mono text-xs text-slate-500">{i.code}</td>
                      <td data-label="Nama" className="px-4 py-2 text-slate-700">{i.name}</td>
                      <td data-label="Kategori" className="px-4 py-2 text-slate-600 capitalize">{i.category}</td>
                      <td data-label="Jalur" className="px-4 py-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", i.isOrganic ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                          {i.isOrganic ? "Organik" : "Sintetik"}
                        </span>
                      </td>
                      <td data-label="Stok" className={cn("px-4 py-2 text-right tabular-nums", low ? "font-semibold text-red-700" : "text-slate-700")}>
                        {formatNumber(i.stockQty)} {i.unit}{low ? " ⚠" : ""}
                      </td>
                      <td data-label="Rekomendasi fase" data-empty={!i.recPhase} className="px-4 py-2 text-slate-600">{i.recPhase ? (PHASE_LABEL[i.recPhase] ?? i.recPhase) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </section>
    </div>
  );
}
