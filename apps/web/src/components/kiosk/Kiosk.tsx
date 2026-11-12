"use client";
// Visitor kiosk (?kiosk=1): one idea per screen, the 3D twin as the star, big targets in the lower half.
//   attract → ① pick an event → ② guess the busiest station (quiz, then the twin reveals it)
//           → ③ AI agents propose plans (every number from the simulator) → ④ you approve one → before/after
// Home and language are always visible; 60 s without a touch → "Still there?" (10 s) → back to the attract screen.
// Hidden expert exit for the team: press and hold the logo for 3 s → the full workspace.
// Every number shown comes from an API answer held in the store (CLAUDE.md rule 2).
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { hhmm, N, useFmt, useLocale } from "@/lib/i18n";
import { SCENE_V2 } from "@/lib/manifest";
import { CORRIDOR_ORDER, T_MAX, T_MIN, useTwin, type SimView } from "@/lib/store";
import { LabelLayer } from "../LabelLayer";
import { K, type KText } from "./strings";

const TwinCanvas = dynamic(() => import("../twin/TwinCanvas"), { ssr: false });

type Phase = "attract" | "event" | "crowd" | "plan" | "decide";
const STEP: Record<Phase, number> = { attract: -1, event: 0, crowd: 1, plan: 2, decide: 3 };
const AUTOMATIC = new Set(["guided-demo", "soak", "test", "playwright", "smoke"]);
const WEATHERS = ["normal", "hot", "rain"] as const;

function idleSeconds(): number {
  const v = Number(new URLSearchParams(window.location.search).get("idle"));
  return Number.isFinite(v) && v >= 5 && v <= 600 ? v : 60;
}

/** Busiest corridor station and moment of the day (from the simulator's 15-minute load factors). */
function busiest(v: SimView | null, ids: string[]): { id: string; lf: number; time: number } | null {
  if (!v) return null;
  let best: { id: string; lf: number; time: number } | null = null;
  for (const id of ids) v.by[id]?.lf.forEach((lf, b) => {
    const t = (b + 0.5) / v.bph;
    if (t >= T_MIN && t <= T_MAX && (!best || lf > best.lf)) best = { id, lf, time: t };
  });
  return best;
}

/** Extra data credits when the realism scene is on (the kiosk's default; ?scene=v1 turns it off): read from the same
 *  manifest the 3D code uses, so the kiosk never imports the realism code (docs/13 §4b). Empty for the corridor scene. */
async function sceneCredits(): Promise<string[]> {
  if (!SCENE_V2) return [];
  try {
    const r = await fetch("/geo/v2/manifest.json");
    if (!r.ok) return [];
    const m = (await r.json()) as { provenance?: { source?: string; licence?: string }[] };
    // Short attribution: the source's name up to the first comma or bracket; skip derived / internal rows.
    const names = (m.provenance ?? [])
      .filter((p) => p.source && !/^(n\/a|derived)/i.test(p.licence ?? "") && !/^(config\/|seeded|baked)/i.test(p.source))
      .map((p) => p.source!.split(/[,(]/)[0].replace(/\s+\d+\s*m\b.*$/, "").trim());
    return [...new Set(names)];
  } catch {
    return [];
  }
}

const dubaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());

interface Visitors { n: number; top: string | null }

async function todaysVisitors(): Promise<Visitors | null> {
  try {
    const r = await api.decisions(500);
    const day = dubaiDate();
    const mine = r.items.filter((x) => x.decision === "approve" && !AUTOMATIC.has(String(x.user).toLowerCase()) && String(x.timestamp).startsWith(day));
    const kinds = new Map<string, number>();
    for (const x of mine) for (const iv of x.interventions ?? []) kinds.set(iv.type, (kinds.get(iv.type) ?? 0) + 1);
    const top = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { n: mine.length, top };
  } catch {
    return null;                                    // counter is optional: never block the kiosk
  }
}

