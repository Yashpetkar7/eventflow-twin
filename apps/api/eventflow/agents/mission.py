"""A mission: one run of the agent team on a planning request (docs/15_AGENT_ARCHITECTURE.md).

`MissionCtx` is the shared working state every agent reads and writes: the planner steps (`planner.PlanRun`), the
event log a visitor watches, the budget, the objective, the critic's checks and the stress tests. The engines in
engine.py decide the order; this module holds what the agents do with numbers, all of it deterministic code.
"""
from __future__ import annotations

import copy
import hashlib
import re
import threading
import time
from typing import Any

from ..config import ROOT, corridor
from ..forecast import build_forecast, make_run_id
from ..interventions import validate_interventions
from ..simulate import simulate
from . import planner
from .roster import AGENTS, BY_ID, LAYERS, counts, layer_of, settings

# Claims the project must never make (CLAUDE.md rule 5). Checked by the verifier on every option text.
CLAIM_PATTERNS = [r"\bapproved by (the )?rta\b", r"\brta[- ]approved\b", r"\bendorsed by\b", r"\bin partnership with (the )?rta\b",
                  r"\bused by (the )?rta\b", r"\bofficial rta (plan|measure|decision)\b", r"معتمد من هيئة الطرق", r"بالشراكة مع هيئة الطرق",
                  r"وافقت (عليه|عليها) هيئة الطرق"]


def agents_hash() -> str:
    return hashlib.sha256((ROOT / "config/agents.yaml").read_bytes()).hexdigest()[:10]


class MissionCtx:
    """Everything one mission's agents share. Agents that run in parallel write only to their own buffers."""

    def __init__(self, run: dict, req, run_simulation, engine: str, llm_for=None):
        self.run, self.req, self.engine = run, req, engine
        self.p = planner.PlanRun(run, req, run_simulation)
        self.cfg = settings()
        self.t0 = time.perf_counter()
        self.events: list[dict] = []
        self._lock = threading.Lock()
        self.steps = 0
        self.model_calls = 0
        self.tokens = 0
        self.stress_sims = 0
        self.exceeded: list[str] = []
        self.objective: dict = {}
        self.findings: list[dict] = []
        self.rejected: list[dict] = []
        self.assessments: dict[int, dict] = {}
        self.pending: list[dict] = []
        self.composed = False
        self.critic_met = False
        self.route = "ranker"
        self.result: dict = {}
        self.spec_llm = None
        self.templates: list[dict] = []
        self.claims_blocked: list[int] = []
        self.explain_t0 = time.perf_counter()
        self.stop_reason = ""
        self.llm_for = llm_for or (lambda agent: None)       # S4: the (recorded) model each agent may use
        self.recording: dict = {"mode": "code", "model": None, "recorded_at": None, "agents_from_model": [], "misses": 0}
        c = getattr(req, "constraints", None)
        self.constraints = c.model_dump() if hasattr(c, "model_dump") else (c or {"forbid_types": [], "protect_stations": [], "cost_cap": None})

    # ---------- events
    def now_ms(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 1)

    def event(self, agent: str, kind: str, key: str, *, rnd: int | None = None, run_id: str | None = None,
              llm: dict | None = None, into: list | None = None, **params) -> dict:
        """One thing an agent did. `into` collects the events of an agent running in parallel, flushed in a fixed order."""
        e = {"t_ms": self.now_ms(), "round": rnd if rnd is not None else self.p.rounds, "layer": layer_of(agent), "agent": agent,
             "kind": kind, "key": key, "params": params, "run_id": run_id, "llm": llm}
        if into is not None:
            into.append(e)
        else:
            self._append(e)
        return e

    def _append(self, e: dict) -> None:
        with self._lock:
            self.events.append({"seq": len(self.events) + 1, **e})

    def flush(self, buffers: list[dict], group: str) -> None:
        """Parallel agents' events, in roster order (never in the order threads happened to finish)."""
        for b in sorted((b for b in buffers if b["group"] == group), key=lambda b: b["order"]):
            for e in b["events"]:
                self._append(e)

    def step(self, agent: str) -> None:
        self.steps += 1

    # ---------- budget
    def sims(self) -> int:
        return self.p.n_sims + self.stress_sims

    def over_budget(self) -> list[str]:
        b = self.cfg["budget"]
        out = []
        if self.steps >= b["steps_max"]:
            out.append("steps")
        if self.sims() >= b["simulations_max"]:
            out.append("simulations")
        if self.model_calls >= b["model_calls_max"]:
            out.append("model_calls")
        if self.now_ms() >= b["wall_ms_max"]:
            out.append("wall_ms")
        return out

    def budget(self) -> dict:
        b = self.cfg["budget"]
        return {"steps": self.steps, "steps_max": b["steps_max"], "simulations": self.sims(), "simulations_max": b["simulations_max"],
                "model_calls": self.model_calls, "model_calls_max": b["model_calls_max"], "tokens": self.tokens,
                "wall_ms": self.now_ms(), "wall_ms_max": b["wall_ms_max"], "exceeded": sorted(set(self.exceeded))}

    # ---------- intake
    def build_objective(self) -> dict:
        p, c = self.p, self.constraints
        found = []
        for field in ("goal", "notes"):
            text = (getattr(self.req, field, None) or "").lower()
            for pat in self.cfg["intake"]["injection_patterns"]:
                if re.search(pat, text):
                    found.append({"field": field, "pattern": pat})
        self.findings = found
        thr = self.req.threshold if self.req.threshold is not None else corridor()["capacity"]["overcap_threshold"]
        self.objective = {"goal": p.goal, "threshold": thr, "priority": self.req.priority, "scope": self.req.scope,
                          "constraints": c, "findings": found, "suggestions": [], "source": "code",
                          "note": "Constraints come only from the planner's typed choices; text in the goal or notes never changes a simulation."}
        return self.objective


