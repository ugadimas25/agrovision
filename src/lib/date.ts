/**
 * Tanggal kalender (kolom DATE Postgres) <-> string 'YYYY-MM-DD'.
 *
 * MENGAPA BUKAN toISOString(): node-postgres mem-parse kolom `date` menjadi
 * objek Date pada TENGAH MALAM WAKTU LOKAL, sehingga
 * `new Date(v).toISOString().slice(0, 10)` menggesernya satu hari KE BELAKANG
 * di zona positif seperti WIB (+07:00) -- terbukti terhadap DB: '2026-08-01'
 * menjadi '2026-07-31', '2026-09-01' menjadi '2026-08-31'.
 *
 * Di batas bulan itu memindahkan baris ke bulan yang salah. Dan bila nilainya
 * diisikan kembali ke <input type="date"> lalu disimpan (jalur sertifikasi:
 * complianceRegistry/organicRegistry -> RegistryGroup/OrganicTracker ->
 * setComplianceStatus/setOrganicStatus), tanggal di database benar-benar
 * mundur satu hari SETIAP KALI baris disimpan. Itu kerusakan data, bukan
 * kesalahan label.
 *
 * Karena itu tanggal kalender diformat dari komponen LOKAL objek Date, tidak
 * pernah lewat UTC.
 */
export function toDateString(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  // Bila driver sudah memberi string (mis. kolom di-cast ::text di SQL),
  // ambil apa adanya -- tidak ada zona waktu yang perlu ditafsirkan.
  if (typeof v === "string") return v.slice(0, 10);
  if (Number.isNaN(v.getTime())) return null;
  const y = String(v.getFullYear()).padStart(4, "0");
  const m = String(v.getMonth() + 1).padStart(2, "0");
  const d = String(v.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Zona operasional kebun. Server Cloud Run berjalan di UTC, kebunnya tidak. */
export const OPERATIONAL_TIME_ZONE = "Asia/Jakarta";

/**
 * Hari ini di zona operasional, untuk nilai awal <input type="date">.
 *
 * `new Date().toISOString().slice(0, 10)` di server UTC memberi tanggal KEMARIN
 * bagi pengguna WIB antara 00:00-07:00, dan nilai itu ikut TERSIMPAN sebagai
 * tanggal kejadian. 'en-CA' adalah locale yang menghasilkan 'YYYY-MM-DD',
 * format yang dituntut input type=date.
 */
export function todayInOperationalZone(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_TIME_ZONE }).format(new Date());
}
