// Typed client for the EventFlow Twin API (contract: ../../contract/openapi.json).
// Types are generated: `python tasks.py contract` → src/lib/api-types.ts. Never hand-edit them.
import type { components } from "./api-types";

type S = components["schemas"];
export type Station = S["Station"];
export type EventInfo = S["Event"];
export type ForecastRequest = S["ForecastRequest"];
export type ForecastResponse = S["ForecastResponse"];
export type ForecastRow = S["ForecastRow"];
export type SimulateResponse = S["SimulateResponse"];
export type SimSummary = S["SimSummary"];
export type SimHourRow = S["SimHourRow"];
export type AgentPlanResponse = S["AgentPlanResponse"];
export type PlanOption = S["PlanOption"];
export type DecisionRequest = S["DecisionRequest"];
export type DecisionResponse = S["DecisionResponse"];
export type Source = S["Source"];
export type Intervention = NonNullable<S["SimulateRequest"]["interventions"]>[number];

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`API ${status}: ${detail}`);
  }
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, `Cannot reach the API at ${API_BASE}. Start it with: python tasks.py api`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export interface Evidence {
  eval: Record<string, { file: string; timestamp?: string; metrics: Record<string, number>; n?: number;
    split?: string; is_synthetic?: boolean; dataset_version?: string }>;
  data: { dataset_version: string | null; is_synthetic: boolean | null; file: string | null; config_hash: string };
  decisions_logged: number;
  contract: string;
}

export const api = {
  stations: (signal?: AbortSignal) => call<Station[]>("/stations", undefined, signal),
  events: (signal?: AbortSignal) => call<EventInfo[]>("/events", undefined, signal),
  forecast: (req: ForecastRequest, signal?: AbortSignal) => call<ForecastResponse>("/forecast", req, signal),
  simulate: (forecast_run_id: string, interventions: Intervention[] = [], signal?: AbortSignal) =>
    call<SimulateResponse>("/simulate", { forecast_run_id, interventions }, signal),
  agentPlan: (forecast_run_id: string, locale: "en" | "ar" = "en") =>
    call<AgentPlanResponse>("/agent/plan", { forecast_run_id, locale }),
  decide: (req: DecisionRequest) => call<DecisionResponse>("/decisions", req),
  evidence: () => call<Evidence>("/evidence"),
};
