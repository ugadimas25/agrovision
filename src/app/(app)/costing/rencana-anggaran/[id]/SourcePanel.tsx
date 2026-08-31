"use client";

import { useActionState } from "react";
import { Loader2, Plus, CircleAlert, CircleCheck, ExternalLink, Library } from "lucide-react";
import { addSourceAction, type PlanState } from "@/lib/actions/budgetPlan";
import { formatDate, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

export type { SourceRef } from "./SourceLink";

const initial: PlanState = { ok: false, message: "" };

export type Source = {
  id: string;
  code: string;
  topic: string | null;
  title: string;
  url: string | null;
  publishedOn: string | null;
  accessedOn: string | null;
  confidence: "high" | "medium" | "low" | null;
  note: string | null;
  citedBy: number;
};

const CONF: Record<string, { label: string; cls: string }> = {
  high: { label: "tinggi", cls: "bg-emerald-50 text-emerald-700" },
  medium: { label: "sedang", cls: "bg-amber-50 text-amber-700" },
  low: { label: "rendah", cls: "bg-red-50 text-red-700" },
};

/**
 * Registri sumber satu entitas — padanan 16_Sources di model Banyumas.
 *
 * Judul dirender sebagai TAUTAN hanya bila sumbernya benar-benar punya URL, dan
 * sebagai teks biasa bila tidak. Bedanya bukan kosmetik: tautan yang tidak
 * menuju ke mana pun mengaku bisa diperiksa, dan itu lebih menyesatkan daripada
 * sumber yang jujur mengaku tidak punya tautan (keputusan rapat, penawaran di
 * atas kertas). Barisnya lalu menyebut "tanpa tautan" apa adanya.
 *
 * Panel ini tertutup secara bawaan: registri melayani seluruh RAB entitas dan
 * bisa panjang, sementara layar ini tentang SATU RAB.
 */
export function SourcePanel({ sources, canEdit }: { sources: Source[]; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(addSourceAction, initial);
  const err = (k: string) => state.fieldErrors?.[k];
  const cls = (k: string) =>
    cn("min-h-11 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30",
       err(k) ? "border-red-300" : "border-slate-200");

  return (
    <details className="rounded-xl border border-slate-200 bg-white" open={state.message !== "" && !state.ok}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <Library className="h-4 w-4 shrink-0 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">Registri sumber</h2>
        <span className="text-xs text-slate-400">
          {sources.length === 0
            ? "belum ada sumber yang bisa diperiksa ulang"
            : `${sources.length} kutipan — dipakai bersama seluruh RAB entitas ini`}
        </span>
      </summary>

      {sources.length === 0 ? (
        <p className="border-t border-slate-100 px-4 py-4 text-sm leading-relaxed text-slate-500">
          Belum ada sumber. Selama kosong, dasar tiap angka hanya bisa ditulis sebagai kalimat
          bebas — dan kalimat tidak bisa dibuka ulang oleh orang berikutnya yang memeriksa RAB ini.
        </p>
      ) : (
        <ul className="divide-y divide-slate-50 border-t border-slate-100">
          {sources.map((s) => (
            <li key={s.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-xs text-slate-500">{s.code}</span>
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-baseline gap-1 text-sm font-medium text-emerald-700 underline decoration-emerald-200 underline-offset-2 hover:decoration-emerald-500"
                  >
                    {s.title}
                    <ExternalLink className="h-3 w-3 shrink-0 self-center" aria-hidden />
                  </a>
                ) : (
                  <span className="text-sm font-medium text-slate-700">{s.title}</span>
                )}
                {s.topic && <span className="text-xs text-slate-400">· {s.topic}</span>}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  s.confidence ? CONF[s.confidence].cls : "bg-slate-100 text-slate-500")}>
                  keyakinan {s.confidence ? CONF[s.confidence].label : "belum dinilai"}
                </span>
                {/* Tanggal kosong dirender em-dash lewat formatDate — banyak
                    sumber hanya menyebut tahun, dan tahun bukan tanggal. */}
                <span className="text-xs text-slate-400">
                  terbit {formatDate(s.publishedOn)} · diakses {formatDate(s.accessedOn)}
                  {s.url ? "" : ` · tautan ${EMPTY}`}
                  {s.citedBy > 0 ? ` · dikutip ${s.citedBy} baris` : " · belum dikutip"}
                </span>
              </div>

              {s.note && <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.note}</p>}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <details className="border-t border-slate-100">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
            <Plus className="h-4 w-4 text-emerald-700" /> Daftarkan sumber
          </summary>
          <form action={formAction} className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Kode</span>
              <input name="code" required maxLength={30} placeholder="S07" className={cn(cls("code"), "font-mono")} />
              <span className="mt-1 block text-xs text-slate-400">dipakai saat berdiskusi, mis. S07</span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Topik</span>
              <input name="topic" maxLength={120} placeholder="Upah tenaga kerja" className={cls("topic")} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Tingkat keyakinan</span>
              <select name="confidence" defaultValue="" className={cls("confidence")}>
                <option value="">— belum dinilai —</option>
                <option value="high">Tinggi — sumber resmi/kontrak</option>
                <option value="medium">Sedang — tolok ukur pasar</option>
                <option value="low">Rendah — daftar harga ritel</option>
              </select>
            </label>

            <label className="block lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-500">Judul sumber</span>
              <input name="title" required maxLength={300}
                placeholder="Keputusan Gubernur Jawa Tengah 100.3.3.1/505/2025" className={cls("title")} />
            </label>

            <label className="block lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-500">Tautan</span>
              <input name="url" type="url" maxLength={1000} placeholder="https://…" className={cls("url")} />
              <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                Kosongkan bila sumbernya memang tidak punya tautan — keputusan rapat, wawancara,
                penawaran di atas kertas. Jangan diisi kalimat: tautan yang tidak menuju ke mana pun
                mengaku bisa diperiksa.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Tanggal terbit</span>
              <input name="publishedOn" type="date" className={cls("publishedOn")} />
              <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                Kosongkan bila sumbernya hanya menyebut tahun. Tanggal yang ditebak lebih buruk
                daripada tanggal yang kosong.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Tanggal akses</span>
              <input name="accessedOn" type="date" className={cls("accessedOn")} />
              <span className="mt-1 block text-xs text-slate-400">kapan tautannya terakhir dibuka</span>
            </label>

            <label className="block lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-slate-500">Catatan (opsional)</span>
              <input name="note" maxLength={1000}
                placeholder="Bagian mana yang dipakai, dan apa yang masih perlu dikonfirmasi" className={cls("note")} />
            </label>

            <div className="lg:col-span-3">
              <button type="submit" disabled={pending}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Daftarkan
              </button>
            </div>
          </form>
        </details>
      )}

      {state.message && (
        <p role="status" className={cn("flex items-start gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs leading-relaxed",
          state.ok ? "text-emerald-700" : "text-red-600")}>
          {state.ok ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {state.message}
        </p>
      )}
    </details>
  );
}

/**
 * Pemilih sumber yang dipakai ItemForm dan AssumptionPanel.
 *
 * Dijadikan satu komponen supaya daftar pilihannya, teks kosongnya, dan
 * peringatan "registri masih kosong" tidak menyimpang antara dua formulir.
 */
export function SourceSelect({
  sources, name = "sourceId", defaultValue = "", className, label = "Sumber di registri",
  ringkas = false,
}: {
  sources: Source[];
  name?: string;
  defaultValue?: string;
  className?: string;
  label?: string;
  /** Di dalam sel tabel: tanpa label dan tanpa keterangan, supaya satu baris
   *  tabel tidak setinggi tiga baris. Keterangannya dipindah ke kaki tabel —
   *  sekali, bukan diulang di setiap baris. */
  ringkas?: boolean;
}) {
  return (
    <label className="block">
      {!ringkas && <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>}
      <select name={name} defaultValue={defaultValue} disabled={sources.length === 0}
        className={className ?? "min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"}>
        <option value="">— tanpa sumber di registri —</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.title}{s.url ? "" : " (tanpa tautan)"}
          </option>
        ))}
      </select>
      {!ringkas && (
        <span className="mt-1 block text-xs leading-relaxed text-slate-400">
          {sources.length === 0
            ? "Registri masih kosong — daftarkan sumbernya lebih dulu di panel Registri sumber."
            : "Boleh dikosongkan. Kolom dasar/sumber di sebelah tetap menampung keterangan yang tidak punya tautan."}
        </span>
      )}
    </label>
  );
}
