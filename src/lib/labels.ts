/**
 * Label Bahasa Indonesia untuk nilai enum/kode database.
 *
 * Nilai enum di database memakai bahasa Inggris & snake_case (keputusan
 * arsitektur #12) dan nilai itu TIDAK BOLEH sampai ke mata pengguna:
 * "ready_to_plant" bukan bahasa manusia (catatan.md §3 / AI-34).
 *
 * Pemetaan dilakukan di sini — di TypeScript — dan BUKAN di SQL. Dua alasan:
 *   1. Migrasi yang sudah diterapkan tidak boleh diedit (checksum ledger), jadi
 *      teks tampilan yang dirangkai di dalam view/query praktis tidak bisa
 *      diperbaiki tanpa migrasi baru. Itu harga yang terlalu mahal untuk label.
 *   2. Label yang dirangkai di SQL tidak bisa ikut berganti bahasa.
 *
 * Status approval TIDAK ada di sini: rumahnya sudah ada di
 * src/lib/report/types.ts (statusLabelId) dan komponen RecordStatusBadge.
 * Jangan membuat pemetaan ketiga yang bersaing.
 *
 * Bila nanti butuh dwibahasa, pindahkan isi berkas ini ke src/lib/i18n.ts dengan
 * namespace "enum.*"; bentuk pemanggilannya sengaja dibuat sama (kode masuk,
 * label keluar) supaya pemindahannya tidak menyentuh pemanggil.
 */

/** app.prep_status — status persiapan lahan (migrasi 0017_reports.sql:205). */
export const PREP_STATUS: Record<string, string> = {
  not_started: "Belum mulai",
  in_progress: "Berjalan",
  ready_to_plant: "Siap tanam",
};

/** weeding_records.method (migrasi 0034_farm_activities_agri_input.sql:81). */
export const WEEDING_METHOD: Record<string, string> = {
  manual: "Manual",
  mekanis: "Mekanis",
  mulsa: "Mulsa",
  herbisida: "Herbisida",
  penutup_tanah: "Tanaman penutup tanah",
};

/** crop_code — komoditas (migrasi 0034_farm_activities_agri_input.sql:111). */
export const CROP: Record<string, string> = {
  DURIAN: "Durian",
  COCONUT: "Kelapa",
};

/** growth_phase — fase pertumbuhan pada aplikasi pupuk (migrasi 0007_agro.sql). */
export const GROWTH_PHASE: Record<string, string> = {
  seedling: "Bibit",
  vegetative: "Vegetatif",
  productive: "Produktif",
};

/** boundary_source — asal batas blok (migrasi 0003_gis.sql). */
export const BOUNDARY_SOURCE: Record<string, string> = {
  gps_survey: "Survei GPS",
  drone_ortho: "Ortho drone",
  shapefile_import: "Impor shapefile",
  manual_digitize: "Digitasi manual",
  legacy_document: "Dokumen lama",
};

/**
 * Kode → label. Kode yang tidak dikenal dikembalikan APA ADANYA, bukan null:
 * nilai enum baru dari migrasi berikutnya harus tetap terlihat (walau jelek)
 * daripada hilang diam-diam dari layar. null/kosong tetap null, supaya pemanggil
 * bisa merender EMPTY ("—") sesuai doktrin kejujuran data.
 */
export function labelOf(
  map: Record<string, string>,
  code: string | null | undefined,
): string | null {
  if (code === null || code === undefined || code === "") return null;
  return map[code] ?? code;
}

/**
 * Nama parameter (kunci `params` pada app.v_pending_approvals) -> peta labelnya.
 *
 * Inbox Approval menampilkan `params` secara generik (kunci apa pun yang dikirim
 * view). Nilai enum di dalamnya dilabeli lewat tabel ini, jadi view tidak perlu
 * membongkar jsonb-nya di SQL: kunci parameternya sudah cukup untuk memilih peta.
 * Kunci yang tidak terdaftar di sini ditampilkan apa adanya.
 */
const PARAM_ENUM_MAP: Record<string, Record<string, string>> = {
  Komoditas: CROP,
  Metode: WEEDING_METHOD,
  Fase: GROWTH_PHASE,
  Status: PREP_STATUS,
};

/** Beri label pada nilai parameter bila namanya memang memuat enum. */
export function labelParam(
  name: string,
  value: string | number | null,
): string | number | null {
  const map = PARAM_ENUM_MAP[name];
  if (!map || typeof value !== "string") return value;
  return labelOf(map, value) ?? value;
}
