"use client";
// Visitor kiosk (?kiosk=1): one idea per screen, the 3D twin as the star, big targets in the lower half.
//   attract → two ways in:
//     "I'm planning the event": ① pick an event (or build your own) → ② guess the busiest station, the twin reveals
//        it, optional stress test (crowd size, metro share, a closed station) → ③ your idea first, then AI agents
//        propose plans (every number from the simulator) → ④ you approve one → before/after, you vs the AI
//     "I'm travelling to the event": the best time and station to leave from (fastest, or quieter)
//     "Show me in 60 seconds": the planner story plays by itself with captions (any touch takes over)
// Home and language are always visible; 60 s without a touch → "Still there?" (10 s) → back to the attract screen.
// Team only: hold the logo 3 s → the full workspace; hold the footer 3 s → anonymous booth statistics.
// Every number shown comes from an API answer held in the store (CLAUDE.md rule 2).
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AgentPlanResponse, type SimulateResponse } from "@/lib/api";
import { hhmm, N, useFmt, useLocale } from "@/lib/i18n";
import { SCENE_V2 } from "@/lib/manifest";
import { simulateBody } from "@/lib/requests";
import { CORRIDOR_ORDER, mergeInterventions, T_MIN, useTwin } from "@/lib/store";
import { LabelLayer } from "../LabelLayer";
import { SceneProgress } from "../SceneProgress";
import { bump, busiest, closure, ideaInterventions, IDEAS, PLAYBOOK_EVENT, playbook, QUIET_LF, readStats, riderAdvice, todayStats, type Idea } from "./logic";
import { K, type KText } from "./strings";

const TwinCanvas = dynamic(() => import("../twin/TwinCanvas"), { ssr: false });

