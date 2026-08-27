"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  addBudgetPlanItem, createBudgetPlan, decideBudgetPlan, deleteBudgetPlanItem, submitBudgetPlan,
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
  volume: z.coerce.number().positive("Volume harus lebih dari 0").max(1e12),
  uomItemId: z.string().uuid().nullable().catch(null),
  unitPriceIdr: z.coerce.number().min(0, "Harga satuan tidak boleh negatif").max(1e15),
  note: z.string().trim().max(500).nullable().catch(null),
});

export async function addItemAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    // Penyusun DAN pemutus: rapat menyepakati finance boleh menambah baris
    // setelah RAB disetujui (mis. menyewa ahli hidrologi). Yang membatasi
    // KAPAN-nya bukan daftar peran ini, melainkan policy bpi_edit_insert.
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const uom = fd.get("uomItemId");
    const note = fd.get("note");
    const parsed = itemSchema.safeParse({
      planId: fd.get("planId"),
      phaseMonth: fd.get("phaseMonth"),
      costCategoryId: fd.get("costCategoryId"),
      description: fd.get("description"),
      itemKind: fd.get("itemKind") ?? "consumable",
      volume: fd.get("volume"),
      uomItemId: uom === null || String(uom).trim() === "" ? null : uom,
      unitPriceIdr: fd.get("unitPriceIdr"),
      note: note === null || String(note).trim() === "" ? null : note,
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

export async function deleteItemAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const id = z.string().uuid().safeParse(fd.get("id"));
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    if (!id.success || !planId.success) return { ok: false, message: "Baris tidak valid." };

    const n = await deleteBudgetPlanItem(ctx, id.data);
    revalidatePath(`/costing/rencana-anggaran/${planId.data}`);
    // rowCount 0 = policy bpi_edit_delete menyaringnya lewat USING, dan
    // penyaringan USING tidak melempar galat. Tanpa pesan ini, penghapusan
    // yang ditolak terlihat seperti penghapusan yang berhasil.
    return n === 0
      ? { ok: false, message: "Baris tidak bisa dihapus — RAB ini sudah diajukan atau bukan susunan Anda." }
      : { ok: true, message: "Komponen dihapus." };
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
