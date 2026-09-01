"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { CalendarOff, TrendingUp } from "lucide-react";
import { formatIdr, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TitikKurva = {
  bulanKe: number;
  /** Kumulatif anggaran s/d bulan ini — selalu ada, berasal dari RAB. */
  rencanaKumulatif: number;
  /** Kumulatif realisasi. NULL untuk bulan yang BELUM punya catatan sama sekali. */
  realisasiKumulatif: number | null;
};

/**
 * Kurva S serapan anggaran: rencana kumulatif vs realisasi kumulatif.
 *
 * Tiga keputusan yang membuat grafik ini boleh dipercaya:
 *
 * 1. **Tanpa `start_date` RAB, grafiknya TIDAK digambar.** `phase_month` bersifat
 *    relatif ("bulan ke-1 = bulan pertama proyek") sedangkan realisasi bertanggal
 *    sungguhan. Tanpa titik nol yang sama keduanya tidak berada pada sumbu yang
 *    sama, dan menebak titik nol — misalnya dari realisasi pertama — menghasilkan
 *    kurva yang meyakinkan tapi tidak pernah ditetapkan siapa pun.
 *
 * 2. **Garis realisasi berhenti di bulan terakhir yang punya catatan.** Bulan
 *    sesudahnya `null`, bukan diteruskan mendatar. Garis mendatar berarti "sudah
 *    dipastikan tidak ada belanja"; yang benar adalah "belum ada catatannya".
 *    `connectNulls={false}` menjaga perbedaan itu tetap terlihat.
 *
 * 3. **Serapan melebihi anggaran tidak dijepit.** Kalau garis realisasi naik di
 *    atas garis rencana, itu memang yang terjadi dan harus terlihat.
 */
export function KurvaS({
  titik, startDate, anggaran, realisasi,
}: {
  titik: TitikKurva[];
  startDate: string | null;
  anggaran: number | null;
  realisasi: number | null;
}) {
  if (!startDate) {
    return (
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <TrendingUp className="h-4 w-4 text-slate-400" /> Kurva S serapan anggaran
        </h2>
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Belum bisa digambar: <b>tanggal mulai RAB belum ditetapkan</b>. Bulan fase di RAB
            bersifat relatif (bulan ke-1, ke-2, …) sementara realisasi bertanggal sungguhan —
            tanpa tanggal mulai, keduanya tidak berada di sumbu waktu yang sama. Isi tanggal
            mulai pada RAB ini, lalu kurvanya muncul.
          </span>
        </div>
      </div>
    );
  }

  const adaRealisasi = titik.some((t) => t.realisasiKumulatif !== null);
  const persen = anggaran && anggaran > 0 && realisasi !== null
    ? (realisasi / anggaran) * 100 : null;
  const sisa = anggaran !== null && realisasi !== null ? anggaran - realisasi : null;

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <TrendingUp className="h-4 w-4 text-emerald-700" /> Kurva S serapan anggaran
        </h2>
        <span className="text-xs text-slate-400">mulai {startDate}</span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
        {[
          { l: "Anggaran", v: anggaran === null ? EMPTY : formatIdr(anggaran), c: "text-slate-800" },
          { l: "Terserap", v: realisasi === null ? EMPTY : formatIdr(realisasi), c: "text-emerald-700" },
          {
            l: "Sisa",
            v: sisa === null ? EMPTY : formatIdr(sisa),
            // Sisa negatif berarti serapan melampaui anggaran. Ditandai merah,
            // bukan disembunyikan atau dijepit ke nol.
            c: sisa !== null && sisa < 0 ? "text-rose-700" : "text-slate-800",
          },
          {
            l: "% serapan",
            v: persen === null ? EMPTY : `${persen.toFixed(1)}%`,
            c: persen !== null && persen > 100 ? "text-rose-700" : "text-slate-800",
          },
        ].map((k) => (
          <div key={k.l} className="bg-white px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{k.l}</p>
            <p className={cn("text-sm font-semibold tabular-nums", k.c)}>{k.v}</p>
          </div>
        ))}
      </div>

      <div className="px-2 py-3">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={titik} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#f1f0ed" vertical={false} />
            <XAxis
              dataKey="bulanKe" tick={{ fontSize: 10, fill: "#a8a49a" }}
              tickFormatter={(v: number) => `B${v}`}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#a8a49a" }}
              tickFormatter={(v: number) => `${Math.round(v / 1_000_000)} jt`}
            />
            <Tooltip
              formatter={(v, n) => [v === null ? EMPTY : formatIdr(Number(v)), n]}
              labelFormatter={(l) => `Bulan ke-${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone" dataKey="rencanaKumulatif" name="Rencana (kumulatif)"
              stroke="#64748b" strokeWidth={2} strokeDasharray="4 3" dot={false}
            />
            <Line
              type="monotone" dataKey="realisasiKumulatif" name="Realisasi (kumulatif)"
              stroke="#15803d" strokeWidth={2} dot={{ r: 2 }}
              // Titik kosong TIDAK disambung: bulan tanpa catatan bukan bulan
              // tanpa belanja, dan menyambungnya menghapus perbedaan itu.
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        {adaRealisasi
          ? "Garis realisasi berhenti di bulan terakhir yang punya catatan pengeluaran disetujui — bukan berarti nol setelahnya, melainkan belum ada catatannya."
          : "Belum ada pengeluaran disetujui yang tertaut ke RAB ini, jadi garis realisasi belum muncul. Serapan baru terhitung setelah penugasan direalisasikan dan disetujui."}
      </p>
    </div>
  );
}
