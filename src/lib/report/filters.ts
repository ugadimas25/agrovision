
/**
 * AI-24 / K-08 · kontrak filter dashboard.
 *
 * SATU bentuk `searchParams` dipakai ketiga dashboard DAN modul Akuntansi (K-08:
 * "wajib memakai komponen filter yang sama — kalau dibuat terpisah, akan ada dua
 * perilaku filter yang berbeda di aplikasi yang sama").
 *
 * Keadaan sebelum ini: ketiga dashboard merender bilah filter berisi empat chip
 * ber-ikon ChevronDown, tapi isinya <div> — tanpa <select>, tanpa <form>, tanpa
 * tautan. Diklik tidak melakukan apa pun, dan nilainya dipatok ("Semua periode",
 * "Kelapa & Durian"). Jadi keluhan "filter tidak berfungsi, angka statis" bukan
 * soal query yang salah: UI-nya menjanjikan kemampuan yang tidak ada.
 *
 * Berkas ini SENGAJA bebas impor server-only: ia dipakai komponen "use client"
 * (FinancialDashboardView, SustainabilityDashboardView). Menarik `@/lib/db` ke
 * sini akan membawa modul `pg` ke bundle peramban dan MEMATIKAN seluruh aplikasi
 * dengan galat di pg/lib/connection-parameters.js — terbukti, dan bukan galat yang
 * menyebut penyebabnya. Bagian yang butuh query ada di ./filterResolve.ts.
 *
 * Semua dimensi MULTI-PILIH (catatan 2.1). Parameter berulang, bukan
 * dipisah koma: `?estate=a&estate=b`. Alasannya bentuk itu yang dihasilkan
 * <input type="checkbox"> dengan nama sama pada form GET biasa — jadi filter
 * tetap bekerja tanpa JavaScript, tanpa kode perakit URL di klien.
 */
export type DashboardFilter = {
  estateIds: string[];
  blockIds: string[];
  /** Fase proyek (app.fiscal_periods), BUKAN rentang tanggal bebas. */
  periodIds: string[];
  cropCodes: string[];
};

export const EMPTY_FILTER: DashboardFilter = {
  estateIds: [], blockIds: [], periodIds: [], cropCodes: [],
};

/** Ambil satu parameter berulang sebagai array, tanpa nilai kosong. */
function many(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => x.trim()).filter(Boolean);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Baca filter dari searchParams.
 *
 * Nilai yang bukan UUID DIBUANG, bukan diteruskan ke SQL: parameter ini datang
 * dari URL dan bisa diisi siapa pun. Kode komoditas dibatasi huruf/angka/underscore
 * dengan alasan yang sama. Nilai yang tidak dikenal tidak akan cocok apa pun,
 * jadi menyaringnya di sini membuat filter yang dipalsukan menjadi "tanpa filter"
 * — bukan galat, dan bukan celah.
 */
export function parseDashboardFilter(
  sp: Record<string, string | string[] | undefined>,
): DashboardFilter {
  return {
    estateIds: many(sp.estate).filter((v) => UUID.test(v)),
    blockIds: many(sp.blok).filter((v) => UUID.test(v)),
    periodIds: many(sp.periode).filter((v) => UUID.test(v)),
    cropCodes: many(sp.komoditas).filter((v) => /^[A-Za-z0-9_]{1,32}$/.test(v)),
  };
}

export function filterAktif(f: DashboardFilter): boolean {
  return f.estateIds.length > 0 || f.blockIds.length > 0
    || f.periodIds.length > 0 || f.cropCodes.length > 0;
}

/**
 * Filter yang sudah DIPADATKAN menjadi bentuk yang bisa dipakai SQL langsung.
 *
 * `blockIds` menggabungkan pilihan blok eksplisit DAN blok milik estate terpilih,
 * supaya tiap subquery hanya perlu satu syarat blok. `null` berarti "tanpa batas"
 * — dibedakan dari array kosong, yang berarti "tidak ada blok yang cocok" dan
 * HARUS menghasilkan nol, bukan semua.
 */
export type ResolvedFilter = {
  blockIds: string[] | null;
  dateFrom: string | null;
  dateTo: string | null;
  cropCodes: string[] | null;
  /** true bila komoditas dipilih — metrik tanpa dimensi komoditas wajib em-dash. */
  komoditasDipilih: boolean;
};

/**
 * AI-24 · metrik yang TIDAK BISA mengikuti dimensi filter tertentu.
 *
 * Tiap dashboard menyusun daftarnya sendiri dan menyerahkannya ke lapisan
 * tampilan, supaya angka yang tidak bisa menghormati filter dirender em-dash
 * beserta ALASANNYA — bukan angka tak terfilter yang seolah mengikuti, dan bukan
 * nol (nol terbaca sebagai fakta).
 *
 * Ini bukan kekurangan yang disembunyikan: batasannya nyata di skema, dan satu-
 * satunya pilihan jujur adalah mengatakannya. Contoh yang paling menonjol —
 * `reflectedCosts()` menjumlahkan SE-PERUSAHAAN tanpa GROUP BY blok/periode
 * (AKAR-2 docs/13 §3). Membuatnya bisa difilter adalah pekerjaan terpisah yang
 * memang sudah disebut teks asli AI-02.
 */
export type Terbatas = { metrik: string; alasan: string };

/** Ringkas jadi satu kalimat untuk ditampilkan di bawah bilah filter. */
export function ringkasBatasan(list: Terbatas[]): string | null {
  if (list.length === 0) return null;
  const per = new Map<string, string[]>();
  for (const t of list) per.set(t.alasan, [...(per.get(t.alasan) ?? []), t.metrik]);
  return [...per].map(([alasan, ms]) => `${ms.join(", ")} — ${alasan}`).join("; ");
}
