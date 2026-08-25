"use client";

import { useActionState } from "react";
import { Loader2, Pencil, Save, CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import type { ActionState } from "@/lib/actions/operational";
import type { Field } from "./OpRecordForm";
import { cn } from "@/lib/utils";

/**
 * B-21: perbaiki record draft/rejected — pola persis ExpenditureEditor
 * (src/app/(app)/costing/pengeluaran/ExpenditureEditor.tsx), tapi generik
 * lewat Field[] (tipe yang sama dari OpRecordForm) supaya satu komponen
 * dipakai ulang di 9 modul operasional, bukan 9 editor terpisah.
 *
 * <details> native, BUKAN toggle useState: field editor harus ada di HTML
 * sejak render pertama supaya tetap terisi & bisa disubmit tanpa JavaScript.
 */

const initial: ActionState = { ok: false, message: "" };

export function OpRecordEditor({
  id,
  module,
  fields,
  values,
  action,
}: {
  id: string;
  module: string;
  fields: Field[];
  /** Nilai sekarang, keyed sama dengan Field.name — dari OpRecord.editValues. */
  values: Record<string, string | number | null>;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, saving] = useActionState(action, initial);

  return (
    <details className="group w-full text-left" open={state.message !== "" && !state.ok}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Pencil className="h-3 w-3" />
        Perbaiki
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
      </summary>

      <form action={formAction} className="mt-2 w-full space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 sm:w-80">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="module" value={module} />
        <div className="grid grid-cols-1 gap-2">
          {fields.map((f) => (
            <EditFieldControl key={f.name} field={f} defaultValue={values[f.name]} error={state.fieldErrors?.[f.name]} />
          ))}
        </div>

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

function EditFieldControl({
  field: f,
  defaultValue,
  error,
}: {
  field: Field;
  defaultValue: string | number | null | undefined;
  error?: string;
}) {
  const base = cn(
    "min-h-9 w-full rounded-md border bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
    error ? "border-red-300" : "border-slate-200",
  );
  const label = (
    <span className="mb-1 block text-xs font-medium text-slate-500">{f.label}</span>
  );
  const err = error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null;
  const dv = defaultValue ?? "";

  if (f.kind === "select") {
    return (
      <label className="block">
        {label}
        <select
          name={f.name}
          required={f.required}
          defaultValue={String(dv)}
          aria-invalid={error ? true : undefined}
          className={cn(base)}
        >
          <option value="" disabled={!f.allowEmpty}>{f.allowEmpty ? "— tidak dipilih —" : "Pilih..."}</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {err}
      </label>
    );
  }
  if (f.kind === "textarea") {
    return (
      <label className="block">
        {label}
        <textarea name={f.name} rows={2} defaultValue={String(dv)} placeholder={f.placeholder} className={base} />
      </label>
    );
  }
  return (
    <label className="block">
      {label}
      <input
        name={f.name}
        type={f.type ?? "text"}
        required={f.required}
        defaultValue={dv}
        placeholder={f.placeholder}
        step={f.step}
        min={f.min}
        max={f.max}
        aria-invalid={error ? true : undefined}
        className={base}
      />
      {err}
    </label>
  );
}
