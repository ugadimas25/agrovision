import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";
import { queryWithoutRlsContext } from "./db";
import type { RlsContext } from "./db";

/**
 * Sesi berbasis cookie bertanda tangan HMAC.
 *
 * STATUS AUTENTIKASI -- baca sebelum deploy:
 *
 * Mekanisme sesinya NYATA: cookie httpOnly, ditandatangani HMAC, ada masa
 * berlaku, diverifikasi ulang ke database setiap request, dan menjadi satu-satunya
 * sumber konteks RLS. Yang BELUM nyata adalah verifikasi identitas -- lihat
 * `resolveLogin`.
 *
 * JANGAN deploy ke lingkungan yang bisa diakses publik sebelum TODO di
 * `resolveLogin` diisi.
 *
 * Catatan desain: cookie menyimpan `externalId` (subject Identity Platform),
 * BUKAN uuid internal. Dua alasan:
 *   1. Sejak migrasi 0018, app.users tertutup RLS -- tidak bisa dibaca tanpa
 *      konteks, dan konteks itu justru yang sedang dicari (deadlock bootstrap).
 *      Resolusinya lewat app.resolve_session(), satu-satunya pintu SECURITY DEFINER.
 *   2. externalId adalah identitas yang nanti dibawa JWT. Menyimpannya sekarang
 *      membuat peralihan ke Identity Platform tidak mengubah bentuk cookie.
 */

const COOKIE = "agrovision_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  /** Subject Identity Platform (app.users.external_id) */
  sub: string;
  /** Entitas yang dipilih. null = mode "semua entitas saya". */
  companyId: string | null;
  exp: number;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET wajib diset, minimal 32 karakter. Lihat .env.example");
  }
  return s;
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string): SessionPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = sign(body);
  // Panjang berbeda membuat timingSafeEqual melempar, jadi dicek lebih dulu.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (!p?.sub || typeof p.exp !== "number") return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export type Session = {
  userId: string;
  role: string;
  companyId: string | null;
  fullName: string;
  email: string;
  externalId: string;
};

export type CompanyOption = { companyId: string; companyCode: string; companyName: string };

/**
 * Sesi saat ini, atau null bila belum login.
 *
 * Selalu diverifikasi ulang ke database: user bisa dinonaktifkan atau perannya
 * diubah setelah cookie diterbitkan. Cookie hanya membuktikan "siapa", bukan
 * "boleh apa".
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const payload = decode(token);
  if (!payload) return null;

  const rows = await queryWithoutRlsContext<{
    user_id: string;
    company_id: string;
    app_role: string;
    full_name: string;
    email: string;
  }>(`SELECT user_id, company_id, app_role, full_name, email FROM app.resolve_session($1)`, [
    payload.sub,
  ]);

  const user = rows[0];
  if (!user) return null; // tidak ada, atau is_active = false

  // Entitas terpilih harus benar-benar boleh diakses. Cookie bisa dipalsukan
  // hanya bila SESSION_SECRET bocor, tapi pemeriksaan ini tetap murah.
  let companyId = payload.companyId;
  if (companyId) {
    const allowed = await queryWithoutRlsContext(
      `SELECT 1 FROM app.session_companies($1) WHERE company_id = $2`,
      [user.user_id, companyId],
    );
    if (allowed.length === 0) companyId = null;
  }

  return {
    userId: user.user_id,
    role: user.app_role,
    companyId,
    fullName: user.full_name,
    email: user.email,
    externalId: payload.sub,
  };
}

/** Daftar entitas yang boleh diakses -- untuk switcher di Topbar. */
export async function getSessionCompanies(userId: string): Promise<CompanyOption[]> {
  const rows = await queryWithoutRlsContext<{
    company_id: string;
    company_code: string;
    company_name: string;
  }>(`SELECT company_id, company_code, company_name FROM app.session_companies($1)`, [userId]);
  return rows.map((r) => ({
    companyId: r.company_id,
    companyCode: r.company_code,
    companyName: r.company_name,
  }));
}

/** Konteks RLS dari sesi. Melempar UNAUTHENTICATED bila belum login. */
export async function requireContext(): Promise<RlsContext & { session: Session }> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return {
    userId: session.userId,
    role: session.role,
    companyId: session.companyId,
    session,
  };
}

