"use client";
// The duty shift on autopilot, incident what-ifs and the operations brief (contract 1.13.0, decision #128).
// The Watcher and the agent team work the scenario day; this card is the approval inbox they stop at. Every figure
// is the simulator's (through POST /shift/next or the forecast's resolved incident); nothing is computed here, and
// nothing is applied without the Approve button (POST /decisions is called first).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { hhmm, N, useFmt, useLocale } from "@/lib/i18n";
import { INCIDENT_TYPES, type IncidentType } from "@/lib/requests";
import { useTwin } from "@/lib/store";

function useStationName() {
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  return (id: unknown) => { const st = stations.find((s) => s.id === id); return st ? f.station(st) : String(id ?? ""); };
}

/** Incident what-if chips. What an incident changes is fixed on the server (config/incidents.yaml); the line under
 *  the chips repeats the server's resolved figures. */
function IncidentPicker() {
  const t = useTranslations("mission.duty");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const inc = useTwin((s) => s.scenario.incident ?? null);
  const fc = useTwin((s) => s.forecast);
  const busy = useTwin((s) => s.shift.status === "running" || s.shift.status === "awaiting");
  const end = fc?.end_used ? Number(fc.end_used.slice(0, 2)) : 18;
  const hour = inc?.hour ?? Math.max(5, Math.min(23, end - 1));
  const set = (type: IncidentType | null, h = hour) => useTwin.getState().setIncident(type ? { type, hour: Math.max(5, Math.min(23, h)) } : null);
  const info = fc?.incident ?? null;
  return (
    <div data-testid="incident-picker">
      <div className="note" style={{ marginTop: 8 }}>{t("incident")}</div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <button type="button" className="pill" aria-pressed={!inc} disabled={busy} onClick={() => set(null)} data-incident="none">{t("inc.none")}</button>
        {INCIDENT_TYPES.map((k) => <button key={k} type="button" className="pill" aria-pressed={inc?.type === k} disabled={busy} onClick={() => set(k)} data-incident={k}>{td(`inc.${k}`)}</button>)}
      </div>
      {inc && (
        <div className="row duty-hour">
          <button type="button" className="pill" disabled={busy || hour <= 5} aria-label={t("earlier")} onClick={() => set(inc.type, hour - 1)}>−</button>
          <b><N>{t("at", { hour })}</N></b>
          <button type="button" className="pill" disabled={busy || hour >= 23} aria-label={t("later")} onClick={() => set(inc.type, hour + 1)}>+</button>
        </div>
      )}
      {info && (
        <p className="warnbox" style={{ marginTop: 6 }} data-testid="incident-info">
          <N>{info.type === "train_fault" ? t("info.train_fault", { line: info.line ?? "", pct: Math.round((info.capacity_factor ?? 1) * 100), h0: info.hours?.[0] ?? info.hour, h1: (info.hours?.[info.hours.length - 1] ?? info.hour) + 1 })
            : info.type === "crowd_surge" ? t("info.crowd_surge", { before: f.int(info.attendance_before ?? 0), after: f.int(info.attendance_after ?? 0) })
            : td(`info.${info.type}`)}</N>{" "}<small>{t("assumption")}</small>
        </p>
      )}
    </div>
  );
}

