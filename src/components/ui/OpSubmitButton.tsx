"use client";

import { useActionState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { submitOpAction, type ActionState } from "@/lib/actions/operational";

const initial: ActionState = { ok: false, message: "" };

export function OpSubmitButton({ module, id }: { module: string; id: string }) {
  const [state, formAction, pending] = useActionState(submitOpAction, initial);

  // Pada sukses, baris biasanya ikut dirender ulang menjadi "Diajukan" sehingga
  // tombol ini unmount. Bila revalidate menyusul belakangan, konfirmasinya tetap
  // terlihat -- sebelumnya pesan {ok:true} dibuang dan pengguna hanya melihat
  // spinner. Pola sama dengan DecisionForm di layar Approval.
  if (state.ok) {
    return (
      <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" />
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="module" value={module} />
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
        <span className="max-w-[200px] text-right text-xs text-red-600">{state.message}</span>
      )}
    </form>
  );
}
