"use client";
// All twin state in one zustand store: scenario → forecast → simulation (no plans / with approved plans) →
// agent plan → human decisions. Every number on screen is read from an API response held here; the UI only
// interpolates between 15-minute bins for animation.
import { create } from "zustand";
import {
  api, ApiError, setFallbackListener, type AgentPlanResponse, type BreakpointResponse, type Constraints, type EventInfo, type ForecastRequest, type ForecastResponse,
  type Intervention, type MessageResponse, type Mission, type ShiftStep, type SimulateResponse, type Station,
  type AgentEvent, type CheckpointAnswer, type CheckpointPause, type FeedbackResponse, type MemoryResponse, type ReasonCode,
} from "./api";
import { paceFor, stationOf, stepOf } from "./mission";
import { LANDMARK_STATION, type LandmarkKey } from "./landmarks";
import { MIN_TIER } from "./manifest";
import { breakpointBody, forecastBody, messageBody, missionBody, planBody, shiftBody, simulateBody, type LoopAsk, type PlanBrief, type Priority, type Scenario, type Weather } from "./requests";

export type { Priority, Scenario, Weather };
export type CamMode = "overview" | "close" | "top" | "fly" | "orbit" | "landmark" | "free";
export type Tab = "station" | "ai" | "team" | "build" | "alerts" | "report";
export type LayerKey = "buildings" | "landmarks" | "trains" | "traffic" | "flows" | "labels";
export type Decision = "approve" | "reject";

const LOG_MAX = 200;                 // the on-screen decision log is bounded (the server keeps the full audit trail)
export const CORRIDOR_ORDER = ["MAX", "WTC", "EMT", "FIC", "BKD", "BBY"];
export const T_MIN = 5, T_MAX = 23.75;
export const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);

export interface StationSeries {
  lf: Float32Array;        // load factor per 15-min bin
  demandH: number[];       // riders per hour
  capH: number[];          // capacity per hour
  peakH: number[];         // peak load factor within the hour
  overH: number[];         // over-threshold bins within the hour
  tph: number[];           // trains per hour
}
export interface SimView { resp: SimulateResponse; by: Record<string, StationSeries>; bph: number; thr: number }

export function buildView(resp: SimulateResponse): SimView {
  const bph = resp.summary.bins_per_hour;
  const by: Record<string, StationSeries> = {};
  const get = (id: string) => (by[id] ??= {
    lf: new Float32Array(24 * bph), demandH: Array(24).fill(0), capH: Array(24).fill(0), peakH: Array(24).fill(0),
    overH: Array(24).fill(0), tph: Array(24).fill(0),
  });
  for (const r of resp.rows) get(r.station_id).lf[r.bin] = r.load_factor;
  for (const r of resp.hourly) {
    const s = get(r.station_id);
    s.demandH[r.hour] = r.demand; s.capH[r.hour] = r.capacity; s.peakH[r.hour] = r.peak_lf;
    s.overH[r.hour] = r.overcap_bins; s.tph[r.hour] = r.trains_per_hour ?? 0;
  }
  return { resp, by, bph, thr: resp.summary.threshold ?? 0.85 };
}

/** Load factor at a fractional hour: linear interpolation between the two nearest 15-minute bins. */
export function lfAt(v: SimView | null, id: string, t: number): number {
  const s = v?.by[id];
  if (!v || !s) return 0;
  const n = s.lf.length, x = t * v.bph - 0.5;
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(x))), i1 = Math.min(n - 1, i0 + 1);
  const f = Math.max(0, Math.min(1, x - i0));
  return s.lf[i0] + (s.lf[i1] - s.lf[i0]) * f;
}
export const hourOf = (t: number) => Math.max(0, Math.min(23, Math.floor(t)));

export interface Alert { id: string; hour: number; lf: number }
export function alertsOf(v: SimView | null, ids: string[]): Alert[] {
  if (!v) return [];
  const out: Alert[] = [];
  for (const id of ids) v.by[id]?.overH.forEach((n, h) => { if (n > 0) out.push({ id, hour: h, lf: v.by[id].peakH[h] }); });
  return out.sort((a, b) => b.lf - a.lf);
}
export function overStations(v: SimView | null): Set<string> {
  const s = new Set<string>();
  if (v) for (const id in v.by) if (v.by[id].overH.some((n) => n > 0)) s.add(id);
  return s;
}
/** Busiest station and moment of the day (centre of the 15-minute bin with the highest load factor). */
function peakOf(v: SimView, ids: string[]): { id: string; hour: number; time: number } {
  let best = { id: ids[0], hour: 18, time: 18.5 }, top = -1;
  for (const id of ids) v.by[id]?.lf.forEach((p, b) => {
    const t = (b + 0.5) / v.bph;
    if (t >= T_MIN && p > top) { top = p; best = { id, hour: Math.floor(t), time: t }; }
  });
  return best;
}
/** Hours the "My plan" actions apply to: every hour with a station over the threshold, else the day's peak hour. */
export function hotHours(v: SimView | null, ids: string[]): number[] {
  if (!v) return [];
  const set = new Set<number>();
  for (const id of ids) v.by[id]?.overH.forEach((n, h) => { if (n > 0) set.add(h); });
  return set.size ? [...set].sort((a, b) => a - b) : [peakOf(v, ids).hour];
}

