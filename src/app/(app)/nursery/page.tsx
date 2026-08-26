import { ClipboardCheck, PackageOpen, Sprout } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { OpRecordForm } from "@/components/ui/OpRecordForm";
import { OpRecordTable } from "@/components/ui/OpRecordTable";
import {
  listSeedStock,
  listNurseryInspections,
  listSeedBatchOptions,
  listSeedDistributions,
} from "@/lib/repo/operational";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { createNurseryInspectionAction, createSeedDistributionAction, updateOpRecordAction } from "@/lib/actions/operational";
import { formatNumber, formatPct, formatDate, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Field } from "@/components/ui/OpRecordForm";

export const metadata = { title: "Bibit & Nursery — AgroVision" };

export default async function Page() {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const [stock, inspections, batches, distributions, blockOptions] = await Promise.all([
    listSeedStock(ctx),
    listNurseryInspections(ctx),
    listSeedBatchOptions(ctx),
    listSeedDistributions(ctx),
    searchBlockOptions(ctx),
  ]);
  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);
  // Distribusi butuh batch DAN blok tujuan; tanpa keduanya formnya tak berguna.
  const distReady = canWrite && Boolean(ctx.companyId) && batches.length > 0 && blockOptions.length > 0;
  const inspFields: Field[] = [
    {
      kind: "select", name: "seedBatchId", label: "Batch bibit", options: batches, required: true,
      hint: "Jenis/varietas bibit dirujuk dari Konfigurasi (K-05) — di sini hanya memilih, bukan membuat.",
    },
    { kind: "text", name: "inspectedOn", label: "Tanggal inspeksi", type: "date", required: true },
    {
      kind: "text", name: "qtyAlive", label: "Jumlah hidup", type: "number", step: "1", min: "0", required: true,
      hint: "Angka inilah yang menggerakkan survival rate setelah inspeksi disetujui.",
    },
    { kind: "text", name: "qtyDead", label: "Jumlah mati", type: "number", step: "1", min: "0" },
    { kind: "text", name: "qtyDamaged", label: "Jumlah rusak", type: "number", step: "1", min: "0" },
  ];

  return (
    <div>
      <PageHeader title={t("nav.nursery")} subtitle={t("sub.nursery")} />

      {canWrite && ctx.companyId && (
        batches.length > 0 ? (
          <div className="mb-5">
            <OpRecordForm title="Catat inspeksi bibit" action={createNurseryInspectionAction} fields={inspFields} />
          </div>
        ) : (
          <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <EmptyState
              icon={Sprout}
              title="Belum ada batch bibit terdaftar"
              description="Sesuai keputusan K-05, jenis/varietas bibit dikelola super_admin lewat Konfigurasi — form inspeksi hanya memilih batch yang sudah ada, tidak membuat jenis bibit baru. Hubungi super_admin untuk mendaftarkan batch."
              action={
                <Link
                  href="/pengaturan/master-data"
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  Buka Pengaturan › Konfigurasi
                </Link>
              }
            />
          </div>
        )
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-800">Stok per batch</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {stock.length === 0 ? (
          <EmptyState icon={Sprout} title="Belum ada batch bibit" description="Batch bibit dan inspeksinya muncul di sini setelah dicatat." />
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Batch</th>
                  <th className="px-4 py-2.5 font-medium">Komoditas</th>
                  <th className="px-4 py-2.5 text-right font-medium">Awal</th>
                  <th className="px-4 py-2.5 text-right font-medium">Hidup</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mati</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rusak</th>
                  <th className="px-4 py-2.5 text-right font-medium">Survival</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => (
                  <tr key={s.batchCode} className="border-b border-slate-50 last:border-0">
                    <td data-label="Batch" className="px-4 py-2.5 font-mono text-xs text-slate-600">{s.batchCode}</td>
                    <td data-label="Komoditas" className="px-4 py-2.5 text-slate-700">{s.cropName}</td>
                    <td data-label="Awal" className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatNumber(s.qtyInitial)}</td>
                    <td data-label="Hidup" className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{formatNumber(s.qtyAlive)}</td>
                    <td data-label="Mati" className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatNumber(s.qtyDead)}</td>
                    <td data-label="Rusak" className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatNumber(s.qtyDamaged)}</td>
                    <td data-label="Survival" className={cn("px-4 py-2.5 text-right font-medium tabular-nums",
                      s.survivalPct === null ? "text-slate-300" : s.survivalPct >= 90 ? "text-emerald-700" : "text-amber-700")}>
                      {s.survivalPct === null ? EMPTY : formatPct(s.survivalPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Survival rate dihitung dari inspeksi terakhir yang disetujui dibagi jumlah awal batch. Batch tanpa inspeksi ditandai {EMPTY}.</p>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-800">Riwayat inspeksi</h2>
      <OpRecordTable
        rows={inspections.rows}
        moduleKey="nursery_inspections"
        blockHeader="Batch"
        emptyIcon={ClipboardCheck}
        emptyTitle="Belum ada inspeksi bibit"
        canWrite={canWrite}
        editFields={inspFields}
        updateAction={updateOpRecordAction}
      />

{/* --- Distribusi bibit (AI-50): pencatatan langsung, tanpa approval --- */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-800">Distribusi bibit ke blok</h2>
      {distReady && (
        <div className="mb-5">
          <OpRecordForm
            title="Catat distribusi bibit"
            action={createSeedDistributionAction}
            submitLabel="Catat distribusi"
            fields={[
              { kind: "select", name: "seedBatchId", label: "Batch bibit", options: batches, required: true },
              { kind: "select", name: "blockId", label: "Blok tujuan", options: blockOptions, required: true },
              { kind: "text", name: "distributedOn", label: "Tanggal", type: "date", required: true },
              { kind: "text", name: "qty", label: "Jumlah (batang)", type: "number", step: "1", min: "1", required: true,
                hint: "Volume ini menggerakkan biaya pengadaan bibit di Refleksi Biaya." },
            ]}
          />
        </div>
      )}
      {canWrite && ctx.companyId && batches.length === 0 && (
        <p className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Belum ada batch bibit aktif — distribusi baru bisa dicatat setelah batch bibit terdaftar.</p>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {distributions.length === 0 ? (
          <EmptyState icon={PackageOpen} title="Belum ada distribusi bibit" description="Distribusi bibit dari batch ke blok tercatat di sini dan langsung terhitung di Refleksi Biaya." />
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Tanggal</th>
                  <th className="px-4 py-2.5 font-medium">Batch</th>
                  <th className="px-4 py-2.5 font-medium">Blok</th>
                  <th className="px-4 py-2.5 text-right font-medium">Jumlah</th>
                  <th className="px-4 py-2.5 font-medium">Petugas</th>
                </tr>
              </thead>
              <tbody>
                {distributions.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50 last:border-0">
                    <td data-label="Tanggal" className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(d.distributedOn)}</td>
                    <td data-label="Batch" className="px-4 py-2.5 font-mono text-xs text-slate-600">{d.batchCode}</td>
                    <td data-label="Blok" className="px-4 py-2.5 font-mono text-xs text-slate-600">{d.blockCode}</td>
                    <td data-label="Jumlah" className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatNumber(d.qty)}</td>
                    <td data-label="Petugas" className="px-4 py-2.5 text-slate-500">{d.createdByName ?? EMPTY}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Distribusi bibit tercatat langsung (tanpa approval) dan menjadi volume driver biaya pengadaan bibit di Refleksi Biaya serta rantai traceability batch → blok.</p>
    </div>
  );
}
