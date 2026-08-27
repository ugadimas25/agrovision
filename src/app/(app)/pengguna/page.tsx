import { Users } from "lucide-react";
import { requirePageRole } from "@/lib/session";
import { AksesDitolak } from "@/components/ui/AksesDitolak";
import { listUsers } from "@/lib/repo/master";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { cn } from "@/lib/utils";
import { UserRowActions } from "./UserRowActions";

export const metadata = { title: "Pengguna & Akses — AgroVision" };

const ROLE = { super_admin: "Super Admin", approver: "Approver", creator: "Petugas Lapangan", viewer: "Pembaca", agronomist: "Agronomis" };

/**
 * Daftar pengguna & akses -- hanya super_admin dan approver.
 *
 * Gate-nya di baris pertama halaman, bukan cuma di menu: item Sidebar yang
 * disembunyikan (AI-27a) tetap bisa dicapai dengan menempel URL. Peran yang
 * tidak berhak mendapat halaman penolakan, BUKAN /login -- sesinya sah, jadi
 * mengirimnya ke layar login hanya membuatnya login ulang ke penolakan sama.
 *
 * Daftar peran satu tempat: gate dan pesan penolakan tidak boleh bisa berbeda.
 */
const BOLEH_LIHAT_PENGGUNA = ["super_admin", "approver"];

export default async function Page() {
  const gate = await requirePageRole(...BOLEH_LIHAT_PENGGUNA);
  const t = getDict(await getLocale());
  if (!gate.ok) {
    return <AksesDitolak title={t("nav.users")} role={gate.role} allowed={BOLEH_LIHAT_PENGGUNA} />;
  }

  const users = await listUsers(gate.ctx);
  // AI-28: MELIHAT daftar boleh approver (A-09), MENGUBAH status hanya
  // super_admin. Server Action tetap memeriksa sendiri — kolom yang tidak
  // dirender bukan penjaga, action bisa dipanggil POST langsung.
  const bolehKelola = gate.ctx.session.role === "super_admin";
  return (
    <div>
      <PageHeader title={t("nav.users")} subtitle={t("sub.users")} />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {users.length === 0 ? (
          <EmptyState icon={Users} title="Belum ada pengguna" />
        ) : (
          <ResponsiveTable>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2.5 font-medium">Nama</th><th className="px-4 py-2.5 font-medium">Email</th><th className="px-4 py-2.5 font-medium">Peran</th><th className="px-4 py-2.5 text-right font-medium">Akses estate</th><th className="px-4 py-2.5 font-medium">Status</th>{bolehKelola && <th className="px-4 py-2.5 font-medium">Aksi</th>}</tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0">
                    <td data-label="Nama" className="px-4 py-2.5 text-slate-700">{u.fullName}</td>
                    <td data-label="Email" className="px-4 py-2.5 text-slate-500">{u.email}</td>
                    <td data-label="Peran" className="px-4 py-2.5"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{ROLE[u.role as keyof typeof ROLE] ?? u.role}</span></td>
                    <td data-label="Akses estate" className="px-4 py-2.5 text-right tabular-nums text-slate-600">{u.estateCount === 0 ? "Semua" : u.estateCount}</td>
                    <td data-label="Status" className="px-4 py-2.5"><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", u.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{u.isActive ? "Aktif" : "Nonaktif"}</span></td>
                    {bolehKelola && (
                      <td data-label="Aksi" className="px-4 py-2.5">
                        <UserRowActions userId={u.id} isActive={u.isActive} isSelf={u.id === gate.ctx.session.userId} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        )}
      </div>
      {bolehKelola && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Menonaktifkan menutup akses tanpa menghapus apa pun: sesi yang sedang berjalan berhenti
          berlaku pada request berikutnya karena sesi diperiksa ulang ke database setiap request.
          Penghapusan hanya mungkin untuk pengguna yang belum pernah mencatat, mengajukan, atau
          menyetujui apa pun — database menolak menghapus siapa pun yang meninggalkan jejak, supaya
          riwayat tidak kehilangan pelakunya.
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Peran creator dengan akses estate terbatas hanya melihat blok pada estate tersebut — ditegakkan Row Level Security di database. Undang pengguna & atur akses estate: fase berikutnya (fungsi grant_estate_access sudah siap di DB).</p>
    </div>
  );
}