export function mergeInterventions(lists: Intervention[][]): Intervention[] {
  const seen = new Set<string>();
  const out: Intervention[] = [];
  let stagger: Intervention | null = null;
  for (const iv of lists.flat()) {
    if (iv.type === "staggered_exit") {            // two staggers never stack: keep the wider one
      if (!stagger || iv.params.spread_minutes > (stagger as typeof iv).params.spread_minutes) stagger = iv;
      continue;
    }
    const key = JSON.stringify(iv);
    if (!seen.has(key)) { seen.add(key); out.push(iv); }
  }
  return stagger ? [stagger, ...out] : out;
}

export interface BuildState {
  headway: number; wayShare: number; wayFrom: string; wayTo: string; buses: number; busFrom: string; busTo: string;
  rt: number; rtAt: string; stag: number;
  /** Entry metering: 0 off, 95/85/75 = admit up to that % load, -1 = station closed. meterTo "" = wait outside. */
  meterLoad: number; meterAt: string; meterTo: string;
  /** Extended service hours after midnight: 0 off, 1 = until 01:00, 3 = until 03:00. */
  ext: number;
}
export const BUILD0: BuildState = { headway: 0, wayShare: 0, wayFrom: "EMT", wayTo: "FIC", buses: 0, busFrom: "EMT", busTo: "BKD", rt: 0, rtAt: "EMT", stag: 0,
  meterLoad: 0, meterAt: "WTC", meterTo: "", ext: 0 };

export function buildInterventions(b: BuildState, cur: SimView | null, ids: string[]): Intervention[] {
  const hrs = hotHours(cur, ids);
  const win = [...new Set(hrs.flatMap((h) => [h - 1, h, h + 1]))].filter((h) => h >= 0 && h <= 23).sort((x, y) => x - y);
  const iv: Intervention[] = [];
  if (b.stag) iv.push({ type: "staggered_exit", params: { spread_minutes: b.stag } });
  if (b.headway) iv.push({ type: "extra_trains", params: { headway_min: b.headway, hours: win, line: "Red" } });
  if (b.wayShare > 0 && b.wayFrom !== b.wayTo) iv.push({ type: "wayfinding_redirect", params: { from_station: b.wayFrom, to_station: b.wayTo, share: b.wayShare / 100, hours: hrs } });
  if (b.buses > 0 && b.busFrom !== b.busTo) iv.push({ type: "shuttle_bus", params: { from_station: b.busFrom, to_station: b.busTo, buses: b.buses, hours: hrs } });
  if (b.rt > 0) iv.push({ type: "robotaxi_staging", params: { station: b.rtAt, vehicles: b.rt, hours: hrs } });
  if (b.meterLoad !== 0) iv.push({ type: "station_metering", params: {
    station: b.meterAt, max_load: b.meterLoad < 0 ? 0 : b.meterLoad / 100, hours: hrs, ...(b.meterTo ? { to_station: b.meterTo } : {}) } });
  if (b.ext > 0) iv.push({ type: "extended_hours", params: { line: "Red", hours: b.ext === 1 ? [0] : [0, 1, 2], headway_min: 10 } });
  return iv;
}

export interface LogEntry { ts: string; kind: Decision | "reset"; title?: string }
/** One entry of the duty shift's inbox, kept for the end-of-shift summary and the operations brief. */
export interface ShiftItem { hour: number; stations: string[]; title: string | null; decision: "approve" | "reject" | "none";
  overBefore: number; overAfter: number | null; planId: string | null; runId: string | null; ts: string }
export interface ShiftState { status: "idle" | "running" | "awaiting" | "done" | "error"; step: ShiftStep | null; handled: string[];
  hour: number; items: ShiftItem[]; error: string | null }
export const SHIFT0: ShiftState = { status: "idle", step: null, handled: [], hour: 5, items: [], error: null };
export interface Applied { title: string; ivs: Intervention[] }
/** What the brief card hands the store once the planner confirms (every field already edited or removed by them). */
/** A rejection's reason, as the reason form collects it. */
export interface RejectReason { codes: ReasonCode[]; words: string; avoid: string[]; protect: string[] }
export interface BriefApply { eventId: string | null; custom: Scenario["custom"] | null; attendance: number | null; weather: Weather;
  threshold: number | null; priority: Priority | null; constraints: Constraints; brief: PlanBrief }

