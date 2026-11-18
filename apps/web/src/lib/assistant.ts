// The assistant's conversation (contract 1.17.0, docs/18_ASSISTANT.md): turns, the context the API hands back, the
// scenario version, and the one place a natural-language change becomes the state on screen.
//
// The API keeps no conversation. `context` comes back with every answer and is sent with the next question, so a
// follow-up ("why?", "and Emirates Towers?", "undo") is understood. Nothing here is stored beyond the page.
import { create } from "zustand";
import { api, ApiError, type ChatContext, type ChatResponse, type ScenarioPatch } from "./api";
import { chatBody, type Weather } from "./requests";
import { hourOf, mergeInterventions, useTwin } from "./store";

export interface Turn {
  id: number;
  who: "you" | "twin";
  text?: string;                       // what the planner typed
  chip?: string;                       // or the question they tapped (an intent)
  res?: ChatResponse;
  error?: string;
}
export interface Ask { message?: string; intent?: string; args?: Record<string, unknown> }

interface AssistantState {
  turns: Turn[];
  context: ChatContext | null;
  busy: boolean;
  version: number;                     // the scenario's version: every change to it, by hand or by the assistant, is the next one
  send: (ask: Ask, locale: "en" | "ar") => Promise<void>;
  reset: () => void;
}

let seq = 0;
let applying = false;                  // a patch is being applied: its several store updates are one version, not three

export interface Settings { forecast: ScenarioPatch["forecast"]; threshold: number | null | undefined; priority: ScenarioPatch["priority"]; constraints: ScenarioPatch["constraints"] }

/** Several store updates that are ONE change to the scenario: one new version (or the version a patch names). */
export function asOneChange(fn: () => void, version?: number): void {
  applying = true;
  try { fn(); } finally { applying = false; }
  useAssistant.setState((a) => ({ version: version ?? a.version + 1 }));
}

/** Make these settings the scenario on screen (a patch from the assistant, or a past run's scenario restored). The
 *  store then asks for its usual deterministic runs, so the rail, the 3D twin and every panel show exactly the figures
 *  those settings give. An incident is left as it is: it belongs to the duty view. */
export function applySettings(x: Settings, version?: number): void {
  const st = useTwin.getState();
  const f = x.forecast;
  asOneChange(() => {
    const custom = f.custom_event ?? null;
    const event = custom ? "custom" : f.event_id ?? st.scenario.eventId;
    if (event !== st.scenario.eventId) st.selectEvent(event);
    if (custom) st.patchCustom({ near: custom.near_station, start: custom.start, end: custom.end, weekend: !!custom.weekend });
    st.patchScenario({ attendance: custom ? custom.attendance : f.attendance ?? null, exitSigma: f.exit_sigma_min ?? null,
      weather: (f.weather ?? "normal") as Weather, metroShare: f.metro_share ?? null, demandLevel: f.demand_level === "real_totals" ? "real_totals" : null });
    const now = useTwin.getState();
    if (x.threshold != null && x.threshold !== now.threshold) now.setThreshold(x.threshold);
    if (x.priority !== now.priority) now.setPriority(x.priority);
    const c = x.constraints;
    if (JSON.stringify(c) !== JSON.stringify(now.constraints)) now.setConstraints({ forbid_types: c.forbid_types ?? [], protect_stations: c.protect_stations ?? [], cost_cap: c.cost_cap ?? null });
  }, version);
}

/** A patch from the assistant. The API has already forecast and simulated it. */
export function applyPatch(p: ScenarioPatch): void {
  applySettings({ forecast: p.forecast, threshold: p.threshold, priority: p.priority, constraints: p.constraints }, p.version);
}

export const useAssistant = create<AssistantState>((set, get) => ({
  turns: [], context: null, busy: false, version: 1,
  reset: () => set({ turns: [], context: null }),
  send: async (ask, locale) => {
    const s = useTwin.getState();
    if (get().busy || !s.forecast || !s.forecastReq || s.loading) return;
    const mine: Turn = { id: ++seq, who: "you", text: ask.message, chip: ask.message ? undefined : ask.intent };
    set({ busy: true, turns: [...get().turns, mine] });
    try {
      const res = await api.chat(chatBody(s.forecast.run_id, s.threshold, s.forecastReq, mergeInterventions(s.applied.map((a) => a.ivs)), locale, {
        message: ask.message, intent: ask.intent, args: ask.args, audience: "planner", priority: s.priority, constraints: s.constraints,
        station: s.selected || undefined, hour: hourOf(s.time), scenario_version: get().version, context: get().context ?? undefined }));
      set({ turns: [...get().turns, { id: ++seq, who: "twin", res }], context: res.context, busy: false });
      if (res.status === "applied" && res.patch) applyPatch(res.patch);
    } catch (e) {
      set({ turns: [...get().turns, { id: ++seq, who: "twin", error: e instanceof ApiError ? e.detail : (e as Error).message }], busy: false });
    }
  },
}));

// Any change to the scenario made by hand (event, sliders, weather, comfort line, priority, constraints) is a new version.
useTwin.subscribe((s, prev) => {
  if (applying || !prev.ready) return;                  // the first load sets the scenario: that is version 1, not a change
  if (s.scenario !== prev.scenario || s.threshold !== prev.threshold || s.priority !== prev.priority || s.constraints !== prev.constraints) {
    useAssistant.setState((a) => ({ version: a.version + 1 }));
  }
});
