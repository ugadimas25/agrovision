import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { requireContext } from "@/lib/session";
import { getSurveyForm, surveySubmissionDetail } from "@/lib/repo/operational";
import { searchBlockOptions } from "@/lib/repo/blocks";
import { PageHeader } from "@/components/ui/PageHeader";
import { SurveyForm } from "./SurveyForm";

export const metadata = { title: "Isi Survei — AgroVision" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>;
  /** B-21: ?editId=<submission id> -- perbaiki hasil ditolak, bukan isi baru. */
  searchParams: Promise<{ editId?: string }>;
}) {
  let ctx;
  try { ctx = await requireContext(); } catch { redirect("/login"); }
  const { formId } = await params;
  const { editId } = await searchParams;

  const [form, blocks] = await Promise.all([
    getSurveyForm(ctx, formId),
    searchBlockOptions(ctx),
  ]);
  if (!form) redirect("/survei");

  // editId dari URL divalidasi terhadap submission sungguhan: harus ada dan
  // harus milik form yang sama (URL bisa saja ditempel manual dengan editId
  // asing) -- itu galat sungguhan, ditampilkan sebagai peringatan. Status
  // yang BUKAN 'rejected' BUKAN galat: begitu Simpan perbaikan berhasil,
  // baris ini langsung menjadi 'submitted' pada render berikutnya (Server
  // Component ini di-revalidate), padahal kartu sukses SurveyForm (state
  // client lokal, tidak ikut re-render) masih tampil -- keduanya jangan
  // sampai bertentangan di layar yang sama.
  const submissionForEdit = editId ? await surveySubmissionDetail(ctx, editId) : null;
  const editMismatch = Boolean(editId) && (!submissionForEdit || submissionForEdit.formId !== formId);
  const editing =
    submissionForEdit && submissionForEdit.formId === formId && submissionForEdit.approvalStatus === "rejected"
      ? submissionForEdit
      : null;
  const initialValues = editing
    ? Object.fromEntries(editing.answers.filter((a) => a.value !== null).map((a) => [a.code, a.value as string]))
    : undefined;

  const canWrite = ["creator", "approver", "super_admin"].includes(ctx.session.role);

  return (
    <div>
      <Link href="/survei" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Semua form
      </Link>
      <PageHeader
        title={form.name}
        subtitle={editing ? "Perbaiki hasil yang ditolak, lalu ajukan ulang." : `${form.fields.length} pertanyaan · hasil masuk ke approval.`}
      />

      {editMismatch && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            Hasil survei itu tidak ditemukan, bukan milik form ini, atau di luar akses Anda — form kosong ditampilkan sebagai gantinya.
          </p>
        </div>
      )}

      {!canWrite || !ctx.companyId ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            {!ctx.companyId ? "Pilih satu entitas dulu di kanan atas." : "Peran Anda tidak berhak mengisi survei."}
          </p>
        </div>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada blok. Tambahkan blok dulu di menu Blok &amp; Peta.</p>
      ) : (
        <SurveyForm
          form={form}
          blocks={blocks}
          editId={editing?.id}
          initialBlockId={editing?.blockId}
          initialValues={initialValues}
        />
      )}
    </div>
  );
}
