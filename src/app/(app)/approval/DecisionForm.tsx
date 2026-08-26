"use client";

import { useActionState, useRef } from "react";
import { Check, X, Loader2, CircleAlert } from "lucide-react";
import { decideExpenditureAction, type ActionState } from "@/lib/actions/costing";
import { cn } from "@/lib/utils";

const initial: ActionState = { ok: false, message: "" };

/**
 * Setujui atau tolak.
 *
 * Alasan penolakan wajib (concept:187). Ditegakkan tiga lapis: atribut
 * `required` di HTML, skema zod di Server Action, dan CHECK constraint
 * `ct_rejection_needs_reason` di database. Lapis paling dalam yang menentukan —
 * dua lapis luar hanya membuat pesannya enak dibaca.
 *
 * "Tolak" pop-up modal (`<dialog>` native, B-33) -- pola OpRecordEditor.tsx,
 * bukan lagi <details> inline. "Setujui" TETAP tombol langsung tanpa modal --
 * tidak ada field yang perlu diisi, jadi menambah pop-up di situ hanya klik
 * ekstra tanpa manfaat.
 *
 * SATU `state` (satu useActionState) dipakai BERSAMA oleh form Setujui dan
 * Tolak -- review @dimasperceka-se di PR #44 menemukan dua akibatnya:
 *
 * 1. TIDAK ADA lagi efek yang membuka modal otomatis saat state berubah.
 *    Efek lama membuka "Tolak pengajuan" untuk SETIAP galat, termasuk galat
 *    dari percobaan Setujui (race: dua approver, satu sudah memutuskan lebih
 *    dulu) -- pop-up Tolak yang muncul sendiri setelah percobaan SETUJU
 *    mengundang salah klik ke arah berlawanan. Efeknya juga tidak
 *    diperlukan: modal yang sedang terbuka tidak tertutup oleh submit
 *    Server Action (tidak ada `method="dialog"`), jadi setelah penolakan
 *    yang gagal modalnya memang masih terbuka apa adanya.
 * 2. Galat non-field (mis. baris sudah diputuskan orang lain) ditampilkan
 *    di footer modal juga, bukan cuma di baris tabel -- baris tabel
 *    tertutup backdrop selama modal terbuka, jadi tanpa ini pengguna
 *    melihat modal diam tanpa penjelasan.
 */
export function DecisionForm({ moduleKey, id }: { moduleKey: string; id: string }) {
  const [state, formAction, pending] = useActionState(decideExpenditureAction, initial);
  const dialogRef = useRef<HTMLDialogElement>(null);

  if (state.ok) {
    return (
      <p className="flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" />
        {state.message}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {state.message && !state.ok && (
        <p className="flex items-start gap-1 text-xs leading-tight text-red-600">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <form action={formAction}>
          <input type="hidden" name="moduleKey" value={moduleKey} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="approved" />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Setujui
          </button>
        </form>

        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <X className="h-3.5 w-3.5" />
          Tolak
        </button>

        {/* Formnya tetap ada di DOM sejak render pertama (dialog native,
            bukan toggle useState), jadi penolakan tetap bisa dilakukan
            tanpa JavaScript -- sama seperti alasan <details> yang diganti. */}
        <dialog
          ref={dialogRef}
          onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
          className="m-auto w-[min(92vw,24rem)] rounded-xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-900/50"
        >
          <form action={formAction} className="w-full space-y-2 p-4">
            <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-800">Tolak pengajuan</h2>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Tutup"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input type="hidden" name="moduleKey" value={moduleKey} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="rejected" />
            <label htmlFor={`reason-${id}`} className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Alasan penolakan</span>
              <input
                id={`reason-${id}`}
                name="reason"
                required
                maxLength={500}
                placeholder="Alasan penolakan (wajib)"
                aria-invalid={state.fieldErrors?.reason ? true : undefined}
                className={cn(
                  "w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-red-500/30",
                  state.fieldErrors?.reason ? "border-red-400" : "border-slate-200",
                )}
              />
              {state.fieldErrors?.reason && (
                <p className="mt-1 text-xs text-red-600">{state.fieldErrors.reason}</p>
              )}
            </label>

            <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              {/* Galat non-field (mis. baris sudah diputuskan orang lain) --
                  baris tabel yang biasanya menampilkan state.message tertutup
                  backdrop selama modal ini terbuka, jadi ditampilkan juga di
                  sini. Pola sama dengan #40/#41/#43. */}
              {state.message && !state.ok && !state.fieldErrors?.reason && (
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
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Kirim penolakan
              </button>
            </div>
          </form>
        </dialog>
      </div>
    </div>
  );
}
