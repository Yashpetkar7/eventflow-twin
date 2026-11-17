"use client";
// The planner's brief (contract 1.16.0, decision #144): plain words → the Intake agent's reading → the planner checks,
// edits or removes each field → "Confirm and plan" sets the scenario and the typed constraints and starts the team.
// Nothing here is applied before the click; every figure the team shows afterwards comes from the forecast and the
// simulator. Each field shows the words it was read from and who read it (the AI model, or the word rules offline).
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError, type BriefResponse } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { CUSTOM_DEFAULT_ATTENDANCE, type Priority, type Weather } from "@/lib/requests";
import { CORRIDOR_ORDER, useTwin } from "@/lib/store";

const TIMES = Array.from({ length: 36 }, (_, i) => { const m = 360 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });
const THRESHOLDS = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

interface Draft {
  eventId: string | null; name: string; near: string; start: string; end: string; weekend: boolean; attendance: number | null;
  weather: Weather | null; threshold: number | null; priority: Priority | null; forbid: string[]; protect: string[]; costCap: number | null;
}

function draftOf(r: BriefResponse): Draft {
  const e = r.event;
  return {
    eventId: e.event_id ?? null, name: e.name ?? "", near: e.near_station ?? "", start: e.start ?? "19:00",
    end: e.end && (!e.start || e.end > e.start) ? e.end : TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(e.start ?? "19:00") + 6)],
    weekend: e.weekend ?? false, attendance: e.attendance ?? null, weather: (r.weather as Weather | null) ?? null,
    threshold: r.threshold ?? null, priority: (r.priority as Priority | null) ?? null,
    forbid: [...(r.constraints.forbid_types ?? [])], protect: [...(r.constraints.protect_stations ?? [])], costCap: r.constraints.cost_cap ?? null,
  };
}

/** Which of the brief's fields the planner changed or removed before confirming (logged with the brief). */
function changes(a: Draft, b: Draft): string[] {
  const out: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.eventId, b.eventId)) out.push("event");
  if (!a.eventId && !b.eventId) {
    if (a.name !== b.name) out.push("name");
    if (a.near !== b.near) out.push("station");
    if (a.start !== b.start) out.push("start");
    if (a.end !== b.end) out.push("end");
    if (a.weekend !== b.weekend) out.push("day");
  }
  for (const [k, x, y] of [["attendance", a.attendance, b.attendance], ["weather", a.weather, b.weather], ["threshold", a.threshold, b.threshold],
    ["priority", a.priority, b.priority], ["forbid", a.forbid, b.forbid], ["protect", a.protect, b.protect], ["cost_cap", a.costCap, b.costCap]] as const) {
    if (!same(x, y)) out.push(k);
  }
  return out;
}

