// Kiosk helpers without React: where the crowd peaks, a visitor's own idea as interventions, the rider tip, the
// reported New Year's Eve measures, and the booth's anonymous counters. Every figure these return is read from an
// API answer (CLAUDE.md rule 2); the only constants are request values and the definition of "quiet".
import type { Intervention } from "@/lib/api";
import { BUILD0, buildInterventions, T_MAX, T_MIN, type BuildState, type SimView } from "@/lib/store";

export interface Peak { id: string; lf: number; time: number; bin: number }

/** Busiest corridor station and moment of the day (from the simulator's 15-minute load factors). */
export function busiest(v: SimView | null, ids: string[]): Peak | null {
  if (!v) return null;
  let best: Peak | null = null;
  for (const id of ids) v.by[id]?.lf.forEach((lf, b) => {
    const t = (b + 0.5) / v.bph;
    if (t >= T_MIN && t <= T_MAX && (!best || lf > best.lf)) best = { id, lf, time: t, bin: b };
  });
  return best;
}

/** The quieter of the two stations next to `id` along the corridor at 15-minute bin `bin`. */
export function neighbour(v: SimView | null, ids: string[], id: string, bin: number): string {
  const i = ids.indexOf(id);
  const near = [ids[i - 1], ids[i + 1]].filter((x): x is string => !!x);
  return near.sort((a, b) => (v?.by[a]?.lf[bin] ?? 0) - (v?.by[b]?.lf[bin] ?? 0))[0] ?? id;
}

// ---- "your idea first": one lever at the strength the workspace's "My plan" offers, aimed at the hotspot
export const IDEAS = ["trains", "shuttle", "stagger", "loop", "meter"] as const;
export type Idea = (typeof IDEAS)[number];

export function ideaInterventions(idea: Idea, v: SimView | null, ids: string[]): Intervention[] {
  const p = busiest(v, ids);
  if (!v || !p) return [];
  const to = neighbour(v, ids, p.id, p.bin);
  const preset: Record<Idea, Partial<BuildState>> = {
    trains: { headway: 2.5 },
    shuttle: { buses: 8, busFrom: p.id, busTo: to },
    stagger: { stag: 60 },
    loop: { wayShare: 30, wayFrom: p.id, wayTo: to },              // on foot to the quieter neighbour (Future Loop what-if)
    meter: { meterLoad: 85, meterAt: p.id, meterTo: "" },
  };
  return buildInterventions({ ...BUILD0, ...preset[idea] }, v, ids);
}

// ---- "a station has to close": entry closed around the event's exit, riders guided to the quieter neighbour
export function closure(id: string, v: SimView | null, ids: string[], endHour: number): Intervention[] {
  const hours = [endHour - 1, endHour, endHour + 1, endHour + 2].filter((h) => h >= 5 && h <= 23);
  const bin = Math.round(endHour * (v?.bph ?? 4));
  return [{ type: "station_metering", params: { station: id, max_load: 0, hours, to_station: neighbour(v, ids, id, bin) } }];
}

// ---- RTA's reported New Year's Eve 2026 measures, as interventions the simulator understands (sources: strings.ts)
export const PLAYBOOK_EVENT = "downtown_night";
export function playbook(v: SimView | null, ids: string[]): Intervention[] {
  const hours = [17, 18, 19, 20, 21, 22, 23];
  return [
    { type: "station_metering", params: { station: "BKD", max_load: 0, hours, to_station: neighbour(v, ids, "BKD", 21 * (v?.bph ?? 4)) } },
    { type: "extra_trains", params: { headway_min: 2.5, hours, line: "Red" } },
    { type: "extended_hours", params: { line: "Red", hours: [0, 1, 2], headway_min: 10 } },
  ];
}

// ---- rider tip: when and where to board after the event
export const QUIET_LF = 0.6;             // definition used on screen: "quieter" = trains under 60 % full
export interface Slot { id: string; time: string; t: number; wait: number; lf: number }

export function riderAdvice(v: SimView | null, served: string[], endHour: number, quiet: boolean, thr: number): { worst: Slot; tip: Slot } | null {
  if (!v) return null;
  const slots: Slot[] = v.resp.rows
    .filter((r) => served.includes(r.station_id))
    .map((r) => ({ id: r.station_id, time: r.time, t: (r.bin + 0.5) / v.bph, wait: r.wait_min, lf: r.load_factor }))
    .filter((s) => s.t >= endHour - 0.25 && s.t <= Math.min(T_MAX, endHour + 2.5));
  if (!slots.length) return null;
  const worst = [...slots].sort((a, b) => b.lf - a.lf || b.wait - a.wait)[0];
  const ok = (s: Slot) => (quiet ? s.lf <= QUIET_LF : s.lf <= thr && s.wait <= 3);
  const byTime = [...slots].sort((a, b) => a.t - b.t || a.lf - b.lf);
  const tip = byTime.find(ok) ?? [...slots].sort((a, b) => a.lf - b.lf || a.t - b.t)[0];
  return { worst, tip };
}

// ---- anonymous booth counters (this browser only; nothing personal, nothing leaves the laptop)
const KEY = "eft_kiosk_stats_v1";
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
export type Stats = Record<string, Record<string, number>>;       // day → counter → count

export function readStats(): Stats {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Stats; } catch { return {}; }
}
export function bump(counter: string): void {
  try {
    const all = readStats(), d = (all[day()] ??= {});
    d[counter] = (d[counter] ?? 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the kiosk works without counters */ }
}
export const todayStats = (): Record<string, number> => readStats()[day()] ?? {};
