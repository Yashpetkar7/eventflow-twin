// PREVIEW PLANNER — used only while POST /agent/plan returns 501 (Stream B not merged yet).
// It proposes a fixed menu of candidate bundles around the worst hotspot, and every number comes from the
// real /simulate tool. Text is a deterministic template, clearly labelled. No AI involved.
// Delete this file (and its call sites) once the agent endpoint is live.
import {
  api, type AgentPlanResponse, type Intervention, type PlanOption, type SimSummary, type SimulateResponse, type Station,
} from "./api";
import { COMFORT } from "./load";

/** Language-neutral description of a preview option, so its text can be re-rendered when the locale changes. */
export type OptionLabel =
  | { kind: "trains" }
  | { kind: "robotaxi"; station: string }
  | { kind: "walk"; from: string; to: string }
  | { kind: "shuttle"; from: string; to: string }
  | { kind: "stagger" };

/** Localised text for preview options (built by the caller from next-intl messages). */
export interface PlannerText {
  title: (label: OptionLabel, stations: Station[]) => string;
  rationale: (title: string, base: SimSummary, s: SimSummary) => string;
}

export interface PreviewResult {
  plan: AgentPlanResponse;
  labels: Record<number, OptionLabel>; // by option rank
}

const LAMBDA = 20; // mirrors corridor.yaml interventions.ranking_lambda (preview only)

interface Candidate { label: OptionLabel; interventions: Intervention[] }

function hotHours(base: SimulateResponse): number[] {
  const hours = new Set<number>();
  for (const r of base.hourly) {
    if (r.peak_lf > COMFORT) [r.hour - 1, r.hour, r.hour + 1].forEach((h) => h >= 0 && h <= 23 && hours.add(h));
  }
  return [...hours].sort((a, b) => a - b);
}

function candidates(base: SimulateResponse, stations: Station[], hasEvent: boolean): Candidate[] {
  const hours = hotHours(base);
  if (!hours.length) return [];
  const peakBy = new Map<string, number>();
  for (const r of base.hourly) peakBy.set(r.station_id, Math.max(peakBy.get(r.station_id) ?? 0, r.peak_lf));
  const order = stations.map((s) => s.id);
  const hot = [...peakBy.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const i = order.indexOf(hot);
  const calm = (ids: string[]) => [...ids].sort((a, b) => (peakBy.get(a) ?? 0) - (peakBy.get(b) ?? 0))[0];
  const neighbours = [order[i - 1], order[i + 1]].filter(Boolean) as string[];
  const calmNeighbour = calm(neighbours);
  const farCalm = calm(order.filter((s) => s !== hot && !neighbours.includes(s)));

  const out: Candidate[] = [
    { label: { kind: "trains" }, interventions: [{ type: "extra_trains", params: { headway_min: 2.5, hours, line: "Red" } }] },
    { label: { kind: "robotaxi", station: hot }, interventions: [{ type: "robotaxi_staging", params: { station: hot, vehicles: 30, hours } }] },
  ];
  if (calmNeighbour) out.push({ label: { kind: "walk", from: hot, to: calmNeighbour },
    interventions: [{ type: "wayfinding_redirect", params: { from_station: hot, to_station: calmNeighbour, share: 0.3, hours } }] });
  if (farCalm) out.push({ label: { kind: "shuttle", from: hot, to: farCalm },
    interventions: [{ type: "shuttle_bus", params: { from_station: hot, to_station: farCalm, buses: 10, hours } }] });
  if (hasEvent && farCalm) out.push({ label: { kind: "stagger" },
    interventions: [{ type: "staggered_exit", params: { spread_minutes: 45 } },
      { type: "shuttle_bus", params: { from_station: hot, to_station: farCalm, buses: 8, hours } }] });
  return out;
}

export async function previewPlan(forecastRunId: string, base: SimulateResponse, stations: Station[],
  hasEvent: boolean, tx: PlannerText): Promise<PreviewResult> {
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

  const labels: Record<number, OptionLabel> = {};
  const options: PlanOption[] = scored.map(({ c, sim, score }, k) => {
    labels[k + 1] = c.label;
    const title = tx.title(c.label, stations);
    return {
      rank: k + 1, title, interventions: c.interventions, summary: sim.summary, delta: sim.delta,
      score: Math.round(score * 10) / 10, rationale: tx.rationale(title, base.summary, sim.summary),
      sources: [sim.source, { tool: "forecast", run_id: forecastRunId }],
    };
  });
  return {
    labels,
    plan: {
      plan_id: `preview_${forecastRunId}`, forecast_run_id: forecastRunId, mode: "offline",
      is_synthetic: base.is_synthetic, baseline_summary: base.summary, options,
      verify: { numbers_checked: 0, all_matched: true, fallback_used: true },
    },
  };
}
