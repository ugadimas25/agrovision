"use client";

import { useActionState } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import type { ActionState } from "@/lib/actions/operational";
import { cn } from "@/lib/utils";

/**
 * Form entri operasional generik, dipakai ulang oleh Pemupukan, Persiapan Lahan,
 * Kesesuaian Lahan, dan Pruning. Field didefinisikan per layar sebagai data,
 * bukan JSX terpisah — satu langkah menuju form schema-driven penuh (concept:62).
 *
 * <details> native, bukan toggle useState: seluruh field ada di HTML sejak
 * render pertama, jadi form tetap terisi tanpa JavaScript.
 */

export type Field =
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[]; required?: boolean; allowEmpty?: boolean; hint?: string }
  | { kind: "text"; name: string; label: string; type?: string; required?: boolean; placeholder?: string; step?: string; min?: string; max?: string; hint?: string }
  | { kind: "textarea"; name: string; label: string; placeholder?: string };

export function OpRecordForm({
  title,
  action,
  fields,
  hidden,
  submitLabel,
}: {
  title: string;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: Field[];
  hidden?: Record<string, string>;
  /** Teks tombol simpan; default "Simpan draft" (modul ber-approval). */
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });

  return (
    <details className="group rounded-xl border border-slate-200 bg-white" open={state.message !== ""}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Plus className="h-4 w-4 text-emerald-600" />
          {title}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>

      {state.message && (
        <p
          role="status"
          className={cn(
            "mx-4 mb-3 flex items-start gap-1.5 rounded-md border px-3 py-2 text-sm",
            state.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700",
          )}
        >
          {state.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          {state.message}
        </p>
      )}

      <form action={formAction} className="border-t border-slate-100 p-4" key={state.ok ? "reset" : "form"}>
        {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <FieldControl key={f.name} field={f} error={state.fieldErrors?.[f.name]} />
          ))}
        </div>
        {/* Mobile: tombol simpan menempel di bawah form agar selalu terjangkau. */}
        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <button
            type="submit"
            disabled={pending}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 sm:w-auto"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {submitLabel ?? "Simpan draft"}
          </button>
        </div>
      </form>
    </details>
  );
}

/** Keyboard mobile yang tepat per tipe input. */
function inputModeFor(type?: string): React.HTMLAttributes<HTMLInputElement>["inputMode"] {
  if (type === "number") return "decimal";
  if (type === "tel") return "tel";
  if (type === "email") return "email";
  return undefined;
}

function FieldControl({ field: f, error }: { field: Field; error?: string }) {
  const base = cn(
    "min-h-11 w-full rounded-md border px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
    error ? "border-red-300" : "border-slate-200",
  );
  const label = (
    <label htmlFor={f.name} className="mb-1.5 block text-xs font-medium text-slate-500">
      {f.label}
    </label>
  );
  const err = error ? (
    <p className="mt-1 text-xs text-red-600">{error}</p>
  ) : "hint" in f && f.hint ? (
    <p className="mt-1 text-xs text-slate-500">{f.hint}</p>
  ) : null;

  if (f.kind === "select") {
    return (
      <div>
        {label}
        <select id={f.name} name={f.name} required={f.required} defaultValue="" aria-invalid={error ? true : undefined}
          className={cn(base, "bg-white")}>
          <option value="" disabled={!f.allowEmpty}>{f.allowEmpty ? "— tidak dipilih —" : "Pilih..."}</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {err}
      </div>
    );
  }
  if (f.kind === "textarea") {
    return (
      <div className="sm:col-span-2 lg:col-span-3">
        {label}
        <textarea id={f.name} name={f.name} rows={2} placeholder={f.placeholder} className={base} />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input id={f.name} name={f.name} type={f.type ?? "text"} required={f.required}
        inputMode={inputModeFor(f.type)}
        placeholder={f.placeholder} step={f.step} min={f.min} max={f.max}
        aria-invalid={error ? true : undefined} className={base} />
      {err}
    </div>
  );
}
