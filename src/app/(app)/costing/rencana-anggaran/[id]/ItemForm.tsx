"use client";

import { useActionState } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck } from "lucide-react";
import { addItemAction, type PlanState } from "@/lib/actions/budgetPlan";
import { cn } from "@/lib/utils";

const initial: PlanState = { ok: false, message: "" };
type Option = { value: string; label: string };

const KINDS: Option[] = [
  { value: "consumable", label: "Habis pakai (pupuk, dolomit, bibit)" },
  { value: "asset", label: "Aset (cangkul, mesin)" },
  { value: "labor", label: "Tenaga kerja (orang-hari)" },
  { value: "service", label: "Jasa / borongan" },
];

/**
 * Baris RAB ditambahkan satu per satu — "seperti Excel", kata rapatnya.
 *
 * Jumlah rupiah SENGAJA tidak ada di form ini: amount_idr adalah kolom
 * GENERATED di database (volume × harga satuan, migrasi 0060). Menyediakan
 * kolomnya di sini berarti mengundang angka yang tidak cocok dengan
 * perkaliannya sendiri.
 */
export function ItemForm({
  planId, horizonMonths, categories, uoms, afterApproval,
}: {
  planId: string;
  horizonMonths: number;
  categories: Option[];
  uoms: Option[];
  afterApproval: boolean;
}) {
  const [state, formAction, pending] = useActionState(addItemAction, initial);
  const err = (k: string) => state.fieldErrors?.[k];
  const cls = (k: string) =>
    cn("min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
       err(k) ? "border-red-300" : "border-slate-200");

  return (
    <details className="group rounded-xl border border-slate-200 bg-white" open={state.message !== "" && !state.ok}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
        <Plus className="h-4 w-4 text-emerald-700" />
        Tambah komponen biaya
      </summary>

      <form action={formAction} className="border-t border-slate-100 p-4">
        <input type="hidden" name="planId" value={planId} />

        {afterApproval && (
          <p className="mb-3 rounded-md border border-sky-200 bg-sky-50 p-2.5 text-xs leading-relaxed text-sky-900">
            RAB ini sudah disetujui. Baris yang Anda tambahkan akan ditandai
            <strong> tambahan finance</strong> supaya terbaca bahwa ia bukan bagian usulan awal agronomis.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Bulan ke-</span>
            <input name="phaseMonth" type="number" min="1" max={horizonMonths} defaultValue={1} required className={cls("phaseMonth")} />
            <span className="mt-1 block text-xs text-slate-400">1 = bulan pertama proyek. Maksimum {horizonMonths}.</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Kategori biaya</span>
            <select name="costCategoryId" required defaultValue="" className={cls("costCategoryId")}>
              <option value="" disabled>Pilih…</option>
              {categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Jenis</span>
            <select name="itemKind" defaultValue="consumable" className={cls("itemKind")}>
              {KINDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="block lg:col-span-3">
            <span className="mb-1 block text-xs font-medium text-slate-500">Uraian</span>
            <input name="description" required maxLength={300} placeholder="mis. Bibit kelapa genjah 140/ha" className={cls("description")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Volume</span>
            <input name="volume" type="number" step="0.0001" min="0.0001" required className={cls("volume")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Satuan</span>
            <select name="uomItemId" defaultValue="" className={cls("uomItemId")}>
              <option value="">— tidak dipilih —</option>
              {uoms.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Harga satuan (Rp)</span>
            <input name="unitPriceIdr" type="number" step="1" min="0" required className={cls("unitPriceIdr")} />
          </label>

          <label className="block lg:col-span-3">
            <span className="mb-1 block text-xs font-medium text-slate-500">Catatan (opsional)</span>
            <input name="note" maxLength={500} className={cls("note")} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Tambah
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
