import { Wheat } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { listOpRecords } from "@/lib/repo/operational";
import { createHarvestAction, updateOpRecordAction } from "@/lib/actions/operational";
import type { Field } from "@/components/ui/OpRecordForm";

export const metadata = { title: "Panen — AgroVision" };

const CROPS = [
  { value: "DURIAN", label: "Durian" },
  { value: "COCONUT", label: "Kelapa" },
];

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const [rows, blocks] = await Promise.all([
    listOpRecords(ctx, "harvest_records"),
    searchBlockOptions(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const ready = canWrite && ctx.companyId && blocks.length > 0;
  const fields: Field[] = [
    { kind: "select", name: "blockId", label: "Blok", options: blocks, required: true },
    { kind: "text", name: "harvestedOn", label: "Tanggal panen", type: "date", required: true },
    { kind: "select", name: "cropCode", label: "Komoditas", options: CROPS, required: true },
    { kind: "text", name: "quantityTon", label: "Tonase (ton)", type: "number", step: "0.001", min: "0", required: true },
    { kind: "text", name: "grade", label: "Grade", type: "text", placeholder: "mis. A / B / super" },
    { kind: "textarea", name: "note", label: "Catatan (opsional)" },
  ];

  return (
    <div>
      <PageHeader title={t("nav.harvesting")} subtitle={t("sub.harvesting")} />
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        Panen yang <strong>disetujui</strong> menjadi sumber revenue di Accounting (tonase × tarif price
        list) dan titik awal Traceability.
      </p>
      {ready && (
        <div className="mb-5">
          <OpRecordForm title="Catat panen" action={createHarvestAction} fields={fields} />
        </div>
      )}
      <OpRecordTable
        rows={rows.rows} moduleKey="harvest_records" emptyIcon={Wheat}
        emptyTitle="Belum ada catatan panen" canWrite={canWrite}
        editFields={fields} updateAction={updateOpRecordAction}
      />
    </div>
  );
}
