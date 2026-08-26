import { Database } from "lucide-react";
import { requirePageRole } from "@/lib/session";
import { listMasterItems, listMasterTypes } from "@/lib/repo/master";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { AksesDitolak } from "@/components/ui/AksesDitolak";
import { MasterDataManager } from "./MasterDataManager";

export const metadata = { title: "Master Data — AgroVision" };

/**
 * CRUD master data untuk super_admin.
 *
 * Inilah sisi tulis dari acceptance test 1: super_admin menambah item di sini,
 * lalu item itu muncul di dropdown setiap form terkait tanpa perubahan kode
 * dan tanpa redeploy.
 *
 * ROUTE INI DIPAGARI, bukan hanya disembunyikan dari menu (AI-27b). Versi
 * sebelumnya memakai requireContext() lalu, untuk peran lain, merender daftar
 * tipe master data read-only -- artinya siapa pun yang login tetap melihat
 * struktur master data hanya dengan menempel URL-nya. Menyembunyikan item di
 * Sidebar (AI-27a) tidak mengubah itu sedikit pun; gate di baris pertama
 * halaman inilah yang mengubah.
 */
export default async function MasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ tipe?: string }>;
}) {
  const gate = await requirePageRole("super_admin");
  const t = getDict(await getLocale());
  if (!gate.ok) {
    return <AksesDitolak title={t("nav.masterdata")} role={gate.role} allowed={["super_admin"]} />;
  }
  const ctx = gate.ctx;

  const types = await listMasterTypes(ctx);

  const params = await searchParams;
  const activeCode = params.tipe && types.some((t) => t.code === params.tipe)
    ? params.tipe
    : types[0]?.code;

  const items = activeCode ? await listMasterItems(ctx, activeCode) : [];
  const activeType = types.find((t) => t.code === activeCode);

  return (
    <div>
      <PageHeader
        title={t("nav.masterdata")}
        subtitle={t("sub.masterdata")}
      />

      {types.length === 0 ? (
        <EmptyState />
      ) : (
        <MasterDataManager
          types={types.map((t) => ({
            code: t.code,
            name: t.name,
            itemCount: t.itemCount,
            isHierarchical: t.isHierarchical,
          }))}
          activeCode={activeCode!}
          activeTypeName={activeType?.name ?? ""}
          isHierarchical={activeType?.isHierarchical ?? false}
          items={items.map((i) => ({
            id: i.id,
            code: i.code,
            name: i.name,
            parentId: i.parentId,
            parentName: i.parentName,
            sortOrder: i.sortOrder,
            isActive: i.isActive,
            isGlobal: i.companyId === null,
          }))}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <Database className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 text-sm font-medium text-slate-700">Belum ada tipe master data</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
        Tipe master seharusnya dibuat migrasi <code className="font-mono text-xs">0015_master</code>.
        Jalankan <code className="font-mono text-xs">npm run db:migrate</code>.
      </p>
    </div>
  );
}
