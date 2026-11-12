"use client";
// All twin state in one zustand store: scenario → forecast → simulation (no plans / with approved plans) →
// agent plan → human decisions. Every number on screen is read from an API response held here; the UI only
// interpolates between 15-minute bins for animation.
import { create } from "zustand";
import {
  api, ApiError, setFallbackListener, type AgentPlanResponse, type EventInfo, type ForecastResponse, type Intervention,
  type SimulateResponse, type Station,
} from "./api";
import { LANDMARK_STATION, type LandmarkKey } from "./landmarks";
import { forecastBody, planBody, simulateBody, type Priority, type Scenario, type Weather } from "./requests";

export type { Priority, Scenario, Weather };
export type CamMode = "overview" | "close" | "top" | "fly" | "orbit" | "landmark" | "free";
export type Tab = "station" | "ai" | "build" | "alerts" | "report";
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
}
const BUILD0: BuildState = { headway: 0, wayShare: 0, wayFrom: "EMT", wayTo: "FIC", buses: 0, busFrom: "EMT", busTo: "BKD", rt: 0, rtAt: "EMT", stag: 0 };

export function buildInterventions(b: BuildState, cur: SimView | null, ids: string[]): Intervention[] {
  const hrs = hotHours(cur, ids);
  const win = [...new Set(hrs.flatMap((h) => [h - 1, h, h + 1]))].filter((h) => h >= 0 && h <= 23).sort((x, y) => x - y);
  const iv: Intervention[] = [];
  if (b.stag) iv.push({ type: "staggered_exit", params: { spread_minutes: b.stag } });
  if (b.headway) iv.push({ type: "extra_trains", params: { headway_min: b.headway, hours: win, line: "Red" } });
  if (b.wayShare > 0 && b.wayFrom !== b.wayTo) iv.push({ type: "wayfinding_redirect", params: { from_station: b.wayFrom, to_station: b.wayTo, share: b.wayShare / 100, hours: hrs } });
  if (b.buses > 0 && b.busFrom !== b.busTo) iv.push({ type: "shuttle_bus", params: { from_station: b.busFrom, to_station: b.busTo, buses: b.buses, hours: hrs } });
  if (b.rt > 0) iv.push({ type: "robotaxi_staging", params: { station: b.rtAt, vehicles: b.rt, hours: hrs } });
  return iv;
}

export interface LogEntry { ts: string; kind: Decision | "reset"; title?: string }
export interface Applied { title: string; ivs: Intervention[] }

interface State {
  ready: boolean; loading: boolean; error: string | null; apiDown: boolean;
  stations: Station[]; events: EventInfo[];
  scenario: Scenario; threshold: number; priority: Priority;
  forecast: ForecastResponse | null; base: SimView | null; cur: SimView | null;
  flows: Record<string, { out: number[]; in: number[] }>;
  applied: Applied[];
  plan: AgentPlanResponse | null; planStatus: "idle" | "running" | "ready" | "error"; planStep: number; planError: string | null;
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
  runAgents: (locale: "en" | "ar") => Promise<void>;
  decide: (rank: number, d: Decision, user?: string) => Promise<void>;
  patchBuild: (p: Partial<BuildState>) => void;
  approveMine: (title: string) => Promise<void>;
  clearPlans: () => void;
  jumpTo: (id: string, hour: number) => void;
}

