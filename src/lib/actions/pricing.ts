"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { createPriceRow, driverOptions, priceCodeExists, publishPriceRate, updatePriceMeta } from "@/lib/repo/pricing";
import { todayInOperationalZone } from "@/lib/date";

export type PriceState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

const schema = z.object({
  // Kode, BUKAN id baris: penerbitan versi bekerja pada kode tarif — baris lama
  // ditutup, baris baru lahir (migrasi 0041).
  code: z.string().trim().min(1).max(60),
  rateIdr: z.coerce.number().min(0).max(1e15),
});

export async function setPriceRateAction(_p: PriceState, fd: FormData): Promise<PriceState> {
  try {
    // super_admin SAJA (§17 Keputusan 3): tarif adalah pengendali seluruh angka
    // keuangan. app.publish_price() menegakkan hal yang sama di database, jadi
    // ini lapis luar yang membuat pesannya enak dibaca — bukan gerbangnya.
    const ctx = await requireRole("super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu." };

    const parsed = schema.safeParse({ code: fd.get("code"), rateIdr: fd.get("rateIdr") });
    if (!parsed.success) return { ok: false, message: "Tarif tidak valid." };

    await publishPriceRate(ctx, {
      code: parsed.data.code,
      rateIdr: parsed.data.rateIdr,
      berlakuDari: todayInOperationalZone(),
    });
    revalidatePath("/costing/refleksi");
    revalidatePath("/dashboard/financial");
    return { ok: true, message: "Tarif baru diterbitkan. Nilai historis tidak berubah." };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "FORBIDDEN") return { ok: false, message: "Hanya super admin yang bisa menerbitkan tarif." };
    if (/row-level security/.test(m)) return { ok: false, message: "Anda tidak berhak mengubah tarif ini." };
    return { ok: false, message: m };
  }
}

// ---------------------------------------------------------------------------
// AI-44a · Tambah baris tarif baru (K-09 §19)
//
// Sebelum ini tidak ada jalur create SAMA SEKALI: `INSERT INTO app.price_list`
// hanya ada di db/seed-demo.mjs, jadi setiap tarif baru menuntut migrasi. Itu
// yang membuat AI-44a berstatus prasyarat K-03 (harga per grade = satu baris
// revenue per grade).
//
// Field yang KEKAL menurut K-09 (code, kind, driver) hanya bisa ditetapkan di
// sini — sesudah baris lahir, salah isi berarti baris baru + baris lama
// dinonaktifkan. Karena itu validasinya ketat dan pesannya menyebut akibatnya.
// ---------------------------------------------------------------------------

const DRIVER_VALUES = driverOptions().map((d) => d.value);

const createSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, "Kode wajib, minimal 2 karakter")
      .max(60, "Kode maksimal 60 karakter")
      // Kode dipakai app.price_for_driver dan REVENUE_CODE sebagai kunci, dan
      // KEKAL sesudah baris lahir. Dibatasi supaya tidak ada spasi/aksen yang
      // membuat pencocokan kode meleset tanpa terlihat.
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Kode hanya huruf kapital, angka, dan tanda hubung (mis. REV-DUR-B)"),
    kind: z.enum(["cost", "revenue"], { message: "Pilih jenis: biaya atau revenue" }),
    category: z.string().trim().min(2, "Kategori wajib").max(120, "Kategori maksimal 120 karakter"),
    unit: z.string().trim().min(1, "Satuan wajib").max(30, "Satuan maksimal 30 karakter"),
    rateIdr: z.coerce.number({ message: "Tarif wajib angka" }).min(0, "Tarif tidak boleh negatif").max(1e15),
    berlakuDari: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal berlaku wajib"),
    driver: z.string().trim().optional().transform((v) => (v ? v : null)),
    costCategoryId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : null)),
    note: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  })
  .superRefine((v, ctx) => {
    // Driver hanya bermakna untuk baris BIAYA: app.price_for_driver() menyaring
    // kind='cost', jadi driver pada baris revenue adalah field yang tidak
    // pernah dibaca — dan KEKAL, jadi salahnya tidak bisa diperbaiki.
    if (v.kind === "revenue" && v.driver) {
      ctx.addIssue({ code: "custom", path: ["driver"], message: "Baris revenue tidak memakai driver — revenue dihitung dari tonase panen" });
    }
    if (v.kind === "revenue" && v.costCategoryId) {
      ctx.addIssue({ code: "custom", path: ["costCategoryId"], message: "Kategori akuntansi hanya untuk baris biaya" });
    }
    if (v.driver && !DRIVER_VALUES.includes(v.driver)) {
      ctx.addIssue({ code: "custom", path: ["driver"], message: "Driver tidak dikenal" });
    }
  });