# ---------- stress test (C7): the kept options under changed assumptions
def stress_cases(run: dict, cfg: dict) -> list[dict]:
    """(case id, forecast overrides) for this scenario; cases that do not apply are left out (no event: no attendance)."""
    s, ev = cfg["stress"], run.get("event")
    out = []
    if ev:
        att = run.get("attendance_used") or ev.get("attendance")
        for k in s.get("attendance", []):
            out.append({"case": f"attendance_x{k:g}", "kind": "attendance", "value": k, "override": {"attendance": round(att * k)}})
        for m in s.get("metro_share", []):
            out.append({"case": f"metro_share_{m:g}", "kind": "metro_share", "value": m, "override": {"metro_share": m}})
        for w in s.get("weather", []):
            if w != (run.get("weather") or "normal"):
                out.append({"case": f"weather_{w}", "kind": "weather", "value": w, "override": {"weather": w, "metro_share": None}})
    for d in s.get("demand_level", []):
        if d != run.get("demand_level"):
            out.append({"case": f"demand_{d}", "kind": "demand_level", "value": d, "override": {"demand_level": d}})
    return out


def stress_test(ctx: MissionCtx, options: list[dict]) -> dict[int, dict]:
    """Re-simulate every kept option under each stress case. `holds`: the option keeps every station under the
    threshold in that case. Uses the forecast and simulator directly (no shared run memory is filled)."""
    req, run = ctx.req, ctx.run
    spec = getattr(req, "forecast", None)
    if spec is None or not options:
        return {}
    thr = req.threshold
    report = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")] if req.scope == "corridor" else None
    applied = ctx.p.applied
    out = {o["rank"]: {"rank": o["rank"], "cases": [], "holds": 0, "total": 0} for o in options}
    base_spec = spec.model_dump() if hasattr(spec, "model_dump") else dict(spec)
    for case in stress_cases(run, ctx.cfg):
        args = {**base_spec, **case["override"]}
        try:
            fc = build_forecast(args.get("event_id"), args.get("date"), args.get("weekday"), args.get("attendance"), args.get("end_time"),
                                weather=args.get("weather"), exit_sigma_min=args.get("exit_sigma_min"), metro_share=args.get("metro_share"),
                                demand_level=args.get("demand_level"), custom=args.get("custom_event"))
        except (KeyError, ValueError):
            continue
        base = simulate(fc["demand"], [i.model_dump() for i in validate_interventions(list(applied))], weekday=fc["weekday"],
                        threshold=thr, report=report)
        ctx.stress_sims += 1
        for o in options:
            ivs = [i.model_dump() for i in validate_interventions(planner.merge(applied, o["interventions"]))]
            res = simulate(fc["demand"], ivs, weekday=fc["weekday"], threshold=thr, report=report)
            ctx.stress_sims += 1
            holds = res.summary["overcap_station_hours"] == 0
            a = out[o["rank"]]
            a["cases"].append({"case": case["case"], "kind": case["kind"], "value": case["value"], "holds": holds,
                               "overcap_station_hours": res.summary["overcap_station_hours"], "peak_lf": res.summary["peak_lf"],
                               "excess_pax": res.summary["excess_pax"], "baseline_overcap_station_hours": base.summary["overcap_station_hours"],
                               "run_id": make_run_id("stress", {"fc": fc["run_id"], "iv": ivs, "thr": thr, "scope": req.scope})})
            a["total"] += 1
            a["holds"] += holds
    return out


