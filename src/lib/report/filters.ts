import type { RlsContext } from "@/lib/db";
import { rlsQuery } from "@/lib/db";

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

export async function resolveFilter(
  ctx: RlsContext,
  f: DashboardFilter,
): Promise<ResolvedFilter> {
  let blockIds: string[] | null = null;

  if (f.blockIds.length > 0 || f.estateIds.length > 0) {
    const rows = await rlsQuery<{ id: string }>(
      ctx,
      `SELECT id FROM app.blocks
        WHERE archived_at IS NULL
          AND ( ($1::uuid[] IS NOT NULL AND id = ANY($1))
             OR ($2::uuid[] IS NOT NULL AND estate_id = ANY($2)) )`,
      [f.blockIds.length ? f.blockIds : null, f.estateIds.length ? f.estateIds : null],
    );
    blockIds = rows.map((r) => r.id);
  }

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (f.periodIds.length > 0) {
    // Beberapa fase sekaligus dipadatkan menjadi SATU rentang menyeluruh.
    // Itu memang lebih longgar daripada gabungan rentang terpisah bila fasenya
    // tidak bersambung — tapi fase proyek di sini berurutan, dan satu rentang
    // membuat tiap subquery cukup punya dua parameter alih-alih daftar rentang.
    const [r] = await rlsQuery<{ from: string | null; to: string | null }>(
      ctx,
      `SELECT min(starts_on)::text AS from, max(ends_on)::text AS to
         FROM app.fiscal_periods WHERE id = ANY($1)`,
      [f.periodIds],
    );
    dateFrom = r?.from ?? null;
    dateTo = r?.to ?? null;
  }

  return {
    blockIds,
    dateFrom,
    dateTo,
    cropCodes: f.cropCodes.length ? f.cropCodes : null,
    komoditasDipilih: f.cropCodes.length > 0,
  };
}
