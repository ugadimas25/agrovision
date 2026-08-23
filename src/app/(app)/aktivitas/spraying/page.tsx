import { SprayCan } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { listOpRecords } from "@/lib/repo/operational";
import { listChemicalOptions } from "@/lib/repo/agriInput";
import { createSprayingAction } from "@/lib/actions/operational";

export const metadata = { title: "Penyemprotan — AgroVision" };

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const [rows, blocks, chemicals] = await Promise.all([
    listOpRecords(ctx, "spraying_records"),
    searchBlockOptions(ctx),
    listChemicalOptions(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const ready = canWrite && ctx.companyId && blocks.length > 0;

  return (
    <div>
      <PageHeader title={t("nav.spraying")} subtitle={t("sub.spraying")} />
      {ready && (
        <div className="mb-5">
          <OpRecordForm
            title="Catat penyemprotan"
            action={createSprayingAction}
            fields={[
              { kind: "select", name: "blockId", label: "Blok", options: blocks, required: true },
              { kind: "text", name: "sprayedOn", label: "Tanggal", type: "date", required: true },
              { kind: "select", name: "chemicalId", label: "Bahan (Agri-Input)", options: chemicals, allowEmpty: true, hint: chemicals.length === 0 ? "Belum ada bahan — tambah di Agri-Input › Chemical" : "Dari katalog Chemical" },
              { kind: "text", name: "target", label: "Target (OPT/gulma)", type: "text", placeholder: "mis. ulat penggerek" },
              { kind: "text", name: "dosePerHa", label: "Dosis /ha", type: "number", step: "any", min: "0" },
              { kind: "text", name: "totalVolume", label: "Volume total", type: "number", step: "any", min: "0.01", required: true },
              { kind: "text", name: "unit", label: "Satuan", type: "text", placeholder: "liter / kg" },
              { kind: "textarea", name: "note", label: "Catatan (opsional)" },
            ]}
          />
        </div>
      )}
      {canWrite && ctx.companyId && chemicals.length === 0 && (
        <p className="mb-4 text-sm text-slate-500">
          Belum ada bahan kimia. <Link href="/agri-input/chemical" className="font-medium text-emerald-700 underline">Tambah di Agri-Input › Chemical</Link> agar bisa dipilih di sini.
        </p>
      )}
      <OpRecordTable rows={rows.rows} moduleKey="spraying_records" emptyIcon={SprayCan} emptyTitle="Belum ada catatan penyemprotan" canWrite={canWrite} />
    </div>
  );
}
