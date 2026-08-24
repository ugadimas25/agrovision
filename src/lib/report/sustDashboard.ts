import { rlsQuery, type RlsContext } from "@/lib/db";
import { EMPTY_FILTER, type DashboardFilter, type Terbatas } from "./filters";
import { resolveFilter } from "./filterResolve";
import { latestCarbonRun, listCertPrograms } from "@/lib/repo/sustainability";
import type { IndStatus } from "./types";

export type SustKpi = { key: "carbon" | "complete" | "cert" | "trace"; label: string; value: string; unit?: string; note?: string; tone?: "default" | "pos" | "neg" };
/**
 * pct null = standar itu BELUM punya program sama sekali (bukan "kesiapan 0%").
 * Sebelumnya `?? 0`, sehingga 8 dari 9 standar di dataset demo tampil "0%"
 * dengan bilah kosong -- tak terbedakan dari standar yang sudah dinilai dan
 * hasilnya memang nol. Itu doktrin null-bukan-nol, di dashboard.
 */
export type CertReady = { name: string; pct: number | null };

export type SustDashboard = {
  /** AI-24: metrik yang tidak bisa mengikuti filter, beserta alasannya. */
  terbatas: Terbatas[];
  kpis: SustKpi[];
  carbon: { gross: number | null; sequestration: number | null; net: number | null };
  hasCarbon: boolean;
  mapStatus: IndStatus;
  certReady: CertReady[];
  certifiedCount: number;
  landHistoryDone: number;
  landHistoryTotal: number;
  organic: { organic: number; synthetic: number; total: number } | null;
  insights: { title: string; text: string; tone: "emerald" | "sky" | "amber"; action: string }[];
};

const STANDARDS = [
  "ISPO 2020", "RSPO P&C 2018", "RSPO SCCS 2020", "ISCC EU", "ISCC PLUS",
  "Rainforest Alliance 2020", "SA 8000:2014", "OHSAS 18001 / ISO 45001", "ISO 14001:2015",
];
const EMPTY = "—";
const nf = (v: number, d = 0) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(v);

/**
 * AI-24 · dashboard ini yang paling sedikit bisa difilter, dan itu dinyatakan
 * apa adanya:
 *   * rasio pupuk organik BISA — fertilizer_applications punya block_id,
 *     applied_on, dan crop_code.
 *   * neraca karbon TIDAK — app.carbon_runs adalah snapshot SE-PERUSAHAAN per
 *     periode, satu baris; tidak ada dimensi blok maupun komoditas di dalamnya.
 *   * program sertifikasi TIDAK — cakupannya entitas, bukan blok.
 *
 * Menyembunyikan batasan itu akan membuat pembaca menyangka angka karbon sudah
 * dipersempit ke blok yang dipilihnya. Jadi nilainya em-dash beserta alasannya.
 */
