"use client";

import { Fragment, useActionState } from "react";
import Link from "next/link";
import {
  Loader2,
  Plus,
  CircleAlert,
  CircleCheck,
  ChevronDown,
  Inbox,
  Pencil,
  Save,
} from "lucide-react";
import {
  createMasterItemAction,
  deactivateMasterItemAction,
  updateMasterItemAction,
  type ActionState,
} from "@/lib/actions/master";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { cn } from "@/lib/utils";

type TypeTab = { code: string; name: string; itemCount: number; isHierarchical: boolean };
type Item = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  isActive: boolean;
  isGlobal: boolean;
};

const initial: ActionState = { ok: false, message: "" };

/**
 * B-30: baris induk & turunan dikelompokkan secara visual (bukan tabel datar
 * dengan kolom "Induk" yang mengulang nama induknya di tiap baris turunan).
 * Baris induk BUKAN header dekoratif -- tetap item master sungguhan yang
 * bisa di-"Ubah"/nonaktifkan, jadi tetap dirender lewat ItemRow yang sama,
 * hanya visualnya (bg + indentasi turunan) yang beda dari baris datar biasa.
 *
 * Dikelompokkan eksplisit dari parentId, bukan mengandalkan urutan sort_order
 * yang KEBETULAN sudah bersebelahan di data saat ini -- turunan baru dengan
 * sort_order sembarangan akan tetap tergabung benar dengan cara ini.
 */
function groupHierarchical(items: Item[]): { parent: Item; children: Item[] }[] {
  const visible = new Set(items.map((it) => it.id));
  // Yatim -- parentId menunjuk baris yang TIDAK ikut terlihat (mis. induknya
  // milik entitas lain; parent_id tidak dibatasi satu entitas di 0015_master)
  // -- diangkat jadi baris tingkat atas, BUKAN dibuang. Baris yang hilang dari
  // layar ini tidak bisa diedit/dinonaktifkan lagi, dan hilangnya terbaca
  // sebagai "belum ada data".
  const isTop = (it: Item) => it.parentId === null || !visible.has(it.parentId);

  const byParent = new Map<string, Item[]>();
  for (const it of items) {
    const pid = it.parentId;
    if (pid === null || !visible.has(pid)) continue;
    const list = byParent.get(pid) ?? [];
    list.push(it);
    byParent.set(pid, list);
  }
  return items.filter(isTop).map((parent) => ({ parent, children: byParent.get(parent.id) ?? [] }));
}