const corridorIds = (s: State) => s.stations.map((x) => x.id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let reqId = 0, refreshTimer: ReturnType<typeof setTimeout> | null = null, previewTimer: ReturnType<typeof setTimeout> | null = null;
let abort: AbortController | null = null, previewAbort: AbortController | null = null;

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
      const fc = opts.forecast || !s.forecast ? await api.forecast(forecastBody(s.scenario), signal) : s.forecast;
      const ivs = mergeInterventions(get().applied.map((a) => a.ivs));
      const [baseR, curR] = await Promise.all([
        api.simulate(simulateBody(fc.run_id, [], get().threshold), signal),
        ivs.length ? api.simulate(simulateBody(fc.run_id, ivs, get().threshold), signal) : null,
      ]);
      if (id !== reqId) return;
      const base = buildView(baseR), cur = curR ? buildView(curR) : base;
      const flows: State["flows"] = {};
      for (const r of fc.rows) {
        const f = (flows[r.station_id] ??= { out: Array(24).fill(0), in: Array(24).fill(0) });
        f.out[r.hour] = r.event_entries_p50; f.in[r.hour] = r.event_exits_p50 ?? 0;
      }
      const patch: Partial<State> = { forecast: fc, base, cur, flows, loading: false, ready: true, plan: null, planStatus: "idle", decisions: {}, planError: null };
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
      if (!ivs.length || !s.forecast) { set({ preview: null, previewError: null }); return; }
      previewAbort = new AbortController();
      try {
        const all = mergeInterventions([...s.applied.map((a) => a.ivs), ivs]);
        const r = await api.simulate(simulateBody(s.forecast.run_id, all, s.threshold), previewAbort.signal);
        set({ preview: buildView(r), previewError: null });
      } catch (e) {
        if ((e as Error).name !== "AbortError") set({ preview: null, previewError: e instanceof ApiError ? e.detail : (e as Error).message });
      }
    }, 250);
  }
  async function applyPlan(title: string, ivs: Intervention[]) {
    const s = get();
    const applied = [...s.applied, { title, ivs }];
    set({ applied, plan: null, planStatus: "idle", decisions: {}, build: { ...s.build, headway: 0, wayShare: 0, buses: 0, rt: 0, stag: 0 }, preview: null });
    try {
      const r = await api.simulate(simulateBody(s.forecast!.run_id, mergeInterventions(applied.map((a) => a.ivs)), s.threshold));
      set({ cur: buildView(r) });
    } catch (e) {
      set({ applied: s.applied, decisionError: e instanceof ApiError ? e.detail : (e as Error).message });
    }
  }

  return {
    ready: false, loading: true, error: null, apiDown: false,
    stations: [], events: [],
    scenario: { eventId: "", attendance: null, exitSigma: null, weather: "normal", custom: { near: "FIC", start: "19:00", end: "22:00", weekend: false } },
    threshold: 0.85, priority: "balanced",
    forecast: null, base: null, cur: null, flows: {},
    applied: [], plan: null, planStatus: "idle", planStep: -1, planError: null, decisions: {}, decisionError: null,
    build: BUILD0, preview: null, previewError: null, log: [],
    time: 15.5, playing: false, speed: 1,
    selected: "WTC", tab: "station", view: "3d",
    layers: { buildings: true, landmarks: true, trains: true, traffic: true, flows: true, labels: true },
    cam: "overview", lastCam: "overview", camNonce: 0,
    kiosk: false, tourStep: null, sceneReady: false, glFailed: false, reducedMotion: false,
    focus: null, expanded: false, tier: 0, fpsOverride: null,

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
      set({ scenario: { ...s.scenario, eventId: id, attendance: null, exitSigma: null }, applied: [], plan: null, planStatus: "idle", decisions: {}, build: BUILD0, preview: null });
      schedule({ forecast: true, jump: true }, 0);
    },
    patchScenario: (p) => { set({ scenario: { ...get().scenario, ...p } }); schedule({ forecast: true }); },
    patchCustom: (p) => {
      const s = get().scenario;
      set({ scenario: { ...s, custom: { ...s.custom, ...p } }, applied: [], plan: null, planStatus: "idle" });
      schedule({ forecast: true, jump: true });
    },
    setThreshold: (v) => { set({ threshold: v }); schedule({ forecast: false }); },
    setPriority: (p) => set({ priority: p, plan: null, planStatus: "idle", decisions: {} }),
    setTime: (t) => set({ time: Math.max(T_MIN, Math.min(T_MAX, t)) }),
    setPlaying: (p) => set((s) => ({ playing: p, time: p && s.time >= T_MAX - 0.05 ? T_MIN : s.time })),
    select: (id, opts) => set((s) => ({ selected: id, tab: opts?.tab ? "station" : s.tab, camNonce: s.camNonce + (opts?.fly && s.cam === "close" ? 1 : 0) })),
    setCam: (c) => set((s) => ({ cam: c, lastCam: c === "free" ? s.lastCam : c, focus: c === "landmark" ? s.focus : null, camNonce: s.camNonce + 1 })),
    /** Fly to a landmark and frame it with its surroundings. */
    focusLandmark: (key) => set((s) => ({ cam: "landmark", lastCam: "landmark", focus: key, view: "3d", camNonce: s.camNonce + 1,
      selected: LANDMARK_STATION[key as LandmarkKey] ?? s.selected })),
    /** Back to the framing of the last chosen preset after dragging, panning or zooming away. */
    recentre: () => set((s) => ({ cam: s.lastCam, view: "3d", camNonce: s.camNonce + 1 })),

    runAgents: async (locale) => {
      const s = get();
      if (s.planStatus === "running" || !s.forecast) return;
      set({ planStatus: "running", planStep: 0, plan: null, planError: null, decisions: {} });
      const body = planBody(s.forecast.run_id, mergeInterventions(s.applied.map((a) => a.ivs)), s.threshold, s.priority, locale);
      const pending = api.agentPlan(body).then((p) => ({ p, e: null as string | null }), (e) => ({ p: null, e: e instanceof ApiError ? e.detail : String(e) }));
      const pace = get().reducedMotion ? 40 : 230;
      for (let i = 0; i < 8; i++) {                // the 8 pipeline steps; the last one waits for the API answer
        set({ planStep: i });
        await sleep(pace);
        if (i === 7) await pending;
      }
      const { p, e } = await pending;
      if (p) set({ plan: p, planStatus: "ready", planStep: 8 });
      else set({ planStatus: "error", planError: e, planStep: -1 });
    },
    decide: async (rank, d, user = "visitor") => {
      const s = get();
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
      if (d === "approve") await applyPlan(opt.title, opt.interventions);
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
      set({ applied: [], plan: null, planStatus: "idle", decisions: {}, cur: s.base, preview: null,
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
