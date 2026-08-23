"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  AttributionControl,
  LngLatBounds,
  Popup,
  setWorkerUrl,
  type MapLayerMouseEvent,
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, LabelList,
} from "recharts";
import { Layers, X, Info, ChevronDown, ChevronUp } from "lucide-react";
import {
  ACTORS, FLOWS, ACTOR_META, FLOW_COLORS, EMISSION_RAMP, TRACE_IS_DEMO,
  actorById, traceStats, type Actor, type ActorType,
} from "@/lib/traceabilityDemo";
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import "maplibre-gl/dist/maplibre-gl.css";

// Worker MapLibre v6 (lihat BlockMap) — wajib agar layer GeoJSON tergambar.
setWorkerUrl("/maplibre-gl-worker.mjs");

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ATTRIB_ESRI = "Tiles &copy; Esri — Maxar, Earthstar Geographics, GIS User Community";
const ATTRIB_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

type Mode = "transactional" | "emission";

// Warna node saat mode emisi — interpolasi pada properti "emission".
const EMISSION_COLOR_EXPR = [
  "interpolate", ["linear"], ["get", "emission"],
  ...EMISSION_RAMP.flatMap(([v, c]) => [v, c]),
] as unknown as ExpressionSpecification;

// Urutan "marching ants" untuk arus transaksi (meniru referensi).
const DASH_SEQ: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

function generateArc(from: [number, number], to: [number, number], n = 48): [number, number][] {
  const [x1, y1] = from, [x2, y2] = to;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const nx = -dy / dist, ny = dx / dist; // normal unit
  const curv = 0.22;
  const cx = mx + nx * dist * curv, cy = my + ny * dist * curv;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = 1 - t;
    pts.push([a * a * x1 + 2 * a * t * cx + t * t * x2, a * a * y1 + 2 * a * t * cy + t * t * y2]);
  }
  return pts;
}

function farmBox(lat: number, lng: number, sizeKm = 0.7): number[][][] {
  const d = sizeKm / 111 / 2;
  return [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];
}

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      esri: { type: "raster", tiles: [ESRI_IMAGERY], tileSize: 256, maxzoom: 19, attribution: ATTRIB_ESRI },
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: ATTRIB_OSM },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0f172a" } },
      { id: "osm-layer", type: "raster", source: "osm", layout: { visibility: "none" } },
      { id: "esri-layer", type: "raster", source: "esri", layout: { visibility: "visible" } },
    ],
  };
}

