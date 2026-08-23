"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { destroySession, resolveLogin, switchCompany } from "@/lib/session";
import { LOCALE_SWITCHER_ENABLED } from "@/lib/i18n";

export type AuthState = { ok: boolean; message: string };

const emailSchema = z.string().trim().min(1, "Email wajib diisi").email("Format email tidak valid");

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Email tidak valid" };
  }

  try {
    await resolveLogin(parsed.data);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal masuk" };
  }

  // redirect() bekerja dengan melempar error khusus — WAJIB di luar try/catch,
  // kalau tidak akan tertangkap dan dianggap kegagalan login.
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function switchCompanyAction(formData: FormData): Promise<void> {
  const raw = formData.get("companyId");
  const companyId = typeof raw === "string" && raw.length > 0 ? raw : null;

  if (companyId !== null && !z.string().uuid().safeParse(companyId).success) {
    throw new Error("Entitas tidak valid");
  }

  // switchCompany() memverifikasi user benar-benar berhak atas entitas itu.
  await switchCompany(companyId);
  revalidatePath("/", "layout");
}

/**
 * Ganti bahasa antarmuka (id/en). Disimpan di cookie, berlaku seluruh app.
 *
 * Selama LOCALE_SWITCHER_ENABLED false action ini tidak melakukan apa pun.
 * UI-nya sudah disembunyikan, tapi Server Action tetap bisa dipanggil POST
 * langsung, dan cookie yang ditulis toh diabaikan getLocale(). Lebih jujur
 * menolak di sini daripada menyimpan preferensi yang tidak berpengaruh.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  if (!LOCALE_SWITCHER_ENABLED) return;
  const raw = formData.get("locale");
  const locale = raw === "en" ? "en" : "id";
  const { cookies } = await import("next/headers");
  (await cookies()).set("agrovision_locale", locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
