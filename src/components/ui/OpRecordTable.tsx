import { RecordStatusBadge } from "./RecordStatusBadge";
import { EmptyState } from "./EmptyState";
import { OpSubmitButton } from "./OpSubmitButton";
import { OpRecordEditor } from "./OpRecordEditor";
import { ResponsiveTable } from "./ResponsiveTable";
import { formatDate, EMPTY } from "@/lib/format";
import type { LucideIcon } from "lucide-react";
import type { OpRecord } from "@/lib/repo/operational";
import type { Field } from "./OpRecordForm";
import type { updateOpRecordAction } from "@/lib/actions/operational";

/** Tabel record operasional generik + tombol Ajukan untuk draft/rejected. */
export function OpRecordTable({
  rows,
  moduleKey,
  emptyIcon,
  emptyTitle,
  canWrite,
  blockHeader = "Blok",
  editFields,
  updateAction,
}: {
  rows: OpRecord[];
  moduleKey: string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  canWrite: boolean;
  /** Label kolom induk record — default "Blok"; nursery memakai "Batch". */
  blockHeader?: string;
  /**
   * B-21: field editor per baris draft/rejected. Opsional — tabel yang belum
   * memberi ini (mis. dipakai untuk tampilan read-only) tidak menampilkan
   * tombol "Perbaiki", hanya "Ajukan" seperti sebelumnya.
   */
  editFields?: Field[];
  updateAction?: typeof updateOpRecordAction;
}) {
  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <EmptyState icon={emptyIcon} title={emptyTitle} description="Catat lewat formulir di atas." />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ResponsiveTable>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Tanggal</th>
              <th className="px-4 py-2.5 font-medium">{blockHeader}</th>
              <th className="px-4 py-2.5 font-medium">Detail</th>
              <th className="px-4 py-2.5 font-medium">Petugas</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 align-top last:border-0">
                <td data-label="Tanggal" className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(r.eventDate)}</td>
                <td data-label={blockHeader} className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.blockCode ?? EMPTY}</td>
                <td data-label="Detail" data-empty={!r.detail} className="px-4 py-2.5 text-slate-700">{r.detail ?? EMPTY}</td>
                <td data-label="Petugas" className="px-4 py-2.5 text-slate-500">{r.createdByName ?? EMPTY}</td>
                <td data-label="Status" className="px-4 py-2.5">
                  <RecordStatusBadge status={r.approvalStatus} />
                  {r.rejectionReason && (
                    <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-red-600">{r.rejectionReason}</p>
                  )}
                </td>
                <td data-action className="px-4 py-2.5 text-right">
                  {canWrite && (r.approvalStatus === "draft" || r.approvalStatus === "rejected") && (
                    <div className="flex w-full flex-wrap items-center justify-end gap-x-2 gap-y-2">
                      {editFields && updateAction && (
                        <OpRecordEditor
                          id={r.id}
                          module={moduleKey}
                          fields={editFields}
                          values={r.editValues}
                          action={updateAction}
                        />
                      )}
                      <OpSubmitButton module={moduleKey} id={r.id} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTable>
    </div>
  );
}
