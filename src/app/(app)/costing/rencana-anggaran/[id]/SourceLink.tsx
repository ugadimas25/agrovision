import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/** Potongan sumber yang menempel pada baris RAB / asumsi yang mengutipnya. */
export type SourceRef = {
  id: string;
  code: string;
  title: string;
  url: string | null;
};

/**
 * Satu kutipan, dirender sesuai apa yang benar-benar ada.
 *
 * Punya URL  → tautan yang bisa diklik, dibuka di tab baru.
 * Tanpa URL  → teks biasa, dan barisnya MENYEBUTKAN bahwa ia tanpa tautan.
 *
 * Bedanya bukan kosmetik. Tautan yang tidak menuju ke mana pun mengaku bisa
 * diperiksa ulang, dan pengakuan palsu itu lebih menyesatkan daripada sumber
 * yang jujur mengatakan dirinya keputusan rapat. Sengaja SATU komponen dipakai
 * layar RAB dan panel asumsi, supaya keduanya tidak bisa menyimpang.
 *
 * Tanpa "use client": tidak ada interaksi di sini, jadi ia tetap dirender di
 * server saat dipakai halaman RAB, dan ikut bundel hanya saat dipakai panel
 * yang memang client component.
 */
export function SourceLink({ source, className }: { source: SourceRef; className?: string }) {
  const teks = `${source.code} — ${source.title}`;

  if (source.url === null) {
    return (
      <span className={cn("text-slate-500", className)}>
        {teks} <span className="text-slate-400">(tanpa tautan)</span>
      </span>
    );
  }

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-baseline gap-1 text-emerald-700 underline decoration-emerald-200 underline-offset-2 hover:decoration-emerald-500",
        className,
      )}
    >
      {teks}
      <ExternalLink className="h-3 w-3 shrink-0 self-center" aria-hidden />
    </a>
  );
}