# ---------- the critic's named criteria, per option
def _bins_by_station(hourly: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in hourly:
        out[r["station_id"]] = out.get(r["station_id"], 0) + r["overcap_bins"]
    return out


def checks_for(ctx: MissionCtx, o: dict, pool_entry: dict | None, stress: dict | None) -> list[dict]:
    """C1–C7 for one offered option. passed=None means the criterion does not apply to this scenario."""
    lim = ctx.cfg["critic"]
    base = ctx.p.base
    s, b = o["summary"], base["summary"]
    c = ctx.constraints
    out = [
        {"id": "C1", "passed": s["overcap_station_hours"] == 0, "value": s["overcap_station_hours"], "limit": 0.0},
        {"id": "C2", "passed": not o["new_hotspots"], "value": float(len(o["new_hotspots"])), "limit": 0.0},
        {"id": "C3", "passed": s["overcap_station_hours"] <= b["overcap_station_hours"], "value": s["overcap_station_hours"],
         "limit": b["overcap_station_hours"]},
        {"id": "C4", "passed": s["max_wait_min"] <= lim["max_wait_min"], "value": s["max_wait_min"], "limit": float(lim["max_wait_min"])},
    ]
    road, broad = o.get("road"), base.get("road")
    if road and broad:
        cap = broad["peak_veh_per_hour"] * (1 + lim["road_pressure_rise_max"])
        out.append({"id": "C5", "passed": road["peak_veh_per_hour"] <= cap + 1e-9, "value": road["peak_veh_per_hour"], "limit": round(cap, 1)})
    else:
        out.append({"id": "C5", "passed": None, "value": None, "limit": None})
    ok6, val6 = True, None
    if c.get("cost_cap") is not None:
        ok6 = o["cost_added"] <= c["cost_cap"]
        val6 = o["cost_added"]
    if c.get("protect_stations") and pool_entry is not None:
        before, after = _bins_by_station(base["hourly"]), _bins_by_station(pool_entry["res"]["hourly"])
        ok6 = ok6 and all(after.get(st, 0) <= before.get(st, 0) for st in c["protect_stations"])
    applies6 = c.get("cost_cap") is not None or bool(c.get("protect_stations")) or bool(c.get("forbid_types"))
    out.append({"id": "C6", "passed": ok6 if applies6 else None, "value": val6, "limit": c.get("cost_cap")})
    if stress and stress["total"]:
        share = stress["holds"] / stress["total"]
        out.append({"id": "C7", "passed": share >= lim["stress_hold_min"], "value": round(share, 3), "limit": lim["stress_hold_min"]})
    else:
        out.append({"id": "C7", "passed": None, "value": None, "limit": lim["stress_hold_min"]})
    return out


def failing(o: dict, base_summary: dict) -> list[str]:
    """Which of C1–C3 a tested plan fails (used for the plans that were not offered)."""
    s = o["res"]["summary"]
    out = []
    if s["overcap_station_hours"] > 0:
        out.append("C1")
    if o["new_hot"]:
        out.append("C2")
    if o["demote"]:
        out.append("C3")
    return out


def roster_view(engine: str, mermaid: str | None = None) -> dict:
    return {"engine": engine, "layers": LAYERS, "agents": [*AGENTS, BY_ID["human"]], "counts": counts(), "graph_mermaid": mermaid or ""}


def conclude(ctx: MissionCtx) -> dict:
    """The mission answer: the plan (AgentPlanResponse shape) plus everything the agents found on the way."""
    p = ctx.p
    plan = p.assemble(write_cache=False)                      # missions never overwrite the classic planner's cache
    offered = {id(o) for o in getattr(p, "top", [])}
    rejected = [{"label": d["key"], "interventions": d["ivs"], "round": d["round"], "criteria": [],
                 "reason": d["reason"], "run_id": d.get("run_id"), "summary": d.get("summary")} for d in p.dropped]
    rejected += ctx.rejected                                    # forbidden by the planner's constraints (C6), before simulation
    for o in p.pool:
        if id(o) not in offered:
            rejected.append({"label": o["key"], "interventions": o["ivs"], "round": o["round"], "criteria": failing(o, p.base["summary"]),
                             "reason": "outranked", "run_id": o["res"]["run_id"], "summary": o["res"]["summary"]})
    by_rank = {i + 1: o for i, o in enumerate(getattr(p, "top", []))}
    assessments = []
    for o in plan["options"]:
        st = ctx.assessments.get(o["rank"])
        assessments.append({"rank": o["rank"], "checks": checks_for(ctx, o, by_rank.get(o["rank"]), st),
                            "stress": (st or {}).get("cases", []), "holds": (st or {}).get("holds", 0), "total": (st or {}).get("total", 0)})
    status = "awaiting_human" if plan["options"] else "no_action"
    ctx.event("human" if status == "awaiting_human" else "supervisor", "handoff",
              "human.awaiting" if status == "awaiting_human" else "supervisor.no_action", options=len(plan["options"]))
    mission_id = make_run_id("mission", {"plan": plan["plan_id"], "constraints": ctx.constraints, "agents": agents_hash()})
    return {"mission_id": mission_id, "status": status, "engine": ctx.engine, "objective": ctx.objective,
            "roster": roster_view(ctx.engine)["agents"], "counts": counts(), "events": ctx.events, "plan": plan,
            "rejected": rejected, "assessments": assessments, "budget": ctx.budget(), "recording": ctx.recording,
            "is_synthetic": plan["is_synthetic"], "stop_reason": ctx.stop_reason}


def copy_texts(options: list[dict]) -> list[dict]:
    return [copy.deepcopy({k: o[k] for k in ("title", "what", "risk", "rationale")}) for o in options]


def claim_violations(o: dict) -> bool:
    text = " ".join(str(o.get(k, "")) for k in ("title", "what", "risk", "rationale")).lower()
    return any(re.search(p, text) for p in CLAIM_PATTERNS)


def _unused(_: Any) -> None:  # pragma: no cover - keeps linters quiet about optional imports in type positions
    return None
