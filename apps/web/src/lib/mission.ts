"use client";
// The agent team's mission (POST /agent/run, contract 1.11.0): how its events are played back on screen and put
// into words. Every figure in an event comes from the API (the simulator's run is in `run_id`); this module only
// chooses words and pacing.
import { useTranslations } from "next-intl";
import type { AgentEvent, Mission, Station } from "./api";
import { useFmt } from "./i18n";

/** The eight steps the AI tab and the kiosk have always shown, and which agents' work belongs to each. */
export const STEP_OF: Record<string, number> = {
  supervisor: 0, intake: 0, forecast: 1, diagnosis: 2, rail: 3, station_crowd: 3, venue: 3, last_mile: 3, composer: 3,
  simulation: 4, critic: 4, ranker: 5, stress: 5, explainer: 6, verifier: 7, human: 7,
};
/** The progress step an event belongs to: the planner's brief opens the mission (step 0), an approval closes it. */
export const stepOf = (e: { agent: string; key: string }, prev: number): number =>
  e.key === "human.brief" || e.key === "checkpoint.answer" ? prev : Math.max(prev, STEP_OF[e.agent] ?? prev);

/** Agents by layer, in the order the team works (layer 6 = standing agents, not part of a planning mission). */
export const LAYER_AGENTS: Record<number, string[]> = {
  1: ["supervisor"], 2: ["intake", "forecast", "diagnosis"], 3: ["rail", "station_crowd", "venue", "last_mile", "composer"],
  4: ["simulation", "critic", "stress", "ranker"], 5: ["explainer", "verifier", "messenger", "human"], 6: ["watcher", "ask"],
};

/** Milliseconds between two events when a mission is played back. */
export function paceFor(kiosk: boolean, reduced: boolean): number {
  if (reduced) return 25;
  return kiosk ? 360 : 170;
}

/** The station a mission is working on, when an event names one (the twin can look there). */
export function stationOf(e: AgentEvent): string | null {
  const p = e.params as Record<string, unknown>;
  return (typeof p.worst === "string" && p.worst) || (typeof p.station === "string" && p.station) || null;
}

