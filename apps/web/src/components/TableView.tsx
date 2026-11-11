"use client";
// Accessible table version of the map + heat strip (PRD story 5). Same numbers, same sources.
import { useState } from "react";
import type { ForecastResponse, SimulateResponse, Station } from "@/lib/api";
import { COMFORT, fmt, hh, pct } from "@/lib/load";

export default function TableView({ forecast, sim, stations }: {
  forecast: ForecastResponse | null; sim: SimulateResponse | null; stations: Station[];
}) {
  const [stationId, setStationId] = useState<string>(stations[0]?.id ?? "");
  const rows = Array.from({ length: 19 }, (_, i) => i + 5).map((h) => ({
    h,
    f: forecast?.rows.find((r) => r.station_id === stationId && r.hour === h),
    s: sim?.hourly.find((r) => r.station_id === stationId && r.hour === h),
  }));

  return (
    <div className="min-h-0 overflow-auto p-6">
      <div className="mb-3 flex items-center gap-3">
        <label className="text-[13px] text-ink-2" htmlFor="tv-station">Station</label>
        <select id="tv-station" value={stationId} onChange={(e) => setStationId(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[14px]">
          {stations.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}
        </select>
        <span className="text-[12px] text-ink-3">Sources: forecast {forecast?.run_id ?? "—"} · simulate {sim?.run_id ?? "—"}</span>
      </div>
      <table className="num w-full max-w-4xl border-collapse text-[13px]">
        <caption className="sr-only">Hourly forecast and simulated load for the selected station</caption>
        <thead>
          <tr className="text-start text-[11px] uppercase tracking-wide text-ink-3">
            <th className="py-2 text-start">Hour</th><th className="text-end">Boardings p10</th><th className="text-end">p50</th>
            <th className="text-end">p90</th><th className="text-end">Capacity /h</th><th className="text-end">Peak 15-min load</th><th className="ps-3 text-start">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, f, s }) => (
            <tr key={h} className="border-t border-line">
              <th scope="row" className="py-1.5 text-start font-medium">{hh(h)}</th>
              <td className="text-end">{fmt(f?.entries_p10 ?? 0)}</td>
              <td className="text-end">{fmt(f?.entries_p50 ?? 0)}</td>
              <td className="text-end">{fmt(f?.entries_p90 ?? 0)}</td>
              <td className="text-end">{fmt(s?.capacity ?? 0)}</td>
              <td className="text-end font-semibold">{pct(s?.peak_lf ?? 0)}</td>
              <td className="ps-3">{(s?.peak_lf ?? 0) > COMFORT ? "Above comfort" : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
