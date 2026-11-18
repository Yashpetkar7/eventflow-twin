// Runs of the agent team (contract 1.18.0, docs/18_ASSISTANT.md §13): a ledger of every analysis with its status,
// automatic runs when the scenario changes, cancel, run again, and a past scenario restored.
//
// The API is stateless and a mission is a short computation, so the ledger lives here, in the page:
//   queued      an automatic run is waiting for the scenario's forecast and simulation to finish
//   running     the team is working (its events are being shown)
//   paused      the team asked the planner a question and waits for the answer
//   completed   a plan (or "no plan needed") is on screen
//   failed      the planning service did not answer
//   cancelled   the planner stopped it; its answer, if it still arrives, is dropped
//   superseded  the scenario changed while it ran; its answer is for an old scenario and is dropped
// A run can never overwrite a newer scenario's result: the store drops an answer whose run is no longer current, and
// the ledger records which of the two happened. Runs are deterministic, so running the same scenario again gives the
// same run ids: asking twice is harmless.
import { create } from "zustand";
import type { Constraints, ForecastRequest } from "./api";
import { applySettings, useAssistant } from "./assistant";
import type { Priority } from "./requests";
import { useTwin } from "./store";

export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled" | "superseded";
export type RunTrigger = "manual" | "auto" | "rerun";
export interface RunSettings { forecast: ForecastRequest; threshold: number; priority: Priority; constraints: Constraints }
export interface RunEntry {
  id: number; trigger: RunTrigger; status: RunStatus; version: number;
  queuedAt: number; startedAt: number | null; endedAt: number | null;
  settings: RunSettings; forecastRunId: string | null; missionId: string | null; planId: string | null;
  options: number | null; recommended: string | null; peakBefore: number | null; peakAfter: number | null; stop: string | null; error: string | null;
}
interface RunsState {
  runs: RunEntry[];                    // newest first
  auto: boolean;                       // run the team by itself whenever the scenario changes
  locale: "en" | "ar";
  setAuto: (v: boolean) => void;
  setLocale: (l: "en" | "ar") => void;
  cancel: () => void;
  rerun: () => void;
  restore: (id: number) => void;
}

const KEEP = 30, WAIT_MS = 450;
const ACTIVE: RunStatus[] = ["queued", "running", "paused"];
let seq = 0, next: RunTrigger = "manual", cancelling = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// The store may offer its own cancel that also aborts the live stream (PR #60, `cancelRun` / `runCancelled`). When it
// does, the ledger uses it and recognises a run it cancelled; when it does not, the ledger stops the run itself.
type WithCancel = { cancelRun?: () => void; runCancelled?: boolean };
export const storeCancels = (): boolean => typeof (useTwin.getState() as WithCancel).cancelRun === "function";

