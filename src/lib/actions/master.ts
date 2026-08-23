"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createFertilizerType,
  createMasterItem,
  deactivateMasterItem,
  updateMasterItem,
} from "@/lib/repo/master";

/**
 * Server Actions untuk master data.
 *
 * Dokumentasi Next.js 16 memperingatkan: Server Function bisa dicapai lewat
 * POST langsung, bukan hanya lewat UI. Karena itu setiap action di sini
 * memanggil requireRole() lebih dulu — tanpa kecuali. RLS di database adalah
 * lapis kedua, bukan pengganti.
 */

export type ActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

const idSchema = z.string().uuid("ID tidak valid");

const codeSchema = z
  .string()
  .trim()
  .min(1, "Kode wajib diisi")
  .max(40, "Kode maksimal 40 karakter")
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Kode hanya huruf kapital, angka, _ dan -");

const nameSchema = z.string().trim().min(1, "Nama wajib diisi").max(160, "Nama maksimal 160 karakter");

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === "UNAUTHENTICATED") return "Sesi berakhir. Silakan masuk kembali.";
  if (raw === "FORBIDDEN") return "Peran Anda tidak berhak melakukan ini.";
  // Constraint database diterjemahkan ke bahasa pengguna, bukan ditampilkan mentah.
  if (/master_items_master_type_id_company_id_code_key|mi_global_uniq/.test(raw)) {
    return "Kode itu sudah dipakai pada tipe master ini.";
  }
  if (/fertilizer_types_company_id_code_key|ft_global_uniq/.test(raw)) {
    return "Kode jenis pupuk itu sudah dipakai.";
  }
  if (/row-level security/.test(raw)) return "Anda tidak berhak menulis data ini.";
  if (/tipe sistem/.test(raw)) return "Tipe master sistem tidak boleh diubah atau dihapus.";
  return raw;
}

const createItemSchema = z.object({
  masterTypeCode: z.string().trim().min(1, "Tipe master wajib dipilih"),
  code: codeSchema,
  name: nameSchema,
  parentId: z.union([idSchema, z.literal("")]).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export async function createMasterItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin");

    // Mode "semua entitas" (companyId null) tidak boleh menulis master item:
    // repo menulis company_id = ctx.companyId, dan policy
    // master_items_global_admin_only MELOLOSKAN super_admin dengan company_id
    // NULL — item itu diam-diam menjadi GLOBAL dan terlihat oleh setiap tenant.
    // Pola guard ini sama dengan createExpenditureAction/createBlockAction.
    if (!ctx.companyId) {
      return { ok: false, message: 'Pilih satu entitas dulu di kanan atas — master data tidak bisa ditulis pada mode "semua entitas".' };
    }

    const parsed = createItemSchema.safeParse({
      masterTypeCode: formData.get("masterTypeCode"),
      code: formData.get("code"),
      name: formData.get("name"),
      parentId: formData.get("parentId") ?? "",
      sortOrder: formData.get("sortOrder") || 0,
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }

    await createMasterItem(ctx, {
      masterTypeCode: parsed.data.masterTypeCode,
      code: parsed.data.code,
      name: parsed.data.name,
      parentId: parsed.data.parentId || null,
      sortOrder: parsed.data.sortOrder ?? 0,
    });

    revalidatePath("/pengaturan/master-data");
    // Dropdown di seluruh form ikut menyegar tanpa perubahan kode — inti AT1.
    revalidatePath("/costing/pengeluaran");
    revalidatePath("/operasional/pemupukan");

    return { ok: true, message: `"${parsed.data.name}" ditambahkan.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const updateItemSchema = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

export async function updateMasterItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin");

    // Entitas wajib dipilih. Pada mode "semua entitas" RLS ikut meloloskan baris
    // GLOBAL (mi_tenant: `company_id IS NULL OR ...`), jadi satu UPDATE bisa
    // mengubah label untuk SETIAP tenant secara retroaktif. UI sudah tidak
    // menawarkan tombolnya (MasterDataManager: item.isGlobal), ini penutup untuk
    // pemanggilan POST langsung.
    if (!ctx.companyId) {
      return { ok: false, message: 'Pilih satu entitas dulu di kanan atas — perubahan master data tidak bisa dilakukan pada mode "semua entitas".' };
    }

    const parsed = updateItemSchema.safeParse({
      id: formData.get("id"),
      name: formData.get("name") ?? undefined,
      // `||`, BUKAN `??`: input number yang dikosongkan mengirim "", dan
      // z.coerce.number() mengubah "" menjadi 0 — urutan akan diam-diam
      // di-reset ke 0 padahal pengguna tidak berniat mengubahnya.
      sortOrder: formData.get("sortOrder") || undefined,
      isActive: formData.get("isActive") ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }

    await updateMasterItem(ctx, parsed.data.id, {
      name: parsed.data.name,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive === undefined ? undefined : parsed.data.isActive === "true",
    });

    revalidatePath("/pengaturan/master-data");
    // Nama & status ikut menentukan isi dropdown di seluruh form — sama seperti
    // pada createMasterItemAction, bukan hanya layar pengeluaran.
    revalidatePath("/costing/pengeluaran");
    revalidatePath("/operasional/pemupukan");
    return { ok: true, message: "Perubahan disimpan." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

export async function deactivateMasterItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin");
    const parsed = idSchema.safeParse(formData.get("id"));
    if (!parsed.success) return { ok: false, message: "ID tidak valid." };

    // Dinonaktifkan, tidak dihapus: baris master bisa sudah dirujuk transaksi lama.
    await deactivateMasterItem(ctx, parsed.data);

    revalidatePath("/pengaturan/master-data");
    revalidatePath("/costing/pengeluaran");
    return { ok: true, message: "Item dinonaktifkan. Data lama yang merujuknya tetap utuh." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const fertilizerSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  kind: z.enum(["single", "compound", "organic"], { message: "Jenis wajib dipilih" }),
  nPct: z.coerce.number().min(0).max(100).optional(),
  p2o5Pct: z.coerce.number().min(0).max(100).optional(),
  k2oPct: z.coerce.number().min(0).max(100).optional(),
});

export async function createFertilizerTypeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin");

    // Mode "semua entitas" (companyId null) tidak boleh menulis master item:
    // repo menulis company_id = ctx.companyId, dan policy
    // master_items_global_admin_only MELOLOSKAN super_admin dengan company_id
    // NULL — item itu diam-diam menjadi GLOBAL dan terlihat oleh setiap tenant.
    // Pola guard ini sama dengan createExpenditureAction/createBlockAction.
    if (!ctx.companyId) {
      return { ok: false, message: 'Pilih satu entitas dulu di kanan atas — master data tidak bisa ditulis pada mode "semua entitas".' };
    }

    const parsed = fertilizerSchema.safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      kind: formData.get("kind"),
      nPct: formData.get("nPct") || undefined,
      p2o5Pct: formData.get("p2o5Pct") || undefined,
      k2oPct: formData.get("k2oPct") || undefined,
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }

    await createFertilizerType(ctx, {
      code: parsed.data.code,
      name: parsed.data.name,
      kind: parsed.data.kind,
      nPct: parsed.data.nPct ?? null,
      p2o5Pct: parsed.data.p2o5Pct ?? null,
      k2oPct: parsed.data.k2oPct ?? null,
    });

    revalidatePath("/pengaturan/master-data");
    revalidatePath("/operasional/pemupukan");
    return { ok: true, message: `Jenis pupuk "${parsed.data.name}" ditambahkan.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}
