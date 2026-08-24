import { Building2, CalendarDays, Tag, Leaf, Filter, X } from "lucide-react";
import type { DashboardFilter } from "@/lib/report/filters";
import { filterAktif } from "@/lib/report/filters";

/**
 * AI-24 / K-08 · bilah filter dashboard — SATU komponen untuk ketiga dashboard
 * dan modul Akuntansi.
 *
 * Yang digantinya: dua salinan `DashboardFilterBar`/`FilterBar` yang isinya
 * `<div>` ber-ikon ChevronDown — terlihat seperti dropdown, tapi tanpa `<select>`,
 * tanpa `<form>`, tanpa tautan. Diklik tidak melakukan apa pun, dan nilainya
 * dipatok. UI yang menjanjikan kemampuan yang tidak dimilikinya.
 *
 * `<form method="GET">` dengan `<input type="checkbox">` bernama sama:
 *   * MULTI-PILIH sesuai catatan 2.1
 *   * jalan TANPA JavaScript — peramban sendiri yang merakit
 *     `?estate=a&estate=b`, tidak ada kode klien yang menyusun URL
 *   * bisa di-bookmark & dibagikan, karena seluruh keadaan ada di URL
 *
 * `<details>` native untuk membuka daftar pilihan, bukan toggle useState — pola
 * yang sama dengan form-form lain di aplikasi ini.
 */

type Opt = { value: string; label: string };

function Grup({
  icon: Icon, label, name, options, selected,
}: {
  icon: typeof Building2; label: string; name: string; options: Opt[]; selected: string[];
}) {
  const terpilih = options.filter((o) => selected.includes(o.value));
  const ringkas = terpilih.length === 0
    ? `Semua ${label.toLowerCase()}`
    : terpilih.length <= 2
      ? terpilih.map((o) => o.label).join(", ")
      : `${terpilih.length} dipilih`;

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Icon className="h-4 w-4 text-slate-500" />
        <span className="leading-tight">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
          <span className={terpilih.length ? "font-semibold text-emerald-700" : "font-medium text-slate-700"}>{ringkas}</span>
        </span>
      </summary>
      {/* Daftar pilihan tetap ada di HTML server; <details> hanya menyembunyikannya. */}
      <div className="absolute left-0 z-30 mt-1 max-h-64 w-60 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-slate-500">Belum ada pilihan.</p>
        ) : options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)}
                   className="h-3.5 w-3.5 accent-emerald-700" />
            <span className="text-slate-700">{o.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export function FilterBar({
  basePath, filter, estates, blocks, periods, crops,
}: {
  basePath: string;
  filter: DashboardFilter;
  estates: Opt[];
  blocks: Opt[];
  periods: Opt[];
  crops: Opt[];
}) {
  const aktif = filterAktif(filter);
  return (
    <form method="GET" action={basePath} data-testid="filter-dashboard" className="flex flex-wrap items-center gap-2">
      <Grup icon={Building2} label="Estate" name="estate" options={estates} selected={filter.estateIds} />
      <Grup icon={CalendarDays} label="Periode" name="periode" options={periods} selected={filter.periodIds} />
      <Grup icon={Tag} label="Blok" name="blok" options={blocks} selected={filter.blockIds} />
      <Grup icon={Leaf} label="Komoditas" name="komoditas" options={crops} selected={filter.cropCodes} />

      <button type="submit" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
        <Filter className="h-3.5 w-3.5" />
        Terapkan
      </button>
      {aktif && (
        // Tautan biasa, bukan tombol reset ber-JS: menghapus seluruh parameter.
        <a href={basePath} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <X className="h-3.5 w-3.5" />
          Bersihkan
        </a>
      )}
      {filter.cropCodes.length > 0 && (
        // Kejujuran filter: tiga tabel aktivitas TIDAK punya dimensi komoditas
        // (weeding_records, spraying_records, land_preparations). Metrik dari
        // ketiganya karena itu dirender em-dash saat komoditas dipilih — bukan
        // angka tak terfilter yang seolah menghormati filternya.
        <p className="w-full text-xs leading-relaxed text-amber-700">
          Penyiangan, penyemprotan, dan persiapan lahan tidak menyimpan komoditas, jadi
          angkanya ditandai <strong>—</strong> selama filter komoditas aktif. Menampilkan
          angka tak terfilter di situ akan terbaca seolah ia mengikuti filter.
        </p>
      )}
    </form>
  );
}
