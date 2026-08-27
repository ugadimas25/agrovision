"use client";

import { useActionState } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck } from "lucide-react";
import { createPlanAction, type PlanState } from "@/lib/actions/budgetPlan";
import { cn } from "@/lib/utils";

const initial: PlanState = { ok: false, message: "" };

/**
 * Form buat-baru, bukan editor baris — jadi <details> di atas halaman memang
 * polanya (lihat catatan B-32: yang dipindah ke modal hanya editor baris
 * existing). Fieldnya sedikit dan sengaja: header RAB cuma kerangka; isinya
 * ditambahkan komponen per komponen di halaman detail.
 */
export function PlanForm() {
  const [state, formAction, pending] = useActionState(createPlanAction, initial);
  const err = (k: string) => state.fieldErrors?.[k];
  const cls = (k: string) =>
    cn("min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
       err(k) ? "border-red-300" : "border-slate-200");

  return (
    <details className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
        <Plus className="h-4 w-4 text-emerald-700" />
        Susun RAB baru
      </summary>

      <form action={formAction} className="border-t border-slate-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Kode</span>
            <input name="code" required maxLength={60} placeholder="RAB-2026-KELAPA" className={cls("code")} />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Nama</span>
            <input name="name" required maxLength={200} placeholder="RAB set-up kebun kelapa + durian" className={cls("name")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Luas rencana (ha)</span>
            {/* Boleh kosong — dan kosong TIDAK menjadi 0. Nol hektar berarti
                "tidak ada lahan", bukan "belum ditentukan". */}
            <input name="areaHa" type="number" step="0.01" min="0.01" placeholder="mis. 100" className={cls("areaHa")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Horizon (bulan)</span>
            <input name="horizonMonths" type="number" min="1" max="120" defaultValue={12} required className={cls("horizonMonths")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Kontingensi (%)</span>
            <input name="contingencyPct" type="number" step="0.5" min="0" max="100" defaultValue={5} required className={cls("contingencyPct")} />
            <span className="mt-1 block text-xs text-slate-400">Disepakati 5% di rapat 26 Agu.</span>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Buat RAB
          </button>
          {state.message && (
            <p role="status" className={cn("flex items-start gap-1.5 text-xs leading-relaxed", state.ok ? "text-emerald-700" : "text-red-600")}>
              {state.ok ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {state.message}
            </p>
          )}
        </div>
      </form>
    </details>
  );
}
