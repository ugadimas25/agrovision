import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList, TriangleAlert } from "lucide-react";
import { requireContext } from "@/lib/session";
import { budgetPlanByPhase, getBudgetPlan, listBudgetPlanItems } from "@/lib/repo/budgetPlan";
import { listCategoryOptions, listOptions } from "@/lib/repo/master";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { formatIdr, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemForm } from "./ItemForm";
import { PlanDecision } from "./PlanDecision";

export const metadata = { title: "Detail RAB — AgroVision" };

/** 02_Assumptions memberi tiap angka tingkat keyakinan. Di model Banyumas, 51
 *  dari 100+ asumsi bertanda Low — itu informasi yang harus ikut terbaca,
 *  bukan aib yang disembunyikan. */
const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: "keyakinan tinggi", cls: "bg-emerald-50 text-emerald-700" },
  medium: { label: "keyakinan sedang", cls: "bg-amber-50 text-amber-700" },
  low: { label: "keyakinan rendah", cls: "bg-red-50 text-red-700" },
};

const KIND_LABEL: Record<string, string> = {
  consumable: "Habis pakai",
  asset: "Aset",
  labor: "Tenaga kerja",
  service: "Jasa",
};

export default async function DetailRabPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const { id } = await params;

  const plan = await getBudgetPlan(ctx, id);
  // RLS sudah menyaring lintas entitas, jadi "tidak ketemu" di sini berarti
  // benar-benar tidak ada ATAU milik entitas lain — keduanya 404 bagi pemanggil.
  if (!plan) notFound();

  const [items, perPhase, categories, uoms] = await Promise.all([
    listBudgetPlanItems(ctx, id),
    budgetPlanByPhase(ctx, id),
    listCategoryOptions(ctx),
    listOptions(ctx, "uom"),
  ]);

  const role = ctx.session.role;
  const isDrafter = ["agronomist", "super_admin"].includes(role);
  const isDecider = ["approver", "super_admin"].includes(role);
  const editable = plan.approvalStatus === "draft" || plan.approvalStatus === "rejected";
  // Rapat: finance boleh menambah baris SETELAH disetujui (mis. ahli hidrologi).
  const canAddItem = (isDrafter && editable) || (isDecider && plan.approvalStatus === "approved") || (isDecider && editable);

  return (
    <div>
      <Link href="/costing/rencana-anggaran" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Semua RAB
      </Link>

      <PageHeader
        title={`${plan.code} — ${plan.name}`}
        subtitle={`Horizon ${plan.horizonMonths} bulan · kontingensi ${formatNumber(plan.contingencyPct)}%${
          plan.areaHa === null ? "" : ` · ${formatNumber(plan.areaHa)} ha`
        }`}
        actions={<RecordStatusBadge status={plan.approvalStatus} />}
      />

      {plan.rejectionReason && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-800">
          <strong>Ditolak finance:</strong> {plan.rejectionReason}
        </div>
      )}

      {/* Catatan penyusun. Dataset demo memakainya untuk menyatakan bahwa
          angkanya ilustratif dan belum divalidasi agronomis — peringatan yang
          hanya tersimpan di database, tanpa pernah sampai ke layar, sama saja
          tidak ada. Ditempatkan SEBELUM angka, bukan sesudahnya. */}
      {plan.note && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm leading-relaxed text-amber-900">{plan.note}</p>
        </div>
      )}

      {/* CAPEX dan OPEX dipisah karena model Banyumas memisahkannya jadi dua
          sheet (08 vs 09): investasi sekali-seumur-proyek tidak boleh
          dijumlahkan begitu saja dengan biaya yang berulang tiap tahun. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kartu label="CAPEX — investasi awal" nilai={plan.capexIdr} />
        <Kartu label="OPEX — biaya berulang" nilai={plan.opexIdr} />
        <Kartu label={`Kontingensi ${formatNumber(plan.contingencyPct)}%`} nilai={plan.contingencyIdr} />
        <Kartu label="Total RAB" nilai={plan.totalIdr} tebal />
      </div>

      <div className="mb-5">
        <PlanDecision
          planId={plan.id}
          status={plan.approvalStatus}
          canSubmit={isDrafter && editable}
          canDecide={isDecider}
          itemCount={plan.itemCount}
        />
      </div>

      {canAddItem && (
        <div className="mb-5">
          <ItemForm
            planId={plan.id}
            horizonMonths={plan.horizonMonths}
            categories={categories}
            uoms={uoms}
            afterApproval={plan.approvalStatus === "approved"}
          />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada komponen biaya"
          description="Isi satu per satu seperti di Excel: kategori, uraian, volume, satuan, dan harga satuan. Biayanya dihitung database, bukan diketik ulang."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ResponsiveTable>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Tahap</th>
                    <th className="px-4 py-2.5 font-medium">Bulan</th>
                    <th className="px-4 py-2.5 font-medium">Kategori</th>
                    <th className="px-4 py-2.5 font-medium">Uraian</th>
                    <th className="px-4 py-2.5 font-medium">Jenis</th>
                    <th className="px-4 py-2.5 text-right font-medium">Volume</th>
                    <th className="px-4 py-2.5 text-right font-medium">Harga satuan</th>
                    <th className="px-4 py-2.5 text-right font-medium">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr
                      key={it.id}
                      className={cn(
                        "border-b border-slate-50 align-top last:border-0",
                        // Baris dicoret tetap TERLIHAT — itu inti kolom `Aktif`
                        // di 17_Model_Fleksibel: dikeluarkan dari total, bukan
                        // dari ingatan.
                        !it.isActive && "text-slate-400 line-through decoration-slate-300",
                      )}
                    >
                      <td data-label="Tahap" data-empty={!it.stage} className="px-4 py-2.5 text-xs text-slate-500">
                        {it.stage ?? EMPTY}
                        <span className="mt-0.5 block font-medium uppercase tracking-wide text-slate-400">
                          {it.costKind}
                        </span>
                      </td>
                      <td data-label="Bulan" className="px-4 py-2.5 tabular-nums text-slate-500">ke-{it.phaseMonth}</td>
                      <td data-label="Kategori" data-empty={!it.categoryName} className="px-4 py-2.5 text-slate-600">{it.categoryName ?? EMPTY}</td>
                      <td data-label="Uraian" className="px-4 py-2.5 text-slate-700">
                        {it.description}
                        {it.addedAfterApproval && (
                          <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700">
                            tambahan finance
                          </span>
                        )}
                        {it.note && <span className="block text-xs text-slate-400">{it.note}</span>}
                        {/* Dari mana angkanya. Kosong ditampilkan apa adanya —
                            angka anggaran tanpa asal-usul adalah angka
                            fabrikasi yang kebetulan rapi. */}
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {it.confidence ? (
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", CONFIDENCE[it.confidence].cls)}>
                              {CONFIDENCE[it.confidence].label}
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              keyakinan belum dinilai
                            </span>
                          )}
                          <span className="text-xs text-slate-400">
                            {it.sourceRef ? `sumber: ${it.sourceRef}` : "sumber belum disebutkan"}
                            {it.driver ? ` · penggerak: ${it.driver}` : ""}
                            {it.excludeFromContingency ? " · di luar kontingensi" : ""}
                            {!it.isActive ? " · DICORET" : ""}
                          </span>
                        </span>
                      </td>
                      <td data-label="Jenis" className="px-4 py-2.5 text-slate-500">{KIND_LABEL[it.itemKind] ?? it.itemKind}</td>
                      <td data-label="Volume" className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                        {formatNumber(it.volume)} {it.uomName ?? ""}
                      </td>
                      <td data-label="Harga satuan" className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatIdr(it.unitPriceIdr)}</td>
                      <td data-label="Jumlah" className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-700">{formatIdr(it.amountIdr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>

          {/* Simulasi drawdown yang dibahas rapat: berapa yang terpakai per bulan. */}
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Sebaran per bulan</h2>
            <ResponsiveTable>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Bulan ke-</th>
                    <th className="px-4 py-2.5 text-right font-medium">Rencana biaya</th>
                  </tr>
                </thead>
                <tbody>
                  {perPhase.map((p) => (
                    <tr key={p.phaseMonth} className="border-b border-slate-50 last:border-0">
                      <td data-label="Bulan ke-" className="px-4 py-2.5 tabular-nums text-slate-600">{p.phaseMonth}</td>
                      <td data-label="Rencana biaya" className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatIdr(p.amountIdr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        </>
      )}
    </div>
  );
}

function Kartu({ label, nilai, tebal }: { label: string; nilai: number | null; tebal?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      {/* null = belum ada komponen. Dirender em-dash, TIDAK diubah jadi Rp 0. */}
      <p className={`mt-1 tabular-nums ${tebal ? "text-xl font-bold text-slate-800" : "text-lg font-semibold text-slate-700"}`}>
        {nilai === null ? EMPTY : formatIdr(nilai)}
      </p>
    </div>
  );
}
