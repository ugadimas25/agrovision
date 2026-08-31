"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  addBudgetAssumption, addBudgetPlanItem, createBudgetPlan, decideBudgetPlan,
  setBudgetPlanItemActive, submitBudgetPlan, updateBudgetAssumptionValue,
} from "@/lib/repo/budgetPlan";

/**
 * Server Action modul Rencana Anggaran (RAB) — rapat Fadli 26 Agu 2026.
 *
 * Pembagian wewenangnya BUKAN diputuskan di sini, hanya diulang supaya pesannya
 * enak dibaca. Gerbang sebenarnya ada di database (migrasi 0060: policy
 * bp_writer_roles, bp_edit_gate, bpi_edit_*), yang tetap berlaku walau
 * requireRole di bawah ini terlewat — dan action bisa dipanggil POST langsung.
 *
 *   agronomist   menyusun, menyunting draft, mengajukan
 *   approver     memutuskan (finance), dan menambah baris setelah disetujui
 *   super_admin  keduanya
 *   creator      TIDAK menyentuh RAB — ia mencatat realisasi
 */

export type PlanState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

const PENYUSUN = ["agronomist", "super_admin"] as const;
const PEMUTUS = ["approver", "super_admin"] as const;

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
  if (raw === "UNAUTHENTICATED") return "Sesi berakhir. Silakan masuk kembali.";
  if (raw === "FORBIDDEN") return "Peran Anda tidak berhak melakukan ini.";
  if (/budget_plans_code_key|budget_plans_company_id_code_key/.test(raw)) {
    return "Kode RAB itu sudah dipakai di entitas ini.";
  }
  if (/melewati horizon/.test(raw)) return raw;   // pesan trigger 0060 sudah jelas
  if (/rejection_needs_reason/.test(raw)) return "Penolakan wajib menyertakan alasan.";
  if (/row-level security/.test(raw)) return "Anda tidak berhak mengubah RAB ini.";
  return raw;
}

const planSchema = z.object({
  code: z.string().trim().min(1, "Kode wajib diisi").max(60),
  name: z.string().trim().min(1, "Nama wajib diisi").max(200),
  // Luas boleh kosong: rapat memakai asumsi 100 ha, tapi asumsi belum tentu
  // sudah ada saat RAB mulai disusun. Kosong TIDAK diubah jadi 0 — nol hektar
  // adalah angka yang berarti "tidak ada lahan".
  areaHa: z.coerce.number().positive("Luas harus lebih dari 0").max(1e7).nullable().catch(null),
  horizonMonths: z.coerce.number().int().min(1).max(120),
  contingencyPct: z.coerce.number().min(0).max(100),
});

