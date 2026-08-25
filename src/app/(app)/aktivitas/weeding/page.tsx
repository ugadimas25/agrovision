import { Sprout } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { listOpRecords, listWeedingSchedules } from "@/lib/repo/operational";
import { ScheduleForm } from "./ScheduleForm";
import { createWeedingAction, updateOpRecordAction } from "@/lib/actions/operational";
import type { Field } from "@/components/ui/OpRecordForm";

export const metadata = { title: "Penyiangan — AgroVision" };

const METHODS = [
  { value: "manual", label: "Manual" },
  { value: "mekanis", label: "Mekanis" },
  { value: "mulsa", label: "Mulsa" },
  { value: "herbisida", label: "Herbisida" },
  { value: "penutup_tanah", label: "Tanaman penutup tanah" },
];

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const [rows, blocks, schedules] = await Promise.all([
    listOpRecords(ctx, "weeding_records"),
    searchBlockOptions(ctx),
    // Jadwal penyiangan (migrasi 0051) — dasar kolom "Jadwal vs Realisasi".
    listWeedingSchedules(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  // Menentukan kadensi = keputusan operasi, bukan pencatatan lapangan.
  const canSchedule = ["approver", "super_admin"].includes(ctx.session.role);
  const ready = canWrite && ctx.companyId && blocks.length > 0;
  const fields: Field[] = [
    { kind: "select", name: "blockId", label: "Blok", options: blocks, required: true },
    { kind: "text", name: "weededOn", label: "Tanggal", type: "date", required: true },
    { kind: "select", name: "method", label: "Metode", options: METHODS, required: true },
    { kind: "text", name: "areaHa", label: "Luas (ha)", type: "number", step: "0.01", min: "0.01", required: true },
    { kind: "text", name: "laborCount", label: "Jumlah tenaga", type: "number", min: "0" },
    { kind: "textarea", name: "note", label: "Catatan (opsional)" },
  ];

  return (
    <div>
      <PageHeader title={t("nav.weeding")} subtitle={t("sub.weeding")} />
      {ready && (
        <div className="mb-5">
          {canSchedule && ctx.companyId && blocks.length > 0 && (
            <ScheduleForm blocks={blocks} schedules={schedules} />
          )}
          <OpRecordForm title="Catat penyiangan" action={createWeedingAction} fields={fields} />
        </div>
      )}
      <OpRecordTable
        rows={rows.rows} moduleKey="weeding_records" emptyIcon={Sprout}
        emptyTitle="Belum ada catatan penyiangan" canWrite={canWrite}
        editFields={fields} updateAction={updateOpRecordAction}
      />
    </div>
  );
}
