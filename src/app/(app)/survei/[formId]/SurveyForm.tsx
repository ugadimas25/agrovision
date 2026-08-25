"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, Send, CircleAlert, CircleCheck } from "lucide-react";
import { submitSurveyAction, updateSurveySubmissionAction, type SurveyState } from "@/lib/actions/survey";
import type { SurveyForm as FormSchema, SurveyField } from "@/lib/repo/operational";
import { cn } from "@/lib/utils";

const initial: SurveyState = { ok: false, message: "" };

export function SurveyForm({
  form,
  blocks,
  editId,
  initialBlockId,
  initialValues,
}: {
  form: FormSchema;
  blocks: { value: string; label: string }[];
  /** B-21: bila terisi, form ini memperbaiki hasil survei ditolak, bukan mengisi baru. */
  editId?: string;
  initialBlockId?: string | null;
  /** Nilai jawaban lama, keyed field code -- dari surveySubmissionDetail(). */
  initialValues?: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(editId ? updateSurveySubmissionAction : submitSurveyAction, initial);

  if (state.submitted) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CircleCheck className="mx-auto h-8 w-8 text-emerald-600" />
        <p className="mt-2 text-sm font-medium text-emerald-800">{state.message}</p>
        <Link href={editId ? `/survei/hasil/${editId}` : "/survei"} className="mt-3 inline-block rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100">
          {editId ? "Lihat hasil" : "Kembali ke Survei"}
        </Link>
      </div>
    );
  }

  // Kelompokkan field per section, urutan tetap.
  const sections: { name: string; fields: SurveyField[] }[] = [];
  for (const f of form.fields) {
    const name = f.section ?? "Umum";
    let s = sections.find((x) => x.name === name);
    if (!s) { s = { name, fields: [] }; sections.push(s); }
    s.fields.push(f);
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="formId" value={form.formId} />
      {editId && <input type="hidden" name="id" value={editId} />}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label htmlFor="blockId" className="mb-1.5 block text-xs font-medium text-slate-500">Blok / plot yang disurvei</label>
        <select
          id="blockId"
          name="blockId"
          required
          defaultValue={initialBlockId ?? ""}
          className={cn("min-h-11 w-full max-w-md rounded-md border bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30", state.fieldErrors?.blockId ? "border-red-300" : "border-slate-200")}
        >
          <option value="" disabled>Pilih blok...</option>
          {blocks.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        {state.fieldErrors?.blockId && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.blockId}</p>}
      </div>

      {sections.map((s) => (
        <section key={s.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">{s.name}</h2>
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
            {s.fields.map((f) => (
              <Field key={f.id} field={f} error={state.fieldErrors?.[f.code]} defaultValue={initialValues?.[f.code]} />
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 -mx-4 flex flex-col items-stretch gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:items-center sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {editId ? "Simpan perbaikan & ajukan ulang" : "Kirim survei"}
        </button>
        {state.message && !state.submitted && (
          <span className="flex items-center gap-1.5 text-sm text-red-700"><CircleAlert className="h-4 w-4" />{state.message}</span>
        )}
      </div>
    </form>
  );
}

function Field({ field, error, defaultValue }: { field: SurveyField; error?: string; defaultValue?: string }) {
  const label = (
    <label htmlFor={field.code} className="mb-1.5 block text-xs font-medium text-slate-500">
      {field.label}{field.required && <span className="text-red-500"> *</span>}
    </label>
  );
  const cls = cn("min-h-11 w-full rounded-md border bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30", error ? "border-red-300" : "border-slate-200");
  const isComment = field.code.endsWith("_comment") || field.fieldType === "text";
  const wide = isComment ? "md:col-span-2" : "";

  const dv = defaultValue ?? "";
  let input: React.ReactNode;
  if (field.fieldType === "single_choice") {
    input = (
      <select id={field.code} name={field.code} defaultValue={dv} required={field.required} className={cls}>
        <option value="" disabled={field.required}>{field.required ? "Pilih..." : "— tidak dinilai —"}</option>
        {field.choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  } else if (field.fieldType === "yes_no") {
    input = (
      <select id={field.code} name={field.code} defaultValue={dv} required={field.required} className={cls}>
        <option value="" disabled={field.required}>Pilih...</option>
        <option value="Ya">Ya</option>
        <option value="Tidak">Tidak</option>
      </select>
    );
  } else if (field.fieldType === "date") {
    input = <input id={field.code} name={field.code} type="date" defaultValue={dv} required={field.required} className={cls} />;
  } else if (field.fieldType === "number") {
    input = <input id={field.code} name={field.code} type="number" inputMode="decimal" step="any" defaultValue={dv} required={field.required} className={cls} />;
  } else {
    input = <textarea id={field.code} name={field.code} rows={2} defaultValue={dv} required={field.required} className={cls} placeholder="Catatan (opsional)" />;
  }

  return (
    <div className={wide}>
      {label}
      {input}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
