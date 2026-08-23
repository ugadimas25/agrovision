"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { createChemical, createEquipment } from "@/lib/repo/agriInput";

export type ActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) { const k = String(i.path[0] ?? "_"); if (!out[k]) out[k] = i.message; }
  return out;
}
function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === "UNAUTHENTICATED") return "Sesi berakhir.";
  if (raw === "FORBIDDEN") return "Peran Anda tidak berhak.";
  if (/duplicate key|unique/i.test(raw)) return "Kode sudah dipakai di entitas ini.";
  if (/row-level security/.test(raw)) return "Anda tidak berhak menulis di entitas ini.";
  return raw;
}
const optNum = z.union([z.coerce.number().min(0), z.literal("")]).optional();
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

const chemSchema = z.object({
  code: z.string().trim().min(1, "Kode wajib").max(20),
  name: z.string().trim().min(1, "Nama wajib").max(120),
  category: z.enum(["pupuk", "pestisida", "herbisida", "fungisida", "insektisida"]),
  isOrganic: z.string().optional(),
  unit: z.string().trim().min(1).max(20),
  // stockQty dihapus dari skema: sejak 0043 stok hanya lahir dari buku besar
  // mutasi, dan 'in'/'adjustment' adalah wewenang super_admin (§17 Keputusan 1).
  // Katalog baru mulai dari nol.
  reorderLevel: optNum,
  recPhase: z.union([z.enum(["vegetatif", "generatif", "pemulihan"]), z.literal("")]).optional(),
  recNote: z.string().trim().max(300).optional(),
});

export async function createChemicalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = chemSchema.safeParse({
      code: fd.get("code"), name: fd.get("name"), category: fd.get("category"),
      isOrganic: String(fd.get("isOrganic") ?? ""), unit: fd.get("unit") || "kg",
      reorderLevel: fd.get("reorderLevel") || "", recPhase: fd.get("recPhase") ?? "", recNote: fd.get("recNote") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    await createChemical(ctx, {
      code: parsed.data.code, name: parsed.data.name, category: parsed.data.category,
      isOrganic: parsed.data.isOrganic === "organik", unit: parsed.data.unit,
      reorderLevel: numOrNull(parsed.data.reorderLevel), recPhase: parsed.data.recPhase || null, recNote: parsed.data.recNote || null,
    });
    revalidatePath("/agri-input/chemical");
    return { ok: true, message: "Item chemical tersimpan." };
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

const equipSchema = z.object({
  code: z.string().trim().min(1, "Kode wajib").max(20),
  name: z.string().trim().min(1, "Nama wajib").max(120),
  category: z.enum(["alat", "kendaraan", "drone", "mesin"]),
  purchasePriceIdr: optNum,
  usageFreq: z.string().trim().max(60).optional(),
  fuelType: z.union([z.enum(["solar", "bensin", "listrik", "tidak_ada"]), z.literal("")]).optional(),
  fuelPerHour: optNum,
  note: z.string().trim().max(300).optional(),
});

export async function createEquipmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = equipSchema.safeParse({
      code: fd.get("code"), name: fd.get("name"), category: fd.get("category"),
      purchasePriceIdr: fd.get("purchasePriceIdr") || "", usageFreq: fd.get("usageFreq") ?? "",
      fuelType: fd.get("fuelType") ?? "", fuelPerHour: fd.get("fuelPerHour") || "", note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    await createEquipment(ctx, {
      code: parsed.data.code, name: parsed.data.name, category: parsed.data.category,
      purchasePriceIdr: numOrNull(parsed.data.purchasePriceIdr), usageFreq: parsed.data.usageFreq || null,
      fuelType: parsed.data.fuelType || null, fuelPerHour: numOrNull(parsed.data.fuelPerHour), note: parsed.data.note || null,
    });
    revalidatePath("/agri-input/equipment");
    return { ok: true, message: "Item equipment tersimpan." };
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}
