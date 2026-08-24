"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { getUserRow, setUserActive, deleteUser } from "@/lib/repo/master";

/**
 * Berkas "use server" HANYA boleh mengekspor fungsi async. Nilai awal
 * useActionState karena itu didefinisikan di komponen kliennya, bukan di sini:
 * mengekspor objek dari sini gagal saat RUNTIME dengan
 * 'A "use server" file can only export async functions, found object' —
 * dan `tsc` maupun `lint` TIDAK menangkapnya. Gejalanya HTTP 500 pada setiap
 * POST ke halaman, bukan galat yang menyebut berkas ini.
 *
 * Tipe boleh diekspor: ia terhapus saat kompilasi.
 */
export type ActionState = { ok: boolean | null; message: string };

const idSchema = z.string().uuid("ID pengguna tidak valid");

/**
 * AI-28 · aksi per baris di /pengguna.
 *
 * MUTASI HANYA super_admin, walaupun HALAMANNYA boleh dilihat approver juga
 * (A-09). Melihat daftar pengguna dan mematikan akses orang lain bukan wewenang
 * yang sama; approver yang bisa menonaktifkan super_admin akan menjadi eskalasi
 * hak diam-diam.
 *
 * requireRole ada di baris pertama karena action bisa dipanggil POST langsung —
 * tombol yang tidak dirender bukan penjaga.
 */
function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === "UNAUTHENTICATED") return "Sesi berakhir. Silakan masuk kembali.";
  if (raw === "FORBIDDEN") return "Hanya Super Admin yang boleh mengubah status pengguna.";
  // Trigger 0052.
  if (/super_admin aktif terakhir/.test(raw)) {
    return "Ini super_admin aktif terakhir di entitas ini. Menonaktifkannya membuat tidak ada lagi yang bisa mengelola pengguna — angkat super_admin lain lebih dulu.";
  }
  // 23503 = foreign key violation. Pesan mentahnya menyebut nama constraint,
  // yang tidak berarti apa pun bagi pengguna.
  if (/violates foreign key constraint|23503/.test(raw)) {
    return "Pengguna ini sudah punya riwayat (pencatatan, pengajuan, atau approval), jadi tidak bisa dihapus — menghapusnya akan menghilangkan jejak siapa yang melakukannya. Nonaktifkan saja: efeknya sama bagi akses, riwayatnya tetap utuh.";
  }
  if (/row-level security/.test(raw)) return "Anda tidak berhak mengubah pengguna ini.";
  return raw;
}

export async function setUserActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin");
    const id = idSchema.safeParse(formData.get("id"));
    if (!id.success) return { ok: false, message: "ID pengguna tidak valid." };
    const aktifkan = formData.get("aktifkan") === "1";

    // Menonaktifkan diri sendiri langsung mengunci pelakunya keluar dari
    // halaman ini pada request berikutnya (sesi diperiksa ulang ke DB setiap
    // request). Trigger 0052 hanya menangkapnya bila ia super_admin TERAKHIR,
    // jadi kasus "masih ada super_admin lain" tetap perlu dijaga di sini.
    if (!aktifkan && id.data === ctx.session.userId) {
      return { ok: false, message: "Anda tidak bisa menonaktifkan akun Anda sendiri." };
    }

    const target = await getUserRow(ctx, id.data);
    if (!target) return { ok: false, message: "Pengguna tidak ditemukan pada entitas ini." };
    if (target.isActive === aktifkan) {
      return { ok: false, message: `Pengguna sudah ${aktifkan ? "aktif" : "nonaktif"}.` };
    }

    await setUserActive(ctx, id.data, aktifkan);
    revalidatePath("/pengguna");
    return {
      ok: true,
      message: aktifkan
        ? `${target.fullName} diaktifkan kembali.`
        : `${target.fullName} dinonaktifkan. Sesi yang sedang berjalan berhenti berlaku pada request berikutnya.`,
    };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

export async function deleteUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireRole("super_admin");
    const id = idSchema.safeParse(formData.get("id"));
    if (!id.success) return { ok: false, message: "ID pengguna tidak valid." };
    if (id.data === ctx.session.userId) {
      return { ok: false, message: "Anda tidak bisa menghapus akun Anda sendiri." };
    }

    const target = await getUserRow(ctx, id.data);
    if (!target) return { ok: false, message: "Pengguna tidak ditemukan pada entitas ini." };
    // Wajib nonaktif lebih dulu: dua langkah, bukan satu klik yang tidak bisa
    // dibatalkan. Nonaktifkan sudah menutup akses, jadi tidak ada yang mendesak.
    if (target.isActive) {
      return { ok: false, message: "Nonaktifkan dulu sebelum menghapus — penghapusan tidak bisa dibatalkan." };
    }

    await deleteUser(ctx, id.data);
    revalidatePath("/pengguna");
    return { ok: true, message: `${target.fullName} dihapus beserta hak akses entitas & estate-nya.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}
