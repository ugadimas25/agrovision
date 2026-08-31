/**
 * Daftar tertutup untuk isian RAB: tahap proyek dan penggerak volume.
 *
 * Sebelumnya keduanya <datalist> — saran yang tetap menerima ketikan bebas.
 * Akibatnya "B Land prep", "B land prep", dan "Land prep B" bisa hidup
 * berdampingan di satu RAB, dan pengelompokan CAPEX per tahap pecah tanpa ada
 * yang menyadarinya: tidak ada galat, hanya dua kelompok yang seharusnya satu.
 *
 * Karena itu daftar ini dipakai DUA KALI: sebagai <select> di layar dan sebagai
 * z.enum() di Server Action. Yang di layar mencegah salah ketik; yang di server
 * mencegah kiriman POST langsung — dan hanya yang kedua itu jaminan, karena
 * Server Action bisa dipanggil tanpa melewati UI sama sekali.
 *
 * Nilai-nilainya dari 08_CAPEX_RAB pada model Banyumas. Menambah tahap baru =
 * menyunting berkas ini; itu memang lebih berat daripada mengetik bebas, dan
 * itulah harga yang ditukar dengan kepastian bahwa dua baris bertahap sama
 * benar-benar berada di kelompok yang sama.
 */

export const TAHAP = [
  "A Land", "A Assessment", "A Survey", "A Safeguard", "A Design",
  "B Land prep", "B Soil", "C Road", "C Drain", "C Boundary", "C Facility",
  "C Water", "C Power", "C Mobilization", "D Planting", "D Ecology",
  "E Equipment", "F Systems", "F Payroll",
] as const;

export const PENGGERAK = [
  "gross ha", "net ha", "site", "lot", "sample", "pit", "ton", "m", "unit",
  "% stock", "tree kg", "equipment", "annual", "calculated",
] as const;

export type Tahap = (typeof TAHAP)[number];
export type Penggerak = (typeof PENGGERAK)[number];
