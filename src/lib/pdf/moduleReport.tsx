/**
 * PDF generik untuk laporan MODUL (Master Laporan sheet 01–15): header block +
 * tabel (header hijau=eksisting / biru=rekomendasi) + legenda + Visual pendamping
 * + Catatan. A4 landscape. Server-only (@react-pdf).
 */
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { ModuleReport } from "@/lib/report/types";

const C = { green: "#1a6c2c", greenDark: "#17512a", blue: "#2563eb", text: "#1e293b", muted: "#5c5a55", faint: "#a8a49a", border: "#e5e2da", zebra: "#f7f6f2", blueBg: "#eff6ff" };

const st = StyleSheet.create({
  page: { paddingTop: 74, paddingBottom: 38, paddingHorizontal: 26, fontSize: 7.5, color: C.text, fontFamily: "Helvetica" },
  header: { position: "absolute", top: 0, left: 0, right: 0, height: 54, backgroundColor: C.green, paddingHorizontal: 26, paddingTop: 11, flexDirection: "row", justifyContent: "space-between" },
  accent: { position: "absolute", top: 54, left: 0, right: 0, height: 3, backgroundColor: "#4f9d5d" },
  brand: { color: "#fff", fontSize: 14, fontFamily: "Helvetica-Bold" },
  hSub: { color: "#d7e8d9", fontSize: 7.5, marginTop: 2 },
  hRight: { color: "#eef6ef", fontSize: 7, textAlign: "right", marginBottom: 1.5 },
  metaWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 5 },
  metaCell: { width: "50%", flexDirection: "row", marginBottom: 2 },
  metaLabel: { width: 90, color: C.faint },
  metaVal: { flex: 1, fontFamily: "Helvetica-Bold" },
  source: { fontSize: 6.5, color: C.faint, marginBottom: 5 },
  hcell: { paddingVertical: 3, paddingHorizontal: 3, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 6.5 },
  cell: { paddingVertical: 2.5, paddingHorizontal: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.border },
  legend: { fontSize: 6.5, color: C.muted, marginTop: 5 },
  visual: { fontSize: 6.5, color: C.blue, marginTop: 2 },
  note: { fontSize: 6.5, color: C.faint, marginTop: 2, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 16, left: 26, right: 26, flexDirection: "row", justifyContent: "space-between", fontSize: 6.5, color: C.faint, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 4 },
  swatch: { width: 6, height: 6, borderRadius: 1, marginRight: 3 },
});

function s(v: unknown): string {
  return String(v ?? "").replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080)).replace(/[²]/g, "2").replace(/[³]/g, "3").replace(/[→➔]/g, "->").replace(/·/g, "-").replace(/✓/g, "");
}
function fmt(d: Date): string {
  try { return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(d); } catch { return d.toISOString().slice(0, 10); }
}

/**
 * AI-47: `kpis` opsional — angka ringkas yang tampil di atas tabel LAYAR, supaya
 * unduhan tidak kehilangan angka yang paling dibaca manajemen.
 */
export function ModuleReportPdf({ report, kpis }: { report: ModuleReport; kpis?: { label: string; value: string }[] }) {
  const { meta, columns, rows, visual } = report;
  const metaRows: [string, string][] = [
    ["Entitas / Estate", meta.entity], ["Status data", meta.dataStatus],
    ["Periode", meta.period], ["Tanggal cetak", fmt(meta.printedAt)],
    ["Lingkup", meta.blockScope], ["Disusun oleh", "________________"],
    ["Komoditas", meta.commodity], ["Diketahui", "________________"],
  ];
  return (
    <Document title={`${meta.title} — AgroVision`} author="AgroVision">
      <Page size="A4" orientation="landscape" style={st.page}>
        <View style={st.header} fixed>
          <View><Text style={st.brand}>AgroVision</Text><Text style={st.hSub}>{s(meta.title)}</Text></View>
          <View><Text style={st.hRight}>{s(meta.entity)}</Text><Text style={st.hRight}>Dicetak: {fmt(meta.printedAt)}</Text></View>
        </View>
        <View style={st.accent} fixed />

        <Text style={{ fontSize: 8, color: C.muted, marginBottom: 4 }}>{s(meta.subtitle)}</Text>
        <View style={st.metaWrap}>
          {metaRows.map(([l, v], i) => (
            <View key={i} style={st.metaCell}><Text style={st.metaLabel}>{s(l)}</Text><Text style={st.metaVal}>{s(v)}</Text></View>
          ))}
        </View>
        <Text style={st.source}>Sumber: {s(meta.source)}</Text>

        {/* AI-47: KPI layar ikut dicetak, supaya unduhan memuat angka ringkas yang
            sama dengan yang dibaca di layar — bukan hanya tabel detailnya. */}
        {kpis && kpis.length > 0 && (
          <View style={st.metaWrap}>
            {kpis.map((k, i) => (
              <View key={i} style={st.metaCell}>
                <Text style={st.metaLabel}>{s(k.label)}</Text>
                <Text style={st.metaVal}>{s(k.value)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ borderWidth: 0.5, borderColor: C.border }}>
          {/* header */}
          <View style={st.row}>
            {columns.map((c, i) => (
              <Text key={i} style={[st.hcell, { flex: 1, textAlign: c.align ?? "left", backgroundColor: c.kind === "new" ? C.blue : C.green }]}>{s(c.label)}</Text>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View key={ri} style={[st.row, { backgroundColor: ri % 2 ? C.zebra : "#fff" }]} wrap={false}>
              {row.map((cell, ci) => (
                <Text key={ci} style={[st.cell, { flex: 1, textAlign: columns[ci].align ?? "left", backgroundColor: columns[ci].kind === "new" ? C.blueBg : undefined, color: columns[ci].kind === "new" ? C.muted : C.text }]}>{s(cell === "" ? "—" : cell)}</Text>
              ))}
            </View>
          ))}
          {rows.length === 0 && <Text style={[st.cell, { color: C.faint, textAlign: "center", paddingVertical: 8 }]}>Belum ada data.</Text>}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 5 }}>
          <View style={[st.swatch, { backgroundColor: C.green }]} /><Text style={st.legend}>Header hijau = kolom eksisting   </Text>
          <View style={[st.swatch, { backgroundColor: C.blue }]} /><Text style={st.legend}>Header biru = rekomendasi tambahan (baru)</Text>
        </View>
        {visual && <Text style={st.visual}>Visual pendamping: {s(visual)}</Text>}
        {meta.note && <Text style={st.note}>Catatan: {s(meta.note)}</Text>}

        <View style={st.footer} fixed>
          <Text>AgroVision — {s(meta.title)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
