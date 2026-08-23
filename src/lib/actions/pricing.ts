"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { publishPriceRate } from "@/lib/repo/pricing";
import { todayInOperationalZone } from "@/lib/date";

export type PriceState = { ok: boolean; message: string };

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