export function Kiosk() {
  const { locale, setLocale } = useLocale();
  const T: KText = K[locale];
  const f = useFmt();
  const st = useTwin;
  const events = useTwin((s) => s.events);
  const stations = useTwin((s) => s.stations);
  const scenario = useTwin((s) => s.scenario);
  const forecast = useTwin((s) => s.forecast);
  const base = useTwin((s) => s.base);
  const cur = useTwin((s) => s.cur);
  const breaks = useTwin((s) => s.breaks);
  const loading = useTwin((s) => s.loading);
  const ready = useTwin((s) => s.ready);
  const plan = useTwin((s) => s.plan);
  const planStatus = useTwin((s) => s.planStatus);
  const planStep = useTwin((s) => s.planStep);
  const threshold = useTwin((s) => s.threshold);
  const time = useTwin((s) => s.time);

  const [phase, setPhase] = useState<Phase>("attract");
  const [guess, setGuess] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  // The store clears the plan once it is applied: keep what the result screen needs (all from the API answer).
  const [picked, setPicked] = useState<{ title: string; before: { peak_lf: number; excess_pax: number } } | null>(null);
  const [visitors, setVisitors] = useState<Visitors | null>(null);
  const [big, setBig] = useState(false);
  const [still, setStill] = useState<number | null>(null);    // seconds left in the "Still there?" countdown
  const [credits, setCredits] = useState<string[]>([]);
  useEffect(() => { void sceneCredits().then(setCredits); }, []);
  const lastTouch = useRef(0);                                // set on mount and on every touch
  const anim = useRef<number | null>(null);

  // Designed at 1920×1080: zoom the UI layers to the window so every screen size shows the booth composition.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => root.current?.style.setProperty("--kz", String(Math.min(window.innerWidth / 1920, window.innerHeight / 1080)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const ids = useMemo(() => [...stations].sort((a, b) => CORRIDOR_ORDER.indexOf(a.id) - CORRIDOR_ORDER.indexOf(b.id)).map((s) => s.id), [stations]);
  const name = (id: string | null | undefined) => f.station(stations.find((s) => s.id === id));
  const peak = useMemo(() => busiest(base, ids), [base, ids]);
  const hot = (base?.resp.summary.overcap_station_hours ?? 0) > 0;
  const ev = forecast?.event ?? null;

  // ---- camera and clock per screen
  const animateTo = useCallback((target: number, ms = 2400) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = st.getState().time, t0 = performance.now();
    st.getState().setPlaying(false);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      st.getState().setTime(from + (target - from) * e);
      if (k < 1) anim.current = requestAnimationFrame(step); else { anim.current = null; setRevealed(true); }
    };
    anim.current = requestAnimationFrame(step);
  }, [st]);
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);

  useEffect(() => {
    const s = st.getState();
    if (phase === "attract") { s.setPlaying(false); s.setTime(17.5); s.setCam("orbit"); }      // golden hour, slow orbit
    if (phase === "event") { s.setPlaying(false); s.setCam("overview"); }
    if (phase === "crowd") { s.setPlaying(false); s.setCam("overview"); }
  }, [phase, st]);

  // ---- visitors counter (attract screen and after a decision)
  useEffect(() => {
    if (phase !== "attract" && phase !== "decide") return;
    let live = true;
    void todaysVisitors().then((v) => { if (live) setVisitors(v); });
    return () => { live = false; };
  }, [phase, chosen]);

  // ---- inactivity: "Still there?" then reset for the next visitor
  const reset = useCallback(() => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const s = st.getState();
    s.clearPlans();
    useTwin.setState({ scenario: { ...s.scenario, weather: "normal" } });
    if (s.events[0]) s.selectEvent(s.events[0].id);
    setGuess(null); setRevealed(false); setChosen(null); setPicked(null); setStill(null); setBig(false);
    setPhase("attract");
  }, [st]);

  useEffect(() => {
    lastTouch.current = Date.now();
    const touch = () => { lastTouch.current = Date.now(); setStill(null); };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const limit = idleSeconds() * 1000;
    const iv = setInterval(() => {
      if (phase === "attract") return;
      const idle = Date.now() - lastTouch.current;
      if (idle >= limit) {
        const left = 10 - Math.floor((idle - limit) / 1000);
        if (left <= 0) reset(); else setStill(left);
      }
    }, 250);
    return () => { window.removeEventListener("pointerdown", touch); window.removeEventListener("keydown", touch); clearInterval(iv); };
  }, [phase, reset]);

  // ---- attract screen: cycle the events so the twin looks alive
  useEffect(() => {
    if (phase !== "attract" || events.length < 2) return;
    const iv = setInterval(() => {
      const s = st.getState();
      const i = s.events.findIndex((e) => e.id === s.scenario.eventId);
      s.selectEvent(s.events[(i + 1) % s.events.length].id);
      setTimeout(() => { const n = st.getState(); n.setPlaying(false); n.setTime(17.5); n.setCam("orbit"); }, 600);   // selectEvent jumps to the peak
    }, 14_000);
    return () => clearInterval(iv);
  }, [phase, events.length, st]);

  // ---- hidden expert exit: hold the logo for 3 s
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = () => { hold.current = setTimeout(() => useTwin.setState({ kiosk: false }), 3000); };
  const holdEnd = () => { if (hold.current) clearTimeout(hold.current); };

  // ---- actions
  const start = () => { st.getState().setCam("overview"); setPhase("event"); };
  const pickEvent = (id: string) => { if (id !== scenario.eventId) st.getState().selectEvent(id); };
  const goCrowd = () => {
    setGuess(null); setRevealed(false);
    const startH = ev ? Math.max(T_MIN, Number(ev.start.slice(0, 2)) - 1) : 12;
    st.getState().setTime(startH);
    setPhase("crowd");
  };
  const reveal = useCallback((id: string) => {
    setGuess(id); setRevealed(false);
    const p = busiest(st.getState().base, ids);
    if (!p) return;
    st.getState().select(p.id);
    st.getState().setCam("close");
    animateTo(p.time);
  }, [animateTo, ids, st]);
  // A weather change re-runs the forecast: replay the reveal on the new answer.
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "crowd" || !guess || loading || !forecast) return;
    if (revealedFor.current === forecast.run_id) return;
    revealedFor.current = forecast.run_id;
    reveal(guess);
  }, [phase, guess, loading, forecast, reveal]);
  const tryHot = () => { revealedFor.current = null; st.getState().patchScenario({ weather: "hot" }); };
  const goPlan = () => { setPhase("plan"); setChosen(null); void st.getState().runAgents(locale); };
  const choose = async (rank: number) => {
    const o = st.getState().plan?.options.find((x) => x.rank === rank), b = st.getState().plan?.baseline_summary;
    if (!o || !b) return;
    setChosen(rank);
    setPicked({ title: o.title, before: { peak_lf: b.peak_lf, excess_pax: b.excess_pax } });
    await st.getState().decide(rank, "approve", "visitor");
    const p = busiest(st.getState().base, ids);
    if (p) { st.getState().select(p.id); st.getState().setCam("close"); }
    setPhase("decide");
  };
  const again = () => { st.getState().clearPlans(); setGuess(null); setRevealed(false); setChosen(null); setPicked(null); setPhase("event"); };

  const stepIdx = STEP[phase];
  const kindName = (k: string | null) => (k ? T.kinds[k] ?? k : "");
  const before = plan?.baseline_summary ?? base?.resp.summary ?? null;
  const after = cur?.resp.summary ?? null;
  const brk = breaks?.stations.find((s) => s.station_id === peak?.id)?.break_attendance ?? null;
  const over = (lf: number) => lf > threshold;

  return (
    <div ref={root} className={`kiosk-root${big ? " kbig" : ""}`} data-testid="kiosk" data-phase={phase}>
      <div className="kmap" data-testid="view">
        <TwinCanvas label={T.attractTitle} />
        <LabelLayer />
      </div>

      <header className="ktop">
        <button type="button" className="kbrand" aria-label={T.brand} onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd}>
          <span className="klogo" aria-hidden><i /><i /><i /></span>
          <span><b>{T.brand}</b><small>{T.tagline}</small></span>
        </button>
        {phase !== "attract" && (
          <ol className="ksteps" aria-label="steps">
            {T.steps.map((label, i) => (
              <li key={label} className={i === stepIdx ? "on" : i < stepIdx ? "done" : ""} aria-current={i === stepIdx ? "step" : undefined}>
                <span className="kn"><N>{i < stepIdx ? "✓" : String(i + 1)}</N></span>{label}
              </li>
            ))}
          </ol>
        )}
        <div className="ktools">
          <button type="button" className="kpill" aria-pressed={big} onClick={() => setBig(!big)} aria-label={T.bigText}><span className="kaa">A<small>A</small></span></button>
          <button type="button" className="kpill klang" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} lang={locale === "ar" ? "en" : "ar"}>{locale === "ar" ? "English" : "عربي"}</button>
          {phase !== "attract" && <button type="button" className="kpill khome" onClick={reset}>⌂ {T.home}</button>}
        </div>
      </header>

      {phase === "attract" && (
        <button type="button" className="kattract" onClick={start} data-testid="kiosk-start">
          <span className="kat-badge">{T.attractNote}</span>
          <span className="kat-title">{T.attractTitle}</span>
          <span className="kat-sub">{T.attractTitle2}</span>
          <span className="kat-cta"><span className="kat-dot" />{T.attractCta}</span>
          <span className="kat-count">{visitors && visitors.n > 0 ? T.today(f.int(visitors.n), kindName(visitors.top)) : T.todayNone}</span>
        </button>
      )}

      {phase !== "attract" && (
        <aside className="kcard" aria-live="polite">
          {phase === "event" && (
            <>
              <h1>{T.s1Title}</h1>
              <p className="ksub">{T.s1Sub}</p>
              <div className="kevents">
                {events.map((e) => (
                  <button key={e.id} type="button" className="kevent" aria-pressed={e.id === scenario.eventId} onClick={() => pickEvent(e.id)}>
                    <b>{f.event(e)}</b>
                    <span>{f.venue(e)}</span>
                    <span className="kmeta"><N>{T.visitors(f.int(e.attendance))}</N>{e.is_synthetic && <em>{T.hypothetical}</em>}</span>
                  </button>
                ))}
              </div>
              <div className="kfield">
                <span>{T.weather}</span>
                <div className="kseg">
                  {WEATHERS.map((w) => <button key={w} type="button" aria-pressed={scenario.weather === w} onClick={() => st.getState().patchScenario({ weather: w })}>{T.weathers[w]}</button>)}
                </div>
                <small>{T.weatherHint}</small>
              </div>
              <button type="button" className="kgo" disabled={!ready || loading} onClick={goCrowd}>{T.next1} →</button>
            </>
          )}

          {phase === "crowd" && (
            <>
              <h1>{T.s2Title}</h1>
              <p className="ksub">{T.s2Sub}</p>
              {!guess && (
                <div className="kquiz">
                  {ids.map((id) => <button key={id} type="button" onClick={() => reveal(id)}>{name(id)}</button>)}
                </div>
              )}
              {guess && !revealed && <div className="kwait"><span className="kspin" />{T.revealing} <N>{hhmm(time)}</N></div>}
              {guess && revealed && peak && (
                <div className="kresult">
                  <div className={`kverdict ${guess === peak.id ? "ok" : "no"}`}>{guess === peak.id ? T.right : T.wrong}</div>
                  <div className="kbig-stat">
                    <b className={over(peak.lf) ? "risk" : peak.lf > threshold * 0.85 ? "warn" : "okc"}><N>{f.pct(peak.lf)}</N></b>
                    <span>{T.busiest(name(peak.id))}<br /><N>{T.peakAt(hhmm(peak.time))}</N></span>
                  </div>
                  <div className={`kline ${over(peak.lf) ? "risk" : "okc"}`}>{over(peak.lf) ? T.overLine : T.underLine} · <N>{T.comfort(f.pct(threshold))}</N></div>
                  {brk !== null && <p className="knote"><N>{T.breakAt(f.int(brk))}</N></p>}
                  {!hot && (
                    <div className="kalt">
                      <p>{T.allClear}</p>
                      <button type="button" className="kgo ghost" onClick={tryHot} disabled={loading || scenario.weather === "hot"}>{T.tryHot}</button>
                    </div>
                  )}
                </div>
              )}
              {guess && revealed && hot && <button type="button" className="kgo" onClick={goPlan}>{T.next2} →</button>}
            </>
          )}

          {phase === "plan" && (
            <>
              <h1>{planStatus === "ready" ? T.s3Pick : T.s3Title}</h1>
              {planStatus !== "ready" && (
                <>
                  <p className="ksub">{T.s3Sub}</p>
                  <ol className="kagent">
                    {T.agentSteps.map((label, i) => (
                      <li key={label} className={i < planStep ? "done" : i === planStep ? "on" : ""}><span>{i < planStep ? "✓" : ""}</span>{label}</li>
                    ))}
                  </ol>
                </>
              )}
              {planStatus === "ready" && plan && plan.options.length === 0 && (
                <div className="kalt"><p>{T.noPlan}</p><button type="button" className="kgo ghost" onClick={again}>{T.again}</button></div>
              )}
              {planStatus === "ready" && plan && plan.options.length > 0 && before && (
                <div className="kopts">
                  {plan.options.map((o) => (
                    <article key={o.rank} className={`kopt${o.rank === 1 ? " top" : ""}`}>
                      <h2>{o.title}</h2>
                      <p>{o.what}</p>
                      <div className="kdelta">
                        <div><small>{T.peakLoad}</small><b><N>{f.pct(before.peak_lf)} → <span className={over(o.summary.peak_lf) ? "risk" : "okc"}>{f.pct(o.summary.peak_lf)}</span></N></b></div>
                        <div><small>{T.ridersOver}</small><b><N>{f.int(before.excess_pax)} → <span className={o.summary.excess_pax > 0 ? "risk" : "okc"}>{f.int(o.summary.excess_pax)}</span></N></b></div>
                      </div>
                      <div className="kcheck">✓ {T.checked}</div>
                      <button type="button" className="kgo" disabled={chosen !== null} onClick={() => void choose(o.rank)}>{T.choose}</button>
                    </article>
                  ))}
                </div>
              )}
              {planStatus === "error" && <div className="kalt"><p>{T.noPlan}</p><button type="button" className="kgo ghost" onClick={again}>{T.again}</button></div>}
            </>
          )}

          {phase === "decide" && picked && after && (
            <>
              <h1>{T.s4Title}</h1>
              <p className="kchosen">{picked.title}</p>
              <p className="ksub">{T.s4Sub}</p>
              <div className="kba">
                <div><small>{T.peakLoad}</small><span><N>{f.pct(picked.before.peak_lf)}</N></span><i>→</i><b className={over(after.peak_lf) ? "risk" : "okc"}><N>{f.pct(after.peak_lf)}</N></b></div>
                <div><small>{T.ridersOver}</small><span><N>{f.int(picked.before.excess_pax)}</N></span><i>→</i><b className={after.excess_pax > 0 ? "risk" : "okc"}><N>{f.int(after.excess_pax)}</N></b></div>
              </div>
              {visitors && visitors.n > 0 && <p className="knote"><N>{T.you(f.int(visitors.n))}</N></p>}
              <div className="kqr">
                <div className="kqr-box" aria-hidden><span /><span /><span /><span /></div>
                <div><b>{T.qrTitle}</b><small>{T.qrSoon}</small></div>
              </div>
              <div className="krow">
                <button type="button" className="kgo" onClick={again}>{T.again}</button>
                <button type="button" className="kgo ghost" onClick={reset}>{T.finish}</button>
              </div>
            </>
          )}
        </aside>
      )}

      {phase !== "attract" && ev && (
        <div className="kchip"><N>{hhmm(time)}</N> · {f.event(ev)}</div>
      )}
      <footer className="kdisc"><span>{T.disclaimer}</span><span className="kcred">{T.credits}{credits.length ? ` · ${credits.join(" · ")}` : ""}</span></footer>

      {still !== null && (
        <div className="kstill" role="alertdialog" aria-modal="true" aria-label={T.still}>
          <div>
            <b>{T.still}</b>
            <p><N>{T.stillSub(still)}</N></p>
            <button type="button" className="kgo" onClick={() => { lastTouch.current = Date.now(); setStill(null); }}>{T.stillBtn}</button>
          </div>
        </div>
      )}
    </div>
  );
}
