import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList, TriangleAlert } from "lucide-react";
import { requireContext } from "@/lib/session";
import {
  budgetPlanByPhase, getBudgetPlan, listBudgetAssumptions, listBudgetPlanItems,
  listBudgetSources,
} from "@/lib/repo/budgetPlan";
import { listCategoryOptions, listOptions } from "@/lib/repo/master";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { formatIdr, formatNumber, EMPTY } from "@/lib/format";
import { AssumptionPanel } from "./AssumptionPanel";
import { ItemForm } from "./ItemForm";
import { ItemGrid } from "./ItemGrid";
import { ImporExcel } from "./ImporExcel";
import { PlanDecision } from "./PlanDecision";
import { SourcePanel } from "./SourcePanel";

export const metadata = { title: "Detail RAB — AgroVision" };

/** 02_Assumptions memberi tiap angka tingkat keyakinan. Di model Banyumas, 51
 *  dari 100+ asumsi bertanda Low — itu informasi yang harus ikut terbaca,
 *  bukan aib yang disembunyikan. */
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

  const [items, perPhase, categories, uoms, assumptions, sources] = await Promise.all([
    listBudgetPlanItems(ctx, id),
    budgetPlanByPhase(ctx, id),
    listCategoryOptions(ctx),
    listOptions(ctx, "unit_of_measure"),
    listBudgetAssumptions(ctx, id),
    // Registri milik entitas, bukan RAB ini — jadi tanpa `id` (migrasi 0063).
    listBudgetSources(ctx),
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

      {/* Asumsi didahulukan di layar karena didahulukan juga secara logika:
          baris RAB menunjuk kodenya, jadi basis harus ada lebih dulu. */}
      <div className="mb-5">
        <AssumptionPanel planId={plan.id} assumptions={assumptions} canEdit={canAddItem} sources={sources} />
      </div>

      {/* Registri sumber (0063). Ditempatkan setelah asumsi karena urutan
          logikanya begitu: sumber menjelaskan dari mana asumsi berasal, dan
          asumsi menggerakkan baris. Terlihat oleh SEMUA peran — viewer pun
          harus bisa memeriksa dasar angka yang sedang ia baca; yang dibatasi
          hanya siapa yang boleh mendaftarkan. */}
      <div className="mb-5">
        <SourcePanel sources={sources} canEdit={canAddItem} />
      </div>

      {canAddItem && (
        <div className="mb-5">
          <ItemForm
            assumptions={assumptions.map((a) => ({ code: a.code, label: a.label, unit: a.unit, value: a.value }))}
            planId={plan.id}
            horizonMonths={plan.horizonMonths}
            categories={categories}
            uoms={uoms}
            afterApproval={plan.approvalStatus === "approved"}
            sources={sources}
          />
        </div>
      )}

      {/* Impor hanya untuk PENYUSUN pada RAB draft/rejected -- bukan
          canAddItem, yang juga mencakup finance menambah baris pada RAB yang
          sudah disetujui. Menumpahkan puluhan baris dari berkas ke RAB yang
          sudah diputuskan bukan "menambah pos susulan" seperti kesepakatan
          rapat, melainkan menyusun ulang anggaran yang sudah disetujui. */}
      <ImporExcel planId={plan.id} categories={categories} canEdit={isDrafter && editable} />

      {/* RAB kosong TETAP menampilkan tabelnya selama penyusunnya boleh
          menyunting: baris kosong di ujung tabel adalah tempat mengetiknya,
          jadi menggantinya dengan layar kosong justru menyembunyikan satu-satunya
          jalan masuk. Layar kosong hanya untuk yang memang cuma boleh membaca. */}
      {items.length === 0 && !canAddItem ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada komponen biaya"
          description="RAB ini belum berisi pos biaya apa pun. Agronomis yang menyusunnya akan mengisi kategori, uraian, volume, satuan, dan harga satuan — jumlah rupiahnya dihitung database."
        />
      ) : (
        <>
          <ItemGrid
            planId={plan.id}
            items={items}
            categories={categories}
            uoms={uoms}
            canEdit={canAddItem}
            afterApproval={plan.approvalStatus === "approved"}
          />

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
