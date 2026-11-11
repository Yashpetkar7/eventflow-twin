// PREVIEW PLANNER — used only while POST /agent/plan returns 501 (Stream B not merged yet).
// It proposes a fixed menu of candidate bundles around the worst hotspot, and every number comes from the
// real /simulate tool. Rationale text is a deterministic template, clearly labelled. No AI involved.
// Delete this file (and its call site) once the agent endpoint is live.
import { api, type AgentPlanResponse, type Intervention, type PlanOption, type SimulateResponse, type Station } from "./api";
import { COMFORT, fmt, pct } from "./load";

const LAMBDA = 20; // mirrors corridor.yaml interventions.ranking_lambda (preview only)

interface Candidate {
  title: string;
  interventions: Intervention[];
}

function hotHours(base: SimulateResponse): number[] {
  const hours = new Set<number>();
  for (const r of base.hourly) if (r.peak_lf > COMFORT) [r.hour - 1, r.hour, r.hour + 1].forEach((h) => h >= 0 && h <= 23 && hours.add(h));
  return [...hours].sort((a, b) => a - b);
}

function candidates(base: SimulateResponse, stations: Station[], hasEvent: boolean): Candidate[] {
  const hours = hotHours(base);
  if (!hours.length) return [];
  const peakBy = new Map<string, number>();
  for (const r of base.hourly) peakBy.set(r.station_id, Math.max(peakBy.get(r.station_id) ?? 0, r.peak_lf));
  const order = stations.map((s) => s.id);
  const hot = [...peakBy.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const name = (id: string) => stations.find((s) => s.id === id)?.name_en ?? id;
  const i = order.indexOf(hot);
  const neighbours = [order[i - 1], order[i + 1]].filter(Boolean) as string[];
  const calmNeighbour = neighbours.sort((a, b) => (peakBy.get(a) ?? 0) - (peakBy.get(b) ?? 0))[0];
  const farCalm = order.filter((s) => s !== hot && !neighbours.includes(s))
    .sort((a, b) => (peakBy.get(a) ?? 0) - (peakBy.get(b) ?? 0))[0];

  const out: Candidate[] = [
    { title: "Run trains every 2.5 minutes through the peak", interventions: [{ type: "extra_trains", params: { headway_min: 2.5, hours, line: "Red" } }] },
    { title: `Robotaxis staged at ${name(hot)}`, interventions: [{ type: "robotaxi_staging", params: { station: hot, vehicles: 30, hours } }] },
  ];
  if (calmNeighbour) out.push({ title: `Guide visitors on foot from ${name(hot)} to ${name(calmNeighbour)}`,
    interventions: [{ type: "wayfinding_redirect", params: { from_station: hot, to_station: calmNeighbour, share: 0.3, hours } }] });
  if (farCalm) out.push({ title: `Feeder shuttle from ${name(hot)} to ${name(farCalm)}`,
    interventions: [{ type: "shuttle_bus", params: { from_station: hot, to_station: farCalm, buses: 10, hours } }] });
  if (hasEvent && farCalm) out.push({ title: "Stagger the exit and run a feeder shuttle",
    interventions: [{ type: "staggered_exit", params: { spread_minutes: 45 } },
      { type: "shuttle_bus", params: { from_station: hot, to_station: farCalm, buses: 8, hours } }] });
  return out;
}

function rationale(title: string, sim: SimulateResponse): string {
  const b = sim.baseline_summary, s = sim.summary;
  return `${title}. Simulated over-capacity station-hours ${fmt(b.overcap_station_hours, 2)} → ${fmt(s.overcap_station_hours, 2)}; ` +
    `passengers above comfort ${fmt(b.excess_pax)} → ${fmt(s.excess_pax)}; peak load ${pct(b.peak_lf)} → ${pct(s.peak_lf)}; ` +
    `longest wait ${fmt(b.max_wait_min, 1)} → ${fmt(s.max_wait_min, 1)} min. Cost proxy ${fmt(s.cost_proxy, 1)}.`;
}

export async function previewPlan(forecastRunId: string, base: SimulateResponse, stations: Station[],
  hasEvent: boolean): Promise<AgentPlanResponse> {
  const cands = candidates(base, stations, hasEvent);
  const sims = await Promise.all(cands.map((c) => api.simulate(forecastRunId, c.interventions).catch(() => null)));
  const scored = cands
    .map((c, k) => ({ c, sim: sims[k] }))
    .filter((x): x is { c: Candidate; sim: SimulateResponse } => !!x.sim)
    .map(({ c, sim }) => ({
      c, sim,
      score: base.summary.excess_pax - sim.summary.excess_pax - LAMBDA * sim.summary.cost_proxy,
      // preview rule (team decision pending, TEAM_PLAN §3 A6): never rank an option that adds over-capacity
      // station-hours above one that does not
      worsens: sim.summary.overcap_station_hours > base.summary.overcap_station_hours,
    }))
    .filter((x) => x.sim.summary.excess_pax < base.summary.excess_pax)
    .sort((a, b) => Number(a.worsens) - Number(b.worsens) || b.score - a.score)
    .slice(0, 3);

  const options: PlanOption[] = scored.map(({ c, sim, score }, k) => ({
    rank: k + 1,
    title: c.title,
    interventions: c.interventions,
    summary: sim.summary,
    delta: sim.delta,
    score: Math.round(score * 10) / 10,
    rationale: rationale(c.title, sim),
    sources: [sim.source, { tool: "forecast", run_id: forecastRunId }],
  }));
  return {
    plan_id: `preview_${forecastRunId}`,
    forecast_run_id: forecastRunId,
    mode: "offline",
    is_synthetic: base.is_synthetic,
    baseline_summary: base.summary,
    options,
    verify: { numbers_checked: 0, all_matched: true, fallback_used: true },
  };
}
