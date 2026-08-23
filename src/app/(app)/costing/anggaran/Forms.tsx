"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import {
  createBudgetAction,
  createFiscalPeriodAction,
  type ActionState,
} from "@/lib/actions/costing";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };
const initial: ActionState = { ok: false, message: "" };

function Notice({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={cn(
        "mx-4 mb-3 flex items-start gap-1.5 rounded-md border px-3 py-2 text-sm",
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-700",
      )}
    >
      {state.ok ? (
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      {state.message}
    </p>
  );
}

/** Periode fiskal = fase proyek (keputusan #6). Nama & rentangnya dari klien. */
export function PeriodForm({
  periods,
}: {
  periods: { id: string; code: string; name: string; startsOn: string; endsOn: string }[];
}) {
  const [state, formAction, pending] = useActionState(createFiscalPeriodAction, initial);

  return (
    <details className="group rounded-xl border border-slate-200 bg-white" open={periods.length === 0 || state.message !== ""}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Plus className="h-4 w-4 text-emerald-600" />
          Fase proyek
          <span className="rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">
            {periods.length}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>

      <Notice state={state} />

      <form action={formAction} className="border-t border-slate-100 p-4" key={state.ok ? "reset" : "form"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Kode" name="code" placeholder="FASE-1" required error={state.fieldErrors?.code} />
          <Field
            label="Nama fase"
            name="name"
            placeholder="Fase 1 — Pengadaan Bibit"
            required
            error={state.fieldErrors?.name}
            className="lg:col-span-2"
          />
          <Field label="Mulai" name="startsOn" type="date" required error={state.fieldErrors?.startsOn} />
          <Field label="Selesai" name="endsOn" type="date" required error={state.fieldErrors?.endsOn} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="mt-3 flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Simpan fase
        </button>

        {periods.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {periods.map((p) => (
              <li key={p.id}>
                <span className="font-mono text-slate-500">{p.code}</span> &middot; {p.name} &middot;{" "}
                {p.startsOn} → {p.endsOn}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {/* DECISION NEEDED: nama & rentang fase proyek sebenarnya dari klien */}
          Nama dan rentang fase yang sebenarnya perlu dikonfirmasi klien — belum diseed karena itu
          keputusan bisnis, bukan struktur.
        </p>
      </form>
    </details>
  );
}

type Scope = "company" | "estate" | "block";

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: "company", label: "Seluruh entitas" },
  { value: "estate", label: "Per estate" },
  { value: "block", label: "Per blok" },
];

/**
 * Deteksi hidrasi lewat useSyncExternalStore, BUKAN useEffect(setState).
 *
 * Yang dibutuhkan adalah satu nilai yang `false` pada render server dan `true`
 * di klien — itu persis kontrak getServerSnapshot vs getSnapshot. Versi
 * useEffect(() => setDinamis(true)) melakukan hal yang sama tapi lewat render
 * kedua, dan react-hooks memang melarangnya (cascading render).
 *
 * Store-nya tidak pernah berubah, jadi `subscribe` mengembalikan unsubscribe
 * kosong; keduanya di tingkat modul supaya identitasnya stabil antar render.
 */
const langganan = () => () => {};
const diKlien = () => true;
const diServer = () => false;

const SCOPE_HINT: Record<Scope, string> = {
  company: "Anggaran se-entitas. Estate dan blok tidak dipakai — realisasinya menjumlahkan seluruh entitas.",
  estate: "Anggaran satu estate. Blok tidak dipakai; realisasinya hanya blok milik estate itu.",
  block: "Anggaran satu blok. Estate tidak dipakai — estate sudah ditentukan oleh bloknya.",
};

/**
 * AI-05 · form anggaran dinamis per lingkup (catatan 6.7).
 *
 * Dua aturan yang menentukan bentuk komponen ini:
 *
 * 1. WAJIB tetap bisa disubmit tanpa JavaScript. Karena itu SELURUH field
 *    dirender di HTML server, dan penyembunyian baru berlaku SESUDAH hidrasi
 *    (`dinamis`). Kalau show/hide dihitung dari state awal, HTML servernya
 *    lahir sudah tanpa field estate/blok dan lingkup estate/blok menjadi
 *    mustahil diisi begitu JS gagal dimuat — persis kelas cacat yang sudah
 *    tercatat untuk PriceRateEditor dan OrganicTracker.
 *
 * 2. Field yang disembunyikan juga di-`disabled`, bukan hanya di-`hidden`.
 *    Select yang tersembunyi TETAP ikut terkirim; tanpa `disabled`, pengguna
 *    yang memilih estate lalu berpindah ke lingkup blok akan mengirim estateId
 *    yang sudah tidak relevan — dan sejak AI-05 server MENOLAKnya (dulu
 *    dibuang diam-diam). Field `disabled` tidak masuk FormData sama sekali.
 *
 * Penegakan sebenarnya tetap di server: `budgetSchema` (superRefine dua arah)
 * dan CHECK `budgets_scope_coherent`. Yang di sini hanya mengurangi kesempatan
 * salah, bukan gerbangnya.
 *
 * Catatan penyimpangan dari catatan 6.7: catatan itu menulis "Scope Semua →
 * tampilkan Estate dan Blok". Itu tidak bisa dijalankan — CHECK
 * budgets_scope_coherent menuntut estate_id DAN block_id NULL untuk lingkup
 * company, jadi field yang ditampilkan itu pasti ditolak begitu diisi.
 * Lingkup "Seluruh entitas" karena itu menyembunyikan keduanya.
 */
export function BudgetForm({
  periods,
  categories,
  estates,
  blocks,
}: {
  periods: Opt[];
  categories: Opt[];
  estates: Opt[];
  blocks: Opt[];
}) {
  const [state, formAction, pending] = useActionState(createBudgetAction, initial);
  const [scope, setScope] = useState<Scope>("company");
  // false pada render server & sebelum hidrasi -> semua field tampil & aktif.
  const dinamis = useSyncExternalStore(langganan, diKlien, diServer);

  const relevan = (s: Scope) => !dinamis || scope === s;

  return (
    <details className="group rounded-xl border border-slate-200 bg-white" open={state.message !== ""}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Plus className="h-4 w-4 text-emerald-600" />
          Susun anggaran
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>

      <Notice state={state} />

      <form action={formAction} data-testid="susun-anggaran" className="border-t border-slate-100 p-4" key={state.ok ? "reset" : "form"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Fase proyek" name="fiscalPeriodId" required options={periods} error={state.fieldErrors?.fiscalPeriodId} />
          <Select label="Kategori biaya" name="costCategoryId" required options={categories} error={state.fieldErrors?.costCategoryId} />
          <Select
            label="Lingkup"
            name="scopeType"
            required
            defaultValue="company"
            options={SCOPE_OPTIONS}
            error={state.fieldErrors?.scopeType}
            onChange={(v) => setScope(v as Scope)}
          />
        </div>

        {dinamis && (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{SCOPE_HINT[scope]}</p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Estate"
            name="estateId"
            options={estates}
            allowEmpty
            error={state.fieldErrors?.estateId}
            hint={dinamis ? undefined : "hanya bila lingkup Per estate"}
            hidden={!relevan("estate")}
          />
          <Select
            label="Blok"
            name="blockId"
            options={blocks}
            allowEmpty
            error={state.fieldErrors?.blockId}
            hint={dinamis ? undefined : "hanya bila lingkup Per blok"}
            hidden={!relevan("block")}
          />
          <Field
            label="Nilai anggaran"
            name="amountIdr"
            type="number"
            min="1"
            step="1"
            required
            prefix="Rp"
            error={state.fieldErrors?.amountIdr}
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-3 flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Simpan anggaran
        </button>
      </form>
    </details>
  );
}

function Field({
  label,
  name,
  error,
  prefix,
  className,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  prefix?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1.5 block text-xs font-medium text-slate-500">
        {label}
      </label>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-3 py-2.5 focus-within:ring-2 focus-within:ring-emerald-500/30",
          error ? "border-red-300" : "border-slate-200",
        )}
      >
        {prefix && <span className="text-sm text-slate-500">{prefix}</span>}
        <input
          id={name}
          name={name}
          aria-invalid={error ? true : undefined}
          className="w-full bg-transparent text-sm text-slate-700 outline-none"
          {...rest}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Select({
  label,
  name,
  options,
  error,
  required,
  allowEmpty,
  defaultValue,
  hint,
  hidden,
  onChange,
}: {
  label: string;
  name: string;
  options: Opt[];
  error?: string;
  required?: boolean;
  allowEmpty?: boolean;
  defaultValue?: string;
  hint?: string;
  /** Disembunyikan DAN dinonaktifkan: select tersembunyi tetap ikut terkirim. */
  hidden?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className={hidden ? "hidden" : undefined}>
      <label htmlFor={name} className="mb-1.5 block text-xs font-medium text-slate-500">
        {label}
        {hint && <span className="font-normal text-slate-400"> — {hint}</span>}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        disabled={hidden}
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={cn(
          "w-full rounded-md border bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
          error ? "border-red-300" : "border-slate-200",
        )}
      >
        <option value="" disabled={!allowEmpty}>
          {allowEmpty ? "— tidak dipilih —" : "Pilih..."}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
