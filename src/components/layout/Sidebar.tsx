"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Map, Sprout, Shovel, Compass, FlaskConical, Scissors,
  ClipboardList, Cloud, BadgeCheck, GitBranch, Wallet, PiggyBank,
  FileBarChart2, Database, Users, Leaf, ChevronDown,
  SprayCan, Wheat, Wrench, TreePine, Calculator, TrendingUp, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDict, type Locale } from "@/lib/i18n";

/**
 * Navigasi mengikuti IA hasil meeting 30-07-2026 (docs/11): regrouping menjadi
 * Dashboard (×3), Pra-Tanam, Aktivitas Kebun, Agri-Input, Keberlanjutan,
 * Akuntansi, Report (+ Pengaturan). Inbox Approval berada di Topbar.
 *
 * Sifat:
 *   - grup bisa dilipat (accordion) — status per-grup di state klien;
 *   - label & judul grup dari dictionary i18n (bilingual);
 *   - item bertanda ready:false = "coming soon" (tidak bisa diklik).
 */

type Item = { href: string; key: string; icon: typeof LayoutDashboard; ready?: boolean; roles?: string[] };
type Group = { key: string | null; items: Item[] };

/**
 * MATRIKS PERAN → MENU (AI-27a, akar masalah AKAR-4 di docs/13).
 *
 * Sebelum ini tidak ada SATU pun item ber-`roles`, jadi filter di bawah (cari
 * `i.roles.includes(role)`) tidak pernah membuang apa pun: petugas lapangan
 * melihat seluruh menu. Aturannya sekarang: item tanpa `roles` terbuka untuk
 * keempat peran, dan yang dibatasi HANYA yang punya dua-duanya —
 * (a) dasar yang bisa ditunjuk, dan (b) route yang benar-benar dipagari.
 *
 * Aturan (b) itu bukan formalitas. Menyembunyikan menu tanpa memagari route
 * hanya menghapus discoverability, bukan akses: URL-nya tetap bisa ditempel dan
 * halamannya tetap merender seluruh datanya. Karena itu daftar di bawah sengaja
 * PENDEK — hanya dua item, keduanya route-nya dipagari `requirePageRole()`.
 *
 * | Menu                  | SA | AP | CR | VW | Dasar |
 * |-----------------------|----|----|----|----|-------|
 * | Pengaturan › Master Data | v | - | - | - | QA A-05 (lulus): approver pun tidak boleh menambah/menonaktifkan. Route dipagari di master-data/page.tsx |
 * | Pengguna & Akses      | v  | v  | -  | -  | Mengikuti aturan yang sudah berlaku di pengguna/page.tsx. Route dipagari |
 *
 * SELURUH item lain sengaja TIDAK dibatasi:
 *   - Modul operasional/aktivitas/agri-input/keberlanjutan: viewer wajib bisa
 *     MEMBACA setiap modul (QA A-03, lulus) dan creator memang menulis di sana
 *     (requireRole("creator",…) di src/lib/actions/operational.ts).
 *   - /approval: creator boleh MEMBUKA (QA A-04, lulus); yang digate adalah
 *     tombol Setujui/Tolak, bukan halamannya.
 *   - Layar uang (Dashboard Finansial, Refleksi Biaya, Revenue, Anggaran):
 *     membatasinya dari creator TERDENGAR wajar, tapi belum boleh dilakukan di
 *     sini. Tiga alasan: (1) route-nya belum dipagari, jadi hasilnya cuma
 *     menyembunyikan; (2) angka yang sama masih terbaca lewat /laporan/keuangan
 *     beserta /pdf dan /excel, jadi pembatasannya harus mencakup
 *     src/lib/report/registry.ts — bukan hanya sidebar; (3) QA E-01/E-02/F-01
 *     saat ini bertuliskan Role "Semua" dan berstatus lulus, jadi membatasinya
 *     tanpa merevisi sheet akan melaporkan kegagalan palsu. Kerjakan satu paket
 *     bersama AI-44/AI-47, dengan keputusan pemilik produk.
 *
 * CATATAN JUJUR (temuan sampingan, belum ada itemnya): harga beli aset di
 * Agri-Input BELUM digate. `agri-input/chemical/page.tsx` dan
 * `equipment/page.tsx` memakai canWrite = [creator, approver, super_admin] dan
 * field "Harga beli (Rp)" ikut di dalam form yang sama, padahal K-06 Keputusan 3
 * menyatakan harga = super_admin saja. Itu celah tersendiri, bukan alasan
 * membatasi menunya.
 */
