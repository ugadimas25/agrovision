import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_SWITCHER_ENABLED, type Locale } from "./i18n";

/**
 * Baca locale dari cookie. Server-only (memakai next/headers).
 *
 * Selama LOCALE_SWITCHER_ENABLED false, cookie diabaikan dan hasilnya selalu
 * DEFAULT_LOCALE. Menyembunyikan tombolnya saja tidak cukup: pengguna yang
 * cookie-nya sudah "en" dari sesi lama akan tertinggal di halaman
 * setengah-Inggris tanpa jalan kembali.
 */
export async function getLocale(): Promise<Locale> {
  if (!LOCALE_SWITCHER_ENABLED) return DEFAULT_LOCALE;
  const v = (await cookies()).get("agrovision_locale")?.value;
  return v === "en" || v === "id" ? v : DEFAULT_LOCALE;
}