export async function createPriceRowAction(_p: PriceState, fd: FormData): Promise<PriceState> {
  try {
    // super_admin SAJA (§17 Keputusan 3). app.publish_price() self-gate hal yang
    // sama; ini lapis luar untuk pesan yang enak dibaca, bukan gerbangnya.
    const ctx = await requireRole("super_admin");
    if (!ctx.companyId) {
      return { ok: false, message: "Pilih satu entitas dulu — baris tarif selalu milik satu entitas." };
    }

    const parsed = createSchema.safeParse({
      code: String(fd.get("code") ?? "").toUpperCase(),
      kind: fd.get("kind"),
      category: fd.get("category"),
      unit: fd.get("unit"),
      rateIdr: fd.get("rateIdr"),
      berlakuDari: fd.get("berlakuDari") || todayInOperationalZone(),
      driver: fd.get("driver") ?? undefined,
      costCategoryId: fd.get("costCategoryId") ?? undefined,
      note: fd.get("note") ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }
    const d = parsed.data;

    // Kode yang sudah ada TIDAK boleh lewat jalur ini: app.publish_price() akan
    // menempuh cabang "kode lama" dan diam-diam menerbitkan VERSI BARU dengan
    // tarif ini — pengguna menekan "tambah baris" tapi yang terjadi adalah
    // mengubah tarif yang sedang berlaku. Dipisah tegas.
    if (await priceCodeExists(ctx, d.code)) {
      return {
        ok: false,
        message: `Kode ${d.code} sudah ada di entitas ini. Untuk mengubah tarifnya, terbitkan versi baru pada barisnya.`,
        fieldErrors: { code: "Kode sudah dipakai" },
      };
    }

    await createPriceRow(ctx, {
      code: d.code, kind: d.kind, category: d.category, unit: d.unit,
      rateIdr: d.rateIdr, berlakuDari: d.berlakuDari, driver: d.driver,
      costCategoryId: d.costCategoryId, note: d.note,
    });

    revalidatePath("/costing/refleksi");
    revalidatePath("/costing/pendapatan");
    revalidatePath("/dashboard/financial");
    return {
      ok: true,
      message: `Baris tarif ${d.code} dibuat, berlaku ${d.berlakuDari}. Kode, jenis, dan driver tidak bisa diubah lagi.`,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "FORBIDDEN") return { ok: false, message: "Hanya super admin yang bisa menambah baris tarif." };
    if (/price_list_one_active_per_driver_idx/.test(m)) {
      return {
        ok: false,
        message: "Driver itu sudah dipakai baris tarif aktif lain. Nonaktifkan baris lama dulu — dua tarif aktif untuk satu driver membuat volumenya dihitung dua kali.",
        fieldErrors: { driver: "Driver sudah dipakai baris aktif" },
      };
    }
    if (/price_list_driver_check/.test(m)) return { ok: false, message: "Driver tidak dikenal database.", fieldErrors: { driver: "Driver tidak dikenal" } };
    if (/price_list_kind_check/.test(m)) return { ok: false, message: "Jenis harus biaya atau revenue.", fieldErrors: { kind: "Jenis tidak valid" } };
    if (/row-level security/.test(m)) return { ok: false, message: "Anda tidak berhak menulis baris tarif ini." };
    return { ok: false, message: m };
  }
}

// ---------------------------------------------------------------------------
// AI-44b · ubah metadata tarif (kelas "edit in-place" K-09 §19)
//
// `cost_category_id` adalah kunci yang dipakai perbandingan anggaran. Tanpa
// action ini, satu-satunya cara memetakan tarif ke kategori adalah seed atau SQL
// manual — artinya setiap tenant baru butuh developer sebelum serapan anggarannya
// bisa terisi. Itulah yang membuat B-20 muncul lagi di instalasi baru.
//
// `rate_idr`/`unit` SENGAJA tidak di sini: keduanya berversi (setPriceRateAction).
// `code`/`kind`/`driver` kekal dan tidak punya jalur ubah sama sekali.
// ---------------------------------------------------------------------------

const metaSchema = z.object({
  id: z.string().uuid("Baris tarif tidak dikenal"),
  // Kosong = jangan ubah. Fungsi database memakai COALESCE, jadi string kosong
  // harus menjadi null di sini — kalau tidak, label yang sudah ada tertimpa "".
  category: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  note: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  costCategoryId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : null)),
  // Checkbox: hadir = aktif, absen = nonaktif. Selalu dikirim eksplisit oleh form
  // lewat hidden input, jadi tidak ada mode "jangan ubah" yang ambigu.
  isActive: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export async function updatePriceMetaAction(_p: PriceState, fd: FormData): Promise<PriceState> {
  try {
    const ctx = await requireRole("super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu." };

    const parsed = metaSchema.safeParse({
      id: fd.get("id"),
      category: fd.get("category") ?? undefined,
      note: fd.get("note") ?? undefined,
      costCategoryId: fd.get("costCategoryId") ?? undefined,
      isActive: fd.get("isActive") ?? "true",
    });
    if (!parsed.success) {
      return { ok: false, message: "Periksa isian yang ditandai.", fieldErrors: fieldErrors(parsed.error) };
    }
    const d = parsed.data;
    const n = await updatePriceMeta(ctx, {
      id: d.id, category: d.category, note: d.note,
      isActive: d.isActive, costCategoryId: d.costCategoryId,
    });

    revalidatePath("/costing/refleksi");
    revalidatePath("/costing/anggaran");
    revalidatePath("/dashboard/financial");
    return {
      ok: true,
      message: n > 1
        ? `Tersimpan pada ${n} versi tarif ini — label & pemetaan akuntansi berlaku untuk seluruh riwayatnya.`
        : "Tersimpan.",
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "FORBIDDEN") return { ok: false, message: "Hanya super admin yang bisa mengubah metadata tarif." };
    if (/price_list_one_active_per_driver_idx/.test(m)) {
      return {
        ok: false,
        message: "Mengaktifkan baris ini membuat dua tarif aktif untuk satu driver. Nonaktifkan dulu baris yang sekarang aktif.",
        fieldErrors: { isActive: "Bentrok dengan tarif aktif lain" },
      };
    }
    if (/row-level security/.test(m)) return { ok: false, message: "Anda tidak berhak mengubah tarif ini." };
    return { ok: false, message: m };
  }
}