export function MasterDataManager({
  types,
  activeCode,
  activeTypeName,
  isHierarchical,
  items,
}: {
  types: TypeTab[];
  activeCode: string;
  activeTypeName: string;
  isHierarchical: boolean;
  items: Item[];
}) {
  const [createState, createFormAction, creating] = useActionState(createMasterItemAction, initial);
  const [deactState, deactFormAction] = useActionState(deactivateMasterItemAction, initial);

  const notice = createState.message ? createState : deactState.message ? deactState : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
      <nav aria-label="Tipe master data" className="space-y-1">
        {types.map((t) => (
          <Link
            key={t.code}
            href={`/pengaturan/master-data?tipe=${t.code}`}
            aria-current={t.code === activeCode ? "page" : undefined}
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
              t.code === activeCode
                ? "bg-emerald-50 font-medium text-emerald-800"
                : "text-slate-600 hover:bg-slate-50",
            )}
          >
            <span className="truncate">{t.name}</span>
            <span className="ml-2 shrink-0 rounded bg-slate-100 px-1.5 text-xs tabular-nums text-slate-500">
              {t.itemCount}
            </span>
          </Link>
        ))}
      </nav>

      <div className="space-y-4">
        {notice && (
          <p
            role="status"
            className={cn(
              "flex items-start gap-1.5 rounded-md border px-3 py-2 text-sm",
              notice.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {notice.ok ? (
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {notice.message}
          </p>
        )}

        <form
          action={createFormAction}
          className="rounded-xl border border-slate-200 bg-white p-4"
          key={createState.ok ? `reset-${items.length}` : "form"}
        >
          <input type="hidden" name="masterTypeCode" value={activeCode} />
          <p className="mb-3 text-sm font-semibold text-slate-800">
            Tambah item &mdash; {activeTypeName}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_100px_auto]">
            <Field
              label="Kode"
              name="code"
              placeholder="KG"
              required
              error={createState.fieldErrors?.code}
              hint="Huruf kapital, angka, _ dan -"
            />
            <Field
              label="Nama"
              name="name"
              placeholder="Kilogram"
              required
              error={createState.fieldErrors?.name}
            />
            <Field
              label="Urutan"
              name="sortOrder"
              type="number"
              defaultValue="0"
              error={createState.fieldErrors?.sortOrder}
            />
            <div className="flex items-end">
              <button
                type="submit"
                disabled={creating}
                className="flex h-[42px] w-full items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 sm:w-auto"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Tambah
              </button>
            </div>
          </div>

          {isHierarchical && (
            <p className="mt-2 text-xs text-slate-500">
              Tipe ini berjenjang. Sub-kategori dibuat dengan memilih induk &mdash; belum tersedia di
              layar ini.
            </p>
          )}
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {items.length === 0 ? (
            <div className="p-10 text-center">
              <Inbox className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">Belum ada item</p>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                Tambahkan lewat formulir di atas. Item yang ditambahkan langsung tersedia di dropdown
                form terkait.
              </p>
            </div>
          ) : (
            <ResponsiveTable>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Kode</th>
                    <th className="px-4 py-2.5 font-medium">Nama</th>
                    <th className="px-4 py-2.5 text-right font-medium">Urutan</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {isHierarchical
                    ? groupHierarchical(items).map(({ parent, children }) => (
                        <Fragment key={parent.id}>
                          <ItemRow item={parent} variant="parent" deactFormAction={deactFormAction} />
                          {children.map((child) => (
                            <ItemRow key={child.id} item={child} variant="child" deactFormAction={deactFormAction} />
                          ))}
                        </Fragment>
                      ))
                    : items.map((it) => (
                        <ItemRow key={it.id} item={it} deactFormAction={deactFormAction} />
                      ))}
                </tbody>
              </table>
            </ResponsiveTable>
          )}
        </div>

        <p className="text-xs leading-relaxed text-slate-500">
          Item dinonaktifkan, bukan dihapus &mdash; transaksi lama yang merujuknya harus tetap bisa
          dibaca. Mengubah nama berlaku juga pada transaksi lama: yang tersimpan di transaksi adalah
          rujukan ke item ini, bukan salinan namanya. Kode tidak bisa diubah.
        </p>
      </div>
    </div>
  );
}

/**
 * Satu baris item + editor inline-nya (AI-29).
 *
 * <details> native, BUKAN toggle useState — lihat catatan di
 * costing/pengeluaran/ExpenditureForm.tsx: seluruh field editor harus ada di HTML
 * sejak render pertama supaya tetap bisa diisi & disubmit ketika JavaScript gagal
 * dimuat. Panelnya sengaja mengalir di dalam sel, bukan popover `absolute` seperti
 * ReportDownload: pembungkus tabel memakai overflow-x-auto, dan overflow-x
 * non-visible membuat overflow-y ikut memotong — popover akan terpangkas.
 *
 * useActionState per baris (pola DecisionForm di inbox approval), bukan satu state
 * bersama: pesan galat harus menempel pada baris yang gagal.
 *
 * Kode & tipe master TIDAK diedit di sini. Keduanya identitas item (indeks unik
 * master_items_master_type_id_company_id_code_key dan mi_global_uniq), dan
 * updateMasterItemAction memang tidak menerimanya — jadi tidak ada field yang
 * ditampilkan tapi pasti gagal.
 *
 * Baris GLOBAL (company_id IS NULL) sengaja TIDAK bisa diedit dari sini. RLS
 * meloloskannya untuk super_admin (mi_tenant: `company_id IS NULL OR ...`), jadi
 * satu rename akan mengubah label itu untuk SETIAP entitas, retroaktif di seluruh
 * laporan lama mereka. Layar ini tidak pernah punya jalur tulis ke baris global —
 * form Tambah selalu memakai ctx.companyId — dan tidak dibuka di sini.
 */
function ItemRow({
  item,
  variant = "flat",
  deactFormAction,
}: {
  item: Item;
  /** B-30: "parent"/"child" hanya untuk tipe berjenjang -- kelompok visual
   *  pengganti kolom "Induk" yang dihapus (lihat groupHierarchical). */
  variant?: "flat" | "parent" | "child";
  deactFormAction: (formData: FormData) => void;
}) {
  const [editState, editFormAction, saving] = useActionState(updateMasterItemAction, initial);

  const inputCls =
    "w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30";
  const nameErrId = `nama-${item.id}-error`;
  const sortErrId = `urutan-${item.id}-error`;

  return (
    <tr
      className={cn(
        "align-top",
        variant === "parent"
          ? "border-b border-slate-100 bg-slate-50/60"
          : "border-b border-slate-50 last:border-0",
      )}
    >
      <td data-label="Kode" className="px-4 py-2.5 font-mono text-xs text-slate-500">{item.code}</td>
      <td data-label="Nama" className={cn("px-4 py-2.5 text-slate-700", variant === "parent" && "font-semibold")}>
        {/* Turunan diindentasi + penanda pohon, pengganti kolom "Induk" yang
            berulang menyebut nama induk di tiap barisnya (B-30). */}
        {variant === "child" && <span className="mr-1 text-slate-300">&#x21B3;</span>}
        {item.name}
        {item.isGlobal && (
          <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700">
            global
          </span>
        )}
      </td>
      {variant !== "flat" && (
        // Kartu mobile (<768px) jadi blok label-nilai lepas dari tabel --
        // indentasi & bg pembeda baris induk (di atas) TIDAK bertahan di sana
        // (.rt-cards tr{background:#fff} menang atas bg-slate-50/60), jadi
        // satu-satunya sinyal yang tersisa cuma tebal/↳. Sel ini mengembalikan
        // identitas induk secara eksplisit, khusus mobile (md:hidden) --
        // review @dimasperceka-se di PR #42.
        <td data-label="Induk" data-empty={!item.parentName} className="px-4 py-2.5 text-slate-500 md:hidden">
          {item.parentName ?? "—"}
        </td>
      )}
      <td data-label="Urutan" className="px-4 py-2.5 text-right tabular-nums text-slate-500">
        {item.sortOrder}
      </td>
      <td data-label="Status" className="px-4 py-2.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-medium",
            item.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
          )}
        >
          {item.isActive ? "Aktif" : "Nonaktif"}
        </span>
      </td>
      <td data-action className="px-4 py-2.5 text-right">
        {/* Di mobile <td data-action> menjadi flex justify-end (lihat .rt-cards di
            globals.css); wrapper w-full membuat kedua aksi tetap terjangkau di
            375px dan panel editor tetap selebar kartu. */}
        <div className="flex w-full flex-wrap items-start justify-end gap-x-3 gap-y-2">
          {item.isGlobal ? (
            <span className="text-xs leading-snug text-slate-400">
              Baris global &mdash; dipakai semua entitas, tidak diubah dari sini
            </span>
          ) : (
            <details className="group w-full sm:w-auto" open={editState.message !== ""}>
              <summary className="flex cursor-pointer list-none items-center justify-end gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden sm:justify-start">
                <Pencil className="h-3 w-3" />
                Ubah
                <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              </summary>

              <form
                action={editFormAction}
                className="mt-2 w-full space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-left sm:w-64"
              >
                <input type="hidden" name="id" value={item.id} />

                <p className="text-[11px] leading-snug text-slate-500">
                  Kode <span className="font-mono">{item.code}</span> dan tipe master tidak diubah di
                  sini &mdash; keduanya identitas item ini.
                </p>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Nama</span>
                  <input
                    name="name"
                    defaultValue={item.name}
                    required
                    maxLength={160}
                    aria-invalid={editState.fieldErrors?.name ? true : undefined}
                    aria-describedby={editState.fieldErrors?.name ? nameErrId : undefined}
                    className={cn(
                      inputCls,
                      editState.fieldErrors?.name ? "border-red-300" : "border-slate-200",
                    )}
                  />
                  {editState.fieldErrors?.name && (
                    <p id={nameErrId} className="mt-1 text-xs text-red-600">
                      {editState.fieldErrors.name}
                    </p>
                  )}
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Urutan</span>
                    <input
                      name="sortOrder"
                      type="number"
                      min={0}
                      max={9999}
                      defaultValue={item.sortOrder}
                      aria-invalid={editState.fieldErrors?.sortOrder ? true : undefined}
                      aria-describedby={editState.fieldErrors?.sortOrder ? sortErrId : undefined}
                      className={cn(
                        inputCls,
                        "tabular-nums",
                        editState.fieldErrors?.sortOrder ? "border-red-300" : "border-slate-200",
                      )}
                    />
                    {editState.fieldErrors?.sortOrder && (
                      <p id={sortErrId} className="mt-1 text-xs text-red-600">
                        {editState.fieldErrors.sortOrder}
                      </p>
                    )}
                  </label>
                  {/* Status di editor sekaligus jalur "aktifkan kembali": baris
                      nonaktif tidak lagi kehilangan seluruh aksinya (catatan 9.2). */}
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
                    <select
                      name="isActive"
                      defaultValue={item.isActive ? "true" : "false"}
                      className={cn(inputCls, "border-slate-200")}
                    >
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : editState.ok ? (
                    <CircleCheck className="h-3.5 w-3.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Simpan
                </button>

                {editState.message && (
                  <p
                    role="status"
                    className={cn(
                      "text-xs leading-snug",
                      editState.ok ? "text-emerald-700" : "text-red-600",
                    )}
                  >
                    {editState.message}
                  </p>
                )}
              </form>
            </details>
          )}

          {item.isActive && (
            <form action={deactFormAction}>
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:text-red-600"
              >
                Nonaktifkan
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-medium text-slate-500">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={cn(
          "w-full rounded-md border px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
          error ? "border-red-300" : "border-slate-200",
        )}
        {...rest}
      />
      {error ? (
        <p id={`${name}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
