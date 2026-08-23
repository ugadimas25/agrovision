/**
 * Excel (HTML ber-MIME Excel) yang SETIA pada Master Laporan:
 *  - header block 2-kolom (bukan tabel "Field/Nilai"),
 *  - Status berwarna sesuai kode (OK/Perhatian/Kritis/Belum/Usulan),
 *  - kolom modul hijau (eksisting) / biru (rekomendasi).
 * Dipakai route ekspor Excel dashboard & modul.
 */
import { STATUS_COLOR, STATUS_LABEL, type DashboardReport, type ModuleReport } from "./types";

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const fmtDate = (d: Date) => { try { return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(d); } catch { return d.toISOString().slice(0, 10); } };
const fmtDateTime = (d: Date) => { try { return new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short" }).format(d); } catch { return d.toISOString(); } };

function shell(title: string, bodyInner: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${esc(title)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  body{font-family:Arial,sans-serif;color:#1e293b}
  h1{color:#1a6c2c;margin:0;font-size:16pt}
  .sub{color:#5c5a55;margin:2px 0 6px}
  .meta{border-collapse:collapse;margin:6px 0}
  .meta td{border:none;padding:2px 6px 2px 0;font-size:10pt;vertical-align:top}
  .lbl{color:#17512a;font-weight:bold}
  .src{color:#a8a49a;font-size:9pt;margin:2px 0 10px}
  table.data{border-collapse:collapse;font-size:10pt}
  table.data th{color:#fff;padding:5px;text-align:left;vertical-align:top}
  table.data td{border:1px solid #d0d7de;padding:4px 5px;vertical-align:top}
  h2{color:#17512a;font-size:12pt;margin:14px 0 4px}
  .note{color:#a8a49a;font-size:9pt;margin:4px 0}
  .visual{color:#2563eb;font-size:9pt;margin:2px 0}
</style></head>
<body>
${bodyInner}
</body></html>`;
}

function metaBlock(m: DashboardReport["meta"]): string {
  const pairs: [string, string, string, string][] = [
    ["Entitas / Estate", m.entity, "Status data", m.dataStatus],
    ["Periode laporan", m.period, "Tanggal cetak", fmtDate(m.printedAt)],
    ["Lingkup blok", m.blockScope, "Disusun oleh", "________________"],
    ["Komoditas", m.commodity, "Diketahui", "________________"],
  ];
  const rows = pairs.map(([l1, v1, l2, v2]) =>
    `<tr><td class="lbl">${esc(l1)}</td><td>${esc(v1)}</td><td style="width:32px"></td><td class="lbl">${esc(l2)}</td><td>${esc(v2)}</td></tr>`).join("");
  return `<h1>AgroVision — ${esc(m.title)}</h1>
    <div class="sub">${esc(m.subtitle)}</div>
    <div style="color:#5c5a55;font-size:9pt;margin-bottom:4px">${esc(m.entity)} · Dicetak: ${esc(fmtDateTime(m.printedAt))}</div>
    <table class="meta">${rows}</table>
    <div class="src">Sumber: ${esc(m.source)}</div>`;
}

const numCell = (v: number) => `<td style="text-align:right;mso-number-format:'General'">${v}</td>`;

// ── Dashboard ───────────────────────────────────────────────────────────────
export function dashboardExcelHtml(report: DashboardReport): string {
  const { meta, indicators, insights } = report;
  const indHead = ["No", "Tahap / Kelompok", "Indikator", "Nilai", "Satuan", "Status", "Tindak lanjut", "Detail / modul"]
    .map((h, i) => `<th style="background:#1a6c2c;${i === 3 ? "text-align:right" : ""}">${esc(h)}</th>`).join("");
  const indRows = indicators.map((ind, i) => {
    const c = STATUS_COLOR[ind.status];
    return `<tr>${numCell(i + 1)}<td style="font-weight:bold">${esc(ind.group ?? "")}</td><td>${esc(ind.indicator)}</td>`
      + `<td style="text-align:right">${esc(ind.value)}</td><td>${esc(ind.unit)}</td>`
      + `<td style="background:${c.bg};color:${c.fg};font-weight:bold;border:1px solid ${c.border}">${esc(STATUS_LABEL[ind.status])}</td>`
      + `<td>${esc(ind.followUp)}</td><td>${esc(ind.detail)}</td></tr>`;
  }).join("");
  const insHead = ["No", "Temuan (kesimpulan)", "Rekomendasi tindak lanjut", "Prioritas · PIC"]
    .map((h) => `<th style="background:#1a6c2c">${esc(h)}</th>`).join("");
  const insRows = insights.map((ins, i) =>
    `<tr>${numCell(i + 1)}<td>${esc(ins.finding)}</td><td>${esc(ins.recommendation)}</td><td style="font-weight:bold">${esc(`${ins.priority} · ${ins.pic}`)}</td></tr>`).join("");

  const body = metaBlock(meta)
    + `<table class="data"><thead><tr>${indHead}</tr></thead><tbody>${indRows}</tbody></table>`
    + (meta.note ? `<div class="note">Catatan: ${esc(meta.note)}</div>` : "")
    + (insights.length ? `<h2>Insight &amp; Rekomendasi Tindak Lanjut</h2><table class="data"><thead><tr>${insHead}</tr></thead><tbody>${insRows}</tbody></table>` : "");
  return shell(meta.title, body);
}

// ── Modul ───────────────────────────────────────────────────────────────────
/**
 * AI-47: `kpis` opsional — angka ringkas yang tampil di atas tabel LAYAR. Tanpa
 * ini unduhan kehilangan justru angka yang paling dibaca manajemen, dan klaim
 * "ekspor tidak berbeda dari layar" hanya berlaku untuk tabelnya.
 */
export function moduleExcelHtml(report: ModuleReport, kpis?: { label: string; value: string }[]): string {
  const { meta, columns, rows, visual } = report;
  const kpiBlock = kpis?.length
    ? `<h2>Ringkasan</h2><table class="data"><tbody>${kpis
        .map((k) => `<tr><td class="lbl">${esc(k.label)}</td><td style="font-weight:bold">${esc(k.value)}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  const head = columns.map((c) =>
    `<th style="background:${c.kind === "new" ? "#2563eb" : "#1a6c2c"};${c.align === "right" ? "text-align:right" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows.map((row) =>
    `<tr>${row.map((cell, ci) => {
      const col = columns[ci];
      const isNum = typeof cell === "number";
      const style = `${col.align === "right" ? "text-align:right;" : ""}${col.kind === "new" ? "background:#eff6ff;color:#45443f;" : ""}`;
      return `<td style="${style}">${isNum ? cell : esc(cell === "" || cell === null ? "—" : cell)}</td>`;
    }).join("")}</tr>`).join("");

  const legend = `<div class="note">■ Header hijau = kolom eksisting &nbsp; ■ Header biru = rekomendasi tambahan (baru), digabung langsung.</div>`;
  const inner = metaBlock(meta)
    + kpiBlock
    + `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${columns.length}">Belum ada data.</td></tr>`}</tbody></table>`
    + legend
    + (visual ? `<div class="visual">Visual pendamping: ${esc(visual)}</div>` : "")
    + (meta.note ? `<div class="note">Catatan: ${esc(meta.note)}</div>` : "");
  return shell(meta.title, inner);
}
