"use client";

import { useActionState } from "react";
import { Loader2, CircleAlert, CircleCheck, EyeOff, Eye, Trash2, Save, Plus } from "lucide-react";
import { gridAction, type PlanState } from "@/lib/actions/budgetPlan";
import type { BudgetPlanItemRow } from "@/lib/repo/budgetPlan";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatIdr, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceLink } from "./SourceLink";

const initial: PlanState = { ok: false, message: "" };

const KIND_LABEL: Record<string, string> = {
  consumable: "Habis pakai",
  asset: "Aset",
  labor: "Tenaga kerja",
  service: "Jasa",
};

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: "keyakinan tinggi", cls: "bg-emerald-50 text-emerald-700" },
  medium: { label: "keyakinan sedang", cls: "bg-amber-50 text-amber-700" },
  low: { label: "keyakinan rendah", cls: "bg-rose-50 text-rose-700" },
};

/** Sel yang bisa diketik: terlihat seperti teks sampai disentuh. */
const SEL =
  "min-h-11 w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 " +
  "hover:border-slate-200 focus:border-emerald-500 focus:bg-white focus:outline-none " +
  "focus:ring-2 focus:ring-emerald-500/15 disabled:hover:border-transparent";

type Option = { value: string; label: string };

type Props = {
  planId: string;
  items: BudgetPlanItemRow[];
  categories: Option[];
  uoms: Option[];
  /** Boleh menyunting baris sama sekali (peran + status RAB). */
  canEdit: boolean;
  /** RAB sudah disetujui: baris lama beku, hanya tambahan finance yang lentur. */
  afterApproval: boolean;
};

/**
 * Tabel komponen RAB yang bisa disunting langsung — "seperti Excel tapi lebih
 * modern", permintaan rapat.
 *
 * Tiga hal yang membentuk desainnya, semuanya karena doktrin repo ini:
 *
 * 1. SATU form untuk seluruh tabel, bukan satu form per baris. <form> tidak
 *    boleh bersarang di <tr>/<td>, dan menyiasatinya dengan atribut `form=`
 *    membuat urutan fokus melompat di pembaca layar. Konsekuensinya tombol
 *    coret/hapus adalah tombol submit yang membawa `_aksi` — jadi seluruh
 *    tabel tetap berfungsi tanpa JavaScript.
 *
 * 2. Sel volume baris turunan TIDAK bisa diketik. Volumenya milik trigger
 *    0062 (nilai_asumsi × rasio); menyediakan kotak isian di situ berarti
 *    mengundang angka yang bertentangan dengan rumus yang dicetak di
 *    bawahnya. Yang ditampilkan justru rumusnya.
 *
 * 3. Jumlah rupiah tidak pernah bisa diketik: amount_idr kolom GENERATED di
 *    database. Layar hanya menampilkan hasil perkalian yang sama dengan yang
 *    dipakai PDF dan Excel nanti.
 */
