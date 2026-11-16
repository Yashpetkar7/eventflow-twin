"""The agents, one function each (docs/15_AGENT_ARCHITECTURE.md).

Every node takes the mission state and returns a partial update; both engines (LangGraph and the plain sequence in
engine.py) call these same functions, so the team behaves the same whichever runs it. Nodes that run in parallel
(the four specialists; explainer and stress) never write shared state directly: they return their proposals and
events, and the node after them merges those in roster order, so a mission is deterministic.

Numbers come only from planner.PlanRun's simulator calls and from the stress test (CLAUDE.md rule 2).
"""
from __future__ import annotations

import operator
import time
from typing import Annotated, Any, TypedDict

from ..breakpoint import break_points
from ..config import corridor
from . import planner
from .mission import MissionCtx, claim_violations, conclude, copy_texts, stress_test
from .roster import AGENT_IDS, SPECIALIST_TYPES, SPECIALISTS


class State(TypedDict, total=False):
    ctx: Any                                                   # MissionCtx (shared working state)
    proposals: Annotated[list, operator.add]                   # specialists → composer
    buffers: Annotated[list, operator.add]                     # events of agents that ran in parallel


def _order(agent: str) -> int:
    return AGENT_IDS.index(agent)


def _pct(lf: float | None) -> int | None:
    return None if lf is None else round(lf * 100)


