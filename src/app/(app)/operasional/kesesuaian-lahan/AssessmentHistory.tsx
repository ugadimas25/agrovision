"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Compass } from "lucide-react";
import type { PerChar } from "@/lib/repo/suitability";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { OpSubmitButton } from "@/components/ui/OpSubmitButton";
import { formatDate, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

const CLASS_CLS: Record<string, string> = {
  S1: "bg-emerald-50 text-emerald-700", S2: "bg-lime-50 text-lime-700",
  S3: "bg-amber-50 text-amber-700", N: "bg-red-50 text-red-700",
};
const CELL_CLS: Record<string, string> = {
  S1: "text-emerald-700", S2: "text-lime-700", S3: "text-amber-700", N: "text-red-700",
};
const CLASS_NAME: Record<string, string> = {
  S1: "Sangat sesuai", S2: "Cukup sesuai", S3: "Sesuai marginal", N: "Tidak sesuai",
};

export type HistoryRow = {
  id: string;
  blockCode: string;
  cropName: string | null;
  suitClass: string | null;
  subclass: string | null;
  assessedAt: string;
  approvalStatus: string;
  rejectionReason: string | null;
  limiting: string[];
  /** Rincian per karakteristik (dihitung ulang dari params tersimpan). */
  perChar: PerChar[];
  /** true bila baris berisi data contoh. */
  isDemo?: boolean;
};

export function AssessmentHistory({ rows, canWrite }: { rows: HistoryRow[]; canWrite: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    return <EmptyState icon={Compass} title="Belum ada penilaian tersimpan" />;
  }

  return (
    <ResponsiveTable>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="w-8 px-2 py-2.5" />
            <th className="px-4 py-2.5 font-medium">Blok</th>
            <th className="px-4 py-2.5 font-medium">Komoditas</th>
            <th className="px-4 py-2.5 font-medium">Kelas</th>
            <th className="px-4 py-2.5 font-medium">Subkelas</th>
            <th className="px-4 py-2.5 font-medium">Tanggal</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openId === r.id;
            const assessed = r.perChar.filter((p) => p.cls !== null);
            return (
              <>
                <tr
                  key={r.id}
                  onClick={() => setOpenId(open ? null : r.id)}
                  className={cn(
                    "cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/70",
                    open && "bg-slate-50",
                  )}
                  title="Klik untuk melihat parameter yang terisi"
                >
                  <td data-action className="px-2 py-2.5 text-slate-500">
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </td>
                  <td data-label="Blok" className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {r.blockCode}
                    {r.isDemo && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">contoh</span>}
                  </td>
                  <td data-label="Komoditas" className="px-4 py-2.5 text-slate-700">{r.cropName ?? EMPTY}</td>
                  <td data-label="Kelas" className="px-4 py-2.5">
                    {r.suitClass ? (
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", CLASS_CLS[r.suitClass] ?? "")}>
                        {r.suitClass}
                      </span>
                    ) : EMPTY}
                  </td>
                  <td data-label="Subkelas" data-empty={!r.subclass} className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.subclass ?? EMPTY}</td>
                  <td data-label="Tanggal" className="px-4 py-2.5 text-slate-500">{formatDate(r.assessedAt)}</td>
                  <td data-label="Status" className="px-4 py-2.5 text-slate-500">
                    {r.approvalStatus}
                    {r.rejectionReason && (
                      <>
                        <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-red-600">{r.rejectionReason}</p>
                        {canWrite && (
                          <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-slate-400">
                            Penilaian di sini tersimpan sebagai riwayat versi — perbaiki dengan mengisi ulang
                            blok yang sama di form atas, lalu Ajukan.
                          </p>
                        )}
                      </>
                    )}
                  </td>
                  <td data-action onClick={(e) => e.stopPropagation()} className="px-4 py-2.5 text-right">
                    {canWrite && (r.approvalStatus === "draft" || r.approvalStatus === "rejected") && (
                      <OpSubmitButton module="land_suitability_assessments" id={r.id} />
                    )}
                  </td>
                </tr>
                {open && (
                  <tr key={`${r.id}-detail`} className="border-b border-slate-100 bg-slate-50/40">
                    <td colSpan={8} className="px-4 py-3">
                      {assessed.length === 0 ? (
                        <p className="text-xs text-slate-500">Tidak ada parameter terukur yang tersimpan pada penilaian ini.</p>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                            <span className="text-xs font-semibold text-slate-600">Parameter terisi ({assessed.length})</span>
                            {r.suitClass && (
                              <span className="text-xs text-slate-500">
                                {CLASS_NAME[r.suitClass]} · pembatas: {r.limiting.length ? r.limiting.join(", ") : "—"}
                              </span>
                            )}
                          </div>
                          <table className="w-full text-sm">
                            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                              <tr>
                                <th className="px-3 py-1.5 font-medium">Karakteristik</th>
                                <th className="px-3 py-1.5 font-medium">Nilai</th>
                                <th className="px-3 py-1.5 text-right font-medium">Kelas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {assessed.map((p) => (
                                <tr
                                  key={p.charCode}
                                  className={cn("border-b border-slate-50 last:border-0", p.cls === r.suitClass && "bg-amber-50/40")}
                                >
                                  <td data-label="Karakteristik" className="px-3 py-1.5 text-slate-700">
                                    {p.charLabel}
                                    <span className="ml-1.5 font-mono text-xs text-slate-500">{p.symbol}</span>
                                  </td>
                                  <td data-label="Nilai" className="px-3 py-1.5 text-slate-600">
                                    {p.value}{p.unit ? ` ${p.unit}` : ""}
                                  </td>
                                  <td data-label="Kelas" className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", CELL_CLS[p.cls!])}>
                                    {p.cls}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                            Baris bersorot kuning adalah faktor pembatas (kelas terendah, hukum minimum Liebig).
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}
