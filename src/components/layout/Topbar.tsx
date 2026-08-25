"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, LogOut, Mail, Menu } from "lucide-react";
import { logoutAction, setLocaleAction, switchCompanyAction } from "@/lib/actions/auth";
import type { CompanyOption } from "@/lib/session";
import { getDict, LOCALE_SWITCHER_ENABLED, LOCALES, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function LocaleToggle({ locale }: { locale: Locale }) {
  // Disembunyikan sampai dictionary EN lengkap — lihat LOCALE_SWITCHER_ENABLED
  // di src/lib/i18n.ts. Komponennya sengaja dipertahankan, bukan dihapus.
  if (!LOCALE_SWITCHER_ENABLED) return null;
  const d = getDict(locale);
  return (
    <form action={setLocaleAction} className="flex overflow-hidden rounded-md border border-slate-200">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          aria-pressed={locale === l}
          title={d("chrome.language")}
          className={cn(
            "min-h-11 px-3 text-xs font-semibold uppercase md:min-h-0 md:py-1",
            locale === l ? "bg-emerald-700 text-white" : "text-slate-500 hover:bg-slate-50",
          )}
        >
          {l}
        </button>
      ))}
    </form>
  );
}

/**
 * Topbar responsif. Desktop: switcher entitas + toggle bahasa + avatar + logout
 * berjajar. Mobile: hamburger (buka drawer) + label entitas ringkas di kiri; menu
 * akun (switcher + bahasa + logout) dipindah ke dropdown avatar di kanan.
 */
export function Topbar({
  fullName,
  email,
  role,
  activeCompanyId,
  companies,
  locale,
  pendingApprovalCount,
  onMenu,
}: {
  fullName: string;
  email: string;
  role: string;
  activeCompanyId: string | null;
  companies: CompanyOption[];
  locale: Locale;
  pendingApprovalCount: number;
  onMenu?: () => void;
}) {
  const d = getDict(locale);
  const multi = companies.length > 1;
  const [menuOpen, setMenuOpen] = useState(false);
  const entityLabel = activeCompanyId
    ? companies.find((c) => c.companyId === activeCompanyId)?.companyName ?? d("chrome.noEntity")
    : multi
      ? d("chrome.allEntities")
      : companies[0]?.companyName ?? d("chrome.noEntity");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 md:h-16 md:px-6">
      {/* Kiri: hamburger (mobile) + entitas */}
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={onMenu}
          aria-label={d("chrome.openMenu", "Buka menu")}
          className="-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-50 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Building2 className="hidden h-4 w-4 shrink-0 text-emerald-600 md:block" />
        {/* Desktop: switcher / nama entitas */}
        <div className="hidden md:block">
          {multi ? (
            <form action={switchCompanyAction}>
              <label htmlFor="companyId" className="sr-only">{d("chrome.entity", "Entitas")}</label>
              <select
                id="companyId"
                name="companyId"
                defaultValue={activeCompanyId ?? ""}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="">{d("chrome.allEntities")} ({companies.length})</option>
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>{c.companyName}</option>
                ))}
              </select>
            </form>
          ) : (
            <span className="text-sm font-medium text-slate-700">{entityLabel}</span>
          )}
        </div>
        {/* Mobile: label entitas ringkas */}
        <span className="truncate text-sm font-medium text-slate-700 md:hidden">{entityLabel}</span>
      </div>

      {/* Kanan */}
      <div className="flex items-center gap-2 md:gap-3">
        <InstallPrompt locale={locale} />

        <Link
          href="/approval"
          aria-label={`${d("nav.approval.inbox")} — ${pendingApprovalCount} ${d("chrome.approvalPending", "belum ditindaklanjuti")}`}
          title={d("nav.approval.inbox")}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-50 hover:text-emerald-700 md:h-9 md:w-9"
        >
          <Mail className="h-5 w-5" aria-hidden="true" />
          {pendingApprovalCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white md:-right-0.5 md:-top-0.5">
              {pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}
            </span>
          )}
        </Link>

        {/* Desktop: bahasa + avatar + logout berjajar */}
        <div className="hidden items-center gap-3 md:flex">
          <LocaleToggle locale={locale} />
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
              {initials(fullName)}
            </div>
            <div className="text-sm leading-tight">
              <p className="font-medium text-slate-700">{fullName}</p>
              <p className="text-xs text-slate-500">{d(`role.${role}`)}</p>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              title={`${d("chrome.logout")} (${email})`}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              <span>{d("chrome.logout")}</span>
            </button>
          </form>
        </div>

        {/* Mobile: dropdown akun */}
        <div className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={d("chrome.account", "Akun")}
            className="flex h-11 w-11 items-center justify-center rounded-full"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
              {initials(fullName)}
            </span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
              <div role="menu" className="agv-pop absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
                <div className="border-b border-slate-100 pb-2">
                  <p className="text-sm font-semibold text-slate-800">{fullName}</p>
                  <p className="text-xs text-slate-500">{d(`role.${role}`)} · {email}</p>
                </div>
                {multi && (
                  <form action={switchCompanyAction} className="mt-2">
                    <label htmlFor="companyIdMobile" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{d("chrome.entity", "Entitas")}</label>
                    <select
                      id="companyIdMobile"
                      name="companyId"
                      defaultValue={activeCompanyId ?? ""}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="min-h-11 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"
                    >
                      <option value="">{d("chrome.allEntities")} ({companies.length})</option>
                      {companies.map((c) => (
                        <option key={c.companyId} value={c.companyId}>{c.companyName}</option>
                      ))}
                    </select>
                  </form>
                )}
                {LOCALE_SWITCHER_ENABLED && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{d("chrome.language")}</p>
                    <LocaleToggle locale={locale} />
                  </div>
                )}
                <form action={logoutAction} className="mt-3">
                  <button
                    type="submit"
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <LogOut className="h-4 w-4" /> {d("chrome.logout")}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
