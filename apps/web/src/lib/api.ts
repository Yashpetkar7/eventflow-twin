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
export type DecisionResponse = S["DecisionResponse"];
export type Intervention = NonNullable<S["SimulateRequest"]["interventions"]>[number];

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
  mem.set(key, data);
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

export const api = {
  health: () => call<{ ok: boolean; contract: string }>("/healthz", undefined, { cache: false }),
  stations: () => call<Station[]>("/stations"),
  events: () => call<EventInfo[]>("/events"),
  forecast: (req: ForecastRequest, signal?: AbortSignal) => call<ForecastResponse>("/forecast", req, { signal }),
  simulate: (req: SimulateRequest, signal?: AbortSignal) => call<SimulateResponse>("/simulate", req, { signal }),
  agentPlan: (req: AgentPlanRequest) => call<AgentPlanResponse>("/agent/plan", req),
  decide: (req: DecisionRequest) => call<DecisionResponse>("/decisions", req, { cache: false }),
  evidence: () => call<Evidence>("/evidence"),
};