interface State {
  ready: boolean; loading: boolean; error: string | null; apiDown: boolean;
  stations: Station[]; events: EventInfo[];
  scenario: Scenario; threshold: number; priority: Priority;
  forecast: ForecastResponse | null; forecastReq: ForecastRequest | null; base: SimView | null; cur: SimView | null;
  breaks: BreakpointResponse | null;     // at what crowd size each station crosses the threshold (POST /breakpoint)
  flows: Record<string, { out: number[]; in: number[] }>;
  applied: Applied[];
  plan: AgentPlanResponse | null; planStatus: "idle" | "running" | "ready" | "error" | "paused"; planStep: number; planError: string | null;
  mission: Mission | null;            // the agent team's run behind `plan` (POST /agent/run); null when only /agent/plan answered
  missionShown: number;               // how many of its events have been played back on screen so far
  missionLive: AgentEvent[] | null;   // agent events received so far from the live stream (before the mission is complete)
  missionSkip: boolean;               // a visitor skipped the playback: show the rest at once
  constraints: Constraints;           // the planner's typed constraints (never taken from free text)
  planBrief: PlanBrief | null;        // the brief the planner confirmed (contract 1.16.0); null once the scenario is changed by hand
  // the agentic loop (contract 1.16.0, decision #144)
  askMe: boolean;                     // the team stops and asks at its checkpoints (workspace only; the kiosk never pauses)
  answers: CheckpointAnswer[];        // the human's answers for the plan being made, replayed in order
  pause: CheckpointPause | null;      // the team's question while planStatus is "paused"
  feedback: { round: number; changes: FeedbackResponse["changes"] } | null;   // the last rejection's reason and what it changed
  memory: MemoryResponse | null;      // what the decision log remembers about this planner's rejections (suggestions)
  loopError: string | null;
  drafts: MessageResponse | null;     // the messenger's drafts for the last approved option (never sent)
  shift: ShiftState;                  // the duty shift on autopilot (POST /shift/next); its state lives here, the API keeps none
  brief: boolean;                     // the operations brief is open (a printable page over the app)
  decisions: Record<number, Decision>; decisionError: string | null;
  build: BuildState; preview: SimView | null; previewError: string | null;
  log: LogEntry[];
  time: number; playing: boolean; speed: number;
  selected: string; tab: Tab; view: "3d" | "table"; layers: Record<LayerKey, boolean>;
  cam: CamMode; lastCam: Exclude<CamMode, "free">; camNonce: number;
  kiosk: boolean; tourStep: number | null; sceneReady: boolean; glFailed: boolean; reducedMotion: boolean;
  focus: string | null;               // landmark the camera is framing
  expanded: boolean;                  // side panels folded away so the 3D twin fills the screen
  tier: 0 | 1 | 2;                    // automatic quality tier (0 = full; see TwinCanvas)
  fpsOverride: number | null;         // test hook for the quality tier

  init: () => Promise<void>;
  selectEvent: (id: string) => void;
  patchScenario: (p: Partial<Scenario>) => void;
  patchCustom: (p: Partial<Scenario["custom"]>) => void;
  setThreshold: (v: number) => void;
  setPriority: (p: Priority) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  select: (id: string, opts?: { tab?: boolean; fly?: boolean }) => void;
  setCam: (c: CamMode) => void;
  recentre: () => void;
  focusLandmark: (key: string) => void;
  runAgents: (locale: "en" | "ar", opts?: { loop?: boolean }) => Promise<void>;
  /** The language was switched: ask again, in the new language, for the plan or duty-shift step on screen. */
  relocalise: (locale: "en" | "ar") => Promise<void>;
  setConstraints: (c: Partial<Constraints>) => void;
  /** The planner confirmed a brief: set the scenario, the comfort line, priority and typed constraints from it, then run the team. */
  applyBrief: (b: BriefApply, locale: "en" | "ar") => Promise<void>;
  setAskMe: (v: boolean) => void;
  /** The human answers the team's question; the team runs again with every answer so far and goes on. */
  answerCheckpoint: (a: CheckpointAnswer, locale: "en" | "ar") => Promise<void>;
  /** Reject an option with a reason: logged, read into constraints, and the team replans with them. */
  rejectWithReason: (rank: number, r: RejectReason, locale: "en" | "ar") => Promise<void>;
  loadMemory: (user?: string) => Promise<void>;
  skipMission: () => void;
  decide: (rank: number, d: Decision, user?: string) => Promise<void>;
  setIncident: (i: Scenario["incident"]) => void;
  startShift: (locale: "en" | "ar") => Promise<void>;
  shiftDecide: (d: "approve" | "reject" | "none", locale: "en" | "ar", rank?: number) => Promise<void>;
  stopShift: () => void;
  patchBuild: (p: Partial<BuildState>) => void;
  approveMine: (title: string) => Promise<void>;
  clearPlans: () => void;
  jumpTo: (id: string, hour: number) => void;
}

const corridorIds = (s: State) => s.stations.map((x) => x.id);
let runSeq = 0;                                   // which runAgents call is current (a newer run or scenario stops the older loop)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let reqId = 0, refreshTimer: ReturnType<typeof setTimeout> | null = null, previewTimer: ReturnType<typeof setTimeout> | null = null;
let abort: AbortController | null = null, previewAbort: AbortController | null = null;
let shiftLocale: "en" | "ar" = "en";          // the language the running duty shift was started in (its next missions use it)
let lastPlan: { runId: string; applied: unknown[]; threshold: number; priority: Priority; req: ForecastRequest; constraints: Constraints; brief: PlanBrief | null } | null = null;   // what the plan on screen was asked with (asked again if the language changes)

