import { Scissors } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { listOpRecords } from "@/lib/repo/operational";
import { createPruningAction } from "@/lib/actions/operational";

export const metadata = { title: "Pruning — AgroVision" };

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const [rows, blocks] = await Promise.all([
    listOpRecords(ctx, "pruning_records"),
    searchBlockOptions(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const ready = canWrite && ctx.companyId && blocks.length > 0;

  return (
    <div>
      <PageHeader title={t("nav.pruning")} subtitle={t("sub.pruning")} />
      {ready && (
        <div className="mb-5">
          <OpRecordForm
            title="Catat pruning"
            action={createPruningAction}
            fields={[
              { kind: "select", name: "blockId", label: "Blok", options: blocks, required: true },
              { kind: "text", name: "prunedOn", label: "Tanggal", type: "date", required: true },
              { kind: "text", name: "treeCount", label: "Jumlah pohon", type: "number", min: "1", required: true },
              { kind: "textarea", name: "note", label: "Catatan (opsional)" },
            ]}
          />
        </div>
      )}
      <OpRecordTable rows={rows.rows} moduleKey="pruning_records" emptyIcon={Scissors} emptyTitle="Belum ada catatan pruning" canWrite={canWrite} />
    </div>
  );
}
