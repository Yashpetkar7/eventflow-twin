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

/** Make a patch the scenario on screen. The API has already forecast and simulated it; the store now asks for the same
 *  deterministic runs, so the rail, the 3D twin and every panel move to exactly the figures the answer showed. */
export function applyPatch(p: ScenarioPatch): void {
  const st = useTwin.getState();
  const f = p.forecast;
  applying = true;
  try {
    const custom = f.custom_event ?? null;
    st.patchScenario({ attendance: custom ? custom.attendance : f.attendance ?? null, exitSigma: f.exit_sigma_min ?? null,
      weather: (f.weather ?? "normal") as Weather, metroShare: f.metro_share ?? null });
    if (p.threshold != null && p.threshold !== st.threshold) st.setThreshold(p.threshold);
    if (p.priority !== st.priority) st.setPriority(p.priority);
    const c = p.constraints, now = st.constraints;
    if (JSON.stringify(c) !== JSON.stringify(now)) st.setConstraints({ forbid_types: c.forbid_types ?? [], protect_stations: c.protect_stations ?? [], cost_cap: c.cost_cap ?? null });
  } finally {
    applying = false;
  }
  useAssistant.setState({ version: p.version });
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
