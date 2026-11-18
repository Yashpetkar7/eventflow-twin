"use client";
// The kiosk's AI sheet (contract 1.18.0, decision #155): a visitor types or taps, the assistant answers from the
// simulator and asks back. Two modes:
//   plan  = the planning game ("sandbox" audience): change the scenario in words, tap a scenario the AI already tested,
//           or describe a whole new event; nothing is applied to the scenario without a tap or a typed instruction,
//           and a described event is shown back for confirmation first.
//   ride  = "I'm travelling" ("kiosk" audience): visitor questions, with what matters to this visitor (step-free,
//           room, a short walk) kept for the session only and sent with each question.
// The keyboard is built in (English and Arabic): the booth has no physical one, and the system keyboard would cover
// the screen. Every figure in an answer comes from the API (CLAUDE.md rule 2).
import { useEffect, useRef, useState } from "react";
import { N, useFmt, useLocale } from "@/lib/i18n";
import { api, type BriefResponse, type ChatContext, type ChatResponse } from "@/lib/api";
import { applyPatch, useAssistant } from "@/lib/assistant";
import { chatBody } from "@/lib/requests";
import { useVoice } from "@/lib/voice";
import { mergeInterventions, useTwin, type Priority, type Weather } from "@/lib/store";
import { chipKey, useSay } from "../assistant/say";

const ROWS = {
  en: ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm,.?"],
  ar: ["1234567890", "ضصثقفغعهخحجد", "شسيبلاتنمكط", "ئءؤرىةوزظذ،؟"],
} as const;
const RIDE_QUESTIONS = ["which_station", "when_leave", "accessible", "travel_options", "reach"];
const PREFS = ["step_free", "quiet", "short_walk"] as const;
const MAX = 240;

/** The on-screen keyboard. The field takes a physical keyboard too (the team's laptop), but never opens the system one. */
function Keys({ value, onChange, onSend, placeholder, busy }: { value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string; busy: boolean }) {
  const { t } = useSay();
  const { locale } = useLocale();
  const [lay, setLay] = useState<"en" | "ar">(locale);
  const put = (ch: string) => { if (value.length < MAX) onChange(value + ch); };
  const voice = useVoice(lay, (s) => onChange(s.slice(0, MAX)));      // spoken words land in the field; the visitor checks and sends them
  return (
    <div className="kai-keys" data-testid="kai-keys" data-layout={lay} data-voice={voice.mode}>
      {voice.mode !== "off" && (
        <p className={`kai-voice${voice.listening ? " on" : ""}`} data-testid="kai-voice-note" aria-live="polite">
          {voice.listening ? t("kai.voice.listening") : voice.failed ? t("kai.voice.error") : t(`kai.voice.${voice.mode}`)}
        </p>
      )}
      <div className="kai-line">
        {voice.mode !== "off" && (
          <button type="button" className="kai-mic" aria-pressed={voice.listening} onClick={() => (voice.listening ? voice.stop() : voice.start())} data-testid="kai-mic">
            {voice.listening ? `■ ${t("kai.voice.stop")}` : `🎤 ${t("kai.voice.start")}`}
          </button>
        )}
        <input className="kai-in" value={value} placeholder={placeholder} inputMode="none" maxLength={MAX} dir="auto" aria-label={placeholder} data-testid="kai-input"
          onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSend(); }} />
        <button type="button" className="kai-send" disabled={busy || value.trim().length < 2} onClick={onSend} data-testid="kai-send">{t("kai.send")}</button>
      </div>
      {ROWS[lay].map((row) => (
        <div key={row} className="kai-row" dir={lay === "ar" ? "rtl" : "ltr"}>
          {[...row].map((ch) => <button key={ch} type="button" data-k={ch} onClick={() => put(ch)}>{ch}</button>)}
        </div>
      ))}
      <div className="kai-row">
        <button type="button" className="wide" onClick={() => setLay(lay === "en" ? "ar" : "en")} data-testid="kai-lang" lang={lay === "en" ? "ar" : "en"}>{lay === "en" ? "ع" : "EN"}</button>
        <button type="button" className="space" onClick={() => put(" ")} aria-label={t("kai.space")}>{t("kai.space")}</button>
        <button type="button" className="wide" onClick={() => onChange(value.slice(0, -1))} aria-label={t("kai.del")} data-testid="kai-del">⌫</button>
      </div>
    </div>
  );
}

const plus3h = (start: string) => { const h = Math.min(23, Number(start.slice(0, 2)) + 3); return `${String(h).padStart(2, "0")}:${h === 23 ? "30" : start.slice(3, 5)}`; };

