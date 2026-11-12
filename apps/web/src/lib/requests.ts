// Request bodies, built in ONE place so the app and the offline snapshot script (scripts/snapshot.mjs)
// send byte-identical requests. Pure module: no imports except types.
import type { components } from "./api-types";

type S = components["schemas"];
export type Weather = "normal" | "hot" | "rain";
export type Priority = "cost" | "balanced" | "impact";

export interface Scenario {
  eventId: string;                 // an id from /events, or "custom"
  attendance: number | null;       // null = the event's own figure
  exitSigma: number | null;        // null = the event profile's exit window
  weather: Weather;
  metroShare?: number | null;      // what-if share of event trips by metro (null/absent = the weather's share)
  custom: { near: string; start: string; end: string; weekend: boolean };
}

export const CUSTOM_DEFAULT_ATTENDANCE = 20000;

export function forecastBody(s: Scenario): S["ForecastRequest"] {
  const body: Record<string, unknown> = { weather: s.weather };
  if (s.eventId === "custom") {
    body.custom_event = { near_station: s.custom.near, start: s.custom.start, end: s.custom.end, weekend: s.custom.weekend,
      attendance: s.attendance ?? CUSTOM_DEFAULT_ATTENDANCE };
  } else {
    body.event_id = s.eventId;
    if (s.attendance !== null) body.attendance = s.attendance;
  }
  if (s.exitSigma !== null) body.exit_sigma_min = s.exitSigma;
  if (s.metroShare != null) body.metro_share = s.metroShare;
  return body as S["ForecastRequest"];
}

export function simulateBody(runId: string, interventions: unknown[], threshold: number, forecast: S["ForecastRequest"]): S["SimulateRequest"] {
  // `forecast` lets a serverless instance that never saw this run rebuild it (contract 1.6.0)
  return { forecast_run_id: runId, forecast, interventions, detail: true, threshold, scope: "corridor" } as S["SimulateRequest"];
}

export function planBody(runId: string, applied: unknown[], threshold: number, priority: Priority, locale: "en" | "ar", forecast: S["ForecastRequest"]): S["AgentPlanRequest"] {
  return { forecast_run_id: runId, forecast, locale, threshold, scope: "corridor", priority, applied } as S["AgentPlanRequest"];
}

export function breakpointBody(runId: string, threshold: number, forecast: S["ForecastRequest"]): S["BreakpointRequest"] {
  return { forecast_run_id: runId, forecast, threshold } as S["BreakpointRequest"];
}

/** Stable request key: sorted keys, undefined dropped. Shared by the client cache and scripts/snapshot.mjs. */
export function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
export const requestKey = (path: string, body?: unknown): string => `${path} ${body === undefined ? "" : canon(body)}`;
