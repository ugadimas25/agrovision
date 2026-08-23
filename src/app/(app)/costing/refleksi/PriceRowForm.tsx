"use client";

/**
 * AI-44a · tambah baris tarif baru (K-09 §19).
 *
 * Sebelum ini tidak ada jalur create sama sekali — `INSERT INTO app.price_list`
 * hanya ada di db/seed-demo.mjs, jadi setiap tarif baru menuntut migrasi. Ini
 * prasyarat K-03: harga per grade berarti satu baris revenue per grade.
 *
 * <details> native, BUKAN toggle useState: seluruh field harus ada di HTML
 * server sejak render pertama supaya form tetap bisa diisi dan disubmit ketika
 * JavaScript gagal dimuat. Pola yang sama dipakai ExpenditureForm dan
 * ExpenditureEditor; PriceRateEditor tadinya pengecualian dan sudah ikut
 * dipindahkan.
 *
 * `data-testid` pada <form>-nya adalah pegangan uji: at-verify memilih form
 * dengan mencocokkan ke seluruh elemen <form>, dan mencocokkan PROSA membuat
 * uji menembak form yang salah begitu ada kalimat serupa di halaman.
 */

import { useActionState } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import { createPriceRowAction, type PriceState } from "@/lib/actions/pricing";
import { cn } from "@/lib/utils";

const initial: PriceState = { ok: false, message: "" };

type Opt = { value: string; label: string };

/** Di tingkat modul, bukan di dalam render: komponen yang dibuat saat render
 *  kehilangan identitasnya tiap render (react-hooks/static-components). */
function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-600">{msg}</p>;
}

export function PriceRowForm({
  driverOptions,
  categoryOptions,
  hariIni,
}: {
  driverOptions: Opt[];
  categoryOptions: Opt[];
  hariIni: string;
}) {
  const [state, formAction, saving] = useActionState(createPriceRowAction, initial);

  const inputCls =
    "w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30";
  const err = (k: string) => state.fieldErrors?.[k];
  const cls = (k: string) => cn(inputCls, err(k) ? "border-red-300" : "border-slate-200");

  return (
    <details className="group border-b border-slate-100" open={state.message !== "" && !state.ok}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Plus className="h-4 w-4" />
        Tambah baris tarif baru
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>

      <form
        action={formAction}
        data-testid="tambah-tarif"
        className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3"
      >
        <p className="text-xs leading-relaxed text-slate-500">
          <strong>Kode</strong>, <strong>jenis</strong>, dan <strong>driver</strong> tidak bisa diubah
          sesudah baris ini dibuat (K-09). Salah isi berarti membuat baris baru dan menonaktifkan yang
          lama. <strong>Tarif</strong> dan <strong>satuan</strong> diubah lewat penerbitan versi baru,
          jadi nilai historis tidak ikut berubah.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Kode</span>
            <input
              name="code"
              required
              maxLength={60}
              placeholder="REV-DUR-B"
              aria-invalid={err("code") ? true : undefined}
              className={cn(cls("code"), "font-mono uppercase")}
            />
            <FieldError msg={err("code")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Jenis</span>
            <select name="kind" defaultValue="cost" required aria-invalid={err("kind") ? true : undefined} className={cls("kind")}>
              <option value="cost">Biaya</option>
              <option value="revenue">Revenue</option>
            </select>
            <FieldError msg={err("kind")} />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Kategori <span className="font-normal">— label tampilan, bebas</span>
            </span>
            <input
              name="category"
              required
              maxLength={120}
              placeholder="Durian Musang King grade B"
              aria-invalid={err("category") ? true : undefined}
              className={cls("category")}
            />
            <FieldError msg={err("category")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tarif (Rp)</span>
            <input
              name="rateIdr"
              type="number"
              min="0"
              step="any"
              required
              aria-invalid={err("rateIdr") ? true : undefined}
              className={cn(cls("rateIdr"), "tabular-nums")}
            />
            <FieldError msg={err("rateIdr")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Satuan</span>
            <input
              name="unit"
              required
              maxLength={30}
              placeholder="ton / ha / kg / pohon"
              aria-invalid={err("unit") ? true : undefined}
              className={cls("unit")}
            />
            <FieldError msg={err("unit")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Berlaku mulai</span>
            <input
              name="berlakuDari"
              type="date"
              defaultValue={hariIni}
              required
              aria-invalid={err("berlakuDari") ? true : undefined}
              className={cls("berlakuDari")}
            />
            <FieldError msg={err("berlakuDari")} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Driver volume <span className="font-normal">— baris biaya saja</span>
            </span>
            <select name="driver" defaultValue="" aria-invalid={err("driver") ? true : undefined} className={cls("driver")}>
              <option value="">Tanpa driver — tarif manual</option>
              {driverOptions.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <FieldError msg={err("driver")} />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Kategori akuntansi <span className="font-normal">— kunci pembanding anggaran, baris biaya saja</span>
            </span>
            <select
              name="costCategoryId"
              defaultValue=""
              aria-invalid={err("costCategoryId") ? true : undefined}
              className={cls("costCategoryId")}
            >
              <option value="">— belum dipetakan —</option>
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <FieldError msg={err("costCategoryId")} />
            <p className="mt-1 text-xs text-slate-500">
              Tanpa ini, biaya dari baris tarif ini tidak akan cocok dengan anggaran mana pun.
            </p>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Catatan</span>
            <input name="note" maxLength={1000} className={cls("note")} />
            <FieldError msg={err("note")} />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          Buat baris tarif
        </button>

        {state.message && (
          <p
            role="status"
            className={cn("flex items-start gap-1 text-xs leading-snug", state.ok ? "text-emerald-700" : "text-red-600")}
          >
            {!state.ok && <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