export function TraceabilityMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<Mode>("transactional");

  const [mode, setMode] = useState<Mode>("transactional");
  const [basemap, setBasemap] = useState<"satellite" | "street">("satellite");
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Actor | null>(null);
  const [tab, setTab] = useState<"profile" | "tx" | "emission">("profile");
  const [showFlows, setShowFlows] = useState(true);
  const [showFarms, setShowFarms] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const stats = useMemo(() => traceStats(), []);

  // GeoJSON sumber (dibangun sekali).
  const geo = useMemo(() => {
    const actorsFC: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: ACTORS.map((a) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.lng, a.lat] },
        properties: { id: a.id, name: a.name, type: a.type, color: ACTOR_META[a.type].color, radius: ACTOR_META[a.type].radius, emission: a.emission.totalCo2eq },
      })),
    };
    const flowsFC: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: FLOWS.map((f) => {
        const from = actorById(f.from)!, to = actorById(f.to)!;
        const key = `${from.type}-${to.type}`;
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates: generateArc([from.lng, from.lat], [to.lng, to.lat]) },
          properties: { id: f.id, color: FLOW_COLORS[key] ?? "#a8a49a", grossKg: f.grossKg },
        };
      }),
    };
    const farmsFC: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: ACTORS.filter((a) => a.type === "producer").map((a) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: farmBox(a.lat, a.lng) },
        properties: { id: a.id },
      })),
    };
    return { actorsFC, flowsFC, farmsFC };
  }, []);

  // Node color + heatmap per mode. Opasitas arus diurus efek showFlows tersendiri
  // (agar applyMode bebas dari state & aman jadi dependency yang stabil).
  const applyMode = useCallback((m: MlMap, mode: Mode) => {
    if (!m.getLayer("actors-circle")) return;
    const emission = mode === "emission";
    m.setPaintProperty("actors-circle", "circle-color", emission ? EMISSION_COLOR_EXPR : ["get", "color"]);
    if (m.getLayer("emission-heat")) m.setPaintProperty("emission-heat", "heatmap-opacity", emission ? 0.55 : 0);
  }, []);

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    const m = new MlMap({
      container: container.current,
      style: buildStyle(),
      center: [102.45, -3.9],
      zoom: 9,
      attributionControl: false,
    });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new AttributionControl({ compact: true }), "top-right");
    m.addControl(new ScaleControl({ maxWidth: 120, unit: "metric" }), "top-left");

    m.on("load", () => {
      if (cancelled) return;
      m.addSource("farms", { type: "geojson", data: geo.farmsFC });
      m.addSource("flows", { type: "geojson", data: geo.flowsFC });
      m.addSource("actors", { type: "geojson", data: geo.actorsFC });

      m.addLayer({ id: "farms-fill", type: "fill", source: "farms", layout: { visibility: "none" }, paint: { "fill-color": "#1f4788", "fill-opacity": 0.22 } });
      m.addLayer({ id: "farms-line", type: "line", source: "farms", layout: { visibility: "none" }, paint: { "line-color": "#1f4788", "line-width": 1.2, "line-opacity": 0.6 } });

      m.addLayer({
        id: "emission-heat", type: "heatmap", source: "actors",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "emission"], 0, 0, 3400, 1],
          "heatmap-intensity": 1.4, "heatmap-radius": 46, "heatmap-opacity": 0,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(43,190,114,0)", 0.2, "rgb(43,190,114)", 0.4, "rgb(245,230,83)",
            0.6, "rgb(245,166,35)", 0.8, "rgb(208,2,27)", 1, "rgb(139,0,0)"],
        },
      });

      // Casing gelap di bawah + garis warna terang di atas = arus jelas di segala basemap.
      m.addLayer({
        id: "flows-casing", type: "line", source: "flows",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0b1220", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 4, 12, 7], "line-opacity": 0.55 },
      });
      m.addLayer({
        id: "flows-line", type: "line", source: "flows",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 7, 3, 12, 4.5], "line-opacity": 0.95 },
      });

      m.addLayer({
        id: "actors-circle", type: "circle", source: "actors",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, ["*", ["get", "radius"], 0.6], 12, ["get", "radius"]],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2, "circle-stroke-color": "#ffffff", "circle-opacity": 0.92,
        },
      });
      m.addLayer({
        id: "actors-label", type: "symbol", source: "actors",
        layout: { "text-field": ["get", "name"], "text-size": 10, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#f7f6f2", "text-halo-color": "#0f172a", "text-halo-width": 1.3 },
      });

      // fit ke semua aktor
      const b = new LngLatBounds();
      for (const a of ACTORS) b.extend([a.lng, a.lat]);
      if (!b.isEmpty()) m.fitBounds(b, { padding: 70, maxZoom: 11, duration: 0 });

      m.on("click", "actors-circle", (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const a = id ? actorById(id) : undefined;
        if (a) { setSelected(a); setTab("profile"); }
      });
      m.on("mouseenter", "actors-circle", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "actors-circle", () => { m.getCanvas().style.cursor = ""; });

      // AI-36 (QA D-05, "Alur tidak bisa di klik"): garis alur kini bisa diklik →
      // popup transaksi. Node memakai panel samping; alur cukup popup MapLibre
      // karena isinya satu transaksi, bukan profil.
      m.on("click", "flows-line", (e: MapLayerMouseEvent) => {
        // Node digambar DI ATAS garis; bila klik mengenai keduanya, biarkan
        // handler node yang menang supaya tidak muncul dua UI sekaligus.
        const adaNode = m.queryRenderedFeatures(e.point, { layers: ["actors-circle"] }).length > 0;
        if (adaNode) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const f = id ? FLOWS.find((x) => x.id === id) : undefined;
        if (!f) return;
        const dari = actorById(f.from), ke = actorById(f.to);
        // Konten dirakit lewat DOM (setDOMContent), BUKAN string HTML — nama aktor
        // adalah data, jangan beri jalan injeksi markup.
        const el = document.createElement("div");
        el.className = "text-xs leading-relaxed";
        const baris = (label: string, nilai: string) => {
          const row = document.createElement("div");
          const b = document.createElement("span");
          b.className = "text-slate-500";
          b.textContent = `${label}: `;
          row.appendChild(b);
          row.appendChild(document.createTextNode(nilai));
          el.appendChild(row);
        };
        baris("Alur", `${dari?.name ?? f.from} → ${ke?.name ?? f.to}`);
        baris("Komoditas", f.commodity);
        baris("Berat kotor", `${new Intl.NumberFormat("id-ID").format(f.grossKg)} kg`);
        baris("Tanggal", f.date);
        const kode = document.createElement("div");
        kode.className = "mt-1 font-mono text-[10px] text-slate-400";
        kode.textContent = f.id;
        el.appendChild(kode);
        new Popup({ closeButton: true, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setDOMContent(el)
          .addTo(m);
      });
      m.on("mouseenter", "flows-line", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "flows-line", () => { m.getCanvas().style.cursor = ""; });

      applyMode(m, modeRef.current);
      setLoaded(true);

      // animasi "marching ants" pada arus
      let frame = 0, last = 0;
      const step = (ts: number) => {
        if (ts - last > 70) {
          last = ts;
          if (m.getLayer("flows-line") && (m.getLayoutProperty("flows-line", "visibility") ?? "visible") !== "none") {
            const cur = m.getPaintProperty("flows-line", "line-opacity");
            if (typeof cur === "number" && cur > 0) m.setPaintProperty("flows-line", "line-dasharray", DASH_SEQ[frame % DASH_SEQ.length]);
          }
          frame++;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    });

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Lihat catatan di EstateMap: m.remove() melempar bila init WebGL gagal,
      // dan galat di cleanup effect membatalkan commit React saat navigasi.
      try { m.remove(); } catch { /* peta tak pernah terinisialisasi */ }
      map.current = null;
    };
  }, [geo, applyMode]);

  // Mode berubah.
  useEffect(() => {
    modeRef.current = mode;
    const m = map.current;
    if (m && loaded) applyMode(m, mode);
  }, [mode, loaded, applyMode]);

  // Basemap.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    m.setLayoutProperty("esri-layer", "visibility", basemap === "satellite" ? "visible" : "none");
    m.setLayoutProperty("osm-layer", "visibility", basemap === "street" ? "visible" : "none");
  }, [basemap, loaded]);

  // Toggle arus (casing + garis) — tetap terlihat di mode emisi (didimkan sedikit).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !m.getLayer("flows-line")) return;
    const emission = mode === "emission";
    m.setPaintProperty("flows-line", "line-opacity", emission ? 0.7 : (showFlows ? 0.95 : 0));
    if (m.getLayer("flows-casing")) m.setPaintProperty("flows-casing", "line-opacity", emission ? 0.45 : (showFlows ? 0.55 : 0));
  }, [showFlows, loaded, mode]);

  // Toggle kebun.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const vis = showFarms ? "visible" : "none";
    for (const id of ["farms-fill", "farms-line"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis);
  }, [showFarms, loaded]);

  const actorFlows = selected ? FLOWS.filter((f) => f.from === selected.id || f.to === selected.id) : [];

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200">
      <div ref={container} className="h-[560px] w-full bg-slate-900" />

      {/* ── Panel kiri: mode, legenda, toggle, statistik ── */}
      <div className="absolute left-3 top-3 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white/95 text-xs shadow-lg backdrop-blur">
        <button type="button" onClick={() => setPanelOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">
          <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-emerald-600" /> Traceability</span>
          {panelOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-500" />}
        </button>

        {panelOpen && (
          <div className="max-h-[460px] space-y-3 overflow-y-auto border-t border-slate-100 px-3 py-2.5">
            {/* mode */}
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {([["transactional", "Transaksional"], ["emission", "Emisi"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={cn("flex-1 px-2 py-1.5 font-medium", mode === k ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                  {label}
                </button>
              ))}
            </div>

            {TRACE_IS_DEMO && (
              <div className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Data rantai-pasok masih <b>demo/sintetis</b> (kelapa &amp; durian, Bengkulu). Ganti dengan data riil saat tersedia.</span>
              </div>
            )}

            {/* legenda */}
            {mode === "transactional" ? (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Aktor</p>
                {(Object.keys(ACTOR_META) as ActorType[]).map((t) => (
                  <div key={t} className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: ACTOR_META[t].color }} />
                    {ACTOR_META[t].label}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Intensitas emisi (kg CO₂e)</p>
                <div className="h-2.5 w-full rounded" style={{ background: `linear-gradient(to right, ${EMISSION_RAMP.map(([, c]) => c).join(",")})` }} />
                <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
                  <span>{EMISSION_RAMP[0][0]}</span><span>rendah → tinggi</span><span>{EMISSION_RAMP[EMISSION_RAMP.length - 1][0]}</span>
                </div>
              </div>
            )}

            {/* toggle layer */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Layer</p>
              <ToggleRow label="Arus transaksi" checked={showFlows} disabled={mode === "emission"} onChange={() => setShowFlows((v) => !v)} />
              <ToggleRow label="Area kebun" checked={showFarms} onChange={() => setShowFarms((v) => !v)} />
              <div className="flex overflow-hidden rounded-md border border-slate-300">
                {(["satellite", "street"] as const).map((b) => (
                  <button key={b} type="button" onClick={() => setBasemap(b)} className={cn("flex-1 px-2 py-1 font-medium", basemap === b ? "bg-slate-700 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>
                    {b === "satellite" ? "Satelit" : "Jalan"}
                  </button>
                ))}
              </div>
            </div>

            {/* statistik */}
            <div className="grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-2 text-[11px]">
              <Stat label="Petani" value={stats.producers} />
              <Stat label="Pengepul" value={stats.collectors} />
              <Stat label="Pengolahan" value={stats.processors} />
              <Stat label="Ekspor" value={stats.exporters} />
              <Stat label="Transaksi" value={stats.transactions} />
              <Stat label="Volume (kg)" value={formatNumber(stats.totalKg)} />
              <div className="col-span-2 rounded bg-slate-50 px-2 py-1">
                <span className="text-slate-500">Total CO₂e</span>
                <span className="float-right font-semibold tabular-nums text-slate-800">{formatNumber(stats.totalCo2eq)} kg</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Panel kanan: detail aktor ── */}
      {selected && (
        <div className="absolute bottom-3 right-14 top-3 flex w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/97 shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden>{ACTOR_META[selected.type].icon}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{selected.name}</p>
                <p className="font-mono text-[11px] text-slate-500">{selected.displayId} · {ACTOR_META[selected.type].label}</p>
              </div>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Tutup" className="rounded p-0.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>

          <div className="flex border-b border-slate-100 text-xs">
            {([["profile", "Profil"], ["tx", "Transaksi"], ["emission", "Emisi"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={cn("flex-1 px-2 py-1.5 font-medium", tab === k ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-700")}>
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
            {tab === "profile" && (
              <dl className="space-y-1.5">
                <Row label="Distrik" value={selected.district} />
                <Row label="Koordinat" value={`${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)}`} />
                {Object.entries(selected.details).map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
              </dl>
            )}

            {tab === "tx" && (
              actorFlows.length === 0 ? <p className="text-slate-500">Tidak ada transaksi.</p> : (
                <ResponsiveTable>
                  <table className="w-full">
                    <thead className="text-left text-[10px] uppercase text-slate-500">
                      <tr><th className="py-1">Tgl</th><th>Komoditas</th><th>Dari→Ke</th><th className="text-right">Kg</th></tr>
                    </thead>
                    <tbody>
                      {actorFlows.map((f) => (
                        <tr key={f.id} className="border-t border-slate-50">
                          <td data-label="Tgl" className="py-1 tabular-nums text-slate-500">{f.date.slice(5)}</td>
                          <td data-label="Komoditas" className="text-slate-600">{f.commodity}</td>
                          <td data-label="Dari→Ke" className="font-mono text-[10px] text-slate-500">{actorById(f.from)?.displayId}→{actorById(f.to)?.displayId}</td>
                          <td data-label="Kg" className="text-right tabular-nums text-slate-700">{formatNumber(f.grossKg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTable>
              )
            )}

            {tab === "emission" && (
              <div className="space-y-3">
                <div className="rounded bg-slate-50 px-2 py-1.5">
                  <span className="text-slate-500">Total</span>
                  <span className="float-right font-semibold tabular-nums text-slate-800">{formatNumber(selected.emission.totalCo2eq)} kg CO₂e</span>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase text-slate-500">Emisi per sumber</p>
                  <BarChart width={280} height={Math.max(120, selected.emission.sources.length * 26)} data={selected.emission.sources} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="source" width={110} tick={{ fontSize: 9, fill: "#5c5a55" }} />
                    <Tooltip formatter={(v) => [`${formatNumber(Number(v))} kg`, "CO₂e"]} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                      {selected.emission.sources.map((s, i) => <Cell key={i} fill={s.value < 0 ? "#2bbe72" : "#814c46"} />)}
                      <LabelList dataKey="value" position="right" formatter={(v) => formatNumber(Number(v))} style={{ fontSize: 9, fill: "#45443f" }} />
                    </Bar>
                  </BarChart>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase text-slate-500">Komposisi GHG</p>
                  <div className="flex items-center gap-3">
                    <PieChart width={110} height={110}>
                      <Pie data={selected.emission.ghg} dataKey="value" nameKey="category" cx="50%" cy="50%" innerRadius={26} outerRadius={48}>
                        {selected.emission.ghg.map((_, i) => <Cell key={i} fill={["#ff6384", "#36a2eb", "#ffce56"][i]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${formatNumber(Number(v))} kg`} />
                    </PieChart>
                    <ul className="space-y-1">
                      {selected.emission.ghg.map((g, i) => (
                        <li key={g.category} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ["#ff6384", "#36a2eb", "#ffce56"][i] }} />
                          {g.category} · <span className="tabular-nums">{formatNumber(g.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => setSelected(null)} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <X className="h-3.5 w-3.5" /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn(disabled ? "text-slate-500" : "text-slate-600")}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
        className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", checked ? "bg-emerald-600" : "bg-slate-300", disabled && "cursor-not-allowed opacity-40")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all", checked ? "left-[0.875rem]" : "left-0.5")} />
      </button>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-slate-50 px-2 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="float-right font-semibold tabular-nums text-slate-800">{value}</span>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">{value}</dd>
    </div>
  );
}
