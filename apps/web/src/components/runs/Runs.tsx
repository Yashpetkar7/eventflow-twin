"use client";
// Runs of the agent team on the AI plan tab (contract 1.18.0): what is running and why, auto-run, cancel, run again,
// the history of this session's runs with their scenario, "compare with now" and "restore this scenario", and the
// plans on screen compared on seven objectives. Every figure comes from the API with its run id.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { api, type CompareTable, type ScenarioCompareResponse } from "@/lib/api";
import { useAssistant } from "@/lib/assistant";
import { chatBody } from "@/lib/requests";
import { storeCancels, useRuns, type RunEntry, type RunStatus } from "@/lib/runs";
import { hourOf, mergeInterventions, useTwin } from "@/lib/store";
import { Plans } from "../assistant/Assistant";
import { useSay } from "../assistant/say";

type Words = (key: string, values?: Record<string, string | number>) => string;
const ENDED: RunStatus[] = ["completed", "failed", "cancelled", "superseded"];
const clock = (ms: number, locale: string) => new Date(ms).toLocaleTimeString(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { hour12: false, timeZone: "Asia/Dubai" });

/** Keeps the run logic's language in step with the page. Renders nothing. */
export function RunController() {
  const { locale } = useLocale();
  useEffect(() => { useRuns.getState().setLocale(locale); }, [locale]);
  return null;
}

/** What the team is doing for which scenario, with the controls a planner needs: auto-run, cancel, run again. */
export function RunBar() {
  const t = useTranslations("runs") as unknown as Words;
  const runs = useRuns((s) => s.runs);
  const auto = useRuns((s) => s.auto);
  const version = useAssistant((s) => s.version);
  const status = useTwin((s) => s.planStatus);
  const loading = useTwin((s) => s.loading);
  const last = runs[0] ?? null;
  const active = last && !ENDED.includes(last.status);
  const done = runs.find((r) => r.status === "completed") ?? null;
  const stale = !auto && !active && status === "idle" && done !== null && done.version < version;
  return (
    <div className="card runbar" data-testid="runbar" data-status={last?.status ?? "none"} data-version={version}>
      <div className="runbar-top">
        <span className={`run-chip ${last?.status ?? "none"}`} data-testid="run-status">
          {last ? <N>{t("now", { status: t(`status.${last.status}`), v: last.version, trigger: t(`trigger.${last.trigger}`) })}</N> : t("none")}
        </span>
        <span className="badge sm navy" data-testid="run-version"><N>{t("version", { v: version })}</N></span>
      </div>
      {last?.status === "queued" && <p className="note">{t("queuedNote")}</p>}
      {last?.status === "superseded" && !auto && <p className="note">{t("supersededNote")}</p>}
      {stale && <p className="warnbox" data-testid="run-stale"><N>{t("stale", { was: done!.version, now: version })}</N></p>}
      <label className="loop-switch" data-testid="auto-run">
        <input type="checkbox" checked={auto} onChange={(e) => useRuns.getState().setAuto(e.target.checked)} />
        <span><b>{t("auto")}</b><small>{t("autoNote")}</small></span>
      </label>
      <div className="row">
        {active && (last!.status !== "running" || !storeCancels()) && (       /* a running plan has the Plan card's own Stop button when the store offers one */
          <button type="button" className="pill" onClick={() => useRuns.getState().cancel()} data-testid="run-cancel">{t("cancel")}</button>
        )}
        {!active && last && <button type="button" className="pill" disabled={loading} onClick={() => useRuns.getState().rerun()} data-testid="run-again">{t("again")}</button>}
      </div>
    </div>
  );
}

function Diff({ d }: { d: ScenarioCompareResponse }) {
  const t = useTranslations("runs") as unknown as Words;
  const { t: ta, show, name } = useSay();
  const f = useFmt();
  const pct = (v: unknown) => `${f.int(Math.round(Number(v) * 100))}%`;
  const val = (field: string, v: unknown) => show(field, Array.isArray(v) ? v.join(", ") : v);
  const ha = d.a.headline as Record<string, number | string>, hb = d.b.headline as Record<string, number | string>;
  const ra = d.a.recommended as { title?: string } | null, rb = d.b.recommended as { title?: string } | null;
  return (
    <div className="run-diff" data-testid="run-diff" data-identical={d.identical}>
      {d.identical ? <p className="note">{t("same")}</p> : (
        <ul>
          {d.changes.map((c) => <li key={c.field} data-field={c.field}><b>{ta(`field.${c.field}`)}</b> <N>{val(c.field, c.was)} → {val(c.field, c.to)}</N></li>)}
        </ul>
      )}
      <p><N>{t("effect", { pa: pct(ha.peak_lf), pb: pct(hb.peak_lf), oa: f.num(Number(ha.overcap_station_hours), 2), ob: f.num(Number(hb.overcap_station_hours), 2), st: name(hb.worst_station) })}</N></p>
      <p><bdi>{d.same_recommendation ? t("recSame", { rec: rb?.title ?? t("noPlan") }) : t("recChanged", { a: ra?.title ?? t("noPlan"), b: rb?.title ?? t("noPlan") })}</bdi></p>
      <p className="note">{t("diffRuns")} <code>{d.a.simulation_run_id}</code> → <code>{d.b.simulation_run_id}</code></p>
    </div>
  );
}

