"use client";

/**
 * Menerbitkan tarif BARU, bukan mengubah yang lama (K-02 §14, migrasi 0041).
 * Karena itu yang dikirim adalah `code` — penerbitan bekerja pada kode tarif:
 * versi lama ditutup, versi baru lahir, dan nilai historis tidak ikut berubah.
 *
 * <details> native, BUKAN toggle useState. Versi sebelumnya menyembunyikan
 * <form> di balik `useState(false)`, jadi formnya TIDAK ADA di HTML server dan
 * tarif tidak bisa diterbitkan sama sekali tanpa JavaScript — pada satu-satunya
 * layar yang mengendalikan seluruh angka keuangan. Pola <details> menaruh
 * seluruh field di DOM sejak render pertama (ExpenditureForm, ExpenditureEditor,
 * PriceRowForm memakai pola yang sama).
 */

import { useActionState } from "react";
import { Loader2, Pencil, Check } from "lucide-react";
import { setPriceRateAction, type PriceState } from "@/lib/actions/pricing";
import { formatIdr } from "@/lib/format";
import { cn } from "@/lib/utils";

const initial: PriceState = { ok: false, message: "" };

export function PriceRateEditor({
  code, rateIdr, unit, canEdit,
}: {
  code: string; rateIdr: number; unit: string; canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(setPriceRateAction, initial);

  const tarif = (
    <span className="tabular-nums text-slate-700">
      {formatIdr(rateIdr)}<span className="text-xs text-slate-500"> /{unit}</span>
    </span>
  );

  if (!canEdit) return tarif;

  return (
    <details className="group inline-block text-right" open={state.message !== "" && !state.ok}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        {tarif}
        <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-500" />
      </summary>

      <form action={action} data-testid={`terbitkan-tarif-${code}`} className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        <input type="hidden" name="code" value={code} />
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Tarif baru</span>
          <input
            name="rateIdr"
            type="number"
            min="0"
            step="any"
            required
            defaultValue={rateIdr}
            className="w-32 rounded-md border border-slate-200 px-2 py-1 text-sm tabular-nums text-slate-700"
          />
        </label>
        <span className="text-xs text-slate-500">/{unit}</span>
        <button type="submit" disabled={pending} className="rounded bg-emerald-700 p-1 text-white hover:bg-emerald-800 disabled:opacity-60" title="Terbitkan versi baru">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        {state.message && (
          <span role="status" className={cn("w-full text-xs", state.ok ? "text-emerald-700" : "text-red-600")}>
            {state.message}
          </span>
        )}
      </form>
    </details>
  );
}
