import { CircleCheck, CircleX } from "lucide-react";
import type { ApprovalHistoryItem } from "@/lib/repo/costing";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatDate, formatIdr, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * B-22: tabel riwayat keputusan approval — dibaca dari app.v_approval_history
 * (migrasi 0056). Beda dari PendingTable: baris di sini sudah DIPUTUSKAN, jadi
 * kolomnya "siapa memutuskan & kapan" alih-alih tombol Setujui/Tolak.
 *
 * Tidak ada params/klik-untuk-buka di sini — v_approval_history tidak
 * membawa kolom params (beda dari v_pending_approvals), karena tujuannya
 * cuma bukti keputusan, bukan meninjau ulang isi record.
 */
export function HistoryTable({ rows }: { rows: ApprovalHistoryItem[] }) {
  return (
    <ResponsiveTable>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Modul</th>
            <th className="px-4 py-2.5 font-medium">Blok</th>
            <th className="px-4 py-2.5 font-medium">Detail</th>
            <th className="px-4 py-2.5 text-right font-medium">Nilai</th>
            <th className="px-4 py-2.5 font-medium">Pengaju</th>
            <th className="px-4 py-2.5 font-medium">Keputusan</th>
            <th className="px-4 py-2.5 font-medium">Diputuskan oleh</th>
            <th className="px-4 py-2.5 font-medium">Kapan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            return (
              <tr key={`${r.moduleKey}:${r.recordId}:${r.decidedAt}`} className="border-b border-slate-50 align-top last:border-0">
                <td data-label="Modul" className="whitespace-nowrap px-4 py-2.5 text-slate-700">{r.moduleLabel}</td>
                <td data-label="Blok" className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.blockCode ?? EMPTY}</td>
                <td data-label="Detail" data-empty={!r.detail} className="px-4 py-2.5 text-slate-700">{r.detail ?? EMPTY}</td>
                <td data-label="Nilai" data-empty={r.amountIdr === null} className={cn("px-4 py-2.5 text-right tabular-nums", r.moduleKey === "harvest_record" ? "text-emerald-700" : "text-slate-700")}>
                  {r.amountIdr === null ? EMPTY : formatIdr(r.amountIdr)}
                </td>
                <td data-label="Pengaju" className="px-4 py-2.5 text-slate-500">{r.createdByName ?? EMPTY}</td>
                <td data-label="Keputusan" className="px-4 py-2.5">
                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium", r.decision === "approved" ? "text-emerald-700" : "text-red-700")}>
                    {r.decision === "approved" ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
                    {r.decision === "approved" ? "Disetujui" : "Ditolak"}
                  </span>
                  {r.rejectionReason && (
                    <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-red-600">{r.rejectionReason}</p>
                  )}
                  {r.currentStatus !== r.decision && (
                    <p className="mt-1 text-xs text-slate-500">
                      Status terkini: <RecordStatusBadge status={r.currentStatus} />
                    </p>
                  )}
                </td>
                <td data-label="Diputuskan oleh" className="px-4 py-2.5 text-slate-500">{r.decidedByName ?? EMPTY}</td>
                <td data-label="Kapan" className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDate(r.decidedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}
