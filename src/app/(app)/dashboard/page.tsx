import { redirect } from "next/navigation";
import { requireContext } from "@/lib/session";
import { operationalDashboardView } from "@/lib/report/opDashboard";
import { parseDashboardFilter } from "@/lib/report/filters";
import { listEstateOptions, searchBlockOptions } from "@/lib/repo/blocks";
import { listFiscalPeriods } from "@/lib/repo/costing";
import { listCropCodeOptions } from "@/lib/repo/operational";
import { OperationalDashboardView } from "@/components/dashboard/OperationalDashboardView";

export const metadata = { title: "Dashboard Operasional — AgroVision" };

/**
 * Dashboard Operasional — mengikuti desain mockup (docs/Dashboard & Reports/1.png):
 * KPI cards, Perjalanan Budidaya (5 tahap), peta blok, timeline aktivitas, insight.
 * Setiap angka dari DB; kosong dirender "—" (bukan 0).
 */
export default async function DashboardPage({
  searchParams,
}: {
  // AI-24: seluruh keadaan filter ada di URL, jadi tautannya bisa dibagikan dan
  // di-bookmark — dan filternya bekerja tanpa JavaScript sama sekali.
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
    operationalDashboardView(ctx, filter),
    listEstateOptions(ctx),
    searchBlockOptions(ctx),
    listFiscalPeriods(ctx).then((ps) => ps.map((x) => ({ value: x.id, label: x.name }))),
    listCropCodeOptions(ctx),
  ]);

  return (
    <OperationalDashboardView
      data={data} filter={filter}
      estates={estates} blocks={blocks} periods={periods} crops={crops}
    />
  );
}