function Row({ e }: { e: RunEntry }) {
  const t = useTranslations("runs") as unknown as Words;
  const { locale } = useLocale();
  const f = useFmt();
  const version = useAssistant((s) => s.version);
  const [diff, setDiff] = useState<ScenarioCompareResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const pct = (v: number) => `${f.int(Math.round(v * 100))}%`;
  const secs = e.startedAt && e.endedAt ? f.num((e.endedAt - e.startedAt) / 1000, 1) : null;
  const compare = async () => {
    const s = useTwin.getState();
    if (!s.forecastReq) return;
    setBusy(true);
    setErr(false);
    try {
      setDiff(await api.scenarioCompare({ a: e.settings, b: { forecast: s.forecastReq, threshold: s.threshold, priority: s.priority, constraints: s.constraints },
        scope: "corridor", applied: mergeInterventions(s.applied.map((a) => a.ivs)) as never[], locale }));
    } catch { setErr(true); } finally { setBusy(false); }
  };
  return (
    <li className="run-row" data-testid="run-row" data-status={e.status} data-trigger={e.trigger} data-version={e.version}>
      <div className="run-row-h">
        <span className={`run-chip ${e.status}`}>{t(`status.${e.status}`)}</span>
        <span className="note"><N>{t("rowMeta", { v: e.version, trigger: t(`trigger.${e.trigger}`), at: clock(e.startedAt ?? e.queuedAt, locale) })}{secs ? ` · ${t("took", { s: secs })}` : ""}</N></span>
      </div>
      {e.status === "completed" && (
        <p><bdi>{e.recommended ? <N>{t("result", { rec: e.recommended, a: pct(e.peakBefore ?? 0), b: pct(e.peakAfter ?? 0) })}</N> : t("noPlan")}</bdi>
          {e.missionId ? <> <code>{e.missionId}</code></> : null}</p>
      )}
      {e.status === "failed" && <p className="warnbox">{e.error ?? ""}</p>}
      {(e.status === "completed" || e.status === "superseded" || e.status === "cancelled") && (
        <div className="row">
          <button type="button" className="pill" disabled={busy} onClick={() => void compare()} data-testid="run-compare">{t("compareNow")}</button>
          {e.version !== version && <button type="button" className="pill" onClick={() => useRuns.getState().restore(e.id)} data-testid="run-restore">{t("restore")}</button>}
        </div>
      )}
      {err && <p className="warnbox">{t("compareError")}</p>}
      {diff && <Diff d={diff} />}
    </li>
  );
}

/** This session's runs, newest first. Kept in the page only. */
export function RunHistory() {
  const t = useTranslations("runs") as unknown as Words;
  const runs = useRuns((s) => s.runs);
  if (runs.length === 0) return null;
  return (
    <div className="card" data-testid="run-history">
      <h3 className="team-h">{t("history")}</h3>
      <p className="note">{t("historyNote")}</p>
      <ol className="run-list">
        {runs.slice(0, 8).map((e) => <Row key={e.id} e={e} />)}
      </ol>
    </div>
  );
}

/** The plans on screen on seven objectives: the same view the Ask tab gives, one tap from the options.
 *  Mounted with the plan's id as its key, so a new plan starts with no comparison. */
export function CompareCard() {
  const t = useTranslations("runs") as unknown as Words;
  const { locale } = useLocale();
  const [table, setTable] = useState<CompareTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const load = async (intent: string) => {
    const s = useTwin.getState();
    if (!s.forecast || !s.forecastReq) return;
    setBusy(true);
    setErr(false);
    try {
      const r = await api.chat(chatBody(s.forecast.run_id, s.threshold, s.forecastReq, mergeInterventions(s.applied.map((a) => a.ivs)), locale, {
        intent, audience: "planner", priority: s.priority, constraints: s.constraints, station: s.selected || undefined, hour: hourOf(s.time),
        scenario_version: useAssistant.getState().version }));
      setTable(r.table ?? null);
      if (!r.table) setErr(true);
    } catch { setErr(true); } finally { setBusy(false); }
  };
  return (
    <div className="card" data-testid="compare-card">
      {!table && <button type="button" className="btn navy" style={{ width: "100%" }} disabled={busy} onClick={() => void load("compare")} data-testid="compare-open">{t("compare")}</button>}
      {!table && <p className="note" style={{ marginTop: 6 }}>{t("compareNote")}</p>}
      {err && <p className="warnbox">{t("compareError")}</p>}
      {table && <Plans table={table} busy={busy} onLens={(l) => void load(`lens:${l}`)} />}
    </div>
  );
}
