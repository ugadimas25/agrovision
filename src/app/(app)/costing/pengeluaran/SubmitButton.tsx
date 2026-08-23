"use client";

import { useActionState } from "react";
import { Loader2, Send } from "lucide-react";
import { submitExpenditureAction, type ActionState } from "@/lib/actions/costing";

const initial: ActionState = { ok: false, message: "" };

/** draft/rejected -> submitted. Memindahkan record ke Inbox Approval. */
export function SubmitButton({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(submitExpenditureAction, initial);

  // data-testid = pegangan STABIL untuk scripts/at-verify.mjs. Harness memilih form
  // dengan mencocokkan substring, jadi mencocokkan prosa ("Ajukan") rapuh: kata itu
  // juga muncul di pesan sukses ExpenditureForm yang berada di ATAS tabel, sehingga
  // uji menembak form yang salah dan kegagalannya baru terlihat jauh di AT4.
  return (
    <form action={formAction} data-testid="ajukan-pengeluaran" className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Ajukan
      </button>
      {state.message && !state.ok && (
        <span className="max-w-[200px] text-right text-xs leading-tight text-red-600">
          {state.message}
        </span>
      )}
    </form>
  );
}
