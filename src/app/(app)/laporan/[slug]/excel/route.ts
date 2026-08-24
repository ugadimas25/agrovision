import { requireContext } from "@/lib/session";
import { reportBySlug } from "@/lib/report/registry";
import { dashboardExcelHtml, moduleExcelHtml } from "@/lib/report/reportExcel";
import { excelResponse } from "@/lib/excel";
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

  // AI-47: sumbernya sama dengan layar. Lihat komentar di pdf/route.ts.
  let html: string;
  if (entry.kind === "dashboard") {
    html = dashboardExcelHtml(await entry.load(ctx));
  } else {
    const screen = await buildReportScreen(ctx, slug);
    html = screen
      ? moduleExcelHtml(screenToModuleReport(screen), screenKpiPairs(screen))
      : moduleExcelHtml(await entry.load(ctx));
  }
  return excelResponse(html, `laporan-${slug}-${todayInOperationalZone()}`);
}
