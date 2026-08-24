import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { sustainabilityDashboardView } from "@/lib/report/sustDashboard";
import { SustainabilityDashboardView } from "@/components/dashboard/SustainabilityDashboardView";
import { parseDashboardFilter } from "@/lib/report/filters";
import { listEstateOptions, searchBlockOptions } from "@/lib/repo/blocks";
import { listFiscalPeriods } from "@/lib/repo/costing";
import { listCropCodeOptions } from "@/lib/repo/operational";

export const metadata = { title: "Dashboard Sustainability — AgroVision" };

/** Dashboard Sustainability — mengikuti mockup 3 (docs/Dashboard & Reports/3.png). */
export default async function SustainabilityDashboardPage({
  searchParams,
}: {
  // AI-24: bentuk searchParams SAMA dengan dashboard lain dan modul Akuntansi (K-08).
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx;
  try {
    ctx = await requireContext();
  } catch {
    redirect("/login");
  }
  const filter = parseDashboardFilter(await searchParams);
  const [data, estates, blocks, periods, crops] = await Promise.all([
    sustainabilityDashboardView(ctx, filter),
    listEstateOptions(ctx),
    searchBlockOptions(ctx),
    listFiscalPeriods(ctx).then((ps) => ps.map((x) => ({ value: x.id, label: x.name }))),
    listCropCodeOptions(ctx),
  ]);
  return (
    <SustainabilityDashboardView
      data={data} filter={filter} basePath="/dashboard/sustainability"
      estates={estates} blocks={blocks} periods={periods} crops={crops}
    />
  );
}
