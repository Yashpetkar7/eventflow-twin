"use client";
// Guided demo (same beats as the mockup's tour) and the kiosk idle timer. The tour drives the real app: it
// loads the headline scenario, asks the planner and approves the top option — logged as user "guided-demo"
// so the audit trail never mistakes it for a visitor's decision.
import { api } from "./api";
import { T_MAX, useTwin } from "./store";

let token = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(60); };

export function stopTour() { token++; useTwin.setState({ tourStep: null, playing: false }); }

export async function runTour(locale: "en" | "ar") {
  const my = ++token, S = useTwin, alive = () => my === token;
  const say = (i: number) => S.setState({ tourStep: i });
  const fast = S.getState().reducedMotion;
  const st = S.getState();
  if (!st.events.length) return;
  // 0 — headline scenario, normal day, morning → exit peak
  S.setState({ tab: "station", view: st.glFailed ? "table" : "3d", playing: false });
  S.getState().setCam("overview");
  S.getState().selectEvent(st.events[0].id);
  S.getState().patchScenario({ weather: "normal" });
  say(0);
  await sleep(500);
  await until(() => !S.getState().loading);
  if (!alive()) return;
  const peak = S.getState().time;
  await new Promise<void>((res) => {
    const t0 = performance.now(), from = Math.max(8, peak - 6), dur = fast ? 600 : 5200;
    const step = (now: number) => {
      if (!alive()) return res();
      const k = Math.min(1, (now - t0) / dur);
      S.getState().setTime(Math.min(T_MAX, from + (peak - from) * k));
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  if (!alive()) return;
  // 1 — what-if: a hot day pushes the venue's station over its threshold ring
  const before = S.getState().forecast?.run_id;
  S.getState().patchScenario({ weather: "hot" });
  say(1);
  await until(() => S.getState().forecast?.run_id !== before && !S.getState().loading);
  if (!alive()) return;
  const hot = S.getState().cur, sel = S.getState().selected;      // move the clock to the busiest quarter-hour
  if (hot?.by[sel]) { const lf = hot.by[sel].lf; let b = 0; lf.forEach((v, i) => { if (v > lf[b]) b = i; }); S.getState().setTime((b + 0.5) / hot.bph); }
  S.getState().setCam("close");
  await sleep(fast ? 600 : 3800);
  if (!alive()) return;
  // 2 — the agents plan
  S.setState({ tab: "ai" });
  say(2);
  await S.getState().runAgents(locale);
  await sleep(fast ? 400 : 2600);
  if (!alive()) return;
  // 3 — approval (logged as the guided demo, not as a visitor)
  say(3);
  await sleep(fast ? 400 : 2200);
  if (!alive()) return;
  if (S.getState().plan?.options.length) await S.getState().decide(1, "approve", "guided-demo");
  await sleep(fast ? 400 : 3200);
  if (!alive()) return;
  // 4 — hand over to the visitor
  S.getState().setCam("orbit");
  say(4);
  await sleep(fast ? 800 : 4500);
  if (alive()) S.setState({ tourStep: null });
}

/** Kiosk: after `ms` without input, play the guided demo; any touch during it hands control back. */
export function armIdle(ms: number, locale: () => "en" | "ar"): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null, idleRun = false;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => { idleRun = true; await runTour(locale()); idleRun = false; arm(); }, ms);
  };
  const touch = () => { if (idleRun) { idleRun = false; stopTour(); } arm(); };
  window.addEventListener("pointerdown", touch, { passive: true });
  window.addEventListener("keydown", touch);
  arm();
  return () => { if (timer) clearTimeout(timer); window.removeEventListener("pointerdown", touch); window.removeEventListener("keydown", touch); };
}

/** Calm reconnect loop while the API is down. */
export function watchApi(): () => void {
  const id = setInterval(() => {
    if (!useTwin.getState().apiDown && useTwin.getState().ready) return;
    api.health().then(() => { if (!useTwin.getState().ready) void useTwin.getState().init(); }).catch(() => {});
  }, 4000);
  return () => clearInterval(id);
}
