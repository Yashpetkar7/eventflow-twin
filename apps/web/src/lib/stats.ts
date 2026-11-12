// Derived views of one simulation. Pure re-arrangements of API numbers (no new metrics are computed here).
import type { ForecastResponse, SimulateResponse, Station } from "./api";

export interface StationDay {
  station: Station;
  peakLf: number;
  peakHour: number;
  boardings: number;        // Σ hourly demand (simulated boardings over the day)
  capacityAtPeak: number;
  served: boolean;          // receives event trips in this forecast
}

export function stationDays(sim: SimulateResponse | null, stations: Station[], forecast: ForecastResponse | null): StationDay[] {
  if (!sim) return [];
  const served = new Set(forecast?.rows.filter((r) => r.event_entries_p50 > 0).map((r) => r.station_id) ?? []);
  const by = new Map<string, SimulateResponse["hourly"]>();
  for (const r of sim.hourly) {
    if (!by.has(r.station_id)) by.set(r.station_id, []);
    by.get(r.station_id)!.push(r);
  }
  return stations.map((s) => {
    const rows = by.get(s.id) ?? [];
    const peak = rows.reduce((a, b) => (b.peak_lf > (a?.peak_lf ?? -1) ? b : a), rows[0]);
    return {
      station: s, peakLf: peak?.peak_lf ?? 0, peakHour: peak?.hour ?? 0, capacityAtPeak: peak?.capacity ?? 0,
      boardings: rows.reduce((t, r) => t + r.demand, 0), served: served.has(s.id),
    };
  });
}

/** Stations worth a row on the Live twin heat strip: the selected one, event-served ones, then the busiest. */
export function relevantStations(days: StationDay[], selected: string | null, max = 8): Station[] {
  const pick: StationDay[] = [];
  const add = (d?: StationDay) => d && !pick.includes(d) && pick.length < max && pick.push(d);
  add(days.find((d) => d.station.id === selected));
  days.filter((d) => d.served).sort((a, b) => b.peakLf - a.peakLf).forEach(add);
  [...days].sort((a, b) => b.peakLf - a.peakLf).forEach(add);
  const order = new Map(days.map((d, i) => [d.station.id, i]));     // keep line order on screen
  return pick.sort((a, b) => order.get(a.station.id)! - order.get(b.station.id)!).map((d) => d.station);
}
