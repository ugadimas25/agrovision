"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";
import type { Locale } from "@/lib/i18n";
import type { CompanyOption } from "@/lib/session";

/**
 * Shell klien: memegang state drawer (sidebar off-canvas di mobile) yang dibagi
 * antara Topbar (tombol hamburger) dan Sidebar (drawer). Desktop tetap sidebar
 * permanen. Drawer tertutup otomatis saat pindah halaman, tekan Esc, tap overlay,
 * dengan focus-trap sederhana.
 */
export function AppShell({
  role, locale, fullName, email, activeCompanyId, companies, pendingApprovalCount, children,
}: {
  role: string;
  locale: Locale;
  fullName: string;
  email: string;
  activeCompanyId: string | null;
  companies: CompanyOption[];
  /** null = role bukan approver/super_admin, badge disembunyikan (bukan angka 0). */
  pendingApprovalCount: number | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Drawer ditutup setelah navigasi lewat onClose pada tiap link Sidebar (mobile).

  // Esc menutup + focus-trap dalam drawer (mobile). Kunci scroll body saat terbuka.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const drawer = document.getElementById("app-drawer");
    const list = () =>
      drawer
        ? Array.from(
            drawer.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),select,[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    list()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "Tab") return;
      const f = list();
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open]);

  return (
    <div className="flex h-[100dvh] bg-slate-50">
      {open && (
        <div
          className="agv-fade fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      <Sidebar role={role} locale={locale} open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          fullName={fullName}
          email={email}
          role={role}
          activeCompanyId={activeCompanyId}
          companies={companies}
          pendingApprovalCount={pendingApprovalCount}
          locale={locale}
          onMenu={() => setOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6 md:pb-6">
          {children}
        </main>
        <BottomNav role={role} locale={locale} onMenu={() => setOpen(true)} />
      </div>
    </div>
  );
}
