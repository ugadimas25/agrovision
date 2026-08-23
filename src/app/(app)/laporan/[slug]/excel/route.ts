import { requireContext } from "@/lib/session";
import { reportBySlug } from "@/lib/report/registry";
import { dashboardExcelHtml, moduleExcelHtml } from "@/lib/report/reportExcel";
import { excelResponse } from "@/lib/excel";
import { todayInOperationalZone } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let ctx;
  try { ctx = await requireContext(); } catch { return new Response("Unauthorized", { status: 401 }); }
  const { slug } = await params;
  const entry = reportBySlug(slug);
  if (!entry) return new Response("Not found", { status: 404 });

  const html = entry.kind === "dashboard"
    ? dashboardExcelHtml(await entry.load(ctx))
    : moduleExcelHtml(await entry.load(ctx));
  return excelResponse(html, `laporan-${slug}-${todayInOperationalZone()}`);
}
