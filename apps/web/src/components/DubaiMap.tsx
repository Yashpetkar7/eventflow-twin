"use client";
// The real Dubai, offline: OpenStreetMap vector tiles (public/map/dubai.pmtiles, `python tasks.py basemap`)
// drawn by MapLibre with local fonts, 3D buildings from OSM heights, and the twin (metro lines, station load
// columns, over-capacity rings) drawn by deck.gl on a camera-synced overlay.
// Station labels are MapLibre symbol layers: they collide properly and MapLibre 6 shapes Arabic natively.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { addProtocol, Map as MlMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers as baseLayers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { EventInfo, SimulateResponse, Station } from "@/lib/api";
import { useFmt, useLocaleSwitch } from "@/lib/i18n";
import { COMFORT, RGB, band } from "@/lib/load";

// Calm, analyst-grade palette from tokens.css applied to the OSM basemap.
const FLAVOR: Flavor = {
  ...namedFlavor("light"),
  background: "#F1EDE6", earth: "#F6F3EE", water: "#C7DAE4", sand: "#EEE5D3", beach: "#F0E7D6",
  park_a: "#DCEAD6", park_b: "#D2E3CB", wood_a: "#D6E6CF", wood_b: "#CFE0C8", scrub_a: "#E4EBDA", scrub_b: "#DEE7D3",
  buildings: "#E3DDD3", aerodrome: "#ECE8E0", runway: "#E2DDD4", industrial: "#ECE7E0", hospital: "#F2E6E6",
  school: "#EFEADD", highway: "#FFFFFF", highway_casing_early: "#E0D8CB", highway_casing_late: "#E0D8CB",
  major: "#FFFFFF", major_casing_early: "#E6DFD3", major_casing_late: "#E6DFD3", railway: "#CFC8BC",
};
const BOUNDS: [number, number, number, number] = [54.95, 24.75, 55.65, 25.38];
const HOME = { center: [55.2, 25.12] as [number, number], zoom: 10.4, pitch: 40, bearing: -18 };
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · metro: RTA open data';

interface LineFeature { geometry: { coordinates: [number, number][] }; properties: { line: string; color: string } }
interface Col { id: string; position: [number, number]; demand: number; lf: number }

let protocolAdded = false;
function ensureProtocol() {
  if (protocolAdded) return;
  addProtocol("pmtiles", new Protocol().tile);
  setWorkerUrl("/map/maplibre-gl-worker.mjs");     // static copy (scripts/copy-map-worker.mjs)
  protocolAdded = true;
}

function baseStyle(origin: string, lang: string): StyleSpecification {
  const layers = baseLayers("protomaps", FLAVOR, { lang }).filter((l) => l.id !== "buildings");
  const firstSymbol = layers.findIndex((l) => l.type === "symbol");
  const buildings3d = {
    id: "buildings-3d", type: "fill-extrusion", source: "protomaps", "source-layer": "buildings", minzoom: 13,
    paint: {
      "fill-extrusion-color": "#E6E0D6",
      "fill-extrusion-height": ["coalesce", ["get", "height"], 8],
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.85],
    },
  } as const;
  layers.splice(firstSymbol < 0 ? layers.length : firstSymbol, 0, buildings3d as never);
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/light`,
    sources: { protomaps: { type: "vector", url: `pmtiles://${origin}/map/dubai.pmtiles`, attribution: ATTRIBUTION } },
    layers,
  };
}

