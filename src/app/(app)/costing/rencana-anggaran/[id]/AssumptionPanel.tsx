"use client";

import { useActionState } from "react";
import { Loader2, Plus, Save, CircleAlert, CircleCheck, SlidersHorizontal } from "lucide-react";
import { addAssumptionAction, updateAssumptionAction, type PlanState } from "@/lib/actions/budgetPlan";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const initial: PlanState = { ok: false, message: "" };

export type Assumption = {
  id: string; code: string; label: string; value: number; unit: string | null;
  sourceRef: string | null; confidence: "high" | "medium" | "low" | null;
  note: string | null; usedBy: number;
};

const CONF: Record<string, { label: string; cls: string }> = {
  high: { label: "tinggi", cls: "bg-emerald-50 text-emerald-700" },
  medium: { label: "sedang", cls: "bg-amber-50 text-amber-700" },
  low: { label: "rendah", cls: "bg-red-50 text-red-700" },
};

/**
 * Pusat asumsi satu RAB — padanan 02_Assumptions di model Banyumas.
 *
 * Nilai di sini menggerakkan volume baris yang menunjuknya (basis × rasio),
 * dan perhitungan ulangnya dikerjakan trigger database, bukan halaman ini.
 * Karena itu mengubah satu angka di sini benar-benar menggeser total RAB —
 * dan kolom "dipakai" memberi tahu berapa baris yang akan ikut bergerak
 * SEBELUM tombol ditekan.
 */
export function AssumptionPanel({
  planId, assumptions, canEdit,
}: {
  planId: string;
  assumptions: Assumption[];
  canEdit: boolean;
}) {
  const [addState, addAction, adding] = useActionState(addAssumptionAction, initial);
  const [editState, editAction, saving] = useActionState(updateAssumptionAction, initial);
  const pesan = addState.message || editState.message;
  const pesanOk = addState.ok || editState.ok;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <SlidersHorizontal className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">Asumsi</h2>
        <span className="text-xs text-slate-400">
          nilai di sini menggerakkan volume baris yang memakainya
        </span>
      </header>

      {assumptions.length === 0 ? (
        <p className="px-4 py-4 text-sm leading-relaxed text-slate-500">
          Belum ada asumsi. Selama kosong, setiap volume harus diketik satu per satu —
          dan mengubah luas lahan berarti menyunting tiap baris tanpa jaminan semuanya ikut berubah.
        </p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {assumptions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <span className="font-mono text-xs text-slate-500">{a.code}</span>
              <span className="text-sm text-slate-700">{a.label}</span>

              {canEdit ? (
                <form action={editAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="planId" value={planId} />
                  <input
                    name="value"
                    type="number"
                    step="0.0001"
                    min="0"
                    defaultValue={a.value}
                    className="w-28 rounded-md border border-slate-200 px-2 py-1 text-right text-sm tabular-nums text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                  <span className="text-xs text-slate-500">{a.unit ?? ""}</span>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    title="Simpan & hitung ulang baris yang memakainya"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  </button>
                </form>
              ) : (
                <span className="tabular-nums text-sm font-medium text-slate-700">
                  {formatNumber(a.value)} {a.unit ?? ""}
                </span>
              )}

              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  a.confidence ? CONF[a.confidence].cls : "bg-slate-100 text-slate-500")}>
                  keyakinan {a.confidence ? CONF[a.confidence].label : "belum dinilai"}
                </span>
                <span className="text-xs text-slate-400">
                  {a.sourceRef ?? "sumber belum disebutkan"} · dipakai {a.usedBy} baris
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <details className="border-t border-slate-100">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
            <Plus className="h-4 w-4 text-emerald-700" /> Tambah asumsi
          </summary>
          <form action={addAction} className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="planId" value={planId} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Kode</span>
              <input name="code" required placeholder="net_ha" pattern="[a-z][a-z0-9_]{1,40}"
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" />
              <span className="mt-1 block text-xs text-slate-400">huruf kecil, angka, garis bawah</span>
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-500">Nama</span>
              <input name="label" required maxLength={120} placeholder="Areal efektif (88% bruto)"
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Nilai</span>
              <input name="value" type="number" step="0.0001" min="0" required
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Satuan</span>
              <input name="unit" maxLength={30} placeholder="ha efektif"
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Tingkat keyakinan</span>
              <select name="confidence" defaultValue=""
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30">
                <option value="">— belum dinilai —</option>
                <option value="high">Tinggi</option>
                <option value="medium">Sedang</option>
                <option value="low">Rendah</option>
              </select>
            </label>
            <label className="block lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-500">Sumber angka</span>
              <input name="sourceRef" maxLength={300} placeholder="mis. Kementan, Budi Daya Hortikultura 2022 — atau penawaran vendor"
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </label>
            <div className="lg:col-span-3">
              <button type="submit" disabled={adding}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Tambah asumsi
              </button>
            </div>
          </form>
        </details>
      )}

      {pesan && (
        <p role="status" className={cn("flex items-start gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs leading-relaxed",
          pesanOk ? "text-emerald-700" : "text-red-600")}>
          {pesanOk ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {pesan}
        </p>
      )}
    </section>
  );
}
