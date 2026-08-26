import { X509Certificate, createVerify } from "node:crypto";

/**
 * Verifikasi ID token Google Identity Platform (Firebase Auth) — B-27.
 *
 * Alurnya persis yang didokumentasikan docs/12-deploy-gcp.md §9:
 *   1. Klien masuk ke Identity Platform, memperoleh ID token (JWT RS256).
 *   2. Server Action mengirim token itu ke sini.
 *   3. Tanda tangannya diverifikasi terhadap kunci publik Google, lalu
 *      iss/aud/exp/iat diperiksa.
 *   4. Klaim `sub` diserahkan ke app.resolve_session() — pintu SECURITY DEFINER
 *      yang sudah ada sejak migrasi 0018.
 *
 * TANPA DEPENDENSI BARU. Berkas ini hanya memakai node:crypto, dan itu bukan
 * sekadar penghematan: modul ini juga di-import langsung oleh
 * scripts/verify-idtoken.mjs (uji negatif dengan kunci yang dibuat sendiri),
 * jadi ia tidak boleh mengandalkan apa pun dari Next.js maupun alias `@/`.
 *
 * Yang membuat verifikasi ini bermakna, dan yang membuatnya gagal bila
 * dilonggarkan:
 *
 *   - `alg` WAJIB RS256. Menerima `none` berarti siapa pun boleh mengarang
 *     klaim; menerima HS256 berarti kunci PUBLIK Google dipakai sebagai
 *     rahasia HMAC — dan kunci publik, menurut definisinya, dimiliki semua
 *     orang. Keduanya adalah kelas serangan JWT yang paling sering berhasil.
 *   - `iss` dan `aud` WAJIB terikat ke satu projectId. Tanpa itu, token sah
 *     dari proyek Firebase mana pun di dunia (termasuk milik penyerang, yang
 *     ditandatangani kunci Google yang sama) bisa dipakai masuk ke sini.
 *   - `exp`/`iat` diperiksa dengan toleransi jam 60 detik, bukan lebih.
 */

export const GOOGLE_CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/** Toleransi selisih jam server, detik. */
const CLOCK_SKEW_SECONDS = 60;

/** ID token Identity Platform yang wajar < 4 KB; batas ini menolak sampah besar
 *  sebelum satu operasi kripto pun dijalankan. */
const MAX_TOKEN_CHARS = 8192;

/** Batas atas panjang `sub` (Identity Platform: maksimum 128 karakter). */
const MAX_SUBJECT_CHARS = 128;

export type IdTokenClaims = {
  /** Klaim `sub` — nilai yang dicocokkan ke app.users.external_id. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

/** kid -> sertifikat X.509 berformat PEM. */
export type CertMap = Record<string, string>;

export class IdTokenError extends Error {
  /** true bila `kid` token tidak ada di kumpulan kunci yang dipakai. Google
   *  merotasi kuncinya, jadi ini satu-satunya kegagalan yang layak dicoba ulang
   *  dengan kunci yang baru diambil. */
  unknownKeyId: boolean;

  constructor(message: string, unknownKeyId = false) {
    super(message);
    this.name = "IdTokenError";
    this.unknownKeyId = unknownKeyId;
  }
}

function decodeSegment(segment: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new IdTokenError(`${label} token bukan JSON yang sah`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new IdTokenError(`${label} token bukan objek JSON`);
  }
  return parsed as Record<string, unknown>;
}

const numberClaim = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Verifikasi dengan kumpulan kunci yang DIBERIKAN dan waktu yang DIBERIKAN.
 *
 * Dipisah dari verifyIdToken() supaya bisa diuji tanpa jaringan dan tanpa
 * menunggu satu jam untuk membuktikan token kedaluwarsa ditolak —
 * scripts/verify-idtoken.mjs membuat kunci sendiri dan menggeser `nowSeconds`.
 */
export function verifyIdTokenWithCerts(
  token: string,
  opts: { certs: CertMap; projectId: string; nowSeconds: number },
): IdTokenClaims {
  const { certs, projectId, nowSeconds } = opts;

  if (!projectId) throw new IdTokenError("projectId Identity Platform kosong");
  if (typeof token !== "string" || token.length === 0) {
    throw new IdTokenError("token kosong");
  }
  if (token.length > MAX_TOKEN_CHARS) {
    throw new IdTokenError("panjang token di luar batas wajar");
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new IdTokenError("token bukan JWT tiga bagian");
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeSegment(rawHeader, "header");
  if (header.alg !== "RS256") {
    throw new IdTokenError(`alg ${String(header.alg)} ditolak; hanya RS256`);
  }
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) throw new IdTokenError("header token tanpa kid");

  const certPem = Object.prototype.hasOwnProperty.call(certs, kid) ? certs[kid] : undefined;
  if (!certPem) throw new IdTokenError(`kid ${kid} tidak ada di kunci publik`, true);

  let signatureValid = false;
  try {
    signatureValid = createVerify("RSA-SHA256")
      .update(`${rawHeader}.${rawPayload}`)
      .verify(new X509Certificate(certPem).publicKey, Buffer.from(rawSignature, "base64url"));
  } catch {
    // Sertifikat rusak atau signature bukan base64url yang bisa dipakai.
    throw new IdTokenError("tanda tangan token tidak bisa diverifikasi");
  }
  if (!signatureValid) throw new IdTokenError("tanda tangan token tidak cocok");

  // Klaim baru dibaca SETELAH tanda tangan terbukti — sebelum itu isinya
  // hanyalah teks dari pihak yang belum dipercaya.
  const payload = decodeSegment(rawPayload, "payload");

  const issuer = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== issuer) {
    throw new IdTokenError(`iss ${String(payload.iss)} bukan ${issuer}`);
  }
  if (payload.aud !== projectId) {
    throw new IdTokenError(`aud ${String(payload.aud)} bukan proyek ${projectId}`);
  }

  const exp = numberClaim(payload.exp);
  if (exp === null) throw new IdTokenError("token tanpa klaim exp");
  if (exp + CLOCK_SKEW_SECONDS <= nowSeconds) throw new IdTokenError("token kedaluwarsa");

  const iat = numberClaim(payload.iat);
  if (iat === null) throw new IdTokenError("token tanpa klaim iat");
  if (iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new IdTokenError("iat token di masa depan");

  // auth_time opsional; bila ada, tidak boleh di masa depan.
  const authTime = numberClaim(payload.auth_time);
  if (authTime !== null && authTime - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new IdTokenError("auth_time token di masa depan");
  }

  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject || subject.length > MAX_SUBJECT_CHARS) {
    throw new IdTokenError("klaim sub kosong atau terlalu panjang");
  }

  return {
    subject,
    email: typeof payload.email === "string" && payload.email.length > 0 ? payload.email : null,
    emailVerified: payload.email_verified === true,
  };
}