export function ItemGrid({ planId, items, categories, uoms, canEdit, afterApproval }: Props) {
  const [state, action, pending] = useActionState(gridAction, initial);

  // Setelah RAB disetujui, baris yang ikut disetujui BEKU untuk semua peran —
  // "persetujuan atas angka yang kemudian berubah sendiri bukan persetujuan"
  // (kepala migrasi 0062). Yang tersisa lentur hanya baris yang memang
  // ditambahkan finance sesudahnya. Ini cerminan policy bpi_edit_update; kalau
  // keduanya berbeda, yang menang tetap database.
  const barisBisaDisunting = (it: BudgetPlanItemRow) =>
    canEdit && (!afterApproval || it.addedAfterApproval);
  const adaYangBisaDisunting = items.some(barisBisaDisunting);
  // Baris kosong hanya ditawarkan kalau menambah memang akan berhasil. Pada RAB
  // yang sudah disetujui, menambah baris TETAP boleh (kesepakatan rapat 26 Agu:
  // finance boleh menyisipkan pos susulan) -- yang beku adalah baris lamanya.
  const barisBaruTampil = canEdit;

  return (
    <form action={action} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <input type="hidden" name="planId" value={planId} />

      {state.message && (
        <p
          className={cn(
            "flex items-start gap-2 border-b px-4 py-2.5 text-sm",
            state.ok
              ? "border-emerald-100 bg-emerald-50 text-emerald-800"
              : "border-rose-100 bg-rose-50 text-rose-800",
          )}
          role="status"
        >
          {state.ok ? (
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {state.message}
        </p>
      )}

      <ResponsiveTable>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Tahap</th>
              <th className="px-4 py-2.5 font-medium">Bulan</th>
              <th className="px-4 py-2.5 font-medium">Kategori</th>
              <th className="px-4 py-2.5 font-medium">Uraian</th>
              <th className="px-4 py-2.5 font-medium">Jenis</th>
              <th className="px-4 py-2.5 text-right font-medium">Volume</th>
              <th className="px-4 py-2.5 text-right font-medium">Harga satuan</th>
              <th className="px-4 py-2.5 text-right font-medium">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const bisa = barisBisaDisunting(it);
              const turunan = it.basisCode !== null;
              return (
                <tr
                  key={it.id}
                  className={cn(
                    "border-b border-slate-50 align-top last:border-0",
                    // Baris dicoret tetap TERLIHAT — itu inti kolom `Aktif` di
                    // 17_Model_Fleksibel: dikeluarkan dari total, bukan dari
                    // ingatan.
                    !it.isActive && "text-slate-400 line-through decoration-slate-300",
                  )}
                >
                  {/* Tahap dan penanda CAPEX/OPEX dipisah jadi dua sel logis
                      dalam satu <td>: penandanya TIDAK boleh ikut hilang saat
                      tahap kosong, karena di mode kartu (<768px) sel kosong
                      disembunyikan CSS dan CAPEX/OPEX adalah alasan utama
                      migrasi 0061 ada. */}
                  <td data-label="Tahap" className="px-4 py-2.5 text-xs text-slate-500">
                    {it.stage ?? EMPTY}
                    <span className="mt-0.5 block font-medium uppercase tracking-wide text-slate-400">
                      {it.costKind}
                    </span>
                  </td>

                  <td data-label="Bulan" className="px-4 py-2.5 tabular-nums text-slate-500">
                    {bisa ? (
                      <input
                        type="number"
                        name={`bulan_${it.id}`}
                        defaultValue={it.phaseMonth}
                        min={1}
                        step={1}
                        aria-label={`Bulan fase untuk ${it.description}`}
                        className={cn(SEL, "w-20 text-right tabular-nums")}
                      />
                    ) : (
                      <>ke-{it.phaseMonth}</>
                    )}
                  </td>

                  <td
                    data-label="Kategori"
                    data-empty={!it.categoryName}
                    className="px-4 py-2.5 text-slate-600"
                  >
                    {it.categoryName ?? EMPTY}
                  </td>

                  <td data-label="Uraian" className="px-4 py-2.5 text-slate-700">
                    {bisa ? (
                      <input
                        name={`uraian_${it.id}`}
                        defaultValue={it.description}
                        required
                        maxLength={300}
                        aria-label="Uraian komponen"
                        className={cn(SEL, "font-medium")}
                      />
                    ) : (
                      it.description
                    )}
                    {it.addedAfterApproval && (
                      <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700">
                        tambahan finance
                      </span>
                    )}
                    {it.note && <span className="block text-xs text-slate-400">{it.note}</span>}
                    {/* Dari mana angkanya. Kosong ditampilkan apa adanya — angka
                        anggaran tanpa asal-usul adalah angka fabrikasi yang
                        kebetulan rapi. */}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {it.confidence ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            CONFIDENCE[it.confidence].cls,
                          )}
                        >
                          {CONFIDENCE[it.confidence].label}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          keyakinan belum dinilai
                        </span>
                      )}
                      {it.source && <SourceLink source={it.source} className="text-xs" />}
                      <span className="text-xs text-slate-400">
                        {it.sourceRef
                          ? `sumber: ${it.sourceRef}`
                          : it.source === null
                            ? "sumber belum disebutkan"
                            : ""}
                        {it.driver ? ` · penggerak: ${it.driver}` : ""}
                        {it.excludeFromContingency ? " · di luar kontingensi" : ""}
                        {!it.isActive ? " · DICORET" : ""}
                      </span>
                    </span>
                  </td>

                  <td data-label="Jenis" className="px-4 py-2.5 text-slate-500">
                    {KIND_LABEL[it.itemKind] ?? it.itemKind}
                  </td>

                  <td data-label="Volume" className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {bisa && !turunan ? (
                      <input
                        type="number"
                        name={`volume_${it.id}`}
                        defaultValue={it.volume ?? undefined}
                        min={0}
                        step="0.0001"
                        aria-label={`Volume untuk ${it.description}`}
                        className={cn(SEL, "text-right tabular-nums")}
                      />
                    ) : (
                      formatNumber(it.volume)
                    )}
                    <span className="block text-xs text-slate-400">{it.uomName ?? ""}</span>
                    {turunan && (
                      <span className="block text-xs font-normal text-slate-400">
                        = {it.basisCode} × {formatNumber(it.ratioPerBasis)}
                        <span className="block">diturunkan, tidak diketik</span>
                      </span>
                    )}
                  </td>

                  <td data-label="Harga satuan" className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {bisa ? (
                      <input
                        type="number"
                        name={`harga_${it.id}`}
                        defaultValue={it.unitPriceIdr ?? undefined}
                        min={0}
                        step="0.01"
                        aria-label={`Harga satuan untuk ${it.description}`}
                        className={cn(SEL, "text-right tabular-nums")}
                      />
                    ) : (
                      formatIdr(it.unitPriceIdr)
                    )}
                  </td>

                  <td data-label="Jumlah" className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800">
                    {formatIdr(it.amountIdr)}
                    {bisa && (
                      <span className="mt-1 flex justify-end gap-1">
                        {/* Mencoret ≠ menghapus. Yang dicoret keluar dari total
                            tapi tetap terbaca — jejak bahwa pos itu pernah
                            dipertimbangkan. Menghapus dipakai untuk baris yang
                            memang salah masuk. */}
                        <button
                          type="submit"
                          name="_aksi"
                          value={`${it.isActive ? "coret" : "hidup"}:${it.id}`}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                          title={it.isActive ? "Coret dari total (baris tetap terlihat)" : "Hidupkan kembali"}
                        >
                          {it.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          <span className="sr-only">
                            {it.isActive ? `Coret ${it.description} dari total` : `Hidupkan ${it.description}`}
                          </span>
                        </button>
                        <button
                          type="submit"
                          name="_aksi"
                          value={`hapus:${it.id}`}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                          title="Hapus baris ini"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Hapus {it.description}</span>
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Baris kosong di ujung -- inti "seperti Excel": tidak perlu
                membuka form lain untuk menambah satu pos. Yang dibawa hanya
                kolom yang terlihat; tahap, penggerak, sumber, keyakinan, dan
                basis asumsi tetap lewat form lengkap di bawah tabel, karena
                memampatkan semuanya ke satu baris justru membuat orang
                melewatinya. */}
            {barisBaruTampil && (
              <tr className="border-t border-slate-100 bg-emerald-50/20 align-top">
                <td data-label="CAPEX / OPEX" className="px-4 py-2.5">
                  <select name="baru_kind" defaultValue="capex" aria-label="CAPEX atau OPEX"
                    className={cn(SEL, "text-xs uppercase")}>
                    <option value="capex">capex</option>
                    <option value="opex">opex</option>
                  </select>
                </td>
                <td data-label="Bulan" className="px-4 py-2.5">
                  <input type="number" name="baru_bulan" defaultValue={1} min={1} step={1}
                    aria-label="Bulan fase baris baru"
                    className={cn(SEL, "w-20 text-right tabular-nums")} />
                </td>
                <td data-label="Kategori" className="px-4 py-2.5">
                  <select name="baru_kategori" defaultValue="" aria-label="Kategori biaya baris baru"
                    className={cn(SEL, "text-slate-600")}>
                    <option value="">— pilih kategori —</option>
                    {categories.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </td>
                <td data-label="Uraian" className="px-4 py-2.5">
                  <input name="baru_uraian" placeholder="mis. Bibit durian — 70 batang/ha"
                    maxLength={300} aria-label="Uraian baris baru" className={cn(SEL, "font-medium")} />
                </td>
                <td data-label="Jenis" className="px-4 py-2.5">
                  <select name="baru_jenis" defaultValue="consumable" aria-label="Jenis baris baru"
                    className={cn(SEL, "text-slate-600")}>
                    <option value="consumable">Habis pakai</option>
                    <option value="asset">Aset</option>
                    <option value="labor">Tenaga kerja</option>
                    <option value="service">Jasa</option>
                  </select>
                </td>
                <td data-label="Volume" className="px-4 py-2.5">
                  <input type="number" name="baru_volume" min={0} step="0.0001" placeholder="0"
                    aria-label="Volume baris baru" className={cn(SEL, "text-right tabular-nums")} />
                  <select name="baru_satuan" defaultValue="" aria-label="Satuan baris baru"
                    className={cn(SEL, "mt-1 text-xs text-slate-500")}>
                    <option value="">— satuan —</option>
                    {uoms.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </td>
                <td data-label="Harga satuan" className="px-4 py-2.5">
                  <input type="number" name="baru_harga" min={0} step="0.01" placeholder="0"
                    aria-label="Harga satuan baris baru" className={cn(SEL, "text-right tabular-nums")} />
                </td>
                <td data-label="Jumlah" className="px-4 py-2.5 text-right">
                  {/* Jumlahnya belum ada dan tidak ditebak: ia lahir di database
                      sebagai kolom GENERATED begitu barisnya tersimpan. */}
                  <span className="block text-xs text-slate-400">{EMPTY}</span>
                  <button type="submit" name="_aksi" value="tambah"
                    className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-emerald-700 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
                    <Plus className="h-4 w-4" /> Tambah
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>

      {adaYangBisaDisunting && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <p className="text-xs text-slate-500">
            Ketik langsung di selnya, lalu simpan. Jumlah rupiah dihitung database, bukan diketik.
            {afterApproval && " RAB ini sudah disetujui — hanya baris tambahan finance yang bisa diubah."}
          </p>
          <button
            type="submit"
            name="_aksi"
            value="simpan"
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan perubahan
          </button>
        </div>
      )}
    </form>
  );
}
