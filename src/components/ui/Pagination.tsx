import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/**
 * Paginasi di level SERVER.
 *
 * Navigasi lewat searchParams, bukan state klien — sehingga halaman bisa
 * di-bookmark, di-refresh, dan tidak pernah memuat seluruh tabel ke browser.
 * concept:49 menuntut ini pada skala ~3.300 blok.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  /**
   * Parameter yang ikut dibawa ke halaman berikutnya.
   *
   * Nilai ARRAY diizinkan karena filter bersama (AI-24/K-08) memakai parameter
   * BERULANG: `?blok=a&blok=b`. Dengan `set()` saja, hanya nilai terakhir yang
   * terbawa -- pengguna memilih tiga blok, pindah ke halaman 2, dan diam-diam
   * tinggal satu blok. Karena itu array di-`append`, bukan di-`set`.
   */
  params?: Record<string, string | string[] | undefined>;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) { for (const x of v) if (x) sp.append(k, x); }
      else if (v) sp.set(k, v);
    }
    if (p > 1) sp.set("page", String(p));
    const q = sp.toString();
    return q ? `${basePath}?${q}` : basePath;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
      <p className="text-xs text-slate-500">
        {total === 0 ? (
          "Tidak ada data"
        ) : (
          <>
            Menampilkan <span className="font-medium text-slate-700">{formatNumber(from)}</span>–
            <span className="font-medium text-slate-700">{formatNumber(to)}</span> dari{" "}
            <span className="font-medium text-slate-700">{formatNumber(total)}</span>
          </>
        )}
      </p>

      {lastPage > 1 && (
        <nav aria-label="Paginasi" className="flex items-center gap-1">
          <PageLink href={href(page - 1)} disabled={page <= 1} label="Sebelumnya">
            <ChevronLeft className="h-4 w-4" />
          </PageLink>
          <span className="px-2 text-xs tabular-nums text-slate-500">
            {page} / {lastPage}
          </span>
          <PageLink href={href(page + 1)} disabled={page >= lastPage} label="Berikutnya">
            <ChevronRight className="h-4 w-4" />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const cls = cn(
    "flex h-8 w-8 items-center justify-center rounded-md border text-slate-500",
    disabled ? "cursor-not-allowed border-slate-100 text-slate-300" : "border-slate-200 hover:bg-slate-50",
  );
  if (disabled) {
    return (
      <span aria-disabled="true" aria-label={label} className={cls}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cls}>
      {children}
    </Link>
  );
}