/** One sentence per event, in the current language. Unknown keys fall back to "agent: key" (never an empty line). */
export function useEventText(stations: Station[]) {
  const t = useTranslations("mission");
  // keys built at run time (a measure, a priority …): checked with has() or listed in en.json / ar.json
  const td = t as unknown as ((k: string, v?: Record<string, string | number>) => string) & { has: (k: string) => boolean };
  const f = useFmt();
  const name = (id: unknown) => {
    if (typeof id !== "string") return "";
    const st = stations.find((s) => s.id === id);
    return st ? f.station(st) : id;
  };
  const kind = (k: string) => (td.has(`measure.${k}`) ? td(`measure.${k}`) : k);
  return (e: AgentEvent): string => {
    const p = e.params as Record<string, unknown>;
    const n = (k: string) => f.int(Number(p[k] ?? 0));
    const pct = (k: string) => (p[k] == null ? "–" : `${f.int(Number(p[k]))}%`);
    const types = ((p.types as string[] | undefined) ?? []).map(kind);
    switch (e.key) {
      case "supervisor.start": return t("ev.start");
      case "human.brief": return t("ev.humanBrief", { summary: String(p.summary ?? ""), removed: ((p.removed as string[]) ?? []).length });
      case "intake.objective": return t("ev.objective", { thr: pct("threshold_pct"), prio: td(`prio.${String(p.priority)}`),
        n: ((p.forbid as string[]) ?? []).length + ((p.protect as string[]) ?? []).length + (p.cost_cap != null ? 1 : 0) });
      case "intake.finding": return t("ev.finding", { field: td(`field.${String(p.field)}`) });
      case "intake.model": return t("ev.intakeModel", { n: ((p.suggestions as string[]) ?? []).length });
      case "forecast.run": return t("ev.forecast", { attendance: p.attendance == null ? "–" : f.int(Number(p.attendance)), share: pct("metro_share_pct") });
      case "diagnosis.baseline": return t("ev.baseline", { over: f.num(Number(p.over ?? 0)), excess: n("excess"), peak: pct("peak_pct") });
      case "diagnosis.hotspots": return t("ev.hotspots", { station: name(p.worst), n: ((p.stations as unknown[]) ?? []).length });
      case "diagnosis.none": return t("ev.none", { thr: pct("threshold_pct") });
      case "diagnosis.breakpoint": return p.attendance == null ? t("ev.noBreak") : t("ev.breakpoint", { att: n("attendance"), station: name(p.station) });
      case "diagnosis.road": return t("ev.road", { veh: n("peak_veh"), hour: String(p.hour ?? "") });
      case "supervisor.brief": return t("ev.brief", { station: name(p.station), gap: n("gap") });
      // since contract 1.14.0 each specialist says how it sized its measure; older snapshots fall back to the count
      case "rail.proposed":
        if (p.headway != null) return t("ev.railSized", { need: f.num(Number(p.need_tph ?? 0)), now: f.num(Number(p.tph_now ?? 0)), gap: n("gap"), hw: f.num(Number(p.headway)) });
        return t("ev.proposed", { n: n("n"), kinds: types.join(" + ") || "–", station: name(p.station) });
      case "station_crowd.proposed":
        if (p.share_pct != null) return t("ev.crowdSized", { share: pct("share_pct"), to: name(p.toward), room: n("room") });
        return t("ev.proposed", { n: n("n"), kinds: types.join(" + ") || "–", station: name(p.station) });
      case "last_mile.proposed":
        if (p.buses != null) return t("ev.mileSized", { buses: n("buses"), to: name(p.toward), per: n("per_bus"), veh: Number(p.vehicles ?? 0) });
        return t("ev.proposed", { n: n("n"), kinds: types.join(" + ") || "–", station: name(p.station) });
      case "venue.stagger":
        if (!p.available) return t("ev.staggerNo");
        if (Array.isArray(p.tried) && p.tried.length) return t("ev.staggerProbe", { tried: (p.tried as number[]).map((x) => f.int(x)).join(", "), m: n("spread"), clears: p.clears ? "yes" : "no" });
        return t("ev.staggerYes", { m: n("spread") });
      case "critic.recommend": return t("ev.recommend", { rank: String(p.rank ?? ""), p: n("passed"), n: n("applicable") });
      case "critic.objection": {
        const own = ((p.own as string[]) ?? []).map(kind).join(" + ");
        return t("ev.objection", { station: name(p.station), excess: n("excess"), own: own || "none" });
      }
      case "rail.revised": case "station_crowd.revised": case "venue.revised": case "last_mile.revised": {
        const ch = ((p.resized as { type: string; setting: string; before: number; after: number }[]) ?? []).map((c) => {
          const v = (x: number) => (c.setting === "share" || c.setting === "max_load" ? `${f.int(x * 100)}%` : f.num(x));
          return `${kind(c.type)} ${v(c.before)} → ${v(c.after)}`;
        });
        return ch.length ? t("ev.revised", { changes: ch.join(" · "), added: n("added") }) : t("ev.revisedNone", { added: n("added") });
      }
      case "specialist.model": return t("ev.specModel", { n: n("n"), d: n("dropped") });
      case "composer.bundles": return t("ev.bundles", { total: f.int(Number(p.menu ?? 0) + Number(p.cross ?? 0) + Number(p.model ?? 0)),
        menu: n("menu"), cross: n("cross"), model: n("model") });
      case "composer.replan": return t("ev.replanBundles", { round: String(e.round), n: n("variants"), station: name(p.station) });
      case "critic.forbidden": return t("ev.forbidden", { kinds: types.join(" + ") });
      case "simulation.result": return t("ev.sim", { plan: types.join(" + ") || String(p.label), excess: n("excess"), peak: pct("peak_pct"),
        moves: ((p.new_hotspots as string[]) ?? []).length ? t("ev.moves", { station: name((p.new_hotspots as string[])[0]) }) : "" });
      case "critic.verdict": return p.verdict === "goal_met" ? t("ev.met", { a: n("meeting"), b: n("tested") })
        : p.verdict === "residual" ? t("ev.residual", { excess: n("excess"), station: name(p.station) }) : t("ev.noRelief");
      case "critic.no_action": return t("ev.noAction");
      case "supervisor.replan": return t("ev.replan", { round: String(p.next_round ?? "") });
      case "checkpoint.ask": return td("ev.cpAsk", { what: p.checkpoint === "hotspot" ? td("ev.cpHotspot", { station: name(p.station) })
        : td("ev.cpPartial", { station: name(p.station), excess: n("excess") }) });
      case "checkpoint.answer": return td("ev.cpAnswer", { what: td(`ev.cpA.${String(p.action)}`, { station: name(p.station) }) });
      case "diagnosis.focus": return td("ev.focus", { station: name(p.worst) });
      case "supervisor.rank": return td(`ev.stop.${["goal_met", "max_rounds", "budget", "no_relief"].includes(String(p.reason)) ? String(p.reason) : "other"}`);
      case "ranker.kept": return t("ev.kept", { k: n("kept"), n: n("tested") });
      case "stress.result": return t("ev.stress", { rank: String(p.rank), holds: n("holds"), total: n("total") });
      case "explainer.wrote": return p.source === "template" ? t("ev.wroteTemplate", { n: n("options") }) : t("ev.wroteModel", { n: n("options"), model: String(p.source) });
      case "explainer.model": return t("ev.explainModel", { k: n("kept") });
      case "verifier.checked": return t(p.all_matched ? "ev.verified" : "ev.mismatch", { n: n("checked"), blocked: ((p.claims_blocked as number[]) ?? []).length });
      case "human.awaiting": return t("ev.human", { n: n("options") });
      case "supervisor.no_action": return t("ev.noActionDone");
      default: return `${e.agent}: ${e.key.replace(/^classic\./, "")}`;
    }
  };
}

/** Plain-language label of the recording behind a mission's model answers. */
export function recordingKey(m: Mission | null): "code" | "recorded" | "live" | "mixed" {
  return (m?.recording.mode ?? "code") as "code" | "recorded" | "live" | "mixed";
}
