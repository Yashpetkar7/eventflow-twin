"use client";
// Stations × hours heat strip (peak 15-min load in each hour), synced with the map's hour.
import type { SimulateResponse, Station } from "@/lib/api";
import { COMFORT, hh, lfColor, pct } from "@/lib/load";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5); // 05:00–23:00 (metro service hours)

export default function HeatStrip({ sim, stations, hour, onHour, selected, onSelect, view }: {
  sim: SimulateResponse | null; stations: Station[]; hour: number; onHour: (h: number) => void;
  selected: string | null; onSelect: (id: string) => void; view: "before" | "after" | null;
}) {
  const lf = (s: string, h: number) => sim?.hourly.find((r) => r.station_id === s && r.hour === h)?.peak_lf ?? 0;

  return (
    <section className="border-t border-line bg-surface/85 px-5 pb-4 pt-3 backdrop-blur" aria-label="Station load by hour">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="label">Station load by hour {view && <span className="normal-case tracking-normal text-accent">· {view === "after" ? "after approved plan" : "before"}</span>}</h2>
        <span className="text-[11px] text-ink-3">peak 15-min load vs practical capacity · outlined = above 85%</span>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          Hour
          <input type="range" min={5} max={23} value={hour} onChange={(e) => onHour(Number(e.target.value))}
            aria-label="Hour of day" className="w-48" />
          <span className="num w-12 font-semibold">{hh(hour)}</span>
        </label>
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `128px repeat(${HOURS.length}, minmax(0, 1fr))` }}>
        <div />
        {HOURS.map((h) => (
          <button key={h} onClick={() => onHour(h)}
            className={`num text-center text-[10px] ${h === hour ? "font-bold text-accent" : "text-ink-3"}`}>
            {String(h).padStart(2, "0")}
          </button>
        ))}
        {stations.map((s) => (
          <Row key={s.id} station={s} selected={s.id === selected} onSelect={onSelect}>
            {HOURS.map((h) => {
              const v = lf(s.id, h);
              const over = v > COMFORT;
              return (
                <button key={h} onClick={() => { onHour(h); onSelect(s.id); }}
                  title={`${s.name_en} ${hh(h)}: ${pct(v)}`}
                  aria-label={`${s.name_en} ${hh(h)} load ${pct(v)}${over ? ", above comfort" : ""}`}
                  className={`h-6 rounded-[4px] transition-colors ${h === hour ? "ring-2 ring-accent/60" : ""}`}
                  style={{ background: lfColor(v), outline: over ? "2px solid #7F1D1D" : undefined, outlineOffset: -2 }} />
              );
            })}
          </Row>
        ))}
      </div>
    </section>
  );
}

function Row({ station, selected, onSelect, children }: {
  station: Station; selected: boolean; onSelect: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <>
      <button onClick={() => onSelect(station.id)}
        className={`truncate pe-2 text-start text-[12px] ${selected ? "font-semibold text-accent" : "text-ink-2"}`}>
        {station.name_en}
      </button>
      {children}
    </>
  );
}
