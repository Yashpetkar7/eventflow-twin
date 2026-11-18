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
from ..forecast import build_from_spec, make_run_id
from ..interventions import validate_interventions
from ..simulate import simulate
from ..tracing import spans
from . import planner
from .roster import AGENTS, BY_ID, LAYERS, counts, layer_of, settings

# Claims the project must never make (CLAUDE.md rule 5). Checked by the verifier on every option text.
CLAIM_PATTERNS = [r"\bapproved by (the )?rta\b", r"\brta[- ]approved\b", r"\bendorsed by\b", r"\bin partnership with (the )?rta\b",
                  r"\bused by (the )?rta\b", r"\bofficial rta (plan|measure|decision)\b", r"\bverified by\b",
                  r"معتمد(ة)? من (قبل )?هيئة الطرق", r"اعتمدت(ه|ها)? هيئة الطرق", r"بالشراكة مع هيئة الطرق", r"وافقت (عليه|عليها) هيئة الطرق",
                  r"(خطة|إجراء|قرار) رسمي(ة)? (من|لـ|ل)?\s*هيئة الطرق"]


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
        self.objections: list[dict] = []
        self.on_event = None
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
        # checkpoints (1.16.0): where the team stops and asks; the human's answers, consumed in order on every run
        self.checkpoints: list[str] = list(getattr(req, "checkpoints", None) or [])
        self.answers: list[dict] = [a.model_dump() if hasattr(a, "model_dump") else dict(a) for a in (getattr(req, "answers", None) or [])]
        self._used: dict[str, int] = {}
        self.pause: dict | None = None

    def next_answer(self, checkpoint: str) -> dict | None:
        """The human's next unused answer at this checkpoint, or None (the team must stop and ask)."""
        n = self._used.get(checkpoint, 0)
        mine = [a for a in self.answers if a["checkpoint"] == checkpoint]
        if n >= len(mine):
            return None
        self._used[checkpoint] = n + 1
        return mine[n]

    # ---------- events
    def now_ms(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 1)

    def event(self, agent: str, kind: str, key: str, *, rnd: int | None = None, run_id: str | None = None,
              llm: dict | None = None, into: list | None = None, to: list[str] | None = None, **params) -> dict:
        """One thing an agent did. `into` collects the events of an agent running in parallel, flushed in a fixed order.
        `to` makes it a message: the agents it is addressed to, who act on it next (docs/15 §3)."""
        e = {"t_ms": self.now_ms(), "round": rnd if rnd is not None else self.p.rounds, "layer": layer_of(agent), "agent": agent,
             "kind": kind, "key": key, "params": params, "run_id": run_id, "llm": llm, "to": to}
        if into is not None:
            into.append(e)
        else:
            self._append(e)
        return e

    def _append(self, e: dict) -> None:
        with self._lock:
            self.events.append({"seq": len(self.events) + 1, **e})
            ev = self.events[-1]
        if self.on_event is not None:                 # live stream (POST /agent/run/stream): in final order, as it happens
            self.on_event(ev)

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
            fc = build_from_spec(args)
        except (KeyError, ValueError):
            continue
        base = simulate(fc["demand"], [i.model_dump() for i in validate_interventions(list(applied))], weekday=fc["weekday"],
                        threshold=thr, report=report, service=fc.get("service"))
        ctx.stress_sims += 1
        for o in options:
            ivs = [i.model_dump() for i in validate_interventions(planner.merge(applied, o["interventions"]))]
            res = simulate(fc["demand"], ivs, weekday=fc["weekday"], threshold=thr, report=report, service=fc.get("service"))
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


def calm_probes(ctx: MissionCtx) -> list[dict]:
    """Nothing is over the line: the stress agent tests the scenario harder by itself (decision #153), so the supervisor
    has something to ask the human about. Each probe is one forecast and one simulation, with its run id:

        crowd   the crowd at which the corridor first crosses the line (the exact break point, rounded up to 1,000)
        hot     the same event on a hot day (more visitors take the metro)
        line    a stricter comfort line: the next 5-point step under today's peak

    A probe that still leaves every station under the line is reported as holding and is not offered as a next step."""
    import math

    from ..breakpoint import break_points
    req, run, p = ctx.req, ctx.run, ctx.p
    spec = getattr(req, "forecast", None)
    if spec is None:
        return []
    base_spec = spec.model_dump() if hasattr(spec, "model_dump") else dict(spec)
    report = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")] if req.scope == "corridor" else None
    applied = [i.model_dump() for i in validate_interventions(list(p.applied))]
    floor = float(ctx.cfg.get("calm", {}).get("line_min", 0.70))

    def test(fc: dict, thr: float | None, what: dict) -> dict:
        res = simulate(fc["demand"], applied, weekday=fc["weekday"], threshold=thr, report=report, service=fc.get("service"))
        ctx.stress_sims += 1
        w = max(res.hourly, key=lambda r: (r["peak_lf"], -r["hour"]))
        return {**what, "peak_lf": round(w["peak_lf"], 4), "station": w["station_id"], "hour": w["hour"],
                "overcap_station_hours": res.summary["overcap_station_hours"], "excess_pax": round(res.summary["excess_pax"], 1),
                "stations_over": len({r["station_id"] for r in res.hourly if r["overcap_bins"]}), "crosses": res.summary["overcap_station_hours"] > 0,
                "run_id": make_run_id("stress", {"fc": fc["run_id"], "iv": applied, "thr": thr, "scope": req.scope, "probe": what["id"]})}

    out: list[dict] = []
    now = run.get("attendance_used")
    if run.get("event") and now:
        try:
            ids = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")]
            brk = break_points(run, req.threshold, ids)["corridor_break_attendance"]
        except Exception:
            brk = None
        if brk and brk > now:
            att = min(200_000, int(math.ceil((brk + 1) / 1000) * 1000))
            over = {"custom_event": {**base_spec["custom_event"], "attendance": att}} if base_spec.get("custom_event") else {"attendance": att}
            try:
                out.append(test(build_from_spec({**base_spec, **over}), req.threshold,
                                {"id": "crowd", "action": "try_crowd", "attendance": att, "break_attendance": brk, "attendance_now": now}))
            except (KeyError, ValueError):
                pass
        if (run.get("weather") or "normal") != "hot":
            try:
                out.append(test(build_from_spec({**base_spec, "weather": "hot", "metro_share": None}), req.threshold,
                                {"id": "hot", "action": "try_hot", "weather": "hot"}))
            except (KeyError, ValueError):
                pass
    peak = p.base["summary"]["peak_lf"]
    line = math.floor(peak * 20 - 1e-9) / 20                       # the next 5-point step strictly under the peak
    if floor <= line < p.thr:
        out.append(test({"demand": run["demand"], "weekday": run["weekday"], "service": run.get("service"), "run_id": run["run_id"]}, line,
                        {"id": "line", "action": "try_line", "threshold": round(line, 2), "threshold_now": p.thr}))
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


