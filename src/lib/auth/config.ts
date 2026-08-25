/**
 * Mode login — B-27.
 *
 * Dua mode, dan tidak ada mode ketiga:
 *
 *   identity-platform  (BAWAAN)  Klien masuk ke Identity Platform, server
 *                                memverifikasi ID token-nya. Ini satu-satunya
 *                                mode yang boleh melayani data sungguhan.
 *   stub               Login hanya mencocokkan email ke user aktif, TANPA
 *                      kredensial. Hanya untuk pengembangan dan uji otomatis.
 *
 * FAIL-CLOSED: AUTH_MODE yang tidak diset berarti identity-platform, bukan
 * stub. Lupa memasang env di lingkungan baru tidak boleh berarti "siapa saja
 * boleh masuk" — kegagalan yang benar adalah login yang mati, bukan login yang
 * terbuka.
 *
 * Mode stub punya TIGA gerbang; semuanya harus terbuka:
 *   1. AUTH_MODE=stub                          (berkas ini)
 *   2. NODE_ENV != production                  (berkas ini)
 *   3. app.auth_settings.stub_login_enabled    (migrasi 0057, di database)
 * Gerbang ketiga ada karena env bisa salah pasang, sedangkan database adalah
 * batas keamanan yang otoritatif.
 *
 * `misconfigured` bukan kegagalan keras yang melempar: halaman login harus
 * tetap bisa dirender untuk MENJELASKAN apa yang kurang. Melempar di sini akan
 * mengubah salah ketik env menjadi HTTP 500 tanpa keterangan — dan `next build`
 * (NODE_ENV=production, tanpa env Identity Platform) ikut mati bersamanya.
 */

export type AuthConfig =
  | { mode: "stub" }
  | { mode: "identity-platform"; projectId: string; apiKey: string }
  | { mode: "misconfigured"; reason: string };

const env = (name: string): string => (process.env[name] ?? "").trim();

export function getAuthConfig(): AuthConfig {
  const raw = env("AUTH_MODE").toLowerCase();

  if (raw === "stub") {
    if (process.env.NODE_ENV === "production") {
      return {
        mode: "misconfigured",
        reason:
          "AUTH_MODE=stub tidak berlaku saat NODE_ENV=production. Login tanpa verifikasi kredensial tidak akan pernah dilayani build produksi.",
      };
    }
    return { mode: "stub" };
  }

  if (raw !== "" && raw !== "identity-platform") {
    return {
      mode: "misconfigured",
      reason: `AUTH_MODE="${raw}" tidak dikenal. Nilai yang sah: identity-platform (bawaan) atau stub.`,
    };
  }

  const projectId = env("IDENTITY_PLATFORM_PROJECT_ID");
  const apiKey = env("IDENTITY_PLATFORM_API_KEY");
  const missing = [
    projectId ? null : "IDENTITY_PLATFORM_PROJECT_ID",
    apiKey ? null : "IDENTITY_PLATFORM_API_KEY",
  ].filter((v): v is string => v !== null);

  if (missing.length > 0) {
    return {
      mode: "misconfigured",
      reason: `Variabel lingkungan belum diisi: ${missing.join(", ")}. Lihat .env.example dan docs/12-deploy-gcp.md §9.`,
    };
  }

  return { mode: "identity-platform", projectId, apiKey };
}
