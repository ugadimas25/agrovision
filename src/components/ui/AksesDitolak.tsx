import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "./PageHeader";

/**
 * Penolakan otorisasi (403) yang jujur.
 *
 * Dipakai halaman yang dipagari requirePageRole(): pengguna SUDAH login, hanya
 * perannya tidak berhak -- jadi ia tidak boleh dialihkan ke /login. Lihat
 * catatan panjang di requirePageRole (src/lib/session.ts).
 *
 * Menyembunyikan item di Sidebar hanya kosmetik; halaman inilah yang benar-benar
 * memagari URL saat ditempel langsung.
 *
 * Catatan status HTTP: halaman ini tetap 200. forbidden() dari next/navigation
 * masih eksperimental di Next 16.2.9, dan flag eksperimental tidak dinyalakan
 * hanya demi kode status. Penanda `data-testid` di bawah yang menjadi bukti
 * mesin-terbaca untuk acceptance test.
 */

const LABEL_PERAN: Record<string, string> = {
  super_admin: "Super Admin",
  approver: "Approver",
  creator: "Petugas Lapangan",
  viewer: "Pembaca",
  agronomist: "Agronomis",
};

const namaPeran = (role: string) => LABEL_PERAN[role] ?? role;

export function AksesDitolak({
  title,
  role,
  allowed,
}: {
  /** Judul halaman yang ditolak, supaya pengguna tahu ia tidak salah alamat. */
  title: string;
  /** app_role pengguna saat ini. */
  role: string;
  /** Peran yang berhak -- supaya jelas harus minta akses ke siapa. */
  allowed: string[];
}) {
  return (
    <div data-testid="akses-ditolak">
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-16 text-center">
        <div className="rounded-full bg-amber-100 p-3">
          <ShieldAlert className="h-7 w-7 text-amber-700" />
        </div>
        <p className="text-sm font-semibold text-amber-900">Akses ditolak</p>
        <p className="max-w-md text-sm leading-relaxed text-amber-900/80">
          Halaman ini hanya untuk {allowed.map(namaPeran).join(" dan ")}. Peran Anda saat ini{" "}
          <strong>{namaPeran(role)}</strong>. Sesi Anda tetap aktif — tidak perlu masuk ulang.
          Hubungi super admin bila Anda memang membutuhkan akses ini.
        </p>
        <Link
          href="/dashboard"
          className="mt-1 min-h-11 rounded-md border border-amber-300 bg-white px-3 py-2.5 text-sm text-amber-900 hover:bg-amber-100 md:min-h-0 md:py-1.5"
        >
          Kembali ke Dashboard
        </Link>
      </div>
    </div>
  );
}
