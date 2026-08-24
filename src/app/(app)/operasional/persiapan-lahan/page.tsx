import { Shovel } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { listOptions } from "@/lib/repo/master";
import { listOpRecords } from "@/lib/repo/operational";
import { createLandPrepAction } from "@/lib/actions/operational";
import { PREP_STATUS } from "@/lib/labels";

export const metadata = { title: "Persiapan Lahan — AgroVision" };

// Satu sumber label enum: src/lib/labels.ts. Dropdown form dan kolom Detail di
// tabel harus memakai teks yang sama — sebelumnya labelnya ada di sini sementara
// tabel menampilkan nilai mentah dari SQL (catatan.md §3).
const STATUS = Object.entries(PREP_STATUS).map(([value, label]) => ({ value, label }));

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const [rows, blocks, layouts] = await Promise.all([
    listOpRecords(ctx, "land_preparations"),
    searchBlockOptions(ctx),
    // Layout tanam dari Master Data (tipe planting_layout, migrasi 0050). Kosong
    // bila super_admin belum membuat itemnya — form tetap bisa disubmit tanpa
    // memilih, dan laporan merender em-dash alih-alih mengarang jaraknya.
    listOptions(ctx, "planting_layout"),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  const ready = canWrite && ctx.companyId && blocks.length > 0;

  return (
    <div>
      <PageHeader title={t("nav.landprep")} subtitle={t("sub.landprep")} />
      {ready && (
        <div className="mb-5">
          <OpRecordForm
            title="Catat persiapan lahan"
            action={createLandPrepAction}
            fields={[
              { kind: "select", name: "blockId", label: "Blok", options: blocks, required: true },
              { kind: "text", name: "checkedAt", label: "Tanggal cek", type: "date", required: true },
              { kind: "text", name: "soilPh", label: "pH tanah", type: "number", step: "0.1", min: "0", max: "14" },
              { kind: "text", name: "holeCount", label: "Jumlah lubang tanam", type: "number", min: "0" },
              { kind: "text", name: "effectiveAreaHa", label: "Area efektif (ha)", type: "number", step: "0.01", min: "0" },
              { kind: "select", name: "plantingLayoutItemId", label: "Layout tanam", options: layouts },
              { kind: "select", name: "status", label: "Status", options: STATUS, required: true },
              { kind: "textarea", name: "note", label: "Catatan (opsional)" },
            ]}
          />
        </div>
      )}
      <OpRecordTable rows={rows.rows} moduleKey="land_preparations" emptyIcon={Shovel} emptyTitle="Belum ada checklist persiapan lahan" canWrite={canWrite} />
    </div>
  );
}