// ---------------------------------------------------------------------------
// Kunci publik Google — diambil lewat HTTP, di-cache sesuai Cache-Control.
// ---------------------------------------------------------------------------

let certCache: { certs: CertMap; expiresAt: number } | null = null;

/** Batas bawah & atas umur cache, supaya header aneh tidak membuat kita
 *  memukul endpoint tiap request (atau memakai kunci basi berhari-hari). */
const MIN_CACHE_SECONDS = 60;
const MAX_CACHE_SECONDS = 24 * 60 * 60;
const DEFAULT_CACHE_SECONDS = 60 * 60;

export function cacheSecondsFromHeader(cacheControl: string | null): number {
  const m = /max-age\s*=\s*(\d+)/i.exec(cacheControl ?? "");
  const raw = m ? Number(m[1]) : DEFAULT_CACHE_SECONDS;
  return Math.min(MAX_CACHE_SECONDS, Math.max(MIN_CACHE_SECONDS, raw));
}

async function fetchCerts(): Promise<CertMap> {
  // cache: "no-store" — umur cache diurus di sini, dari header Cache-Control
  // milik Google, bukan oleh lapisan cache fetch Next.js.
  let res: Response;
  try {
    res = await fetch(GOOGLE_CERT_URL, { cache: "no-store" });
  } catch (e) {
    // Jaringan mati BUKAN token palsu. Pesannya menyebut "kunci publik" supaya
    // src/lib/actions/auth.ts bisa membedakannya dan tidak menuduh pengguna
    // memakai sesi kedaluwarsa saat yang terjadi adalah gangguan.
    throw new IdTokenError(
      `gagal menghubungi endpoint kunci publik Google: ${e instanceof Error ? e.message : "tidak diketahui"}`,
    );
  }
  if (!res.ok) {
    throw new IdTokenError(`gagal mengambil kunci publik Google (HTTP ${res.status})`);
  }

  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new IdTokenError("balasan kunci publik Google bukan objek");
  }

  const certs: CertMap = {};
  for (const [kid, pem] of Object.entries(body as Record<string, unknown>)) {
    if (typeof pem === "string" && pem.includes("BEGIN CERTIFICATE")) certs[kid] = pem;
  }
  if (Object.keys(certs).length === 0) {
    throw new IdTokenError("balasan kunci publik Google tidak memuat sertifikat");
  }

  certCache = {
    certs,
    expiresAt: Date.now() + cacheSecondsFromHeader(res.headers.get("cache-control")) * 1000,
  };
  return certs;
}

/**
 * Verifikasi ID token terhadap kunci publik Google yang berlaku saat ini.
 * Melempar IdTokenError bila token tidak sah — pemanggil TIDAK boleh
 * meneruskan pesannya apa adanya ke pengguna (lihat src/lib/actions/auth.ts).
 */
export async function verifyIdToken(token: string, projectId: string): Promise<IdTokenClaims> {
  const fresh = certCache && certCache.expiresAt > Date.now() ? certCache.certs : await fetchCerts();
  const nowSeconds = Math.floor(Date.now() / 1000);

  try {
    return verifyIdTokenWithCerts(token, { certs: fresh, projectId, nowSeconds });
  } catch (e) {
    // Google merotasi kunci penandatangan. `kid` yang belum dikenal berarti
    // cache kita ketinggalan, bukan bahwa tokennya palsu — ambil sekali lagi.
    if (e instanceof IdTokenError && e.unknownKeyId) {
      certCache = null;
      return verifyIdTokenWithCerts(token, {
        certs: await fetchCerts(),
        projectId,
        nowSeconds,
      });
    }
    throw e;
  }
}
