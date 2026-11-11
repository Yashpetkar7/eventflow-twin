"use client";
// 3D corridor twin. Fully offline: geometry is local GeoJSON built from the official RTA GTFS feed
// (public/geo/metro.geojson, `python tasks.py geo`); no map tiles or keys.
import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import type { EventInfo, SimulateResponse, Station } from "@/lib/api";
import { COMFORT, RGB, band, pct } from "@/lib/load";

interface GeoFeature {
  geometry: { type: "LineString" | "Point"; coordinates: number[][] | number[] };
  properties: { kind: "line" | "station"; route?: string; color?: string; name?: string; corridor_id?: string | null };
}
interface Col { id: string; name: string; position: [number, number]; demand: number; lf: number }

const INITIAL_VIEW = { longitude: 55.2775, latitude: 25.2128, zoom: 13.35, pitch: 52, bearing: -38 };

const hexToRgb = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export default function CorridorMap({ sim, stations, event, hour, selected, onSelect }: {
  sim: SimulateResponse | null; stations: Station[]; event: EventInfo | null; hour: number;
  selected: string | null; onSelect: (id: string) => void;
}) {
  const [geo, setGeo] = useState<GeoFeature[]>([]);
  // Client-only component (loaded with ssr: false), so window is available for the lazy initial value.
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    let alive = true;
    fetch("/geo/metro.geojson").then((r) => r.json()).then((d) => alive && setGeo(d.features)).catch(() => alive && setGeo([]));
    return () => { alive = false; };
  }, []);

  const cols: Col[] = useMemo(() => {
    if (!sim) return [];
    return stations.map((s) => {
      const r = sim.hourly.find((x) => x.station_id === s.id && x.hour === hour);
      return { id: s.id, name: s.name_en, position: [s.lon, s.lat], demand: r?.demand ?? 0, lf: r?.peak_lf ?? 0 };
    });
  }, [sim, stations, hour]);

  // Height scale fixed per scenario (max over the day) so scrubbing the hour shows real growth.
  const elevationScale = useMemo(() => {
    const max = Math.max(1, ...(sim?.hourly.map((r) => r.demand) ?? [1]));
    return 900 / max;
  }, [sim]);

  const lines = geo.filter((f) => f.properties.kind === "line");
  const otherStations = geo.filter((f) => f.properties.kind === "station" && !f.properties.corridor_id);

  const layers = [
    new PathLayer<GeoFeature>({
      id: "metro-lines", data: lines,
      getPath: (f) => f.geometry.coordinates as [number, number][],
      getColor: (f) => [...hexToRgb(f.properties.color ?? "#64748B"), f.properties.route === "MRed" ? 200 : 90] as [number, number, number, number],
      getWidth: (f) => (f.properties.route === "MRed" ? 7 : 4), widthUnits: "pixels", capRounded: true, jointRounded: true,
    }),
    new ScatterplotLayer<GeoFeature>({
      id: "other-stations", data: otherStations,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getRadius: 5, radiusUnits: "pixels", getFillColor: [255, 255, 255, 230], getLineColor: [138, 143, 156, 200],
      stroked: true, lineWidthMinPixels: 1.5,
    }),
    event && new ScatterplotLayer({
      id: "venue", data: [event],
      getPosition: (e: EventInfo) => [e.lon, e.lat], getRadius: 9, radiusUnits: "pixels",
      getFillColor: [29, 78, 216, 255], getLineColor: [255, 255, 255, 255], stroked: true, lineWidthMinPixels: 3,
    }),
    new ColumnLayer<Col>({
      id: "station-load", data: cols, diskResolution: 24, radius: 85, extruded: true, pickable: true,
      getPosition: (d) => d.position, getElevation: (d) => d.demand, elevationScale,
      getFillColor: (d) => [...RGB[band(d.lf)], 235] as [number, number, number, number],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 24 },
      transitions: reducedMotion ? undefined : { getElevation: 350, getFillColor: 250 },
      updateTriggers: { getElevation: [hour, sim?.run_id], getFillColor: [hour, sim?.run_id] },
    }),
    // Non-colour cue for over-capacity (WCAG 1.4.1): a ring around the station.
    new ScatterplotLayer<Col>({
      id: "overcap-rings", data: cols.filter((c) => c.lf > COMFORT),
      getPosition: (d) => d.position, getRadius: 170, stroked: true, filled: false,
      getLineColor: [...RGB.risk, 255] as [number, number, number, number], lineWidthMinPixels: 3,
    }),
    new ScatterplotLayer<Col>({
      id: "selected", data: cols.filter((c) => c.id === selected),
      getPosition: (d) => d.position, getRadius: 125, stroked: true, filled: false,
      getLineColor: [29, 78, 216, 255], lineWidthMinPixels: 2.5,
    }),
    new TextLayer<Col>({
      id: "labels", data: cols, getPosition: (d) => d.position,
      getText: (d) => `${d.name}  ${pct(d.lf)}`, getSize: 14, getColor: [27, 31, 42, 255],
      getPixelOffset: [0, 22], fontFamily: "system-ui, sans-serif", fontWeight: 600,
      background: true, getBackgroundColor: [255, 255, 255, 220], backgroundPadding: [6, 3],
      updateTriggers: { getText: [hour, sim?.run_id] },
    }),
    event && new TextLayer({
      id: "venue-label", data: [event], getPosition: (e: EventInfo) => [e.lon, e.lat],
      getText: (e: EventInfo) => `Venue: ${e.venue}`, getSize: 13, getColor: [29, 78, 216, 255],
      getPixelOffset: [0, -20], fontFamily: "system-ui, sans-serif", fontWeight: 600,
      background: true, getBackgroundColor: [255, 255, 255, 220], backgroundPadding: [6, 3],
      characterSet: "auto",
    }),
  ].filter(Boolean);

  return (
    <div className="absolute inset-0" aria-label="3D map of corridor stations coloured by load" role="img">
      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller={{ touchRotate: true, dragRotate: true }}
        layers={layers}
        onClick={(info: PickingInfo<Col>) => info.object && onSelect(info.object.id)}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
        style={{ background: "linear-gradient(180deg, #F6F3EE 0%, #FAF8F5 60%)" }}
      />
      <div className="pointer-events-none absolute bottom-3 end-3 rounded-lg bg-surface/80 px-2 py-1 text-[10px] text-ink-3">
        Geometry: RTA GTFS (open data) · column height = boarding demand · ring = above 85% comfort
      </div>
    </div>
  );
}