const hexToRgb = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export default function DubaiMap({ sim, stations, event, hour, selected, onSelect, orbit = false }: {
  sim: SimulateResponse | null; stations: Station[]; event: EventInfo | null; hour: number;
  selected: string | null; onSelect: (id: string) => void; orbit?: boolean;
}) {
  const t = useTranslations("app");
  const { pct } = useFmt();
  const { locale } = useLocaleSwitch();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [lines, setLines] = useState<LineFeature[]>([]);
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    ensureProtocol();
    const map = new MlMap({
      container: box.current, style: baseStyle(window.location.origin, locale), ...HOME,
      maxBounds: [[BOUNDS[0] - 0.15, BOUNDS[1] - 0.12], [BOUNDS[2] + 0.15, BOUNDS[3] + 0.12]], minZoom: 9, maxZoom: 17.5,
      attributionControl: { compact: true }, canvasContextAttributes: { antialias: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    const overlay = new MapboxOverlay({
      // Overlaid (own canvas, camera-synced): deck.gl 9.4's interleaved mode does not support MapLibre 6's
      // custom-layer API yet (crashes in getViewport every frame). Trade-off: columns are not occluded by buildings.
      interleaved: false, layers: [],
      onClick: (info: PickingInfo) => { const o = info.object as Col | undefined; if (o?.id) onSelectRef.current(o.id); },
      getCursor: ({ isHovering }) => (isHovering ? "pointer" : "grab"),
    });
    map.addControl(overlay);
    map.on("load", () => {
      map.addSource("stations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("venue", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "twin-station-names", type: "symbol", source: "stations", minzoom: 11,
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 12.5, "text-offset": [0, 1.3],
          "text-anchor": "top", "text-max-width": 9, "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": "#1B1F2A", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6 },
      });
      map.addLayer({
        id: "twin-station-load", type: "symbol", source: "stations",
        filter: [">=", ["get", "lf"], 0.6],
        layout: { "text-field": ["get", "pct"], "text-font": ["Noto Sans Medium"], "text-size": 13, "text-offset": [0, -1.4],
          "text-anchor": "bottom", "text-allow-overlap": true, "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": ["match", ["get", "band"], "risk", "#B4454F", "warn", "#8A5F14", "#3F8F6B"],
          "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 2 },
      });
      map.addLayer({
        id: "twin-venue", type: "symbol", source: "venue",
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 13, "text-offset": [0, -1.6],
          "text-anchor": "bottom", "text-allow-overlap": true },
        paint: { "text-color": "#1D4ED8", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 2 },
      });
      setReady(true);
    });
    mapRef.current = map;
    overlayRef.current = overlay;
    fetch("/geo/metro.geojson").then((r) => r.json()).then((d) => setLines(d.features)).catch(() => setLines([]));
    return () => { map.remove(); mapRef.current = null; overlayRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once; locale changes are applied below
  }, []);

  // Locale → basemap place names + station names.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const l of baseLayers("protomaps", FLAVOR, { lang: locale })) {
      if (l.type !== "symbol" || !map.getLayer(l.id) || !l.layout) continue;
      const layout = l.layout as Record<string, unknown>;
      if (layout["text-field"]) map.setLayoutProperty(l.id, "text-field", layout["text-field"] as never);
      if (layout["text-font"]) map.setLayoutProperty(l.id, "text-font", layout["text-font"] as never);
    }
  }, [locale, ready]);

  const cols: Col[] = useMemo(() => {
    if (!sim) return [];
    const byKey = new Map(sim.hourly.filter((r) => r.hour === hour).map((r) => [r.station_id, r]));
    return stations.map((s) => {
      const r = byKey.get(s.id);
      return { id: s.id, position: [s.lon, s.lat], demand: r?.demand ?? 0, lf: r?.peak_lf ?? 0 };
    });
  }, [sim, stations, hour]);
  // Fixed per scenario (max over the day) so scrubbing the hour shows real growth; capped below the skyline.
  const elevationScale = useMemo(() => 420 / Math.max(1, ...(sim?.hourly.map((r) => r.demand) ?? [1])), [sim]);

  // Twin layers (deck.gl) + label data (MapLibre).
  useEffect(() => {
    const map = mapRef.current, overlay = overlayRef.current;
    if (!map || !overlay || !ready) return;
    overlay.setProps({
      layers: [
        new PathLayer<LineFeature>({
          id: "metro-lines", data: lines, getPath: (f) => f.geometry.coordinates,
          getColor: (f) => [...hexToRgb(f.properties.color), 235] as [number, number, number, number],
          getWidth: 5, widthUnits: "pixels", widthMinPixels: 3, capRounded: true, jointRounded: true,
        }),
        new ScatterplotLayer<Col>({
          id: "station-base", data: cols, getPosition: (d) => d.position, getRadius: 6, radiusUnits: "pixels",
          getFillColor: [255, 255, 255, 255], getLineColor: [27, 31, 42, 200], stroked: true, lineWidthMinPixels: 2,
        }),
        new ColumnLayer<Col>({
          id: "station-load", data: cols, diskResolution: 20, radius: 70, extruded: true, pickable: true,
          getPosition: (d) => d.position, getElevation: (d) => d.demand, elevationScale,
          getFillColor: (d) => [...RGB[band(d.lf)], 235] as [number, number, number, number],
          material: { ambient: 0.6, diffuse: 0.55, shininess: 20 },
          transitions: reducedMotion ? undefined : { getElevation: 300, getFillColor: 200 },
          updateTriggers: { getElevation: [hour, sim?.run_id], getFillColor: [hour, sim?.run_id] },
        }),
        new ScatterplotLayer<Col>({   // non-colour cue for over-capacity (WCAG 1.4.1)
          id: "overcap-rings", data: cols.filter((c) => c.lf > COMFORT), getPosition: (d) => d.position,
          getRadius: 150, stroked: true, filled: false, lineWidthMinPixels: 3,
          getLineColor: [...RGB.risk, 255] as [number, number, number, number],
        }),
        new ScatterplotLayer<Col>({
          id: "selected", data: cols.filter((c) => c.id === selected), getPosition: (d) => d.position,
          getRadius: 115, stroked: true, filled: false, getLineColor: [29, 78, 216, 255], lineWidthMinPixels: 2.5,
        }),
        ...(event ? [new ScatterplotLayer<EventInfo>({
          id: "venue", data: [event], getPosition: (e) => [e.lon, e.lat], getRadius: 9, radiusUnits: "pixels",
          getFillColor: [29, 78, 216, 255], getLineColor: [255, 255, 255, 255], stroked: true, lineWidthMinPixels: 3,
        })] : []),
      ],
    });
    const order = new Map([...cols].sort((a, b) => b.lf - a.lf).map((c, i) => [c.id, i]));
    (map.getSource("stations") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: stations.map((s) => {
        const c = cols.find((x) => x.id === s.id);
        const lf = c?.lf ?? 0;
        return { type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: { id: s.id, name: locale === "ar" && s.name_ar ? s.name_ar : s.name_en, lf, pct: pct(lf), band: band(lf),
            rank: s.id === selected ? -1 : order.get(s.id) ?? 99 } };
      }),
    });
    (map.getSource("venue") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: event ? [{ type: "Feature", geometry: { type: "Point", coordinates: [event.lon, event.lat] },
        properties: { label: t("venue", { name: locale === "ar" && event.venue_ar ? event.venue_ar : event.venue }) } }] : [],
    });
  }, [ready, lines, cols, elevationScale, selected, event, stations, hour, sim?.run_id, locale, pct, t, reducedMotion]);

  // Fly to the venue when the scenario changes (or home for no event).
  const eventId = event?.id ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const target = event ? { center: [event.lon, event.lat] as [number, number], zoom: 13.3, pitch: 58, bearing: -32 } : HOME;
    if (reducedMotion) map.jumpTo(target); else map.flyTo({ ...target, duration: 1800, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the scenario's event changes
  }, [eventId, ready]);

  // Attract mode: slow orbit (off for reduced motion).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !orbit || reducedMotion) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => { map.setBearing(map.getBearing() + (now - last) * 0.004); last = now; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [orbit, reducedMotion]);

  return (
    <div className="absolute inset-0" role="img" aria-label={t("mapAria")}>
      {/* inline position: maplibre-gl.css sets .maplibregl-map { position: relative }, which would beat a class */}
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
      <button type="button" onClick={() => mapRef.current?.flyTo({ ...HOME, duration: reducedMotion ? 0 : 1400 })}
        className="absolute start-3 bottom-10 z-10 min-h-9 rounded-full border border-line bg-surface/95 px-3 text-[12px] font-medium text-ink-2 shadow-sm hover:bg-muted">
        {t("allDubai")}
      </button>
      <div className="pointer-events-none absolute bottom-10 end-3 z-10 max-w-[55%] rounded-lg bg-surface/85 px-2 py-1 text-[10px] text-ink-3">
        {t("mapLegend")}
      </div>
    </div>
  );
}