const settingsNow = (): RunSettings | null => {
  const s = useTwin.getState();
  return s.forecastReq ? { forecast: s.forecastReq, threshold: s.threshold, priority: s.priority, constraints: s.constraints } : null;
};
const patch = (id: number, p: Partial<RunEntry>) => useRuns.setState((r) => ({ runs: r.runs.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
const add = (e: Omit<RunEntry, "id">) => useRuns.setState((r) => ({ runs: [{ id: ++seq, ...e }, ...r.runs].slice(0, KEEP) }));
const blank = { startedAt: null, endedAt: null, forecastRunId: null, missionId: null, planId: null, options: null, recommended: null,
  peakBefore: null, peakAfter: null, stop: null, error: null };

/** Start the queued automatic run once the scenario's own forecast and simulation are in, and nothing else is running. */
function pump(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const R = useRuns.getState(), q = R.runs.find((x) => x.status === "queued");
    if (!q || !R.auto) return;
    const s = useTwin.getState(), now = settingsNow();
    if (s.loading || !s.forecast || !now || s.planStatus === "running" || s.planStatus === "paused" || s.shift.status !== "idle") { pump(); return; }
    next = "auto";
    void s.runAgents(R.locale);
  }, WAIT_MS);
}

function queue(): void {
  const R = useRuns.getState(), s = useTwin.getState(), now = settingsNow();
  if (!R.auto || s.kiosk || !now) return;
  const version = useAssistant.getState().version, q = R.runs.find((x) => x.status === "queued");
  if (q) patch(q.id, { version, settings: now, queuedAt: Date.now() });          // several quick changes are one run, for the latest scenario
  else add({ ...blank, trigger: "auto", status: "queued", version, queuedAt: Date.now(), settings: now });
  pump();
}

export const useRuns = create<RunsState>((set, get) => ({
  runs: [], auto: false, locale: "en",
  setLocale: (l) => set({ locale: l }),
  setAuto: (v) => {
    set({ auto: v });
    if (!v) {                                                                      // switching it off withdraws a run that has not started
      const q = get().runs.find((x) => x.status === "queued");
      if (q) patch(q.id, { status: "cancelled", endedAt: Date.now() });
      return;
    }
    const version = useAssistant.getState().version;
    if (!get().runs.some((x) => x.version === version && (ACTIVE.includes(x.status) || x.status === "completed"))) queue();
  },
  cancel: () => {
    const R = get(), q = R.runs.find((x) => x.status === "queued");
    if (q) patch(q.id, { status: "cancelled", endedAt: Date.now() });
    if (R.runs.some((x) => x.status === "running" || x.status === "paused")) {
      cancelling = true;                                                           // the store's run loop sees the status change and drops its answer
      const st = useTwin.getState() as WithCancel;
      if (st.cancelRun && useTwin.getState().planStatus === "running") st.cancelRun();
      else useTwin.setState({ planStatus: "idle", plan: null, mission: null, missionLive: null, missionShown: 0, pause: null, planStep: -1 });
    }
  },
  rerun: () => {
    const s = useTwin.getState();
    if (s.planStatus === "running" || s.loading) return;
    next = "rerun";
    void s.runAgents(get().locale);
  },
  restore: (id) => {
    const e = get().runs.find((x) => x.id === id);
    if (e) applySettings(e.settings);                                              // a new version of the scenario, equal to that run's
  },
}));

// The ledger follows the store's plan status; it never drives it (except Cancel, above).
useTwin.subscribe((s, prev) => {
  if (s.kiosk || s.planStatus === prev.planStatus) return;
  const R = useRuns.getState(), now = Date.now();
  const live = R.runs.find((x) => x.status === "running" || x.status === "paused");
  if (s.planStatus === "running") {
    if (live?.status === "paused") { patch(live.id, { status: "running" }); return; }       // the planner answered: the same run goes on
    const st = settingsNow();
    if (!st) return;
    const base = { status: "running" as const, version: useAssistant.getState().version, settings: st, startedAt: now, forecastRunId: s.forecast?.run_id ?? null };
    const q = R.runs.find((x) => x.status === "queued");
    if (q && next === "auto") patch(q.id, base);
    else add({ ...blank, trigger: next, queuedAt: now, ...base });
    next = "manual";
    return;
  }
  if (!live) return;
  if (s.planStatus === "paused") patch(live.id, { status: "paused" });
  else if (s.planStatus === "error") patch(live.id, { status: "failed", endedAt: now, error: s.planError });
  else if (s.planStatus === "idle") {
    patch(live.id, { status: cancelling || (s as WithCancel).runCancelled === true ? "cancelled" : "superseded", endedAt: now });
    cancelling = false;
  }
  else if (s.planStatus === "ready") {
    const plan = s.plan, m = s.mission;
    const rec = plan?.options.find((o) => o.rank === m?.recommended_rank) ?? plan?.options[0] ?? null;
    patch(live.id, { status: "completed", endedAt: now, missionId: m?.mission_id ?? null, planId: plan?.plan_id ?? null, options: plan?.options.length ?? 0,
      recommended: rec?.title ?? null, peakBefore: plan?.baseline_summary.peak_lf ?? null, peakAfter: rec?.summary.peak_lf ?? null, stop: m?.stop_reason ?? null });
  }
});

// A new scenario version (by hand, by the assistant, or a restored run) queues an automatic run when auto-run is on.
useAssistant.subscribe((a, prev) => { if (a.version !== prev.version) queue(); });
