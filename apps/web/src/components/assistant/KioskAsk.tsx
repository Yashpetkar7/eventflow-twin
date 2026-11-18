"use client";
// Visitor questions on the kiosk's "I'm travelling" screen (contract 1.17.0). Touch only: five questions to tap, no
// keyboard. The kiosk audience gets visitor answers and nothing else: no plans, no settings, no internals. What RTA
// publishes is shown with its source; the twin's own figures are simulated from synthetic demand and say so.
import { useState } from "react";
import { N, useLocale } from "@/lib/i18n";
import { api, type ChatContext, type ChatResponse } from "@/lib/api";
import { chatBody } from "@/lib/requests";
import { mergeInterventions, useTwin } from "@/lib/store";
import { chipKey, useSay } from "./say";

const QUESTIONS = ["which_station", "when_leave", "accessible", "travel_options", "reach"];

export function KioskAsk({ station, hour }: { station?: string; hour?: number }) {
  const { say, t } = useSay();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<ChatResponse | null>(null);
  const [ctx, setCtx] = useState<ChatContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ask = async (intent: string, args?: Record<string, unknown>) => {
    const s = useTwin.getState();
    if (busy || !s.forecast || !s.forecastReq) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await api.chat(chatBody(s.forecast.run_id, s.threshold, s.forecastReq, mergeInterventions(s.applied.map((a) => a.ivs)), locale, {
        intent, args, audience: "kiosk", priority: "balanced", constraints: { forbid_types: [], protect_stations: [], cost_cap: null },
        station, hour, scenario_version: 1, context: ctx ?? undefined }));
      setRes(r);
      setCtx(r.context);
    } catch {
      setRes(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setOpen(false); setRes(null); setFailed(false); };

  if (!open) {
    return <button type="button" className="kgo ghost kask-open" onClick={() => setOpen(true)} data-testid="kiosk-ask-open">{t("a.kiosk.title")}</button>;
  }
  const docs = (res?.evidence ?? []).filter((e) => e.kind === "document").slice(0, 2);
  return (
    <div className="kask" data-testid="kiosk-ask" data-status={res?.status ?? (failed ? "failed" : "idle")} role="region" aria-label={t("a.kiosk.title")}>
      <h1>{t("a.kiosk.title")}</h1>
      {!res && !failed && (
        <div className="kask-qs">
          {QUESTIONS.map((q) => (
            <button key={q} type="button" className="kask-q" disabled={busy} data-intent={q} onClick={() => void ask(q)}>{t(chipKey(q))}</button>
          ))}
        </div>
      )}
      {busy && <div className="kwait"><span className="kspin" />{t("thinking")}</div>}
      {failed && <p className="kask-a" data-testid="kiosk-ask-answer">{t("a.kiosk.noAnswer")}</p>}
      {res && (
        <div className="kask-a" data-testid="kiosk-ask-answer" aria-live="polite">
          {res.blocks.map((b, i) => <p key={i} data-key={b.key}><N>{say(b)}</N></p>)}
          {docs.map((e) => (
            <figure key={e.id} className="kask-doc" data-source={e.id}>
              <blockquote lang={e.excerpt_locale ?? "en"} dir={e.excerpt_locale === "ar" ? "rtl" : "ltr"}>{e.excerpt}</blockquote>
              <figcaption><bdi>{e.authority}</bdi> · <N>{t("doc.retrieved", { d: e.retrieved ?? "" })}</N></figcaption>
            </figure>
          ))}
          {res.options.length > 0 && (
            <div className="kask-qs">
              {res.options.map((o, i) => (
                <button key={i} type="button" className="kask-q" disabled={busy} onClick={() => void ask(o.intent, o.args)}><N>{say({ key: o.label_key, params: o.params ?? {} })}</N></button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="knote">{t("a.kiosk.source")}</p>
      <div className="krow">
        {(res || failed) && <button type="button" className="kgo ghost" onClick={() => { setRes(null); setFailed(false); }} data-testid="kiosk-ask-more">{t("a.kiosk.back")}</button>}
        <button type="button" className="kgo" onClick={close} data-testid="kiosk-ask-close">{t("a.kiosk.done")}</button>
      </div>
    </div>
  );
}