GOAL_CHECKS = ("C1", "C2", "C3")


def recommend(assessments: list[dict]) -> dict | None:
    """The option the checks recommend (docs/17 WP3), in the plan's order:
    1. the first that passes every applicable check C1–C7;
    2. else the first that passes C1–C3 and the most of C4–C7;
    3. else the one that passes the most checks. Ties go to the plan's own order. `passed=None` = does not apply."""
    if not assessments:
        return None
    rows = []
    for a in sorted(assessments, key=lambda a: a["rank"]):
        app = [c for c in a["checks"] if c["passed"] is not None]
        ok = [c["id"] for c in app if c["passed"]]
        rows.append({"rank": a["rank"], "ok": ok, "app": [c["id"] for c in app],
                     "goal": all(c in ok for c in GOAL_CHECKS if c in [x["id"] for x in app])})
    allp = next((r for r in rows if len(r["ok"]) == len(r["app"])), None)
    if allp:
        r, basis = allp, "all_checks"
    elif any(r["goal"] for r in rows):
        g = [r for r in rows if r["goal"]]
        r, basis = max(g, key=lambda r: (len(r["ok"]), -r["rank"])), "goal_and_most"
    else:
        r, basis = max(rows, key=lambda r: (len(r["ok"]), -r["rank"])), "most_checks"
    return {"rank": r["rank"], "basis": basis, "passed": len(r["ok"]), "applicable": len(r["app"]),
            "failed": [c for c in r["app"] if c not in r["ok"]]}


def roster_view(engine: str, mermaid: str | None = None) -> dict:
    return {"engine": engine, "layers": LAYERS, "agents": [*AGENTS, BY_ID["human"]], "counts": counts(), "graph_mermaid": mermaid or ""}


def conclude(ctx: MissionCtx) -> dict:
    """The mission answer: the plan (AgentPlanResponse shape) plus everything the agents found on the way."""
    p = ctx.p
    if ctx.pause is not None:                                   # stopped at a checkpoint: no options yet, the question instead
        p.options = []
        p.top = []
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
    rec = recommend(assessments)
    if rec is not None:
        ctx.event("critic", "decision", "critic.recommend", to=["human"], rank=rec["rank"], basis=rec["basis"], passed=rec["passed"],
                  applicable=rec["applicable"], failed=rec["failed"])
    status = "paused" if ctx.pause is not None else "awaiting_human" if plan["options"] else "no_action"
    if status != "paused":
        ctx.event("human" if status == "awaiting_human" else "supervisor", "handoff",
                  "human.awaiting" if status == "awaiting_human" else "supervisor.no_action", options=len(plan["options"]))
    mission_id = make_run_id("mission", {"plan": plan["plan_id"], "constraints": ctx.constraints, "agents": agents_hash(),
                                         **({"checkpoints": ctx.checkpoints, "answers": ctx.answers} if ctx.checkpoints or ctx.answers else {})})
    return {"mission_id": mission_id, "status": status, "engine": ctx.engine, "objective": ctx.objective,
            "roster": roster_view(ctx.engine)["agents"], "counts": counts(), "events": ctx.events, "plan": plan,
            "rejected": rejected, "assessments": assessments, "budget": ctx.budget(), "recording": ctx.recording,
            "is_synthetic": plan["is_synthetic"], "stop_reason": ctx.stop_reason,
            "recommended_rank": rec["rank"] if rec else None, "recommendation": rec, "spans": spans(ctx.events), "pause": ctx.pause}


def copy_texts(options: list[dict]) -> list[dict]:
    return [copy.deepcopy({k: o[k] for k in ("title", "what", "risk", "rationale")}) for o in options]


def claim_violations(o: dict) -> bool:
    text = " ".join(str(o.get(k, "")) for k in ("title", "what", "risk", "rationale")).lower()
    return any(re.search(p, text) for p in CLAIM_PATTERNS)


def _unused(_: Any) -> None:  # pragma: no cover - keeps linters quiet about optional imports in type positions
    return None
