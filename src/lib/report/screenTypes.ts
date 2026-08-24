/**
 * Model layar Laporan (mockup docs/Dashboard & Reports/4–18.png). Semua deskriptor
 * bersifat data murni (serializable) sehingga bisa disusun di server lalu dirender
 * di klien (Recharts butuh "use client"). Ikon direpresentasikan sebagai string key
 * → dipetakan ke komponen lucide di sisi klien (ICONS di screen.tsx).
 *
 * Prinsip data tetap: kosong = "—" (bukan 0).
 */
import type { IndStatus, ReportMeta } from "./types";

export type Tone = "ok" | "perhatian" | "kritis" | "belum" | "info" | "default";

/** Kartu KPI besar di baris atas layar laporan. */
export type ScreenKpi = {
  icon: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: Tone;
};

/** Item legenda / progress (dipakai progressList, legendList, statCards). */
export type ProgressItem = {
  label: string;
  value?: string;
  pct?: number | null;
  sub?: string;
  badge?: { text: string; tone: Tone };
  icon?: string;
  tone?: Tone;
};

export type JourneyColumn = {
  title: string;
  count: number | string;
  tone: Tone;
  items: { title: string; sub?: string; tag?: string; target?: string }[];
};

export type RadarAxis = { axis: string; actual: number; ambang: number };
export type BarDatum = { name: string; value: number; color?: string };
export type PieDatum = { name: string; value: number; color: string };

/** Satu panel di grid tengah. `kind` menentukan renderer. */
export type ScreenPanel =
  | { kind: "radar"; title: string; span?: 1 | 2 | 3; axes: RadarAxis[]; legend?: { label: string; class: string }[]; note?: string }
  | { kind: "bars"; title: string; span?: 1 | 2 | 3; data: BarDatum[]; horizontal?: boolean; unit?: string }
  | { kind: "pie"; title: string; span?: 1 | 2 | 3; data: PieDatum[]; centerLabel?: string; centerValue?: string }
  | { kind: "progressList"; title: string; span?: 1 | 2 | 3; items: ProgressItem[]; scroll?: boolean }
  | { kind: "statCards"; title?: string; span?: 1 | 2 | 3; cards: ProgressItem[]; cols?: 2 | 3 | 4 }
  | { kind: "journey"; title: string; span?: 1 | 2 | 3; columns: JourneyColumn[] }
  | { kind: "stepper"; title: string; span?: 1 | 2 | 3; steps: { icon: string; label: string; sub?: string; tone?: Tone }[]; note?: string }
  | { kind: "map"; title: string; span?: 1 | 2 | 3; status: IndStatus; legend?: boolean; note?: string }
  | { kind: "empty"; title: string; span?: 1 | 2 | 3; icon: string; message: string; desc?: string };

/** Panel rekomendasi di sisi kanan (rail). */
export type RecoRail = {
  title: string;
  tabs?: string[];
  summary?: string;
  priorities?: { n: number; title: string; text: string }[];
  general?: { heading: string; items: string[] };
  target?: { label: string; value: string; sub?: string };
  action?: string;
};

/** Kolom & baris tabel detail (reuse dari ModuleReport, plus deteksi status/persen). */
export type ScreenTable = {
  title: string;
  /**
   * `detail: true` = kolom sekunder (AI-48, K-07). Di layar MOBILE kolom ini tidak
   * ikut di kartu utama, melainkan di balik pengungkap "Detail" pada kartu yang
   * sama; di desktop, PDF, dan Excel ia tampil seperti kolom lain.
   *
   * Batas 8 kolom itu batas MOBILE, bukan batas dokumen — jadi ekspor tidak
   * memangkas apa pun. Ditandai TERPUSAT di buildReportScreen(), bukan di 15
   * builder, supaya pemilahannya bisa dikoreksi di satu tempat.
   */
  columns: { label: string; align?: "left" | "right"; kind?: "new"; detail?: boolean }[];
  rows: (string | number | null)[][];
  footNote?: string;
};

/**
 * Apa yang DIKEMBALIKAN tiap builder layar. Tanpa `meta` — header dirakit sekali
 * di buildReportScreen(), bukan diulang 15 kali.
 */
export type ReportScreenBase = {
  slug: string;
  title: string;
  subtitle?: string;
  headerAction?: { label: string; icon: string };
  kpis: ScreenKpi[];
  panels: ScreenPanel[];
  table: ScreenTable;
  rail?: RecoRail;
};

/**
 * Apa yang DIPAKAI konsumen: layar, PDF, dan Excel. Sejak AI-47 ketiganya dirender
 * dari objek ini, sehingga kolom dan header mereka secara struktural mustahil
 * berbeda. `meta` dipisahkan dari ReportScreenBase supaya menambahkannya tidak
 * menuntut perubahan di 15 builder.
 */
export type ReportScreen = ReportScreenBase & { meta: ReportMeta };
