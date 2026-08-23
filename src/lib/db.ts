import { Pool, types as pgTypes, type PoolClient } from "pg";

/**
 * Lapisan akses database.
 *
 * Dua aturan yang tidak boleh dilanggar:
 *
 * 1. Aplikasi konek sebagai `app_rw`, BUKAN `postgres`. Append-only dan RLS
 *    ditegakkan lewat pencabutan hak pada role itu. Konek sebagai superuser
 *    membuat seluruh lapisan keamanan tidak berlaku -- dan uji jadi false pass.
 *
 * 2. Setiap query menyentuh tabel ber-RLS WAJIB berjalan di dalam transaksi
 *    yang sudah men-set konteks (`app.current_user_id` dsb). Tanpa konteks,
 *    RLS mengembalikan 0 baris TANPA error -- terlihat seperti "belum ada data",
 *    bukan seperti bug. Karena itu `withRls` gagal keras bila konteks kosong.
 */

/**
 * DATE (OID 1082) dikembalikan APA ADANYA sebagai string 'YYYY-MM-DD'.
 *
 * Bawaan driver `pg` mem-parse DATE menjadi objek Date pada tengah malam waktu
 * LOKAL proses. Di WIB (+07:00) `2026-08-23` menjadi `2026-08-22T17:00:00Z`,
 * sehingga pola `new Date(v).toISOString().slice(0, 10)` di lapisan repo
 * menghasilkan `2026-08-22` -- tanggal bergeser satu hari ke belakang di SETIAP
 * zona ber-offset positif. Tanggal kalender (weeded_on, transaction_date,
 * valid_until, ...) tidak punya jam dan tidak punya zona; mengubahnya menjadi
 * instant selalu salah, dan tidak ada nilai TZ proses yang bisa membenarkannya.
 *
 * Dengan parser identitas ini nilai DATE tidak pernah menyentuh zona waktu:
 * string dari Postgres = string yang dirender UI. timestamptz (OID 1184) tetap
 * memakai parser bawaan -- kolom itu memang instant dan objek Date-nya benar.
 *
 * Cakupan: registry pg-types bersifat per-proses. Berkas ini hanya dimuat proses
 * Next.js; skrip `db/*.mjs` adalah proses terpisah dan tidak terpengaruh.
 * Bukti: `db/verify-dates.mjs` (jalankan di TZ=Asia/Jakarta DAN TZ=UTC).
 */
const PG_OID_DATE = 1082;
pgTypes.setTypeParser(PG_OID_DATE, (v) => v);

declare global {
  // Dev hot-reload membuat modul dievaluasi ulang; pool harus tunggal.
  var __agrovisionPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL belum diset. Lihat .env.example");
  }
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export const pool: Pool = globalThis.__agrovisionPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__agrovisionPool = pool;

export type RlsContext = {
  userId: string;
  /** Nilai app_role: creator | approver | super_admin | viewer */
  role: string;
  /** Entitas yang sedang dipilih. null = mode "semua entitas saya". */
  companyId: string | null;
};

/**
 * Jalankan callback di dalam satu transaksi dengan konteks RLS terpasang.
 * SET LOCAL berlaku sampai COMMIT/ROLLBACK, jadi konteks tidak pernah bocor
 * ke request lain yang memakai koneksi sama dari pool.
 */
export async function withRls<T>(
  ctx: RlsContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!ctx?.userId) {
    // Fail closed. Tanpa ini, RLS akan diam-diam mengembalikan nol baris.
    throw new Error("withRls dipanggil tanpa userId — konteks RLS wajib.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config dengan parameter -- bukan string interpolation.
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
    await client.query("SELECT set_config('app.current_role', $1, true)", [ctx.role ?? "viewer"]);
    await client.query("SELECT set_config('app.current_company_id', $1, true)", [ctx.companyId ?? ""]);

    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Query sekali jalan dengan konteks RLS. */
export async function rlsQuery<T = Record<string, unknown>>(
  ctx: RlsContext,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withRls(ctx, async (client) => {
    const res = await client.query(sql, params);
    return res.rows as T[];
  });
}

/**
 * Query tanpa konteks RLS. HANYA untuk hal yang mendahului sesi:
 * resolusi login dan pembacaan tabel tanpa RLS. Sengaja diberi nama panjang
 * supaya pemakaiannya terlihat mencolok saat review.
 */
export async function queryWithoutRlsContext<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
