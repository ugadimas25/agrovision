"use client";

import { useActionState } from "react";
import { Loader2, CircleAlert, CircleCheck, UserPlus, CalendarDays } from "lucide-react";
import {
  buatPenugasanAction, setTanggalMulaiAction, type PlanState,
} from "@/lib/actions/budgetPlan";
import { formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

const awal: PlanState = { ok: false, message: "" };
type Option = { value: string; label: string };

const STATUS_LABEL: Record<string, { teks: string; cls: string }> = {
  assigned: { teks: "ditugaskan", cls: "bg-sky-50 text-sky-700" },
  done: { teks: "selesai", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { teks: "dibatalkan", cls: "bg-slate-100 text-slate-500" },
};

export type Penugasan = {
  id: string; itemDescription: string; assigneeName: string;
  volume: number; uomName: string | null; targetDate: string | null;
  status: string; note: string | null;
};

/**
 * Penugasan: membagi baris RAB yang SUDAH DISETUJUI kepada orang yang akan
 * membelanjakannya.
 *
 * Hanya muncul setelah RAB disetujui, dan itu bukan pilihan tampilan melainkan
 * cerminan aturan database (trigger 0066): menugaskan dari RAB draft berarti
 * menyuruh orang membelanjakan angka yang belum disetujui siapa pun.
 *
 * Penerima tugas dibatasi peran yang boleh mencatat realisasi. Menugasi viewer
 * atau agronomis akan membuat tugas yang tidak mungkin ditutup — 0059 melarang
 * mereka menulis pengeluaran — sementara jatah volume baris RAB-nya tertahan.
 */
export function PenugasanPanel({
  planId, items, penerima, uoms, daftar, canAssign, startDate, canSetStartDate,
}: {
  planId: string;
  items: { id: string; description: string; volume: number | null; uomName: string | null }[];
  penerima: Option[];
  uoms: Option[];
  daftar: Penugasan[];
  canAssign: boolean;
  startDate: string | null;
  canSetStartDate: boolean;
}) {
  const [buat, aksiBuat, sedangBuat] = useActionState(buatPenugasanAction, awal);
  const [tgl, aksiTgl, sedangTgl] = useActionState(setTanggalMulaiAction, awal);

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <UserPlus className="h-4 w-4 text-emerald-700" /> Penugasan lapangan
          <span className="font-normal text-slate-400">— siapa membelanjakan baris yang mana</span>
        </h2>
      </div>

      {/* Tanggal mulai: titik nol sumbu waktu kurva S. Ditaruh di sini, bukan di
          form RAB, karena baru relevan setelah RAB disetujui dan pekerjaannya
          benar-benar dijadwalkan. */}
      {canSetStartDate && (
        <form action={aksiTgl} className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <input type="hidden" name="planId" value={planId} />
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" /> Tanggal mulai proyek
            </span>
            <input type="date" name="startDate" defaultValue={startDate ?? ""}
              className="min-h-11 rounded-md border border-slate-200 px-2 text-sm" />
          </label>
          <button type="submit" disabled={sedangTgl}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-60">
            {sedangTgl && <Loader2 className="h-4 w-4 animate-spin" />} Simpan tanggal
          </button>
          <p className="text-xs text-slate-400">
            Bulan ke-1 di RAB dihitung dari tanggal ini. Tanpa tanggal mulai, kurva S tidak digambar.
          </p>
        </form>
      )}
      {tgl.message && (
        <p className={cn("border-b px-4 py-2 text-sm", tgl.ok
          ? "border-emerald-100 bg-emerald-50 text-emerald-800"
          : "border-rose-100 bg-rose-50 text-rose-800")}>{tgl.message}</p>
      )}

      {daftar.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          Belum ada penugasan. Selama kosong, tidak ada yang berwenang membelanjakan RAB ini —
          dan serapannya akan tetap {EMPTY}.
        </p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {daftar.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-medium text-slate-700">{d.assigneeName}</span>
              <span className="text-slate-500">{d.itemDescription}</span>
              <span className="tabular-nums text-slate-600">
                {formatNumber(d.volume)} {d.uomName ?? ""}
              </span>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                STATUS_LABEL[d.status]?.cls ?? "bg-slate-100 text-slate-500")}>
                {STATUS_LABEL[d.status]?.teks ?? d.status}
              </span>
              <span className="text-xs text-slate-400">
                {d.targetDate ? `target ${d.targetDate}` : `target ${EMPTY}`}
                {d.note ? ` · ${d.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canAssign && (
        <form action={aksiBuat} className="border-t border-slate-100 px-4 py-3">
          <input type="hidden" name="planId" value={planId} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-500">Baris RAB</span>
              <select name="planItemId" required defaultValue=""
                className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm">
                <option value="">— pilih komponen —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.description} ({formatNumber(i.volume)} {i.uomName ?? ""})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Ditugaskan kepada</span>
              <select name="assigneeUserId" required defaultValue=""
                className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm">
                <option value="">— pilih orang —</option>
                {penerima.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Volume tugas</span>
              <input name="volume" type="number" step="0.0001" min="0" required
                className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Satuan</span>
              <select name="uomItemId" defaultValue=""
                className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm">
                <option value="">— tidak dipilih —</option>
                {uoms.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Target selesai</span>
              <input name="targetDate" type="date"
                className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm" />
            </label>
            <label className="block sm:col-span-2 lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-500">Catatan</span>
              <input name="note" maxLength={500} placeholder="mis. ambil di gudang blok A, sebelum tanam"
                className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm" />
            </label>
          </div>

          {buat.message && (
            <p className={cn("mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm",
              buat.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")}>
              {buat.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
              {buat.message}
            </p>
          )}

          <button type="submit" disabled={sedangBuat}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60">
            {sedangBuat ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Tugaskan
          </button>
          <p className="mt-1.5 text-xs text-slate-400">
            Total volume yang ditugaskan tidak boleh melebihi volume baris RAB-nya — database menolak
            dengan menyebut angkanya.
          </p>
        </form>
      )}
    </div>
  );
}
