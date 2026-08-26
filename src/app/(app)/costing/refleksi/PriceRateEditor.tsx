"use client";

/**
 * Menerbitkan tarif BARU, bukan mengubah yang lama (K-02 §14, migrasi 0041).
 * Karena itu yang dikirim adalah `code` — penerbitan bekerja pada kode tarif:
 * versi lama ditutup, versi baru lahir, dan nilai historis tidak ikut berubah.
 *
 * Pop-up modal (`<dialog>` native, B-31) -- pola OpRecordEditor.tsx, bukan
 * lagi <details> inline. Formnya ADA di DOM sejak render pertama (dialog
 * native, bukan toggle useState) sehingga harness HTTP (`at:verify`) tetap
 * menemukannya -- tapi ini BUKAN "tetap bisa diterbitkan tanpa JavaScript".
 * `<dialog>` tanpa atribut `open` adalah `display: none`; satu-satunya
 * pemicunya `showModal()`, yang butuh JS. Regresi ini persis yang dicatat
 * komentar lama berkas ini sendiri soal versi `useState`: tanpa JS, tarif
 * memang tidak bisa diterbitkan sama sekali. Review @dimasperceka-se di
 * PR #43.
 *
 * INI BUKAN edit-di-tempat -- judul & label tombol modal sengaja tetap
 * menyebut "Terbitkan tarif baru", bukan "Ubah tarif", supaya tidak
 * menyiratkan sesuatu yang tidak dilakukan constraint DB-nya (versi lama
 * tidak pernah berubah, hanya ditutup).
 */

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Pencil, CircleAlert, Send, X } from "lucide-react";
import { setPriceRateAction, type PriceState } from "@/lib/actions/pricing";
import { formatIdr } from "@/lib/format";

const initial: PriceState = { ok: false, message: "" };

export function PriceRateEditor({
  code, rateIdr, unit, canEdit,
}: {
  code: string; rateIdr: number; unit: string; canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(setPriceRateAction, initial);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Tutup otomatis begitu penerbitan berhasil -- sama seperti OpRecordEditor.
  // Investigasi tambahan (Dimas, nit non-blocking): menahan modal terbuka
  // dengan konfirmasi eksplisit TIDAK bisa diandalkan di sini -- setPriceRateAction
  // memanggil revalidatePath("/costing/refleksi") (angka refleksi biaya harus
  // ikut ter-refresh), dan itu me-remount seluruh pohon komponen ini begitu
  // sukses, termasuk state dialognya sendiri. Diverifikasi langsung: modal
  // hilang seketika pasca-submit apa pun yang dilakukan di sini, sebelum
  // sempat menampilkan apa pun ke pengguna.
  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  const tarif = (
    <span className="tabular-nums text-slate-700">
      {formatIdr(rateIdr)}<span className="text-xs text-slate-500"> /{unit}</span>
    </span>
  );

  if (!canEdit) return tarif;

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex items-center gap-1.5 hover:opacity-80"
        title="Terbitkan tarif baru"
      >
        {tarif}
        <Pencil className="h-3 w-3 text-slate-300" />
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        className="m-auto w-[min(92vw,24rem)] rounded-xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-900/50"
      >
        <form action={action} data-testid={`terbitkan-tarif-${code}`} className="max-h-[85vh] w-full space-y-2 overflow-y-auto p-4">
          <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-800">Terbitkan tarif baru &mdash; {code}</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Tutup"
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            Versi lama ditutup, versi baru diterbitkan — nilai historis tidak ikut berubah.
          </p>

          <input type="hidden" name="code" value={code} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tarif baru</span>
            <div className="flex items-center gap-1.5">
              <input
                name="rateIdr"
                type="number"
                min="0"
                step="any"
                required
                defaultValue={rateIdr}
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm tabular-nums text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              <span className="shrink-0 text-xs text-slate-500">/{unit}</span>
            </div>
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
              disabled={pending}
              className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Terbitkan
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
