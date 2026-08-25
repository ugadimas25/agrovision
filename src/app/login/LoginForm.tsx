"use client";

import { startTransition, useActionState, useState } from "react";
import { Mail, KeyRound, Loader2, CircleAlert } from "lucide-react";
import { loginAction, type AuthState } from "@/lib/actions/auth";

const initialState: AuthState = { ok: false, message: "" };

/**
 * Form masuk — dua mode (B-27).
 *
 * identity-platform: kata sandi ditukar LANGSUNG ke Identity Platform dari
 *   peramban; yang sampai ke server AgroVision hanyalah ID token-nya. Kata
 *   sandi karena itu tidak pernah melewati server ini, tidak pernah masuk log
 *   Cloud Run, dan tidak pernah ada di body Server Action.
 * stub: kolom kata sandinya tidak ada sama sekali, karena memang tidak ada yang
 *   diverifikasi. Menampilkan kolom kata sandi yang diabaikan akan menjadi
 *   kebohongan antarmuka.
 */
type Props = { mode: "identity-platform" | "stub"; apiKey?: string };

const SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

/**
 * Pesan galat Identity Platform -> Bahasa Indonesia.
 *
 * EMAIL_NOT_FOUND dan INVALID_PASSWORD sengaja dipetakan ke KALIMAT YANG SAMA:
 * membedakannya memberi tahu penyerang email mana yang terdaftar (enumerasi
 * akun) — persis kebocoran yang login stub lama punya secara bawaan.
 */
function idpMessage(code: unknown): string {
  const c = typeof code === "string" ? code : "";
  if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|MISSING_PASSWORD/.test(c)) {
    return "Email atau kata sandi salah.";
  }
  if (c.startsWith("USER_DISABLED")) return "Akun ini dinonaktifkan. Hubungi super admin.";
  if (c.startsWith("TOO_MANY_ATTEMPTS_TRY_LATER")) {
    return "Terlalu banyak percobaan masuk. Tunggu beberapa saat lalu coba lagi.";
  }
  if (c.startsWith("INVALID_EMAIL")) return "Format email tidak valid.";
  return "Gagal menghubungi Identity Platform. Periksa koneksi lalu coba lagi.";
}

async function fetchIdToken(apiKey: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${SIGN_IN_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  const data: unknown = await res.json().catch(() => null);
  const body = (data ?? {}) as { idToken?: unknown; error?: { message?: unknown } };

  if (!res.ok) throw new Error(idpMessage(body.error?.message));
  if (typeof body.idToken !== "string" || body.idToken.length === 0) {
    throw new Error("Identity Platform tidak mengembalikan ID token.");
  }
  return body.idToken;
}

export function LoginForm({ mode, apiKey }: Props) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [clientError, setClientError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const busy = pending || signingIn;
  const message = clientError || (state.ok ? "" : state.message);

  async function handleIdentityPlatform(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError("");

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setSigningIn(true);
    let idToken: string;
    try {
      idToken = await fetchIdToken(apiKey ?? "", email, password);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Gagal masuk.");
      return;
    } finally {
      setSigningIn(false);
    }

    // Hanya token yang dikirim ke Server Action — kata sandinya tidak ikut.
    // formAction dipanggil dari event handler, jadi harus di dalam transition:
    // di luar transition React 19 menolaknya saat runtime.
    const payload = new FormData();
    payload.set("idToken", idToken);
    startTransition(() => formAction(payload));
  }

  return (
    <form
      action={mode === "stub" ? formAction : undefined}
      onSubmit={mode === "identity-platform" ? handleIdentityPlatform : undefined}
      className="space-y-4"
    >
      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-slate-500">
          Email
        </label>
        <div className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 focus-within:ring-2 focus-within:ring-emerald-500/30">
          <Mail className="h-4 w-4 text-slate-500" />
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue=""
            placeholder="nama@perusahaan.co.id"
            aria-describedby={message ? "login-error" : undefined}
            className="w-full text-sm text-slate-700 outline-none"
          />
        </div>
      </div>

      {mode === "identity-platform" && (
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-500">
            Kata sandi
          </label>
          <div className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 focus-within:ring-2 focus-within:ring-emerald-500/30">
            <KeyRound className="h-4 w-4 text-slate-500" />
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              aria-describedby={message ? "login-error" : undefined}
              className="w-full text-sm text-slate-700 outline-none"
            />
          </div>
        </div>
      )}

      {message && (
        <p
          id="login-error"
          role="alert"
          className="flex items-start gap-1.5 text-xs leading-relaxed text-red-600"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? "Memverifikasi..." : "Masuk"}
      </button>
    </form>
  );
}
