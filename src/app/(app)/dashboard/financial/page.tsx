import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { financialDashboardView } from "@/lib/report/finDashboard";
import { FinancialDashboardView } from "@/components/dashboard/FinancialDashboardView";
import { parseDashboardFilter } from "@/lib/report/filters";
import { listEstateOptions, searchBlockOptions } from "@/lib/repo/blocks";
import { listFiscalPeriods } from "@/lib/repo/costing";
import { listCropCodeOptions } from "@/lib/repo/operational";

export const metadata = { title: "Dashboard Finansial — AgroVision" };

/** Dashboard Finansial — mengikuti mockup 2 (docs/Dashboard & Reports/2.png). */
export default async function FinancialDashboardPage({
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
    financialDashboardView(ctx, filter),
    listEstateOptions(ctx),
    searchBlockOptions(ctx),
    listFiscalPeriods(ctx).then((ps) => ps.map((x) => ({ value: x.id, label: x.name }))),
    listCropCodeOptions(ctx),
  ]);
  return (
    <FinancialDashboardView
      data={data} filter={filter} basePath="/dashboard/financial"
      estates={estates} blocks={blocks} periods={periods} crops={crops}
    />
  );
}