export const useTwin = create<State>((set, get) => {
  /** scenario → /forecast → /simulate (no plans) → /simulate (approved plans). Stale answers are dropped. */
  async function refresh(opts: { forecast: boolean; jump?: boolean }) {
    const id = ++reqId;
    abort?.abort();
    abort = new AbortController();
    const { signal } = abort;
    set({ loading: true, error: null });
    try {
      const s = get();
      const spec = opts.forecast || !s.forecast || !s.forecastReq ? forecastBody(s.scenario) : s.forecastReq;
      const fc = opts.forecast || !s.forecast ? await api.forecast(spec, signal) : s.forecast;
      const ivs = mergeInterventions(get().applied.map((a) => a.ivs));
      const [baseR, curR, breaks] = await Promise.all([
        api.simulate(simulateBody(fc.run_id, [], get().threshold, spec), signal),
        ivs.length ? api.simulate(simulateBody(fc.run_id, ivs, get().threshold, spec), signal) : null,
        api.breakpoint(breakpointBody(fc.run_id, get().threshold, spec), signal).catch(() => null),   // optional panel
      ]);
      if (id !== reqId) return;
      const base = buildView(baseR), cur = curR ? buildView(curR) : base;
      const flows: State["flows"] = {};
      for (const r of fc.rows) {
        const f = (flows[r.station_id] ??= { out: Array(24).fill(0), in: Array(24).fill(0) });
        f.out[r.hour] = r.event_entries_p50; f.in[r.hour] = r.event_exits_p50 ?? 0;
      }
      const patch: Partial<State> = { forecast: fc, forecastReq: spec, base, cur, breaks, flows, loading: false, ready: true, plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {}, planError: null,
        ...(opts.forecast ? { shift: SHIFT0 } : {}) };          // a new scenario ends the duty shift that was running on the old one
      if (opts.jump) {
        const pk = peakOf(base, corridorIds(get()));
        Object.assign(patch, { time: Math.min(T_MAX, pk.time), selected: pk.id, camNonce: get().camNonce + 1 });
      }
      set(patch);
      schedulePreview();
    } catch (e) {
      if ((e as Error).name === "AbortError" || id !== reqId) return;
      set({ loading: false, error: e instanceof ApiError ? e.detail : (e as Error).message });
    }
  }
  function schedule(opts: { forecast: boolean; jump?: boolean }, delay = 250) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(opts), delay);
  }
  /** "My plan": live /simulate of approved plans + the builder's actions, debounced 250 ms. */
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const s = get();
      const ivs = buildInterventions(s.build, s.cur, corridorIds(s));
      previewAbort?.abort();
      if (!ivs.length || !s.forecast || !s.forecastReq) { set({ preview: null, previewError: null }); return; }
      previewAbort = new AbortController();
      try {
        const all = mergeInterventions([...s.applied.map((a) => a.ivs), ivs]);
        const r = await api.simulate(simulateBody(s.forecast.run_id, all, s.threshold, s.forecastReq), previewAbort.signal);
        set({ preview: buildView(r), previewError: null });
      } catch (e) {
        if ((e as Error).name !== "AbortError") set({ preview: null, previewError: e instanceof ApiError ? e.detail : (e as Error).message });
      }
    }, 250);
  }
  async function applyPlan(title: string, ivs: Intervention[]) {
    const s = get();
    const applied = [...s.applied, { title, ivs }];
    set({ applied, plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {}, build: { ...s.build, headway: 0, wayShare: 0, buses: 0, rt: 0, stag: 0, meterLoad: 0, ext: 0 }, preview: null });
    try {
      const r = await api.simulate(simulateBody(s.forecast!.run_id, mergeInterventions(applied.map((a) => a.ivs)), s.threshold, s.forecastReq!));
      set({ cur: buildView(r) });
    } catch (e) {
      set({ applied: s.applied, decisionError: e instanceof ApiError ? e.detail : (e as Error).message });
    }
  }

  /** The next step of the duty shift: the clock runs to the Watcher's next alert and the team's option waits for a
   *  decision. Nothing is applied here; `shiftDecide` logs the human's decision first. */
  async function shiftNext(locale: "en" | "ar") {
    const s = get();
    if (!s.forecast || !s.forecastReq) return;
    try {
      const step = await api.shiftNext(shiftBody(s.forecast.run_id, s.threshold, s.forecastReq, mergeInterventions(s.applied.map((a) => a.ivs)), s.shift.handled, s.shift.hour, locale));
      const now = get();
      if (now.shift.status !== "running" || now.forecast !== s.forecast) return;       // stopped, or the scenario changed meanwhile
      if (step.done) { set({ shift: { ...now.shift, status: "done", step } }); return; }
      const first = step.alerts[0];
      set({ shift: { ...now.shift, status: "awaiting", step, hour: step.hour }, playing: false, time: Math.max(T_MIN, Math.min(T_MAX, step.hour + 0.02)),
        ...(first ? { selected: first.station } : {}),
        ...(step.mission ? { mission: step.mission, plan: step.mission.plan, missionShown: step.mission.events.length, missionSkip: true, planStatus: "ready" as const, planStep: 8, decisions: {} } : {}) });
    } catch (e) {
      set({ shift: { ...get().shift, status: "error", error: e instanceof ApiError ? e.detail : (e as Error).message } });
    }
  }

  return {
    ready: false, loading: true, error: null, apiDown: false,
    stations: [], events: [],
    scenario: { eventId: "", attendance: null, exitSigma: null, weather: "normal", custom: { near: "FIC", start: "19:00", end: "22:00", weekend: false } },
    threshold: 0.85, priority: "balanced",
    forecast: null, forecastReq: null, base: null, cur: null, breaks: null, flows: {},
    applied: [], plan: null, mission: null, missionShown: 0, missionLive: null, drafts: null, planStatus: "idle", planStep: -1, planError: null, decisions: {}, decisionError: null,
    shift: SHIFT0, brief: false,
    build: BUILD0, preview: null, previewError: null, log: [],
    time: 15.5, playing: false, speed: 1,
    selected: "WTC", tab: "station", view: "3d",
    layers: { buildings: true, landmarks: true, trains: true, traffic: true, flows: true, labels: true },
    cam: "overview", lastCam: "overview", camNonce: 0,
    missionSkip: false, constraints: { forbid_types: [], protect_stations: [], cost_cap: null }, planBrief: null,
    askMe: false, answers: [], pause: null, feedback: null, memory: null, loopError: null,
    kiosk: false, tourStep: null, sceneReady: false, glFailed: false, reducedMotion: false,
    focus: null, expanded: false, tier: MIN_TIER, fpsOverride: null,

    init: async () => {
      setFallbackListener((down) => { if (get().apiDown !== down) set({ apiDown: down }); });
      try {
        const [st, ev] = await Promise.all([api.stations(), api.events()]);
        const corridor = CORRIDOR_ORDER.map((id) => st.find((s) => s.id === id)).filter((s): s is Station => !!s);
        set({ stations: corridor, events: ev, scenario: { ...get().scenario, eventId: ev[0]?.id ?? "custom" } });
        await refresh({ forecast: true, jump: true });
      } catch (e) {
        set({ loading: false, error: e instanceof ApiError ? e.detail : (e as Error).message });
      }
    },
    selectEvent: (id) => {
      const s = get();
      set({ scenario: { ...s.scenario, eventId: id, attendance: null, exitSigma: null, metroShare: null, demandLevel: null, incident: null }, planBrief: null, applied: [], plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {}, build: BUILD0, preview: null });
      schedule({ forecast: true, jump: true }, 0);
    },
    patchScenario: (p) => { set({ scenario: { ...get().scenario, ...p }, planBrief: null }); schedule({ forecast: true }); },
    patchCustom: (p) => {
      const s = get().scenario;
      set({ scenario: { ...s, custom: { ...s.custom, ...p } }, planBrief: null, applied: [], plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle" });
      schedule({ forecast: true, jump: true });
    },
    setThreshold: (v) => { set({ threshold: v }); schedule({ forecast: false }); },
    setPriority: (p) => set({ priority: p, plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {} }),
    setTime: (t) => set({ time: Math.max(T_MIN, Math.min(T_MAX, t)) }),
    setPlaying: (p) => set((s) => ({ playing: p, time: p && s.time >= T_MAX - 0.05 ? T_MIN : s.time })),
    select: (id, opts) => set((s) => ({ selected: id, tab: opts?.tab ? "station" : s.tab, camNonce: s.camNonce + (opts?.fly && s.cam === "close" ? 1 : 0) })),
    setCam: (c) => set((s) => ({ cam: c, lastCam: c === "free" ? s.lastCam : c, focus: c === "landmark" ? s.focus : null, camNonce: s.camNonce + 1 })),
    /** Fly to a landmark and frame it with its surroundings. */
    focusLandmark: (key) => set((s) => ({ cam: "landmark", lastCam: "landmark", focus: key, view: "3d", camNonce: s.camNonce + 1,
      selected: LANDMARK_STATION[key as LandmarkKey] ?? s.selected })),
    /** Back to the framing of the last chosen preset after dragging, panning or zooming away. */
    recentre: () => set((s) => ({ cam: s.lastCam, view: "3d", camNonce: s.camNonce + 1 })),

    runAgents: async (locale, opts) => {
      if (!opts?.loop) set({ answers: [], feedback: null });                  // a new plan: no answers or feedback carried over
      const s = get();
      if (s.planStatus === "running" || !s.forecast || !s.forecastReq) return;
      set({ planStatus: "running", planStep: 0, plan: null, mission: null, missionShown: 0, missionLive: null, drafts: null, missionSkip: false, planError: null, decisions: {}, pause: null, loopError: null });
      const ask: LoopAsk | null = s.kiosk ? null : { checkpoints: s.askMe ? ["hotspot", "partial"] : [], answers: s.answers };
      const mySeq = ++runSeq;
      const applied = mergeInterventions(s.applied.map((a) => a.ivs));
      lastPlan = { runId: s.forecast.run_id, applied, threshold: s.threshold, priority: s.priority, req: s.forecastReq, constraints: s.constraints, brief: s.planBrief };
      // The agent team first (events, checks, stress tests); the single planner if the team cannot answer.
      let mission: Mission | null = null, plan: AgentPlanResponse | null = null, err: string | null = null;
      // Workspace: the live stream. Events are shown as they arrive, never before (paced so they can be read); the
      // kiosk keeps its recorded walk-through below.
      if (!s.kiosk) {
        const live: AgentEvent[] = [];
        let done = false, failed = false, shown = 0, step = 0;
        const p = api.agentRunStream(missionBody(s.forecast.run_id, applied, s.threshold, s.priority, locale, s.forecastReq, s.constraints, s.planBrief, ask),
          (e) => { live.push(e); if (runSeq === mySeq) set({ missionLive: live.slice() }); })
          .then((m) => { mission = m; }).catch(() => { failed = true; }).finally(() => { done = true; });
        while (!done || shown < live.length) {
          if (runSeq !== mySeq || get().planStatus !== "running") return;          // replaced by a new run or scenario
          if (shown < live.length) {
            const e = live[shown++];
            step = stepOf(e, step);
            set({ missionShown: shown, planStep: Math.min(7, step) });
            if (e.key === "diagnosis.hotspots") { const st = stationOf(e); if (st) set({ selected: st }); }
            if (!get().missionSkip) await sleep(paceFor(false, get().reducedMotion));
          } else {
            await sleep(30);
          }
        }
        await p;
        if (runSeq !== mySeq || get().planStatus !== "running") return;
        if (!failed && mission) {
          const m = mission as Mission;
          set({ mission: m, missionLive: null, missionShown: m.events.length, plan: m.plan, planStatus: m.status === "paused" ? "paused" : "ready",
            planStep: m.status === "paused" ? Math.min(7, step) : 8, pause: m.pause ?? null });
          return;
        }
        set({ missionLive: null, missionShown: 0, planStep: 0 });                 // stream failed: the request/response path
      }
      try {
        mission = await api.agentRun(missionBody(s.forecast.run_id, applied, s.threshold, s.priority, locale, s.forecastReq, s.constraints, s.planBrief, ask));
        plan = mission.plan;
      } catch {
        try {
          plan = await api.agentPlan(planBody(s.forecast.run_id, applied, s.threshold, s.priority, locale, s.forecastReq));
        } catch (e) { err = e instanceof ApiError ? e.detail : String(e); }
      }
      if (!plan) { set({ planStatus: "error", planError: err, planStep: -1 }); return; }
      if (mission) {
        set({ mission });
        let step = 0;
        for (let i = 0; i < mission.events.length; i++) {
          const g = get();
          if (runSeq !== mySeq || g.planStatus !== "running" || g.mission !== mission) return;     // a new scenario or plan replaced this one
          const e = mission.events[i];
          step = stepOf(e, step);
          set({ missionShown: i + 1, planStep: Math.min(7, step) });
          if (e.key === "diagnosis.hotspots" && !g.kiosk) { const st = stationOf(e); if (st) set({ selected: st }); }
          if (!get().missionSkip) await sleep(paceFor(g.kiosk, g.reducedMotion));
        }
      } else {
        for (let i = 0; i < 8; i++) { set({ planStep: i }); await sleep(get().reducedMotion ? 40 : 230); }
      }
      if (get().planStatus !== "running") return;
      if (mission?.status === "paused") { set({ plan, planStatus: "paused", pause: mission.pause ?? null }); return; }
      set({ plan, planStatus: "ready", planStep: 8 });
    },
    relocalise: async (locale) => {
      const s = get();
      if (s.shift.status !== "idle") shiftLocale = locale;                 // the later steps of a running shift follow the language
      if (!s.forecast || !s.forecastReq) return;
      if (s.shift.status === "awaiting" && s.shift.step?.mission) {        // same alert, same hour: only the texts come back in the new language
        set({ shift: { ...s.shift, status: "running" } });
        await shiftNext(locale);
        return;
      }
      const a = lastPlan, was = s.plan;
      if (s.planStatus !== "ready" || !was || !a || a.runId !== s.forecast.run_id) return;
      try {
        const m = s.mission ? await api.agentRun(missionBody(a.runId, a.applied, a.threshold, a.priority, locale, a.req, a.constraints, a.brief)) : null;
        const p = m ? m.plan : await api.agentPlan(planBody(a.runId, a.applied, a.threshold, a.priority, locale, a.req));
        if (get().plan !== was) return;                                    // a new plan or scenario replaced it meanwhile
        set(m ? { mission: m, plan: p } : { plan: p });                      // progress, ranks and decisions stay as they were
      } catch { /* the plan stays in the language it came in */ }
    },
    setConstraints: (c) => set((s) => ({ constraints: { ...s.constraints, ...c }, plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {} })),
    applyBrief: async (b, locale) => {
      const s = get();
      if (s.planStatus === "running") return;
      set({ scenario: { ...s.scenario, eventId: b.eventId ?? "custom", attendance: b.attendance, exitSigma: null, weather: b.weather, metroShare: null,
              demandLevel: null, incident: null, custom: b.custom ?? s.scenario.custom },
            threshold: b.threshold ?? s.threshold, priority: b.priority ?? s.priority, constraints: b.constraints, planBrief: b.brief,
            applied: [], plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {}, build: BUILD0, preview: null, tab: "ai" });
      await refresh({ forecast: true, jump: true });
      const g = get();
      if (g.error || !g.forecast || g.planBrief !== b.brief) return;           // the forecast failed, or the scenario changed meanwhile
      await g.runAgents(locale);
    },
    setAskMe: (v) => set({ askMe: v }),
    answerCheckpoint: async (a, locale) => {
      const s = get();
      if (!s.pause || s.planStatus !== "paused") return;
      if (a.action === "allow" || a.action === "raise_cap") {           // a constraint changed: the team plans again from the start with it
        const c = a.action === "allow" ? { ...s.constraints, forbid_types: (s.constraints.forbid_types ?? []).filter((t) => t !== a.measure) }
          : { ...s.constraints, cost_cap: a.cost_cap ?? s.constraints.cost_cap };
        set({ constraints: c, answers: s.answers.filter((x) => x.checkpoint !== "partial"), pause: null });
      } else {
        set({ answers: [...s.answers, a], pause: null });
      }
      await get().runAgents(locale, { loop: true });
    },
    rejectWithReason: async (rank, r, locale) => {
      const s = get();
      const opt = s.plan?.options.find((o) => o.rank === rank);
      if (!s.plan || !opt || !s.forecast) return;
      const codes = [...r.codes.filter((c) => c === "too_costly" || c === "not_enough" || c === "other"),
        ...(r.codes.includes("avoid_measure") ? r.avoid.map((t) => `avoid:${t}`) : []), ...(r.codes.includes("protect_station") ? r.protect.map((x) => `protect:${x}`) : [])];
      try {
        const d = await api.decide({ plan_id: s.plan.plan_id, option_rank: rank, decision: "reject", user: "visitor", option_title: opt.title.slice(0, 200),
          forecast_run_id: s.forecast.run_id, interventions: opt.interventions, reason_codes: codes.slice(0, 8), reason: r.words.trim().slice(0, 300) || null });
        set({ log: [{ ts: d.timestamp, kind: "reject" as Decision, title: opt.title }, ...get().log].slice(0, LOG_MAX), decisionError: null,
          decisions: { ...get().decisions, [rank]: "reject" } });
      } catch (e) {
        set({ decisionError: e instanceof ApiError ? e.detail : (e as Error).message });
        return;                                    // a rejection that was not logged is not acted on
      }
      void get().loadMemory();
      let fb: FeedbackResponse;
      try {
        fb = await api.feedback({ reason_codes: r.codes, reason: r.words.trim().slice(0, 300) || null, interventions: opt.interventions,
          cost_proxy: opt.cost_added ?? null, avoid: r.avoid as never[], protect: r.protect, constraints: s.constraints, priority: s.priority, locale });
      } catch (e) {
        set({ loopError: e instanceof ApiError ? e.detail : (e as Error).message });
        return;
      }
      if (!fb.replan) { set({ loopError: "nothing" }); return; }           // the reason changed nothing the team can act on
      // the hotspot answer still holds (constraints do not change the diagnosis); the rest of the plan is asked again
      set({ constraints: fb.constraints, priority: fb.priority, answers: s.answers.filter((x) => x.checkpoint === "hotspot"),
        feedback: { round: (s.feedback?.round ?? 1) + 1, changes: fb.changes } });
      await get().runAgents(locale, { loop: true });
    },
    loadMemory: async (user = "visitor") => {
      try { set({ memory: await api.memory(user) }); } catch { /* memory is a suggestion: without it nothing changes */ }
    },
    skipMission: () => set({ missionSkip: true }),
    setIncident: (i) => {
      const s = get();
      // an incident changes the scenario day: plans approved for the day before it are cleared, like a new event
      set({ scenario: { ...s.scenario, incident: i ?? null }, applied: [], plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {}, preview: null });
      schedule({ forecast: true, jump: true }, 0);
    },
    startShift: async (locale) => {
      const s = get();
      if (!s.forecast || !s.forecastReq || s.loading || s.shift.status === "running") return;
      shiftLocale = locale;
      set({ shift: { ...SHIFT0, status: "running", hour: s.scenario.incident?.hour ?? T_MIN } });
      await shiftNext(locale);
    },
    shiftDecide: async (d, locale, rank) => {
      const s = get(), sh = s.shift, step = sh.step;
      if (sh.status !== "awaiting" || !step || !s.forecast) return;
      const opt = step.mission?.plan.options.find((o) => o.rank === (rank ?? step.recommended_rank)) ?? null;
      let ts = new Date().toISOString();
      set({ shift: { ...sh, status: "running" } });      // from the first click on: a second click cannot log the decision twice
      if (d !== "none" && opt && step.mission) {
        try {
          const r = await api.decide({ plan_id: step.mission.plan.plan_id, option_rank: opt.rank, decision: d, user: "duty-shift", option_title: opt.title.slice(0, 200),
            forecast_run_id: s.forecast.run_id, interventions: opt.interventions });
          ts = r.timestamp;
          set({ log: [{ ts, kind: d, title: opt.title }, ...get().log].slice(0, LOG_MAX), decisionError: null });
        } catch (e) {
          set({ decisionError: e instanceof ApiError ? e.detail : (e as Error).message, shift: { ...sh, status: "awaiting" } });
          return;                                  // never move on from a decision that was not logged
        }
      }
      const done = d === "approve" && !!opt;
      const item: ShiftItem = { hour: step.hour, stations: step.alerts.map((a) => a.station), title: opt?.title ?? null, decision: done ? "approve" : d === "reject" && opt ? "reject" : "none",
        overBefore: step.residual.overcap_station_hours, overAfter: done ? opt!.summary.overcap_station_hours : null,
        planId: step.mission?.plan.plan_id ?? null, runId: opt?.sources?.[0]?.run_id ?? null, ts };
      set({ shift: { ...sh, status: "running", handled: [...sh.handled, ...step.alerts.map((a) => a.key)], items: [...sh.items, item] } });
      if (done) {
        const fr = s.forecastReq;
        if (fr) void api.message(messageBody(s.forecast.run_id, s.threshold, fr, mergeInterventions(s.applied.map((a) => a.ivs)), opt!.interventions))
          .then((m) => set({ drafts: m }), () => {});
        await applyPlan(opt!.title, opt!.interventions);
      } else set({ plan: null, mission: null, missionShown: 0, planStatus: "idle", decisions: {} });
      await shiftNext(locale);
    },
    stopShift: () => set({ shift: SHIFT0 }),
    decide: async (rank, d, user = "visitor") => {
      const s = get();
      // while a duty shift waits on this very plan, a decision made on the plan's own card is the shift's decision
      if (s.shift.status === "awaiting" && s.plan && s.shift.step?.mission?.plan.plan_id === s.plan.plan_id) { await get().shiftDecide(d === "approve" ? "approve" : "reject", shiftLocale, rank); return; }
      const opt = s.plan?.options.find((o) => o.rank === rank);
      if (!s.plan || !opt || !s.forecast) return;
      try {
        const r = await api.decide({ plan_id: s.plan.plan_id, option_rank: rank, decision: d, user, option_title: opt.title.slice(0, 200),
          forecast_run_id: s.forecast.run_id, interventions: opt.interventions });
        set({ log: [{ ts: r.timestamp, kind: d, title: opt.title }, ...get().log].slice(0, LOG_MAX), decisionError: null });
      } catch (e) {
        set({ decisionError: e instanceof ApiError ? e.detail : (e as Error).message });
        return;                                    // never show "applied" for a decision that was not logged
      }
      if (d === "approve") {
        // the messenger drafts the passenger notice for the approved option (figures re-simulated by the API; never sent)
        const fr = s.forecastReq;
        if (fr) void api.message(messageBody(s.forecast.run_id, s.threshold, fr, mergeInterventions(s.applied.map((a) => a.ivs)), opt.interventions))
          .then((m) => set({ drafts: m }), () => set({ drafts: null }));
        await applyPlan(opt.title, opt.interventions);
      }
      else set({ decisions: { ...get().decisions, [rank]: d } });
    },
    patchBuild: (p) => { set({ build: { ...get().build, ...p } }); schedulePreview(); },
    approveMine: async (title) => {
      const s = get();
      const ivs = buildInterventions(s.build, s.cur, corridorIds(s));
      if (!ivs.length || !s.preview || !s.forecast) return;
      try {
        const r = await api.decide({ plan_id: `my_plan_${s.preview.resp.run_id}`, option_rank: 1, decision: "approve", user: "visitor",
          option_title: title, forecast_run_id: s.forecast.run_id, interventions: ivs });
        set({ log: [{ ts: r.timestamp, kind: "approve" as const, title }, ...get().log].slice(0, LOG_MAX), decisionError: null });
      } catch (e) {
        set({ decisionError: e instanceof ApiError ? e.detail : (e as Error).message });
        return;
      }
      await applyPlan(title, ivs);
    },
    clearPlans: () => {
      const s = get();
      if (!s.applied.length && !s.plan) return;
      set({ applied: [], plan: null, mission: null, missionShown: 0, drafts: null, planStatus: "idle", decisions: {}, cur: s.base, preview: null, shift: SHIFT0,
        log: [{ ts: new Date().toISOString(), kind: "reset" as const }, ...s.log].slice(0, LOG_MAX) });
      schedulePreview();
    },
    jumpTo: (id, hour) => set((s) => ({ selected: id, time: Math.min(T_MAX, hour + 0.5), cam: "close", lastCam: "close", camNonce: s.camNonce + 1 })),
  };
});

// Playback clock: one requestAnimationFrame loop for the whole app (the 3D scene reads `time` from the store).
if (typeof window !== "undefined") {
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const s = useTwin.getState();
    if (s.playing) {
      const t = s.time + dt * 0.55 * s.speed;
      if (t >= T_MAX) useTwin.setState({ time: T_MAX, playing: false });
      else useTwin.setState({ time: t });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Test hook: Playwright drives the twin (time of day, camera, scenario) through the same store the UI uses.
declare global { interface Window { __twin?: typeof useTwin } }
if (typeof window !== "undefined") window.__twin = useTwin;
