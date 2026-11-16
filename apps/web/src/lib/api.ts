// Typed client for the EventFlow Twin API (contract: ../../contract/openapi.json).
// Types are generated: `python tasks.py contract` → src/lib/api-types.ts. Never hand-edit them.
//
// Fallback when the API cannot be reached (booth resilience): every successful answer is remembered in
// memory + localStorage, and a snapshot of the preset scenarios ships in public/cache/ (built by
// `npm run snapshot` from the real API). A fallback answer is always flagged so the UI can say so.
import type { components } from "./api-types";
import { requestKey } from "./requests";

type S = components["schemas"];
export type Station = S["Station"];
export type EventInfo = S["Event"];
export type ForecastRequest = S["ForecastRequest"];
export type ForecastResponse = S["ForecastResponse"];
export type SimulateRequest = S["SimulateRequest"];
export type SimulateResponse = S["SimulateResponse"];
export type SimSummary = S["SimSummary"];
export type SimHourRow = S["SimHourRow"];
export type AgentPlanRequest = S["AgentPlanRequest"];
export type AgentPlanResponse = S["AgentPlanResponse"];
export type PlanOption = S["PlanOption"];
export type DecisionRequest = S["DecisionRequest"];
export type BreakpointRequest = S["BreakpointRequest"];
export type BreakpointResponse = S["BreakpointResponse"];
export type DecisionResponse = S["DecisionResponse"];
export type Intervention = NonNullable<S["SimulateRequest"]["interventions"]>[number];
export type AgentRunRequest = S["AgentRunRequest"];
export type Mission = S["Mission"];
export type AgentEvent = S["AgentEvent"];
export type Roster = S["Roster"];
export type Constraints = S["Constraints"];
export type Assessment = S["Assessment"];
export type WatchRequest = S["WatchRequest"];
export type WatchResponse = S["WatchResponse"];
export type MessageRequest = S["MessageRequest"];
export type MessageResponse = S["MessageResponse"];
export type AskRequest = S["AskRequest"];
export type AskResponse = S["AskResponse"];
export type AskIntent = NonNullable<S["AskRequest"]["intent"]>;
export type ShiftRequest = S["ShiftRequest"];
export type ShiftStep = S["ShiftStep"];
export type ShiftAlert = S["ShiftAlert"];
export type IncidentInfo = S["IncidentInfo"];
export type RejectedPlan = S["RejectedPlan"];
export type ChainState = S["ChainState"];
export type ChainEvent = S["ChainEvent"];
export type ChainStartRequest = S["ChainStartRequest"];
export type ChainDecideRequest = S["ChainDecideRequest"];

/** True when the page is served from this machine (laptop, booth). */
export const isLocalHost = () => typeof window === "undefined" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

/** API address: NEXT_PUBLIC_API_URL if set; on this machine the local API on :8000; anywhere else (a hosted
 *  deployment) the same origin under /api, where vercel.json routes the Python service. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? (isLocalHost() ? "http://localhost:8000" : "/api");
/** Hosted public demo (any non-local host, or forced with NEXT_PUBLIC_PUBLIC_DEMO=1): shows the research banner. */
export const isPublicDemo = () => process.env.NEXT_PUBLIC_PUBLIC_DEMO === "1" || !isLocalHost();

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`API ${status}: ${detail}`);
  }
}

const mem = new Map<string, unknown>();
let snapshot: Promise<Record<string, string>> | null = null;
let onFallback: (down: boolean) => void = () => {};
export const setFallbackListener = (fn: (down: boolean) => void) => { onFallback = fn; };

const LS = "eft.cache.";
function remember(key: string, data: unknown, persist: boolean) {
  mem.delete(key);
  mem.set(key, data);
  if (mem.size > 120) mem.delete(mem.keys().next().value as string);      // bounded: a week-long booth run must not grow
  if (!persist) return;
  try { window.localStorage.setItem(LS + key, JSON.stringify(data)); } catch { /* quota or blocked: memory only */ }
}
async function recall<T>(key: string): Promise<T | null> {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const s = window.localStorage.getItem(LS + key);
    if (s) return JSON.parse(s) as T;
  } catch { /* ignore */ }
  try {
    snapshot ??= fetch("/cache/index.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const file = (await snapshot)[key];
    if (file) {
      const r = await fetch(`/cache/${file}`);
      if (r.ok) return (await r.json()) as T;
    }
  } catch { /* no snapshot */ }
  return null;
}

