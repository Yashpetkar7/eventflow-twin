"use client";
// Standing agents on screen (contract 1.12.0, docs/15): the Watcher's duty view, Ask the twin, and the Messenger's
// drafts. Every figure comes from the API answer (tool + run id); text is chosen here, never numbers.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type AskIntent, type AskResponse, type MessageResponse, type WatchResponse } from "@/lib/api";
import { hhmm, N, useFmt, useLocale } from "@/lib/i18n";
import { askBody, watchBody } from "@/lib/requests";
import { mergeInterventions, useTwin } from "@/lib/store";

const INTENTS: AskIntent[] = ["peak", "worst", "break_point", "if_hot", "if_rain", "if_more", "road", "plan"];

function useStationName() {
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  return (id: unknown) => {
    const st = stations.find((s) => s.id === id);
    return st ? f.station(st) : String(id ?? "");
  };
}

/** The Watcher: alerts raised three hours before a station crosses the line, following the scenario clock. */
export function WatcherCard() {
  const t = useTranslations("mission.watch");
  const name = useStationName();
  const { locale } = useLocale();
  const fc = useTwin((s) => s.forecast);
  const req = useTwin((s) => s.forecastReq);
  const thr = useTwin((s) => s.threshold);
  const applied = useTwin((s) => s.applied);
  const time = useTwin((s) => s.time);
  const [w, setW] = useState<WatchResponse | null>(null);
  useEffect(() => {
    if (!fc || !req) return;
    let live = true;
    void api.watch(watchBody(fc.run_id, thr, req, mergeInterventions(applied.map((a) => a.ivs)))).then((r) => { if (live) setW(r); }, () => { if (live) setW(null); });
    return () => { live = false; };
  }, [fc, req, thr, applied]);
  if (!w) return null;
  const h = Math.floor(time);
  const raised = w.alerts.filter((a) => a.raised_at <= h);
  const coming = w.alerts.filter((a) => a.raised_at > h);
  return (
    <div className="card" data-testid="watcher">
      <h3 className="team-h">{t("title")}</h3>
      <p className="note"><N>{t("sub", { h: w.horizon_h })}</N></p>
      <div className="note" style={{ marginTop: 4 }}><b><N>{t("now", { time: hhmm(time) })}</N></b></div>
      {w.alerts.length === 0 && <div className="verify" style={{ marginTop: 6 }}>{t("none")}</div>}
      {raised.map((a) => (
        <div key={a.station} className={`watch-alert ${h >= a.crosses_at ? "now" : "soon"}`} data-testid="watch-alert">
          <b><N>{t("alert", { station: name(a.station), at: a.crosses_at })}</N></b>
          <small><N>{h >= a.crosses_at ? t("over", { pct: Math.round(a.peak_lf * 100) }) : t("inH", { n: a.crosses_at - h })} · {t("lead", { lead: a.lead_h })}</N> · <bdi>{a.run_id}</bdi></small>
        </div>
      ))}
      {coming.length > 0 && <div className="note" style={{ marginTop: 6 }}><N>{t("later", { n: coming.length, at: coming[0].raised_at })}</N></div>}
      {w.alerts.length > 0 && (
        <button type="button" className="btn red" style={{ width: "100%", marginTop: 8 }} data-testid="watch-run"
          onClick={() => { useTwin.setState({ tab: "team" }); void useTwin.getState().runAgents(locale); }}>{t("run")}</button>
      )}
    </div>
  );
}

/** Ask the twin: question chips (and a typed question in the workspace), each answered by one tool. */
export function AskCard({ chipsOnly = false }: { chipsOnly?: boolean }) {
  const t = useTranslations("mission.ask");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const f = useFmt();
  const name = useStationName();
  const { locale } = useLocale();
  const [a, setA] = useState<AskResponse | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async (body: { intent?: AskIntent; question?: string }) => {
    const s = useTwin.getState();
    if (!s.forecast || !s.forecastReq) return;
    setBusy(true);
    try {
      setA(await api.ask(askBody(s.forecast.run_id, s.threshold, s.forecastReq, mergeInterventions(s.applied.map((x) => x.ivs)), locale, body)));
    } catch { setA(null); } finally { setBusy(false); }
  };
  const p = (a?.params ?? {}) as Record<string, unknown>;
  const num = (k: string) => (p[k] == null ? "–" : f.int(Number(p[k])));
  const text = !a ? "" : td(`a.${a.key.replace(/^ask\./, "")}`, {
    station: name(p.station), hour: String(p.hour ?? ""), pct: num("peak_pct"), over: f.num(Number(p.over_h ?? 0)), att: num("attendance"), now: num("now"),
    ob: f.num(Number(p.over_before ?? 0)), oa: f.num(Number(p.over_after ?? 0)), pb: num("peak_before_pct"), pa: num("peak_after_pct"),
    veh: num("veh"), rp: num("pressure_pct"), title: String(p.title ?? ""), b: num("excess_before"), a: num("excess_after") });
  return (
    <div className="card" data-testid="ask">
      <h3 className="team-h">{t("title")}</h3>
      {!chipsOnly && <p className="note">{t("sub")}</p>}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
        {INTENTS.map((k) => <button key={k} type="button" className="pill" disabled={busy} data-intent={k} onClick={() => void ask({ intent: k })}>{td(`chips.${k}`)}</button>)}
      </div>
      {!chipsOnly && (
        <form className="row" style={{ gap: 6, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) void ask({ question: q.trim().slice(0, 300) }); }}>
          <input className="ask-input" value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} data-testid="ask-input" />
          <button type="submit" className="btn navy" disabled={busy || !q.trim()}>{t("send")}</button>
        </form>
      )}
      {a && (
        <div className={a.refused ? "warnbox" : "verify"} style={{ marginTop: 8 }} data-testid="ask-answer" aria-live="polite">
          <N>{text}</N>
          {!a.refused && <small style={{ display: "block", marginTop: 3, opacity: .8 }}><bdi>{td(`routed.${a.routed_by}`)} · {a.sources.map((s) => String((s as { run_id?: string }).run_id ?? "")).join(", ")}</bdi></small>}
        </div>
      )}
    </div>
  );
}

/** The Messenger's drafts for the last approved option: passenger notice, signage line, operations briefing. */
export function MessengerCard({ d }: { d: MessageResponse }) {
  const t = useTranslations("mission.msg");
  const { locale } = useLocale();
  const x = d.drafts[locale] ?? d.drafts.en;
  return (
    <div className="card" data-testid="messenger">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="team-h">{t("title")}</h3>
        <span className="badge sm">{t("draft")}</span>
      </div>
      <p className="note">{t("sub")}</p>
      <div className="msg-screen"><small>{t("notice")}</small><p>{x.notice}</p></div>
      <div className="msg-sign"><small>{t("sign")}</small><b>{x.sign}</b></div>
      <details className="trace"><summary>{t("ops")}</summary><p className="note">{x.ops}</p></details>
      {d.all_matched && <div className="verify" style={{ marginTop: 6 }}><N>{t("checked", { n: d.numbers_checked })}</N></div>}
    </div>
  );
}

/** The kiosk's view of the messenger: what riders would see on a station screen (a draft, never sent). */
export function KioskMessage() {
  const t = useTranslations("mission.msg");
  const { locale } = useLocale();
  const d = useTwin((s) => s.drafts);
  if (!d) return null;
  const x = d.drafts[locale] ?? d.drafts.en;
  return (
    <div className="kmsg" data-testid="kiosk-message">
      <div className="kmsg-top"><span>{t("screen")}</span><em>{t("draftLong")}</em></div>
      <p>{x.notice}</p>
    </div>
  );
}
