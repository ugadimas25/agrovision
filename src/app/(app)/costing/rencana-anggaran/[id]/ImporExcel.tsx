"use client";

import { useActionState, useState } from "react";
import {
  Loader2, Upload, CircleAlert, CircleCheck, TriangleAlert, FileSpreadsheet,
} from "lucide-react";
import {
  pratinjauImporAction, jalankanImporAction, type ImporState,
} from "@/lib/actions/budgetPlan";
import { formatIdr, formatNumber, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";

const awal: ImporState = { ok: false, message: "" };
type Option = { value: string; label: string };

/**
 * Impor RAB dari template Excel (RAB_Agroforestry_100ha_Banyumas_R2.xlsx).
 *
 * DUA LANGKAH, dan langkah pratinjaunya yang membuat fitur ini boleh ada.
 * Berkasnya tidak memuat tiga hal yang wajib di skema kita:
 *
 *   - kategori biaya   -> dipetakan pengguna per tahap, di layar ini
 *   - bulan fase       -> tidak ada di 08_CAPEX_RAB; semua masuk bulan ke-1
 *   - jenis komponen   -> tidak ada; memakai default kolomnya
 *
 * Ketiganya diumumkan, bukan ditebak diam-diam. Impor yang menebak akan
 * menghasilkan RAB yang terlihat lengkap padahal separuh isinya karangan
 * pengimpor — persis yang doktrin repo ini larang.
 */
export function ImporExcel({
  planId, categories, canEdit,
}: { planId: string; categories: Option[]; canEdit: boolean }) {
  const [pra, aksiPratinjau, sedangBaca] = useActionState(pratinjauImporAction, awal);
  const [hasil, aksiJalan, sedangTulis] = useActionState(jalankanImporAction, awal);
  // Pemetaan tahap -> kategori disimpan di sini supaya "terapkan ke semua" bisa
  // ada, dan supaya jumlah baris yang AKAN masuk bisa dihitung sebelum disimpan.
  const [peta, setPeta] = useState<Record<string, string>>({});

  if (!canEdit) return null;
  const p = pra.pratinjau;

  return (
    <details className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
        Impor dari Excel
        <span className="font-normal text-slate-400">— isi RAB dari template, tidak perlu ketik satu per satu</span>
      </summary>

      <div className="border-t border-slate-100 px-4 py-3">
        {/* Langkah 1 — unggah & baca */}
        <form action={aksiPratinjau} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="planId" value={planId} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Berkas template (.xlsx)</span>
            <input
              type="file" name="berkas" accept=".xlsx" required
              className="min-h-11 rounded-md border border-slate-200 px-2 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Skenario</span>
            <select name="skenario" defaultValue="1lokasi"
              className="min-h-11 rounded-md border border-slate-200 px-2 text-sm">
              <option value="1lokasi">Jumlah 1 lokasi</option>
              <option value="4lokasi">Jumlah 4 lokasi</option>
            </select>
          </label>
          <button type="submit" disabled={sedangBaca}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-emerald-700 px-3.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60">
            {sedangBaca ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Baca berkas
          </button>
        </form>

        <p className="mt-2 text-xs text-slate-400">
          Dibaca hanya sheet <b>02_Assumptions</b> dan <b>08_CAPEX_RAB</b>. Sheet rencana kerja
          (05), peralatan (06), input pertanian (07), dan OPEX 10 tahun (09) belum ikut: ketiganya
          memakai rentang tahun — Mulai/Selesai, T1…T10, umur manfaat — yang belum punya tempat di
          aplikasi. Angkanya tetap harus dilihat di Excel sampai bagian itu dibangun.
        </p>

        {pra.message && !pra.ok && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {pra.message}
          </p>
        )}

        {/* Langkah 2 — pratinjau & konfirmasi */}
        {p && (
          <form action={aksiJalan} className="mt-4 border-t border-slate-100 pt-4">
            <input type="hidden" name="planId" value={planId} />
            <input
              type="hidden" name="muatan"
              value={JSON.stringify({
                komponen: p.komponen.map((k) => ({
                  barisAsli: k.barisAsli, uraian: k.uraian, tahap: k.tahap, penggerak: k.penggerak,
                  volume: k.volume, satuanTeks: k.satuanTeks, hargaSatuan: k.hargaSatuan,
                  sumberRef: k.sumberRef,
                })),
                asumsi: p.asumsi.map((a) => ({
                  barisAsli: a.barisAsli, variabel: a.variabel, nilai: a.nilai, satuan: a.satuan,
                  idSumber: a.idSumber, keyakinan: a.keyakinan, catatan: a.catatan,
                })),
              })}
            />

            <p className="flex items-start gap-2 text-sm text-slate-700">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              {pra.message}
            </p>

            {p.komponenSudahAda > 0 && (
              <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                RAB ini sudah punya {p.komponenSudahAda} komponen. Impor <b>menambah</b>, tidak mengganti —
                kalau berkas ini sudah pernah diimpor, barisnya akan dobel.
              </p>
            )}

            {/* Angka turunan. Ini BUKAN butir peringatan biasa: pada template
                R2, seluruh 36 volume di 08_CAPEX_RAB adalah rumus yang menarik
                dari sheet 02/04/05/06. Setelah diimpor mereka menjadi angka
                tetap — mengubah luas kebun di aplikasi tidak akan
                menggerakkannya, padahal di Excel ia bergerak. Menyembunyikan
                fakta itu di antara 24 peringatan lain sama saja menyembunyikannya. */}
            {p.turunan.total > 0 && (p.turunan.volume > 0 || p.turunan.harga > 0) && (
              <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                <p className="font-semibold">Angka ini turunan di Excel, dan akan menjadi angka tetap di sini</p>
                <p className="mt-1">
                  {p.turunan.volume} dari {p.turunan.total} volume
                  {p.turunan.harga > 0 && <> dan {p.turunan.harga} dari {p.turunan.total} harga satuan</>}{" "}
                  di berkas berasal dari rumus, bukan diketik. Nilainya diimpor apa adanya;
                  mengubah asumsi di aplikasi <b>tidak</b> akan menggerakkannya.
                </p>
                <p className="mt-1 text-xs">
                  Supaya ikut bergerak, tautkan barisnya ke asumsi lewat kolom Basis setelah impor —
                  volume-nya lalu dihitung ulang database, seperti di Excel.
                </p>
              </div>
            )}

            {/* Status konsistensi model, dari sheet 15_Checks. Panduan template
                menyatakan sendiri: "STATUS MODEL harus PASS sebelum workbook
                digunakan." Impor dari workbook yang pemeriksaannya sendiri gagal
                tetap boleh — itu keputusan pengguna — tapi ia harus melihatnya
                SEBELUM menekan simpan, bukan sesudah angkanya masuk. */}
            {p.statusModel && (
              <div className={cn(
                "mt-3 rounded-md border px-3 py-2.5 text-sm",
                p.statusModel.gagal.length === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-900",
              )}>
                <p className="font-semibold">
                  Pemeriksaan internal workbook (15_Checks): {p.statusModel.status ?? EMPTY}
                </p>
                {p.statusModel.gagal.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {p.statusModel.gagal.slice(0, 8).map((g, i) => (
                      <li key={i}>{g.pemeriksaan}{g.selisih ? ` — selisih ${g.selisih}` : ""}</li>
                    ))}
                    {p.statusModel.gagal.length > 8 && <li>…dan {p.statusModel.gagal.length - 8} lainnya.</li>}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs">
                    Seluruh pemeriksaan internal lolos. Ini hanya berarti rumusnya konsisten pada
                    input saat ini — bukan bahwa angkanya sudah tervalidasi lapangan.
                  </p>
                )}
              </div>
            )}

            {/* Pemetaan tahap -> kategori. Tanpa ini barisnya tidak bisa masuk:
                cost_category_id NOT NULL, dan berkasnya tidak punya kolomnya. */}
            {p.tahapUnik.length > 0 && (
              <fieldset className="mt-4">
                <legend className="text-xs font-medium text-slate-500">
                  Kategori biaya per tahap — berkasnya tidak memuat kolom ini
                </legend>
                {/* Tanpa ini, 19 dropdown yang semuanya diawali "lewati" membuat
                    jalur paling mudah — tekan Simpan — mengimpor NOL komponen.
                    Jujur, tapi tidak berguna. Satu pilihan untuk semua tahap
                    membereskan kasus yang paling lazim; per-tahap tetap bisa
                    diubah sesudahnya. */}
                <label className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">Terapkan satu kategori ke semua tahap:</span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      setPeta(v === "" ? {} : Object.fromEntries(p.tahapUnik.map((t) => [t, v])));
                    }}
                    className="min-h-11 flex-1 rounded-md border border-slate-200 px-2 text-sm"
                  >
                    <option value="">— pilih untuk mengisi sekaligus —</option>
                    {categories.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </label>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {p.tahapUnik.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <span className="w-32 shrink-0 truncate text-slate-600" title={t}>{t}</span>
                      <select name={`kategori_${t}`} value={peta[t] ?? ""}
                        onChange={(e) => setPeta((v) => ({ ...v, [t]: e.target.value }))}
                        className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-sm">
                        <option value="">— lewati baris tahap ini —</option>
                        {categories.map((k) => (
                          <option key={k.value} value={k.value}>{k.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {(p.masalah.length > 0 || p.satuanTidakDikenal.length > 0) && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Yang perlu Anda tahu sebelum menyimpan
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                  {p.satuanTidakDikenal.length > 0 && (
                    <li>
                      Satuan tidak ada di master: <b>{p.satuanTidakDikenal.join(", ")}</b> — barisnya
                      tetap masuk, satuannya kosong ({EMPTY}).
                    </li>
                  )}
                  {p.masalah.slice(0, 12).map((m, i) => (
                    <li key={i}>{m.sheet} baris {m.baris}: {m.pesan}</li>
                  ))}
                  {p.masalah.length > 12 && <li>…dan {p.masalah.length - 12} lainnya.</li>}
                </ul>
              </div>
            )}

            <p className="mt-3 text-xs text-slate-500">
              Semua baris masuk sebagai <b>CAPEX bulan ke-1</b>: berkasnya tidak memuat bulan fase.
              Sesuaikan langsung di tabel setelah impor.
            </p>

            {/* Pratinjau baris — supaya yang menekan Simpan sudah melihat
                angkanya, bukan hanya jumlah barisnya. */}
            <div className="mt-3 max-h-64 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Tahap</th>
                    <th className="px-2 py-1.5 font-medium">Uraian</th>
                    <th className="px-2 py-1.5 text-right font-medium">Volume</th>
                    <th className="px-2 py-1.5 font-medium">Satuan</th>
                    <th className="px-2 py-1.5 text-right font-medium">Harga satuan</th>
                  </tr>
                </thead>
                <tbody>
                  {p.komponen.map((k) => (
                    <tr key={k.barisAsli} className="border-t border-slate-100">
                      <td className={cn("px-2 py-1", !k.tahap && "text-rose-600")}>
                        {k.tahap ?? "tidak dikenali"}
                      </td>
                      <td className="px-2 py-1 text-slate-700">{k.uraian}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatNumber(k.volume)}</td>
                      <td className="px-2 py-1 text-slate-500">{k.satuanTeks ?? EMPTY}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatIdr(k.hargaSatuan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(() => {
              // Dihitung dengan aturan yang SAMA seperti server (jalankanImporAction):
              // tahap harus terpetakan, volume harus > 0, harga tidak boleh kosong.
              // Kalau keduanya berbeda, angka di tombol ini berbohong.
              const akanMasuk = p.komponen.filter((k) =>
                k.tahap !== null && (peta[k.tahap] ?? "") !== ""
                && k.volume !== null && k.volume > 0 && k.hargaSatuan !== null).length;
              const dilewati = p.komponen.length - akanMasuk;
              return (
                <>
                  <p className="mt-3 text-sm text-slate-600">
                    <b>{akanMasuk}</b> dari {p.komponen.length} komponen akan masuk
                    {dilewati > 0 && <> · {dilewati} dilewati (tahap belum dipetakan, atau volume/harga kosong di berkas)</>}
                    {" · "}{p.asumsi.length} asumsi.
                  </p>
                  <button type="submit" disabled={sedangTulis || akanMasuk === 0}
                    className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60">
                    {sedangTulis ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
                    Simpan ke RAB ini
                  </button>
                  {akanMasuk === 0 && (
                    <p className="mt-1.5 text-xs text-rose-700">
                      Belum ada tahap yang dipetakan ke kategori biaya, jadi tidak ada komponen yang
                      akan masuk. Pakai &ldquo;terapkan ke semua tahap&rdquo; di atas, atau pilih per tahap.
                    </p>
                  )}
                </>
              );
            })()}
          </form>
        )}

        {hasil.message && (
          <p className={cn(
            "mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm",
            hasil.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800",
          )}>
            {hasil.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            {hasil.message}
          </p>
        )}
      </div>
    </details>
  );
}