# ---------------------------------------------------------------- layer 1–2
def intake(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("intake")
    ctx.event("supervisor", "start", "supervisor.start", rnd=1, engine=ctx.engine)
    o = ctx.build_objective()
    c = o["constraints"]
    ctx.event("intake", "decision", "intake.objective", rnd=1, threshold_pct=_pct(o["threshold"]), priority=o["priority"],
              forbid=c.get("forbid_types", []), protect=c.get("protect_stations", []), cost_cap=c.get("cost_cap"))
    from .personas import intake_model                     # the intake's model, if any: suggestions, never applied
    intake_model(ctx)
    for f in ctx.findings:
        ctx.event("intake", "finding", "intake.finding", rnd=1, field=f["field"])
    return {}


def forecast(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("forecast")
    run = ctx.run
    ev = run.get("event") or {}
    ctx.event("forecast", "tool", "forecast.run", rnd=1, run_id=run["run_id"], event=ev.get("id"), attendance=run.get("attendance_used"),
              metro_share_pct=_pct(run.get("metro_share_used")), weather=run.get("weather"), demand_level=run.get("demand_level"),
              is_synthetic=run["is_synthetic"])
    return {}


def diagnosis(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("diagnosis")
    p = ctx.p
    p.start(llm=None, use_factory=False)            # the planner's own model is not used by the team: each agent has its own
    b = p.base["summary"]
    ctx.event("diagnosis", "tool", "diagnosis.baseline", rnd=1, run_id=p.base["run_id"], over=b["overcap_station_hours"],
              excess=round(b["excess_pax"]), peak_pct=_pct(b["peak_lf"]))
    hot = p.diagnose()
    if hot is None:
        ctx.event("diagnosis", "decision", "diagnosis.none", rnd=1, threshold_pct=_pct(p.thr))
        ctx.event("critic", "decision", "critic.no_action", rnd=1)
        return {}
    bins: dict[str, dict] = {}
    for r in p.base["hourly"]:
        if r["overcap_bins"]:
            d = bins.setdefault(r["station_id"], {"id": r["station_id"], "bins": 0, "peak_pct": 0})
            d["bins"] += r["overcap_bins"]
            d["peak_pct"] = max(d["peak_pct"], _pct(r["peak_lf"]))
    ctx.event("diagnosis", "decision", "diagnosis.hotspots", rnd=1, run_id=p.base["run_id"], worst=hot["station"], hours=hot["hours"],
              stations=sorted(bins.values(), key=lambda d: (-d["bins"], d["id"])))
    try:
        ids = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")]
        bp = break_points(ctx.run, ctx.req.threshold, ids)
        ctx.event("diagnosis", "tool", "diagnosis.breakpoint", rnd=1, run_id=bp["run_id"], attendance=bp["corridor_break_attendance"],
                  station=bp["corridor_break_station"])
    except Exception:                                # a scenario without an event has no break point; never fail a mission on it
        pass
    road = p.base.get("road")
    if road:
        ctx.event("diagnosis", "tool", "diagnosis.road", rnd=1, run_id=p.base["run_id"], peak_veh=round(road["peak_veh_per_hour"]),
                  pressure_pct=_pct(road["pressure"]), hour=road["peak_hour"])
    return {}


def route_after_diagnosis(state: State) -> list[str] | str:
    return list(SPECIALISTS) if state["ctx"].p.hot is not None else "conclude"


# ---------------------------------------------------------------- layer 3: specialists (parallel)
def _specialist(agent: str):
    def node(state: State) -> dict:
        ctx: MissionCtx = state["ctx"]
        ctx.step(agent)
        p, buf = ctx.p, []
        t = p.target
        own = planner.recipe_bundles(t, {agent})
        if agent == "venue":                         # the venue owns one measure; the composer pairs it with others
            ctx.event(agent, "decision", "venue.stagger", into=buf, available=t["can_stag"], spread=t["spread"])
        else:
            ctx.event(agent, "proposal", f"{agent}.proposed", into=buf, n=len(own), keys=[c["key"] for c in own],
                      types=sorted({i["type"] for c in own for i in c["ivs"]}), station=t["worst"])
        props = [{**c, "source": "menu"} for c in own]
        props += model_proposals(ctx, agent, buf)
        return {"proposals": props, "buffers": [{"group": "specialists", "order": _order(agent), "events": buf}]}
    node.__name__ = agent
    return node


def model_proposals(ctx: MissionCtx, agent: str, buf: list) -> list[dict]:
    """Bundles this specialist's language model adds inside its own measures (S4); none without a model."""
    from .personas import specialist_bundles               # imported lazily: the offline path never needs it
    return specialist_bundles(ctx, agent, buf)


SPECIALIST_NODES = {a: _specialist(a) for a in SPECIALISTS}


# ---------------------------------------------------------------- layer 3: composer
def composer(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("composer")
    p = ctx.p
    forbid = set(ctx.constraints.get("forbid_types") or [])
    if not ctx.composed:                             # round 1: merge the specialists' work
        ctx.composed = True
        ctx.flush(state.get("buffers") or [], "specialists")
        t0 = time.perf_counter()
        props = state.get("proposals") or []
        menu = sorted([c for c in props if c.get("source") == "menu"] + [{**c, "source": "menu"} for c in planner.recipe_bundles(p.target, {"composer"})],
                      key=lambda c: c["ord"])
        allowed = []
        for c in menu:
            bad = sorted({i["type"] for i in c["ivs"]} & forbid)
            if bad:
                ctx.rejected.append({"label": c["key"], "interventions": c["ivs"], "round": 1, "criteria": ["C6"],
                                     "reason": "forbidden", "run_id": None, "summary": None})
                ctx.event("critic", "reject", "critic.forbidden", rnd=1, label=c["key"], types=bad)
                continue
            allowed.append(c)
        p.set_candidates(allowed, t0)
        model = [c for c in sorted(props, key=lambda c: (_order(c["agent"]), c.get("i", 0))) if c.get("source") == "model"]
        added = 0
        for c in model:
            sig = planner._sig(c["ivs"])
            if sig in p.seen or ({i["type"] for i in c["ivs"]} & forbid):
                continue
            p.seen.add(sig)
            p.cands.append({"key": "llm", "ivs": c["ivs"], "ctx": {}, "label": c.get("label", "")})
            added += 1
        if added:                                     # the plan names the model behind its extra bundles
            p.llm_used.append("propose")
            p.llm_added = added
            if p.llm is None and ctx.spec_llm is not None:
                p.llm = ctx.spec_llm
                p.llm_name = f"{'OpenAI' if p.llm.provider == 'openai' else 'Claude'} {p.llm.model}"
        cross = sum(c["agent"] == "composer" for c in allowed)
        ctx.event("composer", "decision", "composer.bundles", rnd=1, menu=len(allowed) - cross, cross=cross, model=added,
                  forbidden=len(menu) - len(allowed))
        ctx.pending = list(p.cands)
        return {}
    # a replanning round (the supervisor asked for one): stronger settings and combinations
    variants, seeds = p.replan_variants()
    keep = [v for v in variants if not ({i["type"] for i in v["ivs"]} & forbid)]
    ctx.pending = keep[:planner.MAX_SIMS_PER_ROUND]
    ctx.event("composer", "decision", "composer.replan", rnd=p.rounds, seeds=[s["key"] for s in seeds], variants=len(ctx.pending),
              station=(planner.diagnose(seeds[0]["res"]) or {}).get("station") if seeds else None)
    return {}


def route_after_composer(state: State) -> str:
    return "simulation" if state["ctx"].pending else "ranker"


# ---------------------------------------------------------------- layer 4
def simulation(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("simulation")
    p, rnd = ctx.p, ctx.p.rounds
    cands, ctx.pending = ctx.pending, []
    n_trace = len(p.trace)
    if rnd == 1:
        p.begin_testing()
        p.test(cands, 1)
        p.n_cand = len(p.cands)
    else:
        p.test(cands, rnd)
    for e in p.trace[n_trace:]:
        if e["tool"] == "simulate":
            d = e["data"]
            ctx.event("simulation", "tool", "simulation.result", rnd=rnd, run_id=e["run_id"], label=d["label"], types=d["types"],
                      over=d["over"], excess=round(d["excess"]), peak_pct=_pct(d["peak_lf"]), cost=d["cost_added"], new_hotspots=d["new_hotspots"])
    return {}


def critic(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("critic")
    p = ctx.p
    met = p.critic(p.rounds)
    v = p.last_verdict
    ctx.event("critic", "decision", "critic.verdict", rnd=p.rounds, verdict=v["verdict"], meeting=v["meeting"], tested=v["tested"],
              station=v.get("station"), excess=round(v["excess"]) if v.get("excess") is not None else None, best=v.get("best"))
    ctx.critic_met = met
    return {}


def supervisor(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("supervisor")
    p = ctx.p
    over = ctx.over_budget()
    if over:
        ctx.exceeded += over
    if p.can_replan(ctx.critic_met) and not over:
        ctx.route = "composer"
        ctx.event("supervisor", "decision", "supervisor.replan", rnd=p.rounds, next_round=p.rounds + 1,
                  station=p.last_verdict.get("station"), excess=round(p.last_verdict["excess"]) if p.last_verdict.get("excess") is not None else None)
    else:
        ctx.route = "ranker"
        why = ("goal_met" if ctx.critic_met else "budget" if over else "no_relief" if not p.pool else "max_rounds")
        ctx.stop_reason = why
        ctx.event("supervisor", "decision", "supervisor.rank", rnd=p.rounds, reason=why, budget=over)
    return {}


def route_after_supervisor(state: State) -> str:
    return state["ctx"].route


def ranker(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("ranker")
    p = ctx.p
    if not ctx.stop_reason:
        ctx.stop_reason = "no_variants"
    top = p.rank()
    ctx.event("ranker", "decision", "ranker.kept", rnd=p.rounds, kept=len(top), tested=len(p.pool), order=[o["key"] for o in top],
              run_ids=[o["res"]["run_id"] for o in top])
    return {}


def explainer(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("explainer")
    p, buf = ctx.p, []
    p.render()
    ctx.templates = copy_texts(p.options)
    from .personas import explain_options                     # S4: the explainer's model, if any (recorded answers offline)
    ctx.explain_t0 = explain_options(ctx, buf)
    ctx.event("explainer", "tool", "explainer.wrote", into=buf, options=len(p.options),
              source=p.llm_name if "explain" in p.llm_used else "template", template_fallback=sorted(p.template_used))
    return {"buffers": [{"group": "finalists", "order": 0, "events": buf}]}


def stress(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("stress")
    buf = []
    opts = [{"rank": i + 1, "interventions": o["ivs"]} for i, o in enumerate(ctx.p.top)]
    ctx.assessments = stress_test(ctx, opts)
    for rank, a in sorted(ctx.assessments.items()):
        ctx.event("stress", "tool", "stress.result", into=buf, rank=rank, holds=a["holds"], total=a["total"],
                  failed=[c["case"] for c in a["cases"] if not c["holds"]])
    return {"buffers": [{"group": "finalists", "order": 1, "events": buf}]}


def verifier(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("verifier")
    p = ctx.p
    ctx.flush(state.get("buffers") or [], "finalists")
    for o, tmpl in zip(p.options, ctx.templates):
        if claim_violations(o):                       # a model text that claims endorsement: back to the verified template
            o.update(tmpl)
            ctx.claims_blocked.append(o["rank"])
    p.log_explain_verify(ctx.explain_t0)
    ctx.event("verifier", "decision", "verifier.checked", rnd=p.rounds, checked=p.checked, all_matched=p.all_ok,
              claims_blocked=ctx.claims_blocked)
    return {}


def conclude_node(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("conclude")
    if ctx.p.hot is None:
        ctx.stop_reason = "no_action"
        ctx.explain_t0 = time.perf_counter()
    ctx.result = conclude(ctx)
    return {}