/**
 * Server Action bisa dipanggil lewat POST langsung, bukan hanya dari UI --
 * peringatan eksplisit di dokumentasi Next.js 16. Jadi SETIAP action wajib
 * memanggil ini. Otorisasi di UI saja tidak pernah cukup.
 *
 * RLS di database adalah lapis kedua: bahkan bila pemeriksaan ini terlewat,
 * database tetap menolak data di luar tenant pemanggil.
 */
export async function requireRole(...allowed: string[]): Promise<RlsContext & { session: Session }> {
  const ctx = await requireContext();
  if (!allowed.includes(ctx.role)) throw new Error("FORBIDDEN");
  return ctx;
}

/**
 * Gate untuk Server Component HALAMAN. Server Action dan route handler tetap
 * memakai requireRole() -- keduanya tidak merender apa pun.
 *
 * Dua kegagalan yang berbeda tidak boleh diperlakukan sama:
 *   - BELUM LOGIN -> redirect("/login"), dilempar dari dalam fungsi ini, jadi
 *     halaman tidak perlu try/catch lagi.
 *   - ROLE SALAH  -> { ok: false }, supaya halaman merender <AksesDitolak/>.
 *     Membuang pengguna yang SUDAH login ke /login hanya membingungkan: ia akan
 *     mengira sesinya habis, login ulang, lalu mendarat di penolakan yang sama.
 *
 * Kenapa union dan bukan forbidden() dari next/navigation: pada Next 16.2.9
 * fungsi itu masih eksperimental dan menuntut flag experimental.authInterrupts
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md).
 * Menyalakan flag eksperimental untuk perbaikan keamanan P0 bukan pertukaran
 * yang sehat. Konsekuensinya halaman penolakan berstatus HTTP 200, bukan 403 --
 * karena itu scripts/at-verify.mjs membuktikannya dari ISI halaman.
 *
 * `allowed` kosong = cukup login (setara requireContext). Halaman baca yang
 * memang terbuka untuk semua peran (skenario QA A-03) tidak perlu diubah.
 */
export type PageGate =
  | { ok: true; ctx: RlsContext & { session: Session } }
  | { ok: false; role: string };

export async function requirePageRole(...allowed: string[]): Promise<PageGate> {
  let ctx: RlsContext & { session: Session };
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  if (allowed.length > 0 && !allowed.includes(ctx.role)) {
    return { ok: false, role: ctx.role };
  }
  return { ok: true, ctx };
}

async function issue(sub: string, companyId: string | null): Promise<void> {
  (await cookies()).set(
    COOKIE,
    encode({ sub, companyId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    },
  );
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Ganti entitas aktif tanpa login ulang; hanya ke entitas yang boleh diakses. */
export async function switchCompany(companyId: string | null): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");

  if (companyId) {
    const allowed = await queryWithoutRlsContext(
      `SELECT 1 FROM app.session_companies($1) WHERE company_id = $2`,
      [session.userId, companyId],
    );
    if (allowed.length === 0) throw new Error("FORBIDDEN");
  }
  await issue(session.externalId, companyId);
}

/**
 * Resolusi login.
 *
 * TODO: verifikasi ID token Identity Platform di sini. Alur produksinya:
 *   1. Klien login ke Identity Platform, memperoleh ID token.
 *   2. Action mengirim token ke fungsi ini.
 *   3. Verifikasi tanda tangan token dengan kunci publik Google, periksa
 *      audience/issuer/expiry, ambil klaim `sub`.
 *   4. `sub` itulah yang dilempar ke app.resolve_session().
 *
 * Sampai itu terpasang, fungsi ini HANYA mencocokkan email ke user aktif --
 * tanpa verifikasi kredensial apa pun. Cukup untuk mengembangkan alur data,
 * TIDAK cukup untuk produksi.
 */
export async function resolveLogin(email: string): Promise<void> {
  // Lewat app.lookup_login_email(): app.users tertutup RLS dan konteks belum ada.
  const rows = await queryWithoutRlsContext<{ external_id: string; user_id: string }>(
    `SELECT external_id, user_id FROM app.lookup_login_email($1)`,
    [email.trim()],
  );
  const user = rows[0];
  if (!user) throw new Error("Email tidak terdaftar atau akun tidak aktif");

  const companies = await getSessionCompanies(user.user_id);
  if (companies.length === 0) {
    throw new Error("Akun belum diberi akses ke entitas mana pun. Hubungi super admin.");
  }

  // Satu entitas -> langsung dipilih. Lebih dari satu -> mode "semua entitas saya".
  await issue(user.external_id, companies.length === 1 ? companies[0].companyId : null);
}
