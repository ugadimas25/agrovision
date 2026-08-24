"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { setOrganicStatus, attachOrganicEvidence } from "@/lib/repo/sustainability";
import { putEvidence, StorageError } from "@/lib/storage";

export type OrganicState = { ok: boolean; message: string };

const schema = z.object({
  itemCode: z.string().trim().min(1).max(10),
  status: z.enum(["belum_mulai", "dalam_proses", "in_conversion", "tersertifikasi", "tidak_relevan"]),
  referenceNo: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  obtainedOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  expiresOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
});

export async function setOrganicStatusAction(_p: OrganicState, fd: FormData): Promise<OrganicState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };

    const parsed = schema.safeParse({
      itemCode: fd.get("itemCode"),
      status: fd.get("status"),
      referenceNo: fd.get("referenceNo") ?? "",
      note: fd.get("note") ?? "",
      obtainedOn: fd.get("obtainedOn") ?? "",
      expiresOn: fd.get("expiresOn") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Data tidak valid." };

    await setOrganicStatus(ctx, {
      itemCode: parsed.data.itemCode,
      status: parsed.data.status,
      referenceNo: parsed.data.referenceNo || null,
      note: parsed.data.note || null,
      obtainedOn: parsed.data.obtainedOn || null,
      expiresOn: parsed.data.expiresOn || null,
    });
    revalidatePath("/keberlanjutan/sertifikasi");
    return { ok: true, message: "Status diperbarui." };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "FORBIDDEN") return { ok: false, message: "Peran Anda tidak berhak." };
    if (/row-level security/.test(m)) return { ok: false, message: "Anda tidak berhak mengubah status ini." };
    return { ok: false, message: m };
  }
}

/**
 * AI-21 / D-06 · lampirkan dokumen bukti K1–K7.
 *
 * Sebelum ini status bukti riwayat lahan bisa diubah menjadi "Tersertifikasi"
 * tanpa satu berkas pun — dan hitungan "n/7 lengkap" di layar memakai status itu.
 * Angka tersebut yang dipakai mengklaim pengakuan retroaktif masa konversi 36
 * bulan (docs/10 §4.2), jadi "lengkap" tanpa dokumen adalah klaim kepatuhan
 * tanpa bukti. Sekarang butuh dokumen sungguhan.
 *
 * Jalurnya SAMA dengan bukti pembelian: putEvidence() -> evidence_files ->
 * evidence_links, diunduh lewat /api/evidence/[id]. Itu jawaban pertanyaan
 * terbuka D-06; jalur kedua berarti dua tempat yang bisa berbeda soal RLS, hash,
 * dan storage.
 */
export async function attachOrganicEvidenceAction(_p: OrganicState, fd: FormData): Promise<OrganicState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };

    const itemCode = z.string().trim().min(1).max(10).safeParse(fd.get("itemCode"));
    if (!itemCode.success) return { ok: false, message: "Kode bukti tidak valid." };

    const file = fd.get("berkas");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "Pilih berkas buktinya dulu (JPG, PNG, WebP, HEIC, atau PDF)." };
    }

    const stored = await putEvidence(file, { companyId: ctx.companyId, kind: "organic-evidence" });
    await attachOrganicEvidence(ctx, {
      itemCode: itemCode.data,
      evidence: {
        fileName: stored.fileName,
        storagePath: stored.storagePath,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
      },
    });
    revalidatePath("/keberlanjutan/sertifikasi");
    return { ok: true, message: `Bukti "${stored.fileName}" dilampirkan.` };
  } catch (e) {
    // Batasan storage (ukuran/tipe) adalah pesan untuk pengguna, bukan galat server.
    if (e instanceof StorageError) return { ok: false, message: e.message };
    const m = e instanceof Error ? e.message : String(e);
    if (m === "FORBIDDEN") return { ok: false, message: "Peran Anda tidak berhak." };
    if (/row-level security/.test(m)) return { ok: false, message: "Anda tidak berhak melampirkan bukti di entitas ini." };
    return { ok: false, message: m };
  }
}
