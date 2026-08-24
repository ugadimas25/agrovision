import type { ModuleReport } from "./types";
import type { ReportScreen } from "./screenTypes";

/**
 * AI-47 · jembatan ekspor: satu `ReportScreen` menjadi `ModuleReport` yang sudah
 * dipahami renderer PDF (`ModuleReportPdf`) dan Excel (`moduleExcelHtml`).
 *
 * Kenapa jembatan dan bukan renderer baru: `ScreenTable.columns` dan
 * `ModuleColumn` sudah IDENTIK strukturnya (`{ label, align?, kind? }`), begitu
 * juga barisnya (`(string | number | null)[][]`). Jadi yang dibutuhkan bukan
 * penulisan ulang tata letak, hanya menyatukan sumbernya.
 *
 * Sebelum ini layar memakai `screens.ts` (13 kueri sendiri) sementara PDF/Excel
 * memakai `moduleData.ts` — dua jalur data terpisah, bukan dua renderer di atas
 * satu jalur. Itu sebabnya kolomnya menyimpang sampai −4 kolom (Penyemprotan,
 * Karbon), dan sebabnya tanggal di PDF bisa mundur sehari: `moduleData.ts`
 * memformat tanggal lewat `toISOString()` di 8 tempat, yang menggeser kejadian
 * 00:00–07:00 WIB ke hari sebelumnya.
 *
 * `visual` diambil dari `footNote` tabel — keduanya baris keterangan di bawah
 * tabel, jadi tidak ada informasi yang hilang maupun dikarang.
 */
export function screenToModuleReport(screen: ReportScreen): ModuleReport {
  return {
    meta: screen.meta,
    columns: screen.table.columns,
    rows: screen.table.rows,
    visual: screen.table.footNote,
  };
}

/**
 * KPI layar sebagai pasangan label→nilai, untuk dicetak di atas tabel ekspor.
 *
 * Tanpa ini unduhan kehilangan angka ringkas yang justru paling dibaca manajemen
 * di layar, dan klaim "ekspor tidak bisa berbeda dari layar" hanya berlaku untuk
 * tabelnya. Satuan digabung ke nilai supaya bentuknya tetap dua kolom sederhana
 * di PDF maupun Excel.
 */
export function screenKpiPairs(screen: ReportScreen): { label: string; value: string }[] {
  return screen.kpis.map((k) => ({
    label: k.label,
    value: [k.value, k.unit].filter(Boolean).join(" ") + (k.sub ? ` (${k.sub})` : ""),
  }));
}