export function BriefCard() {
  const t = useTranslations("briefBox");
  const tr = t as unknown as { raw: (k: string) => unknown };
  const tm = useTranslations("mission");
  const td = tm as unknown as (k: string) => string;
  const tg = useTranslations();
  const f = useFmt();
  const { locale } = useLocale();
  const stations = useTwin((s) => s.stations);
  const events = useTwin((s) => s.events);
  const running = useTwin((s) => s.planStatus === "running");
  const inUse = useTwin((s) => s.planBrief);
  const [text, setText] = useState(inUse?.confirmed.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<BriefResponse | null>(null);
  const [orig, setOrig] = useState<Draft | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const corridor = useMemo(() => CORRIDOR_ORDER.map((id) => stations.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s), [stations]);
  const name = (id: string) => f.station(stations.find((s) => s.id === id));
  const field = (k: string) => res?.fields.find((x) => x.field === k);
  const examples = (tr.raw("examples") as string[]) ?? [];

  const read = async () => {
    if (text.trim().length < 3) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.brief(text.trim(), locale);
      const dr = draftOf(r);
      setRes(r); setOrig(dr); setD(dr); setEditing(true);                // review the new proposal, even with an older brief in use
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : String(e));
    } finally { setBusy(false); }
  };

  const patch = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x));
  const ev = d?.eventId ? events.find((e) => e.id === d.eventId) : null;
  const missingStation = !!d && !d.eventId && !d.near;

  const summary = (x: Draft): string => {
    const n = f.int(x.attendance ?? (x.eventId ? (events.find((e) => e.id === x.eventId)?.attendance ?? 0) : CUSTOM_DEFAULT_ATTENDANCE));
    const base = x.eventId && ev ? t("summaryEvent", { name: f.event(ev), n })
      : t("summaryCustom", { name: x.name || t("name"), station: name(x.near), day: t(x.weekend ? "weekend" : "weekday"), start: x.start, end: x.end, n });
    return base + (x.threshold ? t("summaryThr", { thr: f.pct(x.threshold) }) : "");
  };

  const confirm = () => {
    if (!res || !d || !orig || missingStation) return;
    const removed = changes(orig, d);
    const kept = res.fields.map((x) => x.field).filter((k) => !removed.includes(k));
    const s = summary(d);
    void useTwin.getState().applyBrief({
      eventId: d.eventId, custom: d.eventId ? null : { near: d.near, start: d.start, end: d.end, weekend: d.weekend },
      attendance: d.attendance, weather: d.weather ?? "normal", threshold: d.threshold, priority: d.priority,
      constraints: { forbid_types: d.forbid as never[], protect_stations: d.protect, cost_cap: d.costCap },
      brief: { goal: s.slice(0, 500), notes: res.text.slice(0, 1000), confirmed: { text: res.text.slice(0, 1000), summary: s.slice(0, 300), source: res.source, fields: kept, removed } },
    }, locale);
    setEditing(false);
  };

  // a confirmed brief in use: one line, with a way back to edit it
  if (inUse && !editing) {
    return (
      <div className="card brief-inuse" data-testid="brief-inuse">
        <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
          <div><span className="badge sm navy">{t("inUse")}</span> <bdi><N>{inUse.confirmed.summary}</N></bdi></div>
          <button type="button" className="pill" disabled={running} onClick={() => setEditing(true)} data-testid="brief-change">{t("change")}</button>
        </div>
      </div>
    );
  }

  const evx = (k: string) => {
    const x = field(k);
    if (!x) return <small className="brief-ev miss">{t("notInBrief")}</small>;
    return <small className="brief-ev"><span className={`src ${x.source}`}>{t(`srcShort.${x.source}`)}</span> <bdi>{t("from", { words: x.evidence })}</bdi></small>;
  };
  const rm = (what: string, on: () => void) => (
    <button type="button" className="brief-x" aria-label={t("remove", { what })} onClick={on}>×</button>
  );

  return (
    <div className="card pbrief" data-testid="brief">
      <h2 style={{ margin: 0 }}>{t("title")}</h2>
      <p className="note">{t("lede")}</p>
      {(!res || !d) ? (
        <>
          <label htmlFor="brief-text" className="sr-only">{t("label")}</label>
          <textarea id="brief-text" data-testid="brief-text" className="brief-text" rows={4} maxLength={1000} value={text}
            placeholder={t("placeholder")} onChange={(e) => setText(e.target.value)} dir="auto" />
          <div className="note" style={{ marginTop: 6 }}>{t("examplesL")}</div>
          <div className="brief-examples">
            {examples.map((x, i) => <button key={i} type="button" className="pill" onClick={() => setText(x)} data-testid="brief-example"><bdi>{x}</bdi></button>)}
          </div>
          <button type="button" className="btn red" style={{ width: "100%", marginTop: 10 }} disabled={busy || running || text.trim().length < 3} onClick={() => void read()} data-testid="brief-read">
            {busy ? t("reading") : t("read")}
          </button>
          {err && <div className="warnbox" role="alert" style={{ marginTop: 8 }}>{t("error", { msg: err })}</div>}
        </>
      ) : (
        <div data-testid="brief-proposal">
          <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <span className={`badge sm ${res.source === "rules" ? "" : "navy"}`} data-testid="brief-source">{t(`src.${res.source}`, { model: res.model ?? "" })}</span>
          </div>
          <h3 className="team-h" style={{ marginBottom: 2 }}>{t("understood")}</h3>
          <p className="note" style={{ marginTop: 0 }}>{t("checkHint")}</p>
          {(res.findings?.length ?? 0) > 0 && <div className="warnbox" data-testid="brief-findings" style={{ marginBottom: 8 }}>{t("findings")}</div>}

          <dl className="brief-fields">
            {d.eventId && ev ? (
              <div className="bf" data-field="event"><dt>{t("scenario")}</dt>
                <dd><b><bdi>{f.event(ev)}</bdi></b> {rm(t("scenario"), () => patch({ eventId: null }))}{evx("event")}</dd></div>
            ) : (
              <>
                <div className="bf" data-field="name"><dt>{t("name")}</dt>
                  <dd><input aria-label={t("name")} value={d.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} dir="auto" />{evx("name")}</dd></div>
                <div className={`bf${missingStation ? " need" : ""}`} data-field="station"><dt>{t("station")}{!field("station") && <em className="kbadge-check">{t("check")}</em>}</dt>
                  <dd><select aria-label={t("station")} data-testid="brief-station" value={d.near} onChange={(e) => patch({ near: e.target.value })}>
                    {!d.near && <option value="">{t("chooseStation")}</option>}
                    {corridor.map((s) => <option key={s.id} value={s.id}>{f.station(s)}</option>)}
                  </select>{evx("station")}</dd></div>
                <div className="bf" data-field="time"><dt>{t("when")}{!(field("start") && field("end")) && <em className="kbadge-check">{t("check")}</em>}</dt>
                  <dd><span className="row" style={{ gap: 6 }}>
                    <select aria-label={tg("cStart")} value={d.start} onChange={(e) => patch({ start: e.target.value, end: e.target.value >= d.end ? TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(e.target.value) + 1)] : d.end })}>
                      {TIMES.slice(0, -1).map((x) => <option key={x}>{x}</option>)}
                    </select>–
                    <select aria-label={tg("cEnd")} value={d.end} onChange={(e) => patch({ end: e.target.value })}>
                      {TIMES.filter((x) => x > d.start).map((x) => <option key={x}>{x}</option>)}
                    </select></span>{evx(field("start") ? "start" : "end")}</dd></div>
                <div className="bf" data-field="day"><dt>{t("day")}{!field("day") && <em className="kbadge-check">{t("check")}</em>}</dt>
                  <dd><span className="seg">
                    <button type="button" aria-pressed={!d.weekend} onClick={() => patch({ weekend: false })}>{tg("weekday")}</button>
                    <button type="button" aria-pressed={d.weekend} onClick={() => patch({ weekend: true })}>{tg("weekend")}</button>
                  </span>{evx("day")}</dd></div>
              </>
            )}
            <div className="bf" data-field="attendance"><dt>{t("crowd")}{d.attendance == null && <em className="kbadge-check">{t("check")}</em>}</dt>
              <dd><span className="row" style={{ gap: 6 }}>
                <input type="number" aria-label={t("crowd")} data-testid="brief-attendance" min={100} max={200000} step={500} value={d.attendance ?? ""}
                  placeholder={d.eventId ? f.int(ev?.attendance ?? 0) : f.int(CUSTOM_DEFAULT_ATTENDANCE)}
                  onChange={(e) => patch({ attendance: e.target.value === "" ? null : Math.max(100, Math.min(200000, Math.round(+e.target.value))) })} />
                <span className="note">{d.attendance == null ? t("defaultCrowd", { n: f.int(d.eventId ? (ev?.attendance ?? 0) : CUSTOM_DEFAULT_ATTENDANCE) }) : t("people")}</span>
              </span>{evx("attendance")}</dd></div>
            {d.weather && (
              <div className="bf" data-field="weather"><dt>{t("weather")}</dt>
                <dd><b>{tg(d.weather === "hot" ? "wHot" : d.weather === "rain" ? "wRain" : "wNormal")}</b> {rm(t("weather"), () => patch({ weather: null }))}{evx("weather")}</dd></div>
            )}
            {d.threshold != null && (
              <div className="bf" data-field="threshold"><dt>{t("threshold")}</dt>
                <dd><span className="row" style={{ gap: 6 }}><select aria-label={t("threshold")} value={d.threshold} onChange={(e) => patch({ threshold: +e.target.value })}>
                  {THRESHOLDS.map((v) => <option key={v} value={v}>{f.pct(v)}</option>)}
                </select> {rm(t("threshold"), () => patch({ threshold: null }))}</span>{evx("threshold")}</dd></div>
            )}
            {d.priority && (
              <div className="bf" data-field="priority"><dt>{t("priority")}</dt>
                <dd><b>{tg(`prioL.${d.priority}`)}</b> {rm(t("priority"), () => patch({ priority: null }))}{evx("priority")}</dd></div>
            )}
            {d.forbid.length > 0 && (
              <div className="bf" data-field="forbid"><dt>{t("forbid")}</dt>
                <dd><span className="brief-chips">{d.forbid.map((k) => (
                  <span key={k} className="brief-chip" data-forbid={k}><bdi>{td(`measure.${k}`)}</bdi>{rm(td(`measure.${k}`), () => patch({ forbid: d.forbid.filter((x) => x !== k) }))}</span>
                ))}</span>{evx("forbid")}</dd></div>
            )}
            {d.protect.length > 0 && (
              <div className="bf" data-field="protect"><dt>{t("protect")}</dt>
                <dd><span className="brief-chips">{d.protect.map((k) => (
                  <span key={k} className="brief-chip" data-protect={k}><bdi>{name(k)}</bdi>{rm(name(k), () => patch({ protect: d.protect.filter((x) => x !== k) }))}</span>
                ))}</span>{evx("protect")}</dd></div>
            )}
            {d.costCap != null && (
              <div className="bf" data-field="cost_cap"><dt>{t("costCap")}</dt>
                <dd><b><N>{f.int(d.costCap)}</N></b> {rm(t("costCap"), () => patch({ costCap: null }))}{evx("cost_cap")}</dd></div>
            )}
          </dl>

          {res.notes.length > 0 && <p className="note" data-testid="brief-notes"><b>{t("notes")}:</b> <bdi>{res.notes.join(" · ")}</bdi></p>}
          {(res.dropped?.length ?? 0) > 0 && <p className="note" data-testid="brief-dropped"><N>{t("dropped", { n: res.dropped?.length ?? 0 })}</N></p>}
          <p className="note brief-summary" data-testid="brief-summary"><bdi><N>{summary(d)}</N></bdi></p>
          {missingStation && <div className="warnbox" role="status">{t("needStation")}</div>}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn red" style={{ flex: 1 }} disabled={running || missingStation} onClick={confirm} data-testid="brief-confirm">{t("confirm")}</button>
            <button type="button" className="btn ghost" onClick={() => { setRes(null); setD(null); setOrig(null); }} data-testid="brief-edit">{t("edit")}</button>
          </div>
          <p className="note" style={{ marginTop: 8 }}>{t("safety")}</p>
        </div>
      )}
    </div>
  );
}
