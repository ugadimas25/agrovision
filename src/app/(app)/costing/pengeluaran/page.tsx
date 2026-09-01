import { redirect } from "next/navigation";
import { Wallet, Paperclip } from "lucide-react";
import { requireContext } from "@/lib/session";
import {
  blockCostSummary,
  listExpenditures,
  totalApprovedSpend,
  listCostCenterOptions,
  listFiscalPeriodOptions,
  listSupplierOptions,
} from "@/lib/repo/costing";
import { listCategoryOptions, listOptions } from "@/lib/repo/master";
import { listPenugasanSaya } from "@/lib/repo/budgetPlan";
import { searchBlockOptions, listEstateOptions } from "@/lib/repo/blocks";
import { listCropCodeOptions } from "@/lib/repo/operational";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { parseDashboardFilter, ringkasBatasan, type Terbatas } from "@/lib/report/filters";
import { resolveFilter } from "@/lib/report/filterResolve";
import { autoMaterializedCategories } from "@/lib/repo/pricing";
import { ExpenditureForm } from "./ExpenditureForm";
import { ExpenditureEditor } from "./ExpenditureEditor";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatDate, formatIdr, formatIdrShort, formatHa, EMPTY } from "@/lib/format";
import { SubmitButton } from "./SubmitButton";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pengeluaran — AgroVision" };

