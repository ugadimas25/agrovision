"use client";

import { useActionState } from "react";
import { Loader2, Pencil, Save, CircleCheck, Paperclip, Upload, FileText } from "lucide-react";
import { setOrganicStatusAction, attachOrganicEvidenceAction, type OrganicState } from "@/lib/actions/organic";
import type { OrganicItem } from "@/lib/repo/sustainability";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { cn } from "@/lib/utils";

export const ORGANIC_STATUS: Record<string, { label: string; cls: string }> = {
  belum_mulai:    { label: "Belum mulai",   cls: "bg-slate-100 text-slate-500" },
  dalam_proses:   { label: "Dalam proses",  cls: "bg-sky-50 text-sky-700" },
  in_conversion:  { label: "Masa konversi", cls: "bg-amber-50 text-amber-700" },
  tersertifikasi: { label: "Tersertifikasi", cls: "bg-emerald-50 text-emerald-700" },
  tidak_relevan:  { label: "Tidak relevan", cls: "bg-slate-50 text-slate-500" },
};
const STATUS_ORDER = ["belum_mulai", "dalam_proses", "in_conversion", "tersertifikasi", "tidak_relevan"];
const initial: OrganicState = { ok: false, message: "" };

export function OrganicTracker({
  items, variant, canEdit,
}: {
  items: OrganicItem[];
  variant: "standard" | "evidence";
  canEdit: boolean;
}) {
  return (
    <ResponsiveTable>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">{variant === "standard" ? "Standar" : "Bukti"}</th>
            <th className="px-3 py-2 font-medium">{variant === "standard" ? "Pasar / penerbit" : "Catatan"}</th>
            <th className="px-3 py-2 font-medium">Status</th>
            {canEdit && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => <Row key={item.code} item={item} variant={variant} canEdit={canEdit} />)}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}

/**
 * Editor per baris dibuka dengan <details> native, BUKAN toggle useState.
 *
 * Dengan useState, formnya tidak ada di HTML server sampai tombolnya diklik —
 * jadi tanpa JavaScript tidak ada cara mengubah status maupun melampirkan bukti,
 * dan uji berbasis HTTP tidak bisa menemukan formnya sama sekali. Pola <details>
 * ini sama dengan form lain di aplikasi ini (mis. PriceRowForm, PriceMetaEditor).
 */
function Row({ item, variant, canEdit }: { item: OrganicItem; variant: "standard" | "evidence"; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setOrganicStatusAction, initial);
  const [upState, upAction, upPending] = useActionState(attachOrganicEvidenceAction, initial);
  const meta = ORGANIC_STATUS[item.status] ?? ORGANIC_STATUS.belum_mulai;
  // AI-21: status "Tersertifikasi" tanpa satu dokumen pun adalah klaim kepatuhan
  // tanpa bukti — dan hitungan "n/7 lengkap" memakainya untuk mengklaim
  // pengakuan retroaktif 36 bulan. Ditandai di barisnya, bukan hanya dihitung
  // ulang di belakang.
  const klaimTanpaBukti = variant === "evidence" && item.status === "tersertifikasi" && item.files.length === 0;

  return (
    <>
      <tr className="border-b border-slate-50 last:border-0 align-top">
        <td data-label={variant === "standard" ? "Standar" : "Bukti"} className="px-4 py-2">
          <div className="flex items-start gap-1.5">
            <span className="font-mono text-xs text-slate-500">{item.code}</span>
          </div>
          <div className="text-slate-700">{item.name}</div>
          {variant === "standard" && item.detail && (
            <div className="mt-0.5 text-[11px] text-slate-500">{item.detail}</div>
          )}
        </td>
        <td data-label={variant === "standard" ? "Pasar / penerbit" : "Catatan"} className="px-3 py-2 text-xs text-slate-500">
          {variant === "standard" ? (
            <>
              {item.market && <div className="font-medium text-slate-600">{item.market}</div>}
              {item.issuer && <div>{item.issuer}</div>}
            </>
          ) : (
            item.detail ?? "—"
          )}
        </td>
        <td data-label="Status" className="px-3 py-2">
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", meta.cls)}>{meta.label}</span>
          {item.referenceNo && <div className="mt-0.5 font-mono text-[11px] text-slate-500">{item.referenceNo}</div>}
          {item.expiresOn && <div className="mt-0.5 text-[11px] text-slate-500">exp. {item.expiresOn}</div>}
          {variant === "evidence" && (
            <div className="mt-1 space-y-0.5" data-testid="bukti-terlampir">
              {item.files.length === 0 ? (
                <span className={cn("text-[11px]", klaimTanpaBukti ? "font-medium text-red-600" : "text-slate-400")}>
                  {klaimTanpaBukti ? "ditandai lengkap tanpa dokumen" : "belum ada dokumen"}
                </span>
              ) : item.files.map((f) => (
                <a key={f.id} href={`/api/evidence/${f.id}`} target="_blank" rel="noreferrer"
                   data-testid="tautan-bukti"
                   className="flex items-center gap-1 text-[11px] text-emerald-700 hover:underline">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{f.fileName}</span>
                </a>
              ))}
            </div>
          )}
        </td>
        {canEdit && (
          <td data-action className="px-3 py-2 text-right">
            {variant === "evidence" && item.files.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                <Paperclip className="h-3 w-3" />{item.files.length}
              </span>
            )}
          </td>
        )}
      </tr>
      {canEdit && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={4} className="px-4 py-3">
            <details>
              <summary className="mb-2 inline-flex cursor-pointer list-none items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                <Pencil className="h-3 w-3" /> Ubah{variant === "evidence" ? " / lampirkan bukti" : ""}
              </summary>
            <form action={action} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="itemCode" value={item.code} />
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Status
                <select name="status" defaultValue={item.status} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700">
                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{ORGANIC_STATUS[s].label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                No. referensi / sertifikat
                <input name="referenceNo" defaultValue={item.referenceNo ?? ""} className="w-48 rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Terbit
                <input type="date" name="obtainedOn" defaultValue={item.obtainedOn ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Berakhir
                <input type="date" name="expiresOn" defaultValue={item.expiresOn ?? ""} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700" />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
                Catatan
                <input name="note" defaultValue={item.note ?? ""} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700" />
              </label>
              <button type="submit" disabled={pending} className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                Simpan
              </button>
              {state.message && <span className={cn("text-xs", state.ok ? "text-emerald-700" : "text-red-600")}>{state.message}</span>}
            </form>

            {variant === "evidence" && (
              // Form TERPISAH, bukan field tambahan di form status: unggah berkas
              // memakai multipart dan gagal karena batas ukuran, sementara
              // menyimpan status tidak — menyatukannya membuat kegagalan unggah
              // ikut membatalkan perubahan status yang sudah benar.
              <form action={upAction} encType="multipart/form-data" className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
                <input type="hidden" name="itemCode" value={item.code} />
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Lampirkan dokumen bukti
                  <input type="file" name="berkas" data-testid="unggah-bukti-organik"
                         accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                         className="w-64 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700" />
                </label>
                <button type="submit" disabled={upPending}
                        className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                  {upPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Unggah
                </button>
                {upState.message && <span className={cn("text-xs", upState.ok ? "text-emerald-700" : "text-red-600")}>{upState.message}</span>}
                <p className="w-full text-[11px] leading-relaxed text-slate-500">
                  JPG, PNG, WebP, HEIC, atau PDF. Berkas disimpan bersama sha256-nya, jadi bisa
                  dibuktikan tidak berubah sejak diunggah.
                </p>
              </form>
            )}
            </details>
          </td>
        </tr>
      )}
    </>
  );
}