export async function sustainabilityDashboardView(
  ctx: RlsContext,
  filter: DashboardFilter = EMPTY_FILTER,
): Promise<SustDashboard> {
  const f = await resolveFilter(ctx, filter);
  // Hanya blok/komoditas yang membuat angka karbon tak bisa dipersempit. Filter
  // PERIODE saja tidak: carbon_runs punya period_start/period_end, jadi periode
  // masih bermakna untuk dashboard ini.
  const petaBlok = f.blockIds !== null || f.cropCodes !== null;
  const [run, programs, org] = await Promise.all([
    latestCarbonRun(ctx),
    listCertPrograms(ctx),
    rlsQuery<{ organic: string | null; total: string | null }>(ctx, `
      SELECT COALESCE(SUM(fa.total_quantity) FILTER (WHERE ft.kind='organic'),0)::text AS organic,
             COALESCE(SUM(fa.total_quantity),0)::text AS total
        FROM app.fertilizer_applications fa JOIN app.fertilizer_types ft ON ft.id=fa.fertilizer_type_id
       WHERE fa.approval_status='approved'
         AND ($1::uuid[] IS NULL OR fa.block_id = ANY($1))
         AND ($2::date IS NULL OR fa.applied_on BETWEEN $2::date AND $3::date)
         AND ($4::text[] IS NULL OR fa.crop_code = ANY($4))`,
      [f.blockIds, f.dateFrom, f.dateTo, f.cropCodes]),
  ]);

  const terbatas: Terbatas[] = [];
  if (petaBlok) {
    terbatas.push({ metrik: "Neraca karbon", alasan: "carbon_runs adalah snapshot se-perusahaan per periode, tanpa dimensi blok/komoditas" });
    terbatas.push({ metrik: "Program sertifikasi", alasan: "cakupannya entitas, bukan blok" });
  }

  // petaBlok = blok atau komoditas dipilih -> angka karbon tidak boleh tampil
  // seolah sudah dipersempit.
  const net = petaBlok ? null : run?.netBalanceTco2e ?? null;
  const gross = petaBlok ? null : run?.grossEmissionTco2e ?? null;
  const seq = petaBlok ? null : run?.sequestrationTco2e ?? null;
  const completeness = run?.dataCompletenessPct ?? null;
  const hasCarbon = run !== null;

  const readinessByName = new Map(programs.map((p) => [p.standardName, p.avgReadiness]));
  const certReady: CertReady[] = STANDARDS.map((s) => {
    const r = readinessByName.get(s);
    return { name: s, pct: r === undefined || r === null ? null : Math.round(r) };
  });
  const certifiedCount = programs.filter((p) => p.avgReadiness !== null && p.avgReadiness >= 100).length;
  const dinilai = programs.filter((p) => p.avgReadiness !== null).length;

  const orgTon = org[0] ? Number(org[0].organic) : 0;
  const totTon = org[0] ? Number(org[0].total) : 0;
  const organic = totTon > 0 ? { organic: orgTon, synthetic: totTon - orgTon, total: totTon } : null;

  const mapStatus: IndStatus = net === null ? "belum" : net >= 0 ? "ok" : "perhatian";
  const tco2e = (v: number | null) => (v === null ? EMPTY : nf(v, 2));

  const kpis: SustKpi[] = [
    { key: "carbon", label: "Neraca Karbon", value: tco2e(net), unit: net === null ? undefined : "tCO₂e", note: net === null ? "belum ada run" : net >= 0 ? "Net Sink" : "Net Emitter", tone: net === null ? "default" : net >= 0 ? "pos" : "neg" },
    { key: "complete", label: "Kelengkapan Karbon", value: completeness === null ? EMPTY : nf(completeness, 0), unit: completeness === null ? undefined : "%", note: "kelengkapan data run" },
    { key: "cert", label: "Sertifikasi", value: `${certifiedCount}/${STANDARDS.length}`, note: `standar siap · ${dinilai} sudah dinilai` },
    // "Aktif" / "Semua rantai terpetakan" dulu literal, tanpa satu pun query --
    // padahal /traceability masih halaman placeholder dan tidak ada tabel rantai
    // di skema. Kartu yang mengaku kemampuan yang tidak ada lebih berbahaya
    // daripada kartu kosong.
    { key: "trace", label: "Traceability", value: EMPTY, note: "modul belum tersedia" },
  ];

  const insights: { title: string; text: string; tone: "emerald" | "sky" | "amber"; action: string }[] = [
    { title: "Perbarui Faktor Emisi Lokal", text: "Gunakan faktor emisi lokal untuk pupuk, bahan bakar, dan limbah agar neraca karbon lebih akurat.", tone: "emerald", action: "Tinjau Sekarang" },
    { title: "Lengkapi Data DBH", text: "Data Diameter at Breast Height (DBH) di 7 blok belum lengkap — tingkatkan akurasi serapan karbon.", tone: "sky", action: "Lengkapi Data" },
    { title: "Lengkapi Bukti Riwayat Lahan", text: "Kumpulkan & unggah dokumen bukti riwayat lahan untuk memenuhi persyaratan K1–K7.", tone: "amber", action: "Lihat Checklist" },
    { title: "Roadmap Input Organik", text: "Tingkatkan penggunaan input organik bertahap menuju target ≥ 30% pada akhir periode.", tone: "emerald", action: "Lihat Rekomendasi" },
  ];

  return {
    terbatas,
    kpis, carbon: { gross, sequestration: seq, net }, hasCarbon, mapStatus,
    certReady, certifiedCount, landHistoryDone: 0, landHistoryTotal: 7,
    organic, insights,
  };
}
