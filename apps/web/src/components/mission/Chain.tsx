"use client";
// The event chain — the agentic loop (POST /chain/start, /decide, /answer, /change; contracts 1.14.0 and 1.16.0):
// agents triggered by each other's events, the human at every decision. Every row is one event the server logged:
// who published it and which agents it triggered. The chain runs by itself until it needs the human — a question at a
// checkpoint, a plan to approve, or the end of the day — and goes on when the human answers. A rejection with a reason
// makes the team replan the same alert; changed conditions make the Watcher re-check the approved plan.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError, type ChainEvent, type ChainState, type CheckpointAnswer } from "@/lib/api";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { useTwin, type RejectReason } from "@/lib/store";
import { CheckpointCard, ReasonForm } from "./Loop";

type T = (k: string, v?: Record<string, string | number>) => string;

export function ChainCard() {
  const t = useTranslations("mission.chain");
  const ta = useTranslations("mission");
  const tl = useTranslations("loop") as unknown as T;
  const td = t as unknown as T;
  const tag = ta as unknown as T;
  const f = useFmt();
  const { locale } = useLocale();
  const ready = useTwin((s) => !!s.forecast && !s.loading);
  const stations = useTwin((s) => s.stations);
  const memory = useTwin((s) => s.memory);
  const [st, setSt] = useState<ChainState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askMe, setAskMe] = useState(true);
  const [why, setWhy] = useState(false);
  const name = (id: unknown) => (typeof id === "string" ? f.station(stations.find((s) => s.id === id)) : "");

  const go = async (fn: () => Promise<ChainState>) => {
    setBusy(true);
    setErr(null);
    try { setSt(await fn()); } catch (e) { setErr(e instanceof ApiError ? e.detail : String(e)); } finally { setBusy(false); }
  };
  const start = () => {
    const s = useTwin.getState();
    if (!s.forecastReq) return;
    setWhy(false);
    void go(() => api.chainStart({ forecast: s.forecastReq!, threshold: s.threshold, scope: "corridor", priority: s.priority, locale, horizon_h: 3,
      constraints: s.constraints, checkpoints: askMe ? ["hotspot", "partial"] : [], max_feedback_rounds: 3 }));
  };
  const decide = async (d: "approve" | "reject", r?: RejectReason) => {
    if (!st) return;
    await go(() => api.chainDecide(st.chain_id, { decision: d, user: "duty-manager", reason_codes: r?.codes ?? [], reason: r?.words.trim() || null,
      avoid: (r?.avoid ?? []) as never[], protect: r?.protect ?? [] }));
    setWhy(false);
    void useTwin.getState().loadMemory("duty-manager");
  };
  const answer = (a: CheckpointAnswer) => st && void go(() => api.chainAnswer(st.chain_id, { answer: a, user: "duty-manager" }));
  const change = (k: "rain" | "train_fault" | "crowd_surge" | "bigger") => st && void go(() => api.chainChange(st.chain_id, k === "bigger"
    ? { attendance_x: 1.3, user: "duty-manager" } : { incident: { type: k, hour: Math.max(st.hour, 16) }, user: "duty-manager" }));

  const cpWhat = (p: Record<string, unknown>) => p.checkpoint === "hotspot"
    ? tag("ev.cpHotspot", { station: name((p.params as Record<string, unknown>)?.station) })
    : tag("ev.cpPartial", { station: name((p.params as Record<string, unknown>)?.station), excess: f.int(Number((p.params as Record<string, unknown>)?.excess ?? 0)) });
  const line = (e: ChainEvent): string => {
    const p = e.payload as Record<string, unknown>;
    switch (e.topic) {
      case "scenario.loaded": return td("ev.loaded");
      case "alert.raised": {
        const a = ((p.alerts as { station: string; crosses_at: number }[]) ?? [])[0];
        return a ? td("ev.alert", { station: name(a.station), at: String(a.crosses_at), n: ((p.alerts as unknown[]) ?? []).length }) : td("ev.alertNone");
      }
      case "checkpoint.asked": return td("ev.asked", { what: cpWhat(p) });
      case "checkpoint.answered": return td("ev.answered", { what: tag(`ev.cpA.${String(p.action)}`, { station: name(p.station) }) });
      case "plan.ready": return td("ev.plan", { n: Number(p.options ?? 0), events: Number(p.agent_events ?? 0), rank: String(p.recommended_rank ?? "–") });
      case "decision.made": return p.feedback ? td("ev.rejectedReplan", { rank: String(p.rank ?? "") })
        : td(p.decision === "approve" ? "ev.approved" : "ev.rejected", { rank: String(p.rank ?? "") });
      case "feedback.read": return td("ev.feedbackRead", { n: ((p.changes as unknown[]) ?? []).length });
      case "drafts.ready": return td("ev.drafts");
      case "conditions.changed": return td("ev.changed", { what: p.incident ? tl(`change.${String((p.incident as { type: string }).type)}`) : tl("change.bigger") });
      case "plan.checked": return p.holds ? td("ev.checkedHolds") : td("ev.checkedBroken", { over: f.num(Number(p.over ?? 0)) });
      case "day.ended": return td(`ev.end.${["clear", "residual", "step_limit"].includes(String(p.reason)) ? String(p.reason) : "other"}`);
      default: return e.topic;
    }
  };
  const who = (a: string) => tag(`agent.${a}`);
  const inbox = st?.inbox;
  const rec = inbox?.mission.plan.options.find((o) => o.rank === inbox.recommended_rank);
  const lp = (st?.loop ?? {}) as Record<string, number>;
  const cons = st?.constraints;
  const inForce = cons ? [...(cons.forbid_types ?? []).map((k) => tl("chForbid", { what: tag(`measure.${k}`) })),
    ...(cons.protect_stations ?? []).map((k) => tl("chProtect", { what: name(k) })), ...(cons.cost_cap != null ? [tl("chCap", { cap: f.int(cons.cost_cap) })] : [])] : [];

  return (
    <div className="card" data-testid="chain">
      <h3 className="team-h" style={{ marginTop: 0 }}>{t("title")}</h3>
      <p className="note">{t("sub")}</p>
      <label className="loop-switch" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={askMe} onChange={(e) => setAskMe(e.target.checked)} data-testid="chain-askme" />
        <span><b>{t("loopOn")}</b><small>{tl("askMeNote")}</small></span>
      </label>
      <button type="button" className="btn red" style={{ width: "100%", marginTop: 8 }} disabled={!ready || busy} onClick={start} data-testid="chain-start">
        {st ? t("restart") : t("start")}
      </button>
      {err && <div className="warnbox" style={{ marginTop: 8 }}>{err}</div>}
      {st && (
        <>
          <p className="note" data-testid="chain-loop"><N>{tl("loopRow", { plans: lp.plans ?? 0, asks: lp.checkpoints ?? 0, answers: lp.answers ?? 0, feedback: lp.feedback ?? 0, changes: lp.changes ?? 0 })}</N></p>
          {inForce.length > 0 && <p className="note" data-testid="chain-inforce"><b>{tl("inForce")}:</b> <bdi>{inForce.join(" · ")}</bdi></p>}
          <ol className="team-feed" style={{ marginTop: 10 }} data-testid="chain-events">
            {st.events.map((e) => (
              <li key={e.seq} className={e.publisher === "human" ? "L1" : e.topic === "plan.ready" || e.topic === "checkpoint.asked" ? "L4" : "L2"} data-topic={e.topic}>
                <span className="who"><bdi>{who(e.publisher)}</bdi>
                  <small className="to"><bdi>{td("to", { who: e.subscribers.map(who).join(", ") })}</bdi></small></span>
                <span className="what"><bdi><N>{line(e)}</N></bdi><small><code>{e.topic}</code></small></span>
              </li>
            ))}
          </ol>
        </>
      )}
      {st?.status === "awaiting_human" && st.pause && <CheckpointCard pause={st.pause} busy={busy} onAnswer={answer} testid="chain-checkpoint" />}
      {st?.status === "awaiting_human" && inbox && rec && (
        <div className="verify" style={{ marginTop: 8 }} data-testid="chain-inbox">
          <b>{t("inbox")}</b>
          <p style={{ margin: "4px 0" }}><bdi>{rec.title}</bdi></p>
          <small><N>{td("figures", { over: f.num(rec.summary.overcap_station_hours), before: f.num(inbox.baseline.overcap_station_hours) })}</N></small>
          {why ? (
            <ReasonForm interventions={rec.interventions} busy={busy} memory={memory}
              onSubmit={(r) => decide("reject", r)} onPlainReject={() => decide("reject")} onCancel={() => setWhy(false)} />
          ) : (
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button type="button" className="btn red" disabled={busy} onClick={() => decide("approve")} data-testid="chain-approve">{t("approve")}</button>
              <button type="button" className="pill" disabled={busy} onClick={() => { setWhy(true); void useTwin.getState().loadMemory("duty-manager"); }} data-testid="chain-reject">{t("reject")}</button>
            </div>
          )}
        </div>
      )}
      {st && st.status !== "running" && (st.applied.length > 0 || st.status === "ended") && (
        <div className="loop-change" data-testid="chain-change">
          <b>{tl("change.title")}</b>
          <p className="note" style={{ marginTop: 2 }}>{tl("change.sub")}</p>
          <div className="loop-chips">
            {(["rain", "train_fault", "crowd_surge", "bigger"] as const).map((k) => (
              <button key={k} type="button" className="pill" disabled={busy} onClick={() => change(k)} data-change={k}>{tl(`change.${k}`)}</button>
            ))}
          </div>
        </div>
      )}
      {st?.status === "ended" && <p className="note" data-testid="chain-ended"><N>{td("ended", { n: st.decisions?.length ?? 0 })}</N></p>}
    </div>
  );
}
