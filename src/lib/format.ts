/**
 * Pemformatan angka untuk UI Indonesia.
 *
 * Aturan yang tidak boleh dilanggar: nilai `null` berarti "belum ada data" dan
 * ditampilkan sebagai em dash, BUKAN sebagai 0. Menampilkan 0 untuk data yang
 * belum ada adalah angka fabrikasi -- persis yang dilarang concept:40.
 */

import { OPERATIONAL_TIME_ZONE } from "./date";

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const EMPTY = "—";

export function formatIdr(v: number | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  return `Rp ${idr.format(v)}`;
}

/** Ringkas untuk KPI: Rp 1,3 M / Rp 450 jt. Nilai penuh tetap di tooltip. */
export function formatIdrShort(v: number | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `Rp ${dec2.format(v / 1e12)} T`;
  if (abs >= 1e9) return `Rp ${dec2.format(v / 1e9)} M`;
  if (abs >= 1e6) return `Rp ${idr.format(Math.round(v / 1e6))} jt`;
  return `Rp ${idr.format(v)}`;
}

export function formatHa(v: number | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  return `${dec2.format(v)} ha`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  return idr.format(v);
}

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return EMPTY;
  return `${dec2.format(v)}%`;
}

/** Tanggal kalender dari Postgres: 'YYYY-MM-DD' — tanpa jam, tanpa zona. */
const TANGGAL_ISO = /^\d{4}-\d{2}-\d{2}$/;

// timeZone dipatok UTC: tanggal kalender harus dirender sama di zona mana pun.
const fmtTanggal = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
});

/**
 * Tanggal kalender dirender apa adanya: string di-parse sebagai UTC lalu
 * diformat DI UTC, jadi hasilnya tidak bergantung zona proses/peramban.
 * Memformatnya di zona lokal menggeser tanggal satu hari di zona ber-offset
 * negatif; DATE tidak punya jam, jadi tidak ada instant yang benar untuk
 * digeser. Nilai Date (kolom timestamptz = instant sungguhan) tetap dirender
 * di zona lokal seperti sebelumnya.
 */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return EMPTY;
  if (typeof v === "string" && TANGGAL_ISO.test(v)) {
    const [y, m, tgl] = v.split("-").map(Number);
    return fmtTanggal.format(Date.UTC(y, m - 1, tgl));
  }
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return EMPTY;
  // timeZone DIPAKU: tanpa ini fungsi memakai zona runtime, yang BERBEDA antara
  // server (Cloud Run = UTC) dan perangkat pengguna (WIB). Client Component yang
  // memformat timestamptz lalu memicu hydration mismatch — terbukti di /approval
  // lewat Emulation.setTimezoneOverride — dan React membuang seluruh HTML server
  // untuk route itu.
  return d.toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone: OPERATIONAL_TIME_ZONE,
  });
}

