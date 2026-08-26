"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  destroySession,
  resolveLoginWithEmailStub,
  resolveLoginWithIdToken,
  switchCompany,
} from "@/lib/session";
import { getAuthConfig } from "@/lib/auth/config";
import { IdTokenError } from "@/lib/auth/identity-platform";
import { LOCALE_SWITCHER_ENABLED } from "@/lib/i18n";

export type AuthState = { ok: boolean; message: string };

const emailSchema = z.string().trim().min(1, "Email wajib diisi").email("Format email tidak valid");
const idTokenSchema = z.string().trim().min(1, "ID token kosong").max(8192, "ID token terlalu panjang");

/**
 * Kegagalan verifikasi token TIDAK boleh diteruskan apa adanya ke layar.
 *
 * Pesan aslinya menyebut alg, kid, iss, atau selisih jam — keterangan yang
 * hanya berguna bagi orang yang sedang mencoba menembus, dan tidak berarti apa
 * pun bagi pengguna sah. Detailnya masuk log server; pengguna dapat satu
 * kalimat yang sama untuk semua sebab.
 */
function loginErrorMessage(e: unknown): string {
  if (e instanceof IdTokenError) {
    console.error("[login] verifikasi ID token gagal:", e.message);
    // Kunci publik Google tak terjangkau = gangguan, bukan token palsu.
    // Menyuruh pengguna "masuk lagi" saat yang rusak adalah jaringan hanya
    // membuatnya mengulang hal yang sama sampai menyerah.
    if (/kunci publik/.test(e.message)) {
      return "Tidak bisa memverifikasi sesi ke Identity Platform saat ini. Coba lagi sebentar lagi.";
    }
    return "Sesi masuk tidak sah atau sudah kedaluwarsa. Coba masuk lagi.";
  }
  const raw = e instanceof Error ? e.message : "";
  // 42501 dari app.lookup_login_stub() (migrasi 0057): saklar DB-nya mati.
  if (/stub_login_enabled|login stub dimatikan/.test(raw)) {
    return "Login stub dimatikan di database ini. Untuk pengembangan: UPDATE app.auth_settings SET stub_login_enabled = true;";
  }
  return raw || "Gagal masuk";
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const cfg = getAuthConfig();
  if (cfg.mode === "misconfigured") {
    return { ok: false, message: `Login belum dikonfigurasi. ${cfg.reason}` };
  }

  try {
    if (cfg.mode === "identity-platform") {
      // Kata sandi tidak pernah lewat sini: klien menukarnya ke Identity
      // Platform dan hanya membawa ID token-nya.
      const token = idTokenSchema.safeParse(formData.get("idToken"));
      if (!token.success) {
        return { ok: false, message: "Token masuk tidak diterima. Muat ulang halaman lalu coba lagi." };
      }
      await resolveLoginWithIdToken(token.data);
    } else {
      const parsed = emailSchema.safeParse(formData.get("email"));
      if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? "Email tidak valid" };
      }
      await resolveLoginWithEmailStub(parsed.data);
    }
  } catch (e) {
    return { ok: false, message: loginErrorMessage(e) };
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
