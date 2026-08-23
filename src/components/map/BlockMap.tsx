"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  AttributionControl,
  LngLatBounds,
  setWorkerUrl,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import { Layers, Loader2, X, TriangleAlert, ChevronDown, ChevronUp } from "lucide-react";
import { formatHa, formatIdr, EMPTY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FOCUS_BLOCK_EVENT } from "./focus";
import "maplibre-gl/dist/maplibre-gl.css";

// FIX render GeoJSON di Next 16 + Turbopack: worker MapLibre v6 dimuat dari
// file terpisah via new URL(import.meta.url) yang TIDAK di-emit Turbopack →
// worker mati → semua layer GeoJSON (blok/plot/polygon) tak tergambar walau
// raster (ESRI/ortho) tampil. Solusi: sajikan worker + shared dari /public dan
// arahkan MapLibre ke sana. File disalin ke public/ dari node_modules.
setWorkerUrl("/maplibre-gl-worker.mjs");

/**
 * Peta blok berbasis MapLibre GL. Basemap gratis tanpa API key: ESRI World
 * Imagery + OpenStreetMap. Semua layer dipasang SEKALI dan tak pernah dibuang;
 * pergantian tampilan = tukar `visibility`, TIDAK PERNAH setStyle() (menghapus
 * seluruh kelas bug "setStyle membuang layer").
 *
 * Kontrol layer disatukan dalam satu panel di pojok KIRI-BAWAH.
 */

const ATTRIB_ESRI =
  "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const ATTRIB_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Overlay pilot (Sumatra) — terpisah dari blok demo (Kalimantan).
const ORTHO = { west: 102.3775224, south: -4.0641057, east: 102.4247483, north: -4.0198398 };
// View ketat ke area plot pilot (mengikuti sebaran titik & hasil interpolasi).
const PILOT_BOUNDS: [[number, number], [number, number]] = [
  [102.4088, -4.0496],
  [102.4104, -4.0474],
];
const REAL_BLOCKS_URL = "/overlays/polygon-block-real.geojson";
const POINTS_URL = "/overlays/pilot-points.geojson";
const INTERP_MANIFEST_URL = "/overlays/interp/manifest.json";
// Ortho drone (~465MB) di-host di GCS, keluar dari repo. Kosong = lokal (/public/tiles) untuk dev.
const TILES_BASE = process.env.NEXT_PUBLIC_TILES_BASE_URL ?? "";

// Warna titik pohon — kontras tinggi terhadap citra hijau & satu sama lain.
const PALM_COLOR = "#fde047"; // kuning terang (kelapa/palm)
const DURIAN_COLOR = "#d946ef"; // fuchsia (durian)

type InterpMeta = {
  url: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  ramp: string[];
};
type InterpManifest = Record<string, InterpMeta>;

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      esri: { type: "raster", tiles: [ESRI_IMAGERY], tileSize: 256, maxzoom: 19, attribution: ATTRIB_ESRI },
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: ATTRIB_OSM },
      // ?v=2 = cache-buster: tile lama (latar putih opak) sudah diganti versi
      // transparan (nearblack). URL identik → browser bisa sajikan cache basi;
      // query param memaksa fetch ulang.
      // `bounds` bukan kosmetik: tanpa itu MapLibre meminta seluruh grid
      // viewport dan tile di luar extent drone membalas 404 -- 13 error merah
      // di console tiap kali halaman dibuka.
      ortho: { type: "raster", tiles: [`${TILES_BASE}/tiles/ortho/{z}/{x}/{y}.png?v=2`], tileSize: 256, minzoom: 14, maxzoom: 19, bounds: [ORTHO.west, ORTHO.south, ORTHO.east, ORTHO.north], attribution: "Drone orthophoto" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0f172a" } },
      { id: "osm-layer", type: "raster", source: "osm", layout: { visibility: "none" } },
      { id: "esri-layer", type: "raster", source: "esri", layout: { visibility: "visible" } },
      { id: "ortho-layer", type: "raster", source: "ortho", layout: { visibility: "none" } },
    ],
  };
}

