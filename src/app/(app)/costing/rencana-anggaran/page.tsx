import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, ShieldAlert } from "lucide-react";
import { requireContext } from "@/lib/session";
import { listBudgetPlans } from "@/lib/repo/budgetPlan";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { formatIdr, formatNumber, EMPTY } from "@/lib/format";
import { PlanForm } from "./PlanForm";

export const metadata = { title: "Rencana Anggaran — AgroVision" };

/**
 * Rencana Anggaran (RAB Kebun) — rapat Fadli 26 Agustus 2026.
 *
 * Langkah yang selama ini hilang: aplikasi langsung meminta ANGGARAN, padahal
 * yang tahu kebun perlu dolomit dulu atau pupuk kandang per lubang tanam adalah
 * agronomis, bukan finance. Urutannya sekarang:
 *
 *   agronomis menyusun RAB → finance (approver) menyetujui → master anggaran
 *
 * Halaman ini berhenti di anak panah kedua. Materialisasi ke app.budgets belum
 * dikerjakan dan sengaja begitu — lihat kepala migrasi 0060.
 */
export default async function RencanaAnggaranPage() {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }

  const canDraft = ["agronomist", "super_admin"].includes(ctx.session.role);
  const plans = await listBudgetPlans(ctx);

  return (
    <div>
      <PageHeader
        title="Rencana Anggaran"
        subtitle="RAB kebun disusun agronomis, disetujui finance. Fase memakai bulan relatif — bulan ke-1 adalah bulan pertama proyek."
      />

      {!canDraft && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm leading-relaxed text-amber-900">
            Anda bisa melihat seluruh RAB entitas ini, tapi penyusunannya wewenang{" "}
            <strong>agronomis</strong>. Keputusan setuju/tolak ada di halaman detail tiap RAB.
          </p>
        </div>
      )}

      {canDraft && (
        <div className="mb-6">
          <PlanForm />
        </div>
      )}

      {plans.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada RAB"
          description="RAB pertama disusun agronomis: satu header (luas, horizon bulan, kontingensi), lalu komponen biayanya satu per satu seperti di Excel."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Kode</th>
                  <th className="px-4 py-2.5 font-medium">Nama</th>
                  <th className="px-4 py-2.5 text-right font-medium">Luas (ha)</th>
                  <th className="px-4 py-2.5 text-right font-medium">Komponen</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total + kontingensi</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 align-top last:border-0">
                    <td data-label="Kode" className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.code}</td>
                    <td data-label="Nama" className="px-4 py-2.5 text-slate-700">
                      {p.name}
                      <span className="block text-xs text-slate-400">
                        horizon {p.horizonMonths} bulan · kontingensi {formatNumber(p.contingencyPct)}%
                      </span>
                    </td>
                    <td data-label="Luas (ha)" data-empty={p.areaHa === null} className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {p.areaHa === null ? EMPTY : formatNumber(p.areaHa)}
                    </td>
                    <td data-label="Komponen" className="px-4 py-2.5 text-right tabular-nums text-slate-600">{p.itemCount}</td>
                    {/* RAB tanpa komponen = BELUM DIISI, bukan nol rupiah. */}
                    <td data-label="Total" data-empty={p.totalIdr === null} className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-700">
                      {p.totalIdr === null ? EMPTY : formatIdr(p.totalIdr)}
                    </td>
                    <td data-label="Status" className="px-4 py-2.5">
                      <RecordStatusBadge status={p.approvalStatus} />
                      {p.rejectionReason && (
                        <span className="mt-1 block text-xs leading-snug text-red-600">{p.rejectionReason}</span>
                      )}
                    </td>
                    <td data-action className="px-4 py-2.5 text-right">
                      <Link
                        href={`/costing/rencana-anggaran/${p.id}`}
                        className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Buka
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </div>
      )}
    </div>
  );
}
