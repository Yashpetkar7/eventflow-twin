"use client";
// The agentic loop's human parts (contract 1.16.0, decision #144), shared by the AI plan tab, the event chain and the
// duty inbox: the team's question at a checkpoint, the reason form behind "Reject", and what the decision log remembers.
// Every figure shown comes from the server (the simulator's runs); nothing here computes or applies anything.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CheckpointAnswer, CheckpointPause, FeedbackResponse, Intervention, MemoryResponse, ReasonCode } from "@/lib/api";
import { N, useFmt } from "@/lib/i18n";
import { CORRIDOR_ORDER, useTwin, type RejectReason } from "@/lib/store";

type T = (k: string, v?: Record<string, string | number>) => string;

/** The team stopped and asks: one button per answer that applies here. */
export function CheckpointCard({ pause, busy, onAnswer, testid = "checkpoint" }: {
  pause: CheckpointPause; busy?: boolean; onAnswer: (a: CheckpointAnswer) => void; testid?: string;
}) {
  const t = useTranslations("loop") as unknown as T;
  const tm = useTranslations("mission") as unknown as T;
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const name = (id: unknown) => (typeof id === "string" ? f.station(stations.find((s) => s.id === id)) : "");
  const p = pause.params as Record<string, unknown>;
  const acts = new Set(pause.actions);
  const hours = ((p.hours as number[]) ?? []).map((h) => `${h}:00`).join(", ");
  const best = p.best as { interventions?: Intervention[]; over?: number; excess?: number } | undefined;
  const cap = typeof p.cost_cap === "number" ? p.cost_cap : null;
  const ans = (a: Omit<CheckpointAnswer, "checkpoint">) => onAnswer({ checkpoint: pause.checkpoint, ...a } as CheckpointAnswer);
  // the team is waiting: bring its question into view (the side panel may be scrolled to the brief or the steps)
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useTwin((s) => s.reducedMotion);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); }, [pause, reduced]);
  return (
    <div ref={ref} className="card loop-ask" data-testid={testid} data-checkpoint={pause.checkpoint} role="group" aria-label={t("askTitle")}>
      <div className="loop-ask-head"><span className="loop-dot" aria-hidden="true" /> <b>{t("askTitle")}</b> <small>{t("askBy", { who: tm(`agent.${pause.asked_by}`) })}</small></div>
      {pause.checkpoint === "hotspot" ? (
        <>
          <p className="loop-q"><bdi><N>{t("qHotspot", { station: name(p.station), hours, gap: f.int(Number(p.gap ?? 0)) })}</N></bdi></p>
          <div className="loop-acts">
            <button type="button" className="btn red" disabled={busy} onClick={() => ans({ action: "confirm" })} data-testid="cp-confirm">{t("aConfirm", { station: name(p.station) })}</button>
            {acts.has("focus") && ((p.candidates as { id: string; bins: number }[]) ?? []).filter((c) => c.id !== p.station).map((c) => (
              <button key={c.id} type="button" className="pill" disabled={busy} onClick={() => ans({ action: "focus", station: c.id })} data-testid="cp-focus" data-station={c.id}>
                {t("aFocus", { station: name(c.id) })}</button>
            ))}
            <button type="button" className="pill" disabled={busy} onClick={() => ans({ action: "stop" })} data-testid="cp-stop">{t("aStop")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="loop-q"><bdi><N>{t("qPartial", { rounds: f.int(Number(p.rounds ?? 0)), station: name(p.station), excess: f.int(Number(p.excess ?? 0)) })}</N></bdi></p>
          {best?.interventions && (
            <p className="note" style={{ marginTop: 0 }}><bdi><N>{t("bestSoFar", { what: best.interventions.map((iv) => tm(`measure.${iv.type}`)).join(" + "), over: f.num(Number(best.over ?? 0)) })}</N></bdi></p>
          )}
          <div className="loop-acts">
            <button type="button" className="btn red" disabled={busy} onClick={() => ans({ action: "accept" })} data-testid="cp-accept">{t("aAccept")}</button>
            {acts.has("more") && <button type="button" className="pill" disabled={busy} onClick={() => ans({ action: "more" })} data-testid="cp-more">{t("aMore")}</button>}
            {acts.has("allow") && ((p.forbidden as string[]) ?? []).map((m) => (
              <button key={m} type="button" className="pill" disabled={busy} onClick={() => ans({ action: "allow", measure: m as CheckpointAnswer["measure"] })} data-testid="cp-allow" data-measure={m}>
                {t("aAllow", { what: tm(`measure.${m}`) })}</button>
            ))}
            {acts.has("raise_cap") && cap != null && (
              <button type="button" className="pill" disabled={busy} onClick={() => ans({ action: "raise_cap", cost_cap: Math.min(1000, Math.ceil(cap * 1.5)) })} data-testid="cp-cap">
                <N>{t("aCap", { cap: f.int(Math.min(1000, Math.ceil(cap * 1.5))) })}</N></button>
            )}
          </div>
        </>
      )}
      <p className="note" style={{ marginBottom: 0 }}>{t("askNote")}</p>
    </div>
  );
}

