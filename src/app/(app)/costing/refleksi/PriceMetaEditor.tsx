"use client";

/**
 * AI-44b · ubah metadata tarif — kelas "edit in-place" K-09 §19.
 *
 * Yang bisa diubah di sini: label kategori, kategori AKUNTANSI, catatan, dan
 * status aktif. Tarif dan satuan TIDAK — keduanya berversi dan diubah lewat
 * penerbitan versi baru pada kolom Tarif. Kode, jenis, dan driver kekal.
 *
 * Kenapa kategori akuntansi ada di sini dan bukan cuma kosmetik: ia kunci yang
 * dipakai perbandingan anggaran. Tarif tanpa kategori menghasilkan biaya yang
 * tidak match anggaran mana pun — akar QA B-20 yang muncul lagi di instalasi baru
 * justru karena pemetaan ini hanya bisa dilakukan lewat seed/SQL.
 *
 * Pop-up modal (`<dialog>` native, B-31) -- pola OpRecordEditor.tsx, bukan lagi
 * <details> inline. m-auto untuk penengahan (preflight Tailwind menghapus
 * margin bawaan dialog), backdrop + Escape + focus trap gratis dari elemen
 * browser. Ini genuinely edit-di-tempat (metadata saja, bukan versi tarif),
 * jadi polanya diterapkan apa adanya -- lihat PriceRateEditor.tsx untuk
 * kontras dengan penerbitan versi baru.
 */

import { useActionState, useEffect, useRef } from "react";
import { Loader2, SlidersHorizontal, Save, CircleAlert, X } from "lucide-react";
import { updatePriceMetaAction, type PriceState } from "@/lib/actions/pricing";
import { cn } from "@/lib/utils";

const initial: PriceState = { ok: false, message: "" };

type Opt = { value: string; label: string };

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-600">{msg}</p>;
}

export function PriceMetaEditor({
  id, code, category, note, isActive, costCategoryId, categoryOptions, isCost,
}: {
  id: string;
  code: string;
  category: string;
  note: string | null;
  isActive: boolean;
  costCategoryId: string | null;
  categoryOptions: Opt[];
  isCost: boolean;
}) {
  const [state, formAction, saving] = useActionState(updatePriceMetaAction, initial);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  const inputCls =
    "w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30";
  const err = (k: string) => state.fieldErrors?.[k];
  const cls = (k: string) => cn(inputCls, err(k) ? "border-red-300" : "border-slate-200");

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <SlidersHorizontal className="h-3 w-3" />
        Ubah
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        className="m-auto w-[min(92vw,26rem)] rounded-xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-900/50"
      >
      <form
        action={formAction}
        data-testid={`ubah-meta-${code}`}
        className="max-h-[85vh] w-full space-y-2 overflow-y-auto p-4"
      >
        <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-sm font-semibold text-slate-800">Ubah metadata &mdash; {code}</h2>
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
        <p className="text-xs leading-relaxed text-slate-500">
          Berlaku untuk <strong>seluruh versi</strong> kode {code} — label dan pemetaan akuntansi
          adalah sifat kodenya, bukan sifat satu versi tarif. Tarif &amp; satuan diubah lewat
          penerbitan versi baru.
        </p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Kategori (label tampilan)</span>
          <input name="category" defaultValue={category} maxLength={120} className={cls("category")} />
          <FieldError msg={err("category")} />
        </label>

        {isCost && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Kategori akuntansi <span className="font-normal">— kunci pembanding anggaran</span>
            </span>
            <select name="costCategoryId" defaultValue={costCategoryId ?? ""} className={cls("costCategoryId")}>
              <option value="">— belum dipetakan —</option>
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <FieldError msg={err("costCategoryId")} />
            {!costCategoryId && (
              <p className="mt-1 text-xs text-amber-700">
                Belum dipetakan: biaya dari tarif ini tidak akan muncul di serapan anggaran.
              </p>
            )}
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Catatan</span>
          <input name="note" defaultValue={note ?? ""} maxLength={1000} className={cls("note")} />
          <FieldError msg={err("note")} />
        </label>

        {/* Nilai dikirim EKSPLISIT lewat select, bukan checkbox: checkbox yang tidak
            dicentang tidak ikut terkirim, dan fungsi database memakai COALESCE —
            jadi "nonaktifkan" akan terbaca sebagai "jangan ubah". */}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
          <select name="isActive" defaultValue={isActive ? "true" : "false"} className={cls("isActive")}>
            <option value="true">Aktif — ikut dihitung</option>
            <option value="false">Nonaktif — tidak ikut dihitung</option>
          </select>
          <FieldError msg={err("isActive")} />
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
            Simpan
          </button>
        </div>
      </form>
      </dialog>
    </>
  );
}
