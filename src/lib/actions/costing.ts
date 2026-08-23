"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requireRole } from "@/lib/session";
import { putEvidence, StorageError } from "@/lib/storage";
import {
  createBudget,
  createExpenditure,
  createFiscalPeriod,
  decideExpenditure,
  decideRecord,
  submitExpenditure,
  updateExpenditure,
} from "@/lib/repo/costing";
import { createBlock } from "@/lib/repo/blocks";

export type ActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (e instanceof StorageError) return raw;
  if (raw === "UNAUTHENTICATED") return "Sesi berakhir. Silakan masuk kembali.";
  if (raw === "FORBIDDEN") return "Peran Anda tidak berhak melakukan ini.";
  if (/ct_overhead_scope/.test(raw)) {
    return "Biaya overhead tidak boleh terikat blok, dan biaya per-blok wajib memilih blok.";
  }
  if (/ct_block_same_company/.test(raw)) return "Blok itu bukan milik entitas aktif Anda.";
  if (/ct_period_same_company/.test(raw)) return "Periode itu bukan milik entitas aktif Anda.";
  if (/ct_rejection_needs_reason/.test(raw)) return "Penolakan wajib menyertakan alasan.";
  if (/blocks_company_id_code_key|blocks_company_id_code/.test(raw)) {
    return "Kode blok itu sudah dipakai di entitas ini.";
  }
  if (/invalid GeoJSON|parse error|ST_GeomFromGeoJSON/i.test(raw)) {
    return "GeoJSON tidak valid. Tempelkan objek geometry Polygon/MultiPolygon.";
  }
  if (/budgets_grain_uniq/.test(raw)) {
    return "Anggaran untuk periode, kategori, dan lingkup itu sudah ada. Ubah yang sudah ada, jangan buat ganda.";
  }
  if (/budgets_scope_coherent/.test(raw)) return "Lingkup anggaran tidak konsisten dengan pilihan estate/blok.";
  if (/budgets_(estate|block|period)_same_company/.test(raw)) {
    return "Estate, blok, atau periode itu bukan milik entitas aktif Anda.";
  }
  if (/fiscal_periods_company_id_code_key/.test(raw)) return "Kode periode itu sudah dipakai.";
  if (/row-level security/.test(raw)) return "Anda tidak berhak menulis data ini.";
  return raw;
}

// ---------------------------------------------------------------------------
// Pengeluaran
// ---------------------------------------------------------------------------

const money = z.coerce
  .number({ message: "Harus berupa angka" })
  .min(0, "Tidak boleh negatif")
  .max(1e15, "Nilai terlalu besar");

