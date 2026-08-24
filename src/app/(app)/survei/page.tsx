import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { listPublishedForms, listSurveySubmissions } from "@/lib/repo/operational";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { formatDate, EMPTY } from "@/lib/format";

export const metadata = { title: "Survei — AgroVision" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const t = getDict(await getLocale());
  const sp = await searchParams;
  const [forms, subs] = await Promise.all([
    listPublishedForms(ctx),
    listSurveySubmissions(ctx, { page: Number(sp.page ?? "1") || 1 }),
  ]);

  return (
    <div>
      <PageHeader title={t("page.survey.title")} subtitle={t("sub.survey")} />

      <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Form Tersedia</h2>
        {forms.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Belum ada form published" description="Form builder untuk membuat skema: fase 2. Struktur form_versions & form_fields sudah siap." />
        ) : (
          <ul className="divide-y divide-slate-50">
            {forms.map((f) => (
              <li key={f.id}>
                <Link href={`/survei/${f.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{f.name}</p>
                    <p className="text-xs text-slate-500">Modul {f.module} · versi {f.version}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">{f.fieldCount} field</span>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">Hasil Survei</h2>
        {subs.rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Belum ada hasil survei" description="Submission dari lapangan muncul di sini. Renderer form schema-driven & entri mobile: fase berikutnya." />
        ) : (
          <>
            <ResponsiveTable>
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-4 py-2.5 font-medium">Form</th><th className="px-4 py-2.5 font-medium">Blok</th><th className="px-4 py-2.5 font-medium">Tanggal</th><th className="px-4 py-2.5 font-medium">Petugas</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 text-right font-medium">Aksi</th></tr>
                </thead>
                <tbody>
                  {subs.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0">
                      <td data-label="Form" className="px-4 py-2.5 text-slate-700">{r.formName}</td>
                      <td data-label="Blok" data-empty={!r.blockCode} className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.blockCode ?? EMPTY}</td>
                      <td data-label="Tanggal" className="px-4 py-2.5 text-slate-600">{formatDate(r.submittedAt)}</td>
                      <td data-label="Petugas" data-empty={!r.submittedByName} className="px-4 py-2.5 text-slate-500">{r.submittedByName ?? EMPTY}</td>
                      <td data-label="Status" className="px-4 py-2.5"><RecordStatusBadge status={r.approvalStatus} /></td>
                      {/* AI-22: tanpa ini, 66 baris submission_values di dataset
                          demo tidak bisa dilihat dari UI sama sekali. */}
                      <td data-label="Aksi" className="px-4 py-2.5 text-right">
                        <Link href={`/survei/hasil/${r.id}`} data-testid="lihat-hasil-survei"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                          Lihat <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
            <Pagination page={subs.page} pageSize={subs.pageSize} total={subs.total} basePath="/survei" />
          </>
        )}
      </section>
    </div>
  );
}