export function KioskAI({ mode, station, hour, onClose, onApplied, onBrief }: {
  mode: "plan" | "ride"; station?: string; hour?: number; onClose: () => void; onApplied?: () => void; onBrief?: () => void }) {
  const { say, t, name } = useSay();
  const f = useFmt();
  const { locale } = useLocale();
  const stations = useTwin((s) => s.stations);
  const events = useTwin((s) => s.events);
  const [res, setRes] = useState<ChatResponse | null>(null);
  const [ctx, setCtx] = useState<ChatContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [keys, setKeys] = useState(false);
  const [text, setText] = useState("");
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [describe, setDescribe] = useState(false);              // the keyboard is taking a description of a new event
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [near, setNear] = useState("");
  const prefsRef = useRef(prefs);
  const ctxRef = useRef(ctx);

  const ask = async (a: { message?: string; intent?: string; args?: Record<string, unknown> }, p = prefsRef.current) => {
    const s = useTwin.getState();
    if (busy || !s.forecast || !s.forecastReq || s.loading) return;
    setBusy(true); setFailed(false); setBrief(null);
    try {
      const r = await api.chat(chatBody(s.forecast.run_id, s.threshold, s.forecastReq, mergeInterventions(s.applied.map((x) => x.ivs)), locale, {
        ...a, audience: mode === "plan" ? "sandbox" : "kiosk", priority: s.priority, constraints: s.constraints, station, hour,
        scenario_version: useAssistant.getState().version, context: { ...(ctxRef.current ?? {}), prefs: p } as ChatContext }));
      setRes(r); setCtx(r.context); ctxRef.current = r.context;
      if (r.status === "applied" && r.patch) { applyPatch(r.patch); onApplied?.(); }
    } catch {
      setRes(null); setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  // The planning game opens with scenarios the AI has already tested: suggestions first, typing second.
  const started = useRef(false);
  useEffect(() => {
    if (mode !== "plan" || started.current) return;
    started.current = true;
    queueMicrotask(() => void ask({ intent: "suggest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const send = async () => {
    const m = text.trim();
    if (m.length < 2 || busy) return;
    setText(""); setKeys(false);
    if (!describe) { void ask({ message: m }); return; }
    setDescribe(false); setBusy(true); setFailed(false); setRes(null);
    try {
      const r = await api.brief(m.length < 3 ? `${m} ` : m, locale);
      setBrief(r); setNear(r.event.near_station ?? "");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const phrase = (p: string) => { setKeys(false); setText(""); void ask({ message: p }); };
  const toggle = (k: string) => {
    const p = { ...prefs, [k]: !prefs[k] };
    setPrefs(p); prefsRef.current = p;
    if (res?.intent && RIDE_QUESTIONS.includes(res.intent)) void ask({ intent: res.intent }, p);      // answer the same question again, for this visitor
  };
  const useBrief = () => {
    if (!brief) return;
    const e = brief.event, start = e.start ?? "19:00";
    const end = e.end && (!e.start || e.end > e.start) ? e.end : plus3h(start);
    const c = brief.constraints;
    void useTwin.getState().applyBrief({
      eventId: e.event_id ?? null, custom: e.event_id ? null : { near, start, end, weekend: e.weekend ?? false },
      attendance: e.attendance ?? null, weather: (brief.weather ?? "normal") as Weather, threshold: brief.threshold ?? null, priority: (brief.priority ?? null) as Priority | null,
      constraints: { forbid_types: c.forbid_types ?? [], protect_stations: c.protect_stations ?? [], cost_cap: c.cost_cap ?? null },
      brief: { goal: brief.summary.slice(0, 500), notes: brief.text.slice(0, 1000),
        confirmed: { text: brief.text.slice(0, 1000), summary: brief.summary.slice(0, 300), source: brief.source, fields: brief.fields.map((x) => x.field), removed: [] } },
    }, locale);
    setBrief(null);
    onBrief?.();
  };

  const docs = (res?.evidence ?? []).filter((e) => e.kind === "document").slice(0, 1);
  const phrases = describe ? [] : Object.keys(mode === "plan" ? { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1 } : { p1: 1, p2: 1, p3: 1, p4: 1 }).map((k) => t(`kai.${mode === "plan" ? "phrasePlan" : "phraseRide"}.${k}`));
  const chips = (res?.suggestions ?? []).filter((x) => x !== "help" && x !== "undo").slice(0, 3);
  const bev = brief?.event.event_id ? events.find((x) => x.id === brief.event.event_id) : null;
  const ordered = [...stations].map((s) => s.id);

  return (
    <section className={`kai${keys ? " typing" : ""}`} data-testid="kai" data-mode={mode} data-status={brief ? "brief" : res?.status ?? (failed ? "failed" : busy ? "busy" : "idle")} data-intent={res?.intent ?? ""} aria-label={t(mode === "plan" ? "kai.titlePlan" : "kai.titleRide")}>
      <header>
        <b>✦ {t(mode === "plan" ? "kai.titlePlan" : "kai.titleRide")}</b>
        <button type="button" className="kpill" onClick={onClose} data-testid="kai-close">✕ {t("kai.close")}</button>
      </header>
      <div className="kai-body" aria-live="polite">
        {!res && !brief && !failed && !busy && <p className="kai-hint">{t(mode === "plan" ? "kai.hintPlan" : "kai.hintRide")}</p>}
        {busy && <div className="kwait"><span className="kspin" />{t("thinking")}</div>}
        {failed && <p className="kai-hint" data-testid="kai-failed">{t("kai.failed")}</p>}
        {res && !busy && (
          <div className="kai-ans" data-testid="kai-answer">
            {res.blocks.slice(0, 4).map((b, i) => <p key={i} data-key={b.key}><N>{say(b)}</N></p>)}
            {docs.map((e) => <p key={e.id} className="kai-doc" data-source={e.id}><bdi>{e.authority}</bdi> · <N>{t("doc.retrieved", { d: e.retrieved ?? "" })}</N></p>)}
          </div>
        )}
        {res && !busy && res.options.length > 0 && (
          <div className="kai-opts" data-testid="kai-options">
            {res.options.slice(0, 4).map((o, i) => (
              <button key={i} type="button" data-label={o.label_key} onClick={() => void ask({ intent: o.intent, args: o.args ?? undefined })}><N>{say({ key: o.label_key, params: o.params ?? {} })}</N></button>
            ))}
          </div>
        )}
        {brief && !busy && (
          <div className="kai-brief" data-testid="kai-brief">
            <p>{t("kai.understood")}</p>
            <dl>
              <div><dt>{t("kai.f.event")}</dt><dd><bdi>{bev ? f.event(bev) : brief.event.name || t("kai.describe")}</bdi></dd></div>
              {!bev && <div><dt>{t("kai.f.station")}</dt><dd>{near ? name(near) : "?"}</dd></div>}
              <div><dt>{t("kai.f.attendance")}</dt><dd><N>{brief.event.attendance != null ? f.int(brief.event.attendance) : bev ? f.int(bev.attendance) : t("kai.f.default")}</N></dd></div>
              {!bev && <div><dt>{t("kai.f.time")}</dt><dd><N>{brief.event.start ?? "19:00"}{brief.event.end ? ` – ${brief.event.end}` : ""}</N></dd></div>}
              <div><dt>{t("kai.f.weather")}</dt><dd>{t(`weather.${brief.weather ?? "normal"}`)}</dd></div>
              {brief.threshold != null && <div><dt>{t("kai.f.threshold")}</dt><dd><N>{f.pct(brief.threshold)}</N></dd></div>}
            </dl>
            {!bev && !near && (
              <div className="kai-near" data-testid="kai-near">
                <span>{t("kai.near")}</span>
                <div>{ordered.map((id) => <button key={id} type="button" onClick={() => setNear(id)}>{name(id)}</button>)}</div>
              </div>
            )}
            <div className="kai-opts two">
              <button type="button" className="go" disabled={!bev && !near} onClick={useBrief} data-testid="kai-brief-use">{t("kai.use")}</button>
              <button type="button" onClick={() => setBrief(null)} data-testid="kai-brief-cancel">{t("kai.cancel")}</button>
            </div>
          </div>
        )}
        {mode === "ride" && !brief && (
          <>
            <div className="kai-prefs" role="group" aria-label={t("kai.prefs")} data-testid="kai-prefs">
              <span>{t("kai.prefs")}</span>
              {PREFS.map((k) => <button key={k} type="button" aria-pressed={!!prefs[k]} data-pref={k} onClick={() => toggle(k)}>{t(`kai.pref.${k}`)}</button>)}
            </div>
            {!res && !busy && <div className="kai-chips">{RIDE_QUESTIONS.map((q) => <button key={q} type="button" data-intent={q} onClick={() => void ask({ intent: q })}>{t(chipKey(q))}</button>)}</div>}
          </>
        )}
        {res && !busy && chips.length > 0 && (
          <div className="kai-chips" data-testid="kai-chips">{chips.map((q) => <button key={q} type="button" data-intent={q} onClick={() => void ask({ intent: q })}>{t(chipKey(q))}</button>)}</div>
        )}
      </div>
      {keys && phrases.length > 0 && (
        <div className="kai-phrases" data-testid="kai-phrases">{phrases.map((p) => <button key={p} type="button" onClick={() => phrase(p)}>{p}</button>)}</div>
      )}
      {keys && <Keys value={text} onChange={setText} onSend={() => void send()} busy={busy} placeholder={describe ? t("kai.describeHint") : t("kai.placeholder")} />}
      <div className="kai-bar">
        <button type="button" className="go" aria-pressed={keys && !describe} onClick={() => { setDescribe(false); setKeys(!(keys && !describe)); }} data-testid="kai-type">⌨ {keys && !describe ? t("kai.hideKeys") : t("kai.type")}</button>
        {mode === "plan" && <button type="button" aria-pressed={keys && describe} onClick={() => { setDescribe(true); setKeys(!(keys && describe)); }} data-testid="kai-describe">＋ {t("kai.describe")}</button>}
        {mode === "plan" && <button type="button" disabled={busy} onClick={() => void ask({ intent: "suggest" })} data-testid="kai-suggest">✦ {t("kai.again")}</button>}
        {mode === "plan" && ctx?.undo && <button type="button" disabled={busy} onClick={() => void ask({ intent: "undo" })} data-testid="kai-undo">↶ {t("kai.undo")}</button>}
        {mode === "ride" && res && <button type="button" onClick={() => setRes(null)} data-testid="kai-more">{t("a.kiosk.back")}</button>}
      </div>
    </section>
  );
}
