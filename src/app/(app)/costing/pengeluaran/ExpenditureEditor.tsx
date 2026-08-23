"use client";

/**
 * Perbaiki pengeluaran draft / ditolak (AI-11, catatan 6.5).
 *
 * Sebelum ini record yang ditolak jadi jalan buntu: alasan penolakannya terbaca
 * tapi tidak ada cara memperbaikinya, jadi satu-satunya jalan adalah membuat
 * record baru dan meninggalkan yang lama menggantung.
 *
 * <details> native, BUKAN toggle useState: seluruh field editor harus ada di HTML
 * sejak render pertama supaya tetap bisa diisi dan disubmit ketika JavaScript
 * gagal dimuat — sama seperti ExpenditureForm dan DecisionForm.
 *
 * useActionState per baris (pola DecisionForm): pesan galat harus menempel pada
 * baris yang gagal, bukan melayang di atas tabel tanpa menyebut baris mana.
 */

import { useActionState } from "react";
import { Loader2, Pencil, Save, CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import { updateExpenditureAction, type ActionState } from "@/lib/actions/costing";
import { cn } from "@/lib/utils";

const initial: ActionState = { ok: false, message: "" };

type Opt = { value: string; label: string };

export function ExpenditureEditor({
  id,
  categories,
  costCategoryId,
  transactionDate,
  amountIdr,
  note,
}: {
  id: string;
  categories: Opt[];
  costCategoryId: string | null;
  transactionDate: string | null;
  amountIdr: number | null;
  note: string | null;
}) {
  const [state, formAction, saving] = useActionState(updateExpenditureAction, initial);

  const inputCls =
    "w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30";
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <details className="group w-full text-left" open={state.message !== "" && !state.ok}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Pencil className="h-3 w-3" />
        Ubah
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
      </summary>

      <form action={formAction} className="mt-2 w-full space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 sm:w-72">
        <input type="hidden" name="id" value={id} />

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Kategori biaya</span>
          <select
            name="costCategoryId"
            defaultValue={costCategoryId ?? ""}
            required
            aria-invalid={err("costCategoryId") ? true : undefined}
            className={cn(inputCls, err("costCategoryId") ? "border-red-300" : "border-slate-200")}
          >
            <option value="">— pilih —</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {err("costCategoryId") && <p className="mt-1 text-xs text-red-600">{err("costCategoryId")}</p>}
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tanggal</span>
            <input
              name="transactionDate"
              type="date"
              defaultValue={transactionDate ?? ""}
              required
              aria-invalid={err("transactionDate") ? true : undefined}
              className={cn(inputCls, err("transactionDate") ? "border-red-300" : "border-slate-200")}
            />
            {err("transactionDate") && <p className="mt-1 text-xs text-red-600">{err("transactionDate")}</p>}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Total (Rp)</span>
            <input
              name="amountIdr"
              type="number"
              min="1"
              step="any"
              defaultValue={amountIdr ?? ""}
              required
              aria-invalid={err("amountIdr") ? true : undefined}
              className={cn(inputCls, "tabular-nums", err("amountIdr") ? "border-red-300" : "border-slate-200")}
            />
            {err("amountIdr") && <p className="mt-1 text-xs text-red-600">{err("amountIdr")}</p>}
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Catatan</span>
          <input name="note" defaultValue={note ?? ""} maxLength={1000} className={cn(inputCls, "border-slate-200")} />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          Simpan perbaikan
        </button>

        {state.message && (
          <p
            role="status"
            className={cn(
              "flex items-start gap-1 text-xs leading-snug",
              state.ok ? "text-emerald-700" : "text-red-600",
            )}
          >
            {!state.ok && <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