const SUPER_ADMIN_SAJA = ["super_admin"];
const SUPER_ADMIN_APPROVER = ["super_admin", "approver"];

const GROUPS: Group[] = [
  {
    key: "nav.group.dashboard",
    items: [
      { href: "/dashboard", key: "nav.dashboard.operational", icon: LayoutDashboard, ready: true },
      { href: "/dashboard/sustainability", key: "nav.dashboard.sustainability", icon: Leaf, ready: true },
      { href: "/dashboard/financial", key: "nav.dashboard.financial", icon: Wallet, ready: true },
    ],
  },
  {
    key: "nav.group.prefarming",
    items: [
      { href: "/operasional/kesesuaian-lahan", key: "nav.suitability", icon: Compass, ready: true },
      { href: "/operasional/persiapan-lahan", key: "nav.landprep", icon: Shovel, ready: true },
      { href: "/nursery", key: "nav.nursery", icon: Sprout, ready: true },
      // Rapat Fadli 26 Agu 2026: aktivitas TANAM belum pernah ter-record
      // padahal ada biayanya (tenaga kerja + transport bibit ke lahan).
      // Urutannya sengaja setelah Pembibitan: bibit disemai dulu, baru ditanam.
      { href: "/operasional/penanaman", key: "nav.planting", icon: Sprout, ready: false },
    ],
  },
  {
    key: "nav.group.activities",
    items: [
      { href: "/aktivitas/weeding", key: "nav.weeding", icon: Sprout, ready: true },
      { href: "/operasional/pemupukan", key: "nav.fertilizer", icon: FlaskConical, ready: true },
      { href: "/operasional/pruning", key: "nav.pruning", icon: Scissors, ready: true },
      { href: "/aktivitas/spraying", key: "nav.spraying", icon: SprayCan, ready: true },
      { href: "/aktivitas/panen", key: "nav.harvesting", icon: Wheat, ready: true },
      { href: "/survei", key: "nav.survey", icon: ClipboardList, ready: true },
    ],
  },
  {
    key: "nav.group.sustainability",
    items: [
      { href: "/keberlanjutan/karbon", key: "nav.carbon", icon: Cloud, ready: true },
      { href: "/keberlanjutan/sertifikasi", key: "nav.certification", icon: BadgeCheck, ready: true },
      { href: "/keberlanjutan/traceability", key: "nav.traceability", icon: GitBranch, ready: true },
      { href: "/keberlanjutan/deforestation", key: "nav.deforestation", icon: TreePine, ready: false },
      { href: "/operasional/blok", key: "nav.blocks", icon: Map, ready: true },
    ],
  },
  {
    key: "nav.group.accounting",
    items: [
      // Rapat Fadli 26 Agu 2026: RAB disusun agronomis SEBELUM anggaran ada.
      // Ditaruh paling atas karena urutannya memang mendahului yang lain --
      // rencana → master anggaran → realisasi. Sengaja TANPA `roles`: seluruh
      // peran boleh MELIHAT rencana anggaran entitasnya; yang dibatasi adalah
      // menyusun (agronomist) dan memutuskan (approver), dan itu ditegakkan
      // policy migrasi 0060, bukan dengan menyembunyikan menunya.
      { href: "/costing/rencana-anggaran", key: "nav.budgetplan", icon: ClipboardList, ready: true },
      { href: "/costing/refleksi", key: "nav.reflection", icon: Calculator, ready: true },
      { href: "/costing/pengeluaran", key: "nav.expenditure", icon: Wallet, ready: true },
      { href: "/costing/pendapatan", key: "nav.revenue", icon: TrendingUp, ready: true },
      { href: "/costing/anggaran", key: "nav.budget", icon: PiggyBank, ready: true },
    ],
  },
  {
    key: "nav.group.report",
    items: [
      { href: "/laporan/operasional", key: "nav.report.operational", icon: FileBarChart2, ready: true },
      { href: "/laporan/keuangan", key: "nav.report.financial", icon: FileBarChart2, ready: true },
      { href: "/laporan/keberlanjutan", key: "nav.report.sustainability", icon: FileBarChart2, ready: true },
      { href: "/laporan", key: "nav.report.all", icon: FileBarChart2, ready: true },
    ],
  },
  {
    key: "nav.group.settings",
    items: [
      // QA A-05 (lulus): halaman ini khusus super_admin. Sama dengan gate route
      // di src/app/(app)/pengaturan/master-data/page.tsx. Labelnya berubah jadi
      // "Konfigurasi" (rapat Fadli 26 Agu 2026); ROUTE-nya sengaja tidak ikut
      // diganti -- tautan yang sudah beredar dan scripts/at-verify.mjs memakai
      // /pengaturan/master-data, dan mengganti alamat bukan bagian dari
      // keputusan rapat itu.
      { href: "/pengaturan/master-data", key: "nav.masterdata", icon: Database, ready: true, roles: SUPER_ADMIN_SAJA },
      // Agri-Input tidak lagi jadi grup sendiri: isinya katalog (jenis pupuk,
      // ukuran, alat), bukan aktivitas harian, jadi tempatnya di Pengaturan.
      { href: "/agri-input/chemical", key: "nav.chemical", icon: FlaskConical, ready: true },
      { href: "/agri-input/equipment", key: "nav.equipment", icon: Wrench, ready: true },
      // Mengikuti gate route di src/app/(app)/pengguna/page.tsx.
      { href: "/pengguna", key: "nav.users", icon: Users, ready: true, roles: SUPER_ADMIN_APPROVER },
    ],
  },
];