export function DutyCard() {
  const t = useTranslations("mission.duty");
  const tw = useTranslations("mission.watch");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const name = useStationName();
  const { locale } = useLocale();
  const sh = useTwin((s) => s.shift);
  const ready = useTwin((s) => !!s.forecast && !s.loading);
  const err = useTwin((s) => s.decisionError);
  const step = sh.step;
  const opts = step?.mission?.plan.options ?? [];
  const rec = opts.find((o) => o.rank === step?.recommended_rank) ?? null;
  const assess = step?.mission?.assessments.find((a) => a.rank === rec?.rank);
  const applicable = assess?.checks.filter((c) => c.passed !== null) ?? [];
  const asked = sh.items.length, approved = sh.items.filter((i) => i.decision === "approve").length, rejected = sh.items.filter((i) => i.decision === "reject").length;
  const act = (d: "approve" | "reject" | "none", rank?: number) => void useTwin.getState().shiftDecide(d, locale, rank);
  return (
    <div className="card duty" data-testid="duty">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="team-h">{t("title")}</h3>
        {sh.status !== "idle" && <span className={`badge sm ${sh.status === "done" ? "ok" : "navy"}`} data-testid="duty-status">{td(`status.${sh.status}`)}</span>}
      </div>
      <p className="note">{t("sub")}</p>
      <IncidentPicker />

      {(sh.status === "idle" || sh.status === "done" || sh.status === "error") && (
        <button type="button" className="btn red" style={{ width: "100%", marginTop: 10 }} disabled={!ready} onClick={() => void useTwin.getState().startShift(locale)} data-testid="duty-start">
          {sh.status === "idle" ? t("start") : t("restart")}
        </button>
      )}
      {sh.status === "running" && <div className="duty-running" role="status"><i aria-hidden="true" /> {t("running")}</div>}
      {sh.status === "error" && <div className="warnbox" style={{ marginTop: 8 }}>{t("error", { msg: sh.error ?? "" })}</div>}

      {sh.status === "awaiting" && step && (
        <div className="duty-item" data-testid="duty-item" aria-live="polite">
          <div className="duty-when"><N>{t("need", { hour: step.hour })}</N></div>
          {step.alerts.map((a) => (
            <div key={a.key} className={`watch-alert ${a.lead_now_h <= 0 ? "now" : "soon"}`}>
              <b><N>{tw("alert", { station: name(a.station), at: a.crosses_at })}</N></b>
              <small><N>{a.lead_now_h > 0 ? t("leadPos", { n: a.lead_now_h }) : t("leadNow")} · {f.pct(a.peak_lf)}</N> · <bdi>{a.run_id}</bdi></small>
            </div>
          ))}
          {rec ? (
            <>
              <div className="note" style={{ marginTop: 8 }}>{t("proposal")}</div>
              <div className="duty-plan">
                <b>{rec.title}</b>
                <p className="note">{rec.what}</p>
                <ul>
                  <li><N>{t("effOver", { before: f.num(step.residual.overcap_station_hours), after: f.num(rec.summary.overcap_station_hours) })}</N></li>
                  <li><N>{t("effExcess", { before: f.int(step.residual.excess_pax), after: f.int(rec.summary.excess_pax) })}</N></li>
                  <li><N>{t("effPeak", { before: Math.round(step.residual.peak_lf * 100), after: Math.round(rec.summary.peak_lf * 100) })}</N></li>
                </ul>
                <div className={rec.goal_met ? "verify" : "warnbox"}>{rec.goal_met ? t("clears") : t("partial")}</div>
                {assess && <div className="note" style={{ marginTop: 4 }}><N>{t("checks", { passed: applicable.filter((c) => c.passed).length, total: applicable.length, holds: assess.holds ?? 0, n: assess.total ?? 0 })}</N> · <bdi>{rec.sources?.[0]?.run_id}</bdi></div>}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className="btn red" style={{ flex: 2 }} onClick={() => act("approve")} data-testid="duty-approve">{t("approve")}</button>
                <button type="button" className="btn" style={{ flex: 1 }} onClick={() => act("reject")} data-testid="duty-reject">{t("reject")}</button>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {opts.filter((o) => o.rank !== rec.rank).map((o) => (
                  <button key={o.rank} type="button" className="pill" onClick={() => act("approve", o.rank)} title={o.what}><N>{t("instead", { title: o.title })}</N></button>
                ))}
                <button type="button" className="pill" onClick={() => useTwin.setState({ tab: "team" })} data-testid="duty-team">{t("team")}</button>
              </div>
            </>
          ) : (
            <>
              <div className="warnbox" style={{ marginTop: 8 }}>{t("noOption")}</div>
              <button type="button" className="btn navy" style={{ width: "100%", marginTop: 8 }} onClick={() => act("none")}>{t("pass")}</button>
            </>
          )}
          {err && <div className="warnbox" style={{ marginTop: 6 }}>{err}</div>}
        </div>
      )}

      {sh.items.length > 0 && (
        <ol className="duty-log" data-testid="duty-log">
          {sh.items.map((i, k) => (
            <li key={k} className={i.decision}>
              <span><N>{hhmm(i.hour)}</N></span>
              <span><b>{td(`history.${i.decision}`)}</b>{i.title ? <> · {i.title}</> : null}<small> · <bdi>{i.stations.map(name).join(", ")}</bdi>{i.overAfter !== null ? <N> · {f.num(i.overBefore)} → {f.num(i.overAfter)}</N> : null}</small></span>
            </li>
          ))}
        </ol>
      )}

      {sh.status === "done" && step && (
        <div className="duty-done" data-testid="duty-done" aria-live="polite">
          <div className={step.reason === "clear" ? "verify" : "warnbox"}><N>{td(`done.${step.reason}`, { over: f.num(step.residual.overcap_station_hours) })}</N></div>
          <div className="note" style={{ marginTop: 4 }}><N>{t("tally", { asked, approved, rejected })}</N></div>
          <div className="note"><N>{t("baseline", { over: f.num(step.baseline.overcap_station_hours) })}</N> · <bdi>{step.run_id}</bdi></div>
          <button type="button" className="btn navy" style={{ width: "100%", marginTop: 8 }} onClick={() => useTwin.setState({ brief: true })} data-testid="duty-brief">{t("brief")}</button>
        </div>
      )}
      {(sh.status === "running" || sh.status === "awaiting") && <button type="button" className="pill" style={{ marginTop: 8 }} onClick={() => useTwin.getState().stopShift()}>{t("stop")}</button>}
    </div>
  );
}

/** The operations brief: one printable page of what the shift saw, what a human approved and what it changes.
 *  The browser's own "Save as PDF" makes the file, so it works offline and in Arabic. A draft, never sent. */