const STATUSES = [
  { value: "", label: "Semua status" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Diajukan" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
];

/**
 * Pengeluaran (biaya).
 *
 * Dua jalur biaya, dan pembedaannya penting:
 *
 *   1. OTOMATIS — aktivitas lapangan yang disetujui memateralisasi biayanya
 *      sendiri (volume × tarif) di dalam app.decide_record(), migrasi 0044.
 *      Baris itu bertanda source_table/source_record_id.
 *   2. MANUAL (AI-52, §13 aturan 5) — biaya yang TIDAK punya aktivitas di
 *      belakangnya: overhead dan upah harian. Itu yang diinput form di bawah.
 *
 * Form manualnya sengaja tidak dibatasi per kategori: LABOR lahir otomatis dari
 * penyiangan & pruning TAPI upah harian (LABOR-DAY, tanpa driver) memang harus
 * dicatat tangan. Memblokir kategorinya akan mematikan kebutuhan yang membuat
 * form ini ada. Penjaganya peringatan berbasis data (autoMaterializedCategories),
 * bukan larangan.
 * Halaman ini menampilkan transaksi biaya tercatat + biaya per blok. Pendapatan
 * ada di menu terpisah (Revenue).
 */
export default async function PengeluaranPage({
  searchParams,
}: {
  // K-08: bentuk searchParams SAMA dengan ketiga dashboard (estate/periode/
  // blok/komoditas berulang), ditambah parameter milik halaman ini sendiri.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const t = getDict(await getLocale());

  const sp = await searchParams;
  const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Number(satu(sp.page) ?? "1") || 1;
  const status = satu(sp.status) || undefined;
  const q = satu(sp.q);

  const filter = parseDashboardFilter(sp);
  const f = await resolveFilter(ctx, filter);

  const [data, perBlock, total, estateOpts, cropOpts, periodOpts] = await Promise.all([
    listExpenditures(ctx, { page, status, search: q, filter: f }),
    blockCostSummary(ctx, { limit: 5, blockIds: f.blockIds }),
    totalApprovedSpend(ctx, f),
    listEstateOptions(ctx),
    listCropCodeOptions(ctx),
    listFiscalPeriodOptions(ctx),
  ]);
  // Blok dipakai DUA kali di halaman ini: opsi filter dan opsi form. Dimuat
  // sekali di sini karena opsi form hanya dimuat bila boleh menulis.
  const filterBlocks = await searchBlockOptions(ctx);

  // Kejujuran filter: cost_transactions tidak menyimpan komoditas, jadi filter
  // komoditas tidak bisa dihormati di halaman ini. Dinyatakan, bukan didiamkan.
  const terbatas: Terbatas[] = filter.cropCodes.length > 0
    ? [{ metrik: "Transaksi biaya", alasan: "cost_transactions tidak menyimpan komoditas" }]
    : [];

  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  // Opsi form dimuat hanya bila pengguna memang boleh menulis DAN entitas sudah
  // dipilih — di mode "semua entitas" createExpenditureAction menolak, jadi
  // merender formnya cuma menjanjikan yang pasti gagal.
  const formReady = canWrite && Boolean(ctx.companyId);
  const [categories, units, blockOpts, costCenters, periods, suppliers, autoKategori, penugasanSaya] = formReady
    ? await Promise.all([
        listCategoryOptions(ctx),
        listOptions(ctx, "unit_of_measure"),
        searchBlockOptions(ctx),
        listCostCenterOptions(ctx),
        listFiscalPeriodOptions(ctx),
        listSupplierOptions(ctx),
        autoMaterializedCategories(ctx),
        // 0066: penugasan RAB yang masih terbuka untuk pencatat ini. Kosong
        // bukan berarti gagal -- tidak semua belanja berasal dari RAB.
        listPenugasanSaya(ctx),
      ])
    : [[], [], [], [], [], [], [], []];

  return (
    <div>
      <PageHeader title={t("nav.expenditure")} subtitle={t("sub.expenditure")} />

      {/* K-08 · komponen filter yang SAMA dengan dashboard. `keep` membawa
          status & kata kunci supaya menekan Terapkan tidak menghapus keduanya. */}
      <div className="mb-4 space-y-2">
        <FilterBar basePath="/costing/pengeluaran" filter={filter}
                   estates={estateOpts} blocks={filterBlocks} periods={periodOpts} crops={cropOpts}
                   catatanKomoditas={null} keep={{ status, q }} />
        {ringkasBatasan(terbatas) && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <strong>Tidak mengikuti filter:</strong> {ringkasBatasan(terbatas)}. Daftar di bawah
            karena itu TIDAK dipersempit oleh pilihan komoditas.
          </p>
        )}
      </div>

      {/* AI-52: form manual KHUSUS overhead & upah (§13 aturan 5). */}
      {formReady && (
        <div className="mb-5 space-y-3">
          {autoKategori.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              <strong>Jangan catat manual di sini</strong> untuk kategori yang biayanya sudah lahir
              sendiri dari aktivitas yang disetujui — mencatat ulang akan menggandakan realisasi
              anggaran:{" "}
              {autoKategori.map((k, i) => (
                <span key={k.name}>
                  {i > 0 && ", "}
                  <span className="font-medium">{k.name}</span>
                  {k.adaJalurManual && <span className="text-amber-700"> (kecuali upah harian)</span>}
                </span>
              ))}
              . Form ini untuk biaya yang TIDAK punya aktivitas di belakangnya: overhead dan upah.
            </div>
          )}
          <ExpenditureForm
            categories={categories}
            units={units}
            blocks={blockOpts}
            costCenters={costCenters}
            periods={periods}
            suppliers={suppliers}
            penugasan={penugasanSaya}
          />
        </div>
      )}

      {/* KPI dari data nyata. Bila belum ada data, tampil em dash — bukan 0. */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Total disetujui" value={formatIdrShort(total)} title={total === null ? undefined : formatIdr(total)} hint={total === null ? "Belum ada pengeluaran disetujui" : undefined} />
        <Kpi label="Jumlah transaksi" value={data.total === 0 ? EMPTY : String(data.total)} />
        <Kpi label="Blok dengan biaya" value={perBlock.length === 0 ? EMPTY : String(perBlock.length)} />
      </div>

      {/* ── Biaya per blok ── */}
      {perBlock.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Biaya per blok</p>
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Blok</th>
                  <th className="px-4 py-2.5 text-right font-medium">Luas</th>
                  <th className="px-4 py-2.5 text-right font-medium">Transaksi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total biaya</th>
                  <th className="px-4 py-2.5 text-right font-medium">Biaya / ha</th>
                </tr>
              </thead>
              <tbody>
                {perBlock.map((b) => (
                  <tr key={b.blockId} className="border-b border-slate-50 last:border-0">
                    <td data-label="Blok" className="px-4 py-2.5 font-mono text-xs text-slate-600">{b.blockCode}</td>
                    <td data-label="Luas" className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatHa(b.areaHa)}</td>
                    <td data-label="Transaksi" className="px-4 py-2.5 text-right tabular-nums text-slate-500">{b.transactionCount}</td>
                    <td data-label="Total biaya" className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatIdr(b.totalCostIdr)}</td>
                    <td data-label="Biaya / ha" className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800">
                      {b.costPerHaIdr === null ? (
                        <span title="Luas belum ada — polygon blok belum didigitasi">{EMPTY}</span>
                      ) : (
                        formatIdr(b.costPerHaIdr)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Hanya transaksi berstatus <strong>disetujui</strong> yang dihitung. Luas berasal dari PostGIS, bukan input manual.
          </p>
        </div>
      )}

      {/* ── Daftar transaksi biaya ── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <form action="/costing/pengeluaran" className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Cari blok, kategori, atau supplier..."
            className="w-full max-w-xs rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Terapkan
          </button>
        </form>

        {data.rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={sp.q || sp.status ? "Tidak ada transaksi yang cocok" : "Belum ada pengeluaran"}
            description={sp.q || sp.status ? "Coba ubah filter." : "Biaya mengalir dari aktivitas yang disetujui (refleksi), bukan input manual."}
          />
        ) : (
          <>
            <ResponsiveTable>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Tanggal</th>
                    <th className="px-4 py-2.5 font-medium">Blok</th>
                    <th className="px-4 py-2.5 font-medium">Kategori</th>
                    <th className="px-4 py-2.5 font-medium">Supplier</th>
                    <th className="px-4 py-2.5 text-right font-medium">Nilai</th>
                    <th className="px-4 py-2.5 font-medium">Bukti</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 align-top last:border-0">
                      <td data-label="Tanggal" className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(r.transactionDate)}</td>
                      <td data-label="Blok" className="px-4 py-2.5 font-mono text-xs text-slate-600">
                        {r.isOverhead ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-xs text-slate-500">overhead</span>
                        ) : (
                          r.blockCode ?? EMPTY
                        )}
                      </td>
                      <td data-label="Kategori" data-empty={!r.costCategoryName} className="px-4 py-2.5 text-slate-700">{r.costCategoryName ?? EMPTY}</td>
                      <td data-label="Supplier" data-empty={!r.supplierName} className="px-4 py-2.5 text-slate-500">{r.supplierName ?? EMPTY}</td>
                      <td data-label="Nilai" className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-800">{formatIdr(r.amountIdr)}</td>
                      <td data-label="Bukti" className="px-4 py-2.5">
                        {r.evidenceId ? (
                          <a
                            href={`/api/evidence/${r.evidenceId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                            title={`${r.evidenceCount} lampiran — lihat bukti`}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {r.evidenceCount}
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500" title={`${r.evidenceCount} lampiran`}>
                            <Paperclip className="h-3.5 w-3.5" />
                            {r.evidenceCount}
                          </span>
                        )}
                      </td>
                      <td data-label="Status" className="px-4 py-2.5">
                        <RecordStatusBadge status={r.approvalStatus} />
                        {r.rejectionReason && (
                          <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-red-600">{r.rejectionReason}</p>
                        )}
                      </td>
                      <td data-action className="px-4 py-2.5 text-right">
                        {/* Draft & DITOLAK sama-sama bisa diperbaiki lalu diajukan
                            ulang (AI-11, catatan 6.5): record yang ditolak tidak
                            boleh jadi jalan buntu. Policy ct_role_split yang
                            menegakkan batasnya di database. */}
                        {canWrite && (r.approvalStatus === "draft" || r.approvalStatus === "rejected") && (
                          <div className="flex w-full flex-wrap items-start justify-end gap-x-3 gap-y-2">
                            {formReady && (
                              <ExpenditureEditor
                                id={r.id}
                                categories={categories}
                                costCategoryId={r.costCategoryId}
                                transactionDate={r.transactionDate}
                                amountIdr={r.amountIdr}
                                note={r.note}
                              />
                            )}
                            <SubmitButton id={r.id} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              basePath="/costing/pengeluaran"
              // Filter ikut dibawa: tanpa ini halaman 2 memuat daftar TANPA
              // filter, sementara bilah filternya tetap tampak tercentang.
              params={{
                q, status,
                estate: filter.estateIds, blok: filter.blockIds,
                periode: filter.periodIds, komoditas: filter.cropCodes,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, title, hint }: { label: string; value: string; title?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", value === EMPTY ? "text-slate-300" : "text-slate-800")} title={title}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