export function Sidebar({
  role, locale, open = false, onClose,
}: {
  role: string;
  locale: Locale;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const d = getDict(locale);

  // Item aktif = href PALING SPESIFIK yang cocok, supaya /dashboard tidak ikut
  // aktif saat berada di /dashboard/sustainability.
  const activeHref = GROUPS.flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];

  // K-10 (docs/13 §2): setelah login TIDAK ada grup yang terbuka. Karena itu
  // state-nya `expanded` (default kosong = semua tertutup), bukan `collapsed` —
  // dengan `collapsed` kosong, `!collapsed[key]` justru membuka semuanya.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((s) => ({ ...s, [k]: !s[k] }));

  return (
    <aside
      id="app-drawer"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-700 p-1.5">
            <Leaf className="h-5 w-5 text-white" />
          </div>
          <span className="text-base font-bold text-slate-800">AgroVision</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={d("common.close", "Tutup")}
          className="-mr-1.5 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {GROUPS.map((group, gi) => {
          const items = group.items.filter((i) => !i.roles || i.roles.includes(role));
          if (items.length === 0) return null;
          // AI-33 (catatan 1.2): grup yang memuat halaman aktif kini BISA
          // ditutup — dulu `hasActive` memaksa isOpen sehingga tombolnya seperti
          // rusak. hasActive tetap dihitung untuk penanda titik pada header
          // tertutup, supaya orientasi tidak hilang saat semua grup tertutup
          // (konsekuensi K-10 yang dicatat di keputusannya).
          const hasActive = items.some((i) => i.href === activeHref);
          const isOpen = !group.key || Boolean(expanded[group.key]);

          return (
            <div key={group.key ?? `standalone-${gi}`} className="mb-2">
              {group.key && (
                <button
                  type="button"
                  onClick={() => toggle(group.key!)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between rounded-md px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-600"
                >
                  <span className="flex items-center gap-1.5">
                    {d(group.key)}
                    {/* Titik emerald = halaman aktif ada di dalam grup yang sedang
                        tertutup. Tanpa ini, dengan semua grup tertutup (K-10),
                        pengguna kehilangan jejak sedang berada di mana. */}
                    {hasActive && !isOpen && (
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    )}
                  </span>
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")} />
                </button>
              )}
              {isOpen && (
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = item.href === activeHref;
                    const label = d(item.key);
                    if (!item.ready) {
                      return (
                        <li key={item.href}>
                          <span
                            aria-disabled="true"
                            title={d("chrome.stubHint")}
                            className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-slate-300"
                          >
                            <span className="flex items-center gap-2.5"><Icon className="h-4 w-4" />{label}</span>
                            <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-500">{d("chrome.stub")}</span>
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors md:min-h-0",
                            active ? "border-l-2 border-brand-500 bg-brand-50 text-brand-700" : "border-l-2 border-transparent text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          <Icon className="h-4 w-4" />{label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
        {d("chrome.footer")}<br />{d("chrome.footerStub")}
      </div>
    </aside>
  );
}
