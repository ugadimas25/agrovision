"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, FlaskConical } from "lucide-react";
import type { FertRecommendation } from "@/lib/repo/fertilizer";
import { computeBlend } from "@/lib/fertBlend";
import { approachLabel, phaseLabel } from "@/lib/fertParams";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatDate, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CROP as CROP_LABEL } from "@/lib/labels";

// Semua dosis hara memakai satuan gram hara per pohon per tahun (g/pohon).
const UNIT = "g/pohon";

/**
 * Tabel rekomendasi pemupukan dengan baris yang bisa DIKLIK untuk melihat:
 *  - nilai tiap target hara + satuan,
 *  - DOSIS PRODUK PUPUK (mis. K₂O 500 → KNO₃ ≈ 1.087 g/pohon),
 *  - dasar/catatan rekomendasi.
 */
export function RecommendationTable({ recos }: { recos: FertRecommendation[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    /* Matriks lebar (13 kolom, 5 kolom dosis hara untuk dibandingkan menyamping)
       + baris detail expandable → scroll horizontal, kolom Blok tetap terlihat. */
    <ResponsiveTable mode="scroll">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Blok</th>
            <th className="px-3 py-2.5 font-medium">Komoditas</th>
            <th className="px-3 py-2.5 font-medium">Fase</th>
            <th className="px-3 py-2.5 font-medium">Pendekatan</th>
            <th className="px-3 py-2.5 text-right font-medium">N</th>
            <th className="px-3 py-2.5 text-right font-medium">P₂O₅</th>
            <th className="px-3 py-2.5 text-right font-medium">K₂O</th>
            <th className="px-3 py-2.5 text-right font-medium">MgO</th>
            <th className="px-3 py-2.5 text-right font-medium">S</th>
            <th className="px-3 py-2.5 font-medium">Sumber K</th>
            <th className="px-3 py-2.5 text-right font-medium">Split</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Tanggal</th>
          </tr>
        </thead>
        <tbody>
          {recos.map((r) => {
            const open = openId === r.id;
            const blend = computeBlend(r);
            return (
              <FragmentRow key={r.id}>
                <tr
                  onClick={() => setOpenId(open ? null : r.id)}
                  className={cn("cursor-pointer border-b border-slate-50 hover:bg-slate-50/70", open && "bg-emerald-50/40")}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-emerald-600" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                      {r.blockCode}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{CROP_LABEL[r.cropCode] ?? r.cropCode}</td>
                  <td className="px-3 py-2.5 text-slate-700">{phaseLabel(r.phase)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{approachLabel(r.approach)}</td>
                  <Dose v={r.doseN} />
                  <Dose v={r.doseP2o5} />
                  <Dose v={r.doseK2o} />
                  <Dose v={r.doseMgo} />
                  <Dose v={r.doseS} />
                  <td className="px-3 py-2.5 text-slate-600">{r.kSource ?? EMPTY}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.splitCount ?? EMPTY}</td>
                  <td className="px-3 py-2.5">
                    {r.isProvisional ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">Provisional</span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Terkalibrasi</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{formatDate(r.recommendedAt)}</td>
                </tr>

                {open && (
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <td colSpan={13} className="px-4 py-3">
                      <div className="grid gap-4 lg:grid-cols-2">
                        {/* Kiri: konteks + target hara */}
                        <div>
                          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            <KV label="Blok" value={`${r.blockCode}${r.blockName ? " — " + r.blockName : ""}`} />
                            <KV label="Komoditas" value={CROP_LABEL[r.cropCode] ?? r.cropCode} />
                            <KV label="Fase" value={phaseLabel(r.phase)} />
                            <KV label="Pendekatan" value={approachLabel(r.approach)} />
                            <KV label="Sumber K" value={r.kSource ?? EMPTY} />
                            <KV label="Split" value={r.splitCount ? `${r.splitCount}× / tahun` : EMPTY} />
                          </div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Target hara ({UNIT})</p>
                          <div className="flex flex-wrap gap-1.5">
                            <NutChip label="N" v={r.doseN} />
                            <NutChip label="P₂O₅" v={r.doseP2o5} />
                            <NutChip label="K₂O" v={r.doseK2o} />
                            <NutChip label="MgO" v={r.doseMgo} />
                            <NutChip label="S" v={r.doseS} />
                          </div>
                          {r.note && (
                            <p className="mt-2 text-xs leading-relaxed text-slate-500">
                              <span className="font-medium text-slate-600">Dasar: </span>{r.note}
                            </p>
                          )}
                        </div>

                        {/* Kanan: dosis PRODUK pupuk (hasil konversi) */}
                        <div className="rounded-lg border border-emerald-200 bg-white p-3">
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                            <FlaskConical className="h-3.5 w-3.5" /> Rekomendasi produk pupuk ({UNIT})
                          </p>
                          {blend.length === 0 ? (
                            <p className="text-xs text-slate-500">Target hara belum lengkap untuk dihitung.</p>
                          ) : (
                            <ul className="space-y-1.5">
                              {blend.map((b) => (
                                <li key={b.product} className="flex items-baseline justify-between gap-3 text-sm">
                                  <span className="text-slate-700">
                                    {b.product}
                                    <span className="ml-1.5 text-[10px] text-slate-500">suplai {b.supplies}</span>
                                  </span>
                                  <span className="font-semibold tabular-nums text-slate-800">
                                    {formatNumber(Math.round(b.amountG))} <span className="text-xs font-normal text-slate-500">{UNIT}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-500">
                            Dihitung: target hara ÷ kadar hara produk (mis. K₂O 500 ÷ 46% KNO₃ ≈ 1.087 {UNIT}).
                            Total per tahun; bagi ke {r.splitCount ?? "beberapa"} aplikasi. Provisional sampai terkalibrasi.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Dose({ v }: { v: number | null }) {
  return (
    <td className={cn("px-3 py-2.5 text-right tabular-nums", v === null ? "text-slate-300" : "text-slate-700")}>
      {v === null ? EMPTY : formatNumber(v)}
    </td>
  );
}

function NutChip({ label, v }: { label: string; v: number | null }) {
  return (
    <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs">
      <span className="text-slate-500">{label}</span>{" "}
      <span className={cn("font-semibold tabular-nums", v === null ? "text-slate-300" : "text-slate-800")}>
        {v === null ? EMPTY : formatNumber(v)}
      </span>
    </span>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-slate-600">
      <span className="text-slate-500">{label}:</span> <span className="font-medium">{value}</span>
    </span>
  );
}
