"use client";

/**
 * Jadwal penyiangan per blok (migrasi 0051).
 *
 * Sebelum ini kolom "Jadwal vs Realisasi" di laporan Penyiangan berisi literal
 * "Tepat waktu" untuk setiap baris — menyatakan kepatuhan jadwal padahal tidak ada
 * jadwal yang tersimpan. Form ini yang membuat kolom itu punya dasar.
 *
 * Gerbangnya approver/super_admin: menentukan kadensi penyiangan adalah keputusan
 * operasi, bukan pencatatan lapangan. Creator mencatat pekerjaannya, tidak
 * menetapkan targetnya sendiri.
 *
 * <details> native supaya seluruh field ada di HTML server dan tetap bisa
 * disubmit tanpa JavaScript.
 */

import { useActionState } from "react";
import { CalendarClock, Loader2, Save, CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import { setWeedingScheduleAction } from "@/lib/actions/operational";
import type { ActionState } from "@/lib/actions/costing";
import { cn } from "@/lib/utils";

const initial: ActionState = { ok: false, message: "" };

type Opt = { value: string; label: string };
type Jadwal = { blockCode: string; intervalDay: number; toleranceDay: number };

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-600">{msg}</p>;
}

export function ScheduleForm({ blocks, schedules }: { blocks: Opt[]; schedules: Jadwal[] }) {
  const [state, formAction, saving] = useActionState(setWeedingScheduleAction, initial);
  const inputCls =
    "w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30";
  const err = (k: string) => state.fieldErrors?.[k];
  const cls = (k: string) => cn(inputCls, err(k) ? "border-red-300" : "border-slate-200");

  return (
    <details className="group mb-4 rounded-xl border border-slate-200 bg-white" open={state.message !== "" && !state.ok}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <CalendarClock className="h-4 w-4 text-emerald-600" />
          Jadwal penyiangan per blok
          <span className="rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">{schedules.length}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>

      <form action={formAction} data-testid="jadwal-penyiangan" className="space-y-3 border-t border-slate-100 p-4">
        <p className="text-xs leading-relaxed text-slate-500">
          Interval siklus penyiangan, bukan tanggal janji. Kolom <strong>Jadwal vs Realisasi</strong> di
          laporan membandingkan jarak ke penyiangan sebelumnya pada blok yang sama terhadap interval ini.
          Blok tanpa jadwal dirender em-dash — belum dijadwalkan bukan berarti tepat waktu.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Blok</span>
            <select name="blockId" required className={cls("blockId")}>
              <option value="">— pilih —</option>
              {blocks.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <FieldError msg={err("blockId")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Interval (hari)</span>
            <input name="intervalDay" type="number" min="1" max="365" required defaultValue={30} className={cn(cls("intervalDay"), "tabular-nums")} />
            <FieldError msg={err("intervalDay")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Toleransi (hari)</span>
            <input name="toleranceDay" type="number" min="0" max="90" defaultValue={7} className={cn(cls("toleranceDay"), "tabular-nums")} />
            <FieldError msg={err("toleranceDay")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Catatan</span>
            <input name="note" maxLength={500} className={cls("note")} />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          Setel jadwal
        </button>

        {state.message && (
          <p role="status" className={cn("flex items-start gap-1 text-xs leading-snug", state.ok ? "text-emerald-700" : "text-red-600")}>
            {!state.ok && <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
            {state.message}
          </p>
        )}

        {schedules.length > 0 && (
          <ul className="border-t border-slate-100 pt-2 text-xs text-slate-500">
            {schedules.map((s) => (
              <li key={s.blockCode}>
                <span className="font-mono text-slate-600">{s.blockCode}</span> — tiap {s.intervalDay} hari,
                toleransi {s.toleranceDay} hari
              </li>
            ))}
          </ul>
        )}
      </form>
    </details>
  );
}
