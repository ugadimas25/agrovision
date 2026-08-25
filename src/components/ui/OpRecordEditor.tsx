"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Pencil, Save, CircleAlert, X } from "lucide-react";
import type { ActionState } from "@/lib/actions/operational";
import type { Field } from "./OpRecordForm";
import { cn } from "@/lib/utils";

/**
 * B-21: perbaiki record draft/rejected — pop-up modal, bukan baris tabel yang
 * melar ke bawah (itu pola awal, tapi bikin tabel berantakan begitu ada
 * banyak field per baris). `<dialog>` native dipakai apa adanya — dapat
 * backdrop, tombol Escape, dan focus trap gratis tanpa dependency modal baru.
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Tutup otomatis begitu perbaikan tersimpan — pesan sukses toh sudah
  // tampil sesaat sebelum tabel di baliknya ikut ter-revalidate.
  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <Pencil className="h-3 w-3" />
        Perbaiki
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        className="m-auto w-[min(92vw,32rem)] rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
      >
        <form action={formAction} className="max-h-[85vh] overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-800">Perbaiki catatan</h2>
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
          <input type="hidden" name="module" value={module} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <EditFieldControl key={f.name} field={f} defaultValue={values[f.name]} error={state.fieldErrors?.[f.name]} />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            {/* Hanya pesan galat yang relevan ditampilkan di sini -- sukses
                langsung menutup dialog (efek di atas), jadi menyimpan pesan
                sukses lama hanya akan nongol lagi saat dialog dibuka ulang. */}
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
  const wide = f.kind === "textarea" ? "sm:col-span-2" : "";

  if (f.kind === "select") {
    return (
      <label className={cn("block", wide)}>
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
      <label className={cn("block", wide)}>
        {label}
        <textarea name={f.name} rows={2} defaultValue={String(dv)} placeholder={f.placeholder} className={base} />
      </label>
    );
  }
  return (
    <label className={cn("block", wide)}>
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