export async function createPlanAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole(...PENYUSUN);
    if (!ctx.companyId) {
      return { ok: false, message: "Pilih satu entitas dulu di pojok kanan atas — RAB selalu milik satu entitas." };
    }
    const raw = fd.get("areaHa");
    const parsed = planSchema.safeParse({
      code: fd.get("code"),
      name: fd.get("name"),
      areaHa: raw === null || String(raw).trim() === "" ? null : raw,
      horizonMonths: fd.get("horizonMonths") || 12,
      contingencyPct: fd.get("contingencyPct") ?? 5,
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await createBudgetPlan(ctx, parsed.data);
    revalidatePath("/costing/rencana-anggaran");
    return { ok: true, message: `RAB ${parsed.data.code} dibuat. Tambahkan komponen biayanya.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const itemSchema = z.object({
  planId: z.string().uuid(),
  phaseMonth: z.coerce.number().int().min(1, "Bulan ke- minimal 1").max(120),
  costCategoryId: z.string().uuid("Kategori biaya wajib dipilih"),
  description: z.string().trim().min(1, "Uraian wajib diisi").max(300),
  itemKind: z.enum(["consumable", "asset", "labor", "service"]),
  // Volume boleh 0/kosong bila diturunkan dari asumsi — trigger di database
  // yang mengisinya. Divalidasi ulang di refine() bawah.
  volume: z.coerce.number().min(0).max(1e12).catch(0),
  uomItemId: z.string().uuid().nullable().catch(null),
  unitPriceIdr: z.coerce.number().min(0, "Harga satuan tidak boleh negatif").max(1e15),
  note: z.string().trim().max(500).nullable().catch(null),
  // 0061, mengikuti 08_CAPEX_RAB pada model Banyumas.
  costKind: z.enum(["capex", "opex"]),
  stage: z.string().trim().max(80).nullable().catch(null),
  driver: z.string().trim().max(80).nullable().catch(null),
  sourceRef: z.string().trim().max(300).nullable().catch(null),
  // Sengaja TANPA default: menebak "medium" untuk baris yang belum ditelaah
  // membuat seluruh kolom keyakinan tidak berarti.
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null),
  excludeFromContingency: z.coerce.boolean().catch(false),
  // 0062: volume boleh diturunkan dari asumsi. Keduanya wajib berpasangan —
  // constraint bpi_basis_berpasangan menegakkan hal yang sama di database.
  basisCode: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/).nullable().catch(null),
  ratioPerBasis: z.coerce.number().positive().max(1e9).nullable().catch(null),
}).refine((v) => (v.basisCode === null) === (v.ratioPerBasis === null), {
  message: "Basis dan rasio harus diisi berpasangan", path: ["ratioPerBasis"],
}).refine((v) => v.basisCode !== null || v.volume > 0, {
  message: "Volume harus lebih dari 0, atau turunkan dari asumsi", path: ["volume"],
});

export async function addItemAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    // Penyusun DAN pemutus: rapat menyepakati finance boleh menambah baris
    // setelah RAB disetujui (mis. menyewa ahli hidrologi). Yang membatasi
    // KAPAN-nya bukan daftar peran ini, melainkan policy bpi_edit_insert.
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const uom = fd.get("uomItemId");
    const note = fd.get("note");
    const kosong = (v: FormDataEntryValue | null) =>
      v === null || String(v).trim() === "" ? null : v;
    const parsed = itemSchema.safeParse({
      planId: fd.get("planId"),
      phaseMonth: fd.get("phaseMonth"),
      costCategoryId: fd.get("costCategoryId"),
      description: fd.get("description"),
      itemKind: fd.get("itemKind") ?? "consumable",
      volume: fd.get("volume"),
      uomItemId: kosong(uom),
      unitPriceIdr: fd.get("unitPriceIdr"),
      note: kosong(note),
      costKind: fd.get("costKind") ?? "capex",
      stage: kosong(fd.get("stage")),
      driver: kosong(fd.get("driver")),
      sourceRef: kosong(fd.get("sourceRef")),
      confidence: kosong(fd.get("confidence")),
      excludeFromContingency: fd.get("excludeFromContingency") === "on",
      basisCode: kosong(fd.get("basisCode")),
      ratioPerBasis: kosong(fd.get("ratioPerBasis")),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await addBudgetPlanItem(ctx, parsed.data);
    revalidatePath(`/costing/rencana-anggaran/${parsed.data.planId}`);
    return { ok: true, message: "Komponen ditambahkan." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/**
 * Coret / hidupkan kembali satu baris — TIDAK menghapus.
 *
 * Mengikuti kolom `Aktif` di 17_Model_Fleksibel: "Aktif=0 mengeluarkan baris
 * dari total tanpa menghapus referensi". Baris yang dicoret finance minggu ini
 * bisa dihidupkan lagi bulan depan, dan pertanyaan "kenapa pos ini hilang?"
 * tetap punya jawaban di layar — bukan hanya di audit_log.
 */
export async function toggleItemAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const id = z.string().uuid().safeParse(fd.get("id"));
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    if (!id.success || !planId.success) return { ok: false, message: "Baris tidak valid." };
    const aktifkan = fd.get("aktifkan") === "1";

    const n = await setBudgetPlanItemActive(ctx, id.data, aktifkan);
    revalidatePath(`/costing/rencana-anggaran/${planId.data}`);
    // rowCount 0 = policy bpi_edit_update menyaringnya lewat USING, dan
    // penyaringan USING tidak melempar galat. Tanpa pesan ini, perubahan yang
    // ditolak terlihat seperti perubahan yang berhasil.
    if (n === 0) {
      return { ok: false, message: "Baris tidak bisa diubah — RAB ini sudah diajukan atau bukan susunan Anda." };
    }
    return { ok: true, message: aktifkan ? "Komponen dihidupkan kembali." : "Komponen dicoret dari total." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

export async function submitPlanAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole(...PENYUSUN);
    const id = z.string().uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, message: "RAB tidak valid." };

    const n = await submitBudgetPlan(ctx, id.data);
    revalidatePath("/costing/rencana-anggaran");
    revalidatePath(`/costing/rencana-anggaran/${id.data}`);
    return n === 0
      ? { ok: false, message: "Tidak bisa diajukan — statusnya bukan draft/ditolak, atau bukan susunan Anda." }
      : { ok: true, message: "RAB diajukan ke finance." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const decisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).optional(),
}).refine((v) => v.decision !== "rejected" || (v.reason && v.reason.length > 0), {
  message: "Penolakan wajib menyertakan alasan", path: ["reason"],
});

export async function decidePlanAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole(...PEMUTUS);
    const parsed = decisionSchema.safeParse({
      id: fd.get("id"),
      decision: fd.get("decision"),
      reason: fd.get("reason") ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    const n = await decideBudgetPlan(ctx, parsed.data.id, parsed.data.decision, parsed.data.reason ?? null);
    revalidatePath("/costing/rencana-anggaran");
    revalidatePath(`/costing/rencana-anggaran/${parsed.data.id}`);
    if (n === 0) return { ok: false, message: "Tidak bisa diputuskan — statusnya bukan menunggu keputusan." };
    return {
      ok: true,
      message: parsed.data.decision === "approved"
        ? "RAB disetujui. Ia menjadi acuan anggaran."
        : "RAB ditolak beserta alasannya. Agronomis bisa memperbaiki lalu mengajukan ulang.",
    };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const assumptionSchema = z.object({
  planId: z.string().uuid(),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/,
    "Kode hanya huruf kecil, angka, dan garis bawah — mis. net_ha"),
  label: z.string().trim().min(1, "Nama asumsi wajib diisi").max(120),
  // Nol DIIZINKAN dan disengaja: di model Banyumas harga akuisisi lahan adalah
  // 0 dengan sumber "OPEN". Yang membedakannya dari "belum diisi" adalah
  // source_ref-nya, bukan angkanya.
  value: z.coerce.number().min(0).max(1e15),
  unit: z.string().trim().max(30).nullable().catch(null),
  sourceRef: z.string().trim().max(300).nullable().catch(null),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null),
  note: z.string().trim().max(500).nullable().catch(null),
});

export async function addAssumptionAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const kosong = (v: FormDataEntryValue | null) =>
      v === null || String(v).trim() === "" ? null : v;
    const parsed = assumptionSchema.safeParse({
      planId: fd.get("planId"),
      code: fd.get("code"),
      label: fd.get("label"),
      value: fd.get("value"),
      unit: kosong(fd.get("unit")),
      sourceRef: kosong(fd.get("sourceRef")),
      confidence: kosong(fd.get("confidence")),
      note: kosong(fd.get("note")),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await addBudgetAssumption(ctx, parsed.data);
    revalidatePath(`/costing/rencana-anggaran/${parsed.data.planId}`);
    return { ok: true, message: `Asumsi ${parsed.data.code} ditambahkan.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/**
 * Ubah nilai satu asumsi — dan dengan itu, seluruh baris yang menurunkannya.
 *
 * Efek berantainya dikerjakan trigger database (0062), bukan di sini: kalau
 * perkalian ulang hidup di TypeScript, satu jalur tulis yang lupa memanggilnya
 * akan meninggalkan RAB yang setengah berubah — dan RAB setengah berubah lebih
 * berbahaya daripada yang salah seluruhnya, karena ia terlihat konsisten.
 */
export async function updateAssumptionAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const id = z.string().uuid().safeParse(fd.get("id"));
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    const value = z.coerce.number().min(0).max(1e15).safeParse(fd.get("value"));
    if (!id.success || !planId.success) return { ok: false, message: "Asumsi tidak valid." };
    if (!value.success) return { ok: false, message: "Nilai asumsi tidak valid." };

    const n = await updateBudgetAssumptionValue(ctx, id.data, value.data);
    revalidatePath(`/costing/rencana-anggaran/${planId.data}`);
    return n === 0
      ? { ok: false, message: "Asumsi tidak bisa diubah — RAB ini sudah diajukan atau bukan susunan Anda." }
      : { ok: true, message: "Asumsi diperbarui. Baris yang memakainya ikut dihitung ulang." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}