const expenditureSchema = z
  .object({
    isOverhead: z.enum(["true", "false"]).default("false"),
    blockId: z.union([z.string().uuid("Blok tidak valid"), z.literal("")]).optional(),
    costCategoryId: z.string().uuid("Kategori biaya wajib dipilih"),
    costCenterId: z.union([z.string().uuid(), z.literal("")]).optional(),
    supplierId: z.union([z.string().uuid(), z.literal("")]).optional(),
    uomItemId: z.union([z.string().uuid(), z.literal("")]).optional(),
    fiscalPeriodId: z.union([z.string().uuid(), z.literal("")]).optional(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal wajib diisi"),
    quantity: z.union([money, z.literal("")]).optional(),
    unitPriceIdr: z.union([money, z.literal("")]).optional(),
    amountIdr: money.refine((v) => v > 0, "Total biaya harus lebih dari 0"),
    externalDocumentNo: z.string().trim().max(80).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((d) => (d.isOverhead === "true" ? !d.blockId : Boolean(d.blockId)), {
    message: "Biaya per-blok wajib memilih blok; biaya overhead tidak boleh punya blok",
    path: ["blockId"],
  });

/**
 * Catat pengeluaran manual.
 *
 * Formnya (ExpenditureForm.tsx) tidak terpasang di UI sejak model refleksi, TAPI
 * action ini sengaja dipertahankan: AI-52 akan memakainya kembali untuk overhead
 * & upah, dan ia satu-satunya pemanggil putEvidence() di repo ini.
 *
 * Aman meski bisa dipanggil POST langsung: requireRole menolak viewer, mode
 * "semua entitas" ditolak, bukti pembelian wajib, dan hasilnya hanya draft --
 * tidak ada nilai yang masuk laporan sebelum melewati approval.
 */
export async function createExpenditureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    // creator dan approver boleh membuat (approver adalah superset creator,
    // concept:190). viewer tidak.
    const ctx = await requireRole("creator", "approver", "super_admin");

    if (!ctx.companyId) {
      return {
        ok: false,
        message: 'Pilih satu entitas dulu di kanan atas — pengeluaran tidak bisa dicatat pada mode "semua entitas".',
      };
    }

    const parsed = expenditureSchema.safeParse({
      isOverhead: formData.get("isOverhead") ?? "false",
      blockId: formData.get("blockId") ?? "",
      costCategoryId: formData.get("costCategoryId"),
      costCenterId: formData.get("costCenterId") ?? "",
      supplierId: formData.get("supplierId") ?? "",
      uomItemId: formData.get("uomItemId") ?? "",
      fiscalPeriodId: formData.get("fiscalPeriodId") ?? "",
      transactionDate: formData.get("transactionDate"),
      quantity: formData.get("quantity") || "",
      unitPriceIdr: formData.get("unitPriceIdr") || "",
      amountIdr: formData.get("amountIdr"),
      externalDocumentNo: formData.get("externalDocumentNo") ?? "",
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }

    // Bukti pembelian WAJIB (concept:160) -- ditegakkan di sini, bukan hanya
    // dengan atribut `required` di HTML yang mudah dilewati.
    const file = formData.get("evidence");
    if (!(file instanceof File) || file.size === 0) {
      return {
        ok: false,
        message: "Bukti pembelian wajib diunggah (foto struk atau invoice).",
        fieldErrors: { evidence: "Pilih satu berkas" },
      };
    }

    const stored = await putEvidence(file, { companyId: ctx.companyId, kind: "purchase-proof" });

    const d = parsed.data;
    await createExpenditure(ctx, {
      blockId: d.isOverhead === "true" ? null : (d.blockId as string),
      isOverhead: d.isOverhead === "true",
      costCategoryId: d.costCategoryId,
      costCenterId: d.costCenterId || null,
      supplierId: d.supplierId || null,
      uomItemId: d.uomItemId || null,
      fiscalPeriodId: d.fiscalPeriodId || null,
      transactionDate: d.transactionDate,
      quantity: typeof d.quantity === "number" ? d.quantity : null,
      unitPriceIdr: typeof d.unitPriceIdr === "number" ? d.unitPriceIdr : null,
      amountIdr: d.amountIdr,
      externalDocumentNo: d.externalDocumentNo || null,
      note: d.note || null,
      evidence: stored,
    });

    revalidatePath("/costing/pengeluaran");
    revalidatePath("/laporan/keuangan");
    revalidatePath("/dashboard");

    return { ok: true, message: "Pengeluaran tersimpan sebagai draft. Ajukan agar masuk approval." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const idOnly = z.string().uuid("ID tidak valid");

const updateExpSchema = z.object({
  id: idOnly,
  costCategoryId: z.string().uuid("Kategori biaya wajib dipilih"),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal wajib diisi"),
  amountIdr: money.refine((v) => v > 0, "Total biaya harus lebih dari 0"),
  quantity: z.union([money, z.literal("")]).optional(),
  unitPriceIdr: z.union([money, z.literal("")]).optional(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Perbaiki pengeluaran draft/ditolak (AI-11, catatan 6.5).
 *
 * Record yang ditolak sebelumnya jadi jalan buntu: alasannya terbaca, tapi tidak
 * ada cara memperbaikinya. Batas siapa-boleh-apa ditegakkan policy ct_role_split
 * di database; di sini hanya requireRole + pesan yang bisa dibaca manusia.
 */
export async function updateExpenditureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) {
      return { ok: false, message: 'Pilih satu entitas dulu di kanan atas — perubahan tidak bisa dilakukan pada mode "semua entitas".' };
    }
    const parsed = updateExpSchema.safeParse({
      id: formData.get("id"),
      costCategoryId: formData.get("costCategoryId"),
      transactionDate: formData.get("transactionDate"),
      amountIdr: formData.get("amountIdr"),
      quantity: formData.get("quantity") || "",
      unitPriceIdr: formData.get("unitPriceIdr") || "",
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }
    const d = parsed.data;
    const n = await updateExpenditure(ctx, d.id, {
      costCategoryId: d.costCategoryId,
      transactionDate: d.transactionDate,
      amountIdr: d.amountIdr,
      quantity: typeof d.quantity === "number" ? d.quantity : null,
      unitPriceIdr: typeof d.unitPriceIdr === "number" ? d.unitPriceIdr : null,
      note: d.note || null,
    });
    if (n === 0) {
      return { ok: false, message: "Tidak bisa diubah — hanya record milik Anda yang masih draft atau ditolak yang boleh diperbaiki." };
    }
    revalidatePath("/costing/pengeluaran");
    return { ok: true, message: "Perubahan disimpan sebagai draft. Ajukan lagi agar masuk approval." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/** Ajukan pengeluaran ke approval. TERPAKAI: SubmitButton.tsx di layar Pengeluaran. */
export async function submitExpenditureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    const parsed = idOnly.safeParse(formData.get("id"));
    if (!parsed.success) return { ok: false, message: "ID tidak valid." };

    const n = await submitExpenditure(ctx, parsed.data);
    if (n === 0) {
      return { ok: false, message: "Tidak bisa diajukan — statusnya bukan draft/ditolak, atau bukan milik Anda." };
    }

    revalidatePath("/costing/pengeluaran");
    revalidatePath("/approval");
    return { ok: true, message: "Diajukan untuk approval." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const decisionSchema = z
  .object({
    moduleKey: z.string().trim().min(1),
    id: idOnly,
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.decision !== "rejected" || (d.reason && d.reason.length > 0), {
    message: "Penolakan wajib menyertakan alasan",
    path: ["reason"],
  });

/**
 * moduleKey (nilai app.v_pending_approvals.module_key — sama dengan daftar CASE
 * di app.decide_record(), migrasi 0034) -> path halaman modul asalnya.
 *
 * Kuncinya TUNGGAL ('harvest_record'). Ini BERBEDA dari MODULE_PATH di
 * actions/operational.ts yang ber-kunci JAMAK nama tabel ('harvest_records'),
 * dan keduanya TIDAK boleh dipakai bergantian: kunci yang tidak cocok membuat
 * revalidatePath() menerima undefined lalu melempar TypeError SESUDAH keputusan
 * ter-commit di database -- approver melihat "gagal" untuk keputusan yang
 * sebenarnya berhasil, lalu menekan Setujui lagi dan mendapat "statusnya bukan
 * menunggu approval". Itu gejala BUG-01/TIKET-03 yang sudah pernah ditutup.
 */
const DECIDE_PATH: Record<string, string> = {
  cost_transaction: "/costing/pengeluaran",
  fertilizer_application: "/operasional/pemupukan",
  land_preparation: "/operasional/persiapan-lahan",
  land_suitability_assessment: "/operasional/kesesuaian-lahan",
  pruning_record: "/operasional/pruning",
  nursery_inspection: "/nursery",
  dbh_measurement: "/keberlanjutan/karbon",
  survey_submission: "/survei",
  weeding_record: "/aktivitas/weeding",
  spraying_record: "/aktivitas/spraying",
  harvest_record: "/aktivitas/panen",
};

export async function decideExpenditureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("approver", "super_admin");

    const parsed = decisionSchema.safeParse({
      moduleKey: formData.get("moduleKey") ?? "cost_transaction",
      id: formData.get("id"),
      decision: formData.get("decision"),
      reason: formData.get("reason") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }

    // Satu pintu untuk semua modul, bukan hanya pengeluaran.
    const n = await decideRecord(
      ctx, parsed.data.moduleKey, parsed.data.id, parsed.data.decision, parsed.data.reason);
    if (n === 0) return { ok: false, message: "Tidak bisa diputuskan — statusnya bukan menunggu approval." };

    // Keputusan approval mengubah angka laporan: record rejected dikecualikan
    // dari v_block_cost_summary dan v_budget_vs_actual.
    revalidatePath("/approval");
    revalidatePath("/costing/pengeluaran");
    revalidatePath("/laporan/keuangan");
    revalidatePath("/laporan/operasional");
    revalidatePath("/dashboard");
    // Halaman modul asal -- tanpa ini status di modulnya sendiri masih tampil
    // lama (setujui Panen, buka /aktivitas/panen: masih "Diajukan"). Defensif:
    // modul baru di decide_record() tidak boleh menggagalkan keputusan yang
    // sudah tersimpan hanya karena petanya belum diperbarui.
    const modulePath = DECIDE_PATH[parsed.data.moduleKey];
    if (modulePath) revalidatePath(modulePath);

    return {
      ok: true,
      message: parsed.data.decision === "approved"
        ? "Disetujui. Nilainya kini masuk perhitungan laporan."
        : "Ditolak. Nilainya dikeluarkan dari perhitungan laporan.",
    };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Blok -- prasyarat pengeluaran per-blok
// ---------------------------------------------------------------------------

const blockSchema = z.object({
  estateId: z.string().uuid("Estate wajib dipilih"),
  code: z.string().trim().min(1, "Kode blok wajib diisi").max(40),
  name: z.string().trim().max(160).optional(),
  plantingYear: z.union([z.coerce.number().int().min(1900).max(2100), z.literal("")]).optional(),
  boundarySource: z.enum([
    "gps_survey", "drone_ortho", "shapefile_import", "manual_digitize", "legacy_document",
  ]),
  geojson: z.string().trim().optional(),
});

export async function createBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) {
      return { ok: false, message: 'Pilih satu entitas dulu di kanan atas.' };
    }

    const parsed = blockSchema.safeParse({
      estateId: formData.get("estateId"),
      code: formData.get("code"),
      name: formData.get("name") ?? "",
      plantingYear: formData.get("plantingYear") || "",
      boundarySource: formData.get("boundarySource"),
      geojson: formData.get("geojson") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }

    let geojson: string | null = parsed.data.geojson || null;
    if (geojson) {
      // Divalidasi di sini supaya pesannya bisa dimengerti; PostGIS akan
      // menolaknya juga, tapi errornya tidak untuk dibaca pengguna.
      try {
        const obj = JSON.parse(geojson) as { type?: string; geometry?: unknown };
        // Terima Feature maupun geometry mentah -- pengguna sering menempel Feature.
        const geom = obj?.type === "Feature" ? obj.geometry : obj;
        const t = (geom as { type?: string })?.type;
        if (t !== "Polygon" && t !== "MultiPolygon") {
          return {
            ok: false,
            message: `Geometry harus Polygon atau MultiPolygon (diberikan: ${t ?? "tidak dikenal"}).`,
            fieldErrors: { geojson: "Tipe geometry tidak sesuai" },
          };
        }
        geojson = JSON.stringify(geom);
      } catch {
        return {
          ok: false,
          message: "GeoJSON tidak bisa dibaca. Pastikan JSON-nya valid.",
          fieldErrors: { geojson: "JSON tidak valid" },
        };
      }
    }

    const { overlaps } = await createBlock(ctx, {
      estateId: parsed.data.estateId,
      code: parsed.data.code,
      name: parsed.data.name || null,
      plantingYear: typeof parsed.data.plantingYear === "number" ? parsed.data.plantingYear : null,
      boundarySource: parsed.data.boundarySource,
      geojson,
    });

    revalidatePath("/operasional/blok");
    revalidatePath("/costing/pengeluaran");

    const base = geojson
      ? `Blok "${parsed.data.code}" dibuat dengan polygon.`
      : `Blok "${parsed.data.code}" dibuat tanpa polygon — bisa didigitasi nanti.`;

    return {
      ok: true,
      message: overlaps > 0
        ? `${base} ⚠️ Terdeteksi ${overlaps} tumpang tindih dengan blok lain — perlu direview, blok tetap tersimpan.`
        : base,
    };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/** Dipakai layar yang butuh konteks tanpa menulis apa pun. */
export async function currentContext() {
  return requireContext();
}

// ---------------------------------------------------------------------------
// Periode fiskal & anggaran
// ---------------------------------------------------------------------------

const periodSchema = z
  .object({
    code: z.string().trim().min(1, "Kode wajib diisi").max(40),
    name: z.string().trim().min(1, "Nama wajib diisi").max(160),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal mulai wajib"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal selesai wajib"),
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["endsOn"],
  });

export async function createFiscalPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    // Periode fiskal adalah konfigurasi, bukan data operasional.
    const ctx = await requireRole("super_admin", "approver");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };

    const parsed = periodSchema.safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      startsOn: formData.get("startsOn"),
      endsOn: formData.get("endsOn"),
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }

    await createFiscalPeriod(ctx, parsed.data);
    revalidatePath("/costing/anggaran");
    revalidatePath("/costing/pengeluaran");
    revalidatePath("/laporan/keuangan");
    return { ok: true, message: `Periode "${parsed.data.name}" dibuat.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const budgetSchema = z
  .object({
    fiscalPeriodId: z.string().uuid("Periode wajib dipilih"),
    costCategoryId: z.string().uuid("Kategori biaya wajib dipilih"),
    scopeType: z.enum(["company", "estate", "block"]),
    estateId: z.union([z.string().uuid(), z.literal("")]).optional(),
    blockId: z.union([z.string().uuid(), z.literal("")]).optional(),
    amountIdr: money.refine((v) => v > 0, "Nilai anggaran harus lebih dari 0"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.scopeType !== "estate" || Boolean(d.estateId), {
    message: "Lingkup estate wajib memilih estate", path: ["estateId"],
  })
  .refine((d) => d.scopeType !== "block" || Boolean(d.blockId), {
    message: "Lingkup blok wajib memilih blok", path: ["blockId"],
  });

export async function createBudgetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin", "approver");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };

    const parsed = budgetSchema.safeParse({
      fiscalPeriodId: formData.get("fiscalPeriodId"),
      costCategoryId: formData.get("costCategoryId"),
      scopeType: formData.get("scopeType") ?? "company",
      estateId: formData.get("estateId") ?? "",
      blockId: formData.get("blockId") ?? "",
      amountIdr: formData.get("amountIdr"),
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid",
               fieldErrors: fieldErrors(parsed.error) };
    }

    await createBudget(ctx, {
      fiscalPeriodId: parsed.data.fiscalPeriodId,
      costCategoryId: parsed.data.costCategoryId,
      scopeType: parsed.data.scopeType,
      estateId: parsed.data.estateId || null,
      blockId: parsed.data.blockId || null,
      amountIdr: parsed.data.amountIdr,
      note: parsed.data.note || null,
    });

    revalidatePath("/costing/anggaran");
    revalidatePath("/laporan/keuangan");
    return { ok: true, message: "Anggaran tersimpan. Realisasi dibandingkan otomatis." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}
