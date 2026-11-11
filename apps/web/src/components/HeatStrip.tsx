"use client";
// Stations × hours heat strip (peak 15-min load in each hour), synced with the map's hour.
// Hours run in reading direction (right-to-left in Arabic), which the CSS grid does automatically.
import { useTranslations } from "next-intl";
import type { SimulateResponse, Station } from "@/lib/api";
import { useFmt, useNames } from "@/lib/i18n";
import { COMFORT, lfColor } from "@/lib/load";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => i + a);
const HOURS = range(5, 23);        // metro service hours
const KIOSK_HOURS = range(7, 22);  // kiosk: 16 columns so every cell is a ≥ 48 px touch target

export default function HeatStrip({ sim, stations, hour, onHour, selected, onSelect, view, kiosk }: {
  sim: SimulateResponse | null; stations: Station[]; hour: number; onHour: (h: number) => void;
  selected: string | null; onSelect: (id: string) => void; view: "before" | "after" | null; kiosk: boolean;
}) {
  const t = useTranslations("strip");
  const { pct, hh } = useFmt();
  const names = useNames();
  const hours = kiosk ? KIOSK_HOURS : HOURS;
  const lf = (s: string, h: number) => sim?.hourly.find((r) => r.station_id === s && r.hour === h)?.peak_lf ?? 0;

  return (
    <section className="border-t border-line bg-surface/85 px-5 pb-4 pt-3 backdrop-blur" aria-label={t("title")}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="label">{t("title")} {view && <span className="normal-case tracking-normal text-accent">· {view === "after" ? t("viewAfter") : t("viewBefore")}</span>}</h2>
        {!kiosk && <span className="text-[11px] text-ink-3">{t("hint")}</span>}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          {t("hour")}
          <input type="range" min={hours[0]} max={hours[hours.length - 1]} value={hour} onChange={(e) => onHour(Number(e.target.value))}
            aria-label={t("hourAria")} aria-valuetext={hh(hour)} className={kiosk ? "w-72" : "w-48"} />
          <span className="num w-12 font-semibold">{hh(hour)}</span>
        </label>
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `${kiosk ? "92px" : "minmax(96px, 128px)"} repeat(${hours.length}, minmax(0, 1fr))` }}>
        <div />
        {hours.map((h) => (
          <button key={h} onClick={() => onHour(h)} tabIndex={-1}
            className={`num text-center text-[10px] ${h === hour ? "font-bold text-accent" : "text-ink-3"}`}>
            {String(h).padStart(2, "0")}
          </button>
        ))}
        {stations.map((s) => (
          <Row key={s.id} label={names.station(s)} selected={s.id === selected} wrap={kiosk} onClick={() => onSelect(s.id)}>
            {hours.map((h) => {
              const v = lf(s.id, h);
              const over = v > COMFORT;
              return (
                <button key={h} onClick={() => { onHour(h); onSelect(s.id); }}
                  aria-label={t("cell", { station: names.station(s), hour: hh(h), load: pct(v), over: over ? "yes" : "no" })}
                  className={`${kiosk ? "h-10" : "h-6"} rounded-[4px] transition-colors ${h === hour ? "ring-2 ring-accent/60" : ""}`}
                  style={{ background: lfColor(v), outline: over ? "2px solid #7F1D1D" : undefined, outlineOffset: -2 }} />
              );
            })}
          </Row>
        ))}
      </div>
    </section>
  );
}

function Row({ label, selected, wrap, onClick, children }: {
  label: string; selected: boolean; wrap: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <>
      <button onClick={onClick} title={label} className={`${wrap ? "line-clamp-2 leading-tight" : "truncate"} pe-2 text-start text-[12px] ${selected ? "font-semibold text-accent" : "text-ink-2"}`}>
        {label}
      </button>
      {children}
    </>
  );
}