async function call<T>(path: string, body?: unknown, opts: { signal?: AbortSignal; cache?: boolean } = {}): Promise<T> {
  const key = requestKey(path, body);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (opts.cache !== false) {
      const hit = await recall<T>(key);
      if (hit) { onFallback(true); return hit; }
    }
    onFallback(true);
    throw new ApiError(0, `Cannot reach the API at ${API_BASE}.`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* keep statusText */ }
    throw new ApiError(res.status, detail);
  }
  const data = (await res.json()) as T;
  onFallback(false);
  if (opts.cache !== false) remember(key, data, path !== "/simulate" || !(body as SimulateRequest)?.interventions?.length);
  return data;
}

export interface Evidence {
  eval: Record<string, { file: string; timestamp?: string; metrics: Record<string, unknown>; n?: number;
    split?: string; is_synthetic?: boolean; dataset_version?: string }>;
  data: { dataset_version: string | null; is_synthetic: boolean | null; file: string | null; config_hash: string };
  decisions_logged: number;
  contract: string;
}

/** POST /agent/run/stream (contract 1.14.0): the mission's agent events as they are logged, then the whole mission.
 *  Throws when the stream cannot be opened or ends without a mission; the caller then falls back to /agent/run. */
async function runStream(req: AgentRunRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<Mission> {
  const res = await fetch(`${API_BASE}/agent/run/stream`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal });
  if (!res.ok || !res.body) throw new ApiError(res.status, res.statusText || "stream unavailable");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", mission: Mission | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let kind = "message", data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) kind = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const d = JSON.parse(data);
      if (kind === "agent") onEvent(d as AgentEvent);
      else if (kind === "mission") mission = d as Mission;
      else if (kind === "error") throw new ApiError(500, String((d as { detail?: string }).detail ?? "stream error"));
    }
  }
  if (!mission) throw new ApiError(0, "the stream ended without a mission");
  remember(requestKey("/agent/run", req), mission, true);       // the API-down fallback can replay it
  onFallback(false);
  return mission;
}

export const api = {
  health: () => call<{ ok: boolean; contract: string; storage?: "persistent" | "ephemeral" }>("/healthz", undefined, { cache: false }),
  stations: () => call<Station[]>("/stations"),
  events: () => call<EventInfo[]>("/events"),
  forecast: (req: ForecastRequest, signal?: AbortSignal) => call<ForecastResponse>("/forecast", req, { signal }),
  simulate: (req: SimulateRequest, signal?: AbortSignal) => call<SimulateResponse>("/simulate", req, { signal }),
  agentPlan: (req: AgentPlanRequest) => call<AgentPlanResponse>("/agent/plan", req),
  /** The agent team (contract 1.11.0): the plan plus every agent event, checks, stress tests and budget. */
  agentRun: (req: AgentRunRequest) => call<Mission>("/agent/run", req),
  /** The same mission, streamed live (agents' events as they happen). */
  agentRunStream: runStream,
  agentRoster: () => call<Roster>("/agent/roster"),
  /** The event chain (contract 1.14.0): never cached, every call moves the chain on. */
  chainStart: (req: ChainStartRequest) => call<ChainState>("/chain/start", req, { cache: false }),
  chainDecide: (id: string, req: ChainDecideRequest) => call<ChainState>(`/chain/${encodeURIComponent(id)}/decide`, req, { cache: false }),
  /** Standing agents (contract 1.12.0): the watcher's alerts for the day, the messenger's drafts, ask the twin. */
  watch: (req: WatchRequest) => call<WatchResponse>("/watch/scan", req),
  message: (req: MessageRequest) => call<MessageResponse>("/agent/message", req),
  ask: (req: AskRequest) => call<AskResponse>("/agent/ask", req),
  /** The duty shift, one step (contract 1.13.0): never cached, each step depends on the decisions before it. */
  shiftNext: (req: ShiftRequest) => call<ShiftStep>("/shift/next", req, { cache: false }),
  breakpoint: (req: BreakpointRequest, signal?: AbortSignal) => call<BreakpointResponse>("/breakpoint", req, { signal }),
  decide: (req: DecisionRequest) => call<DecisionResponse>("/decisions", req, { cache: false }),
  evidence: () => call<Evidence>("/evidence"),
  /** The decision log's hash chain (WP5): ok, records, first_bad. Never cached. */
  verifyLog: () => call<{ ok: boolean; records: number; chained: number; unchained: number; first_bad: number | null }>("/decisions/verify", undefined, { cache: false }),
  /** Anonymous audit log, newest first (kiosk "visitors today" counter). */
  decisions: (limit = 500) => call<{ total: number; approved: number; rejected: number;
    items: { timestamp: string; user: string; decision: string; interventions?: { type: string }[] }[] }>(`/decisions?limit=${limit}`, undefined, { cache: false }),
};
