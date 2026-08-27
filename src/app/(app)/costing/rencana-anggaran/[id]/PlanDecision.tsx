"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Check, Loader2, Send, X, CircleAlert, CircleCheck } from "lucide-react";
import { decidePlanAction, submitPlanAction, type PlanState } from "@/lib/actions/budgetPlan";
import { cn } from "@/lib/utils";

const initial: PlanState = { ok: false, message: "" };

/**
 * Ajukan (agronomis) dan Setujui/Tolak (finance).
 *
 * Dua `useActionState` TERPISAH, bukan satu yang dipakai berdua. Pelajaran dari
 * review PR #44: state bersama membuat galat dari satu tombol memicu tampilan
 * milik tombol lain — di sana, gagal "Setujui" membuka modal "Tolak".
 *
 * Alasan penolakan memakai <dialog> native (pola OpRecordEditor.tsx, B-33).
 * Konsekuensinya jujur: bagian ini butuh JavaScript. `<dialog>` tanpa atribut
 * open adalah display:none dan hanya bisa dibuka showModal().
 */
export function PlanDecision({
  planId, status, canSubmit, canDecide, itemCount,
}: {
  planId: string;
  status: string;
  canSubmit: boolean;
  canDecide: boolean;
  itemCount: number;
}) {
  const [submitState, submitAction, submitting] = useActionState(submitPlanAction, initial);
  const [decideState, decideAction, deciding] = useActionState(decidePlanAction, initial);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [clientError, setClientError] = useState("");

  const menunggu = status === "submitted" || status === "under_review";
  const tampilkanAjukan = canSubmit && (status === "draft" || status === "rejected");
  const tampilkanKeputusan = canDecide && menunggu;
  if (!tampilkanAjukan && !tampilkanKeputusan) return null;

  const pesan = clientError || submitState.message || decideState.message;
  const pesanOk = !clientError && (submitState.ok || decideState.ok);

  function ajukan(e: React.FormEvent<HTMLFormElement>) {
    // RAB kosong yang diajukan hanya membuang waktu finance. Ditahan di sini
    // supaya alasannya terbaca, bukan supaya jadi gerbang -- gerbangnya RLS.
    if (itemCount === 0) {
      e.preventDefault();
      setClientError("RAB ini belum punya satu komponen pun. Isi dulu sebelum diajukan.");
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {tampilkanAjukan && (
          <form action={submitAction} onSubmit={ajukan}>
            <input type="hidden" name="id" value={planId} />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Ajukan ke finance
            </button>
          </form>
        )}

        {tampilkanKeputusan && (
          <>
            <form action={decideAction}>
              <input type="hidden" name="id" value={planId} />
              <input type="hidden" name="decision" value="approved" />
              <button
                type="submit"
                disabled={deciding}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Setujui
              </button>
            </form>

            <button
              type="button"
              onClick={() => dialogRef.current?.showModal()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Tolak
            </button>
          </>
        )}

        {pesan && (
          <p role="status" className={cn("flex items-start gap-1.5 text-xs leading-relaxed", pesanOk ? "text-emerald-700" : "text-red-600")}>
            {pesanOk ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {pesan}
          </p>
        )}
      </div>

      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        className="m-auto w-[min(92vw,26rem)] rounded-xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-900/50"
      >
        <form
          className="w-full space-y-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            dialogRef.current?.close();
            startTransition(() => decideAction(fd));
          }}
        >
          <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-800">Tolak RAB</h2>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Tutup" className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <input type="hidden" name="id" value={planId} />
          <input type="hidden" name="decision" value="rejected" />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Alasan penolakan</span>
            {/* Wajib di tiga lapis: required di HTML, zod di action, dan CHECK
                budget_plans_rejection_needs_reason di database. */}
            <input
              name="reason"
              required
              maxLength={500}
              placeholder="mis. ajukan 5 M, budget hanya 4 M"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-red-500/30"
            />
          </label>

          <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Batal
            </button>
            <button type="submit" className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
              <X className="h-3.5 w-3.5" />
              Kirim penolakan
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
