"use client";

/**
 * Form catat pengeluaran manual.
 *
 * TIDAK terpasang di layar Pengeluaran sejak model refleksi (docs/11 §4): biaya
 * mengalir dari aktivitas yang disetujui (volume x tarif), bukan input manual.
 *
 * SENGAJA DIPERTAHANKAN, bukan kode mati yang lupa dibuang:
 *   - AI-52 (docs/13 §13 aturan 5) akan memasangnya kembali dengan cakupan
 *     dipersempit -- khusus biaya overhead & upah tenaga kerja, yang memang
 *     tidak punya driver aktivitas.
 *   - Ini SATU-SATUNYA <input type="file"> di seluruh src/, jadi satu-satunya
 *     jalur unggah bukti (putEvidence) yang ada. Menghapusnya berarti aplikasi
 *     kehilangan kemampuan unggah bukti sama sekali.
 * Lihat catatan sejenis di createExpenditureAction (src/lib/actions/costing.ts).
 */

import { useActionState, useState } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck, ChevronDown, Upload } from "lucide-react";
import { createExpenditureAction, type ActionState } from "@/lib/actions/costing";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

const initial: ActionState = { ok: false, message: "" };

export function ExpenditureForm({
  categories,
  units,
  blocks,
  costCenters,
  periods,
  suppliers,
  penugasan,
}: {
  categories: Opt[];
  units: Opt[];
  blocks: Opt[];
  costCenters: Opt[];
  periods: Opt[];
  suppliers: Opt[];
  /** 0066: penugasan RAB yang masih terbuka untuk pencatat ini. */
  penugasan: Opt[];
}) {
  const [state, formAction, pending] = useActionState(createExpenditureAction, initial);
  const [overhead, setOverhead] = useState(false);

  // <details> native, BUKAN toggle useState: isi form harus ada di HTML sejak
  // render pertama supaya tetap bisa diisi ketika JavaScript gagal dimuat --
  // relevan untuk petugas lapangan dengan koneksi buruk.
  return (
    <details className="group rounded-xl border border-slate-200 bg-white" open={state.message !== ""}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Plus className="h-4 w-4 text-emerald-600" />
          Catat pengeluaran
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
          {state.ok ? (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {state.message}
        </p>
      )}

      <form
          action={formAction}
          encType="multipart/form-data"
          className="border-t border-slate-100 p-4"
          key={state.ok ? "reset" : "form"}
        >
          {/* Overhead vs per-blok — ditegakkan constraint ct_overhead_scope di DB */}
          <label className="mb-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="isOverhead"
              value="true"
              checked={overhead}
              onChange={(e) => setOverhead(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700"
            />
            <span>
              <span className="font-medium text-slate-700">Biaya overhead</span>
              <span className="block text-xs leading-relaxed text-slate-500">
                Tidak terikat blok tertentu. Dialokasikan ke blok saat menghitung biaya per hektar,
                mengikuti aturan alokasi.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!overhead && (
              <Select
                label="Blok"
                name="blockId"
                required
                options={blocks}
                error={state.fieldErrors?.blockId}
                hint="Dari master blok"
              />
            )}
            <Select
              label="Kategori biaya"
              name="costCategoryId"
              required
              options={categories}
              error={state.fieldErrors?.costCategoryId}
              hint="Dari master data"
            />
            <Select
              label="Cost center (opsional)"
              name="costCenterId"
              options={costCenters}
              allowEmpty
              error={state.fieldErrors?.costCenterId}
              hint="Untuk pemetaan ke ERP bila nanti diintegrasikan"
            />
            <Field
              label="Tanggal transaksi"
              name="transactionDate"
              type="date"
              required
              error={state.fieldErrors?.transactionDate}
            />
            <Select label="Supplier (opsional)" name="supplierId" options={suppliers} allowEmpty />
            <Select
              label="Periode fiskal (otomatis)"
              name="fiscalPeriodId"
              options={periods}
              allowEmpty
              hint={
                periods.length === 0
                  ? "Belum ada fase proyek — anggaran belum bisa dibandingkan"
                  : "Dibiarkan kosong: diisi otomatis dari tanggal transaksi"
              }
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Kuantitas (opsional)" name="quantity" type="number" step="0.001" min="0" />
            <Select label="Satuan (opsional)" name="uomItemId" options={units} allowEmpty />
            <Field
              label="Harga satuan (opsional)"
              name="unitPriceIdr"
              type="number"
              step="1"
              min="0"
              prefix="Rp"
            />
            <Field
              label="Total biaya"
              name="amountIdr"
              type="number"
              step="1"
              min="1"
              required
              prefix="Rp"
              error={state.fieldErrors?.amountIdr}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Tautan ke penugasan RAB — inilah yang membuat anggaran berkurang.
                Tanpa tautan, pengeluaran tetap tercatat tapi tidak muncul di
                serapan RAB mana pun; itu sah (tidak semua belanja berasal dari
                RAB) dan karena itu opsional, bukan wajib.

                Daftarnya kosong bila pencatat tidak sedang ditugasi apa pun —
                dan kalimat di bawah mengatakannya, supaya kosong tidak terbaca
                sebagai fitur yang rusak. */}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Realisasi dari penugasan RAB (opsional)
              </span>
              <select name="budgetAssignmentId" defaultValue=""
                className="min-h-11 w-full rounded-md border border-slate-200 px-3 text-sm">
                <option value="">— di luar RAB —</option>
                {penugasan.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-400">
                {penugasan.length === 0
                  ? "Belum ada penugasan RAB untuk Anda. Pengeluaran ini tercatat di luar RAB."
                  : "Dipilih = anggaran baris itu berkurang setelah pengeluaran disetujui."}
              </span>
            </label>

            <Field label="No. dokumen eksternal (opsional)" name="externalDocumentNo" />
            <Field label="Catatan (opsional)" name="note" />
          </div>

          {/* Bukti pembelian WAJIB (concept:160) — divalidasi di server juga */}
          <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
            <label htmlFor="evidence" className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <Upload className="h-4 w-4 text-emerald-600" />
              Bukti pembelian <span className="text-red-500">*</span>
            </label>
            <input
              id="evidence"
              name="evidence"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              // Di HP: langsung buka kamera belakang untuk memotret struk.
              capture="environment"
              aria-invalid={state.fieldErrors?.evidence ? true : undefined}
              className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-emerald-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-800"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Foto struk atau invoice. JPG, PNG, WebP, HEIC, atau PDF — maksimal 8 MB. Approver akan
              menolak bila tidak terbaca.
            </p>
            {state.fieldErrors?.evidence && (
              <p className="mt-1 text-xs text-red-600">{state.fieldErrors.evidence}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending}
            className="mt-4 flex items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Simpan sebagai draft
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Tersimpan sebagai draft. Ajukan dari daftar di bawah agar masuk approval.
          </p>
        </form>
    </details>
  );
}

function Field({
  label,
  name,
  error,
  prefix,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  prefix?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
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
  hint,
  required,
  allowEmpty,
}: {
  label: string;
  name: string;
  options: Opt[];
  error?: string;
  hint?: string;
  required?: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-medium text-slate-500">
        {label}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue=""
        aria-invalid={error ? true : undefined}
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
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
