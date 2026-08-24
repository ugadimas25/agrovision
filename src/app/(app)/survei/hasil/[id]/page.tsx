import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, Smartphone } from "lucide-react";
import { requireContext } from "@/lib/session";
import { surveySubmissionDetail } from "@/lib/repo/operational";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecordStatusBadge } from "@/components/ui/RecordStatusBadge";
import { formatDate, EMPTY } from "@/lib/format";

export const metadata = { title: "Hasil Survei — AgroVision" };

/**
 * AI-22 · aksi View untuk satu hasil survei (catatan 10).
 *
 * Rute ini SENGAJA dua segmen (`/survei/hasil/<id>`), bukan satu. `/survei/[formId]`
 * sudah memakai segmen pertama untuk mengisi form; menaruh detail di
 * `/survei/<id>` akan menabraknya dan id submission akan diperlakukan sebagai
 * id form.
 *
 * Yang dirender adalah SELURUH pertanyaan pada versi form itu, termasuk yang
 * tidak dijawab — em-dash. Menampilkan hanya yang terisi membuat hasil survei
 * setengah lengkap terlihat lengkap.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const { id } = await params;

  // UUID divalidasi di sini: id ngawur dari URL harus menjadi 404, bukan galat
  // Postgres 22P02 yang tampil sebagai HTTP 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const d = await surveySubmissionDetail(ctx, id);
  if (!d) notFound();

  const terjawab = d.answers.filter((a) => a.value !== null).length;
  const seksi = [...new Set(d.answers.map((a) => a.section ?? "Tanpa seksi"))];

  return (
    <div data-testid="detail-hasil-survei">
      <PageHeader title={d.formName} subtitle={`Modul ${d.formModule} · versi ${d.formVersion}`} />

      <Link href="/survei" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke daftar survei
      </Link>

      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Blok</dt>
          <dd data-empty={!d.blockCode} className="font-mono text-xs text-slate-700">{d.blockCode ?? EMPTY}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Estate</dt>
          <dd data-empty={!d.estateName} className="text-slate-700">{d.estateName ?? EMPTY}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Tanggal</dt>
          <dd className="text-slate-700">{formatDate(d.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Petugas</dt>
          <dd data-empty={!d.submittedByName} className="text-slate-700">{d.submittedByName ?? EMPTY}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Status</dt>
          <dd><RecordStatusBadge status={d.approvalStatus} /></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Kelengkapan</dt>
          {/* Dihitung, bukan diklaim: berapa pertanyaan yang benar-benar dijawab. */}
          <dd data-testid="kelengkapan-jawaban" className="tabular-nums text-slate-700">
            {terjawab} / {d.answers.length} pertanyaan
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Koordinat</dt>
          <dd data-empty={d.lat === null} className="text-xs text-slate-700">
            {d.lat === null || d.lon === null
              ? EMPTY
              : <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" />{d.lat.toFixed(5)}, {d.lon.toFixed(5)}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Perangkat</dt>
          <dd data-empty={!d.deviceId} className="text-xs text-slate-700">
            {d.deviceId
              ? <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3 text-slate-400" />{d.deviceId}</span>
              : EMPTY}
          </dd>
        </div>
      </dl>

      {d.rejectionReason && (
        <p className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
          <strong>Alasan penolakan:</strong> {d.rejectionReason}
        </p>
      )}

      {d.answers.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Versi form ini tidak punya field sama sekali.
        </p>
      ) : (
        <div className="space-y-4">
          {seksi.map((s) => (
            <section key={s} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{s}</h2>
              <dl className="divide-y divide-slate-50">
                {d.answers.filter((a) => (a.section ?? "Tanpa seksi") === s).map((a) => (
                  <div key={a.fieldId} className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4">
                    <dt className="text-xs text-slate-500">{a.label}</dt>
                    <dd data-empty={a.value === null} className={a.value === null ? "text-sm text-slate-300" : "text-sm break-words text-slate-700"}>
                      {a.value ?? EMPTY}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
