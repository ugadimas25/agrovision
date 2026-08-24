import type { RlsContext } from "@/lib/db";
import { companyName } from "@/lib/repo/reports";
import type { ReportMeta } from "./types";

/**
 * Header laporan (entitas, periode, cakupan, waktu cetak) — SATU sumber untuk
 * layar, PDF, dan Excel.
 *
 * Dipindahkan dari `moduleData.ts` (dulu helper privat di sana) sebagai bagian
 * AI-47: karena PDF & Excel kini dirender dari objek `ReportScreen` yang sama
 * dengan layar, header-nya harus dirakit di tempat yang bisa dijangkau ketiganya.
 * Semua field selain empat argumen di bawah diturunkan dari `ctx`, jadi tidak ada
 * yang perlu diulang per laporan.
 */
export async function buildReportMeta(
  ctx: RlsContext,
  o: { title: string; subtitle: string; source: string; note: string },
): Promise<ReportMeta> {
  return {
    title: o.title,
    subtitle: o.subtitle,
    entity: await companyName(ctx),
    period: "Seluruh data s.d. tanggal cetak",
    blockScope: "Semua blok",
    commodity: "Kelapa & Durian",
    dataStatus: "Semua status (lihat kolom Status)",
    printedAt: new Date(),
    source: o.source,
    note: o.note,
  };
}
