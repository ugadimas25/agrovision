import Link from "next/link";
import { redirect } from "next/navigation";
import { Leaf, ArrowLeft, TriangleAlert, ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/session";
import { getAuthConfig } from "@/lib/auth/config";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Masuk — AgroVision" };

export default async function LoginPage() {
  // Sudah login: langsung ke dashboard.
  if (await getSession()) redirect("/dashboard");

  // Konfigurasi dibaca di server dan diturunkan sebagai prop. Sengaja BUKAN
  // NEXT_PUBLIC_*: nilai NEXT_PUBLIC di-inline saat build, sehingga setiap
  // lingkungan (dev, staging, produksi) akan menuntut image-nya sendiri.
  // Sebagai prop, satu image yang sama bisa dipakai di mana pun -- lihat
  // catatan Dockerfile tentang NEXT_PUBLIC_*.
  //
  // apiKey Identity Platform memang PUBLIK (pengenal proyek, bukan rahasia):
  // ia hanya menentukan proyek mana yang menerima permintaan masuk, dan tidak
  // memberi hak apa pun tanpa kredensial pengguna.
  const cfg = getAuthConfig();

  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-12"
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 20%, #dbeadd 0, transparent 40%), radial-gradient(circle at 80% 80%, #cfe3d2 0, transparent 45%), linear-gradient(135deg, #f7f6f2 0%, #eef6ef 100%)",
      }}
    >
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-emerald-900/5 sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="rounded-xl bg-emerald-700 p-2.5">
              <Leaf className="h-6 w-6 text-white" />
            </div>
            <h1 className="mt-3 text-lg font-bold text-slate-800">Masuk ke AgroVision</h1>
            <p className="mt-1 text-sm text-slate-500">Platform Manajemen Agroforestry</p>
          </div>

          {cfg.mode === "misconfigured" ? (
            // Tanpa konfigurasi yang sah TIDAK ada form: menampilkan kolom yang
            // pasti gagal hanya membuat pengguna mengira kata sandinya salah.
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-xs leading-relaxed text-red-800">
                <strong>Login belum dikonfigurasi.</strong> {cfg.reason}
              </p>
            </div>
          ) : (
            <LoginForm
              mode={cfg.mode}
              apiKey={cfg.mode === "identity-platform" ? cfg.apiKey : undefined}
            />
          )}

          {/* Peringatan ini WAJIB tetap ada selama mode stub aktif. Menghapusnya
              membuat pengguna menyangka autentikasinya sudah aman. Di mode
              identity-platform peringatannya justru tidak boleh muncul --
              kredensial memang sudah diverifikasi. */}
          {cfg.mode === "stub" && (
            <div className="mt-6 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-800">
                <strong>Mode pengembangan.</strong> AUTH_MODE=stub — login tidak memverifikasi
                kredensial, cukup email terdaftar. Jangan gunakan untuk data sungguhan.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
