"use client";

import { useActionState } from "react";
import { UserMinus, UserCheck, Trash2 } from "lucide-react";
import { setUserActiveAction, deleteUserAction, type ActionState } from "@/lib/actions/users";

// Didefinisikan di sisi klien: berkas "use server" hanya boleh mengekspor fungsi.
const AWAL: ActionState = { ok: null, message: "" };

/**
 * AI-28 · aksi per baris pengguna (D-04/catatan 9.1–9.2).
 *
 * Tiga hal yang sengaja begini:
 *
 *   1. Form biasa dengan hidden input, bukan tombol ber-onClick. Aksinya
 *      tereksekusi walau JavaScript mati — pola yang sama dengan form lain di
 *      aplikasi ini.
 *   2. "Hapus" hanya muncul untuk pengguna yang SUDAH nonaktif. Dua langkah,
 *      bukan satu klik yang tidak bisa dibatalkan; dan menonaktifkan sudah
 *      menutup akses, jadi tidak ada yang mendesak.
 *   3. Barisnya sendiri tidak menjanjikan penghapusan akan berhasil. Pengguna
 *      yang punya riwayat ditolak database (59 FK NO ACTION) dan action
 *      menerjemahkannya menjadi saran "nonaktifkan saja" — memeriksa 59 tabel
 *      lebih dulu hanya untuk menyembunyikan tombol tidak sepadan, dan tetap
 *      bisa salah.
 */
export function UserRowActions({
  userId, isActive, isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const [statusState, statusAction, statusPending] = useActionState(setUserActiveAction, AWAL);
  const [hapusState, hapusAction, hapusPending] = useActionState(deleteUserAction, AWAL);
  const pesan = statusState.message || hapusState.message;
  const gagal = (statusState.message && statusState.ok === false) || (hapusState.message && hapusState.ok === false);

  if (isSelf) {
    // Akun sendiri: tidak ada aksi, dan alasannya ditulis. Tombol yang ada tapi
    // selalu ditolak lebih membingungkan daripada tidak ada tombol.
    return <span className="text-xs text-slate-400">akun Anda sendiri</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <form action={statusAction}>
          <input type="hidden" name="id" value={userId} />
          <input type="hidden" name="aktifkan" value={isActive ? "0" : "1"} />
          <button
            type="submit"
            disabled={statusPending}
            data-testid={isActive ? "nonaktifkan-pengguna" : "aktifkan-pengguna"}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {isActive
              ? <><UserMinus className="h-3.5 w-3.5" /> Nonaktifkan</>
              : <><UserCheck className="h-3.5 w-3.5" /> Aktifkan</>}
          </button>
        </form>
        {!isActive && (
          <form action={hapusAction}>
            <input type="hidden" name="id" value={userId} />
            <button
              type="submit"
              disabled={hapusPending}
              data-testid="hapus-pengguna"
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Hapus
            </button>
          </form>
        )}
      </div>
      {pesan && (
        <p className={gagal ? "text-xs leading-relaxed text-red-600" : "text-xs leading-relaxed text-emerald-700"}>{pesan}</p>
      )}
    </div>
  );
}
