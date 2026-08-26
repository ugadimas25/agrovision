"use client";

/**
 * Perbaiki pengeluaran draft / ditolak (AI-11, catatan 6.5).
 *
 * Sebelum ini record yang ditolak jadi jalan buntu: alasan penolakannya terbaca
 * tapi tidak ada cara memperbaikinya, jadi satu-satunya jalan adalah membuat
 * record baru dan meninggalkan yang lama menggantung.
 *
 * Pop-up modal (`<dialog>` native, B-32) -- ironisnya berkas ini justru rujukan
 * asal saat OpRecordEditor.tsx (pola standar 9 modul operasional) ditulis,
 * tapi tidak pernah diperbarui balik. Sekarang menyusul: m-auto untuk
 * penengahan (preflight Tailwind menghapus margin bawaan dialog), backdrop
 * + Escape + focus trap gratis dari elemen native, tanpa dependency modal baru.
 *
 * useActionState per baris (pola DecisionForm): pesan galat harus menempel pada
 * baris yang gagal, bukan melayang di atas tabel tanpa menyebut baris mana.
 */

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Pencil, Save, CircleAlert, X } from "lucide-react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Tutup otomatis begitu perbaikan tersimpan -- sama seperti OpRecordEditor.
  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  const inputCls =
    "w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30";
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <Pencil className="h-3 w-3" />
        Ubah
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        className="m-auto w-[min(92vw,28rem)] rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
      >
      <form action={formAction} className="max-h-[85vh] w-full space-y-2 overflow-y-auto p-4">
        <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-sm font-semibold text-slate-800">Ubah pengeluaran</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Tutup"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

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

        <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {state.message && !state.ok && (
            <p role="status" className="mr-auto flex items-center gap-1 text-xs leading-snug text-red-600">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              {state.message}
            </p>
          )}
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Simpan perbaikan
          </button>
        </div>
      </form>
      </dialog>
    </>
  );
}
