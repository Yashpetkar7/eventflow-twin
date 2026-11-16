"use client";
// The "AI team" tab (contract 1.11.0, docs/15): who is working, what each agent did, the planner's typed constraints,
// the critic's checks, the stress test, the plans that were not offered, the budget and the measured accuracy.
// Every figure is read from the mission or from /evidence; nothing is computed here.
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type Evidence, type Mission } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { LAYER_AGENTS, useEventText } from "@/lib/mission";
import { CORRIDOR_ORDER, useTwin } from "@/lib/store";
import { DebateCard } from "./Debate";
import { AskCard, MessengerCard } from "./Standing";

const MEASURES = ["extra_trains", "extended_hours", "station_metering", "wayfinding_redirect", "staggered_exit", "shuttle_bus", "robotaxi_staging"] as const;
const CAPS = [null, 20, 50, 150] as const;

/** Agents by layer, each lit while it works and ticked once it has acted. */
export function TeamGraph({ mission, shown, compact = false }: { mission: Mission | null; shown: number; compact?: boolean }) {
  const t = useTranslations("mission");
  const td = t as unknown as (k: string) => string;
  const evs = mission ? mission.events.slice(0, shown) : [];
  const acted = new Set(evs.map((e) => e.agent));
  const now = evs.length && shown < (mission?.events.length ?? 0) ? evs[evs.length - 1].agent : null;
  const kinds = Object.fromEntries((mission?.roster ?? []).map((a) => [a.id, a.kind]));
  return (
    <div className={`team-graph${compact ? " compact" : ""}`} data-testid="team-graph" role="list" aria-label={t("graph")}>
      {[1, 2, 3, 4, 5].map((L) => (
        <div key={L} className="team-layer" role="listitem">
          <span className="team-layer-name"><bdi>{td(`layer.${L}`)}</bdi></span>
          <div className="team-chips">
            {LAYER_AGENTS[L].filter((a) => a !== "messenger").map((a) => (
              <span key={a} data-agent={a} className={`team-chip ${kinds[a] ?? (a === "human" ? "human" : "code")}${now === a ? " on" : acted.has(a) ? " done" : ""}`}>
                <i aria-hidden="true">{acted.has(a) && now !== a ? "✓" : kinds[a] === "model" ? "AI" : a === "human" ? "◉" : "</>"}</i>
                <bdi>{td(`agent.${a}`)}</bdi>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The latest agent events, newest last; each line written from the event's own figures. */
export function TeamFeed({ mission, shown, max = 60 }: { mission: Mission; shown: number; max?: number }) {
  const t = useTranslations("mission");
  const td = t as unknown as (k: string) => string;
  const stations = useTwin((s) => s.stations);
  const text = useEventText(stations);
  const evs = mission.events.slice(Math.max(0, shown - max), shown);
  return (
    <ol className="team-feed" data-testid="team-feed" aria-live="polite">
      {evs.map((e) => (
        <li key={e.seq} className={`L${e.layer}`} data-key={e.key}>
          <span className="who">{td(`agent.${e.agent}`)}{e.llm ? <em className="ai">AI</em> : null}</span>
          <span className="what"><bdi><N>{text(e)}</N></bdi>{e.run_id ? <small><bdi>{e.run_id}</bdi></small> : null}</span>
        </li>
      ))}
    </ol>
  );
}

function Scorecard() {
  const t = useTranslations("mission");
  const f = useFmt();
  const [ev, setEv] = useState<Evidence | null>(null);
  useEffect(() => { void api.evidence().then(setEv, () => setEv(null)); }, []);
  if (!ev) return null;
  const m = (suite: string, k: string) => ev.eval[suite]?.metrics?.[k] as number | undefined;
  const rows: [string, string, number | undefined, "pct" | "s" | "int"][] = [
    ["faithful", "agents", m("agents", "number_faithfulness"), "pct"],
    ["engines", "orchestration", m("orchestration", "engines_agree"), "pct"],
    ["criticRecall", "critic", m("critic", "critic_recall"), "pct"],
    ["coverage", "optimality", m("optimality", "goal_coverage"), "pct"],
    ["gap", "optimality", m("optimality", "relief_gap_max"), "pct"],
    ["attack", "redteam", m("redteam", "attack_success_rate"), "pct"],
    ["detect", "redteam", m("redteam", "injection_detection_recall"), "pct"],
    ["p95", "orchestration", m("orchestration", "mission_p95_s"), "s"],
  ];
  return (
    <div className="card" data-testid="team-scorecard">
      <h3 className="team-h">{t("scorecard")}</h3>
      <table className="team-score">
        <tbody>
          {rows.filter((r) => r[2] !== undefined).map(([k, suite, v, kind]) => (
            <tr key={k}>
              <th scope="row">{t(`score.${k}` as "score.faithful")}</th>
              <td><N>{kind === "pct" ? f.pct(v!) : kind === "s" ? `${f.num(v!, 2)} s` : f.int(v!)}</N><small><bdi>{t("from", { file: ev.eval[suite]?.file ?? suite })}</bdi></small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamTab() {
  const t = useTranslations("mission");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const { locale } = useLocale();
  const mission = useTwin((s) => s.mission);
  const shown = useTwin((s) => s.missionShown);
  const status = useTwin((s) => s.planStatus);
  const ready = useTwin((s) => !!s.forecast && !s.loading);
  const cons = useTwin((s) => s.constraints);
  const stations = useTwin((s) => s.stations);
  const drafts = useTwin((s) => s.drafts);
  const [replay, setReplay] = useState<number | null>(null);
  const n = replay ?? shown;
  useEffect(() => {
    if (replay === null || !mission) return;
    if (replay >= mission.events.length) { const id = setTimeout(() => setReplay(null), 600); return () => clearTimeout(id); }
    const id = setTimeout(() => setReplay(replay + 1), 160);
    return () => clearTimeout(id);
  }, [replay, mission]);
  const corridor = useMemo(() => CORRIDOR_ORDER.map((id) => stations.find((s) => s.id === id)).filter(Boolean), [stations]);
  const run = () => void useTwin.getState().runAgents(locale);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const counts = mission?.counts;
  const rec = mission?.recording;
  const name = (id: string) => f.station(stations.find((s) => s.id === id));
  return (
    <>
      <div className="card">
        <h2 style={{ margin: 0 }}>{t("title")}</h2>
        <p className="note"><N>{t("lede", { agents: counts?.agents ?? 18, model: counts?.model_capable ?? 8 })}</N></p>
        {mission && (
          <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <span className="badge sm navy" data-testid="team-engine">{td(`engine.${mission.engine}`)}</span>
            <span className="badge sm" data-testid="team-recording"><N>{td(`rec.${rec?.mode ?? "code"}`, { date: rec?.recorded_at ?? "", model: rec?.model ?? "" })}</N></span>
          </div>
        )}
        <button type="button" className="btn red" style={{ width: "100%", marginTop: 10 }} disabled={status === "running" || !ready} onClick={run} data-testid="team-run">
          {mission ? t("rerun") : t("run")}
        </button>
        {status === "running" && <button type="button" className="pill" style={{ marginTop: 6 }} onClick={() => useTwin.getState().skipMission()}>{t("skip")}</button>}
        {!mission && status !== "running" && <p className="note" style={{ marginTop: 8 }}>{t("idle")}</p>}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 className="team-h">{t("graph")}</h3>
          {mission && status === "ready" && <button type="button" className="pill" onClick={() => setReplay(0)} data-testid="team-replay">{t("replay")}</button>}
        </div>
        <TeamGraph mission={mission} shown={n} />
      </div>

      {mission && (
        <div className="card">
          <h3 className="team-h">{t("feed")}</h3>
          <TeamFeed mission={mission} shown={n} />
        </div>
      )}

      <div className="card" data-testid="team-constraints">
        <h3 className="team-h">{t("constraints")}</h3>
        <p className="note">{t("constraintsNote")}</p>
        <div className="note" style={{ marginTop: 6 }}>{t("forbid")}</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {MEASURES.map((k) => (
            <button key={k} type="button" className="pill" aria-pressed={cons.forbid_types?.includes(k) ?? false} data-forbid={k}
              onClick={() => useTwin.getState().setConstraints({ forbid_types: toggle(cons.forbid_types ?? [], k) })}>{td(`measure.${k}`)}</button>
          ))}
        </div>
        <div className="note" style={{ marginTop: 8 }}>{t("protect")}</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {corridor.map((s) => s && (
            <button key={s.id} type="button" className="pill" aria-pressed={cons.protect_stations?.includes(s.id) ?? false}
              onClick={() => useTwin.getState().setConstraints({ protect_stations: toggle(cons.protect_stations ?? [], s.id) })}>{f.station(s)}</button>
          ))}
        </div>
        <div className="note" style={{ marginTop: 8 }}>{t("costCap")}</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {CAPS.map((c) => (
            <button key={String(c)} type="button" className="pill" aria-pressed={(cons.cost_cap ?? null) === c}
              onClick={() => useTwin.getState().setConstraints({ cost_cap: c })}>{c === null ? t("noCap") : <N>{f.int(c)}</N>}</button>
          ))}
        </div>
        {mission && (mission.objective.findings?.length ?? 0) > 0 && <div className="warnbox" style={{ marginTop: 8 }} data-testid="team-findings"><N>{t("findings", { n: mission.objective.findings?.length ?? 0 })}</N></div>}
        {mission && (mission.objective.suggestions?.length ?? 0) > 0 && (
          <div className="note" style={{ marginTop: 8 }}>{t("suggestions")}: <bdi>{mission.objective.suggestions!.map((s) => {
            const [k, v] = s.split(":");
            return k === "avoid" ? td(`measure.${v}`) : k === "protect" ? name(v) : `${t("costCap")} ${v}`;
          }).join(" · ")}</bdi></div>
        )}
      </div>

      {mission && status === "ready" && mission.assessments.length > 0 && (
        <div className="card" data-testid="team-checks">
          <h3 className="team-h">{t("checks")}</h3>
          <table className="team-checks">
            <thead><tr><th />{mission.assessments.map((a) => <th key={a.rank} scope="col"><N>{a.rank}</N></th>)}</tr></thead>
            <tbody>
              {(["C1", "C2", "C3", "C4", "C5", "C6", "C7"] as const).map((c) => {
                const lim = mission.assessments[0]?.checks.find((x) => x.id === c)?.limit;
                return (
                  <tr key={c}>
                    <th scope="row"><b>{c}</b> {t(`crit.${c}`, { limit: lim == null ? "" : f.int(lim) })}</th>
                    {mission.assessments.map((a) => {
                      const x = a.checks.find((y) => y.id === c);
                      return <td key={a.rank} className={x?.passed === true ? "ok" : x?.passed === false ? "bad" : "na"}>{x?.passed === true ? "✓" : x?.passed === false ? "✗" : "–"}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 className="team-h" style={{ marginTop: 10 }}>{t("stressTitle")}</h3>
          {mission.assessments.map((a) => (
            <div key={a.rank} className="team-stress">
              <div className="note"><N>{t("holds", { rank: a.rank, holds: a.holds, total: a.total })}</N></div>
              <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                {(a.stress ?? []).map((s) => (
                  <span key={s.case} className={`team-case ${s.holds ? "ok" : "bad"}`} title={s.run_id}>
                    <N>{td(`case.${s.kind}`, { v: s.kind === "weather" ? td(`weather.${String(s.value)}`) : s.kind === "metro_share" ? f.int(Number(s.value) * 100) : String(s.value) })}</N>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {mission && status === "ready" && <DebateCard mission={mission} />}

      {mission && status === "ready" && (
        <div className="card" data-testid="team-rejected">
          <h3 className="team-h"><N>{t("rejected", { n: mission.rejected.length })}</N></h3>
          <ul className="team-rej">
            {mission.rejected.slice(0, 12).map((r, i) => (
              <li key={i}>
                <bdi>{[...new Set(r.interventions.map((iv) => td(`measure.${iv.type}`)))].join(" + ")}</bdi>
                <small> · {td(`reason.${r.reason}`)}{r.criteria.length ? ` · ${r.criteria.join(" ")}` : ""}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mission && (
        <div className="card" data-testid="team-budget">
          <h3 className="team-h">{t("budget")}</h3>
          {([["budgetSteps", mission.budget.steps, mission.budget.steps_max], ["budgetSims", mission.budget.simulations, mission.budget.simulations_max],
             ["budgetModel", mission.budget.model_calls, mission.budget.model_calls_max], ["budgetTime", mission.budget.wall_ms, mission.budget.wall_ms_max]] as const).map(([k, v, max]) => (
            <div key={k} className="team-meter">
              <span>{t(k)}</span>
              <span className="bar"><i style={{ inlineSize: `${Math.min(100, (100 * v) / Math.max(1, max))}%` }} /></span>
              <N>{k === "budgetTime" ? `${f.num(v / 1000, 1)} / ${f.int(max / 1000)} s` : `${f.int(v)} / ${f.int(max)}`}</N>
            </div>
          ))}
        </div>
      )}

      {drafts && <MessengerCard d={drafts} />}
      <AskCard />
      <Scorecard />
    </>
  );
}