const CODES: ReasonCode[] = ["too_costly", "not_enough"];

/** "Why not?" behind Reject: reason chips, the option's own measures, stations to protect, and the planner's words. */
export function ReasonForm({ interventions, busy, memory, onSubmit, onPlainReject, onCancel }: {
  interventions: Intervention[]; busy?: boolean; memory?: MemoryResponse | null;
  onSubmit: (r: RejectReason) => void; onPlainReject: () => void; onCancel: () => void;
}) {
  const t = useTranslations("loop") as unknown as T;
  const tm = useTranslations("mission") as unknown as T;
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const corridor = CORRIDOR_ORDER.map((id) => stations.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const types = [...new Set(interventions.map((iv) => iv.type))];
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [protect, setProtect] = useState<string[]>([]);
  const [words, setWords] = useState("");
  const tog = <X,>(l: X[], v: X) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  const reason = (): RejectReason => ({
    codes: [...codes, ...(avoid.length ? ["avoid_measure" as const] : []), ...(protect.length ? ["protect_station" as const] : []), ...(words.trim() ? ["other" as const] : [])],
    words, avoid, protect,
  });
  const any = codes.length || avoid.length || protect.length || words.trim();
  const mem = (memory?.items ?? []).filter((m) => (m.kind === "avoid" && types.includes(m.value as Intervention["type"])) || m.kind === "protect");
  return (
    <div className="loop-reason" data-testid="reason-form">
      <b>{t("whyTitle")}</b>
      <div className="loop-chips">
        {CODES.map((c) => <button key={c} type="button" className="pill" aria-pressed={codes.includes(c)} onClick={() => setCodes(tog(codes, c))} data-reason={c}>{t(`code.${c}`)}</button>)}
      </div>
      {types.length > 0 && <>
        <div className="note">{t("avoidL")}</div>
        <div className="loop-chips">{types.map((k) => <button key={k} type="button" className="pill" aria-pressed={avoid.includes(k)} onClick={() => setAvoid(tog(avoid, k))} data-avoid={k}>{tm(`measure.${k}`)}</button>)}</div>
      </>}
      <div className="note">{t("protectL")}</div>
      <div className="loop-chips">{corridor.map((s) => <button key={s.id} type="button" className="pill" aria-pressed={protect.includes(s.id)} onClick={() => setProtect(tog(protect, s.id))} data-protect={s.id}>{f.station(s)}</button>)}</div>
      {mem.length > 0 && (
        <p className="note" data-testid="reason-memory"><b>{t("memL")}</b> {mem.map((m) => (
          <button key={`${m.kind}:${m.value}`} type="button" className="loop-mem" onClick={() => (m.kind === "avoid" ? setAvoid(tog(avoid, m.value)) : setProtect(tog(protect, m.value)))}>
            <bdi><N>{t("memItem", { what: m.kind === "avoid" ? tm(`measure.${m.value}`) : f.station(stations.find((s) => s.id === m.value)), n: m.count })}</N></bdi>
          </button>
        ))}</p>
      )}
      <label className="sr-only" htmlFor="reason-words">{t("wordsL")}</label>
      <textarea id="reason-words" className="brief-text" rows={2} maxLength={300} placeholder={t("wordsPh")} value={words} onChange={(e) => setWords(e.target.value)} dir="auto" data-testid="reason-words" />
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn red" disabled={busy || !any} onClick={() => onSubmit(reason())} data-testid="reason-replan">{t("replan")}</button>
        <button type="button" className="pill" disabled={busy} onClick={onPlainReject} data-testid="reason-plain">{t("plainReject")}</button>
        <button type="button" className="pill" disabled={busy} onClick={onCancel}>{t("cancel")}</button>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>{t("whyNote")}</p>
    </div>
  );
}

/** "Round 2, after your feedback": what the reason changed. */
export function FeedbackBanner({ round, changes }: { round: number; changes: FeedbackResponse["changes"] }) {
  const t = useTranslations("loop") as unknown as T;
  const tm = useTranslations("mission") as unknown as T;
  const tg = useTranslations() as unknown as T;
  const f = useFmt();
  const stations = useTwin((s) => s.stations);
  const txt = (c: Record<string, unknown>) => {
    const v = c.value;
    switch (c.field) {
      case "forbid": return t("chForbid", { what: tm(`measure.${String(v)}`) });
      case "protect": return t("chProtect", { what: f.station(stations.find((s) => s.id === v)) });
      case "cost_cap": return t("chCap", { cap: f.int(Number(v)) });
      case "priority": return t("chPrio", { what: tg(`prioL.${String(v)}`) });
      default: return String(c.field);
    }
  };
  return (
    <div className="verify loop-fb" data-testid="feedback-banner">
      <b><N>{t("fbTitle", { round })}</N></b>
      <ul>{changes.map((c, i) => <li key={i}><bdi><N>{txt(c as Record<string, unknown>)}</N></bdi> <small>{t(`via.${String((c as Record<string, unknown>).via ?? "reason")}`)}</small></li>)}</ul>
    </div>
  );
}
