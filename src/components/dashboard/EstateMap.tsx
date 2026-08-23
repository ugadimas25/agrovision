"use client";

import { useEffect, useRef } from "react";
import { Map as MlMap, NavigationControl, LngLatBounds, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { STATUS_LABEL, type IndStatus } from "@/lib/report/types";
import { cn } from "@/lib/utils";
import "maplibre-gl/dist/maplibre-gl.css";

// Worker MapLibre v6 (Turbopack tak emit worker → layer GeoJSON tak tampil).
setWorkerUrl("/maplibre-gl-worker.mjs");

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const REAL_BLOCK_URL = "/overlays/polygon-block-real.geojson";
const COLOR: Record<IndStatus, string> = {
  ok: "#1f8033", perhatian: "#f59e0b", kritis: "#dc2626", belum: "#a8a49a", usulan: "#2563eb",
};
const LEGEND: IndStatus[] = ["ok", "perhatian", "kritis", "belum"];

type FC = GeoJSON.FeatureCollection;

/**
 * Peta estate ringkas: zoom ke BLOK REAL (pilot, dari overlay), polygon diisi
 * warna per status + legenda (OK/Perhatian/Kritis/Belum ada data). Tanpa panel
 * layer. Blok dummy tidak ditampilkan.
 */
export function EstateMap({ status, heightClass = "h-[42dvh] md:h-[300px]" }: { status: IndStatus; heightClass?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const color = COLOR[status] ?? COLOR.belum;

  useEffect(() => {
    if (!el.current || map.current) return;
    let cancelled = false;
    const m = new MlMap({
      container: el.current,
      // Mobile: dua jari untuk menggeser peta agar scroll halaman tetap lancar.
      cooperativeGestures: typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
      style: {
        version: 8,
        sources: { esri: { type: "raster", tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: "Tiles &copy; Esri" } },
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#0f172a" } }, { id: "esri", type: "raster", source: "esri" }],
      } as StyleSpecification,
      center: [102.401, -4.042],
      zoom: 12.5,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");

    m.on("load", async () => {
      try {
        const r = await fetch(REAL_BLOCK_URL);
        if (!r.ok) return;
        const gj = (await r.json()) as FC;
        if (cancelled || map.current !== m || !gj.features?.length) return;
        m.addSource("real", { type: "geojson", data: gj });
        m.addLayer({ id: "real-fill", type: "fill", source: "real", paint: { "fill-color": color, "fill-opacity": 0.45 } });
        m.addLayer({ id: "real-line", type: "line", source: "real", paint: { "line-color": color, "line-width": 2.5 } });

        const b = new LngLatBounds();
        for (const f of gj.features) {
          const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
          if (!g) continue;
          const cs = g.coordinates as number[][][] | number[][][][];
          const flat = (Array.isArray(cs[0]?.[0]?.[0]) ? (cs as number[][][][]).flat() : cs) as number[][][];
          for (const ring of flat) for (const c of ring) b.extend([c[0], c[1]]);
        }
        if (!b.isEmpty()) m.fitBounds(b, { padding: 34, duration: 0, maxZoom: 16 });
      } catch { /* abaikan */ }
    });

    return () => {
      cancelled = true;
      // m.remove() MELEMPAR bila init peta gagal (WebGL2 tak tersedia: Lockdown
      // Mode iOS, GPU diblokir, kuota canvas Safari habis) -- MapLibre hanya
      // melog GPUInitializationError lalu mengembalikan Map tanpa painter.
      // Galat di cleanup effect membatalkan commit React saat pindah halaman:
      // terbukti <main> hilang seluruhnya dan app tampak macet. Ditelan.
      try { m.remove(); } catch { /* peta tak pernah terinisialisasi */ }
      map.current = null;
    };
  }, [color]);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-slate-200", heightClass)}>
      <div ref={el} className="h-full w-full bg-slate-900" />
      {/* Legenda status */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-white/90 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur">
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