export function OperationsBrief() {
  const open = useTwin((s) => s.brief);
  return open ? <BriefPage /> : null;            // the page reads the whole store, so it is mounted only while open
}

function BriefPage() {
  const t = useTranslations("mission.brief");
  const td = useTranslations("mission.duty") as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const name = useStationName();
  const { locale } = useLocale();
  const s = useTwin();
  useEffect(() => {
    document.body.classList.add("brief-open");
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") useTwin.setState({ brief: false }); };
    window.addEventListener("keydown", esc);
    return () => { document.body.classList.remove("brief-open"); window.removeEventListener("keydown", esc); };
  }, []);
  if (typeof document === "undefined" || !s.forecast || !s.base || !s.cur) return null;
  const fc = s.forecast, b = s.base.resp.summary, a = s.cur.resp.summary, inc = fc.incident;
  const rows: [string, string, string][] = [
    [t("rowOver"), f.num(b.overcap_station_hours), f.num(a.overcap_station_hours)],
    [t("rowExcess"), f.int(b.excess_pax), f.int(a.excess_pax)],
    [t("rowPeak"), `${Math.round(b.peak_lf * 100)}%`, `${Math.round(a.peak_lf * 100)}%`],
  ];
  const d = s.drafts;
  return createPortal(
    <div className="brief" role="dialog" aria-modal="true" aria-label={t("title")} data-testid="brief" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="brief-page">
        <div className="brief-tools noprint">
          <button type="button" className="btn navy" onClick={() => window.print()} data-testid="brief-print">{t("print")}</button>
          <button type="button" className="btn" onClick={() => useTwin.setState({ brief: false })} data-testid="brief-close">{t("close")}</button>
        </div>
        <div className="brief-draft">{t("draft")}</div>
        <h1>{t("title")}</h1>
        <p className="brief-sub"><bdi>{fc.event ? f.event(fc.event) : t("noEvent")}</bdi>{fc.attendance_used ? <N> · {t("attendance", { n: f.int(fc.attendance_used) })}</N> : null}{fc.end_used ? <N> · {t("ends", { time: fc.end_used })}</N> : null}</p>

        <h2>{t("incident")}</h2>
        <p data-testid="brief-incident">{inc ? <N>{td(`inc.${inc.type}`)} · {td("at", { hour: inc.hour })} · {inc.type === "train_fault" ? td("info.train_fault", { line: inc.line ?? "", pct: Math.round((inc.capacity_factor ?? 1) * 100), h0: inc.hours?.[0] ?? inc.hour, h1: (inc.hours?.[inc.hours.length - 1] ?? inc.hour) + 1 })
          : inc.type === "crowd_surge" ? td("info.crowd_surge", { before: f.int(inc.attendance_before ?? 0), after: f.int(inc.attendance_after ?? 0) }) : td(`info.${inc.type}`)} {td("assumption")}</N> : t("noIncident")}</p>

        <h2>{t("decisions")}</h2>
        {s.applied.length === 0 && s.shift.items.length === 0 ? <p>{t("none")}</p> : (
          <table>
            <thead><tr><th>{t("colTime")}</th><th>{t("colStations")}</th><th>{t("colDecision")}</th><th>{t("colPlan")}</th></tr></thead>
            <tbody>
              {s.shift.items.length > 0 ? s.shift.items.map((i, k) => (
                <tr key={k}><td><N>{hhmm(i.hour)}</N></td><td>{i.stations.map(name).join(", ")}</td><td>{td(`history.${i.decision}`)}</td><td>{i.title ?? "—"}{i.runId ? <small> <bdi>{i.runId}</bdi></small> : null}</td></tr>
              )) : s.applied.map((p, k) => <tr key={k}><td>—</td><td>—</td><td>{td("history.approve")}</td><td>{p.title}</td></tr>)}
            </tbody>
          </table>
        )}

        <h2>{t("effect")}</h2>
        <table>
          <thead><tr><th /><th>{t("colBefore")}</th><th>{t("colAfter")}</th></tr></thead>
          <tbody>{rows.map(([k, x, y]) => <tr key={k}><th scope="row">{k}</th><td><N>{x}</N></td><td><N>{y}</N></td></tr>)}</tbody>
        </table>
        <p className="brief-src"><N>{t("sources", { base: s.base.resp.run_id, cur: s.cur.resp.run_id, fc: fc.run_id })}</N></p>

        {d && (
          <>
            <h2>{t("messages")}</h2>
            {(["en", "ar"] as const).map((l) => (
              <div key={l} className="brief-msg" dir={l === "ar" ? "rtl" : "ltr"} lang={l}>
                <p><b>{d.drafts[l].sign}</b></p>
                <p>{d.drafts[l].notice}</p>
                <p className="brief-ops">{d.drafts[l].ops}</p>
              </div>
            ))}
          </>
        )}
        <p className="brief-foot">{fc.is_synthetic ? t("synthetic") : ""} {t("foot")}</p>
      </div>
    </div>, document.body);
}
