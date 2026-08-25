import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { requireContext } from "@/lib/session";
import { listApprovalHistory } from "@/lib/repo/costing";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { HistoryTable } from "./HistoryTable";

export const metadata = { title: "Riwayat Approval — AgroVision" };

/**
 * B-22: riwayat keputusan approval, terpisah dari Inbox (/approval).
 *
 * Dibaca dari app.v_approval_history (migrasi 0056) -- view yang menggabung
 * app.audit_log (dicatat trigger write_audit(), B-8) dengan tabel modul asal.
 * TIDAK menyentuh v_pending_approvals sama sekali, jadi Inbox default tetap
 * hanya menampilkan yang menunggu.
 *
 * Lingkup kepemilikan otomatis dari RLS (bukan filter di sini): creator hanya
 * melihat riwayat miliknya sendiri lewat RESTRICTIVE SELECT policy per-creator
 * (migrasi 0054, B-23) pada tabel modul yang di-JOIN view; approver/super_admin/
 * viewer melihat seluruh tenant -- sama seperti mereka melihat Inbox hari ini.
 */
export default async function ApprovalHistoryPage({
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

  const sp = await searchParams;
  const page = Number(sp.page ?? "1") || 1;
  const data = await listApprovalHistory(ctx, { page });

  return (
    <div>
      <Link href="/approval" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Inbox
      </Link>
      <PageHeader
        title="Riwayat Approval"
        subtitle="Ajuan yang sudah diputuskan — siapa, kapan, dan alasannya."
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Belum ada riwayat"
            description="Muncul di sini setelah ada ajuan yang disetujui atau ditolak lewat Inbox Approval."
          />
        ) : (
          <>
            <HistoryTable rows={data.rows} />
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              basePath="/approval/riwayat"
            />
          </>
        )}
      </div>
    </div>
  );
}