type Phase = "attract" | "choose" | "event" | "crowd" | "plan" | "decide" | "rider";
type Summary = SimulateResponse["summary"];
type TraceEvent = NonNullable<AgentPlanResponse["trace"]>[number];
const STEP: Record<Phase, number> = { attract: -1, choose: -1, rider: -1, event: 0, crowd: 1, plan: 2, decide: 3 };
const AUTOMATIC = new Set(["guided-demo", "soak", "test", "playwright", "smoke"]);
const WEATHERS = ["normal", "hot", "rain"] as const;
const METRO_SHARES = [0.35, 0.45, 0.55, 0.65];                      // what-if request values (pricing nudge)
const OWN_TIMES: Record<string, { start: string; end: string }> = { afternoon: { start: "13:00", end: "17:00" }, evening: { start: "18:00", end: "21:00" }, night: { start: "20:00", end: "23:00" } };
const ATTRACT_CAMS = ["orbit", "fly", "orbit", "overview"] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function idleSeconds(): number {
  const v = Number(new URLSearchParams(window.location.search).get("idle"));
  return Number.isFinite(v) && v >= 5 && v <= 600 ? v : 60;
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

function Modal({ title, close, closeLabel, children }: { title: string; close: () => void; closeLabel: string; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close]);
  return (
    <div className="kstill kmodal" role="dialog" aria-modal="true" aria-label={title} onClick={close}>
      <div onClick={(e) => e.stopPropagation()}>
        <b>{title}</b>
        {children}
        <button type="button" className="kgo" onClick={close} autoFocus>{closeLabel}</button>
      </div>
    </div>
  );
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
  const cur = useTwin((s) => s.cur);
  const flows = useTwin((s) => s.flows);
  const breaks = useTwin((s) => s.breaks);
  const loading = useTwin((s) => s.loading);
  const ready = useTwin((s) => s.ready);
  const error = useTwin((s) => s.error);
  const plan = useTwin((s) => s.plan);
  const planStatus = useTwin((s) => s.planStatus);
  const planStep = useTwin((s) => s.planStep);
  const threshold = useTwin((s) => s.threshold);
  const time = useTwin((s) => s.time);
  const camMode = useTwin((s) => s.cam);
  const focus = useTwin((s) => s.focus);

  const [phase, setPhase] = useState<Phase>("attract");
  const [guess, setGuess] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [lab, setLab] = useState(false);                      // stress test open (step ②)
  const [closed, setClosed] = useState<string | null>(null);  // station closed in the drill
  const [closedTo, setClosedTo] = useState<string | null>(null);   // … and where its riders are guided
  const [own, setOwn] = useState(false);                      // "your own event" builder open (step ①)
  const [idea, setIdea] = useState<Idea | null | undefined>(undefined);   // undefined = not asked yet, null = skipped
  const [mine, setMine] = useState<Summary | "none" | null>(null);        // the visitor's idea, simulated
  const [chosen, setChosen] = useState<number | null>(null);
  // The store clears the plan once it is applied: keep what the later screens need (all from API answers).
  const [picked, setPicked] = useState<{ title: string; before: Summary; road: number | null } | null>(null);
  const [kept, setKept] = useState<AgentPlanResponse | null>(null);
  const [modal, setModal] = useState<"how" | "pb" | "stats" | null>(null);
  const [pb, setPb] = useState<Summary | "fail" | null>(null);            // reported NYE measures, simulated
  const [quiet, setQuiet] = useState(false);                  // rider advice: quieter trains instead of the fastest
  const [visitors, setVisitors] = useState<Visitors | null>(null);
  const [big, setBig] = useState(false);
  const [hc, setHc] = useState(false);
  const [reach, setReach] = useState(false);                  // every control in the lower half (seated visitors)
  const [calls, setCalls] = useState(false);                  // the tool-call list in "How the AI decided"
  const [cap, setCap] = useState<string | null>(null);        // caption of the 60-second show
  const [still, setStill] = useState<number | null>(null);    // seconds left in the "Still there?" countdown
  const [credits, setCredits] = useState<string[]>([]);
  useEffect(() => { void sceneCredits().then(setCredits); }, []);
  const lastTouch = useRef(0);                                // set on mount and on every touch
  const anim = useRef<number | null>(null);
  const show = useRef<{ cancel: boolean } | null>(null);      // the running 60-second show
  const revealedRef = useRef(false);

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
  // "the situation": the day as simulated, including a closed station from the stress test (before any approved plan)
  const peak = useMemo(() => busiest(cur, ids), [cur, ids]);
  const hot = (cur?.resp.summary.overcap_station_hours ?? 0) > 0;
  const ev = forecast?.event ?? null;
  const endOf = (e: { end: string } | null | undefined, used?: string | null) => { const x = used ?? e?.end ?? "18:00"; return Number(x.slice(0, 2)) + Number(x.slice(3, 5)) / 60; };
  const endH = endOf(ev, forecast?.end_used);
  const served = useMemo(() => ids.filter((id) => flows[id]?.out.some((x) => x > 0)), [ids, flows]);
  const advice = useMemo(() => riderAdvice(cur, served, endH, quiet, threshold), [cur, served, endH, quiet, threshold]);

  // ---- camera and clock per screen
  const animateTo = useCallback((target: number, ms = 2400) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = st.getState().time, t0 = performance.now();
    st.getState().setPlaying(false);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      st.getState().setTime(from + (target - from) * e);
      if (k < 1) anim.current = requestAnimationFrame(step); else { anim.current = null; revealedRef.current = true; setRevealed(true); }
    };
    anim.current = requestAnimationFrame(step);
  }, [st]);
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); if (show.current) show.current.cancel = true; }, []);

  useEffect(() => {
    const s = st.getState();
    if (phase === "attract") { s.setPlaying(false); s.setTime(17.5); s.setCam("orbit"); }      // golden hour, slow orbit
    if (phase === "choose" || phase === "event" || phase === "crowd") { s.setPlaying(false); s.setCam("overview"); }
  }, [phase, st]);
  // stress test and rider tip: the camera follows the answer
  useEffect(() => {
    const s = st.getState();
    if (phase === "crowd" && lab && peak) { s.select(peak.id); s.setTime(peak.time); }
    if (phase === "rider" && advice) { s.select(advice.tip.id); s.setTime(advice.tip.t); s.setCam("close"); }
  }, [phase, lab, peak, advice, st]);

  // ---- visitors counter (attract screen and after a decision)
  useEffect(() => {
    if (phase !== "attract" && phase !== "decide") return;
    let live = true;
    void todaysVisitors().then((v) => { if (live) setVisitors(v); });
    return () => { live = false; };
  }, [phase, chosen]);

  // ---- inactivity: "Still there?" then reset for the next visitor
  const clearRun = () => { setGuess(null); setRevealed(false); revealedRef.current = false; setLab(false); setClosed(null); setOwn(false); setIdea(undefined); setMine(null);
    setChosen(null); setPicked(null); setKept(null); setModal(null); setPb(null); setCalls(false); };
  const reset = useCallback(() => {
    if (anim.current) cancelAnimationFrame(anim.current);
    if (show.current) show.current.cancel = true;
    const s = st.getState();
    s.clearPlans();
    useTwin.setState({ applied: [], scenario: { ...s.scenario, weather: "normal", metroShare: null, demandLevel: null } });
    if (s.events[0]) s.selectEvent(s.events[0].id);
    clearRun(); setStill(null); setBig(false); setHc(false); setReach(false); setQuiet(false); setCap(null);
    setPhase("attract");
  }, [st]);

  useEffect(() => {
    lastTouch.current = Date.now();
    const touch = () => { lastTouch.current = Date.now(); setStill(null); if (show.current) { show.current.cancel = true; show.current = null; setCap(null); } };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const limit = idleSeconds() * 1000;
    const iv = setInterval(() => {
      if (phase === "attract" || show.current) return;
      const idle = Date.now() - lastTouch.current;
      if (idle >= limit) {
        const left = 10 - Math.floor((idle - limit) / 1000);
        if (left <= 0) reset(); else setStill(left);
      }
    }, 250);
    return () => { window.removeEventListener("pointerdown", touch); window.removeEventListener("keydown", touch); clearInterval(iv); };
  }, [phase, reset]);

  // ---- attract screen: cycle the events and the camera so the twin looks alive
  useEffect(() => {
    if (phase !== "attract" || events.length < 2) return;
    let n = 0;
    const iv = setInterval(() => {
      const s = st.getState();
      const i = s.events.findIndex((e) => e.id === s.scenario.eventId);
      s.selectEvent(s.events[(i + 1) % s.events.length].id);
      n++;
      setTimeout(() => { const x = st.getState(); x.setPlaying(false); x.setTime(17.5); x.setCam(ATTRACT_CAMS[n % ATTRACT_CAMS.length]); }, 600);   // selectEvent jumps to the peak
    }, 14_000);
    return () => clearInterval(iv);
  }, [phase, events.length, st]);

  // ---- booth safety: if the realism scene cannot hold a usable frame rate even at the lowest quality, reload on the corridor scene
  useEffect(() => {
    if (!SCENE_V2) return;
    let slow = 0;
    const iv = setInterval(() => {
      const e = window.__eft;
      if (!e?.ready || document.hidden) { slow = 0; return; }
      slow = e.tier === 2 && e.fps > 5 && e.fps < 24 ? slow + 1 : 0;       // under 5 fps = a hidden or throttled page, not a slow GPU
      if (slow >= 4) { const u = new URL(window.location.href); u.searchParams.set("scene", "v1"); window.location.replace(u.toString()); }
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  // ---- team only: hold the logo 3 s → workspace; hold the footer 3 s → booth statistics
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdLogo = () => { hold.current = setTimeout(() => useTwin.setState({ kiosk: false }), 3000); };
  const holdFoot = () => { hold.current = setTimeout(() => setModal("stats"), 3000); };
  const holdEnd = () => { if (hold.current) clearTimeout(hold.current); };

  // ---- actions
  const start = () => { bump("start"); setPhase("choose"); };
  const asPlanner = () => { bump("planner"); setPhase("event"); };
  const asRider = () => { bump("rider"); setPhase("rider"); };
  const pickEvent = (id: string) => { if (id !== scenario.eventId) { setClosed(null); st.getState().selectEvent(id); } };
  const openOwn = () => { bump("own"); setOwn(true); setClosed(null); st.getState().selectEvent("custom"); };
  const closeOwn = () => { setOwn(false); const e = st.getState().events[0]; if (e) st.getState().selectEvent(e.id); };
  const goCrowd = () => {
    setGuess(null); setRevealed(false); revealedRef.current = false; setLab(false);
    const e = st.getState().forecast?.event;
    st.getState().setTime(e ? Math.max(T_MIN, Number(e.start.slice(0, 2)) - 1) : 12);
    setPhase("crowd");
  };
  const reveal = useCallback((id: string) => {
    setGuess(id); setRevealed(false); revealedRef.current = false;
    const p = busiest(st.getState().cur, ids);
    if (!p) return;
    st.getState().select(p.id);
    st.getState().setCam("close");
    animateTo(p.time);
  }, [animateTo, ids, st]);
  const answer = (id: string) => { const p = busiest(st.getState().cur, ids); bump(p && p.id === id ? "quiz_right" : "quiz_wrong"); reveal(id); };
  // A weather change re-runs the forecast: replay the reveal on the new answer (the stress test moves the camera itself).
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "crowd" || !guess || lab || loading || !forecast) return;
    if (revealedFor.current === forecast.run_id) return;
    revealedFor.current = forecast.run_id;
    reveal(guess);
  }, [phase, guess, lab, loading, forecast, reveal]);
  const tryHot = () => { revealedFor.current = null; st.getState().patchScenario({ weather: "hot" }); };
  const openLab = () => { bump("lab"); setLab(true); };
  const closeLab = () => { revealedFor.current = st.getState().forecast?.run_id ?? null; setLab(false); revealedRef.current = true; setRevealed(true); st.getState().setCam("close"); };
  const closeStation = (id: string | null) => {
    const s = st.getState();
    const ivs = id ? closure(id, s.base, ids, Math.floor(endH)) : [];
    setClosed(id);
    setClosedTo(ivs[0]?.type === "station_metering" ? ivs[0].params.to_station ?? null : null);
    useTwin.setState({ applied: id ? [{ title: "drill", ivs }] : [] });
    s.patchScenario({});                                       // re-simulate with the station closed
  };
  const goPlan = () => { setIdea(undefined); setMine(null); setChosen(null); setPhase("plan"); };
  const pickIdea = async (i: Idea | null) => {
    setIdea(i); setMine(null);
    const s = st.getState();
    void s.runAgents(locale);
    if (!i || !s.forecast || !s.forecastReq) return;
    bump("idea");
    try {
      const ivs = mergeInterventions([...s.applied.map((a) => a.ivs), ideaInterventions(i, s.cur, ids)]);
      setMine((await api.simulate(simulateBody(s.forecast.run_id, ivs, s.threshold, s.forecastReq))).summary);
    } catch {
      setMine("none");                                         // the simulator rejected it for this scenario (for example no station within walking distance)
    }
  };
  const choose = async (rank: number, user = "visitor") => {
    const p = st.getState().plan, o = p?.options.find((x) => x.rank === rank);
    if (!p || !o) return;
    if (user === "visitor") bump("approve");
    setChosen(rank); setKept(p);
    setPicked({ title: o.title, before: p.baseline_summary, road: p.baseline_road?.peak_veh_per_hour ?? null });
    await st.getState().decide(rank, "approve", user);
    const pk = busiest(st.getState().base, ids);
    if (pk) { st.getState().select(pk.id); st.getState().setCam("close"); }
    setPhase("decide");
  };
  const again = () => { bump("done"); st.getState().clearPlans(); useTwin.setState({ applied: [] }); clearRun(); setPhase("event"); };
  const finish = () => { bump("done"); reset(); };
  const undo = () => {
    bump("undo");
    st.getState().clearPlans();
    setChosen(null); setPicked(null); setMine(null); setPb(null);
    if (closed) { setClosed(null); setLab(false); setGuess(null); setRevealed(false); setPhase("crowd"); return; }   // the drill is cleared with the plan
    setIdea(null); setPhase("plan");
    void st.getState().runAgents(locale);
  };
  const openHow = () => { bump("how"); setModal("how"); };
  const openPb = async () => {
    bump("playbook"); setModal("pb");
    const s = st.getState();
    if (pb || !s.forecast || !s.forecastReq) return;
    try {
      setPb((await api.simulate(simulateBody(s.forecast.run_id, playbook(s.base, ids), s.threshold, s.forecastReq))).summary);
    } catch { setPb("fail"); }
  };
  const saveStats = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(readStats(), null, 2)], { type: "application/json" }));
    a.download = `eventflow_kiosk_stats_${dubaiDate()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- "Show me in 60 seconds": the planner story plays by itself; any touch takes over where it stands
  const runShow = async () => {
    bump("jury");
    await sleep(50);                                           // let the starting touch pass
    const tok = { cancel: false };
    show.current = tok;
    const S = () => st.getState();
    const until = async (ok: () => boolean, max = 20_000) => { const t0 = Date.now(); while (!ok() && !tok.cancel && Date.now() - t0 < max) await sleep(150); };
    const pause = async (ms: number) => { lastTouch.current = Date.now(); const t0 = Date.now(); while (!tok.cancel && Date.now() - t0 < ms) await sleep(100); };
    try {
      setCap(T.jury[0]); setPhase("event");
      if (S().events[0]) S().selectEvent(S().events[0].id);
      await pause(900); S().patchScenario({ weather: "hot" }); await pause(600); await until(() => !S().loading); await pause(3500);
      if (tok.cancel) return;
      setCap(T.jury[1]); goCrowd(); await pause(1800);
      const p = busiest(S().cur, ids);
      if (p && !tok.cancel) { revealedFor.current = S().forecast?.run_id ?? null; reveal(p.id); await until(() => revealedRef.current); await pause(4500); }
      if (tok.cancel) return;
      setCap(T.jury[2]); setIdea(null); setMine(null); setChosen(null); setPhase("plan"); void S().runAgents(locale);
      await until(() => S().planStatus === "ready" || S().planStatus === "error"); await pause(5500);
      if (tok.cancel || S().planStatus !== "ready" || !S().plan?.options.length) return;
      setCap(T.jury[3]); await pause(2500);
      if (tok.cancel) return;
      await choose(1, "guided-demo");
      setCap(T.jury[4]); await pause(9000);
    } finally {
      if (show.current === tok) { show.current = null; setCap(null); if (!tok.cancel) reset(); }
    }
  };

  const stepIdx = STEP[phase];
  const kindName = (k: string | null) => (k ? T.kinds[k] ?? k : "");
  const before = plan?.baseline_summary ?? cur?.resp.summary ?? null;
  const after = cur?.resp.summary ?? null;
  const brk = breaks?.stations.find((s) => s.station_id === peak?.id)?.break_attendance ?? null;
  const over = (lf: number) => lf > threshold;
  const lfClass = (lf: number) => (over(lf) ? "risk" : lf > threshold * 0.85 ? "warn" : "okc");
  const att0 = events.find((e) => e.id === scenario.eventId)?.attendance ?? 20000;
  const attNow = Math.round(forecast?.attendance_used ?? att0);
  const attMin = Math.max(1000, Math.round((att0 * 0.4) / 1000) * 1000), attMax = Math.round((att0 * 2.5) / 1000) * 1000;
  const shareNow = forecast?.metro_share_used ?? null;
  const shown = plan ?? kept;                                  // the plan the "how" and comparison panels describe
  // the AI's strongest option on riders over the line (its rank 1 also weighs cost, so it is not always this one)
  const best = shown?.options.length ? [...shown.options].sort((a, b) => a.summary.excess_pax - b.summary.excess_pax || a.summary.peak_lf - b.summary.peak_lf)[0].summary : null;
  const mins = (m: number) => T.mins(f.num(m, 0));
  const hours = (paxMin: number) => f.int(paxMin / 60);
  const wait = (m: number) => (m < 0.5 ? T.rNoWait : T.rWait(f.num(m, 0)));
  const day = todayStats();
  const fact = phase === "attract" && ev && peak ? T.fact(f.event(ev), name(peak.id), f.pct(peak.lf), hhmm(peak.time)) : null;
  const road = cur?.resp.road ?? null;                         // road-pressure proxy for the situation on screen (assumption model)
  const level = scenario.demandLevel === "real_totals" ? "real_totals" : "synthetic";
  const critic = shown?.critic ?? null;
  // One line per tool call, written from the call's own data (every figure in it is the simulator's).
  const traceText = (e: TraceEvent): string => {
    const d = e.data as Record<string, unknown>;
    const num = (k: string) => f.int(Number(d[k] ?? 0));
    const kinds = [...new Set(((d.types as string[] | undefined) ?? []).map((k) => kindName(k)))].join(" + ");
    const label = d.label === "llm" ? T.tModel : d.label === "strong" ? `${kinds} (${T.tStrong})` : kinds;
    switch (e.tool) {
      case "forecast": return T.tForecast(e.run_id ?? "");
      case "simulate": return d.label === "baseline" ? T.tBase(num("excess"), f.pct(Number(d.peak_lf)))
        : T.tSim(label.charAt(0).toUpperCase() + label.slice(1), num("excess"), f.pct(Number(d.peak_lf))) + ((d.new_hotspots as string[] | undefined)?.length ? T.tMoves(name((d.new_hotspots as string[])[0])) : "");
      case "diagnose": return d.station ? T.tHot(name(String(d.station))) : T.tNoHot;
      case "propose": return d.source === "menu" ? T.tPropose(num("candidates")) : T.tProposeLlm(num("candidates"), String(d.source));
      case "check_goal": return d.verdict === "goal_met" ? T.tMet(num("meeting"), num("tested")) : d.verdict === "residual" ? T.tResidual(num("excess"), name(String(d.station ?? "")))
        : d.verdict === "no_action" ? T.tNoAction : T.tNoRelief;
      case "replan": return T.tReplan(num("candidates"));
      case "rank": return T.tRank(num("kept"), num("tested"));
      case "explain": return T.tExplain(d.source === "template" ? T.tTemplate : String(d.source));
      case "verify_numbers": return T.tVerify(num("checked"));
      default: return e.tool;
    }
  };

  return (
    <div ref={root} className={`kiosk-root${big ? " kbig" : ""}${hc ? " khc" : ""}${reach ? " kreach" : ""}`} data-testid="kiosk" data-phase={phase}>
      <div className="kmap" data-testid="view">
        <TwinCanvas label={T.attractTitle} />
        <LabelLayer />
        <SceneProgress text={T.loadingCity} />
      </div>

      <header className="ktop">
        <button type="button" className="kbrand" aria-label={T.brand} onPointerDown={holdLogo} onPointerUp={holdEnd} onPointerLeave={holdEnd}>
          <span className="klogo" aria-hidden><i /><i /><i /></span>
          <span><b>{T.brand}</b><small>{T.tagline}</small></span>
        </button>
        {stepIdx >= 0 && (
          <ol className="ksteps" aria-label="steps">
            {T.steps.map((label, i) => (
              <li key={label} className={i === stepIdx ? "on" : i < stepIdx ? "done" : ""} aria-current={i === stepIdx ? "step" : undefined}>
                <span className="kn"><N>{i < stepIdx ? "✓" : String(i + 1)}</N></span>{label}
              </li>
            ))}
          </ol>
        )}
        <div className="ktools" role="group" aria-label={T.bigText + " · " + T.contrast}>
          <button type="button" className="kpill" aria-pressed={big} onClick={() => setBig(!big)} aria-label={T.bigText}><span className="kaa">A<small>A</small></span></button>
          <button type="button" className="kpill" aria-pressed={hc} onClick={() => setHc(!hc)} aria-label={T.contrast} data-testid="kiosk-contrast"><span className="khalf" aria-hidden /></button>
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
          {fact && <span className="kat-fact" key={fact}><N>{fact}</N></span>}
          <span className="kat-count">{visitors && visitors.n > 0 ? T.today(f.int(visitors.n), kindName(visitors.top)) : T.todayNone}</span>
        </button>
      )}

      {phase !== "attract" && (
        <aside className="kcard" aria-live="polite">
          {phase === "choose" && (
            <>
              <h1>{T.cTitle}</h1>
              <div className="kways">
                <button type="button" className="kway" onClick={asPlanner} data-testid="kiosk-planner"><span className="kico" aria-hidden>◎</span><span><b>{T.cPlanner}</b><small>{T.cPlannerSub}</small></span></button>
                <button type="button" className="kway" onClick={asRider} data-testid="kiosk-rider"><span className="kico" aria-hidden>→</span><span><b>{T.cRider}</b><small>{T.cRiderSub}</small></span></button>
              </div>
              <button type="button" className="kgo ghost" onClick={() => void runShow()} data-testid="kiosk-show">▶ {T.cJury}</button>
            </>
          )}

          {phase === "event" && !own && (
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
                <button type="button" className="kevent kown" onClick={openOwn} data-testid="kiosk-own"><b>＋ {T.own}</b><span>{T.ownSub}</span></button>
              </div>
              <div className="kfield">
                <span>{T.weather}</span>
                <div className="kseg">
                  {WEATHERS.map((w) => <button key={w} type="button" aria-pressed={scenario.weather === w} onClick={() => st.getState().patchScenario({ weather: w, metroShare: null })}>{T.weathers[w]}</button>)}
                </div>
                <small>{T.weatherHint}</small>
              </div>
              <button type="button" className="kgo" disabled={!ready || loading} onClick={goCrowd}>{T.next1} →</button>
            </>
          )}

          {phase === "event" && own && (
            <>
              <h1>{T.own}</h1>
              <p className="ksub"><em className="ktag">{T.ownTag}</em> {T.ownSub}</p>
              <div className="kfield">
                <span>{T.ownNear}</span>
                <div className="kchips">{ids.map((id) => <button key={id} type="button" aria-pressed={scenario.custom.near === id} onClick={() => st.getState().patchCustom({ near: id })}>{name(id)}</button>)}</div>
              </div>
              <div className="kfield">
                <span>{T.ownCrowd}: <b><N>{f.int(attNow)}</N></b></span>
                <input type="range" className="kslider" aria-label={T.ownCrowd} min={5000} max={100000} step={1000} value={attNow}
                  onChange={(e) => st.getState().patchScenario({ attendance: Number(e.target.value) })} />
              </div>
              <div className="kfield">
                <span>{T.ownWhen}</span>
                <div className="kseg">{Object.entries(OWN_TIMES).map(([k, v]) => <button key={k} type="button" aria-pressed={scenario.custom.end === v.end} onClick={() => st.getState().patchCustom(v)}>{T.ownTimes[k]}</button>)}</div>
              </div>
              <div className="krow">
                <button type="button" className="kgo" disabled={!ready || loading} onClick={goCrowd}>{T.next1} →</button>
                <button type="button" className="kgo ghost" onClick={closeOwn}>{T.ownBack}</button>
              </div>
            </>
          )}

          {phase === "crowd" && !lab && (
            <>
              <h1>{T.s2Title}</h1>
              <p className="ksub">{T.s2Sub}</p>
              {!guess && (
                <div className="kquiz">
                  {ids.map((id) => <button key={id} type="button" onClick={() => answer(id)}>{name(id)}</button>)}
                </div>
              )}
              {guess && !revealed && <div className="kwait"><span className="kspin" />{T.revealing} <N>{hhmm(time)}</N></div>}
              {guess && revealed && peak && (
                <div className="kresult">
                  <div className={`kverdict ${guess === peak.id ? "ok" : "no"}`}>{guess === peak.id ? T.right : T.wrong}</div>
                  <div className="kbig-stat">
                    <b className={lfClass(peak.lf)}><N>{f.pct(peak.lf)}</N></b>
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
              {guess && revealed && (
                <div className="kstack">
                  <button type="button" className="kgo ghost" onClick={openLab} data-testid="kiosk-lab">{T.lab}</button>
                  {hot && <button type="button" className="kgo" onClick={goPlan}>{T.next2} →</button>}
                </div>
              )}
            </>
          )}

          {phase === "crowd" && lab && (
            <>
              <div className="khead">
                <h1>{T.labTitle}</h1>
                <button type="button" className="kpill" aria-pressed={level === "real_totals"} data-testid="kiosk-level" title={T.labLevelHint}
                  onClick={() => st.getState().patchScenario({ demandLevel: level === "real_totals" ? null : "real_totals" })}>{T.labLevels.real_totals}</button>
              </div>
              {level === "real_totals" && <small className="kroad" data-testid="kiosk-level-hint">{T.labLevelHint}</small>}
              {peak && (
                <div className="klive" data-testid="kiosk-live">
                  <b className={lfClass(peak.lf)}><N>{f.pct(peak.lf)}</N></b>
                  <span>{T.labNow(name(peak.id))} · <N>{hhmm(peak.time)}</N>{loading && <i className="kspin sm" />}</span>
                </div>
              )}
              <div className="kfield">
                <span>{T.labCrowd}: <b><N>{f.int(attNow)}</N></b></span>
                <input type="range" className="kslider" aria-label={T.labCrowd} min={attMin} max={attMax} step={1000} value={attNow} data-testid="kiosk-crowd"
                  onChange={(e) => st.getState().patchScenario({ attendance: Number(e.target.value) })} />
                {brk !== null && <small><N>{T.breakAt(f.int(brk))}</N></small>}
              </div>
              <div className="kfield">
                <span>{T.labMetro}</span>
                <div className="kseg" data-testid="kiosk-metro" role="group" aria-label={T.labMetro}>
                  {METRO_SHARES.map((v) => <button key={v} type="button" aria-pressed={shareNow !== null && Math.abs(shareNow - v) < 0.005} onClick={() => st.getState().patchScenario({ metroShare: v })}><N>{f.pct(v)}</N></button>)}
                </div>
                {road && <small className="kroad" data-testid="kiosk-road"><N>{T.road(f.int(road.peak_veh_per_hour), f.pct(road.pressure))}</N></small>}
                <small>{T.labMetroHint}</small>
              </div>
              <div className="kfield">
                <span>{T.labClose}</span>
                <div className="kchips" data-testid="kiosk-close" role="group" aria-label={T.labClose}>
                  <button type="button" aria-pressed={closed === null} onClick={() => closeStation(null)}>{T.labCloseNone}</button>
                  {ids.map((id) => <button key={id} type="button" aria-pressed={closed === id} onClick={() => closeStation(id)}>{name(id)}</button>)}
                </div>
                {closed && closedTo && !error && <small>{T.labCloseHint(name(closedTo))}</small>}
                {closed && error && <small className="risk">{T.pbFail}</small>}
              </div>
              <button type="button" className="kgo" onClick={closeLab}>{T.labBack}</button>
            </>
          )}

          {phase === "plan" && idea === undefined && (
            <>
              <h1>{T.ideaTitle}</h1>
              <p className="ksub">{T.ideaSub}</p>
              <div className="kideas">
                {IDEAS.map((i) => <button key={i} type="button" onClick={() => void pickIdea(i)} data-idea={i}><b>{T.ideas[i]}</b>{i === "loop" && <small>{T.ideaLoopNote}</small>}</button>)}
              </div>
              <button type="button" className="kgo ghost" onClick={() => void pickIdea(null)}>{T.ideaSkip}</button>
            </>
          )}

          {phase === "plan" && idea !== undefined && (
            <>
              <h1>{planStatus === "ready" ? T.s3Pick : T.s3Title}</h1>
              {planStatus !== "ready" && planStatus !== "error" && (
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
                <>
                  <div className="kyou">
                    <span>{idea && mine && mine !== "none" ? <><b>{T.yourIdea}:</b> {T.ideas[idea]} · <N>{f.pct(before.peak_lf)} → <span className={over(mine.peak_lf) ? "risk" : "okc"}>{f.pct(mine.peak_lf)}</span></N></>
                      : idea && mine === "none" ? T.vsNone : <>✓ {T.checked}</>}</span>
                    <button type="button" className="kpill" onClick={openHow} data-testid="kiosk-how">{T.how}</button>
                  </div>
                  <div className="kopts">
                    {plan.options.map((o) => (
                      <article key={o.rank} className={`kopt${o.rank === 1 ? " top" : ""}`}>
                        <h2>{o.title}{o.goal_met && <em className="kbadge ok" data-testid="kiosk-goal">{T.goalMet}</em>}{(o.round ?? 1) > 1 && <em className="kbadge">{T.replanned}</em>}</h2>
                        <p>{o.what}</p>
                        <div className="kdelta">
                          <div><small>{T.peakLoad}</small><b><N>{f.pct(before.peak_lf)} → <span className={over(o.summary.peak_lf) ? "risk" : "okc"}>{f.pct(o.summary.peak_lf)}</span></N></b></div>
                          <div><small>{T.ridersOver}</small><b><N>{f.int(before.excess_pax)} → <span className={o.summary.excess_pax > 0 ? "risk" : "okc"}>{f.int(o.summary.excess_pax)}</span></N></b></div>
                        </div>
                        <button type="button" className="kgo" disabled={chosen !== null} onClick={() => void choose(o.rank)}>{T.choose}</button>
                      </article>
                    ))}
                  </div>
                </>
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
                {picked.before.max_wait_min >= 1 && <div><small>{T.longest}</small><span><N>{mins(picked.before.max_wait_min)}</N></span><i>→</i><b className={after.max_wait_min < picked.before.max_wait_min ? "okc" : ""}><N>{mins(after.max_wait_min)}</N></b></div>}
                {picked.road !== null && road && Math.round(picked.road) !== Math.round(road.peak_veh_per_hour) && <div data-testid="kiosk-road-after"><small>{T.roadRow}</small><span><N>{f.int(picked.road)}</N></span><i>→</i><b className={road.peak_veh_per_hour < picked.road ? "okc" : ""}><N>{f.int(road.peak_veh_per_hour)}</N></b></div>}
                {picked.before.delay_pax_min >= 60 && <div><small>{T.waiting}</small><span><N>{hours(picked.before.delay_pax_min)}</N></span><i>→</i><b className={after.delay_pax_min < picked.before.delay_pax_min ? "okc" : ""}><N>{hours(after.delay_pax_min)}</N></b></div>}
              </div>
              {idea && mine && best && (
                <p className="kvs" data-testid="kiosk-vs">
                  {mine === "none" ? T.vsNone : mine.excess_pax > best.excess_pax ? <N>{T.vsLose(f.int(mine.excess_pax - best.excess_pax))}</N> : mine.excess_pax < best.excess_pax ? T.vsBeat : T.vsWin}
                </p>
              )}
              {visitors && visitors.n > 0 && <p className="knote"><N>{T.you(f.int(visitors.n))}</N></p>}
              <div className="klinks">
                <button type="button" className="kpill" onClick={undo} data-testid="kiosk-undo">↶ {T.undo}</button>
                <button type="button" className="kpill" onClick={openHow}>{T.how}</button>
                {scenario.eventId === PLAYBOOK_EVENT && <button type="button" className="kpill" onClick={() => void openPb()} data-testid="kiosk-pb">{T.pbBtn}</button>}
                <button type="button" className="kpill" onClick={asRider}>{T.toRider}</button>
              </div>
              <div className="kqr">
                <div className="kqr-box" aria-hidden><span /><span /><span /><span /></div>
                <div><b>{T.qrTitle}</b><small>{T.qrSoon}</small></div>
              </div>
              <div className="krow">
                <button type="button" className="kgo" onClick={again}>{T.again}</button>
                <button type="button" className="kgo ghost" onClick={finish}>{T.finish}</button>
              </div>
            </>
          )}

          {phase === "rider" && (
            <>
              <h1>{T.rTitle}</h1>
              <p className="ksub">{T.rSub}</p>
              <div className="kevents">
                {events.map((e) => (
                  <button key={e.id} type="button" className="kevent ksm" aria-pressed={e.id === scenario.eventId} onClick={() => pickEvent(e.id)}>
                    <b>{f.event(e)}</b>
                  </button>
                ))}
              </div>
              <div className="kfield">
                <div className="kseg" data-testid="kiosk-mode">
                  <button type="button" aria-pressed={!quiet} onClick={() => setQuiet(false)}>{T.rModes.fast}</button>
                  <button type="button" aria-pressed={quiet} onClick={() => setQuiet(true)}>{T.rModes.quiet}</button>
                </div>
                <small><N>{T.rQuietHint(f.pct(QUIET_LF))}</N></small>
              </div>
              {loading && !advice && <div className="kwait"><span className="kspin" />{T.revealing}</div>}
              {advice && (
                <div className="kadvice" data-testid="kiosk-advice">
                  <div className="worst"><small>{T.rWorst}</small><b><N>{T.rSlot(name(advice.worst.id), advice.worst.time)}</N></b>
                    <span><N>{wait(advice.worst.wait)} · <span className={lfClass(advice.worst.lf)}>{T.rFull(f.pct(advice.worst.lf))}</span></N></span></div>
                  <div className="tip"><small>{T.rTip}</small><b><N>{T.rSlot(name(advice.tip.id), advice.tip.time)}</N></b>
                    <span><N>{wait(advice.tip.wait)} · <span className={lfClass(advice.tip.lf)}>{T.rFull(f.pct(advice.tip.lf))}</span></N></span></div>
                </div>
              )}
              <p className="knote">{T.rNote}</p>
              <div className="krow">
                <button type="button" className="kgo" onClick={finish}>{T.finish}</button>
                <button type="button" className="kgo ghost" onClick={asPlanner}>{T.rPlanner}</button>
              </div>
            </>
          )}
        </aside>
      )}

      {phase !== "attract" && camMode === "landmark" && focus && T.lmNames[focus] && (
        <div className="klm" data-testid="kiosk-landmark" role="status">
          <small>{T.lmView}</small>
          <b>{T.lmNames[focus]}</b>
          <p>{T.lmLines[focus]}</p>
          <button type="button" className="kpill" onClick={() => st.getState().setCam("overview")}>{T.lmBack}</button>
        </div>
      )}
      {phase !== "attract" && phase !== "choose" && ev && (
        <div className="kchip"><N>{hhmm(time)}</N> · {f.event(ev)}</div>
      )}
      <button type="button" className="kreachbtn" aria-pressed={reach} aria-label={T.reach} title={T.reach} onClick={(e) => { e.stopPropagation(); setReach(!reach); }} data-testid="kiosk-reach">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v13" /><path d="m6 12 6 6 6-6" /><path d="M5 21h14" /></svg>
      </button>
      {cap && <div className="kcap" role="status" data-testid="kiosk-caption"><b>{cap}</b><small>{T.juryStop}</small></div>}
      <footer className="kdisc" onPointerDown={holdFoot} onPointerUp={holdEnd} onPointerLeave={holdEnd}>
        <span>{T.disclaimer}</span><span className="kcred">{T.credits}{credits.length ? ` · ${credits.join(" · ")}` : ""}</span>
      </footer>

      {modal === "how" && shown && (
        <Modal title={T.howTitle} close={() => setModal(null)} closeLabel={T.close}>
          <p className="ksub">{shown.planner && !/template|deterministic|offline/i.test(shown.planner) ? T.howLive(shown.planner) : T.howOffline}</p>
          {typeof shown.hotspot?.station === "string" && <p className="knote">{T.howTarget(name(shown.hotspot.station))}</p>}
          <ol className="ktrace" data-testid="kiosk-trace">
            {(shown.steps ?? []).map((s, i) => <li key={s.key}><span><N>{String(i + 1)}</N></span><div><b>{s.label}</b>{s.detail && <small><N>{s.detail}</N></small>}</div></li>)}
          </ol>
          {critic && (
            <p className="kcritic" data-testid="kiosk-critic">
              <N>{shown.options.length === 0 ? T.criticNone : critic.goal_met_ranks?.length ? T.criticMet : T.criticNot(f.int(Number(critic.residual?.excess_pax ?? 0)))}</N>
              <small><N>{(critic.rounds ?? 1) > 1 ? T.howRounds(f.int(critic.rounds ?? 1), f.int(critic.simulations ?? 0)) : T.howRound1(f.int(critic.simulations ?? 0))}</N></small>
            </p>
          )}
          <p className={`kline ${shown.verify.all_matched ? "okc" : "risk"}`}><N>{shown.verify.all_matched ? T.howVerify(f.int(shown.verify.numbers_checked)) : T.howVerifyBad}</N></p>
          {(shown.trace?.length ?? 0) > 0 && (
            <>
              <button type="button" className="kpill" onClick={() => setCalls(!calls)} aria-expanded={calls} data-testid="kiosk-calls-btn">{calls ? T.traceClose : T.traceOpen(f.int(shown.trace!.length))}</button>
              {calls && (
                <ol className="kcalls" data-testid="kiosk-calls">
                  {shown.trace!.flatMap((e, i, all) => [
                    ...(i === 0 || all[i - 1].round !== e.round ? [<li key={`r${e.round}`} className="rd"><N>{T.traceRound(f.int(e.round))}</N></li>] : []),
                    <li key={e.n} className={e.role}><span><N>{f.int(e.n)}</N></span><b>{T.roles[e.role] ?? e.role}</b><span><N>{traceText(e)}</N></span><small><N>{e.ms >= 1 ? `${f.num(e.ms, 0)} ms` : ""}</N></small></li>,
                  ])}
                </ol>
              )}
            </>
          )}
        </Modal>
      )}
      {modal === "pb" && (
        <Modal title={T.pbTitle} close={() => setModal(null)} closeLabel={T.close}>
          <ul className="kpb">{T.pbItems.map((x) => <li key={x}>{x}</li>)}</ul>
          {pb === null && <div className="kwait"><span className="kspin" />{T.pbRunning}</div>}
          {pb === "fail" && <p className="knote">{T.pbFail}</p>}
          {pb && pb !== "fail" && picked && (
            <table className="kcmp" data-testid="kiosk-pb-table">
              <thead><tr><th /><th>{T.noPlanCol}</th><th>{T.pbCol}</th><th>{T.aiBest}</th></tr></thead>
              <tbody>
                <tr><th>{T.peakLoad}</th><td><N>{f.pct(picked.before.peak_lf)}</N></td><td><N>{f.pct(pb.peak_lf)}</N></td><td><N>{best ? f.pct(best.peak_lf) : "—"}</N></td></tr>
                <tr><th>{T.ridersOver}</th><td><N>{f.int(picked.before.excess_pax)}</N></td><td><N>{f.int(pb.excess_pax)}</N></td><td><N>{best ? f.int(best.excess_pax) : "—"}</N></td></tr>
                <tr><th>{T.longest}</th><td><N>{mins(picked.before.max_wait_min)}</N></td><td><N>{mins(pb.max_wait_min)}</N></td><td><N>{best ? mins(best.max_wait_min) : "—"}</N></td></tr>
              </tbody>
            </table>
          )}
          <p className="ksrc">{T.pbSource}</p>
        </Modal>
      )}
      {modal === "stats" && (
        <Modal title={T.statsTitle} close={() => setModal(null)} closeLabel={T.close}>
          {Object.keys(day).length === 0 ? <p className="knote">{T.statsNone}</p> : (
            <table className="kcmp" data-testid="kiosk-stats"><tbody>
              {Object.entries(T.statsNames).filter(([k]) => day[k]).map(([k, label]) => <tr key={k}><th>{label}</th><td><N>{f.int(day[k])}</N></td></tr>)}
            </tbody></table>
          )}
          <button type="button" className="kgo ghost" onClick={saveStats}>{T.statsSave}</button>
        </Modal>
      )}

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
