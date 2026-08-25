import { redirect } from "next/navigation";
import { getSession, getSessionCompanies } from "@/lib/session";
import { getLocale } from "@/lib/i18n-server";
import { countAllPending } from "@/lib/repo/costing";
import { AppShell } from "./AppShell";

/**
 * Shell aplikasi. Server Component supaya sesi diambil di server dan menjadi
 * satu-satunya sumber identitas yang ditampilkan. Ini juga gerbang autentikasi
 * untuk seluruh grup (app): tanpa sesi, langsung dialihkan ke /login.
 *
 * Komposisi interaktif (drawer mobile, dropdown akun, bottom nav) berada di
 * AppShell (Client Component) yang menerima data sesi dari sini.
 */
export async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [companies, locale, pendingApprovalCount] = await Promise.all([
    getSessionCompanies(session.userId),
    getLocale(),
    countAllPending({
      userId: session.userId,
      role: session.role,
      companyId: session.companyId,
    }),
  ]);

  return (
    <AppShell
      role={session.role}
      locale={locale}
      fullName={session.fullName}
      email={session.email}
      activeCompanyId={session.companyId}
      companies={companies}
      pendingApprovalCount={pendingApprovalCount}
    >
      {children}
    </AppShell>
  );
}