type BlockSummary = {
  blockCode: string;
  estateName: string;
  areaHa: number | null;
  plantingYear: number | null;
  verificationStatus: string;
  transactionCount: number;
  totalCostIdr: number | null;
  costPerHaIdr: number | null;
  pendingCount: number;
};

type FC = GeoJSON.FeatureCollection;

/**
 * Menegakkan urutan tumpukan layer PILOT (bawah → atas):
 *   realblocks-fill · interpolasi (heatmap) · realblocks-line · titik pohon.
 * moveLayer(id) tanpa beforeId memindahkan ke puncak; iterasi bawah→atas
 * membuat elemen terakhir (titik) paling atas. Dipanggil tiap toggle pilot.
 */
function enforcePilotOrder(m: MlMap, interpKeys: string[]) {
  const order = ["realblocks-fill", ...interpKeys.map((k) => `interp-${k}`), "realblocks-line", "points-circle"];
  for (const id of order) if (m.getLayer(id)) m.moveLayer(id);
}

function boundsOf(features: GeoJSON.Feature[]): LngLatBounds {
  const b = new LngLatBounds();
  for (const f of features) {
    const g = f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon | null;
    if (!g) continue;
    const coords = g.coordinates as number[][][] | number[][][][];
    const flat = (Array.isArray(coords[0]?.[0]?.[0]) ? (coords as number[][][][]).flat() : coords) as number[][][];
    for (const ring of flat) for (const c of ring) b.extend([c[0], c[1]]);
  }
  return b;
}

