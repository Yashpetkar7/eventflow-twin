"use client";
// The event chain (POST /chain/start, /chain/{id}/decide; contract 1.14.0): agents triggered by each other's events.
// Every row is one event the server logged: who published it and which agents it triggered. The chain runs by itself
// until the plan reaches the human; Approve or Reject publishes the decision and the chain carries on.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError, type ChainEvent, type ChainState } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { useTwin } from "@/lib/store";

export function ChainCard() {
  const t = useTranslations("mission.chain");
  const ta = useTranslations("mission");
  const td = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const tag = ta as unknown as (k: string) => string;
  const f = useFmt();
  const { locale } = useLocale();
  const ready = useTwin((s) => !!s.forecast && !s.loading);
  const stations = useTwin((s) => s.stations);
  const [st, setSt] = useState<ChainState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: unknown) => (typeof id === "string" ? f.station(stations.find((s) => s.id === id)) : "");

  const go = async (fn: () => Promise<ChainState>) => {
    setBusy(true);
    setErr(null);
    try { setSt(await fn()); } catch (e) { setErr(e instanceof ApiError ? e.detail : String(e)); } finally { setBusy(false); }
  };
  const start = () => {
    const s = useTwin.getState();
    if (!s.forecastReq) return;
    void go(() => api.chainStart({ forecast: s.forecastReq!, threshold: s.threshold, scope: "corridor", priority: s.priority, locale, horizon_h: 3 }));
  };
  const decide = (d: "approve" | "reject") => st && void go(() => api.chainDecide(st.chain_id, { decision: d, user: "duty-manager" }));

  const line = (e: ChainEvent): string => {
    const p = e.payload as Record<string, unknown>;
    switch (e.topic) {
      case "scenario.loaded": return td("ev.loaded");
      case "alert.raised": {
        const a = ((p.alerts as { station: string; crosses_at: number }[]) ?? [])[0];
        return a ? td("ev.alert", { station: name(a.station), at: String(a.crosses_at), n: ((p.alerts as unknown[]) ?? []).length }) : td("ev.alertNone");
      }
      case "plan.ready": return td("ev.plan", { n: Number(p.options ?? 0), events: Number(p.agent_events ?? 0), rank: String(p.recommended_rank ?? "–") });
      case "decision.made": return td(p.decision === "approve" ? "ev.approved" : "ev.rejected", { rank: String(p.rank ?? "") });
      case "drafts.ready": return td("ev.drafts");
      case "day.ended": return td(`ev.end.${["clear", "residual", "step_limit"].includes(String(p.reason)) ? String(p.reason) : "other"}`);
      default: return e.topic;
    }
  };
  const who = (a: string) => (a === "human" ? tag("agent.human") : tag(`agent.${a}`));
  const inbox = st?.inbox;
  const rec = inbox?.mission.plan.options.find((o) => o.rank === inbox.recommended_rank);

  return (
    <div className="card" data-testid="chain">
      <h3 className="team-h" style={{ marginTop: 0 }}>{t("title")}</h3>
      <p className="note">{t("sub")}</p>
      <button type="button" className="btn red" style={{ width: "100%", marginTop: 8 }} disabled={!ready || busy} onClick={start} data-testid="chain-start">
        {st ? t("restart") : t("start")}
      </button>
      {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}
      {st && (
        <ol className="team-feed" style={{ marginTop: 10 }} data-testid="chain-events">
          {st.events.map((e) => (
            <li key={e.seq} className={e.publisher === "human" ? "L1" : e.topic === "plan.ready" ? "L4" : "L2"} data-topic={e.topic}>
              <span className="who"><bdi>{who(e.publisher)}</bdi>
                <small className="to"><bdi>{td("to", { who: e.subscribers.map(who).join(", ") })}</bdi></small></span>
              <span className="what"><bdi><N>{line(e)}</N></bdi><small><code>{e.topic}</code></small></span>
            </li>
          ))}
        </ol>
      )}
      {st?.status === "awaiting_human" && inbox && rec && (
        <div className="verify" style={{ marginTop: 8 }} data-testid="chain-inbox">
          <b>{t("inbox")}</b>
          <p style={{ margin: "4px 0" }}><bdi>{rec.title}</bdi></p>
          <small><N>{td("figures", { over: f.num(rec.summary.overcap_station_hours), before: f.num(inbox.baseline.overcap_station_hours) })}</N></small>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn red" disabled={busy} onClick={() => decide("approve")} data-testid="chain-approve">{t("approve")}</button>
            <button type="button" className="pill" disabled={busy} onClick={() => decide("reject")} data-testid="chain-reject">{t("reject")}</button>
          </div>
        </div>
      )}
      {st?.status === "ended" && <p className="note" data-testid="chain-ended"><N>{td("ended", { n: st.decisions?.length ?? 0 })}</N></p>}
    </div>
  );
}
