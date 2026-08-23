import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireContext } from "@/lib/session";
import { reportBySlug } from "@/lib/report/registry";
import { DashboardReportPdf } from "@/lib/pdf/dashboard";
import { ModuleReportPdf } from "@/lib/pdf/moduleReport";
import { todayInOperationalZone } from "@/lib/date";
import { buildReportScreen } from "@/lib/report/screens";
import { screenToModuleReport, screenKpiPairs } from "@/lib/report/screenExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let ctx;
  try { ctx = await requireContext(); } catch { return new Response("Unauthorized", { status: 401 }); }
  const { slug } = await params;
  const entry = reportBySlug(slug);
  if (!entry) return new Response("Not found", { status: 404 });

  let el;
  if (entry.kind === "dashboard") {
    el = createElement(DashboardReportPdf, { report: await entry.load(ctx) });
  } else {
    // AI-47: laporan modul dirender dari objek ReportScreen yang SAMA dengan layar.
    // `entry.load` (jalur moduleData.ts) hanya dipakai bila slug itu belum punya
    // builder layar — hari ini tidak ada, tapi jalur mundurnya dipertahankan supaya
    // menambah laporan baru tidak langsung memutus ekspornya.
    const screen = await buildReportScreen(ctx, slug);
    el = screen
      ? createElement(ModuleReportPdf, { report: screenToModuleReport(screen), kpis: screenKpiPairs(screen) })
      : createElement(ModuleReportPdf, { report: await entry.load(ctx) });
  }
  const buf = await renderToBuffer(el as unknown as Parameters<typeof renderToBuffer>[0]);
  const stamp = todayInOperationalZone();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="laporan-${slug}-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