// Mobile: tinggi mengikuti viewport (dvh) agar peta tetap proporsional & tidak
// memaksa scroll panjang; desktop tetap tinggi tetap.
export function BlockMap({ blockCount, heightClass = "h-[60dvh] md:h-[520px]" }: { blockCount: number; heightClass?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const blocksData = useRef<FC | null>(null);
  const realBlocksData = useRef<FC | null>(null);
  const pointsData = useRef<FC | null>(null);
  const showPlotsRef = useRef(true);

  const [basemap, setBasemap] = useState<"satellite" | "street">("satellite");
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [loaded, setLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selected, setSelected] = useState<BlockSummary | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showPlots, setShowPlots] = useState(true);
  const [plotsAvailable, setPlotsAvailable] = useState(false);
  const [showOrtho, setShowOrtho] = useState(true); // default: buka ke wilayah drone
  const [showReal, setShowReal] = useState(false);
  const [showPoints, setShowPoints] = useState(false);
  const [activeInterp, setActiveInterp] = useState<string | null>(null);
  const [interp, setInterp] = useState<InterpManifest | null>(null);
  // Default TERTUTUP supaya di HP peta tidak tertutup panel; dibuka otomatis di
  // desktop (>=768px) lewat efek di bawah — inisialisasi tidak boleh menyentuh
  // window agar render server & klien sama (hindari hydration mismatch).
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    const openOnDesktop = () => {
      if (window.matchMedia("(min-width: 768px)").matches) setPanelOpen(true);
    };
    openOnDesktop();
  }, []);

  function flyToPilot(m: MlMap) {
    m.fitBounds(PILOT_BOUNDS, { padding: 40, maxZoom: 19, duration: 800 });
  }

  function focusBlock(m: MlMap, id: string) {
    const feat = blocksData.current?.features.find((f) => f.properties?.id === id);
    if (!feat) return;
    const b = boundsOf([feat]);
    if (!b.isEmpty()) m.fitBounds(b, { padding: 80, maxZoom: 16, duration: 700 });
  }

  /** Pasang layer blok-real dari file secara lazy. Self-healing. */
  async function ensureRealBlocks(m: MlMap): Promise<boolean> {
    if (m.getLayer("realblocks-fill")) return true;
    let data = realBlocksData.current;
    if (!data) {
      try { const r = await fetch(REAL_BLOCKS_URL); if (r.ok) data = (await r.json()) as FC; } catch { /* abaikan */ }
      realBlocksData.current = data ?? null;
    }
    if (!data?.features?.length) return false;
    if (!m.getSource("realblocks")) m.addSource("realblocks", { type: "geojson", data });
    if (!m.getLayer("realblocks-fill"))
      m.addLayer({ id: "realblocks-fill", type: "fill", source: "realblocks", layout: { visibility: "none" }, paint: { "fill-color": "#38bdf8", "fill-opacity": 0.18 } });
    if (!m.getLayer("realblocks-line"))
      m.addLayer({ id: "realblocks-line", type: "line", source: "realblocks", layout: { visibility: "none" }, paint: { "line-color": "#0284c7", "line-width": 3 } });
    return true;
  }

  /** Pasang titik pohon pilot (palm vs durian) secara lazy. */
  async function ensurePoints(m: MlMap): Promise<boolean> {
    if (m.getLayer("points-circle")) return true;
    let data = pointsData.current;
    if (!data) {
      try { const r = await fetch(POINTS_URL); if (r.ok) data = (await r.json()) as FC; } catch { /* abaikan */ }
      pointsData.current = data ?? null;
    }
    if (!data?.features?.length) return false;
    if (!m.getSource("points")) m.addSource("points", { type: "geojson", data });
    if (!m.getLayer("points-circle"))
      m.addLayer({
        id: "points-circle", type: "circle", source: "points", layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.6, 16, 3.5, 19, 6],
          "circle-color": ["match", ["get", "jenis"], "palm", PALM_COLOR, "durian", DURIAN_COLOR, "#a8a49a"],
          "circle-stroke-color": "#0f172a", "circle-stroke-width": 0.7, "circle-opacity": 0.95,
        },
      });
    return true;
  }

  /** Pasang overlay raster interpolasi (image source) secara lazy. */
  function ensureInterp(m: MlMap, key: string, meta: InterpMeta): boolean {
    const id = `interp-${key}`;
    if (m.getLayer(id)) return true;
    try {
      if (!m.getSource(id))
        m.addSource(id, { type: "image", url: meta.url, coordinates: meta.coordinates });
      // Di bawah titik pohon bila sudah ada, agar titik tetap tampak di atas heatmap.
      const beforeId = m.getLayer("points-circle") ? "points-circle" : undefined;
      m.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" }, paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 } }, beforeId);
      return true;
    } catch { return false; }
  }

  // Muat manifest interpolasi (daftar overlay pilot).
  useEffect(() => {
    let alive = true;
    fetch(INTERP_MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: InterpManifest | null) => { if (alive && j) setInterp(j); })
      .catch(() => { /* abaikan bila belum ada */ });
    return () => { alive = false; };
  }, []);

  // Inisialisasi + pemuatan data SEKALI. Overlay tidak pernah dibuang.
  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    const m = new MlMap({
      container: container.current,
      style: buildStyle(),
      // Mobile: butuh dua jari untuk menggeser peta, supaya satu jari tetap
      // men-scroll halaman (peta tidak "menjebak" scroll). Desktop tidak berubah.
      cooperativeGestures: typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
      // Buka langsung di wilayah drone (pilot Sumatra), bukan overview Kalimantan.
      center: [(ORTHO.west + ORTHO.east) / 2, (ORTHO.south + ORTHO.north) / 2],
      zoom: 12.5,
      // Atribusi dipasang manual (top-right, di bawah zoom) agar tidak tertimpa
      // kartu detail blok yang berada di pojok kanan-bawah.
      attributionControl: false,
    });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new AttributionControl({ compact: true }), "top-right");
    m.addControl(new ScaleControl({ maxWidth: 120, unit: "metric" }), "top-left");

    m.on("load", async () => {
      try {
        const [bres, pres] = await Promise.all([
          fetch("/api/blocks/geojson", { credentials: "same-origin" }),
          fetch("/api/plots/geojson", { credentials: "same-origin" }),
        ]);
        // Blok & plot INDEPENDEN: kegagalan salah satu endpoint tidak boleh
        // menghalangi render yang lain (plot harus tetap tampil walau blok gagal).
        const blocks = bres.ok ? ((await bres.json()) as FC) : null;
        const plots = pres.ok ? ((await pres.json()) as FC) : null;
        if (cancelled || map.current !== m) return;

        const hasBlocks = !!blocks?.features?.length;
        const hasPlots = !!plots?.features?.length;

        // Error hanya bila endpoint blok gagal DAN tidak ada plot untuk ditampilkan.
        if (!bres.ok && !hasPlots) {
          setErrorMsg(`HTTP ${bres.status}`);
          setStatus("error");
          setLoaded(true);
          return;
        }
        if (!hasBlocks && !hasPlots) {
          setStatus("empty");
          setLoaded(true);
          return;
        }

        if (hasBlocks) {
          blocksData.current = blocks;
          m.addSource("blocks", { type: "geojson", data: blocks! });
          m.addLayer({ id: "blocks-fill", type: "fill", source: "blocks", paint: { "fill-color": "#2ca243", "fill-opacity": 0.28 } });
          m.addLayer({ id: "blocks-line", type: "line", source: "blocks", paint: { "line-color": "#4f9d5d", "line-width": 1.6 } });
          m.addLayer({
            id: "blocks-label", type: "symbol", source: "blocks",
            layout: { "text-field": ["get", "code"], "text-size": 11 },
            paint: { "text-color": "#eef6ef", "text-halo-color": "#064e3b", "text-halo-width": 1.2 },
          });
        }

        if (hasPlots) {
          const vis = showPlotsRef.current ? "visible" : "none";
          m.addSource("plots", { type: "geojson", data: plots });
          m.addLayer({ id: "plots-fill", type: "fill", source: "plots", layout: { visibility: vis }, paint: { "fill-color": "#f97316", "fill-opacity": 0.55 } });
          m.addLayer({ id: "plots-line", type: "line", source: "plots", layout: { visibility: vis }, paint: { "line-color": "#c2410c", "line-width": 2 } });
          setPlotsAvailable(true);
        }

        // Tampilan default = wilayah drone (pilot), bukan blok demo (Kalimantan).
        // Blok/plot tetap ter-render; pengguna bisa geser/klik untuk melihatnya.
        m.fitBounds([[ORTHO.west, ORTHO.south], [ORTHO.east, ORTHO.north]], { padding: 20, duration: 0 });

        if (hasBlocks) {
          m.on("click", "blocks-fill", async (e: MapLayerMouseEvent) => {
            const id = e.features?.[0]?.properties?.id;
            if (!id) return;
            setLoadingDetail(true);
            setSelected(null);
            try {
              const r = await fetch(`/api/blocks/${id}/summary`, { credentials: "same-origin" });
              if (r.ok) setSelected((await r.json()) as BlockSummary);
            } finally {
              setLoadingDetail(false);
            }
          });
          m.on("mouseenter", "blocks-fill", () => { m.getCanvas().style.cursor = "pointer"; });
          m.on("mouseleave", "blocks-fill", () => { m.getCanvas().style.cursor = ""; });
        }

        setStatus("ready");
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Gagal memuat");
        setStatus("error");
        // Basemap & overlay pilot (ortho/blok real/titik/interpolasi) tidak
        // bergantung pada API blok — biarkan tetap dapat dipakai walau blok gagal.
        setLoaded(true);
      }
    });

    return () => {
      cancelled = true;
      // Lihat catatan di EstateMap: m.remove() melempar bila init WebGL gagal,
      // dan galat di cleanup effect membatalkan commit React saat navigasi.
      try { m.remove(); } catch { /* peta tak pernah terinisialisasi */ }
      map.current = null;
    };
  }, []);

  // Zoom ke blok saat baris tabel diklik (event dari komponen lain).
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const m = map.current;
      if (m && id) focusBlock(m, id);
    };
    window.addEventListener(FOCUS_BLOCK_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_BLOCK_EVENT, onFocus);
  }, []);

  // Toggle plot.
  useEffect(() => {
    showPlotsRef.current = showPlots;
    const m = map.current;
    if (!m || !loaded) return;
    const vis = showPlots ? "visible" : "none";
    for (const id of ["plots-fill", "plots-line"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis);
    m.triggerRepaint();
  }, [showPlots, loaded]);

  // Ganti basemap.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    m.setLayoutProperty("esri-layer", "visibility", basemap === "satellite" ? "visible" : "none");
    m.setLayoutProperty("osm-layer", "visibility", basemap === "street" ? "visible" : "none");
  }, [basemap, loaded]);

  // Toggle ortho drone (zoom ke area pilot saat dinyalakan).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    m.setLayoutProperty("ortho-layer", "visibility", showOrtho ? "visible" : "none");
    if (showOrtho) m.fitBounds([[ORTHO.west, ORTHO.south], [ORTHO.east, ORTHO.north]], { padding: 24, duration: 800 });
  }, [showOrtho, loaded]);

  // Toggle blok real (lazy, self-healing).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    let cancelled = false;
    (async () => {
      if (showReal && !(await ensureRealBlocks(m))) return;
      if (cancelled) return;
      const vis = showReal ? "visible" : "none";
      for (const id of ["realblocks-fill", "realblocks-line"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis);
      if (showReal) { enforcePilotOrder(m, interp ? Object.keys(interp) : []); flyToPilot(m); }
      m.triggerRepaint();
    })();
    return () => { cancelled = true; };
  }, [showReal, loaded, interp]);

  // Toggle titik pohon (palm/durian).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    let cancelled = false;
    (async () => {
      if (showPoints && !(await ensurePoints(m))) return;
      if (cancelled) return;
      if (m.getLayer("points-circle")) m.setLayoutProperty("points-circle", "visibility", showPoints ? "visible" : "none");
      if (showPoints) { enforcePilotOrder(m, interp ? Object.keys(interp) : []); flyToPilot(m); }
      m.triggerRepaint();
    })();
    return () => { cancelled = true; };
  }, [showPoints, loaded, interp]);

  // Interpolasi — pilih-satu (radio). Sembunyikan semua lalu tampilkan yang aktif.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !interp) return;
    for (const k of Object.keys(interp)) {
      const id = `interp-${k}`;
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", "none");
    }
    if (activeInterp && interp[activeInterp] && ensureInterp(m, activeInterp, interp[activeInterp])) {
      m.setLayoutProperty(`interp-${activeInterp}`, "visibility", "visible");
      enforcePilotOrder(m, Object.keys(interp));
      flyToPilot(m);
    }
    m.triggerRepaint();
  }, [activeInterp, loaded, interp]);

  const activeMeta = activeInterp ? interp?.[activeInterp] : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200">
      <div ref={container} className={cn(heightClass, "w-full bg-slate-900")} />

      {/* ── Panel kontrol layer (pojok kiri-bawah) ── */}
      <div className="absolute bottom-3 left-3 z-10 w-[min(14rem,calc(100%-1.5rem))] overflow-hidden rounded-lg border border-slate-200 bg-white/95 text-xs shadow-lg backdrop-blur md:w-56">
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50"
        >
          <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-emerald-600" /> Layer</span>
          {panelOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-500" />}
        </button>

        {panelOpen && (
          <div className="max-h-[38dvh] space-y-3 overflow-y-auto overscroll-contain border-t border-slate-100 px-3 py-2.5 md:max-h-[400px]">
            {/* Peta dasar */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Peta dasar</p>
              <div className="flex overflow-hidden rounded-md border border-slate-300">
                {(["satellite", "street"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBasemap(b)}
                    className={cn("flex-1 px-2 py-1 font-medium", basemap === b ? "bg-emerald-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
                  >
                    {b === "satellite" ? "Satelit" : "Jalan"}
                  </button>
                ))}
              </div>
            </div>

            {/* Overlay */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Overlay</p>
              <ToggleRow label="Plot kebun" checked={showPlots} disabled={status !== "loading" && !plotsAvailable} onChange={() => setShowPlots((v) => !v)} />
              <ToggleRow label="Ortho drone" hint="pilot" checked={showOrtho} onChange={() => setShowOrtho((v) => !v)} />
              <ToggleRow label="Blok real" hint="pilot" checked={showReal} onChange={() => setShowReal((v) => !v)} />
              <ToggleRow label="Titik pohon" hint="pilot" checked={showPoints} onChange={() => setShowPoints((v) => !v)} />
              {showPoints && (
                <div className="flex gap-3 pl-0.5 pt-0.5 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><Dot color={PALM_COLOR} /> Palm/Kelapa</span>
                  <span className="flex items-center gap-1"><Dot color={DURIAN_COLOR} /> Durian</span>
                </div>
              )}
            </div>

            {/* Interpolasi */}
            {interp && Object.keys(interp).length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Interpolasi (pilot)</p>
                {/* Legend di ATAS daftar — dengan 60 layer, daftar discroll dan
                    legend di bawah tidak akan pernah terlihat. */}
                {activeMeta && (
                  <div className="pb-1">
                    <div className="h-2 w-full rounded" style={{ background: `linear-gradient(to right, ${activeMeta.ramp.join(",")})` }} />
                    <div className="flex justify-between pt-0.5 text-[10px] tabular-nums text-slate-500">
                      <span>{activeMeta.min}</span>
                      <span>{activeMeta.unit}</span>
                      <span>{activeMeta.max}</span>
                    </div>
                  </div>
                )}
                <div className="max-h-48 space-y-1 overflow-y-auto pr-0.5">
                  {Object.entries(interp).map(([k, meta]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setActiveInterp((cur) => (cur === k ? null : k))}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-left",
                        activeInterp === k ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <span>{meta.label}</span>
                      <span className="text-[10px] text-slate-500">{meta.unit}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {status === "loading" && (
        <Overlay>
          <Loader2 className="h-5 w-5 animate-spin text-emerald-300" />
          <p className="text-sm text-slate-200">Memuat peta...</p>
        </Overlay>
      )}
      {status === "empty" && (
        <Overlay>
          <p className="text-sm font-medium text-slate-100">Belum ada blok berpolygon</p>
          <p className="max-w-sm text-center text-xs leading-relaxed text-slate-300">
            {blockCount > 0
              ? `${blockCount} blok terdaftar, tapi belum ada yang punya batas.`
              : "Tambahkan blok beserta polygon-nya untuk mulai memetakan."}
          </p>
        </Overlay>
      )}
      {status === "error" && (
        <Overlay>
          <TriangleAlert className="h-5 w-5 text-amber-300" />
          <p className="text-sm text-slate-100">Gagal memuat geometry blok</p>
          <p className="text-xs text-slate-500">{errorMsg}</p>
        </Overlay>
      )}

      {/* Mobile: kartu detail naik di atas pil "Layer" agar tidak bertabrakan. */}
      {(selected || loadingDetail) && (
        <div className="absolute bottom-14 right-3 z-10 max-h-[45dvh] w-[min(18rem,calc(100%-1.5rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white/97 p-3 shadow-lg backdrop-blur md:bottom-3 md:max-h-none md:w-72 md:overflow-visible">
          {loadingDetail ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat data blok...
            </p>
          ) : selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-semibold text-slate-800">{selected.blockCode}</p>
                  <p className="text-xs text-slate-500">{selected.estateName}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label="Tutup" className="rounded p-0.5 text-slate-500 hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <dl className="mt-2.5 space-y-1.5 text-xs">
                <Row label="Luas" value={formatHa(selected.areaHa)} />
                <Row label="Tahun tanam" value={selected.plantingYear?.toString() ?? EMPTY} />
                <Row label="Transaksi biaya" value={String(selected.transactionCount)} />
                <Row label="Total biaya" value={formatIdr(selected.totalCostIdr)} />
                <Row label="Biaya / ha" value={formatIdr(selected.costPerHaIdr)} />
                {selected.pendingCount > 0 && <Row label="Menunggu approval" value={String(selected.pendingCount)} warn />}
              </dl>
              <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-500">
                Hanya transaksi disetujui yang dihitung. Luas dari PostGIS.
              </p>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }: {
  label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn("flex items-baseline gap-1", disabled ? "text-slate-500" : "text-slate-600")}>
        {label}
        {hint && <span className="text-[9px] uppercase tracking-wide text-sky-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          checked ? "bg-emerald-600" : "bg-slate-300",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all", checked ? "left-[0.875rem]" : "left-0.5")} />
      </button>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full ring-1 ring-black/20" style={{ backgroundColor: color }} />;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70">
      {children}
    </div>
  );
}
function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn("tabular-nums", warn ? "font-medium text-amber-700" : "text-slate-800")}>{value}</dd>
    </div>
  );
}
