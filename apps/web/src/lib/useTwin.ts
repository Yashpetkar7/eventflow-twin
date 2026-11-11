"use client";
// All twin state in one place: scenario → forecast → baseline simulation → plan → decisions → after.
// Every number shown in the UI comes from an API response that carries a `source` run id.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, ApiError, type AgentPlanResponse, type EventInfo, type ForecastResponse, type Intervention,
  type SimulateResponse, type Station,
} from "./api";
import { previewPlan } from "./previewPlanner";

export type Decision = "approve" | "reject";
export type PlanStatus = "idle" | "loading" | "ready" | "error";

export interface Scenario {
  eventId: string | null;
  attendance: number | null; // null = the event's own (sourced or assumed) attendance
  endTime: string | null;    // null = the event's own end time
}

function mergeInterventions(lists: Intervention[][]): Intervention[] {
  const seen = new Set<string>();
  const out: Intervention[] = [];
  let stagger: Intervention | null = null;
  for (const iv of lists.flat()) {
    if (iv.type === "staggered_exit") {        // applying two staggers would double-spread the exit
      if (!stagger || iv.params.spread_minutes > (stagger as typeof iv).params.spread_minutes) stagger = iv;
      continue;
    }
    const key = JSON.stringify(iv);
    if (!seen.has(key)) { seen.add(key); out.push(iv); }
  }
  return stagger ? [stagger, ...out] : out;
}

export function useTwin() {
  const [stations, setStations] = useState<Station[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [scenario, setScenario] = useState<Scenario>({ eventId: null, attendance: null, endTime: null });
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [baseline, setBaseline] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<AgentPlanResponse | null>(null);
  const [planStatus, setPlanStatus] = useState<PlanStatus>("idle");
  const [planError, setPlanError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [after, setAfter] = useState<SimulateResponse | null>(null);
  const [afterLoading, setAfterLoading] = useState(false);
  const reqId = useRef(0);

  // Static lists, once.
  useEffect(() => {
    const ac = new AbortController();
    Promise.all([api.stations(ac.signal), api.events(ac.signal)])
      .then(([st, ev]) => {
        setStations(st);
        setEvents(ev);
        setScenario((s) => (s.eventId ? s : { ...s, eventId: ev[0]?.id ?? null }));
      })
      .catch((e) => { if (e.name !== "AbortError") { setError((e as Error).message); setLoading(false); } });
    return () => ac.abort();
  }, []);

  // Scenario → forecast → baseline (debounced for the sliders; stale responses dropped).
  useEffect(() => {
    if (!events.length) return;
    const id = ++reqId.current;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const fc = await api.forecast({
          event_id: scenario.eventId,
          attendance: scenario.attendance,
          end_time: scenario.endTime,
        }, ac.signal);
        const base = await api.simulate(fc.run_id, [], ac.signal);
        if (id !== reqId.current) return;
        setForecast(fc);
        setBaseline(base);
        setPlan(null);
        setPlanStatus("idle");
        setPlanError(null);
        setDecisions({});
        setAfter(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError" && id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 220);
    return () => { clearTimeout(t); ac.abort(); };
  }, [scenario, events.length]);

  const requestPlan = useCallback(async () => {
    if (!forecast || !baseline) return;
    setPlanStatus("loading");
    setPlanError(null);
    try {
      let p: AgentPlanResponse;
      try {
        p = await api.agentPlan(forecast.run_id);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 501)) throw e;
        p = await previewPlan(forecast.run_id, baseline, stations, !!scenario.eventId);
      }
      setPlan(p);
      setDecisions({});
      setAfter(null);
      setPlanStatus("ready");
    } catch (e) {
      setPlanError((e as Error).message);
      setPlanStatus("error");
    }
  }, [forecast, baseline, stations, scenario.eventId]);

  const decide = useCallback(async (rank: number, decision: Decision) => {
    if (!plan || !forecast) return;
    try {
      await api.decide({ plan_id: plan.plan_id, option_rank: rank, decision, user: "visitor" });
    } catch (e) {
      setPlanError(`Decision not logged: ${(e as Error).message}`);
      return;                                    // never show an "applied" state that was not logged
    }
    const next = { ...decisions, [rank]: decision };
    setDecisions(next);
    const approved = plan.options.filter((o) => next[o.rank] === "approve");
    if (!approved.length) { setAfter(null); return; }
    setAfterLoading(true);
    try {
      setAfter(await api.simulate(forecast.run_id, mergeInterventions(approved.map((o) => o.interventions))));
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setAfterLoading(false);
    }
  }, [plan, forecast, decisions]);

  const event = events.find((e) => e.id === scenario.eventId) ?? null;
  return {
    stations, events, event, scenario, setScenario, forecast, baseline, loading, error,
    plan, planStatus, planError, requestPlan, decisions, decide, after, afterLoading,
  };
}

export type Twin = ReturnType<typeof useTwin>;
