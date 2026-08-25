import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckSquare, History, ShieldAlert } from "lucide-react";
import { requireContext } from "@/lib/session";
import { listAllPending } from "@/lib/repo/costing";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { PendingTable } from "./PendingTable";

export const metadata = { title: "Inbox Approval — AgroVision" };

/**
 * Inbox approval terpusat lintas-modul (concept:194).
 *
 * Dibaca dari view v_pending_approvals (migrasi 0025) yang meng-UNION semua
 * tabel ber-approval_status. Statusnya kolom pada entitas asal — jadi status di
 * sini dan di modul asal mustahil berbeda; keduanya satu kolom yang sama.
 *
 * Keputusan di sini langsung mengubah angka laporan: view agregasi hanya
 * menghitung baris `approved`.
 */
export default async function ApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const t = getDict(await getLocale());

  const canDecide = ["approver", "super_admin"].includes(ctx.session.role);
  const sp = await searchParams;
  const page = Number(sp.page ?? "1") || 1;
  const data = await listAllPending(ctx, { page });

  return (
    <div>
      <PageHeader
        title={t("nav.approval.inbox")}
        subtitle={t("sub.approval")}
        actions={
          <Link
            href="/approval/riwayat"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <History className="h-4 w-4" /> Riwayat
          </Link>
        }
      />

      {!canDecide && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm leading-relaxed text-amber-900">
            Peran Anda <strong>{ctx.session.role}</strong> hanya bisa melihat. Menyetujui atau
            menolak membutuhkan peran approver.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="Tidak ada yang menunggu approval"
            description="Item muncul di sini setelah pembuatnya mengajukan dari modul asal — pengeluaran, pemupukan, survei, dan lainnya."
          />
        ) : (
          <>
            <PendingTable rows={data.rows} canDecide={canDecide} />
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              basePath="/approval"
            />
          </>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        <strong>Klik satu baris</strong> untuk melihat nilai tiap parameter. Kolom <strong>Nilai</strong>{" "}
        adalah rupiah ter-refleksi (volume × tarif price list; panen = pendapatan, ditandai hijau) —
        modul murni observasi tetap &quot;—&quot; karena tidak menjadi biaya. Penolakan wajib
        menyertakan alasan (ditegakkan constraint database). Record yang ditolak otomatis keluar dari
        perhitungan laporan, dan pembuatnya bisa memperbaiki lalu mengajukan ulang.
      </p>
    </div>
  );
}
